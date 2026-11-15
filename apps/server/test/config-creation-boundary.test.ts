import { readPublicConfig } from '@mbrg/protocol';
import type { PublicConfig } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import { request } from './helpers/http-client';
import { closeAllServers, startServer } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { DEV_DIR } from './helpers/digests';
import { creationBody, serviceHarness } from './helpers/service-harness';
import type { Harness, HarnessOptions } from './helpers/service-harness';

// Spec 014 T6: a creation inside the published config is never refused for its map or timing, and the first value outside is.
// The config is read first (from the service, and over HTTP), and every case is derived from what was read, never from a
// literal. Each creation has a fresh source and request id, so no rate limit and no memo gets in the way.

afterEach(closeAllServers);

const DIR = DEV_DIR.replace(/[\\/]$/, '');
const FOLDERS = { dev: DIR, 'zeta-map': DIR, 'alpha-map': DIR, hidden: DIR };

interface Outcome {
  readonly ok: boolean;
  readonly kind?: string;
  readonly items?: readonly string[];
  readonly matchId?: string;
}
interface Surface {
  config(): Promise<PublicConfig>;
  create(mapId: string, i: number, l1: number, l2: number): Promise<Outcome>;
  join(matchId: string): Promise<Outcome>;
}

let counter = 0;
const next = (): number => (counter += 1);
const bodyOf = (mapId: string, i: number, l1: number, l2: number): Record<string, unknown> => creationBody(`b-${next()}`, { mapId, timing: { i, l1, l2 } });

function serviceSurface(h: Harness): Surface {
  return {
    config: () => {
      const out = h.service.publicConfig();
      return Promise.resolve(out.reply);
    },
    create: (mapId, i, l1, l2) => {
      const out = h.service.createPublic({ source: `src-${next()}`, body: bodyOf(mapId, i, l1, l2) });
      return Promise.resolve(out.ok ? { ok: true, matchId: out.reply.matchId } : { ok: false, kind: out.error.kind, items: out.error.items });
    },
    join: (matchId) => {
      const out = h.service.join({ source: `src-${next()}`, matchId, body: { name: `P${next()}`, requestId: `j-${next()}` } });
      return Promise.resolve(out.ok ? { ok: true } : { ok: false, kind: out.error.kind });
    },
  };
}

function httpSurface(h: ServerHarness): Surface {
  return {
    config: async () => {
      const reply = await request(h.port, { path: '/config' });
      expect(reply.status).toBe(200);
      const read = readPublicConfig(JSON.parse(reply.text));
      if (!read.ok) throw new Error(`config refused at ${read.field}`);
      return read.value;
    },
    create: async (mapId, i, l1, l2) => {
      const reply = await request(h.port, { method: 'POST', path: '/matches', body: bodyOf(mapId, i, l1, l2) });
      const json = reply.json() as { kind?: string; items?: string[]; matchId?: string };
      return reply.status === 201 ? { ok: true, matchId: json.matchId } : { ok: false, kind: json.kind, items: json.items };
    },
    join: async (matchId) => {
      const reply = await request(h.port, { method: 'POST', path: `/matches/${matchId}/players`, body: { name: `P${next()}`, requestId: `j-${next()}` } });
      return reply.status === 201 ? { ok: true } : { ok: false, kind: (reply.json() as { kind: string }).kind };
    },
  };
}

interface Case {
  readonly label: string;
  readonly options: HarnessOptions;
  /** Join the whole player cap too (the default cap of 200 is checked at service level only). */
  readonly capOverHttp: boolean;
}
const CASES: readonly Case[] = [
  { label: 'defaults', options: { folders: FOLDERS, publicCreation: { maps: ['dev'], maxOpenLobbies: 1000 } }, capOverHttp: false },
  {
    label: 'non-default',
    options: {
      folders: FOLDERS,
      maxPlayers: 6,
      publicCreation: { maps: ['zeta-map', 'dev', 'alpha-map'], minInterval: 61, maxInterval: 7000, minPhase1: 12, minPhase2: 8, maxOpenLobbies: 1000 },
    },
    capOverHttp: true,
  },
];

const BIG = { commands: 1_000_000, reads: 1_000_000, anonymous: 1_000_000, createSource: 1_000_000, createAll: 1_000_000, joinSource: 1_000_000, joinMatch: 1_000_000 };

type Make = () => Promise<{ surface: Surface; close: () => Promise<void> | void }>;

const surfacesOf = (options: HarnessOptions): [string, Make][] => [
  [
    'service',
    () => {
      const h = serviceHarness(options);
      return Promise.resolve({ surface: serviceSurface(h), close: () => h.close() });
    },
  ],
  [
    'http',
    async () => {
      const h = await startServer({ routes: productionRoutes, service: options, limits: BIG });
      return { surface: httpSurface(h), close: () => h.close() };
    },
  ],
];

async function expectRefusedTiming(s: Surface, mapId: string, i: number, l1: number, l2: number, rule: string): Promise<void> {
  const out = await s.create(mapId, i, l1, l2);
  expect([i, l1, l2, out.ok, out.kind]).toStrictEqual([i, l1, l2, false, 'invalid-timing']);
  expect(out.items).toContain(rule);
}

for (const c of CASES) {
  for (const [surfaceName, make] of surfacesOf(c.options)) {
    const title = (text: string): string => `FR-421 [${c.label}, ${surfaceName}] ${text}`;

    describe(`creation at the published bounds: ${c.label}, ${surfaceName}`, () => {
      it(title('the config read matches the settings this surface was built with'), async () => {
        const { surface, close } = await make();
        try {
          const config = await surface.config();
          expect(config.enabled).toBe(true);
          expect(config.maps).toStrictEqual([...(c.options.publicCreation?.maps ?? [])]);
          expect(config.maxPlayers).toBe(c.options.maxPlayers ?? 200);
        } finally {
          await close();
        }
      });

      it(title('every listed map creates a match at the shortest interval'), async () => {
        const { surface, close } = await make();
        try {
          const config = await surface.config();
          expect(config.maps.length).toBeGreaterThan(0);
          for (const mapId of config.maps) {
            const out = await surface.create(mapId, config.minInterval, config.minPhase1, config.minPhase2);
            expect([mapId, out.ok, out.kind]).toStrictEqual([mapId, true, undefined]);
          }
        } finally {
          await close();
        }
      });

      it(title('the interval at the published minimum and maximum is accepted; one below and one above are invalid-timing'), async () => {
        const { surface, close } = await make();
        try {
          const config = await surface.config();
          const map = config.maps[0]!;
          expect((await surface.create(map, config.minInterval, config.minPhase1, config.minPhase2)).ok).toBe(true);
          expect((await surface.create(map, config.maxInterval, config.minPhase1, config.minPhase2)).ok).toBe(true);
          await expectRefusedTiming(surface, map, config.minInterval - 1, config.minPhase1, config.minPhase2, 'e');
          await expectRefusedTiming(surface, map, config.maxInterval + 1, config.minPhase1, config.minPhase2, 'h');
        } finally {
          await close();
        }
      });

      it(title('the shortest L1 and the shortest L2 are accepted and each one below is refused'), async () => {
        const { surface, close } = await make();
        try {
          const config = await surface.config();
          const map = config.maps[config.maps.length - 1]!;
          expect((await surface.create(map, config.maxInterval, config.minPhase1, config.minPhase2 + 1)).ok).toBe(true);
          expect((await surface.create(map, config.maxInterval, config.minPhase1 + 1, config.minPhase2)).ok).toBe(true);
          expect((await surface.create(map, config.minInterval, config.minPhase1, config.minPhase2)).ok).toBe(true);
          await expectRefusedTiming(surface, map, config.minInterval, config.minPhase1 - 1, config.minPhase2, 'f');
          await expectRefusedTiming(surface, map, config.minInterval, config.minPhase1, config.minPhase2 - 1, 'g');
        } finally {
          await close();
        }
      });

      it(title('a map that is not listed, even one the server holds, is unknown-map'), async () => {
        const { surface, close } = await make();
        try {
          const config = await surface.config();
          for (const mapId of ['hidden', 'no-such-map', 'dev2']) {
            expect(config.maps).not.toContain(mapId);
            const out = await surface.create(mapId, config.minInterval, config.minPhase1, config.minPhase2);
            expect([mapId, out.ok, out.kind]).toStrictEqual([mapId, false, 'unknown-map']);
          }
        } finally {
          await close();
        }
      });

      if (surfaceName === 'service' || c.capOverHttp) {
        it(title('the published player cap of joins is accepted and the next join is match-full'), async () => {
          const { surface, close } = await make();
          try {
            const config = await surface.config();
            const made = await surface.create(config.maps[0]!, config.minInterval, config.minPhase1, config.minPhase2);
            expect(made.ok).toBe(true);
            for (let n = 0; n < config.maxPlayers; n += 1) {
              const out = await surface.join(made.matchId!);
              expect([n, out.ok, out.kind]).toStrictEqual([n, true, undefined]);
            }
            const over = await surface.join(made.matchId!);
            expect([over.ok, over.kind]).toStrictEqual([false, 'match-full']);
          } finally {
            await close();
          }
        });
      }
    });
  }
}

describe('a disabled config', () => {
  for (const [surfaceName, make] of surfacesOf({ folders: FOLDERS, maxPlayers: 9, publicCreation: { maps: [], minInterval: 61, minPhase1: 12, minPhase2: 8 } })) {
    it(`FR-421 [disabled, ${surfaceName}] the config says disabled with its bounds, and a creation of any map is unknown-map`, async () => {
      const { surface, close } = await make();
      try {
        const config = await surface.config();
        expect(config).toStrictEqual({ maps: [], minInterval: 61, maxInterval: 3600, minPhase1: 12, minPhase2: 8, maxPlayers: 9, enabled: false });
        for (const mapId of ['dev', 'zeta-map', 'hidden', 'nowhere']) {
          const out = await surface.create(mapId, config.minInterval, config.minPhase1, config.minPhase2);
          expect([mapId, out.ok, out.kind]).toStrictEqual([mapId, false, 'unknown-map']);
        }
      } finally {
        await close();
      }
    });
  }
});
