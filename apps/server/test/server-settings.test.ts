import { describe, expect, it } from 'vitest';
import { PLAYER_NAMESPACE } from '@mbrg/protocol';
import { createMatchService } from '../src/service/matches';
import { createMapCatalog } from '../src/service/maps';
import {
  CONNECTION_OPTIONS,
  DEFAULT_HOST,
  DEFAULT_LIMITS,
  DEFAULT_PORT,
  RESERVED_CLIENT_NAMESPACE,
  SETTING_VARIABLES,
  SHUTDOWN_GRACE_MS,
  readSettings,
} from '../src/service/settings';
import type { ServerSettings, Settings } from '../src/service/settings';
import { openStore } from '../src/store/sqlite';
import { fakeClock } from './helpers/fake-clock';

// M3a T3 (plan 18.5): the server settings of the HTTP milestone. FR-283 (start refusal, namespaces, credential set and
// length) and FR-299 (b) (values and defaults). Origins and the listener are the C4 defaults. A problem names the
// variable and never echoes a value: every credential below is a planted marker that must not appear in a problem.

const OPERATOR = 'PLANTEDoperatorCred0000';
const CLIENT_A = 'PLANTEDclientCredA00001';
const CLIENT_B = 'PLANTEDclientCredB00002';
const MARKERS = /PLANTED|https?:\/\/|\b(?:1000001|65536)\b/;

const base = { MBRG_OPERATOR_CREDENTIAL: OPERATOR, MBRG_MAPS: '{"dev":"maps/dev"}' };
const clients = (list: unknown): string => JSON.stringify(list);

/** The problems of an environment that must be refused, checked to name only the variable. */
const problemsOf = (patch: Record<string, string>): readonly string[] => {
  const read = readSettings({ ...base, ...patch });
  expect(read.ok, JSON.stringify(patch)).toBe(false);
  if (read.ok) return [];
  expect(MARKERS.test(JSON.stringify(read.problems)), JSON.stringify(read.problems)).toBe(false);
  for (const value of Object.values(patch)) if (value.length > 0) expect(JSON.stringify(read.problems)).not.toContain(value);
  return read.problems;
};

const settingsOf = (patch: Record<string, string>): ServerSettings => {
  const read = readSettings({ ...base, ...patch });
  if (!read.ok) throw new Error(`refused: ${read.problems.join(', ')}`);
  return read.settings;
};

describe('server settings: variables and defaults', () => {
  it('FR-299 (stream limits) FR-260 the 30 variables read are exactly the plan list, in order, and none can set a round-seed source', () => {
    expect(SETTING_VARIABLES).toStrictEqual([
      'MBRG_OPERATOR_CREDENTIAL', 'MBRG_MAPS', 'MBRG_MAX_RUNNING_MATCHES', 'MBRG_DATABASE', 'MBRG_CLIENTS',
      'MBRG_ALLOWED_ORIGINS', 'MBRG_HOST', 'MBRG_PORT', 'MBRG_LIMIT_COMMANDS', 'MBRG_LIMIT_READS',
      'MBRG_LIMIT_SUBMISSIONS', 'MBRG_LIMIT_ADVANCES', 'MBRG_LIMIT_ANONYMOUS', 'MBRG_LIMIT_STREAMS', 'MBRG_LIMIT_ANONYMOUS_STREAMS',
      'MBRG_FORCED_PHASE_SECONDS',
      'MBRG_PUBLIC_MAPS', 'MBRG_PUBLIC_MIN_INTERVAL', 'MBRG_PUBLIC_MIN_PHASE1', 'MBRG_PUBLIC_MIN_PHASE2', 'MBRG_PUBLIC_MAX_INTERVAL',
      'MBRG_MAX_OPEN_LOBBIES', 'MBRG_MAX_PUBLIC_RUNNING', 'MBRG_LOBBY_EXPIRY_HOURS',
      'MBRG_MAX_PLAYERS',
      'MBRG_LIMIT_CREATE_SOURCE', 'MBRG_LIMIT_CREATE_ALL', 'MBRG_LIMIT_JOIN_SOURCE', 'MBRG_LIMIT_JOIN_MATCH', 'MBRG_TRUSTED_PROXY_HOPS',
    ]);
    expect(SETTING_VARIABLES).toHaveLength(30);
    // "source" in the two per-source rate limits means the requesting address, not a seed source: named exactly.
    expect(SETTING_VARIABLES.filter((name) => /seed|random|source/i.test(name))).toStrictEqual(['MBRG_LIMIT_CREATE_SOURCE', 'MBRG_LIMIT_JOIN_SOURCE']);
  });

  it('FR-299 (b) the defaults: no clients, no origins, 127.0.0.1:8787, limits 600 / 1,200 / 30 / 30 / 120 per minute, 50 and 5 open streams', () => {
    expect(settingsOf({})).toStrictEqual({
      operatorCredential: OPERATOR,
      maps: { dev: 'maps/dev' },
      runningMatchLimit: 20,
      databasePath: 'mbrg.sqlite',
      forcedPhaseSeconds: 5,
      maxPlayers: 200,
      publicCreation: { maps: [], minInterval: 30, minPhase1: 10, minPhase2: 5, maxInterval: 3600, maxOpenLobbies: 50, maxPublicRunning: 20, lobbyExpiryHours: 24 },
      clients: [],
      allowedOrigins: [],
      host: '127.0.0.1',
      port: 8787,
      trustedProxyHops: 0,
      limits: { commands: 600, reads: 1200, submissions: 30, advances: 30, anonymous: 120, streams: 50, anonymousStreams: 5, createSource: 5, createAll: 30, joinSource: 20, joinMatch: 120 },
    });
    expect(DEFAULT_HOST).toBe('127.0.0.1');
    expect(DEFAULT_PORT).toBe(8787);
    expect(DEFAULT_LIMITS).toStrictEqual({ commands: 600, reads: 1200, submissions: 30, advances: 30, anonymous: 120, streams: 50, anonymousStreams: 5, createSource: 5, createAll: 30, joinSource: 20, joinMatch: 120 });
  });

  it('FR-299 (b) every limit is an operator setting, so a test or the performance run can raise each one', () => {
    const raised = settingsOf({
      MBRG_LIMIT_COMMANDS: '1000000',
      MBRG_LIMIT_READS: '999999',
      MBRG_LIMIT_SUBMISSIONS: '1',
      MBRG_LIMIT_ADVANCES: '77',
      MBRG_LIMIT_ANONYMOUS: '4321',
      MBRG_LIMIT_STREAMS: '1000000',
      MBRG_LIMIT_ANONYMOUS_STREAMS: '1',
    });
    expect(raised.limits).toStrictEqual({ commands: 1000000, reads: 999999, submissions: 1, advances: 77, anonymous: 4321, streams: 1000000, anonymousStreams: 1, createSource: 5, createAll: 30, joinSource: 20, joinMatch: 120 });
  });

  it('FR-299 (stream limits) a limit that is not a whole number 1 to 1,000,000 is refused naming its variable', () => {
    for (const name of ['MBRG_LIMIT_COMMANDS', 'MBRG_LIMIT_READS', 'MBRG_LIMIT_SUBMISSIONS', 'MBRG_LIMIT_ADVANCES', 'MBRG_LIMIT_ANONYMOUS', 'MBRG_LIMIT_STREAMS', 'MBRG_LIMIT_ANONYMOUS_STREAMS']) {
      for (const value of ['0', '1000001', '-5', '2.5', '1e3', 'many', '', ' 30', '030', '0x10']) {
        expect(problemsOf({ [name]: value }), `${name}=${value}`).toStrictEqual([name]);
      }
    }
  });

  it('forced phase setting: whole seconds 1 to 3,600 are read; anything else is refused naming only the variable', () => {
    for (const [value, seconds] of [['1', 1], ['9', 9], ['47', 47], ['3600', 3600]] as const) {
      expect(settingsOf({ MBRG_FORCED_PHASE_SECONDS: value }).forcedPhaseSeconds, value).toBe(seconds);
    }
    for (const value of ['0', '-1', '3601', '1.5', 'x', '', ' 5', '05', '1e3', '0x10']) {
      expect(problemsOf({ MBRG_FORCED_PHASE_SECONDS: value }), JSON.stringify(value)).toStrictEqual(['MBRG_FORCED_PHASE_SECONDS']);
    }
  });

  it('server settings (C4): the connection options and the shutdown grace period are fixed values', () => {
    expect(CONNECTION_OPTIONS).toStrictEqual({ maxHeaderSize: 8192, headersTimeout: 10_000, requestTimeout: 30_000, keepAliveTimeout: 5_000 });
    expect(SHUTDOWN_GRACE_MS).toBe(5_000);
    expect(Object.isFrozen(CONNECTION_OPTIONS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_LIMITS)).toBe(true);
  });

  it('FR-260 the server settings are a subtype of the service settings: the service constructor still accepts them', () => {
    const settings: Settings = settingsOf({ MBRG_DATABASE: ':memory:', MBRG_CLIENTS: clients([{ namespace: 'web', credential: CLIENT_A }]) });
    const store = openStore(':memory:');
    try {
      expect(() => createMatchService({ store, clock: fakeClock(0), maps: createMapCatalog({}), settings })).not.toThrow();
    } finally {
      store.close();
    }
  });
});

describe('server settings: credentials', () => {
  it('FR-283 (credential set and length) 22 to 256 characters of A-Z a-z 0-9 _ - are accepted for the operator credential', () => {
    // 'g' (not 'a'): a credential made only of hexadecimal digits needs 32 characters (FR-283 (hex credentials)).
    for (const credential of ['g'.repeat(22), 'Z'.repeat(256), 'Ab0_-Ab0_-Ab0_-Ab0_-Ab', '0123456789abcdef0123456789abcdef']) {
      expect(readSettings({ ...base, MBRG_OPERATOR_CREDENTIAL: credential }).ok, credential).toBe(true);
    }
  });

  it('FR-283 (start refusal) an operator credential of 21 or 257 characters or with a space, +, / or = is refused, never echoed', () => {
    for (const value of ['PLANTED' + 'x'.repeat(14), 'PLANTED' + 'x'.repeat(250), 'PLANTEDoperator Cred0000', 'PLANTEDoperator+Cred0000', 'PLANTEDoperator/Cred0000', 'PLANTEDoperatorCred0000=', 'PLANTEDoperatorCréd0000', '']) {
      expect(problemsOf({ MBRG_OPERATOR_CREDENTIAL: value }), value).toStrictEqual(['MBRG_OPERATOR_CREDENTIAL']);
    }
    expect('PLANTED' + 'x'.repeat(14)).toHaveLength(21);
    expect('PLANTED' + 'x'.repeat(250)).toHaveLength(257);
  });

  it('FR-283 (hex credentials) a credential made only of hexadecimal digits needs at least 32 characters (128 bits), any case', () => {
    const HEX = '0123456789abcdef0123456789ABCDEF';
    for (const length of [22, 23, 30, 31]) {
      for (const value of [HEX.slice(0, length), HEX.slice(0, length).toUpperCase(), 'f'.repeat(length), '7'.repeat(length)]) {
        expect(problemsOf({ MBRG_OPERATOR_CREDENTIAL: value }), value).toStrictEqual(['MBRG_OPERATOR_CREDENTIAL']);
        expect(problemsOf({ MBRG_CLIENTS: clients([{ namespace: 'web', credential: value }]) }), value).toStrictEqual(['MBRG_CLIENTS']);
      }
    }
    // 32 hexadecimal characters carry 128 bits; one character outside the hexadecimal digits makes it a base64url credential.
    for (const value of [HEX, HEX.toLowerCase(), HEX + 'a', `${HEX.slice(0, 21)}g`, `${HEX.slice(0, 21)}-`, `_${HEX.slice(0, 21)}`]) {
      expect(readSettings({ ...base, MBRG_OPERATOR_CREDENTIAL: value }).ok, value).toBe(true);
      expect(settingsOf({ MBRG_CLIENTS: clients([{ namespace: 'web', credential: value }]) }).clients, value).toHaveLength(1);
    }
  });

  it('FR-283 (namespaces) clients are read from a JSON array of { namespace, credential }, in order', () => {
    const read = settingsOf({ MBRG_CLIENTS: clients([{ namespace: 'web', credential: CLIENT_A }, { credential: CLIENT_B, namespace: 'discord0123456789'.slice(0, 16) }]) });
    expect(read.clients).toStrictEqual([
      { namespace: 'web', credential: CLIENT_A },
      { namespace: 'discord012345678', credential: CLIENT_B },
    ]);
    expect(settingsOf({ MBRG_CLIENTS: '[]' }).clients).toStrictEqual([]);
    expect(settingsOf({ MBRG_CLIENTS: '' }).clients).toStrictEqual([]);
    for (const namespace of ['a', '0', 'z9', 'abcdefghijklmnop']) {
      expect(settingsOf({ MBRG_CLIENTS: clients([{ namespace, credential: CLIENT_A }]) }).clients[0]?.namespace).toBe(namespace);
    }
  });

  it('FR-283 (namespaces) a namespace outside a-z 0-9 of 1 to 16 characters is refused naming MBRG_CLIENTS', () => {
    for (const namespace of ['', 'abcdefghijklmnopq', 'Web', 'we b', 'we-b', 'we_b', 'web:', 'wéb', 3, null]) {
      expect(problemsOf({ MBRG_CLIENTS: clients([{ namespace, credential: CLIENT_A }]) }), String(namespace)).toStrictEqual(['MBRG_CLIENTS']);
    }
  });

  it('the namespace of web players is reserved: a client with it is refused at start naming MBRG_CLIENTS, at any position, other namespaces still start', () => {
    expect(RESERVED_CLIENT_NAMESPACE).toBe(PLAYER_NAMESPACE);
    expect(RESERVED_CLIENT_NAMESPACE).toBe('player');
    expect(problemsOf({ MBRG_CLIENTS: clients([{ namespace: 'player', credential: CLIENT_A }]) })).toStrictEqual(['MBRG_CLIENTS']);
    expect(problemsOf({ MBRG_CLIENTS: clients([{ namespace: 'web', credential: CLIENT_A }, { namespace: 'player', credential: CLIENT_B }]) })).toStrictEqual(['MBRG_CLIENTS']);
    for (const namespace of ['web', 'discord', 'bot', 'players', 'playe', 'player0', 'a']) {
      expect(settingsOf({ MBRG_CLIENTS: clients([{ namespace, credential: CLIENT_A }]) }).clients, namespace).toHaveLength(1);
    }
  });

  it('FR-283 (start refusal) two clients sharing a namespace are refused', () => {
    expect(problemsOf({ MBRG_CLIENTS: clients([{ namespace: 'web', credential: CLIENT_A }, { namespace: 'web', credential: CLIENT_B }]) })).toStrictEqual(['MBRG_CLIENTS']);
    expect(problemsOf({ MBRG_CLIENTS: clients([{ namespace: 'bot', credential: CLIENT_A }, { namespace: 'web', credential: 'PLANTEDclientCredC00003' }, { namespace: 'bot', credential: CLIENT_B }]) })).toStrictEqual(['MBRG_CLIENTS']);
  });

  it('FR-283 (start refusal) two equal client credentials, or a client credential equal to the operator credential, are refused', () => {
    expect(problemsOf({ MBRG_CLIENTS: clients([{ namespace: 'web', credential: CLIENT_A }, { namespace: 'bot', credential: CLIENT_A }]) })).toStrictEqual(['MBRG_CLIENTS']);
    expect(problemsOf({ MBRG_CLIENTS: clients([{ namespace: 'web', credential: OPERATOR }]) })).toStrictEqual(['MBRG_CLIENTS']);
  });

  it('FR-283 (credential set and length) a client credential of 21 or 257 characters or with a space, +, / or = is refused', () => {
    expect(settingsOf({ MBRG_CLIENTS: clients([{ namespace: 'web', credential: 'PLANTED' + 'y'.repeat(15) }]) }).clients).toHaveLength(1);
    expect(settingsOf({ MBRG_CLIENTS: clients([{ namespace: 'web', credential: 'PLANTED' + 'y'.repeat(249) }]) }).clients).toHaveLength(1);
    for (const credential of ['PLANTED' + 'y'.repeat(14), 'PLANTED' + 'y'.repeat(250), 'PLANTEDclient CredA0001', 'PLANTEDclient+CredA0001', 'PLANTEDclient/CredA0001', 'PLANTEDclientCredA0001=', '', 7]) {
      expect(problemsOf({ MBRG_CLIENTS: clients([{ namespace: 'web', credential }]) }), String(credential)).toStrictEqual(['MBRG_CLIENTS']);
    }
  });

  it('FR-283 (start refusal) MBRG_CLIENTS that is not a JSON array of exactly { namespace, credential } objects is refused', () => {
    const one = { namespace: 'web', credential: CLIENT_A };
    for (const text of [
      '{',
      'null',
      '"web"',
      clients(one),
      clients([null]),
      clients(['web']),
      clients([[CLIENT_A]]),
      clients([{ namespace: 'web' }]),
      clients([{ credential: CLIENT_A }]),
      clients([{ ...one, extra: 1 }]),
      clients([{ ...one, role: 'operator' }]),
      `[{"namespace":"web","credential":"${CLIENT_A}","__proto__":{}}]`,
    ]) {
      expect(problemsOf({ MBRG_CLIENTS: text }), text).toStrictEqual(['MBRG_CLIENTS']);
    }
  });

  it('FR-283 (start refusal) problems of several variables are listed in the variable order, and no planted value appears', () => {
    const read = readSettings({
      MBRG_OPERATOR_CREDENTIAL: 'PLANTEDshort',
      MBRG_MAPS: '{"dev":"maps/dev"}',
      MBRG_CLIENTS: clients([{ namespace: 'web', credential: 'PLANTEDshortToo' }]),
      MBRG_ALLOWED_ORIGINS: 'https://PLANTED.example/x',
      MBRG_PORT: '65536',
      MBRG_LIMIT_ANONYMOUS: '1000001',
    });
    expect(read).toStrictEqual({ ok: false, problems: ['MBRG_OPERATOR_CREDENTIAL', 'MBRG_CLIENTS', 'MBRG_ALLOWED_ORIGINS', 'MBRG_PORT', 'MBRG_LIMIT_ANONYMOUS'] });
    expect(MARKERS.test(JSON.stringify(read))).toBe(false);
  });
});

describe('server settings: origins and listener', () => {
  it('server settings (C4): allowed origins are a comma-separated list of http(s)://host[:port]', () => {
    expect(settingsOf({ MBRG_ALLOWED_ORIGINS: 'https://mbrg.example' }).allowedOrigins).toStrictEqual(['https://mbrg.example']);
    expect(settingsOf({ MBRG_ALLOWED_ORIGINS: 'http://localhost:5173,https://a.b-c.example:8443,http://127.0.0.1:1,http://[::1]:5173' }).allowedOrigins).toStrictEqual([
      'http://localhost:5173',
      'https://a.b-c.example:8443',
      'http://127.0.0.1:1',
      'http://[::1]:5173',
    ]);
    expect(settingsOf({ MBRG_ALLOWED_ORIGINS: '' }).allowedOrigins).toStrictEqual([]);
  });

  it('server settings (C4): an origin with a path, query, trailing slash, *, upper case, another scheme or a bad port is refused', () => {
    for (const value of [
      'https://a.example/',
      'https://a.example/path',
      'https://a.example?x=1',
      'https://a.example#x',
      '*',
      'https://*.example',
      'HTTPS://a.example',
      'https://A.example',
      'ftp://a.example',
      'a.example',
      'https://',
      'https://a.example:',
      'https://a.example:0',
      'https://a.example:65536',
      'https://a.example:080',
      'https://user@a.example',
      'https://a.example,',
      'https://a.example, https://b.example',
      'null',
    ]) {
      expect(problemsOf({ MBRG_ALLOWED_ORIGINS: value }), value).toStrictEqual(['MBRG_ALLOWED_ORIGINS']);
    }
  });

  it('server settings (C4): the host and the port are read, port 0 (any free port) to 65535', () => {
    expect(settingsOf({ MBRG_HOST: '0.0.0.0', MBRG_PORT: '0' })).toMatchObject({ host: '0.0.0.0', port: 0 });
    expect(settingsOf({ MBRG_HOST: '::1', MBRG_PORT: '65535' })).toMatchObject({ host: '::1', port: 65535 });
    expect(settingsOf({ MBRG_PORT: '1' }).port).toBe(1);
    for (const value of ['65536', '-1', '80.5', 'http', '', '0080', ' 80', '1e3']) expect(problemsOf({ MBRG_PORT: value }), value).toStrictEqual(['MBRG_PORT']);
    for (const value of ['', ' ', 'local host', 'localhost\n', '\t127.0.0.1']) expect(problemsOf({ MBRG_HOST: value }), JSON.stringify(value)).toStrictEqual(['MBRG_HOST']);
  });
});

describe('server settings: purity', () => {
  const sources = import.meta.glob('../src/service/settings.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const code = Object.values(sources)[0]!.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('FR-299 (b) the settings module reads no clock, timer or random source and imports nothing', () => {
    expect(code.length).toBeGreaterThan(0);
    for (const re of [/\bDate\b/, /\bsetTimeout\b|\bsetInterval\b|\bsetImmediate\b/, /\bMath\.random\b|\brandom[A-Z]\w*\b|\bcrypto\b/, /\bperformance\b/, /\bimport\b(?!\s+type\b)/, /\bprocess\b/]) {
      expect(re.test(code), String(re)).toBe(false);
    }
  });
});

describe('server settings: public creation', () => {
  const two = { MBRG_MAPS: '{"dev":"maps/dev","big":"maps/big"}' };

  it('the public creation settings read their defaults: no public map (public creation off), 30 / 10 / 5 / 3,600 seconds, 50 and 20 matches, 24 hours', () => {
    expect(settingsOf({}).publicCreation).toStrictEqual({
      maps: [], minInterval: 30, minPhase1: 10, minPhase2: 5, maxInterval: 3600, maxOpenLobbies: 50, maxPublicRunning: 20, lobbyExpiryHours: 24,
    });
    expect(settingsOf({ MBRG_PUBLIC_MAPS: '' }).publicCreation.maps).toStrictEqual([]);
  });

  it('the public creation settings read operator values (non-round numbers), and the public maps keep the order given', () => {
    const read = settingsOf({
      ...two,
      MBRG_PUBLIC_MAPS: 'big,dev',
      MBRG_PUBLIC_MIN_INTERVAL: '47',
      MBRG_PUBLIC_MIN_PHASE1: '13',
      MBRG_PUBLIC_MIN_PHASE2: '7',
      MBRG_PUBLIC_MAX_INTERVAL: '901',
      MBRG_MAX_OPEN_LOBBIES: '3',
      MBRG_MAX_PUBLIC_RUNNING: '9',
      MBRG_LOBBY_EXPIRY_HOURS: '5',
    });
    expect(read.publicCreation).toStrictEqual({
      maps: ['big', 'dev'], minInterval: 47, minPhase1: 13, minPhase2: 7, maxInterval: 901, maxOpenLobbies: 3, maxPublicRunning: 9, lobbyExpiryHours: 5,
    });
  });

  it('every public map must be one of the configured maps: otherwise the problem names MBRG_PUBLIC_MAPS and no map id', () => {
    for (const value of ['nowhere', 'dev,nowhere', 'Bad Id', 'dev,,big', ',dev', 'dev,', 'dev,dev', ' dev']) {
      const problems = problemsOf({ ...two, MBRG_PUBLIC_MAPS: value });
      expect(problems, JSON.stringify(value)).toStrictEqual(['MBRG_PUBLIC_MAPS']);
    }
    expect(settingsOf({ ...two, MBRG_PUBLIC_MAPS: 'dev' }).publicCreation.maps).toStrictEqual(['dev']);
  });

  it('the whole-number settings refuse anything but a whole number in range, naming only their variable', () => {
    const ranges: Array<[string, string]> = [
      ['MBRG_PUBLIC_MIN_INTERVAL', '86400'], ['MBRG_PUBLIC_MIN_PHASE1', '86400'], ['MBRG_PUBLIC_MIN_PHASE2', '86400'],
      ['MBRG_MAX_OPEN_LOBBIES', '1000000'], ['MBRG_MAX_PUBLIC_RUNNING', '1000000'], ['MBRG_LOBBY_EXPIRY_HOURS', '720'],
    ];
    for (const [name, top] of ranges) {
      for (const value of ['0', '-1', '1.5', 'x', '', ' 5', '05', '1e3', '0x10', String(Number(top) + 1)]) {
        expect(problemsOf({ [name]: value }), `${name}=${JSON.stringify(value)}`).toStrictEqual([name]);
      }
    }
    for (const value of ['0', '-1', '1.5', 'x', '', '05', '86401']) {
      expect(problemsOf({ MBRG_PUBLIC_MAX_INTERVAL: value }), JSON.stringify(value)).toStrictEqual(['MBRG_PUBLIC_MAX_INTERVAL']);
    }
    // The top of each range is accepted (lobby expiry and caps alone; the intervals need a consistent set).
    expect(settingsOf({ MBRG_LOBBY_EXPIRY_HOURS: '720', MBRG_MAX_OPEN_LOBBIES: '1000000', MBRG_MAX_PUBLIC_RUNNING: '1000000' }).publicCreation).toMatchObject({ lobbyExpiryHours: 720, maxOpenLobbies: 1000000, maxPublicRunning: 1000000 });
    expect(settingsOf({ MBRG_PUBLIC_MIN_INTERVAL: '86400', MBRG_PUBLIC_MAX_INTERVAL: '86400' }).publicCreation).toMatchObject({ minInterval: 86400, maxInterval: 86400 });
    expect(settingsOf({ MBRG_LOBBY_EXPIRY_HOURS: '1' }).publicCreation.lobbyExpiryHours).toBe(1);
  });

  it('a bound set must be consistent: the minimum interval exceeds both minimum phases together, and does not exceed the maximum interval', () => {
    // L1 + L2 = 15: an interval of 15 leaves no time for the locked part of the round.
    expect(problemsOf({ MBRG_PUBLIC_MIN_INTERVAL: '15' })).toStrictEqual(['MBRG_PUBLIC_MIN_INTERVAL']);
    expect(problemsOf({ MBRG_PUBLIC_MIN_INTERVAL: '10' })).toStrictEqual(['MBRG_PUBLIC_MIN_INTERVAL']);
    expect(settingsOf({ MBRG_PUBLIC_MIN_INTERVAL: '16' }).publicCreation.minInterval).toBe(16);
    expect(problemsOf({ MBRG_PUBLIC_MIN_PHASE1: '25' })).toStrictEqual(['MBRG_PUBLIC_MIN_INTERVAL']);
    expect(problemsOf({ MBRG_PUBLIC_MIN_PHASE2: '20' })).toStrictEqual(['MBRG_PUBLIC_MIN_INTERVAL']);
    expect(settingsOf({ MBRG_PUBLIC_MIN_PHASE1: '24' }).publicCreation.minPhase1).toBe(24);
    // The maximum interval is not below the minimum one.
    expect(problemsOf({ MBRG_PUBLIC_MAX_INTERVAL: '29' })).toStrictEqual(['MBRG_PUBLIC_MAX_INTERVAL']);
    expect(settingsOf({ MBRG_PUBLIC_MAX_INTERVAL: '30' }).publicCreation.maxInterval).toBe(30);
    expect(problemsOf({ MBRG_PUBLIC_MIN_INTERVAL: '100', MBRG_PUBLIC_MAX_INTERVAL: '99' })).toStrictEqual(['MBRG_PUBLIC_MAX_INTERVAL']);
    // A bad value is reported alone: no consistency problem is derived from a value that did not parse.
    expect(problemsOf({ MBRG_PUBLIC_MIN_INTERVAL: 'x', MBRG_PUBLIC_MAX_INTERVAL: '5' })).toStrictEqual(['MBRG_PUBLIC_MIN_INTERVAL']);
  });

  it('the problems of the new settings come in the order of the variable list, after the older ones', () => {
    expect(problemsOf({ MBRG_LOBBY_EXPIRY_HOURS: '0', MBRG_PUBLIC_MIN_PHASE1: 'x', MBRG_PUBLIC_MAPS: 'zzz', MBRG_FORCED_PHASE_SECONDS: '0', MBRG_PORT: 'x' })).toStrictEqual([
      'MBRG_PORT', 'MBRG_FORCED_PHASE_SECONDS', 'MBRG_PUBLIC_MAPS', 'MBRG_PUBLIC_MIN_PHASE1', 'MBRG_LOBBY_EXPIRY_HOURS',
    ]);
  });

  it('the player cap defaults to 200 and reads an operator value from 1 to 10,000, in a non-round number', () => {
    expect(settingsOf({}).maxPlayers).toBe(200);
    expect(settingsOf({ MBRG_MAX_PLAYERS: '37' }).maxPlayers).toBe(37);
    expect(settingsOf({ MBRG_MAX_PLAYERS: '1' }).maxPlayers).toBe(1);
    expect(settingsOf({ MBRG_MAX_PLAYERS: '10000' }).maxPlayers).toBe(10000);
  });

  it('the player cap refuses anything but a whole number 1 to 10,000, naming only its variable', () => {
    for (const value of ['0', '-1', '1.5', 'x', '', ' 5', '05', '1e3', '0x10', '10001', '100000']) {
      expect(problemsOf({ MBRG_MAX_PLAYERS: value }), JSON.stringify(value)).toStrictEqual(['MBRG_MAX_PLAYERS']);
    }
  });

  it('the player cap problem comes last, after the older ones', () => {
    expect(problemsOf({ MBRG_MAX_PLAYERS: '0', MBRG_LOBBY_EXPIRY_HOURS: '0', MBRG_PORT: 'x' })).toStrictEqual(['MBRG_PORT', 'MBRG_LOBBY_EXPIRY_HOURS', 'MBRG_MAX_PLAYERS']);
  });

  it('the creation and join limits are operator settings read like the older ones, in non-round numbers', () => {
    const raised = settingsOf({ MBRG_LIMIT_CREATE_SOURCE: '7', MBRG_LIMIT_CREATE_ALL: '77', MBRG_LIMIT_JOIN_SOURCE: '13', MBRG_LIMIT_JOIN_MATCH: '1000000' });
    expect(raised.limits).toMatchObject({ createSource: 7, createAll: 77, joinSource: 13, joinMatch: 1000000 });
    // Each one alone moves only itself.
    expect(settingsOf({ MBRG_LIMIT_CREATE_ALL: '77' }).limits).toStrictEqual({ ...DEFAULT_LIMITS, createAll: 77 });
    expect(settingsOf({ MBRG_LIMIT_JOIN_SOURCE: '13' }).limits).toStrictEqual({ ...DEFAULT_LIMITS, joinSource: 13 });
  });

  it('a creation or join limit that is not a whole number 1 to 1,000,000 is refused naming its variable', () => {
    for (const name of ['MBRG_LIMIT_CREATE_SOURCE', 'MBRG_LIMIT_CREATE_ALL', 'MBRG_LIMIT_JOIN_SOURCE', 'MBRG_LIMIT_JOIN_MATCH']) {
      for (const value of ['0', '1000001', '-5', '2.5', '1e3', 'many', '', ' 30', '030', '0x10']) {
        expect(problemsOf({ [name]: value }), `${name}=${value}`).toStrictEqual([name]);
      }
    }
  });

  it('the proxy hop count defaults to 0 and reads a whole number 0 to 8', () => {
    expect(settingsOf({}).trustedProxyHops).toBe(0);
    for (let hops = 0; hops <= 8; hops += 1) expect(settingsOf({ MBRG_TRUSTED_PROXY_HOPS: String(hops) }).trustedProxyHops, String(hops)).toBe(hops);
  });

  it('the proxy hop count refuses anything else, naming only its variable', () => {
    for (const value of ['9', '10', '-1', '1.5', 'x', '', ' 1', '01', '1e0', '0x1', '+1', '00']) {
      expect(problemsOf({ MBRG_TRUSTED_PROXY_HOPS: value }), JSON.stringify(value)).toStrictEqual(['MBRG_TRUSTED_PROXY_HOPS']);
    }
  });

  it('the problems of the five newest settings come last, in the order of the variable list', () => {
    expect(problemsOf({ MBRG_TRUSTED_PROXY_HOPS: '9', MBRG_LIMIT_JOIN_MATCH: '0', MBRG_LIMIT_JOIN_SOURCE: '0', MBRG_LIMIT_CREATE_ALL: '0', MBRG_LIMIT_CREATE_SOURCE: '0', MBRG_MAX_PLAYERS: '0', MBRG_PORT: 'x' })).toStrictEqual([
      'MBRG_PORT', 'MBRG_MAX_PLAYERS', 'MBRG_LIMIT_CREATE_SOURCE', 'MBRG_LIMIT_CREATE_ALL', 'MBRG_LIMIT_JOIN_SOURCE', 'MBRG_LIMIT_JOIN_MATCH', 'MBRG_TRUSTED_PROXY_HOPS',
    ]);
  });

  it('the older settings alone give a service with public creation off, and the service accepts them', () => {
    const settings = settingsOf({ MBRG_DATABASE: ':memory:' });
    expect(settings.publicCreation.maps).toStrictEqual([]);
    const store = openStore(':memory:');
    try {
      expect(() => createMatchService({ store, clock: fakeClock(0), maps: createMapCatalog({}), settings })).not.toThrow();
    } finally {
      store.close();
    }
  });
});
