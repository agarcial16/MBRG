import { canonicalBody } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { parseBodyBytes, repeatsMember } from '../src/http/body';
import { sha256Ascii } from '../src/service/ids';

// Spec 018 FR-490: a repeated `joinPolicy` member exists only in the raw text (JSON.parse keeps the last one), so the body
// stage looks for it by name, at the top level of the object only.

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('the repeated member scan', () => {
  it('FR-490 finds a member named twice at the top level and nothing else', () => {
    expect(repeatsMember('{"a":1,"joinPolicy":"x","b":2,"joinPolicy":"y"}', 'joinPolicy')).toBe(true);
    expect(repeatsMember('{"joinPolicy":"x","joinPolicy":"x"}', 'joinPolicy')).toBe(true);
    expect(repeatsMember('{"joinPolicy":"x"}', 'joinPolicy')).toBe(false);
    expect(repeatsMember('{}', 'joinPolicy')).toBe(false);
  });

  it('FR-490 the name in a value, in a nested object, in an array or with an escape is not a repeated member', () => {
    expect(repeatsMember('{"a":"joinPolicy","b":"joinPolicy","joinPolicy":1}', 'joinPolicy')).toBe(false);
    expect(repeatsMember('{"n":{"joinPolicy":1,"joinPolicy":2},"joinPolicy":3}', 'joinPolicy')).toBe(false);
    expect(repeatsMember('{"n":[{"joinPolicy":1},{"joinPolicy":2}],"joinPolicy":3}', 'joinPolicy')).toBe(false);
    expect(repeatsMember('{"a":"x\\"joinPolicy\\":","joinPolicy":1}', 'joinPolicy')).toBe(false);
    // An escaped spelling of the name is the same member after parsing.
    expect(repeatsMember('{"joinPolicy":1,"joinPolic\\u0079":2}', 'joinPolicy')).toBe(true);
  });

  it('FR-490 the body parser answers invalid-request naming joinPolicy for a repeated member and parses any other body as before', () => {
    expect(parseBodyBytes(bytes('{"joinPolicy":"open","joinPolicy":"client"}'))).toMatchObject({ kind: 'error', error: { kind: 'invalid-request', items: ['joinPolicy'] } });
    expect(parseBodyBytes(bytes('{"a":1,"a":2}'))).toStrictEqual({ kind: 'body', value: { a: 2 } });
    expect(parseBodyBytes(bytes('{"joinPolicy":"client"}'))).toStrictEqual({ kind: 'body', value: { joinPolicy: 'client' } });
  });
});

// Spec 024 FR-546: the community key is refused by name when the text names it twice, whatever the two values are.
const KEY_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const KEY_B = 'f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f';

describe('the community member of a creation body (spec 024)', () => {
  it('FR-546 a repeated community member is invalid-request naming community, equal values included', () => {
    for (const text of [`{"community":"${KEY_A}","community":"${KEY_B}"}`, `{"community":"${KEY_A}","a":1,"community":"${KEY_A}"}`]) {
      expect(parseBodyBytes(bytes(text))).toMatchObject({ kind: 'error', error: { kind: 'invalid-request', items: ['community'] } });
    }
    expect(repeatsMember(`{"community":"${KEY_A}","joinPolicy":"client"}`, 'community')).toBe(false);
  });

  it('FR-546 a single community member, or the name inside a value, parses as before', () => {
    expect(parseBodyBytes(bytes(`{"community":"${KEY_A}"}`))).toStrictEqual({ kind: 'body', value: { community: KEY_A } });
    expect(parseBodyBytes(bytes('{"a":"community","community":1}'))).toStrictEqual({ kind: 'body', value: { a: 'community', community: 1 } });
  });

  it('FR-546 a repeated joinPolicy is still named first and a body without community is parsed as on main', () => {
    expect(parseBodyBytes(bytes('{"joinPolicy":"open","joinPolicy":"client"}'))).toMatchObject({ kind: 'error', error: { items: ['joinPolicy'] } });
    expect(parseBodyBytes(bytes('{"mapId":"dev","timing":"manual","requestId":"r"}'))).toStrictEqual({ kind: 'body', value: { mapId: 'dev', timing: 'manual', requestId: 'r' } });
  });

  it('NFR-120 (part: creation body digest) a body without the key keeps the canonical text and the SHA-256 digest pinned from main', () => {
    const manual = { mapId: 'dev', timing: 'manual', requestId: 'r-1' };
    const timed = { mapId: 'dev', timing: { i: 120, l1: 30, l2: 10 }, requestId: 'r-2' };
    expect(canonicalBody('POST', '/matches', manual)).toBe('"POST" "/matches" {"mapId":"dev","timing":"manual"}');
    expect(sha256Ascii(canonicalBody('POST', '/matches', manual))).toBe('143c350b8bb4f2961dbc6b221d3fbdbd102df47d6d6708b1cfb792a910404b56');
    expect(sha256Ascii(canonicalBody('POST', '/matches', timed))).toBe('85313dcb37610e784a0bcca6f086d90ac742f1eb063a47be06022db1c877c070');
    expect(sha256Ascii(canonicalBody('POST', '/matches', { ...manual, community: KEY_A }))).not.toBe(sha256Ascii(canonicalBody('POST', '/matches', manual)));
  });
});
