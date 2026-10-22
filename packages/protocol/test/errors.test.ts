import { describe, expect, it } from 'vitest';
import { ERROR_ORDER, ERROR_REPLY_KEYS, errorReply, firstError, listsSeveral, type ErrorKind } from '../src/index';

// FR-301 literally, in order (P33). `map-validation` stands for the map validation errors (001 order).
const FR_301 = [
  'rate-limited', 'unknown-path', 'method-not-allowed', 'too-large', 'invalid-request', 'invalid-player-id',
  'forbidden', 'request-id-reused', 'unknown-match', 'unknown-map', 'map-validation', 'too-few-factions',
  'invalid-timing', 'too-many-matches', 'match-halted', 'match-finished', 'step-mismatch', 'round-not-applied',
  'stale-cursor', 'prediction-closed', 'invalid-choice', 'unavailable',
];

describe('error kinds', () => {
  it('FR-301 ERROR_ORDER equals the fixed list: 21 kinds plus the map-validation group, 22 entries', () => {
    expect([...ERROR_ORDER]).toStrictEqual(FR_301);
    expect(ERROR_ORDER).toHaveLength(22);
    expect(new Set(ERROR_ORDER).size).toBe(22);
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
    expect([...ERROR_REPLY_KEYS]).toStrictEqual(['kind', 'items']);
    expect(Object.keys(errorReply('forbidden'))).toStrictEqual(['kind']);
    expect(Object.keys(errorReply('invalid-timing', ['a']))).toStrictEqual(['kind', 'items']);
    for (const key of ERROR_REPLY_KEYS) expect(key).not.toMatch(/secret|token|credential|seed|key|password/i);
  });
});
