import { describe, expect, it } from 'vitest';
import { axisAngle, axisExtent, boundaryPassed, setSums, shapesOf, wrapAngle } from '../src/core/label-axis';
import type { Shape } from '../src/core/label-axis';
import { mainRegions, regionsOf } from '../src/core/regions';
import type { PieceIndex } from '../src/core/regions';
import { cs, SHAPE_PARAMS } from '../src/core/shape-params';
import { atan2AxisAngle, refAxisAngle, refAxisAngleOf, refMoments, refSide } from './helpers/label-reference';
import { rng } from './helpers/label-grids';
import { devPieces, lineUnits, randomUnits, setOfUnits } from './helpers/shaped-grids';
import type { Unit } from './helpers/shaped-grids';

const angleOf = (units: readonly Unit[]): number => {
  const { p, pieces } = setOfUnits(units);
  return axisAngle(p, pieces);
};

describe('FR-196 the axis angle of hand-made sets in every sector', () => {
  // [dx, dyUp, expected]: a line of units with the screen step (dx, dyUp); its exact angle is atan(dyUp / dx).
  const LINES: ReadonlyArray<readonly [number, number, number]> = [
    [1, 0, 0],
    [12, 1, 0], // 4.8
    [5, 1, 15], // 11.3
    [3, 1, 15], // 18.4
    [2, 1, 30], // 26.6
    [3, 2, 30], // 33.7
    [1, 1, 45],
    [2, 3, 60], // 56.3
    [1, 2, 60], // 63.4
    [1, 3, 75], // 71.6
    [1, 5, 75], // 78.7
    [1, 8, 90], // 82.9, past the 82.5 boundary
    [0, 1, 90],
    [12, -1, 0],
    [5, -1, -15],
    [2, -1, -30],
    [1, -1, -45],
    [1, -2, -60],
    [1, -3, -75],
    [1, -5, -75],
    [1, -8, 90], // -82.9 rounds to -90, which wraps to +90
    [0, -1, 90],
  ];

  it('FR-196 a line of units at a known screen angle gives the multiple of 15 nearest to it', () => {
    for (const [dx, dyUp, expected] of LINES) {
      const units = lineUnits(dx >= 0 ? 0 : 40, 60, dx, dyUp, 9);
      const got = angleOf(units.map(([x, y]) => [x + 3, y] as const));
      expect(got, `step (${dx}, ${dyUp})`).toBe(expected);
      expect(refAxisAngle(units), `reference (${dx}, ${dyUp})`).toBe(expected);
    }
  });

  it('FR-196 a negative result is never -0 and -90 is wrapped to +90', () => {
    expect(Object.is(angleOf(lineUnits(0, 20, 1, 0, 6)), 0)).toBe(true);
    expect(angleOf(lineUnits(2, 40, 1, -8, 6))).toBe(90);
    expect(wrapAngle(-90)).toBe(90);
    expect(wrapAngle(105)).toBe(-75);
    expect(wrapAngle(-105)).toBe(75);
    expect(wrapAngle(90)).toBe(90);
    expect(wrapAngle(0)).toBe(0);
  });

  it('FR-196 NFR-39 A = B = 0 gives 0: a single unit, a square, a plus shape', () => {
    expect(angleOf([[3, 3]])).toBe(0);
    expect(angleOf([[1, 1], [2, 1], [1, 2], [2, 2]])).toBe(0);
    expect(angleOf([[2, 1], [1, 2], [2, 2], [3, 2], [2, 3]])).toBe(0);
  });
});

/** Small random sets until `want` accepts their moments; the generator is the fixed-seed one. */
function findSet(want: (a: bigint, b: bigint) => boolean, seed: number): Unit[] {
  const next = rng(seed);
  for (let i = 0; i < 400000; i++) {
    const count = 3 + Math.floor(next() * 5);
    const units = randomUnits(Math.floor(next() * 1e9), 7, count);
    const { a, b } = refMoments(units);
    if (want(a, b)) return units;
  }
  throw new Error('no set found');
}

describe('FR-196 NFR-39 exact ties go towards 0 and the angle is exact', () => {
  it('FR-196 a tie at doubled 45 gives 15 and at doubled 135 gives 60, mirrored -15 and -60', () => {
    const cases: ReadonlyArray<readonly [(a: bigint, b: bigint) => boolean, number]> = [
      [(a, b) => b > 0n && a === b, 15], // 22.5 -> 15
      [(a, b) => b > 0n && a === -b, 60], // 67.5 -> 60
      [(a, b) => b < 0n && a === -b, -15], // -22.5 -> -15
      [(a, b) => b < 0n && a === b, -60], // -67.5 -> -60
    ];
    cases.forEach(([want, expected], i) => {
      const units = findSet(want, 100 + i);
      expect(angleOf(units), `tie ${i}`).toBe(expected);
      expect(refAxisAngle(units), `reference tie ${i}`).toBe(expected);
    });
  });

  it('FR-196 Sxx = Syy with a tiny positive Sxy gives 45 (only A = B = 0 gives 0), and a negative one -45', () => {
    const up = findSet((a, b) => a === 0n && b > 0n, 7);
    const down = findSet((a, b) => a === 0n && b < 0n, 8);
    expect(angleOf(up)).toBe(45);
    expect(angleOf(down)).toBe(-45);
  });

  it('FR-196 NFR-39 the sideOf table agrees with an 80-digit evaluation on near-miss directions', () => {
    let checked = 0;
    for (const boundary of [15, 45, 75, 105, 135, 165]) {
      const tan = Math.tan((boundary * Math.PI) / 180);
      for (let a = -400; a <= 400; a++) {
        if (a === 0) continue;
        const centre = Math.round(a * tan);
        for (let d = -1; d <= 1; d++) {
          const A = BigInt(a);
          const B = BigInt(centre + d);
          expect(boundaryPassed(boundary, A, B), `boundary ${boundary} A ${A} B ${B}`).toBe(refSide(boundary, A, B) > 0);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(4000);
  });

  it('FR-196 NFR-39 huge values stay exact: moments around 10^24 agree with the 80-digit reference', () => {
    const next = rng(5);
    for (let i = 0; i < 600; i++) {
      const A = BigInt(Math.floor(next() * 1e15)) * 1000000007n * (next() < 0.5 ? 1n : -1n);
      const B = BigInt(Math.floor(next() * 1e15)) * 1000000009n * (next() < 0.5 ? 1n : -1n);
      for (const boundary of [15, 45, 75, 105, 135, 165]) {
        expect(boundaryPassed(boundary, A, B), `boundary ${boundary} A ${A} B ${B}`).toBe(refSide(boundary, A, B) > 0);
      }
    }
  });

  it('FR-196 the angle equals Math.atan2 on 500 random sets whose doubled angle is away from every boundary', () => {
    let compared = 0;
    for (let i = 0; i < 500; i++) {
      const units = randomUnits(1000 + i, 12, 3 + (i % 30));
      const { a, b } = refMoments(units);
      const expected = atan2AxisAngle(a, b);
      if (expected === undefined) continue;
      expect(angleOf(units), `set ${i}`).toBe(expected);
      expect(refAxisAngleOf(a, b), `reference set ${i}`).toBe(expected);
      compared++;
    }
    expect(compared).toBeGreaterThan(450);
  });

  it('NFR-39 sums above 2^53 are handled: dev map land and faction regions agree with the BigInt reference', async () => {
    const p: PieceIndex = await devPieces();
    const all = Array.from({ length: p.entryOf.length }, (_, i) => i);
    const sets: number[][] = [all];
    // main regions of an arbitrary split of the entries into three owners
    const owners = Array.from({ length: p.entries }, (_, e) => e % 3);
    for (const region of mainRegions(regionsOf(p, owners)).values()) sets.push(region.pieces);
    let big = 0;
    for (const pieces of sets) {
      const s = setSums(p, pieces);
      if (s.n * s.sxx > Number.MAX_SAFE_INTEGER) big++;
      const units: Unit[] = [];
      for (const piece of pieces) {
        for (let k = p.unitStart[piece]!; k < p.unitStart[piece + 1]!; k++) {
          const u = p.units[k]!;
          units.push([u % p.width, Math.floor(u / p.width)]);
        }
      }
      expect(axisAngle(p, pieces)).toBe(refAxisAngle(units));
    }
    expect(big).toBeGreaterThanOrEqual(2);
  });
});

describe('FR-196 setSums and axisExtent', () => {
  it('FR-196 setSums are the sums over whole coordinates of the units of the given pieces only', () => {
    const { p } = setOfUnits([[1, 1], [2, 1], [5, 4]]);
    expect(p.entryOf.length).toBe(2);
    expect(setSums(p, [0, 1])).toStrictEqual({ n: 3, sx: 8, sy: 6, sxx: 30, syy: 18, sxy: 23 });
    expect(setSums(p, [1])).toStrictEqual({ n: 1, sx: 5, sy: 4, sxx: 25, syy: 16, sxy: 20 });
    expect(setSums(p, [])).toStrictEqual({ n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 });
  });

  it('FR-196 L is the largest minus the smallest projection t = px * C - py * S of the unit centres', () => {
    const horizontal = setOfUnits(lineUnits(2, 5, 1, 0, 10));
    expect(axisExtent(horizontal.p, horizontal.pieces, 0)).toBe(9);
    const vertical = setOfUnits(lineUnits(5, 20, 0, 1, 10));
    expect(axisExtent(vertical.p, vertical.pieces, 90)).toBe(9);
    // the same units seen across: no extent along the other axis
    expect(axisExtent(vertical.p, vertical.pieces, 0)).toBe(0);
    // a 45 degree line of 10 units (2 + k, 20 - k): the ends k = 0 and k = 9 project to t0 and t9
    const diagonal = setOfUnits(lineUnits(2, 20, 1, 1, 10));
    const { c, s } = cs(45);
    expect(axisExtent(diagonal.p, diagonal.pieces, 45)).toBe(11.5 * c - 11.5 * s - (2.5 * c - 20.5 * s));
  });

  it('FR-196 L follows the written order of the formula for every angle and a negative angle projects the other way', () => {
    const { p, pieces } = setOfUnits(randomUnits(77, 20, 40));
    const centres = pieces.flatMap((piece) =>
      Array.from({ length: p.unitStart[piece + 1]! - p.unitStart[piece]! }, (_, i) => {
        const u = p.units[p.unitStart[piece]! + i]!;
        return [(u % p.width) + 0.5, Math.floor(u / p.width) + 0.5] as const;
      }),
    );
    for (const angle of [-75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75, 90]) {
      const { c, s } = cs(angle);
      const t = centres.map(([px, py]) => px * c - py * s);
      expect(axisExtent(p, pieces, angle), String(angle)).toBe(Math.max(...t) - Math.min(...t));
    }
    expect(axisExtent(p, [], 0)).toBe(0);
  });
});

describe('FR-196 the shapes of a set and their order', () => {
  const sp = SHAPE_PARAMS;
  const straight = (angle: number): Shape => ({ shape: 'straight', angle });
  const arc = (angle: number, bend: number): Shape => ({ shape: 'arc', angle, bend });

  it('FR-196 theta* = 90: straight at 90, 75 and -75 (105 wrapped), no arc', () => {
    expect(shapesOf(90, 10, sp)).toStrictEqual([straight(90), straight(75), straight(-75)]);
  });

  it('FR-196 theta* = -75: straight at -75, 90 (-90 wrapped) and -60, then the arcs', () => {
    expect(shapesOf(-75, 10, sp)).toStrictEqual([
      straight(-75),
      straight(90),
      straight(-60),
      arc(-75, 30),
      arc(-75, -30),
      arc(-75, 60),
      arc(-75, -60),
    ]);
  });

  it('FR-196 theta* = 15 and -15: the neighbour 0 is not a straight shape', () => {
    expect(shapesOf(15, 10, sp).filter((s) => s.shape === 'straight')).toStrictEqual([straight(15), straight(30)]);
    expect(shapesOf(-15, 10, sp).filter((s) => s.shape === 'straight')).toStrictEqual([straight(-15), straight(-30)]);
  });

  it('FR-196 theta* = 0: straight at -15 and 15, arcs with the smaller bend first and the positive sign first', () => {
    expect(shapesOf(0, 25, sp)).toStrictEqual([straight(-15), straight(15), arc(0, 30), arc(0, -30), arc(0, 60), arc(0, -60)]);
  });

  it('FR-196 a set of extent 0 has no arc shape', () => {
    expect(shapesOf(0, 0, sp)).toStrictEqual([straight(-15), straight(15)]);
    expect(shapesOf(45, 0, sp).every((s) => s.shape === 'straight')).toBe(true);
  });

  it('FR-196 NFR-39 the 15 degree neighbours of every theta* are in (-90, 90] and none is 0', () => {
    for (let angle = -75; angle <= 90; angle += 15) {
      const shapes = shapesOf(angle, 1, sp);
      for (const s of shapes) {
        expect(s.angle).toBeGreaterThan(-90);
        expect(s.angle).toBeLessThanOrEqual(90);
        if (s.shape === 'straight') expect(s.angle).not.toBe(0);
      }
      expect(shapes.filter((s) => s.shape === 'straight').length).toBe(angle === 0 || Math.abs(angle) === 15 ? 2 : 3);
    }
  });
});
