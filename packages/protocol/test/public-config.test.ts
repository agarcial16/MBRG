import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PUBLIC_CONFIG_KEYS, encodePublicConfig, readPublicConfig, type PublicConfig } from '../src/index';

interface Example {
  readonly name: string;
  readonly config: PublicConfig;
  readonly text: string;
  readonly sha256: string;
}
// The golden was made by hand (text typed, hash taken from the text, not from the encoder).
const GOLDEN = JSON.parse(readFileSync(new URL('./golden/config-014.json', import.meta.url), 'utf8')) as Example[];
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const BASE: PublicConfig = {
  maps: ['classic-eu', 'iberia'],
  minInterval: 31,
  maxInterval: 3601,
  minPhase1: 11,
  minPhase2: 6,
  maxPlayers: 201,
  enabled: true,
};
const parsed = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>;
const withMember = (key: string, value: unknown): Record<string, unknown> => ({ ...BASE, [key]: value });
const without = (key: string): Record<string, unknown> => {
  const o: Record<string, unknown> = { ...BASE };
  delete o[key];
  return o;
};

describe('public config wire (spec 014)', () => {
  it('FR-416 the key list is the flat order of the public config', () => {
    expect([...PUBLIC_CONFIG_KEYS]).toStrictEqual(['maps', 'minInterval', 'maxInterval', 'minPhase1', 'minPhase2', 'maxPlayers', 'enabled']);
  });

  it('FR-416 the golden holds the three fixed examples', () => {
    expect(GOLDEN.map((e) => e.name)).toStrictEqual(['one map, defaults', 'three maps, custom bounds', 'disabled, bounds present']);
    expect(GOLDEN[0]!.config.maps).toStrictEqual(['classic-eu']);
    expect(GOLDEN[1]!.config.maps).toHaveLength(3);
    expect(GOLDEN[2]!.config.maps).toStrictEqual([]);
    expect(GOLDEN[2]!.config.enabled).toBe(false);
  });

  it.each([0, 1, 2])('FR-416 example %i encodes to exactly the canonical text of the golden', (i) => {
    const e = GOLDEN[i]!;
    expect(encodePublicConfig(e.config)).toBe(e.text);
  });

  it('FR-416 the canonical text of the first example is the literal of plan section 2 (key order, no whitespace, whole numbers)', () => {
    expect(encodePublicConfig(GOLDEN[0]!.config)).toBe(
      '{"maps":["classic-eu"],"minInterval":30,"maxInterval":3600,"minPhase1":10,"minPhase2":5,"maxPlayers":200,"enabled":true}',
    );
    expect(encodePublicConfig(GOLDEN[2]!.config)).toBe(
      '{"maps":[],"minInterval":30,"maxInterval":3600,"minPhase1":10,"minPhase2":5,"maxPlayers":200,"enabled":false}',
    );
  });

  it.each([0, 1, 2])('FR-416 example %i has the SHA-256 pinned in the golden', (i) => {
    const e = GOLDEN[i]!;
    expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256(encodePublicConfig(e.config))).toBe(e.sha256);
    expect(sha256(e.text)).toBe(e.sha256);
  });

  it('FR-416 the encoder writes the key order whatever the order of the input object', () => {
    const shuffled = {
      enabled: true,
      maxPlayers: 201,
      maps: ['classic-eu', 'iberia'],
      minPhase2: 6,
      minPhase1: 11,
      maxInterval: 3601,
      minInterval: 31,
    } as PublicConfig;
    expect(encodePublicConfig(shuffled)).toBe(encodePublicConfig(BASE));
    expect(Object.keys(parsed(encodePublicConfig(BASE)))).toStrictEqual([...PUBLIC_CONFIG_KEYS]);
  });

  it('FR-416 an encoded config reads back to the same value (round trip) and a fresh copy', () => {
    for (const e of GOLDEN) {
      const read = readPublicConfig(JSON.parse(encodePublicConfig(e.config)));
      expect(read).toStrictEqual({ ok: true, value: e.config });
    }
    const input = JSON.parse(encodePublicConfig(BASE)) as { maps: string[] };
    const read = readPublicConfig(input);
    expect(read.ok && read.value.maps).not.toBe(input.maps);
  });

  it('FR-416 a property added to the input never reaches the encoded text', () => {
    const extra = { ...BASE, operatorCredential: 'sentinel-secret-value' } as unknown as PublicConfig;
    let text: string | undefined;
    try {
      text = encodePublicConfig(extra);
    } catch (e) {
      expect(e).toBeInstanceOf(RangeError);
    }
    expect(text ?? '').not.toContain('sentinel-secret-value');
    expect(() => encodePublicConfig(extra)).toThrow(RangeError);
    const inherited = Object.create({ maxPlayers: 999 }, {}) as Record<string, unknown>;
    for (const k of PUBLIC_CONFIG_KEYS) if (k !== 'maxPlayers') inherited[k] = BASE[k];
    expect(() => encodePublicConfig(inherited as unknown as PublicConfig)).toThrow(RangeError);
  });

  it('FR-416 the encoder refuses a value out of shape', () => {
    for (const bad of [
      withMember('minInterval', 1.5),
      withMember('minInterval', 0),
      withMember('maxPlayers', -1),
      withMember('maxInterval', '3600'),
      withMember('minPhase1', null),
      withMember('enabled', 'true'),
      withMember('maps', 'iberia'),
      withMember('maps', ['Bad Id']),
      withMember('maps', ['iberia', 'iberia']),
      withMember('enabled', false),
      withMember('maps', []),
      without('maxPlayers'),
      null,
      [],
    ]) {
      expect(() => encodePublicConfig(bad as unknown as PublicConfig)).toThrow(RangeError);
    }
  });

  it('FR-416 the decoder reads the golden texts', () => {
    for (const e of GOLDEN) expect(readPublicConfig(JSON.parse(e.text))).toStrictEqual({ ok: true, value: e.config });
  });

  it('FR-416 the decoder refuses an unknown field, naming it', () => {
    expect(readPublicConfig({ ...BASE, extra: 1 })).toStrictEqual({ ok: false, field: 'extra' });
    expect(readPublicConfig({ ...BASE, zeta: 1, alpha: 1 })).toStrictEqual({ ok: false, field: 'alpha' });
  });

  it.each([...['maps', 'minInterval', 'maxInterval', 'minPhase1', 'minPhase2', 'maxPlayers', 'enabled']])(
    'FR-416 the decoder refuses a missing %s',
    (key) => {
      expect(readPublicConfig(without(key))).toStrictEqual({ ok: false, field: key });
    },
  );

  it('FR-416 the decoder refuses an inherited member', () => {
    const o = Object.create({ maxPlayers: 5 }, {}) as Record<string, unknown>;
    for (const k of PUBLIC_CONFIG_KEYS) if (k !== 'maxPlayers') o[k] = BASE[k];
    expect(readPublicConfig(o)).toStrictEqual({ ok: false, field: 'maxPlayers' });
  });

  it.each([
    ['float', 1.5],
    ['negative', -3],
    ['zero', 0],
    ['numeric string', '30'],
    ['null', null],
    ['NaN', Number.NaN],
    ['unsafe', 2 ** 60],
    ['boolean', true],
  ])('FR-416 the decoder refuses a %s in each number field', (_name, value) => {
    for (const key of ['minInterval', 'maxInterval', 'minPhase1', 'minPhase2', 'maxPlayers']) {
      expect(readPublicConfig(withMember(key, value)), key).toStrictEqual({ ok: false, field: key });
    }
  });

  it('FR-416 the decoder refuses a wrong type for enabled and for maps', () => {
    for (const v of ['true', 1, null, 0]) expect(readPublicConfig(withMember('enabled', v))).toStrictEqual({ ok: false, field: 'enabled' });
    for (const v of ['iberia', null, {}, 3, { 0: 'iberia', length: 1 }]) {
      expect(readPublicConfig(withMember('maps', v))).toStrictEqual({ ok: false, field: 'maps' });
    }
  });

  it('FR-416 the decoder refuses a map id of a bad shape, naming its place', () => {
    for (const id of ['', 'Iberia', 'a/b', 'a'.repeat(65), 'a b', 'a_b', 'ibéria', 7, null, 'iberia\n']) {
      expect(readPublicConfig(withMember('maps', ['classic-eu', id])), String(id)).toStrictEqual({ ok: false, field: 'maps[1]' });
    }
    expect(readPublicConfig(withMember('maps', ['a'.repeat(64)]))).toStrictEqual({ ok: true, value: { ...BASE, maps: ['a'.repeat(64)] } });
  });

  it('FR-416 the decoder refuses a duplicate map id', () => {
    expect(readPublicConfig(withMember('maps', ['iberia', 'europe', 'iberia']))).toStrictEqual({ ok: false, field: 'maps[2]' });
  });

  it('FR-416 the decoder refuses an enabled that disagrees with the map list', () => {
    expect(readPublicConfig(withMember('enabled', false))).toStrictEqual({ ok: false, field: 'enabled' });
    expect(readPublicConfig({ ...BASE, maps: [], enabled: true })).toStrictEqual({ ok: false, field: 'enabled' });
    expect(readPublicConfig({ ...BASE, maps: [], enabled: false })).toStrictEqual({ ok: true, value: { ...BASE, maps: [], enabled: false } });
  });

  it('FR-416 the decoder refuses a body that is not an object', () => {
    for (const v of [null, undefined, [], 'x', 3, true]) expect(readPublicConfig(v)).toStrictEqual({ ok: false, field: 'body' });
  });

  it('FR-416 the decoder accepts bounds that do not make sense together (it checks shape, not policy)', () => {
    expect(readPublicConfig({ ...BASE, minInterval: 9000, maxInterval: 5 }).ok).toBe(true);
  });
});
