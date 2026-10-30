import { describe, expect, it } from 'vitest';
import {
  ERROR_ORDER,
  ERROR_REPLY_KEYS,
  STAGES,
  errorReply,
  firstError,
  listsSeveral,
  rateLimited,
  roundNotApplied,
  stepMismatch,
  type ErrorKind,
  type ErrorReply,
} from '../src/index';

// FR-301 literally, in order (P33). `map-validation` stands for the map validation errors (001 order).
const FR_301 = [
  'rate-limited', 'unknown-path', 'method-not-allowed', 'too-large', 'invalid-request', 'invalid-player-id',
  'forbidden', 'request-id-reused', 'unknown-match', 'unknown-map', 'map-validation', 'too-few-factions',
  'invalid-timing', 'too-many-matches', 'match-halted', 'match-finished', 'name-taken', 'match-full', 'match-started', 'match-expired', 'step-mismatch', 'round-not-applied',
  'stale-cursor', 'prediction-closed', 'forced-absorber', 'invalid-choice', 'unavailable',
];

describe('error kinds', () => {
  it('FR-301 ERROR_ORDER equals the fixed list: 26 kinds plus the map-validation group, 27 entries', () => {
    expect([...ERROR_ORDER]).toStrictEqual(FR_301);
    expect(ERROR_ORDER).toHaveLength(27);
    expect(new Set(ERROR_ORDER).size).toBe(27);
  });

  it('FR-301 the forced-absorber kind sits right after prediction-closed and right before invalid-choice', () => {
    const at = ERROR_ORDER.indexOf('forced-absorber');
    expect(ERROR_ORDER[at - 1]).toBe('prediction-closed');
    expect(ERROR_ORDER[at + 1]).toBe('invalid-choice');
    expect(firstError(['invalid-choice', 'forced-absorber'])).toBe('forced-absorber');
    expect(firstError(['forced-absorber', 'prediction-closed'])).toBe('prediction-closed');
    expect(firstError(['unavailable', 'forced-absorber', 'invalid-choice'])).toBe('forced-absorber');
    expect(errorReply('forced-absorber')).toStrictEqual({ kind: 'forced-absorber' });
    expect(() => errorReply('forced-absorber', ['a', 'b'])).toThrow(RangeError);
  });

  it('FR-301 the lobby refusals match-started and match-expired follow match-finished and precede step-mismatch', () => {
    const at = ERROR_ORDER.indexOf('match-finished');
    expect(ERROR_ORDER.slice(at, at + 6)).toStrictEqual(['match-finished', 'name-taken', 'match-full', 'match-started', 'match-expired', 'step-mismatch']);
    expect(firstError(['match-expired', 'match-started'])).toBe('match-started');
    expect(firstError(['step-mismatch', 'match-expired'])).toBe('match-expired');
    expect(firstError(['match-started', 'match-finished'])).toBe('match-finished');
    expect(errorReply('match-started')).toStrictEqual({ kind: 'match-started' });
    expect(errorReply('match-expired')).toStrictEqual({ kind: 'match-expired' });
    expect(() => errorReply('match-started', ['a', 'b'])).toThrow(RangeError);
    expect(listsSeveral('match-expired')).toBe(false);
  });

  it('FR-301 the join refusals name-taken and match-full sit after match-finished and before match-started', () => {
    expect(firstError(['match-started', 'match-full', 'name-taken'])).toBe('name-taken');
    expect(firstError(['match-started', 'match-full'])).toBe('match-full');
    expect(firstError(['match-finished', 'name-taken'])).toBe('match-finished');
    expect(errorReply('name-taken')).toStrictEqual({ kind: 'name-taken' });
    expect(errorReply('match-full')).toStrictEqual({ kind: 'match-full' });
    expect(() => errorReply('match-full', ['a', 'b'])).toThrow(RangeError);
    expect(listsSeveral('name-taken')).toBe(false);
  });

  it('FR-301 firstError returns the earlier kind of every pair, in any argument order', () => {
    for (let i = 0; i < FR_301.length; i++) {
      for (let j = 0; j < FR_301.length; j++) {
        const a = FR_301[i] as ErrorKind;
        const b = FR_301[j] as ErrorKind;
        expect(firstError([a, b])).toBe(i <= j ? a : b);
      }
    }
  });

  it('FR-301 firstError of a longer list is the earliest present and of none is undefined', () => {
    expect(firstError(['unavailable', 'stale-cursor', 'match-halted', 'unavailable'])).toBe('match-halted');
    expect(firstError(['invalid-choice'])).toBe('invalid-choice');
    expect(firstError([])).toBeUndefined();
  });

  it('FR-301 only the map validation group and invalid-timing may list several items', () => {
    const several = ERROR_ORDER.filter((k) => listsSeveral(k));
    expect(several).toStrictEqual(['map-validation', 'invalid-timing']);
    expect(errorReply('invalid-timing', ['a', 'c'])).toStrictEqual({ kind: 'invalid-timing', items: ['a', 'c'] });
    expect(errorReply('map-validation', ['x', 'y', 'z']).items).toHaveLength(3);
    expect(() => errorReply('invalid-request', ['a', 'b'])).toThrow();
    expect(errorReply('invalid-request', ['a'])).toStrictEqual({ kind: 'invalid-request', items: ['a'] });
    expect(errorReply('unavailable')).toStrictEqual({ kind: 'unavailable' });
  });

  it('FR-301 already-performed and the halt reasons are data, not error kinds', () => {
    for (const data of ['already-performed', 'map-changed', 'isolated-faction', 'victim-mismatch']) {
      expect(ERROR_ORDER as readonly string[]).not.toContain(data);
    }
  });

  it('FR-301 every kind is English kebab-case', () => {
    for (const kind of ERROR_ORDER) expect(kind).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
  });

  it('FR-301 the error shape has no field able to carry a secret, credential, token or seed', () => {
    expect([...ERROR_REPLY_KEYS]).toStrictEqual(['kind', 'items', 'stage', 'appliedRounds', 'retryAfter']);
    expect(Object.keys(errorReply('forbidden'))).toStrictEqual(['kind']);
    expect(Object.keys(errorReply('invalid-timing', ['a']))).toStrictEqual(['kind', 'items']);
    for (const key of ERROR_REPLY_KEYS) expect(key).not.toMatch(/secret|token|credential|seed|key|password/i);
  });
});

describe('the unified error replies (C6)', () => {
  it('FR-301 (reply shapes) type level: the ErrorReply keys are exactly the pinned key list', () => {
    // A key added to ErrorReply without ERROR_REPLY_KEYS (or the reverse) breaks the typecheck here.
    const all: Record<keyof ErrorReply, true> = { kind: true, items: true, stage: true, appliedRounds: true, retryAfter: true };
    type Listed = (typeof ERROR_REPLY_KEYS)[number];
    const same: [Listed] extends [keyof ErrorReply] ? ([keyof ErrorReply] extends [Listed] ? true : false) : false = true;
    expect(same).toBe(true);
    expect(Object.keys(all)).toStrictEqual([...ERROR_REPLY_KEYS]);
  });

  it('FR-301 (reply shapes) stepMismatch(stage, n) has exactly the shape M2b stored, so older memo entries decode unchanged', () => {
    // The literal M2b shape (service-steps, core-advance): kind, stage, appliedRounds in this order.
    const stored = JSON.parse('{"kind":"step-mismatch","stage":"phase-2","appliedRounds":3}') as ErrorReply;
    expect(stepMismatch('phase-2', 3)).toStrictEqual(stored);
    expect(JSON.stringify(stepMismatch('phase-2', 3))).toBe('{"kind":"step-mismatch","stage":"phase-2","appliedRounds":3}');
    for (const stage of STAGES) expect(stepMismatch(stage, 0)).toStrictEqual({ kind: 'step-mismatch', stage, appliedRounds: 0 });
    for (const bad of [-1, 1.5, Number.NaN, Infinity]) expect(() => stepMismatch('phase-1', bad)).toThrow(RangeError);
    expect(() => stepMismatch('playing' as never, 0)).toThrow(RangeError);
  });

  it('FR-258 (reply shape) roundNotApplied(n) names only N, in appliedRounds, with no items', () => {
    expect(roundNotApplied(7)).toStrictEqual({ kind: 'round-not-applied', appliedRounds: 7 });
    expect(Object.keys(roundNotApplied(0))).toStrictEqual(['kind', 'appliedRounds']);
    expect(roundNotApplied(2)).not.toHaveProperty('items');
    for (const bad of [-1, 2.5, Number.NaN]) expect(() => roundNotApplied(bad)).toThrow(RangeError);
  });

  it('FR-301 (reply shapes) rateLimited(s) carries retryAfter as a whole number of seconds of at least 1, rounded up', () => {
    expect(rateLimited(17)).toStrictEqual({ kind: 'rate-limited', retryAfter: 17 });
    expect(rateLimited(16.2)).toStrictEqual({ kind: 'rate-limited', retryAfter: 17 });
    expect(rateLimited(0.3)).toStrictEqual({ kind: 'rate-limited', retryAfter: 1 });
    expect(rateLimited(0)).toStrictEqual({ kind: 'rate-limited', retryAfter: 1 });
    expect(rateLimited(59.001).retryAfter).toBe(60);
    for (const bad of [-1, Number.NaN, Infinity]) expect(() => rateLimited(bad)).toThrow(RangeError);
  });

  it('FR-301 (reply shapes) every constructor writes only pinned keys, none able to hold a secret', () => {
    for (const reply of [stepMismatch('locked', 1), roundNotApplied(1), rateLimited(3), errorReply('invalid-timing', ['a', 'b'])]) {
      for (const key of Object.keys(reply)) expect(ERROR_REPLY_KEYS as readonly string[]).toContain(key);
    }
  });
});
