import { describe, expect, it } from 'vitest';
import { digestAvailable, sha256Hex } from '../src/ui/web-crypto';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('NFR-25 (digest function) the browser digest of bytes', () => {
  it('NFR-25 (digest function) sha256Hex gives the known vectors in lower case hex', async () => {
    expect(await sha256Hex(bytes(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex(bytes('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex(bytes('The quick brown fox jumps over the lazy dog'))).toBe('d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
  });

  it('NFR-25 (digest function) the digest covers exactly the bytes of a view, not the buffer behind it', async () => {
    const whole = bytes('xxabcxx');
    const view = whole.subarray(2, 5);
    expect(await sha256Hex(view)).toBe(await sha256Hex(bytes('abc')));
    expect(await sha256Hex(view)).not.toBe(await sha256Hex(whole));
  });

  it('NFR-25 (digest function) a different byte gives a different digest', async () => {
    expect(await sha256Hex(bytes('abd'))).not.toBe(await sha256Hex(bytes('abc')));
  });

  it('NFR-25 (digest function) the digest is available when the platform has a digest function and not otherwise', () => {
    expect(digestAvailable()).toBe(true);
    const fake = { subtle: { digest: () => Promise.resolve(new ArrayBuffer(32)) } };
    expect(digestAvailable(fake)).toBe(true);
    expect(digestAvailable({})).toBe(false);
    expect(digestAvailable({ subtle: undefined })).toBe(false);
    expect(digestAvailable({ subtle: {} } as never)).toBe(false);
    expect(digestAvailable(null as never)).toBe(false);
  });

  it('NFR-25 (digest function) with no digest function the hash refuses instead of giving a value (fail closed)', async () => {
    await expect(sha256Hex(bytes('abc'), {})).rejects.toThrow('no digest function');
    await expect(sha256Hex(bytes('abc'), { subtle: {} } as never)).rejects.toThrow('no digest function');
  });

  it('NFR-25 (digest function) the injected platform is the one used', async () => {
    const seen: unknown[] = [];
    const platform = {
      subtle: {
        digest: (algorithm: string, data: BufferSource) => {
          seen.push(algorithm, data);
          return Promise.resolve(Uint8Array.of(1, 2, 171).buffer);
        },
      },
    };
    expect(await sha256Hex(bytes('q'), platform)).toBe('0102ab');
    expect(seen[0]).toBe('SHA-256');
  });
});
