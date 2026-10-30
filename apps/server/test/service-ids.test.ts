import { describe, expect, it } from 'vitest';
import { HOST_TOKEN_BYTES, MATCH_ID_BYTES, newHostToken, newMatchId, newPlayerLocalId, newPlayerToken, PLAYER_ID_BYTES, PLAYER_TOKEN_BYTES } from '../src/service/ids';
import { newSecret } from '../src/secret';
import { fakeRandom } from './helpers/fake-random';

// Identifiers of a player who joins by name (spec 011 plan P7, P9): a token of 32 random bytes and a local id of 9, each its
// own draw of the random source, independent of the secret, the match id and the host token.

/** A source that records the length of every draw and returns a fresh run of distinct bytes each time. */
const recording = (): { random: (length: number) => Uint8Array; asked: number[]; drawn: Uint8Array[] } => {
  const asked: number[] = [];
  const drawn: Uint8Array[] = [];
  let counter = 0;
  const random = (length: number): Uint8Array => {
    asked.push(length);
    const bytes = Uint8Array.from({ length }, (_, i) => (counter * 37 + i * 3 + 1) % 256);
    counter += 1;
    drawn.push(bytes);
    return bytes;
  };
  return { random, asked, drawn };
};

describe('player identifiers', () => {
  it('the sizes are 32 bytes for a token and 9 bytes for a local id', () => {
    expect(PLAYER_TOKEN_BYTES).toBe(32);
    expect(PLAYER_ID_BYTES).toBe(9);
  });

  it('a player token is 43 base64url characters from exactly 32 drawn bytes, one draw per value', () => {
    const { random, asked } = recording();
    const token = newPlayerToken(random);
    expect(asked).toStrictEqual([32]);
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).toBe(Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 3 + 1) % 256)).toString('base64url'));
  });

  it('a local id is 12 characters of the identifier set from exactly 9 drawn bytes, one draw per value', () => {
    const { random, asked } = recording();
    const local = newPlayerLocalId(random);
    expect(asked).toStrictEqual([9]);
    expect(local).toHaveLength(12);
    expect(local).toMatch(/^[A-Za-z0-9_.-]{12}$/);
    expect(local).toBe(Buffer.from(Array.from({ length: 9 }, (_, i) => (i * 3 + 1) % 256)).toString('base64url'));
  });

  it('the token, the local id, the secret, the match id and the host token are five distinct draws of the one source', () => {
    const { random, asked, drawn } = recording();
    const values = [newPlayerToken(random), newPlayerLocalId(random), newMatchId(random), newHostToken(random)];
    const secret = newSecret(random);
    expect(asked).toStrictEqual([PLAYER_TOKEN_BYTES, PLAYER_ID_BYTES, MATCH_ID_BYTES, HOST_TOKEN_BYTES, 32]);
    expect(new Set(values).size).toBe(4);
    expect(new Set(drawn.map((d) => Buffer.from(d).toString('hex'))).size).toBe(5);
    expect(Buffer.from(secret).toString('hex')).toBe(Buffer.from(drawn[4]!).toString('hex'));
    // A token is not made from any other value: it shares no 16-character run with the host token or the match id.
    expect(values[0]!.slice(0, 16)).not.toBe(values[3]!.slice(0, 16));
  });

  it('a value is the same whatever was drawn before: two fresh sources give equal tokens, and the order of draws moves them', () => {
    const a = fakeRandom(11);
    const b = fakeRandom(11);
    expect(newPlayerToken(a)).toBe(newPlayerToken(b));
    const c = fakeRandom(11);
    newMatchId(c);
    expect(newPlayerToken(c)).not.toBe(newPlayerToken(fakeRandom(11)));
  });

  it('over many draws every token and local id is in the character set and none repeats', () => {
    const random = fakeRandom(23);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const token = newPlayerToken(random);
      const local = newPlayerLocalId(random);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(local).toMatch(/^[A-Za-z0-9_-]{12}$/);
      seen.add(token);
      seen.add(local);
    }
    expect(seen.size).toBe(600);
  });

  it('a source that returns the wrong number of bytes is refused for both values', () => {
    expect(() => newPlayerToken(() => new Uint8Array(31))).toThrow(RangeError);
    expect(() => newPlayerToken(() => new Uint8Array(33))).toThrow(RangeError);
    expect(() => newPlayerLocalId(() => new Uint8Array(8))).toThrow(RangeError);
    expect(() => newPlayerLocalId(() => new Uint8Array(10))).toThrow(RangeError);
  });
});
