import { PUBLIC_CONFIG_KEYS, encodePublicConfig, readPublicConfig } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import { createMapCatalog } from '../src/service/maps';
import { createMatchService } from '../src/service/matches';
import { publicConfigOf } from '../src/service/public-config';
import { readSettings } from '../src/service/settings';
import type { Settings } from '../src/service/settings';
import type { Store } from '../src/store/store';
import { SECRETS } from './helpers/core-timelines';
import { DEV_DIR } from './helpers/digests';
import { request } from './helpers/http-client';
import { PINS, hashOf } from './helpers/protected-pins';
import { closeAllServers, startServer } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { CLOCK_TIMING, creationBody } from './helpers/service-harness';

// Spec 014 T5: the public config carries nothing but its seven fields. Planted values in every other setting, in five
// encodings, never reach the body (service and real listener); the key set is the declared one; fifty reads across match
// states, clock jumps and callers are byte-identical; the read touches no storage, clock or random source.

afterEach(closeAllServers);

const OPERATOR_PLANTED = 'PLANTEDoperatorCredential0123456789';
const CLIENT_PLANTED = 'PLANTEDclientCredentialAbcdef0123456789';
const NAMESPACE_PLANTED = 'plantedns';
const ORIGIN_PLANTED = 'https://planted-origin.example';
const HIDDEN_MAP = 'hiddenmap';
const DEV_FOLDER = DEV_DIR.replace(/[\\/]$/, '');
/** Limit values, caps, expiry and phase span, none of them equal to a public number. */
const LIMIT_VALUES = { commands: 876_541, reads: 876_542, submissions: 876_543, advances: 876_544, anonymous: 876_545, streams: 876_546, anonymousStreams: 876_547, createSource: 876_548, createAll: 876_549, joinSource: 876_550, joinMatch: 876_551 };
const OTHER_NUMBERS = { runningMatchLimit: 876_552, maxOpenLobbies: 876_553, maxPublicRunning: 876_554, lobbyExpiryHours: 713, forcedPhaseSeconds: 3_217 };
const FIVE_FORMS = (text: string): string[] => {
  const bytes = Buffer.from(text, 'utf8');
  return [text, bytes.toString('hex'), bytes.toString('base64'), bytes.toString('base64url'), text.toUpperCase().toLowerCase() === text ? text : text.toLowerCase()];
};
const NUMBER_FORMS = (n: number): string[] => [String(n), n.toString(16), ...FIVE_FORMS(String(n))];

const plantedStrings = (port: number): string[] => [
  OPERATOR_PLANTED, CLIENT_PLANTED, NAMESPACE_PLANTED, ORIGIN_PLANTED, 'planted-origin', HIDDEN_MAP, '127.0.0.1', ':memory:', DEV_FOLDER, 'maps/dev', 'maps\\dev', String(port),
];
const plantedNumbers = (): number[] => [...Object.values(LIMIT_VALUES), ...Object.values(OTHER_NUMBERS)];

/** Every encoding of every planted value, minus the ones too short to mean anything. */
function plantedForms(port: number): string[] {
  const forms = new Set<string>();
  for (const s of plantedStrings(port)) for (const f of FIVE_FORMS(s)) forms.add(f);
  for (const n of plantedNumbers()) for (const f of NUMBER_FORMS(n)) forms.add(f);
  return [...forms].filter((f) => f.length >= 3);
}

const begin = (): Promise<ServerHarness> =>
  startServer({
    routes: productionRoutes,
    clients: [{ namespace: NAMESPACE_PLANTED, credential: CLIENT_PLANTED }],
    allowedOrigins: [ORIGIN_PLANTED],
    limits: { ...LIMIT_VALUES },
    service: {
      operator: OPERATOR_PLANTED,
      folders: { dev: DEV_FOLDER, [HIDDEN_MAP]: DEV_FOLDER },
      limit: OTHER_NUMBERS.runningMatchLimit,
      forcedPhaseSeconds: OTHER_NUMBERS.forcedPhaseSeconds,
      maxPlayers: 77,
      secret: SECRETS['ascending-00-1f'],
      publicCreation: { maps: ['dev'], maxOpenLobbies: OTHER_NUMBERS.maxOpenLobbies, maxPublicRunning: OTHER_NUMBERS.maxPublicRunning, lobbyExpiryHours: OTHER_NUMBERS.lobbyExpiryHours },
    },
  });

const getConfig = (h: ServerHarness, headers: Record<string, string> = {}): Promise<string> =>
  request(h.port, { path: '/config', headers }).then((r) => {
    expect(r.status).toBe(200);
    return r.text;
  });

describe('the public config keeps every other setting out', () => {
  it('FR-415 the body of the real listener holds no planted value in decimal, hex, base64, base64url or raw', async () => {
    const h = await begin();
    const body = await getConfig(h);
    expect(body).toBe('{"maps":["dev"],"minInterval":30,"maxInterval":3600,"minPhase1":10,"minPhase2":5,"maxPlayers":77,"enabled":true}');
    for (const form of plantedForms(h.port)) expect(body, form).not.toContain(form);
    // A credentialed read of the same server leaks nothing either.
    const withClient = await getConfig(h, { authorization: `Bearer ${CLIENT_PLANTED}`, origin: ORIGIN_PLANTED });
    for (const form of plantedForms(h.port)) expect(withClient, form).not.toContain(form);
    expect(withClient).toBe(body);
  });

  it('FR-415 the service read holds no planted value either, and the planted settings really are set', async () => {
    const h = await begin();
    expect(h.settings.operatorCredential).toBe(OPERATOR_PLANTED);
    expect(h.settings.limits.anonymous).toBe(LIMIT_VALUES.anonymous);
    expect(h.settings.publicCreation.lobbyExpiryHours).toBe(OTHER_NUMBERS.lobbyExpiryHours);
    expect(Object.keys(h.settings.maps)).toContain(HIDDEN_MAP);
    const out = h.service.publicConfig();
    const text = encodePublicConfig(out.reply);
    for (const form of plantedForms(h.port)) expect(text, form).not.toContain(form);
    const direct = encodePublicConfig(publicConfigOf(h.settings));
    expect(direct).toBe(text);
  });

  it('FR-415 settings read from the environment: planted variables stay out, a host and port included', () => {
    const read = readSettings({
      MBRG_OPERATOR_CREDENTIAL: OPERATOR_PLANTED,
      MBRG_MAPS: `{"dev":"maps/dev","${HIDDEN_MAP}":"maps/${HIDDEN_MAP}-folder"}`,
      MBRG_PUBLIC_MAPS: 'dev',
      MBRG_CLIENTS: JSON.stringify([{ namespace: NAMESPACE_PLANTED, credential: CLIENT_PLANTED }]),
      MBRG_ALLOWED_ORIGINS: ORIGIN_PLANTED,
      MBRG_HOST: '10.254.253.252',
      MBRG_PORT: '54321',
      MBRG_DATABASE: 'planted-database-path.sqlite',
      MBRG_LOBBY_EXPIRY_HOURS: String(OTHER_NUMBERS.lobbyExpiryHours),
      MBRG_MAX_OPEN_LOBBIES: String(OTHER_NUMBERS.maxOpenLobbies),
      MBRG_MAX_PUBLIC_RUNNING: String(OTHER_NUMBERS.maxPublicRunning),
      MBRG_FORCED_PHASE_SECONDS: String(OTHER_NUMBERS.forcedPhaseSeconds),
      MBRG_LIMIT_ANONYMOUS: String(LIMIT_VALUES.anonymous),
    });
    if (!read.ok) throw new Error(`refused: ${read.problems.join(', ')}`);
    const text = encodePublicConfig(publicConfigOf(read.settings));
    const planted = [...plantedForms(54321), '10.254.253.252', 'planted-database-path', `${HIDDEN_MAP}-folder`, ...FIVE_FORMS('10.254.253.252'), ...FIVE_FORMS('planted-database-path.sqlite'), ...NUMBER_FORMS(54321)].filter((f) => f.length >= 3);
    for (const form of planted) expect(text, form).not.toContain(form);
  });

  it('FR-415 the decoded key set is exactly the declared one and no key is named like a private setting', async () => {
    const h = await begin();
    const body = JSON.parse(await getConfig(h)) as Record<string, unknown>;
    expect(Object.keys(body)).toStrictEqual([...PUBLIC_CONFIG_KEYS]);
    expect(new Set(Object.keys(body))).toStrictEqual(new Set(PUBLIC_CONFIG_KEYS));
    expect(readPublicConfig(body).ok).toBe(true);
    for (const key of PUBLIC_CONFIG_KEYS) expect(key, key).not.toMatch(/token|digest|namespace|origin|host|port|path|folder|count|limit|expiry/i);
    // The nested values are only the map ids, whole numbers and one boolean.
    const flat = JSON.stringify(body);
    expect(flat).toBe('{"maps":["dev"],"minInterval":30,"maxInterval":3600,"minPhase1":10,"minPhase2":5,"maxPlayers":77,"enabled":true}');
  });
});

describe('the public config is the same for any state', () => {
  it('FR-417 fifty reads across no match, open lobbies, running, finished and halted matches, clock jumps and callers are byte-identical', async () => {
    const h = await begin();
    const steps: (() => void)[] = [
      () => undefined, // no match yet
      () => {
        const made = h.service.createPublic({ source: 'src-1', body: creationBody('p-1') });
        if (!made.ok) throw new Error('lobby creation failed');
      },
      () => {
        const made = h.service.createPublic({ source: 'src-2', body: creationBody('p-2') });
        if (!made.ok) throw new Error('lobby creation failed');
        const joined = h.service.join({ source: 'src-j', matchId: made.reply.matchId, body: { name: 'Ana', requestId: 'j-1' } });
        if (!joined.ok) throw new Error('join failed');
      },
      () => {
        const made = h.service.create({ credential: OPERATOR_PLANTED, body: creationBody('o-1', { timing: 'manual' }) });
        if (!made.ok) throw new Error('operator creation failed');
        running = made.reply.matchId;
      },
      () => h.clock.advance(3_600_000),
      () => {
        // Finish a manual match: 4 rounds, 3 steps each.
        const made = h.service.create({ credential: OPERATOR_PLANTED, body: creationBody('o-2', { timing: 'manual' }) });
        if (!made.ok) throw new Error('operator creation failed');
        for (let k = 1; k <= 4; k += 1) for (const step of ['phase-1-close', 'phase-2-close', 'application'] as const) {
          const out = h.service.advance({ credential: OPERATOR_PLANTED, matchId: made.reply.matchId, body: { round: k, step } });
          if (!out.ok) throw new Error(`advance refused: ${JSON.stringify(out.error)}`);
        }
      },
      () => {
        // Halt the running manual match: a service over the same store with a catalog that lost the map.
        const other = createMatchService({ store: h.base.store, clock: h.clock, maps: { ids: () => [], load: () => undefined }, settings: h.settings });
        const out = other.advance({ credential: OPERATOR_PLANTED, matchId: running, body: { round: 1, step: 'phase-1-close' } });
        expect(out.ok).toBe(false);
        const row = h.base.store.getMatch(running)!.match;
        expect(row.stage).toBe('halted');
      },
      () => h.clock.advance(-1_000_000_000),
      () => h.clock.advance(86_400_000 * 40),
    ];
    let running = '';
    const callers: Record<string, string>[] = [
      {},
      { authorization: `Bearer ${CLIENT_PLANTED}` },
      { authorization: `Bearer ${OPERATOR_PLANTED}` },
      { authorization: 'Bearer wrong-credential-0123456789abcdef' },
      { origin: 'https://evil.example' },
    ];
    const first = await getConfig(h);
    const bodies: string[] = [first];
    for (let i = 0; i < 49; i += 1) {
      if (i % 5 === 0) steps[(i / 5) % steps.length]!();
      bodies.push(await getConfig(h, callers[i % callers.length]));
      if (i % 7 === 0) h.clock.advance(61_000);
    }
    expect(bodies).toHaveLength(50);
    expect(new Set(bodies)).toStrictEqual(new Set([first]));
    expect(h.base.store.getMatch(running)!.match.stage).toBe('halted');
    expect(CLOCK_TIMING.i).toBe(120);
  });
});

describe('the public config read touches nothing else', () => {
  it('NFR-83 a store that throws on any access and a clock and random spy: the service read answers and no spy is called', () => {
    const calls: string[] = [];
    const store = new Proxy(
      {},
      {
        get: (_t, key) => {
          calls.push(`store.${String(key)}`);
          throw new Error('the store must not be touched');
        },
      },
    ) as unknown as Store;
    const read = readSettings({ MBRG_OPERATOR_CREDENTIAL: OPERATOR_PLANTED, MBRG_MAPS: '{"dev":"maps/dev"}', MBRG_PUBLIC_MAPS: 'dev' });
    if (!read.ok) throw new Error('settings refused');
    const settings: Settings = read.settings;
    const service = createMatchService({
      store,
      clock: { now: () => (calls.push('clock.now'), 0) } as never,
      maps: createMapCatalog({ dev: DEV_FOLDER }),
      settings,
      random: () => {
        calls.push('random');
        return new Uint8Array(0);
      },
    });
    for (let i = 0; i < 5; i += 1) {
      const out = service.publicConfig();
      expect(out.ok && out.reply.maps).toStrictEqual(['dev']);
    }
    expect(calls).toStrictEqual([]);
  });

  it('NFR-83 over the listener the read opens no storage access and draws no random byte', async () => {
    let armed = false;
    const seen: string[] = [];
    const h = await startServer({
      routes: productionRoutes,
      service: { publicCreation: { maps: ['dev'] } },
      wrapStore: (store) =>
        new Proxy(store, {
          get: (target, key, receiver) => {
            if (armed) seen.push(String(key));
            return Reflect.get(target, key, receiver) as unknown;
          },
        }),
    });
    const draws = h.base.draws.length;
    armed = true;
    for (let i = 0; i < 3; i += 1) expect((await request(h.port, { path: '/config' })).status).toBe(200);
    armed = false;
    expect(seen).toStrictEqual([]);
    expect(h.base.draws.length).toBe(draws);
  });

  it('NFR-83 the map package and the simulation stay as pinned: protected files and the dev secrets golden match their SHA-256 in the same run', () => {
    expect(Object.keys(PINS.files).length).toBe(PINS.count);
    for (const name of ['apps/server/test/golden/dev-secrets.json', 'maps/dev/map.json', 'maps/dev/ids.png']) {
      expect(PINS.files[name], name).toMatch(/^[0-9a-f]{64}$/);
      expect(hashOf(name), name).toBe(PINS.files[name]);
    }
    const sim = Object.keys(PINS.files).filter((f) => f.startsWith('packages/sim/src/') || f.startsWith('packages/shared/src/'));
    expect(sim.length).toBeGreaterThan(0);
    for (const name of sim) expect(hashOf(name), name).toBe(PINS.files[name]);
  });
});
