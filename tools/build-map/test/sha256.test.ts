import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/importer/sha256';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('the own SHA-256', () => {
  it('passes the NIST vectors: the empty input, abc, and the two-block message', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(bytes('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(bytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('passes the long-message form: one million a characters', () => {
    expect(sha256Hex(new Uint8Array(1_000_000).fill(97))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  }, 30000);

  it('gives the same digest twice for the same bytes, over the padding boundaries', () => {
    for (const length of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
      const input = new Uint8Array(length);
      for (let i = 0; i < length; i++) input[i] = (i * 7 + 3) & 0xff;
      const first = sha256Hex(input);
      expect(first, `length ${length}`).toBe(sha256Hex(input));
      expect(first).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
