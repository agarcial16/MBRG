import { describe, expect, it } from 'vitest';
import { forwardOf, progressAt } from '../src/core/progress';
import { smoothstep } from '../src/core/lines';

const DT = 1500;

describe('FR-182 progress from elapsed time', () => {
  it('FR-182 p is 0 at t = 0 and the step is not done', () => {
    expect(progressAt(0, DT)).toStrictEqual({ p: 0, done: false });
  });

  it('FR-182 p is 1 and the step is done at t = Dt exactly', () => {
    expect(progressAt(DT, DT)).toStrictEqual({ p: 1, done: true });
  });

  it('FR-182 one millisecond before Dt the step is not done and p is below 1', () => {
    const r = progressAt(DT - 1, DT);
    expect(r.done).toBe(false);
    expect(r.p).toBeLessThan(1);
    expect(r.p).toBeGreaterThan(0.99);
  });

  it('FR-182 the midpoint is 0.5 and p follows smoothstep(0, 1, t / Dt)', () => {
    expect(progressAt(DT / 2, DT).p).toBe(0.5);
    for (const t of [1, 100, 375, 600, 1000, 1499]) {
      expect(progressAt(t, DT).p, `t ${t}`).toBe(smoothstep(0, 1, t / DT));
    }
  });

  it('FR-182 the shape is smoothstep: a quarter of the time is 0.15625 of the way', () => {
    expect(progressAt(DT / 4, DT).p).toBeCloseTo(0.15625, 12);
    expect(progressAt((3 * DT) / 4, DT).p).toBeCloseTo(0.84375, 12);
  });

  it('FR-182 the first frame after a hidden page (t = 10 x Dt, any larger value) is done with p = 1', () => {
    for (const t of [10 * DT, 1e9, Number.MAX_SAFE_INTEGER]) expect(progressAt(t, DT), `t ${t}`).toStrictEqual({ p: 1, done: true });
  });

  it('FR-182 a negative elapsed time (a clock that went back) is progress 0 and not done', () => {
    expect(progressAt(-5, DT)).toStrictEqual({ p: 0, done: false });
  });

  it('FR-182 p never decreases as t grows', () => {
    let last = -1;
    for (let t = 0; t <= 2 * DT; t += 7) {
      const { p } = progressAt(t, DT);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
  });

  it('FR-182 the duration is a parameter: the same t is further along with a shorter Dt', () => {
    expect(progressAt(800, 800)).toStrictEqual({ p: 1, done: true });
    expect(progressAt(800, 3000).done).toBe(false);
    expect(progressAt(300, 800).p).toBe(smoothstep(0, 1, 300 / 800));
  });

  it('FR-182 a duration that is not a positive finite number, or an elapsed time that is NaN, is a RangeError', () => {
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => progressAt(10, dt), `Dt ${dt}`).toThrow(RangeError);
    expect(() => progressAt(Number.NaN, DT)).toThrow(RangeError);
  });
});

describe('FR-182 forward progress of a direction', () => {
  it('FR-182 forward progress is p for a forward step and 1 - p for a backward step', () => {
    for (const p of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
      expect(forwardOf(p, 'forward'), `p ${p}`).toBe(p);
      expect(forwardOf(p, 'backward'), `p ${p}`).toBe(1 - p);
    }
  });

  it('FR-182 a backward step starts at f = 1 and ends at exactly f = 0', () => {
    expect(forwardOf(progressAt(0, DT).p, 'backward')).toBe(1);
    expect(forwardOf(progressAt(DT, DT).p, 'backward')).toBe(0);
    expect(forwardOf(progressAt(0, DT).p, 'forward')).toBe(0);
    expect(forwardOf(progressAt(DT, DT).p, 'forward')).toBe(1);
  });

  it('FR-182 a p outside 0..1 or NaN is a RangeError', () => {
    for (const p of [-0.1, 1.1, Number.NaN]) expect(() => forwardOf(p, 'forward'), `p ${p}`).toThrow(RangeError);
  });
});
