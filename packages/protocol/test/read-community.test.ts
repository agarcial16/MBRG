import { describe, expect, it } from 'vitest';
import { CREATION_FIELDS, canonicalBody, isCommunityKey, readCreation, type ReadResult } from '../src/index';

// Spec 024: the optional community key of a creation body (64 lowercase hexadecimal characters). The key values below are
// planted literals no other text of the repository holds.

const err = (r: ReadResult<unknown>): string => (r.ok ? 'ok' : `${r.error.kind}:${(r.error.items ?? []).join(',')}`);
const creation = { mapId: 'dev', timing: { i: 120, l1: 30, l2: 10 }, requestId: 'req-1' };
const KEY = 'c0ffee5eed0123456789abcdef0123456789abcdef0123456789abcdef012345';

describe('creation body community key (spec 024)', () => {
  it('FR-546 accepts exactly 64 lowercase hexadecimal characters and returns the member', () => {
    expect(KEY).toHaveLength(64);
    expect(readCreation({ ...creation, community: KEY })).toStrictEqual({ ok: true, value: { ...creation, community: KEY } });
    expect(readCreation({ ...creation, joinPolicy: 'client', community: KEY })).toStrictEqual({ ok: true, value: { ...creation, joinPolicy: 'client', community: KEY } });
    expect(isCommunityKey(KEY)).toBe(true);
  });

  it('FR-546 the member is present in the value only when it was sent', () => {
    const read = readCreation(creation);
    expect(read).toStrictEqual({ ok: true, value: creation });
    expect(read.ok && Object.prototype.hasOwnProperty.call(read.value, 'community')).toBe(false);
  });

  it('FR-546 refuses uppercase, 63 and 65 characters, non-hex characters and non-strings, naming community', () => {
    const bad: unknown[] = [
      KEY.toUpperCase(),
      `${KEY.slice(0, 63)}F`,
      KEY.slice(0, 63),
      `${KEY}a`,
      `${KEY.slice(0, 63)}g`,
      `${KEY.slice(0, 63)} `,
      ` ${KEY.slice(1)}`,
      `${KEY}\n`,
      '',
      5,
      true,
      null,
      undefined,
      [],
      [KEY],
      {},
      { v: KEY },
    ];
    for (const community of bad) expect(err(readCreation({ ...creation, community })), JSON.stringify(community)).toBe('invalid-request:community');
    for (const community of bad) expect(isCommunityKey(community), JSON.stringify(community)).toBe(false);
  });

  it('FR-546 a malformed key wins over the timing rules, and community is own-property only', () => {
    const slow = { ...creation, timing: { i: 1, l1: 1, l2: 1 } };
    expect(readCreation({ ...slow, community: KEY })).toMatchObject({ ok: false, error: { kind: 'invalid-timing' } });
    expect(err(readCreation({ ...slow, community: 'x' }))).toBe('invalid-request:community');
    expect(readCreation(Object.create({ community: 'x' }, Object.getOwnPropertyDescriptors(creation)))).toStrictEqual({ ok: true, value: creation });
  });

  it('FR-546 the field list ends with community, after joinPolicy', () => {
    expect(CREATION_FIELDS).toStrictEqual(['mapId', 'timing', 'requestId', 'joinPolicy', 'community']);
  });

  it('NFR-120 (part: creation body digest) the canonical body without the key is the text pinned from main, and the key is content', () => {
    const base = { mapId: 'dev', timing: 'manual', requestId: 'r' };
    expect(canonicalBody('POST', '/matches', base)).toBe('"POST" "/matches" {"mapId":"dev","timing":"manual"}');
    expect(canonicalBody('POST', '/matches', creation)).toBe('"POST" "/matches" {"mapId":"dev","timing":{"i":120,"l1":30,"l2":10}}');
    expect(canonicalBody('POST', '/matches', { ...base, community: KEY })).toBe(`"POST" "/matches" {"community":"${KEY}","mapId":"dev","timing":"manual"}`);
    const other = `${KEY.slice(0, 63)}0`;
    expect(canonicalBody('POST', '/matches', { ...base, community: KEY })).not.toBe(canonicalBody('POST', '/matches', { ...base, community: other }));
  });
});
