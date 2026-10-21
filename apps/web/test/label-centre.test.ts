import { describe, expect, it } from 'vitest';
import { CENTRE_PARAMS } from '../src/core/centre-params';
import { LABEL_PARAMS } from '../src/core/label-params';
import { SHAPE_PARAMS } from '../src/core/shape-params';

describe('centre parameters (spec 007)', () => {
  it('FR-219 FR-221 FR-230 CENTRE_PARAMS holds the decided values', () => {
    expect(CENTRE_PARAMS).toStrictEqual({
      centreFraction: { num: 7, den: 50 },
      angleLimit: 45,
      straightAngles: [15, -15, 30, -30, 45, -45],
      factionAreaShare: { num: 1, den: 10 },
    });
  });

  it('FR-219 the centre fraction and the area share are whole-number ratios', () => {
    for (const r of [CENTRE_PARAMS.centreFraction, CENTRE_PARAMS.factionAreaShare]) {
      expect(Number.isInteger(r.num)).toBe(true);
      expect(Number.isInteger(r.den)).toBe(true);
      expect(r.num).toBeGreaterThan(0);
      expect(r.den).toBeGreaterThan(r.num);
    }
  });

  it('FR-219 the straight angles are in the FR-220 order, all multiples of 15 within the limit', () => {
    const a = CENTRE_PARAMS.straightAngles;
    expect(a).toHaveLength(6);
    expect(new Set(a).size).toBe(6);
    for (const t of a) {
      expect(Math.abs(t) % 15).toBe(0);
      expect(Math.abs(t)).toBeLessThanOrEqual(CENTRE_PARAMS.angleLimit);
      expect(t).not.toBe(0);
    }
    // Increasing |theta|, the positive angle before the negative one.
    expect(a.map(Math.abs)).toStrictEqual([15, 15, 30, 30, 45, 45]);
    expect(a.filter((_, i) => i % 2 === 0).every((t) => t > 0)).toBe(true);
  });

  it('FR-221 the arc tangent limit is 45 degrees', () => {
    expect(CENTRE_PARAMS.angleLimit).toBe(45);
  });

  it('FR-230 a faction label may cover at most one tenth of the region area', () => {
    expect(CENTRE_PARAMS.factionAreaShare).toStrictEqual({ num: 1, den: 10 });
  });

  it('FR-219 the 005 and 006 parameters keep their pinned values', () => {
    expect(LABEL_PARAMS).toStrictEqual({
      font: { weight: 600, families: ['"Segoe UI"', '"Helvetica Neue"', 'Arial', 'sans-serif'] },
      margin: 2,
      maxHeight: 120,
      minPx: 9,
      fadeStart: 1.5,
      fadeFull: 2,
      durationMs: 1500,
    });
    expect(SHAPE_PARAMS).toStrictEqual({
      angleStep: 15,
      shapeGain: 1.25,
      arcBends: [30, 60],
      offLandHeight: { faction: 18, territory: 3 },
      offLandReach: 24,
      leaderGap: 6,
    });
  });
});
