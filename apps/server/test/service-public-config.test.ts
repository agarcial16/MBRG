import { encodePublicConfig, readPublicConfig, PUBLIC_CONFIG_KEYS } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { createMapCatalog } from '../src/service/maps';
import { createMatchService } from '../src/service/matches';
import { publicConfigOf } from '../src/service/public-config';
import { readSettings } from '../src/service/settings';
import type { ServerSettings, Settings } from '../src/service/settings';
import type { Store } from '../src/store/store';
import { DEV_DIR } from './helpers/digests';
import { serviceHarness } from './helpers/service-harness';

// Spec 014 T3: the service answers the public config from the settings object it holds (the one creation enforces), with no
// storage, clock or random access.

const MAPS = '{"dev":"maps/dev","iberia":"maps/dev","europe":"maps/dev","world":"maps/dev"}';
const OPERATOR_ENV = 'PLANTEDoperatorCred0000';
const base = { MBRG_OPERATOR_CREDENTIAL: OPERATOR_ENV, MBRG_MAPS: MAPS };
const settingsOf = (patch: Record<string, string> = {}): ServerSettings => {
  const read = readSettings({ ...base, ...patch });
  if (!read.ok) throw new Error(`refused: ${read.problems.join(', ')}`);
  return read.settings;
};
const mutable = (settings: Settings): { publicCreation: Settings['publicCreation']; maxPlayers: number } =>
  settings as unknown as { publicCreation: Settings['publicCreation']; maxPlayers: number };

/** A store that fails on any access at all, and spies on the clock and random source. */
function sealedService(settings: Settings): { service: ReturnType<typeof createMatchService>; calls: string[] } {
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
  const clock = {
    now: () => {
      calls.push('clock.now');
      return 0;
    },
  };
  const service = createMatchService({
    store,
    clock: clock as never,
    maps: createMapCatalog({ dev: DEV_DIR.replace(/[\\/]$/, '') }),
    settings,
    random: () => {
      calls.push('random');
      return new Uint8Array(0);
    },
  });
  return { service, calls };
}

describe('public config from the settings', () => {
  it('FR-414 the defaults: no public map means disabled, an empty list, the bounds 30 / 3600 / 10 / 5 and the cap 200', () => {
    const settings = settingsOf();
    const out = publicConfigOf(settings);
    expect(out).toStrictEqual({ maps: [], minInterval: 30, maxInterval: 3600, minPhase1: 10, minPhase2: 5, maxPlayers: 200, enabled: false });
    expect(Object.keys(out)).toStrictEqual([...PUBLIC_CONFIG_KEYS]);
  });

  it('FR-414 enabled is true for one map and for many maps, and false only for none', () => {
    expect(publicConfigOf(settingsOf({ MBRG_PUBLIC_MAPS: 'dev' }))).toStrictEqual({
      maps: ['dev'],
      minInterval: 30,
      maxInterval: 3600,
      minPhase1: 10,
      minPhase2: 5,
      maxPlayers: 200,
      enabled: true,
    });
    const many = publicConfigOf(settingsOf({ MBRG_PUBLIC_MAPS: 'world,dev,europe,iberia' }));
    expect(many.enabled).toBe(true);
    expect(many.maps).toStrictEqual(['world', 'dev', 'europe', 'iberia']);
    expect(publicConfigOf(settingsOf({ MBRG_PUBLIC_MAPS: '' })).enabled).toBe(false);
  });

  it('FR-414 the operator values are published as set, each field from its own setting', () => {
    const settings = settingsOf({
      MBRG_PUBLIC_MAPS: 'europe,dev',
      MBRG_PUBLIC_MIN_INTERVAL: '47',
      MBRG_PUBLIC_MAX_INTERVAL: '5321',
      MBRG_PUBLIC_MIN_PHASE1: '13',
      MBRG_PUBLIC_MIN_PHASE2: '9',
      MBRG_MAX_PLAYERS: '77',
    });
    expect(publicConfigOf(settings)).toStrictEqual({
      maps: ['europe', 'dev'],
      minInterval: 47,
      maxInterval: 5321,
      minPhase1: 13,
      minPhase2: 9,
      maxPlayers: 77,
      enabled: true,
    });
  });

  it('FR-414 the map order of the operator is kept, never sorted', () => {
    for (const list of ['world,europe,dev', 'dev,europe,world', 'europe,world,dev']) {
      expect(publicConfigOf(settingsOf({ MBRG_PUBLIC_MAPS: list })).maps).toStrictEqual(list.split(','));
    }
  });

  it('FR-414 disabled keeps the bounds and the player cap, with an empty list', () => {
    const settings = settingsOf({ MBRG_PUBLIC_MIN_INTERVAL: '61', MBRG_PUBLIC_MAX_INTERVAL: '4001', MBRG_PUBLIC_MIN_PHASE1: '21', MBRG_PUBLIC_MIN_PHASE2: '11', MBRG_MAX_PLAYERS: '33' });
    expect(publicConfigOf(settings)).toStrictEqual({ maps: [], minInterval: 61, maxInterval: 4001, minPhase1: 21, minPhase2: 11, maxPlayers: 33, enabled: false });
  });

  it('FR-414 the result is a fresh array and a fresh object: changing it does not change the settings', () => {
    const settings = settingsOf({ MBRG_PUBLIC_MAPS: 'dev,europe' });
    const first = publicConfigOf(settings);
    expect(first.maps).not.toBe(settings.publicCreation.maps);
    (first.maps as string[]).push('injected');
    (first.maps as string[]).reverse();
    expect(settings.publicCreation.maps).toStrictEqual(['dev', 'europe']);
    expect(publicConfigOf(settings)).not.toBe(publicConfigOf(settings));
    expect(publicConfigOf(settings).maps).toStrictEqual(['dev', 'europe']);
  });

  it('FR-414 the service publishes the settings object it holds: a new map list or cap on that object changes the next read', () => {
    const h = serviceHarness({ publicCreation: { maps: ['dev'] }, maxPlayers: 9 });
    try {
      expect(h.service.publicConfig()).toStrictEqual({
        ok: true,
        reply: { maps: ['dev'], minInterval: 30, maxInterval: 3600, minPhase1: 10, minPhase2: 5, maxPlayers: 9, enabled: true },
      });
      mutable(h.settings).publicCreation = { ...h.settings.publicCreation, maps: ['dev', 'second'], minInterval: 44 };
      mutable(h.settings).maxPlayers = 12;
      const next = h.service.publicConfig();
      expect(next.ok && next.reply).toStrictEqual({ maps: ['dev', 'second'], minInterval: 44, maxInterval: 3600, minPhase1: 10, minPhase2: 5, maxPlayers: 12, enabled: true });
      mutable(h.settings).publicCreation = { ...h.settings.publicCreation, maps: [] };
      const off = h.service.publicConfig();
      expect(off.ok && off.reply.enabled).toBe(false);
      expect(off.ok && off.reply.maps).toStrictEqual([]);
    } finally {
      h.close();
    }
  });

  it('FR-414 each read of the service is a fresh array', () => {
    const h = serviceHarness({ publicCreation: { maps: ['dev'] } });
    try {
      const a = h.service.publicConfig();
      const b = h.service.publicConfig();
      expect(a.ok && b.ok && a.reply.maps !== b.reply.maps).toBe(true);
      if (a.ok) (a.reply.maps as string[]).push('x');
      const c = h.service.publicConfig();
      expect(c.ok && c.reply.maps).toStrictEqual(['dev']);
    } finally {
      h.close();
    }
  });

  it('FR-414 the service reply encodes and decodes through the protocol', () => {
    const h = serviceHarness({ publicCreation: { maps: ['dev'] } });
    try {
      const out = h.service.publicConfig();
      if (!out.ok) throw new Error('the read failed');
      const text = encodePublicConfig(out.reply);
      expect(readPublicConfig(JSON.parse(text))).toStrictEqual({ ok: true, value: out.reply });
    } finally {
      h.close();
    }
  });

  it('FR-414 no setting outside the public ones appears in the result, planted sentinels included', () => {
    const settings = settingsOf({
      MBRG_PUBLIC_MAPS: 'dev',
      MBRG_CLIENTS: JSON.stringify([{ namespace: 'sentinelns', credential: 'SENTINELclientCredential0000' }]),
      MBRG_ALLOWED_ORIGINS: 'https://sentinel-origin.example',
      MBRG_HOST: '10.254.253.252',
      MBRG_PORT: '54321',
      MBRG_DATABASE: 'sentinel-database.sqlite',
      MBRG_MAX_RUNNING_MATCHES: '876541',
      MBRG_LIMIT_COMMANDS: '876542',
      MBRG_LIMIT_READS: '876543',
      MBRG_LIMIT_SUBMISSIONS: '876544',
      MBRG_LIMIT_ADVANCES: '876545',
      MBRG_LIMIT_ANONYMOUS: '876546',
      MBRG_LIMIT_STREAMS: '876547',
      MBRG_LIMIT_ANONYMOUS_STREAMS: '876548',
      MBRG_LIMIT_CREATE_SOURCE: '876549',
      MBRG_LIMIT_CREATE_ALL: '876550',
      MBRG_LIMIT_JOIN_SOURCE: '876551',
      MBRG_LIMIT_JOIN_MATCH: '876552',
      MBRG_MAX_OPEN_LOBBIES: '876553',
      MBRG_MAX_PUBLIC_RUNNING: '876554',
      MBRG_LOBBY_EXPIRY_HOURS: '713',
      MBRG_FORCED_PHASE_SECONDS: '3217',
      MBRG_TRUSTED_PROXY_HOPS: '7',
    });
    const text = encodePublicConfig(publicConfigOf(settings));
    for (const planted of ['PLANTED', 'SENTINEL', 'sentinel', '10.254', '54321', '8765', '713', '3217', 'maps/dev']) expect(text, planted).not.toContain(planted);
    expect(text).toBe('{"maps":["dev"],"minInterval":30,"maxInterval":3600,"minPhase1":10,"minPhase2":5,"maxPlayers":200,"enabled":true}');
  });

  it('FR-414 an extra property on the settings object never reaches the result', () => {
    const settings = { ...settingsOf({ MBRG_PUBLIC_MAPS: 'dev' }), planted: 'leak-me' };
    const out = publicConfigOf(settings);
    expect(Object.keys(out)).toStrictEqual([...PUBLIC_CONFIG_KEYS]);
    expect(JSON.stringify(out)).not.toContain('leak-me');
  });

  it('FR-414 the read answers with a store that fails on any access, and never calls the clock or the random source', () => {
    const { service, calls } = sealedService(settingsOf({ MBRG_PUBLIC_MAPS: 'dev,europe' }));
    const out = service.publicConfig();
    expect(out.ok && out.reply.maps).toStrictEqual(['dev', 'europe']);
    expect(calls).toStrictEqual([]);
  });
});
