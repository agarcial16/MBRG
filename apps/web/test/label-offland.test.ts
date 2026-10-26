import { describe, expect, it } from 'vitest';
import { boundaryUnits, leaderLine, nearestUnit, offLandBox, placeRole } from '../src/core/label-offland';
import type { Obstacle, OffLand, RoleLabel } from '../src/core/label-offland';
import type { LabelBox } from '../src/core/label-layout';
import { inArc, inStraight } from '../src/core/label-shape';
import type { ArcFrame, InLandFrame, StraightFrame } from '../src/core/label-shape';
import { LABEL_PARAMS } from '../src/core/label-params';
import { SHAPE_PARAMS } from '../src/core/shape-params';
import type { PieceIndex } from '../src/core/regions';
import { rng } from './helpers/label-grids';
import { refInObstacle, refOffLand } from './helpers/label-reference';
import type { RefObstacle } from './helpers/label-reference';
import { blobUnits, multiSets, rectUnits, setOfUnits } from './helpers/shaped-grids';
import type { Unit } from './helpers/shaped-grids';

const PARAMS = LABEL_PARAMS;
const M = PARAMS.margin;
const SP = SHAPE_PARAMS;

/** Whole coordinates of every unit of the given pieces. */
function unitsOf(p: PieceIndex, pieces: readonly number[]): Unit[] {
  const units: Unit[] = [];
  for (const piece of pieces) {
    for (let k = p.unitStart[piece]!; k < p.unitStart[piece + 1]!; k++) {
      const u = p.units[k]!;
      units.push([u % p.width, (u - (u % p.width)) / p.width] as const);
    }
  }
  return units;
}

const horizontal = (x0: number, y0: number, h: number, w: number): InLandFrame => ({ shape: 'horizontal', box: { x0, y0, h, w } });
const refOf = (o: Obstacle): RefObstacle => o as RefObstacle;

/** The search of the code and of the reference on the same input. */
function both(p: PieceIndex, pieces: readonly number[], aspect: number, h: number, obstacles: readonly Obstacle[]) {
  const got = offLandBox(p, pieces, aspect, h, obstacles, PARAMS, SP);
  const want = refOffLand(unitsOf(p, pieces), p.width, p.height, aspect, h, obstacles.map(refOf), M, SP);
  return { got, want };
}

function expectSame(got: OffLand | undefined, want: ReturnType<typeof refOffLand>, label: string): void {
  if (want === undefined) {
    expect(got, label).toBeUndefined();
    return;
  }
  expect(got, label).toBeDefined();
  expect(got!.shape, label).toBe('off-land');
  expect(got!.box, label).toStrictEqual(want.box);
  expect(got!.gap2, label).toBe(want.gap2);
  expect(got!.anchor, label).toBe(want.anchor);
  if (want.leader === undefined) expect('leader' in got!, label).toBe(false);
  else expect(got!.leader, label).toStrictEqual(want.leader);
}

describe('FR-203 FR-204 FR-205 FR-207 the off-land box equals the brute-force definition', () => {
  it('FR-204 FR-205 an island with no obstacles gets the box above it (gap 2.5, no leader)', () => {
    const { p, pieces } = setOfUnits(rectUnits(30, 30, 4, 4), 80, 80);
    const { got, want } = both(p, pieces, 3, 5, []);
    expectSame(got, want, 'island');
    // M = 2, h = 5: the box must end above y = 30.5 - 2, that is y0 + 5 + 2 < 30.5, y0 = 23; gap 2.5
    expect(got!.gap2).toBe(6.25);
    expect(got!.box.h).toBe(5);
    expect(got!.box.w).toBe(15);
    expect('leader' in got!).toBe(false);
  });

  it('FR-204 FR-205 FR-207 random sets, obstacles, heights and aspects equal the reference (box, gap, anchor, leader)', () => {
    const next = rng(2024);
    let defined = 0;
    let withLeader = 0;
    for (let i = 0; i < 28; i++) {
      const blob = blobUnits(100 + i, 22);
      const units = blob.map(([x, y]) => [x + 13, y + 13] as const);
      const { p, pieces } = setOfUnits(units, 48, 48);
      const subset = i % 2 === 0 ? pieces : [pieces[0]!];
      const aspect = 1.5 + Math.floor(next() * 5) / 2;
      const h = 3 + Math.floor(next() * 7);
      const obstacles: Obstacle[] = [];
      for (let k = 0; k < 4; k++) {
        const kind = Math.floor(next() * 3);
        const cx = Math.floor(next() * 48);
        const cy = Math.floor(next() * 48);
        const oh = 2 + Math.floor(next() * 8);
        if (kind === 0) obstacles.push(horizontal(cx, cy, oh, oh * 2));
        else if (kind === 1) obstacles.push({ shape: 'off-land', box: { x0: cx, y0: cy, h: oh, w: oh * 3 }, gap2: 0, anchor: 0 });
        else obstacles.push({ shape: 'straight', cx: cx + 0.5, cy: cy + 0.5, angle: ([-75, -45, 0, 30, 90] as const)[Math.floor(next() * 5)]!, h: oh, w: oh * 4 });
      }
      const { got, want } = both(p, subset, aspect, h, obstacles);
      expectSame(got, want, `grid ${i}`);
      if (want !== undefined) defined++;
      if (want?.leader !== undefined) withLeader++;
    }
    console.log(`label-offland: ${defined} of 28 random searches found a box, ${withLeader} with a leader`);
    expect(defined).toBeGreaterThan(10);
  });

  it('FR-204 an arc obstacle blocks like its pinned membership (reference equality)', () => {
    const { p, pieces } = setOfUnits(rectUnits(20, 36, 6, 6), 60, 60);
    const radius = 12 / ((30 * Math.PI) / 180);
    const arc: ArcFrame = { shape: 'arc', cx: 24.5, cy: 28.5, angle: 0, h: 6, w: 20, bend: 30, radius };
    const { got, want } = both(p, pieces, 2, 5, [arc]);
    expectSame(got, want, 'arc obstacle');
    expect(got).toBeDefined();
    // the chosen box really avoids the arc
    const b = got!.box;
    for (let j = 0; j < 60; j++) {
      for (let i = 0; i < 60; i++) {
        const px = i + 0.5;
        const py = j + 0.5;
        if (b.x0 - M <= px && px <= b.x0 + b.w + M && b.y0 - M <= py && py <= b.y0 + b.h + M) expect(inArc(arc, M, px, py), `${i},${j}`).toBe(false);
      }
    }
  });

  it('FR-204 the grown box must lie inside the image: a set in the corner gets a box whose grown box is inside', () => {
    const { p, pieces } = setOfUnits(rectUnits(1, 1, 2, 2), 40, 40);
    const { got, want } = both(p, pieces, 3, 5, []);
    expectSame(got, want, 'corner');
    expect(got).toBeDefined();
    const b = got!.box;
    expect(b.x0 - M).toBeGreaterThanOrEqual(0);
    expect(b.y0 - M).toBeGreaterThanOrEqual(0);
    expect(b.x0 + b.w + M).toBeLessThanOrEqual(40);
    expect(b.y0 + b.h + M).toBeLessThanOrEqual(40);
    // above and left are impossible (no room for the margin), so the box is right of or below the set
    expect(b.x0 + b.w + M > 3 || b.y0 + b.h + M > 3).toBe(true);
  });

  it('FR-204 a box wider than the image has no acceptable position', () => {
    const { p, pieces } = setOfUnits(rectUnits(10, 10, 2, 2), 30, 30);
    expect(offLandBox(p, pieces, 3, 18, [], PARAMS, SP)).toBeUndefined(); // w = 54 > 30
  });

  it('FR-204 the grown box may not hold a unit of the own set; other pieces of the same entry are allowed', () => {
    // piece A: 2 x 2 at (20, 20); piece B: a ring of units at distance 2 around it (not 4-adjacent to A)
    const ring: Unit[] = [];
    for (let k = 17; k <= 24; k++) ring.push([k, 17], [k, 24], [17, k], [24, k]);
    const unique = [...new Map(ring.map((u) => [`${u[0]},${u[1]}`, u])).values()];
    const a = rectUnits(20, 20, 2, 2);
    const { p, piecesOf } = multiSets([a, unique], 60, 60);
    const own = piecesOf[0]!;
    const { got, want } = both(p, own, 2, 3, []);
    expectSame(got, want, 'ring');
    expect(got).toBeDefined();
    const b = got!.box;
    // the box lands on units of the other piece (the ring), which is allowed, and on no unit of A
    const inGrown = (x: number, y: number): boolean => b.x0 - M <= x + 0.5 && x + 0.5 <= b.x0 + b.w + M && b.y0 - M <= y + 0.5 && y + 0.5 <= b.y0 + b.h + M;
    expect(a.some(([x, y]) => inGrown(x, y))).toBe(false);
    expect(unique.some(([x, y]) => inGrown(x, y))).toBe(true);
  });
});

describe('FR-204 FR-207 the reach limit Dr and the leader threshold Gl', () => {
  // One unit at (60, 30) in a 100 x 60 image; a wall (a box obstacle) covers x >= wx over the whole height, so the
  // nearest free box lies left of it: x0 = wx - 12, y0 = 28 (centred on the unit), gap = 65 - wx.
  const unit = [[60, 30]] as const;
  const wallScan = (wx: number) => {
    const { p, pieces } = setOfUnits(unit, 100, 60);
    const wall = horizontal(wx, 0, 60, 100 - wx);
    return both(p, pieces, 1.5, 5, [wall]);
  };

  it('FR-204 a gap of exactly Dr (squared 576) is accepted and a larger one refused, in agreement with the reference', () => {
    const accepted = wallScan(41);
    expectSame(accepted.got, accepted.want, 'wx 41');
    expect(accepted.got!.gap2).toBe(576);
    expect(accepted.got!.box).toStrictEqual({ x0: 29, y0: 28, h: 5, w: 7.5 });
    const refused = wallScan(40);
    expect(refused.want).toBeUndefined();
    expect(refused.got).toBeUndefined();
    for (let wx = 30; wx <= 60; wx++) {
      const { got, want } = wallScan(wx);
      expectSame(got, want, `wx ${wx}`);
    }
  });

  it('FR-207 a leader line exists exactly when the squared gap is above 36, with its end points', () => {
    let atLimit = 0;
    let above = 0;
    for (let wx = 41; wx <= 59; wx++) {
      const { got, want } = wallScan(wx);
      expectSame(got, want, `wx ${wx}`);
      const gap2 = got!.gap2;
      expect(gap2, `wx ${wx}`).toBe((65 - wx) * (65 - wx));
      expect('leader' in got!, `wx ${wx}`).toBe(gap2 > 36);
      if (gap2 === 36) atLimit++;
      if (gap2 > 36) {
        above++;
        const b = got!.box;
        expect(got!.leader, `wx ${wx}`).toStrictEqual({ x1: b.x0 + b.w, y1: 30.5, x2: 60.5, y2: 30.5 });
      }
    }
    expect(atLimit).toBe(1);
    expect(above).toBeGreaterThan(10);
    // the anchor is the unit itself (row-major index 30 * 100 + 60)
    expect(wallScan(50).got!.anchor).toBe(3060);
  });

  it('FR-207 leaderLine runs from the box point nearest to the anchor centre to that centre (clamped on both axes)', () => {
    const box: LabelBox = { x0: 10, y0: 20, h: 5, w: 10 };
    expect(leaderLine(box, 30.5, 22.5)).toStrictEqual({ x1: 20, y1: 22.5, x2: 30.5, y2: 22.5 });
    expect(leaderLine(box, 4.5, 40.5)).toStrictEqual({ x1: 10, y1: 25, x2: 4.5, y2: 40.5 });
    expect(leaderLine(box, 15.5, 10.5)).toStrictEqual({ x1: 15.5, y1: 20, x2: 15.5, y2: 10.5 });
  });
});

describe('FR-205 the tie order of the off-land boxes', () => {
  it('FR-205 equal gaps and equal centre distances are decided by the smallest y0, then the smallest x0', () => {
    const { p, pieces } = setOfUnits([[40, 40]], 90, 90);
    const { got, want } = both(p, pieces, 2, 5, []);
    expectSame(got, want, 'single unit');
    // above and below tie on gap (2.5) and on distance (5); two x0 tie on distance 0.5; the first wins
    expect(got!.box).toStrictEqual({ x0: 35, y0: 33, h: 5, w: 10 });
    expect(got!.gap2).toBe(6.25);
  });

  it('FR-205 the anchor is the first nearest unit in row-major order, not in column-major order', () => {
    // units (10, 20) and (20, 10) are at the same squared gap 270.5 from this box; row-major first is (20, 10)
    const width = 50;
    const units = [20 + 10 * width, 10 + 20 * width];
    const found = nearestUnit(width, units, 3, 3, 2, 2);
    const flipped = nearestUnit(width, [...units].reverse(), 3, 3, 2, 2);
    expect(found.gap2).toBe(flipped.gap2);
    expect(found.anchor).toBe(20 + 10 * width);
    expect(flipped.anchor).toBe(20 + 10 * width);
    // a unit at the same gap but a larger index never replaces it
    const same = nearestUnit(width, [10 + 20 * width, 20 + 10 * width], 3, 3, 2, 2);
    expect(same.anchor).toBe(20 + 10 * width);
  });
});

describe('FR-205 D7 the gap and the anchor over the boundary units equal those over all units', () => {
  it('FR-205 boundaryUnits lists exactly the units with a 4-neighbour outside the set (image edge included), ascending', () => {
    const { p, pieces } = setOfUnits(rectUnits(0, 0, 3, 3), 10, 10);
    expect(Array.from(boundaryUnits(p, pieces))).toStrictEqual([0, 1, 2, 10, 12, 20, 21, 22]);
  });

  it('FR-205 for random sets and boxes holding no unit, the nearest unit over the boundary equals that over every unit', () => {
    const next = rng(77);
    let checked = 0;
    for (let i = 0; i < 20; i++) {
      const units = blobUnits(300 + i, 22).map(([x, y]) => [x + 10, y + 10] as const);
      const { p, pieces } = setOfUnits(units, 44, 44);
      const all = unitsOf(p, pieces)
        .map(([x, y]) => y * p.width + x)
        .sort((a, b) => a - b);
      const border = Array.from(boundaryUnits(p, pieces));
      const inSet = new Set(all);
      for (let k = 0; k < 40; k++) {
        const h = 2 + Math.floor(next() * 6);
        const w = h * (1.5 + Math.floor(next() * 4) / 2);
        const x0 = Math.floor(next() * 40);
        const y0 = Math.floor(next() * 40);
        // the box holds no unit centre of the set
        let holds = false;
        for (let y = Math.floor(y0); y <= y0 + h && !holds; y++) {
          for (let x = Math.floor(x0); x <= x0 + w; x++) if (x + 0.5 >= x0 && x + 0.5 <= x0 + w && y + 0.5 >= y0 && y + 0.5 <= y0 + h && inSet.has(y * p.width + x)) holds = true;
        }
        if (holds) continue;
        expect(nearestUnit(p.width, border, x0, y0, w, h), `${i}/${k}`).toStrictEqual(nearestUnit(p.width, all, x0, y0, w, h));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(300);
  });
});

describe('FR-203 FR-205 FR-206 FR-215 the placement of the labels of one role', () => {
  const H = 5; // the hand fixtures below are built for 5; the tunable SHAPE_PARAMS value (3) is not needed here

  /** Two single-unit islands and a roomy image. */
  const islands = (a: Unit, b: Unit) => multiSets([[a], [b]], 80, 80);
  const label = (p: PieceIndex, pieces: number[], aspect: number, inLand: InLandFrame | undefined): RoleLabel => ({ pieces, aspect, inLand });

  it('FR-203 a label with an in-land height below offLandHeight is searched, one at offLandHeight is not (and no frame is searched)', () => {
    const { p, piecesOf } = multiSets([rectUnits(30, 30, 20, 12)], 90, 90);
    const pieces = piecesOf[0]!;
    const box = (h: number): InLandFrame => horizontal(33, 33, h, h * 3);
    const below = placeRole(p, [label(p, pieces, 3, box(H - 1))], H, PARAMS, SP);
    expect(below[0]?.shape).toBe('off-land');
    const at = placeRole(p, [label(p, pieces, 3, box(H))], H, PARAMS, SP);
    expect(at).toStrictEqual([undefined]);
    // a shaped frame at offLandHeight is kept; one below is searched; both as straight frames
    const straight = (h: number): InLandFrame => ({ shape: 'straight', cx: 40.5, cy: 36.5, angle: 0, h, w: h * 3 });
    expect(placeRole(p, [label(p, pieces, 3, straight(H))], H, PARAMS, SP)).toStrictEqual([straight(H)]);
    expect(placeRole(p, [label(p, pieces, 3, straight(H - 1))], H, PARAMS, SP)[0]?.shape).toBe('off-land');
    // no in-land frame at all
    expect(placeRole(p, [label(p, pieces, 3, undefined)], H, PARAMS, SP)[0]?.shape).toBe('off-land');
  });

  it('FR-205 each placement sees the boxes before it: a later label is pushed away, and the order matters', () => {
    const { p, piecesOf } = islands([40, 30], [40, 36]);
    const [pa, pb] = piecesOf as [number[], number[]];
    const la = label(p, pa, 2, undefined);
    const lb = label(p, pb, 2, undefined);
    const solo = (l: RoleLabel): OffLand => offLandBox(p, l.pieces, l.aspect, H, [], PARAMS, SP)!;
    const forward = placeRole(p, [la, lb], H, PARAMS, SP) as OffLand[];
    const backward = placeRole(p, [lb, la], H, PARAMS, SP) as OffLand[];
    // sequential references
    const wantA = refOffLand(unitsOf(p, pa), 80, 80, 2, H, [], M, SP)!;
    const wantB = refOffLand(unitsOf(p, pb), 80, 80, 2, H, [{ shape: 'off-land', box: wantA.box }], M, SP)!;
    expectSame(forward[0] ?? undefined, wantA, 'A first');
    expectSame(forward[1] ?? undefined, wantB, 'B second');
    expect(forward[0]).toStrictEqual(solo(la));
    expect(forward[1]!.box).not.toStrictEqual(solo(lb).box); // pushed away by A's box
    expect(backward[0]!.box).toStrictEqual(solo(lb).box);
    expect(backward[1]!.box).not.toStrictEqual(solo(la).box);
    // no two placed boxes conflict
    const conflict = (a: OffLand, b: OffLand): boolean => {
      for (let j = 0; j < 80; j++) {
        for (let i = 0; i < 80; i++) if (refInObstacle(a, M, i + 0.5, j + 0.5) && refInObstacle(b, M, i + 0.5, j + 0.5)) return true;
      }
      return false;
    };
    expect(conflict(forward[0]!, forward[1]!)).toBe(false);
    expect(conflict(backward[0]!, backward[1]!)).toBe(false);
  });

  it('FR-215 the in-land frame of a later label that itself goes off-land still blocks an earlier label', () => {
    // label 0: a 2 x 2 island. Its free best box is found first; label 1 is a set around that spot whose in-land box is
    // only 3 high (below offLandHeight, so label 1 goes off-land itself) and overlaps it.
    const small = rectUnits(36, 44, 2, 2);
    const solo = setOfUnits(small, 90, 90);
    const free = offLandBox(solo.p, solo.pieces, 3, H, [], PARAMS, SP)!;
    const inLand = horizontal(free.box.x0 + 2, free.box.y0 + 1, 3, 9);
    const big = rectUnits(free.box.x0, free.box.y0 - 1, 13, 7); // the grown footprint of the in-land box, all of it set
    const { p, piecesOf } = multiSets([small, big], 90, 90);
    const l0 = label(p, piecesOf[0]!, 3, undefined);
    const l1 = label(p, piecesOf[1]!, 3, inLand);
    const result = placeRole(p, [l0, l1], H, PARAMS, SP) as OffLand[];
    const want = refOffLand(unitsOf(p, piecesOf[0]!), 90, 90, 3, H, [refOf(inLand)], M, SP)!;
    expectSame(result[0], want, 'label 0 sees the in-land frame of label 1');
    expect(result[0]!.box).not.toStrictEqual(free.box); // the free spot is blocked by a label that comes later
    // and label 1 sees the box of label 0 (placed before it); its own in-land frame is harmless
    const want1 = refOffLand(unitsOf(p, piecesOf[1]!), 90, 90, 3, H, [refOf(inLand), { shape: 'off-land', box: want.box }], M, SP)!;
    expectSame(result[1], want1, 'label 1');
  });

  it('FR-206 when no off-land box is acceptable the shaped in-land frame is kept, else nothing', () => {
    const { p, piecesOf } = multiSets([rectUnits(10, 10, 2, 2), rectUnits(20, 20, 2, 2)], 30, 30);
    const tiny: InLandFrame = { shape: 'straight', cx: 10.5, cy: 10.5, angle: 0, h: 1, w: 3 };
    const forFaction = SP.offLandHeight.faction; // 18: the box (w = 54) cannot fit in a 30-wide image
    const placed = placeRole(p, [label(p, piecesOf[0]!, 3, tiny), label(p, piecesOf[1]!, 3, undefined)], forFaction, PARAMS, SP);
    expect(placed[0]).toStrictEqual(tiny);
    expect(placed[1]).toBeUndefined();
    // a horizontal in-land frame that finds no off-land box is the 005 box: nothing is placed (D3)
    const flat = placeRole(p, [label(p, piecesOf[0]!, 3, horizontal(9, 9, 1, 3))], forFaction, PARAMS, SP);
    expect(flat).toStrictEqual([undefined]);
  });

  it('FR-206 FR-215 an off-land box never conflicts with an in-land frame of the same role (fallback frames included)', () => {
    const { p, piecesOf } = multiSets([rectUnits(30, 30, 6, 6), rectUnits(40, 30, 3, 3)], 80, 80);
    const shapedFrame: InLandFrame = { shape: 'straight', cx: 32.5, cy: 32.5, angle: 0, h: 2, w: 4 };
    const result = placeRole(p, [label(p, piecesOf[1]!, 3, undefined), label(p, piecesOf[0]!, 2, shapedFrame)], H, PARAMS, SP);
    const off = result[0] as OffLand;
    expect(off.shape).toBe('off-land');
    for (let j = 0; j < 80; j++) {
      for (let i = 0; i < 80; i++) {
        const px = i + 0.5;
        const py = j + 0.5;
        if (refInObstacle(off, M, px, py)) expect(inStraight(shapedFrame as StraightFrame, M, px, py), `${i},${j}`).toBe(false);
      }
    }
  });
});
