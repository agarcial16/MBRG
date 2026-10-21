import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitment, hmacSha256, newSecret, roundMessage, roundSeed, secretHex } from '../src/secret';

// FR-252 (plan section 5, D5): the match secret, its commitment and the per-round seeds. Every vector
// below is a published verification rule: an accidental change of the message format must fail here.
// Test vectors only; no real secret lives in the repository.

const bytes = (hex: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(hex, 'hex'));
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const ascii = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(s, 'ascii'));

/** Independent HMAC-SHA-256 (RFC 2104) built only on the SHA-256 digest, so the helper is not checked against itself. */
const sha = (b: Uint8Array): Buffer => createHash('sha256').update(b).digest();
const referenceHmac = (key: Uint8Array, message: Uint8Array): Buffer => {
  const block = Buffer.alloc(64);
  Buffer.from(key.length > 64 ? sha(key) : key).copy(block);
  const inner = Buffer.from(block.map((x) => x ^ 0x36));
  const outer = Buffer.from(block.map((x) => x ^ 0x5c));
  return sha(Buffer.concat([outer, sha(Buffer.concat([inner, message]))]));
};

const ROUNDS = [1, 2, 3, 4, 70, 255, 256, 65536, 2 ** 31 - 1] as const;
const VECTORS = [
  {
    name: 'ascending 0x00..0x1f',
    secret: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    commitment: '630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd',
    seeds: [3730603940, 4041377160, 3246583532, 361591214, 330976203, 4102238281, 1145199622, 42669804, 282600578],
  },
  {
    name: 'all zero bytes',
    secret: '00'.repeat(32),
    commitment: '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925',
    seeds: [3044441274, 3888933099, 964923794, 393762810, 2971010331, 1531350510, 4055738953, 3827221320, 3511957144],
  },
  {
    name: 'all 0xff bytes',
    secret: 'ff'.repeat(32),
    commitment: 'af9613760f72635fbdb44a5a0a63c39f12af30f950a6ee5c971be188e89c4051',
    seeds: [3028213467, 3576340473, 4063158593, 2448653898, 2258191618, 1275772643, 946020800, 582870589, 2063926640],
  },
  {
    name: 'stride (7i + 3) mod 256',
    secret: '030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dc',
    commitment: 'ab5f8b5cb9435354c7b58603592d5faf081e17ceb05f7a7c67f4b666f12ca457',
    seeds: [653424720, 2430403709, 1068615171, 440398765, 793548414, 59822314, 523934687, 2718293753, 3048376513],
  },
  {
    name: 'SHA-256 of a label',
    secret: 'f92b7846f0072b79f2a43741d5b610325445b84ce201bd135c23828844f07c50',
    commitment: 'e39851f07a03831d8d564b525caef583d0f918c45ef7f9c27f69a6130ec422f3',
    seeds: [2973356786, 2090830839, 1804641082, 3147624305, 4194125813, 105954697, 23351373, 3901662088, 3575152640],
  },
] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HMAC-SHA-256 primitive', () => {
  it('FR-252 matches RFC 4231 test case 2 (key "Jefe")', () => {
    const mac = hmacSha256(ascii('Jefe'), ascii('what do ya want for nothing?'));
    expect(hex(mac)).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });

  it('FR-252 the independent reference built on SHA-256 agrees with the helper and RFC 4231', () => {
    expect(hex(referenceHmac(ascii('Jefe'), ascii('what do ya want for nothing?')))).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
    const key = bytes('00'.repeat(32));
    expect(hex(hmacSha256(key, ascii('abc')))).toBe(hex(referenceHmac(key, ascii('abc'))));
  });
});

describe('round message', () => {
  it('FR-252 is the ASCII text mbrg/round-seed/v1/<k> in plain decimal', () => {
    expect(Buffer.from(roundMessage(1)).toString('latin1')).toBe('mbrg/round-seed/v1/1');
    expect(Buffer.from(roundMessage(70)).toString('latin1')).toBe('mbrg/round-seed/v1/70');
    expect(hex(roundMessage(1))).toBe(hex(ascii('mbrg/round-seed/v1/1')));
    expect(hex(roundMessage(70))).toBe(hex(ascii('mbrg/round-seed/v1/70')));
    expect(Buffer.from(roundMessage(2 ** 31 - 1)).toString('latin1')).toBe('mbrg/round-seed/v1/2147483647');
    expect(Buffer.from(roundMessage(65536)).toString('latin1')).toBe('mbrg/round-seed/v1/65536');
  });

  it('FR-252 rejects k = 0, -1, 1.5, 2^31, NaN, Infinity, -0 and text', () => {
    for (const bad of [0, -1, 1.5, 2 ** 31, 2 ** 32, Number.NaN, Number.POSITIVE_INFINITY, -0, '1', '', null, undefined, 1n, [1]]) {
      expect(() => roundMessage(bad as number), String(bad)).toThrow();
      expect(() => roundSeed(new Uint8Array(32), bad as number), String(bad)).toThrow();
    }
  });
});

describe('round seeds: known answers', () => {
  for (const v of VECTORS) {
    it(`FR-252 ${v.name}: commitment and seeds for rounds ${ROUNDS.join(', ')}`, () => {
      const secret = bytes(v.secret);
      expect(secret).toHaveLength(32);
      expect(commitment(secret)).toBe(v.commitment);
      ROUNDS.forEach((k, i) => {
        expect(roundSeed(secret, k), `k=${k}`).toBe(v.seeds[i]);
      });
    });
  }

  it('FR-252 the pinned vectors agree with createHmac and with the independent reference', () => {
    for (const v of VECTORS) {
      const secret = bytes(v.secret);
      ROUNDS.forEach((k, i) => {
        const message = ascii(`mbrg/round-seed/v1/${k}`);
        const viaNode = createHmac('sha256', secret).update(message).digest();
        const viaReference = referenceHmac(secret, message);
        expect(viaNode.readUInt32BE(0), `${v.name} k=${k}`).toBe(v.seeds[i]);
        expect(viaReference.readUInt32BE(0), `${v.name} k=${k}`).toBe(v.seeds[i]);
      });
      expect(createHash('sha256').update(secret).digest('hex')).toBe(v.commitment);
    }
  });

  it('FR-252 secret 0x00..0x1f at k = 1, 2, 3, 4, 70, 2^31-1 is equal through createHmac and Web Crypto subtle.sign', async () => {
    const secret = bytes(VECTORS[0].secret);
    const key = await globalThis.crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    for (const k of [1, 2, 3, 4, 70, 2 ** 31 - 1]) {
      const message = ascii(`mbrg/round-seed/v1/${k}`);
      const web = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, message));
      const node = createHmac('sha256', secret).update(message).digest();
      expect(hex(web), `k=${k}`).toBe(node.toString('hex'));
      expect(new DataView(web.buffer, web.byteOffset, 4).getUint32(0, false), `k=${k}`).toBe(roundSeed(secret, k));
    }
  });

  it('FR-252 the seed is the first 4 bytes read big-endian, unsigned', () => {
    const secret = bytes(VECTORS[0].secret);
    const mac = createHmac('sha256', secret).update(roundMessage(1)).digest();
    expect(mac.readUInt32BE(0)).toBe(3730603940);
    expect(mac.readUInt32LE(0)).not.toBe(3730603940);
    expect(roundSeed(secret, 1)).toBe(mac.readUInt32BE(0));
    // a value above 2^31 stays positive: no signed 32-bit conversion
    expect(roundSeed(secret, 1)).toBeGreaterThan(2 ** 31);
    expect(roundSeed(secret, 2)).toBeGreaterThan(2 ** 31);
  });

  it('FR-252 every seed is an integer in 0..2^32-1', () => {
    for (let n = 0; n < 8; n += 1) {
      const secret = Uint8Array.from({ length: 32 }, (_, i) => (i * 13 + n * 101 + 5) % 256);
      for (const k of [1, 2, 3, 100, 255, 256, 257, 65536, 2 ** 31 - 1]) {
        const s = roundSeed(secret, k);
        expect(Number.isInteger(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(0xffffffff);
      }
    }
  });
});

describe('secret and commitment', () => {
  it('FR-252 a secret of 31 or 33 bytes (or not bytes) is rejected everywhere', () => {
    for (const len of [0, 16, 31, 33, 64]) {
      const bad = new Uint8Array(len);
      expect(() => roundSeed(bad, 1), `len ${len}`).toThrow();
      expect(() => commitment(bad), `len ${len}`).toThrow();
      expect(() => secretHex(bad), `len ${len}`).toThrow();
    }
    expect(() => commitment('00'.repeat(32) as unknown as Uint8Array)).toThrow();
    expect(() => roundSeed(null as unknown as Uint8Array, 1)).toThrow();
  });

  it('FR-252 the commitment is SHA-256 hex (64 lowercase characters) of the raw bytes, not of their hex text', () => {
    const secret = bytes(VECTORS[0].secret);
    const c = commitment(secret);
    expect(c).toMatch(/^[0-9a-f]{64}$/);
    expect(c).toBe(createHash('sha256').update(secret).digest('hex'));
    expect(c).not.toBe(createHash('sha256').update(VECTORS[0].secret).digest('hex'));
  });

  it('FR-252 the reveal is the 64 lowercase hex characters of the raw bytes', () => {
    expect(secretHex(bytes(VECTORS[0].secret))).toBe(VECTORS[0].secret);
    expect(secretHex(bytes('AB'.repeat(32)))).toBe('ab'.repeat(32));
  });

  it('FR-252 the seed uses the raw key bytes, not their hex text', () => {
    const secret = bytes(VECTORS[0].secret);
    const asText = createHmac('sha256', VECTORS[0].secret).update(roundMessage(1)).digest().readUInt32BE(0);
    expect(roundSeed(secret, 1)).not.toBe(asText);
  });
});

describe('newSecret', () => {
  it('FR-252 takes exactly 32 bytes from the injected source and never touches the platform source', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const requested: number[] = [];
    const source = (length: number): Uint8Array => {
      requested.push(length);
      return Uint8Array.from({ length }, (_, i) => 255 - i);
    };
    const secret = newSecret(source);
    expect(requested).toStrictEqual([32]);
    expect(secret).toHaveLength(32);
    expect(Array.from(secret)).toStrictEqual(Array.from({ length: 32 }, (_, i) => 255 - i));
    expect(spy).not.toHaveBeenCalled();
    expect(commitment(secret)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('FR-252 the result is a private copy of what the source returned', () => {
    const shared = new Uint8Array(32).fill(7);
    const secret = newSecret(() => shared);
    shared.fill(9);
    expect(Array.from(secret)).toStrictEqual(new Array(32).fill(7));
  });

  it('FR-252 a source that returns other than 32 bytes is rejected', () => {
    for (const len of [0, 16, 31, 33]) {
      expect(() => newSecret(() => new Uint8Array(len)), `len ${len}`).toThrow();
    }
    expect(() => newSecret((() => 'x'.repeat(32)) as unknown as () => Uint8Array)).toThrow();
  });

  it('FR-252 without a source it asks the platform CSPRNG once for 32 bytes', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const a = newSecret();
    const b = newSecret();
    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) expect((call[0] as Uint8Array).length).toBe(32);
    expect(a).toHaveLength(32);
    expect(b).toHaveLength(32);
    expect(hex(a)).not.toBe(hex(b));
  });
});

describe('determinism and independence', () => {
  it('FR-252 same secret and k give the same seed; no clock and no Math.random are read', () => {
    const secret = bytes(VECTORS[4].secret);
    const forbid = (name: string) => () => {
      throw new Error(`${name} must not be read`);
    };
    vi.spyOn(Date, 'now').mockImplementation(forbid('Date.now'));
    vi.spyOn(Math, 'random').mockImplementation(forbid('Math.random'));
    vi.spyOn(performance, 'now').mockImplementation(forbid('performance.now'));
    const first = ROUNDS.map((k) => roundSeed(secret, k));
    const second = ROUNDS.map((k) => roundSeed(secret, k));
    expect(second).toStrictEqual(first);
    expect(commitment(secret)).toBe(VECTORS[4].commitment);
    expect(newSecret(() => new Uint8Array(32))).toHaveLength(32);
  });

  it('FR-252 the seed of round k does not depend on other rounds or on call order', () => {
    const secret = bytes(VECTORS[3].secret);
    const forward = ROUNDS.map((k) => roundSeed(secret, k));
    const backward = [...ROUNDS].reverse().map((k) => roundSeed(secret, k)).reverse();
    expect(backward).toStrictEqual(forward);
  });

  it('FR-252 does not change or keep the secret bytes it is given', () => {
    const secret = bytes(VECTORS[1].secret);
    const before = hex(secret);
    roundSeed(secret, 5);
    commitment(secret);
    secretHex(secret);
    expect(hex(secret)).toBe(before);
  });

  it('FR-252 distinct secrets give distinct seed streams (smoke over 200 secrets)', () => {
    const streams = new Set<string>();
    const commitments = new Set<string>();
    for (let n = 0; n < 200; n += 1) {
      const secret = newSecret((length) => Uint8Array.from({ length }, (_, i) => (n >> (i % 8)) + i * (n + 1)));
      streams.add(Array.from({ length: 8 }, (_, i) => roundSeed(secret, i + 1)).join(','));
      commitments.add(commitment(secret));
    }
    expect(streams.size).toBe(200);
    expect(commitments.size).toBe(200);
  });

  it('FR-252 consecutive rounds of one secret give distinct seeds (smoke over 1000 rounds)', () => {
    const secret = bytes(VECTORS[2].secret);
    const seen = new Set<number>();
    for (let k = 1; k <= 1000; k += 1) seen.add(roundSeed(secret, k));
    expect(seen.size).toBe(1000);
  });
});

describe('module hygiene', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/secret.ts', import.meta.url)), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('FR-252 secret.ts reads no clock and no Math.random', () => {
    for (const word of [/\bDate\b/, /Math\s*\.\s*random/, /\bperformance\b/, /\bhrtime\b/, /\bsetTimeout\b/, /\bsetInterval\b/]) {
      expect(code, String(word)).not.toMatch(word);
    }
  });

  it('FR-252 secret.ts imports only node:crypto: not main, warnings or the filesystem', () => {
    const specifiers = [...code.matchAll(/(?:from|import\s*\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(specifiers).toStrictEqual(['node:crypto']);
  });

  it('FR-252 secret.ts never logs or prints', () => {
    for (const word of [/\bconsole\b/, /process\s*\.\s*std/, /\bprocess\b/]) {
      expect(code, String(word)).not.toMatch(word);
    }
  });
});
