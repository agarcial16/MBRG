import { describe, expect, it } from 'vitest';
import { createMatchService } from '../src/service/matches';
import { createMapCatalog } from '../src/service/maps';
import {
  CONNECTION_OPTIONS,
  DEFAULT_HOST,
  DEFAULT_LIMITS,
  DEFAULT_PORT,
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
  it('FR-299 (stream limits) FR-260 the 16 variables read are exactly the plan list, in order, and none can set a round-seed source', () => {
    expect(SETTING_VARIABLES).toStrictEqual([
      'MBRG_OPERATOR_CREDENTIAL', 'MBRG_MAPS', 'MBRG_MAX_RUNNING_MATCHES', 'MBRG_DATABASE', 'MBRG_CLIENTS',
      'MBRG_ALLOWED_ORIGINS', 'MBRG_HOST', 'MBRG_PORT', 'MBRG_LIMIT_COMMANDS', 'MBRG_LIMIT_READS',
      'MBRG_LIMIT_SUBMISSIONS', 'MBRG_LIMIT_ADVANCES', 'MBRG_LIMIT_ANONYMOUS', 'MBRG_LIMIT_STREAMS', 'MBRG_LIMIT_ANONYMOUS_STREAMS',
      'MBRG_FORCED_PHASE_SECONDS',
    ]);
    expect(SETTING_VARIABLES.filter((name) => /seed|random|source/i.test(name))).toStrictEqual([]);
  });

  it('FR-299 (b) the defaults: no clients, no origins, 127.0.0.1:8787, limits 600 / 1,200 / 30 / 30 / 120 per minute, 50 and 5 open streams', () => {
    expect(settingsOf({})).toStrictEqual({
      operatorCredential: OPERATOR,
      maps: { dev: 'maps/dev' },
      runningMatchLimit: 20,
      databasePath: 'mbrg.sqlite',
      forcedPhaseSeconds: 5,
      clients: [],
      allowedOrigins: [],
      host: '127.0.0.1',
      port: 8787,
      limits: { commands: 600, reads: 1200, submissions: 30, advances: 30, anonymous: 120, streams: 50, anonymousStreams: 5 },
    });
    expect(DEFAULT_HOST).toBe('127.0.0.1');
    expect(DEFAULT_PORT).toBe(8787);
    expect(DEFAULT_LIMITS).toStrictEqual({ commands: 600, reads: 1200, submissions: 30, advances: 30, anonymous: 120, streams: 50, anonymousStreams: 5 });
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
    expect(raised.limits).toStrictEqual({ commands: 1000000, reads: 999999, submissions: 1, advances: 77, anonymous: 4321, streams: 1000000, anonymousStreams: 1 });
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
