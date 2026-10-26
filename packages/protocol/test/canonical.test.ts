import { describe, expect, it } from 'vitest';
import { MAP_FILE_NAMES, canonicalBody, mapDigestBytes, stateText } from '../src/index';

// Canonical forms of spec 008 (Definitions: state digest text, map digest bytes, same content of two commands).
// The protocol only produces the bytes or text; the SHA-256 digests are computed by callers.

const ascii = (bytes: Uint8Array, from = 0, to = bytes.length): string => String.fromCharCode(...bytes.subarray(from, to));
const codes = (text: string): number[] => text.split('').map((c) => c.charCodeAt(0));
const filesOf = (a: number[], b: number[], c: number[]) => ({
  'map.json': new Uint8Array(a),
  'ids.png': new Uint8Array(b),
  'presentation.json': new Uint8Array(c),
});

describe('state text', () => {
  it('FR-282 (canonical content) the state text is classic;<round>;<t>:<f>,... with no spaces', () => {
    expect(stateText({ mode: 'classic', round: 0, owners: [[1, 1], [2, 2], [3, 1]] })).toBe('classic;0;1:1,2:2,3:1');
    expect(stateText({ mode: 'classic', round: 12, owners: [[10, 4]] })).toBe('classic;12;10:4');
    expect(stateText({ mode: 'classic', round: 3, owners: [] })).toBe('classic;3;');
  });

  it('FR-282 (canonical content) a state with a negative, fractional or non-number value has no text', () => {
    expect(() => stateText({ mode: 'classic', round: -1, owners: [] })).toThrow(RangeError);
    expect(() => stateText({ mode: 'classic', round: 1.5, owners: [] })).toThrow(RangeError);
    expect(() => stateText({ mode: 'classic', round: 1, owners: [[1, -2]] })).toThrow(RangeError);
    expect(() => stateText({ mode: 'classic', round: 1, owners: [[Number.NaN, 2]] })).toThrow(RangeError);
  });
});

describe('map digest bytes', () => {
  it('FR-282 (canonical content) the file order is map.json, ids.png, presentation.json', () => {
    expect(MAP_FILE_NAMES).toStrictEqual(['map.json', 'ids.png', 'presentation.json']);
  });

  it('FR-282 (canonical content) each file is its UTF-8 name, a zero byte, an 8-byte big-endian length and the bytes', () => {
    const bytes = mapDigestBytes(filesOf([65, 66], [], [200, 201, 202]));
    const expected = [
      ...codes('map.json'), 0, 0, 0, 0, 0, 0, 0, 0, 2, 65, 66,
      ...codes('ids.png'), 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ...codes('presentation.json'), 0, 0, 0, 0, 0, 0, 0, 0, 3, 200, 201, 202,
    ];
    expect([...bytes]).toStrictEqual(expected);
  });

  it('FR-282 (canonical content) a length above 255 uses all its big-endian bytes and the file is not re-encoded', () => {
    const big = Array.from({ length: 300 }, (_, i) => i % 256);
    const bytes = mapDigestBytes(filesOf(big, [], []));
    const start = 'map.json'.length + 1;
    expect([...bytes.subarray(start, start + 8)]).toStrictEqual([0, 0, 0, 0, 0, 0, 1, 44]);
    expect([...bytes.subarray(start + 8, start + 8 + 300)]).toStrictEqual(big);
    expect(ascii(bytes, start + 308, start + 308 + 7)).toBe('ids.png');
  });

  it('FR-282 (canonical content) a missing or non-byte file is refused', () => {
    expect(() => mapDigestBytes({ 'map.json': new Uint8Array(1), 'ids.png': new Uint8Array(1) } as never)).toThrow(TypeError);
    expect(() => mapDigestBytes({ ...filesOf([], [], []), 'ids.png': 'text' } as never)).toThrow(TypeError);
  });
});

describe('canonical request body', () => {
  const POST = 'POST';
  const path = '/matches/m1/predictions';

  it('FR-282 (canonical content) object key order and whitespace do not matter, at any depth', () => {
    const a = JSON.parse('{ "kind": "victim", "faction": 3,\n "round": 1, "nested": {"b": [1, {"y":1,"x":2}], "a": null} }') as unknown;
    const b = JSON.parse('{"nested":{"a":null,"b":[1,{"x":2,"y":1}]},"round":1,"faction":3,"kind":"victim"}') as unknown;
    expect(canonicalBody(POST, path, a)).toBe(canonicalBody(POST, path, b));
  });

  it('FR-282 (canonical content) the text is the method, the path and the sorted compact body', () => {
    expect(canonicalBody(POST, '/p', { b: 1, a: 'x y', c: [true, null, 'é'] })).toBe('"POST" "/p" {"a":"x y","b":1,"c":[true,null,"é"]}');
  });

  it('FR-282 (canonical content) drops only the top-level request id key', () => {
    const withId = { kind: 'winner', faction: 2, playerId: 'p', requestId: 'r-1' };
    const without = { kind: 'winner', faction: 2, playerId: 'p' };
    expect(canonicalBody(POST, path, withId)).toBe(canonicalBody(POST, path, without));
    expect(canonicalBody(POST, path, { ...withId, requestId: 'r-2' })).toBe(canonicalBody(POST, path, without));
    // other keys, other spellings and nested request ids are content
    expect(canonicalBody(POST, path, { ...without, requestid: 'r' })).not.toBe(canonicalBody(POST, path, without));
    expect(canonicalBody(POST, path, { ...without, note: { requestId: 'r' } })).not.toBe(canonicalBody(POST, path, without));
    expect(canonicalBody(POST, path, { ...without, requestId2: 'r' })).not.toBe(canonicalBody(POST, path, without));
  });

  it('FR-282 (canonical content) another method, path or value is another content', () => {
    const body = { kind: 'winner', faction: 2, playerId: 'p', requestId: 'r' };
    const same = canonicalBody(POST, path, body);
    expect(canonicalBody('PUT', path, body)).not.toBe(same);
    expect(canonicalBody(POST, '/matches/m2/predictions', body)).not.toBe(same);
    expect(canonicalBody(POST, path, { ...body, faction: 3 })).not.toBe(same);
    expect(canonicalBody(POST, path, { ...body, faction: '2' })).not.toBe(same);
    expect(canonicalBody(POST, path, { ...body, extra: 1 })).not.toBe(same);
    expect(canonicalBody(POST, path, [1, 2])).not.toBe(canonicalBody(POST, path, [2, 1]));
  });

  it('FR-282 (canonical content) method and path cannot be confused with the body (self-delimiting)', () => {
    expect(canonicalBody('POST /a', '/b', {})).not.toBe(canonicalBody('POST', '/a /b', {}));
  });

  it('FR-282 (canonical content) an own __proto__ key is content, not dropped or inherited', () => {
    const parsed = JSON.parse('{"a":1,"__proto__":{"x":1}}') as unknown;
    expect(canonicalBody(POST, '/p', parsed)).toBe('"POST" "/p" {"__proto__":{"x":1},"a":1}');
  });

  it('FR-282 (canonical content) values that JSON cannot carry are refused', () => {
    expect(() => canonicalBody(POST, '/p', { a: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalBody(POST, '/p', { a: Infinity })).toThrow(TypeError);
    expect(() => canonicalBody(POST, '/p', { a: 1n })).toThrow(TypeError);
    expect(() => canonicalBody(POST, '/p', undefined)).toThrow(TypeError);
    // an undefined property is absent, as in JSON
    expect(canonicalBody(POST, '/p', { a: undefined, b: 1 })).toBe('"POST" "/p" {"b":1}');
  });
});
