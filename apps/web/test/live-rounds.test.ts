import { describe, expect, it } from 'vitest';
import { stateText, type RecordReply } from '@mbrg/protocol';
import { applyRecord, canRequest, digestTextOf, ownersOf, stepDataOf } from '../src/core/live-rounds';
import { scripted } from './helpers/scripted-match';

const record = (over: Partial<RecordReply> = {}): RecordReply => ({ round: 1, eliminated: 2, absorber: 1, transferred: [3, 5], ...over });
const OWNERS: [number, number][] = [[1, 1], [3, 2], [4, 3], [5, 2], [8, 3]];

describe('FR-304 the state of a round is built from its record only', () => {
  it('FR-304 ownersOf keeps the order of the pairs (the order of the digest text)', () => {
    expect([...ownersOf(OWNERS)]).toStrictEqual(OWNERS);
    expect([...ownersOf([[9, 1], [2, 2], [5, 1]])].map((p) => p[0])).toStrictEqual([9, 2, 5]);
  });

  it('FR-304 a record moves the listed territories to the absorber and keeps every other owner and the order', () => {
    const next = applyRecord(ownersOf(OWNERS), record());
    expect(next).not.toBe('mismatch');
    expect([...(next as Map<number, number>)]).toStrictEqual([[1, 1], [3, 1], [4, 3], [5, 1], [8, 3]]);
  });

  it('FR-304 the input owners are never changed', () => {
    const before = ownersOf(OWNERS);
    applyRecord(before, record());
    expect([...before]).toStrictEqual(OWNERS);
  });

  it.each([
    ['a listed territory owned by another faction', { transferred: [3, 4, 5] }],
    ['a listed territory that nobody owns', { transferred: [3, 5, 99] }],
    ['a territory listed twice', { transferred: [3, 3, 5] }],
    ['a territory of the eliminated faction left out', { transferred: [3] }],
    ['an absorber equal to the eliminated faction', { absorber: 2 }],
    ['an empty list while the eliminated faction owns territories', { transferred: [] }],
  ])('FR-304 a mismatch: %s', (_name, over) => {
    expect(applyRecord(ownersOf(OWNERS), record(over))).toBe('mismatch');
  });

  it('FR-304 over a whole scripted match every record turns the state of round k - 1 into the state of round k', async () => {
    const s = await scripted();
    expect(s.total).toBeGreaterThanOrEqual(3);
    for (let k = 1; k <= s.total; k++) {
      const next = applyRecord(ownersOf(s.states[k - 1] as never), s.records[k - 1] as RecordReply);
      expect(next, `round ${k}`).not.toBe('mismatch');
      expect([...(next as Map<number, number>)], `round ${k}`).toStrictEqual(s.states[k]);
    }
  });

  it('FR-304 the digest text is the canonical state text of the protocol', async () => {
    expect(digestTextOf(ownersOf([[1, 2], [3, 4]]), 5)).toBe('classic;5;1:2,3:4');
    const s = await scripted();
    for (const n of [0, 1, s.total]) {
      expect(digestTextOf(ownersOf(s.states[n] as never), n)).toBe(stateText({ mode: 'classic', round: n, owners: s.states[n] as never }));
    }
  });

  it('FR-304 the step data holds the 005 members only: no seed, round or record', () => {
    const data = stepDataOf(ownersOf(OWNERS), ownersOf(OWNERS), record());
    expect(Object.keys(data).sort()).toStrictEqual(['absorber', 'earlier', 'eliminated', 'later', 'transferred']);
    expect(data.eliminated).toBe(2);
    expect(data.absorber).toBe(1);
    expect(data.transferred).toStrictEqual([3, 5]);
  });
});

describe('FR-254 (client requests) only the rounds 0..N can be asked for', () => {
  it('FR-254 (client requests) states 0..N and records 1..N, nothing above N', () => {
    for (const n of [0, 1, 7]) {
      expect(canRequest(n, 'state', 0)).toBe(true);
      expect(canRequest(n, 'state', n)).toBe(true);
      expect(canRequest(n, 'state', n + 1)).toBe(false);
      expect(canRequest(n, 'record', n + 1)).toBe(false);
      expect(canRequest(n, 'state', -1)).toBe(false);
      expect(canRequest(n, 'record', 0)).toBe(false);
      expect(canRequest(n, 'state', Number.MAX_SAFE_INTEGER)).toBe(n === Number.MAX_SAFE_INTEGER);
    }
    expect(canRequest(5, 'record', 1)).toBe(true);
    expect(canRequest(5, 'record', 5)).toBe(true);
    expect(canRequest(5, 'state', 2.5)).toBe(false);
    expect(canRequest(5, 'state', Number.NaN)).toBe(false);
  });
});
