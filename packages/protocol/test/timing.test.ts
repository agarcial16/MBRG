import { describe, expect, it } from 'vitest';
import { readTiming, timingRuleFailures } from '../src/index';

const t = (i: unknown, l1: unknown, l2: unknown) => readTiming({ i, l1, l2 });
const invalidTiming = (r: ReturnType<typeof readTiming>) => (r.ok ? 'ok' : `${r.error.kind}:${(r.error.items ?? []).join(',')}`);

describe('timing reader', () => {
  it('FR-233 manual is accepted', () => {
    expect(readTiming('manual')).toStrictEqual({ ok: true, value: 'manual' });
    expect(timingRuleFailures('manual')).toStrictEqual([]);
  });

  it('FR-233 FR-234 a missing timing value, a missing field, text and other shapes are invalid-request', () => {
    for (const bad of [undefined, null, 'Manual', '3600', 3600, [], true, {}, { i: 10 }, { i: 10, l1: 3 }, { l1: 3, l2: 1 }]) {
      const r = readTiming(bad);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      if (!r.ok) expect(r.error.kind, JSON.stringify(bad)).toBe('invalid-request');
    }
  });

  it('FR-233 FR-296 a value given as text, null or a non-finite number is invalid-request naming the field', () => {
    expect(invalidTiming(t('3600', 1, 0))).toBe('invalid-request:timing.i');
    expect(invalidTiming(t(10, '1', 0))).toBe('invalid-request:timing.l1');
    expect(invalidTiming(t(10, 1, null))).toBe('invalid-request:timing.l2');
    expect(invalidTiming(t(Number.NaN, 1, 0))).toBe('invalid-request:timing.i');
    expect(invalidTiming(t(10, Number.POSITIVE_INFINITY, 0))).toBe('invalid-request:timing.l1');
    expect(invalidTiming(readTiming({ i: 10, l1: 1, l2: 0, extra: 1 }))).toBe('invalid-request:timing.extra');
  });

  it('FR-296 inherited timing fields count as missing', () => {
    const inherited = Object.create({ i: 10, l1: 1, l2: 0 }) as object;
    expect(invalidTiming(readTiming(inherited))).toBe('invalid-request:timing.i');
  });

  it('FR-233 rule (a): I = 3.5, I = 0, L1 = 0 and L1 = 1.5 are invalid-timing', () => {
    expect(invalidTiming(t(3.5, 1, 0))).toBe('invalid-timing:a');
    expect(invalidTiming(t(10, 0, 0))).toBe('invalid-timing:a');
    expect(invalidTiming(t(10, 1.5, 0))).toBe('invalid-timing:a');
    expect(invalidTiming(t(10, -1, 0))).toBe('invalid-timing:a');
  });

  it('FR-233 rule (b): L2 = -1 and L2 = 0.5 are invalid-timing', () => {
    expect(invalidTiming(t(10, 3, -1))).toBe('invalid-timing:b');
    expect(invalidTiming(t(10, 3, 0.5))).toBe('invalid-timing:b');
  });

  it('FR-233 rule (c): I at most L1 + L2 is invalid-timing, I = L1 + L2 + 1 is accepted', () => {
    expect(invalidTiming(t(4, 3, 1))).toBe('invalid-timing:c');
    expect(invalidTiming(t(3, 3, 1))).toBe('invalid-timing:c');
    expect(invalidTiming(t(5, 3, 1))).toBe('ok');
    expect(invalidTiming(t(2, 2, 0))).toBe('invalid-timing:c');
  });

  it('FR-233 rule (d): I = 2,592,001 is invalid-timing, I = 2,592,000 is accepted', () => {
    expect(invalidTiming(t(2_592_001, 1, 0))).toBe('invalid-timing:d');
    expect(invalidTiming(t(2_592_000, 1, 0))).toBe('ok');
  });

  it('FR-233 several failed rules are all listed, in (a) to (d) order', () => {
    expect(invalidTiming(t(2_592_001.5, 0, -1))).toBe('invalid-timing:a,b,d');
    expect(invalidTiming(t(3.5, 3, 1))).toBe('invalid-timing:a,c');
    expect(invalidTiming(t(10, 0, 20))).toBe('invalid-timing:a,c');
    expect(invalidTiming(t(10, 3, -9))).toBe('invalid-timing:b');
    expect(invalidTiming(t(0, 0, -1))).toBe('invalid-timing:a,b');
    expect(invalidTiming(t(0.5, 3, -1))).toBe('invalid-timing:a,b,c');
  });

  it('FR-233 FR-234 I = 3, L1 = 1, L2 = 0 is accepted exactly as given and nothing is filled in', () => {
    expect(t(3, 1, 0)).toStrictEqual({ ok: true, value: { i: 3, l1: 1, l2: 0 } });
    expect(Object.keys((t(3, 1, 0) as { value: object }).value)).toStrictEqual(['i', 'l1', 'l2']);
    expect(invalidTiming(t(120, 30, 10))).toBe('ok');
  });
});
