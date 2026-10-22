import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CREDENTIAL_PREFIX, credentialDigest, newHostToken, newMatchId, sameDigest, sha256Ascii, sha256Bytes } from '../src/service/ids';
import { createMapCatalog } from '../src/service/maps';
import { DEFAULT_RUNNING_MATCH_LIMIT, SETTING_VARIABLES, readSettings } from '../src/service/settings';
import { DEV_DIR, devMap, mapDigest } from './helpers/digests';
import { fakeRandom } from './helpers/fake-random';
import { withTempDir, writeMapPackage } from './helpers/service-harness';

// Units of the lifecycle service: identifiers (FR-236), credential digests (FR-300 (digests), NFR-54 (store)), the map list
// (FR-232 `unknown-map`, FR-235 digest) and the settings (FR-232 limit, FR-260 no seed setting).

const DEV_MAP_TEXT = readFileSync(DEV_DIR + 'map.json', 'utf8');
const devFolder = DEV_DIR.replace(/[\\/]$/, '');

describe('identifiers', () => {
  it('FR-236 a match id is 16 base64url characters from 12 bytes and a host token 43 from 32, each its own draw', () => {
    const asked: number[] = [];
    const random = (length: number): Uint8Array => {
      asked.push(length);
      return Uint8Array.from({ length }, (_, i) => i);
    };
    expect(newMatchId(random)).toBe('AAECAwQFBgcICQoL');
    expect(asked).toStrictEqual([12]);
    const token = newHostToken(random);
    expect(asked).toStrictEqual([12, 32]);
    expect(token).toBe(Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64url'));
    expect(token).toHaveLength(43);
  });

  it('FR-236 every id and token is in the credential character set, with no padding, over many draws', () => {
    const random = fakeRandom(7);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = newMatchId(random);
      const token = newHostToken(random);
      expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seen.add(id);
      seen.add(token);
    }
    expect(seen.size).toBe(400);
  });

  it('FR-236 a source that returns the wrong number of bytes is refused', () => {
    expect(() => newMatchId(() => new Uint8Array(11))).toThrow(RangeError);
    expect(() => newHostToken(() => new Uint8Array(33))).toThrow(RangeError);
  });

  it('FR-300 (digests) a credential digest is sha256 of the versioned prefix and the text', () => {
    expect(CREDENTIAL_PREFIX).toBe('mbrg/credential/v1/');
    expect(credentialDigest('abc')).toBe('3797ff864ba4c75c49f1336ca8dd86b72a514c2139c5c64f1868f9facfd5fbf2');
    expect(credentialDigest('')).toBe('efc98e1756a456112fdf7c3252df1df231c1cfad894b71816551f5e23b1028b0');
    expect(credentialDigest('abc')).toBe(createHash('sha256').update('mbrg/credential/v1/abc').digest('hex'));
    expect(credentialDigest('abc')).not.toBe(createHash('sha256').update('abc').digest('hex'));
    expect(credentialDigest('é')).toBe(createHash('sha256').update(Buffer.from('mbrg/credential/v1/é', 'utf8')).digest('hex'));
  });

  it('FR-300 (digests) digests compare equal only to themselves and anything that is not a digest never matches', () => {
    const a = credentialDigest('one');
    expect(sameDigest(a, credentialDigest('one'))).toBe(true);
    expect(sameDigest(a, credentialDigest('two'))).toBe(false);
    expect(sameDigest(a, a.toUpperCase())).toBe(false);
    expect(sameDigest(a, a.slice(1))).toBe(false);
    expect(sameDigest('', '')).toBe(false);
    expect(sameDigest(undefined as unknown as string, a)).toBe(false);
  });

  it('FR-231 the hashes injected into the core are the platform SHA-256', () => {
    expect(sha256Ascii('classic;0;1:2')).toBe(createHash('sha256').update('classic;0;1:2', 'ascii').digest('hex'));
    expect(sha256Bytes(Uint8Array.from([1, 2, 3]))).toBe(createHash('sha256').update(Buffer.from([1, 2, 3])).digest('hex'));
  });
});

describe('map list', () => {
  it('FR-232 (unknown-map) the catalog lists the settings maps and knows no other id, not even an inherited name', () => {
    const catalog = createMapCatalog({ dev: devFolder });
    expect(catalog.ids()).toStrictEqual(['dev']);
    expect(catalog.load('dev')).toBeDefined();
    for (const id of ['other', '', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(catalog.load(id), id).toBeUndefined();
  });

  it('FR-235 the map digest of a listed package is the SHA-256 of the canonical bytes of its three files (the recorded dev digest)', () => {
    const loaded = createMapCatalog({ dev: devFolder }).load('dev');
    expect(loaded?.digest).toBe('4d1698a310b46a6507fd128dad87f20873065d44a71b2ee5a78c062eb5c1e679');
    expect(loaded?.digest).toBe(mapDigest());
    expect(loaded?.map).toStrictEqual(devMap());
  });

  it('FR-235 changing any one of the three files changes the digest', () =>
    withTempDir((dir) => {
      const base = writeMapPackage(dir, 'a', DEV_MAP_TEXT);
      const same = createMapCatalog({ a: base }).load('a');
      expect(same?.digest).toBe(mapDigest());
      const changed = writeMapPackage(dir, 'b', DEV_MAP_TEXT + ' ');
      expect(createMapCatalog({ b: changed }).load('b')?.digest).not.toBe(mapDigest());
    }));

  it('FR-232 (unknown-map) a listed folder that cannot be read gives no map and no digest, a file that is not JSON gives no map', () =>
    withTempDir((dir) => {
      expect(createMapCatalog({ gone: dir + '/missing' }).load('gone')).toStrictEqual({ map: null, digest: '' });
      const broken = writeMapPackage(dir, 'broken', '{ not json');
      const loaded = createMapCatalog({ broken }).load('broken');
      expect(loaded?.map).toBeNull();
      expect(loaded?.digest).toMatch(/^[0-9a-f]{64}$/);
    }));
});

describe('settings', () => {
  const env = { MBRG_OPERATOR_CREDENTIAL: 'secret-operator-value', MBRG_MAPS: '{"dev":"maps/dev","big":"maps/big"}' };

  it('FR-232 (running-match limit) the limit defaults to 20 and the settings carry the credential, the map list and the database path', () => {
    const read = readSettings(env);
    expect(read).toStrictEqual({
      ok: true,
      settings: { operatorCredential: 'secret-operator-value', maps: { dev: 'maps/dev', big: 'maps/big' }, runningMatchLimit: 20, databasePath: 'mbrg.sqlite' },
    });
    expect(DEFAULT_RUNNING_MATCH_LIMIT).toBe(20);
    expect(readSettings({ ...env, MBRG_MAX_RUNNING_MATCHES: '3', MBRG_DATABASE: ':memory:' })).toMatchObject({ ok: true, settings: { runningMatchLimit: 3, databasePath: ':memory:' } });
  });

  it('FR-232 (running-match limit) problems name the variable and never echo a value', () => {
    for (const [patch, name] of [
      [{ MBRG_OPERATOR_CREDENTIAL: '' }, 'MBRG_OPERATOR_CREDENTIAL'],
      [{ MBRG_MAPS: '{' }, 'MBRG_MAPS'],
      [{ MBRG_MAPS: '[]' }, 'MBRG_MAPS'],
      [{ MBRG_MAPS: '{}' }, 'MBRG_MAPS'],
      [{ MBRG_MAPS: '{"Bad Id":"x"}' }, 'MBRG_MAPS'],
      [{ MBRG_MAPS: '{"dev":3}' }, 'MBRG_MAPS'],
      [{ MBRG_MAX_RUNNING_MATCHES: '0' }, 'MBRG_MAX_RUNNING_MATCHES'],
      [{ MBRG_MAX_RUNNING_MATCHES: '2.5' }, 'MBRG_MAX_RUNNING_MATCHES'],
      [{ MBRG_MAX_RUNNING_MATCHES: 'many' }, 'MBRG_MAX_RUNNING_MATCHES'],
    ] as const) {
      const read = readSettings({ ...env, ...patch });
      expect(read.ok, name).toBe(false);
      if (!read.ok) {
        expect(read.problems).toStrictEqual([name]);
        expect(JSON.stringify(read)).not.toContain('secret-operator-value');
      }
    }
    expect(readSettings({})).toStrictEqual({ ok: false, problems: ['MBRG_OPERATOR_CREDENTIAL', 'MBRG_MAPS'] });
  });

  it('FR-260 the settings read only the listed variables and have no field for a round-seed source', () => {
    expect(SETTING_VARIABLES).toStrictEqual(['MBRG_OPERATOR_CREDENTIAL', 'MBRG_MAPS', 'MBRG_MAX_RUNNING_MATCHES', 'MBRG_DATABASE']);
    const plain = readSettings(env);
    const noisy = readSettings({
      ...env,
      MBRG_TEST_SEED_SOURCE: '1',
      MBRG_SEED_SOURCE: 'fixed',
      MBRG_ROUND_SEED: '5',
      TEST_SEED_SOURCE: '1',
      SEED_SOURCE: 'fixed',
      NODE_ENV: 'test',
    });
    expect(noisy).toStrictEqual(plain);
    expect(plain.ok && Object.keys(plain.settings).filter((k) => /seed|random|source/i.test(k))).toStrictEqual([]);
  });
});
