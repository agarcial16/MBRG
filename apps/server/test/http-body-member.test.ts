import { describe, expect, it } from 'vitest';
import { parseBodyBytes, repeatsMember } from '../src/http/body';

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
