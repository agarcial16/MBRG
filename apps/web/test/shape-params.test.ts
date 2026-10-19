import { describe, expect, it } from 'vitest';
import { LABEL_PARAMS } from '../src/core/label-params';
import { OFF_LAND_HEIGHT_RANGE, SHAPE_PARAMS, cs } from '../src/core/shape-params';

describe('shape parameters', () => {
  it('FR-196 FR-203 FR-207 SHAPE_PARAMS holds the decided values', () => {
    expect(SHAPE_PARAMS).toStrictEqual({
      angleStep: 15,
      shapeGain: 1.5,
      arcBends: [30, 60],
      offLandHeight: { faction: 18, territory: 5 },
      offLandReach: 24,
      leaderGap: 6,
    });
  });

  it('FR-203 the tunable off-land heights lie inside their ranges', () => {
    expect(OFF_LAND_HEIGHT_RANGE).toStrictEqual({
      faction: { min: 10, max: 40 },
      territory: { min: 3, max: 12 },
    });
    const h = SHAPE_PARAMS.offLandHeight;
    expect(h.territory).toBeGreaterThanOrEqual(3);
    expect(h.territory).toBeLessThanOrEqual(12);
    expect(h.faction).toBeGreaterThanOrEqual(10);
    expect(h.faction).toBeLessThanOrEqual(40);
  });

  it('FR-207 the margin is below the leader gap, which is at most the reach (M < Gl <= Dr)', () => {
    expect(LABEL_PARAMS.margin).toBeLessThan(SHAPE_PARAMS.leaderGap);
    expect(SHAPE_PARAMS.leaderGap).toBeLessThanOrEqual(SHAPE_PARAMS.offLandReach);
  });

  it('FR-196 cs(theta) equals the spec table expressions for -75 to 90 in steps of 15', () => {
    const q = Math.sqrt;
    const table: Record<number, [number, number]> = {
      0: [1, 0],
      15: [(q(6) + q(2)) / 4, (q(6) - q(2)) / 4],
      30: [q(3) / 2, 1 / 2],
      45: [q(2) / 2, q(2) / 2],
      60: [1 / 2, q(3) / 2],
      75: [(q(6) - q(2)) / 4, (q(6) + q(2)) / 4],
      90: [0, 1],
    };
    for (const theta of [-75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75, 90]) {
      const [c, s] = table[Math.abs(theta)]!;
      expect(cs(theta), String(theta)).toStrictEqual({ c, s: theta < 0 ? -s : s });
    }
    expect(Object.is(cs(0).s, 0)).toBe(true);
  });

  it('FR-196 cs refuses angles that are not multiples of 15 or are -90', () => {
    expect(() => cs(10)).toThrow(RangeError);
    expect(() => cs(-90)).toThrow(RangeError);
    expect(() => cs(105)).toThrow(RangeError);
  });
});
