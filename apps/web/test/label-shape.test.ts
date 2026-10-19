import { describe, expect, it } from 'vitest';
import { DISC_EPS, arcExists, arcFootprint, straightFootprint, arcRadius, cosK, discAllows, inArc, inLandFrame, inStraight, shapedCandidate, shapedHeight, squaredDistanceMap } from '../src/core/label-shape';
import type { ArcFrame, Footprint, InLandFrame, ShapedFrame, StraightFrame } from '../src/core/label-shape';
import { factionBoxes, fitLabel } from '../src/core/label-layout';
import type { LabelBox } from '../src/core/label-layout';
import { LABEL_PARAMS } from '../src/core/label-params';
import { SHAPE_PARAMS } from '../src/core/shape-params';
import { geometricArc, geometricStraight, refInLand, refShapedSearch } from './helpers/label-reference';
import { rng } from './helpers/label-grids';
import { arcBandUnits, bandUnits, blobUnits, rectUnits, setOfUnits } from './helpers/shaped-grids';
import type { Unit } from './helpers/shaped-grids';

const ANGLES = [-75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75, 90] as const;
const M = 2;
const straight = (cx: number, cy: number, angle: number, h: number, w: number): StraightFrame => ({ shape: 'straight', cx, cy, angle, h, w });
const arc = (cx: number, cy: number, angle: number, h: number, w: number, bend: number, radius: number): ArcFrame => ({
  shape: 'arc',
  cx,
  cy,
  angle,
  h,
  w,
  bend,
  radius,
});

describe('FR-199 NFR-39 straight frame membership', () => {
  it('FR-199 points exactly on the edge of the grown rectangle are inside, one ulp-scale step beyond is outside (angle 0)', () => {
    const f = straight(50.5, 40.5, 0, 6, 18); // grown half-length 11, half-height 5
    for (const [px, py] of [[61.5, 40.5], [39.5, 40.5], [50.5, 45.5], [50.5, 35.5], [61.5, 45.5], [39.5, 35.5]] as const) {
      expect(inStraight(f, M, px, py), `${px},${py}`).toBe(true);
    }
    for (const [px, py] of [[61.5000001, 40.5], [39.4999999, 40.5], [50.5, 45.5000001], [50.5, 35.4999999]] as const) {
      expect(inStraight(f, M, px, py), `${px},${py}`).toBe(false);
    }
  });

  it('FR-199 at +90 the rectangle runs along y and x is the height direction (edges exact)', () => {
    const f = straight(30.5, 50.5, 90, 4, 12); // along y: half-length 8; across x: half-height 4
    expect(inStraight(f, M, 30.5, 58.5)).toBe(true);
    expect(inStraight(f, M, 30.5, 42.5)).toBe(true);
    expect(inStraight(f, M, 34.5, 50.5)).toBe(true);
    expect(inStraight(f, M, 26.5, 50.5)).toBe(true);
    expect(inStraight(f, M, 30.5, 58.6)).toBe(false);
    expect(inStraight(f, M, 34.6, 50.5)).toBe(false);
  });

  it('FR-199 at +45 the reading direction goes up and to the right (map y grows downwards)', () => {
    const f = straight(40.5, 40.5, 45, 2, 40);
    expect(inStraight(f, M, 40.5 + 15, 40.5 - 15)).toBe(true);
    expect(inStraight(f, M, 40.5 - 15, 40.5 + 15)).toBe(true);
    expect(inStraight(f, M, 40.5 + 15, 40.5 + 15)).toBe(false);
    expect(inStraight(f, M, 40.5 - 15, 40.5 - 15)).toBe(false);
  });

  it('FR-199 the decision equals the trigonometric geometry away from the edges, for every angle', () => {
    const next = rng(9);
    for (const angle of ANGLES) {
      for (let i = 0; i < 4; i++) {
        const f = straight(40.5 + Math.floor(next() * 5), 40.5 + Math.floor(next() * 5), angle, 2 + Math.floor(next() * 10), 6 + Math.floor(next() * 30));
        let inside = 0;
        const wrong: string[] = [];
        for (let py = 0.5; py < 80; py++) {
          for (let px = 0.5; px < 80; px++) {
            const expected = geometricStraight(f, M, px, py);
            if (expected === undefined) continue;
            if (inStraight(f, M, px, py) !== expected) wrong.push(`${px},${py}`);
            if (expected) inside++;
          }
        }
        expect(wrong, `angle ${angle}`).toStrictEqual([]);
        expect(inside).toBeGreaterThan(10);
      }
    }
  });

  it('FR-199 an angle that is not a table value is refused', () => {
    expect(() => inStraight(straight(1, 1, 10, 2, 4), M, 1, 1)).toThrow(RangeError);
  });
});

describe('FR-199 NFR-39 the cosine polynomial K', () => {
  it('NFR-39 K(0) = 1 and K is within 1e-13 of cos on [0, pi / 2 + 1]', () => {
    expect(cosK(0)).toBe(1);
    const top = Math.PI / 2 + 1;
    for (let i = 0; i <= 2000; i++) {
      const phi = (top * i) / 2000;
      expect(Math.abs(cosK(phi) - Math.cos(phi)), `phi ${phi}`).toBeLessThan(1e-13);
    }
  });

  it('NFR-39 K is the nested polynomial with the denominators (2k - 1)(2k), evaluated from the innermost bracket', () => {
    const z = 0.7 * 0.7;
    let t = 1 - z / 552;
    for (const d of [462, 380, 306, 240, 182, 132, 90, 56, 30, 12, 2]) t = 1 - (z / d) * t;
    expect(cosK(0.7)).toBe(t);
  });
});

describe('FR-199 arc frame existence', () => {
  it('FR-199 no arc exists when the extent is 0', () => {
    expect(arcExists(arc(30.5, 30.5, 0, 2, 4, 30, 100), 0, M)).toBe(false);
  });

  it('FR-199 the inner radius R - h / 2 - M must be positive', () => {
    expect(arcExists(arc(50.5, 50.5, 0, 15, 10, 30, 10), 100, M)).toBe(true); // 10 - 7.5 - 2 = 0.5
    expect(arcExists(arc(50.5, 50.5, 0, 16, 10, 30, 10), 100, M)).toBe(false); // 10 - 8 - 2 = 0
    expect(arcExists(arc(50.5, 50.5, 0, 17, 10, 30, 10), 100, M)).toBe(false);
  });

  it('FR-199 the ends must not turn past the reading range: theta - alpha > -90 and theta + alpha <= 90', () => {
    // alpha = (w * |bend|) / (2 * L): w 100, bend 30, L 100 -> 15 exactly
    expect(arcExists(arc(50.5, 50.5, 75, 4, 100, 30, 190), 100, M)).toBe(true); // 75 + 15 = 90 is allowed
    expect(arcExists(arc(50.5, 50.5, 75, 4, 101, 30, 190), 100, M)).toBe(false);
    expect(arcExists(arc(50.5, 50.5, -75, 4, 100, 30, 190), 100, M)).toBe(false); // -75 - 15 = -90 is not
    expect(arcExists(arc(50.5, 50.5, -75, 4, 99, 30, 190), 100, M)).toBe(true);
    expect(arcExists(arc(50.5, 50.5, 90, 4, 1, 30, 190), 100, M)).toBe(false); // nothing exists at +90
    expect(arcExists(arc(50.5, 50.5, 0, 4, 1000, -60, 190), 100, M)).toBe(false); // alpha 300
    expect(arcExists(arc(50.5, 50.5, 0, 4, 100, -60, 190), 100, M)).toBe(true); // the sign of the bend plays no part
  });

  it('FR-199 the radius is L / b with b = (|bend| * PI) / 180', () => {
    expect(arcRadius(100, 30)).toBe(100 / ((30 * Math.PI) / 180));
    expect(arcRadius(100, -60)).toBe(100 / ((60 * Math.PI) / 180));
  });
});

describe('FR-199 NFR-39 arc frame membership', () => {
  it('FR-199 the middle point and the points on the radial edges are inside, beyond them outside (theta 0, bend > 0)', () => {
    const f = arc(50.5, 40.5, 0, 6, 18, 30, 40); // circle centre (50.5, 0.5); radial limits 35 - 2 and 45 + 2 -> 35..45 with h/2 = 3, M = 2
    expect(inArc(f, M, 50.5, 40.5)).toBe(true);
    expect(inArc(f, M, 50.5, 40.5 + 3 + M)).toBe(true); // r = 45, exactly the outer limit
    expect(inArc(f, M, 50.5, 40.5 - 3 - M)).toBe(true); // r = 35, exactly the inner limit
    expect(inArc(f, M, 50.5, 40.5 + 3 + M + 1e-6)).toBe(false);
    expect(inArc(f, M, 50.5, 40.5 - 3 - M - 1e-6)).toBe(false);
  });

  it('FR-199 the ends of the middle line lie inside and the points past the grown ends outside', () => {
    const f = arc(50.5, 40.5, 0, 6, 18, 30, 40);
    const o = { x: 50.5, y: 0.5 };
    const at = (angle: number, r: number) => [o.x + r * Math.sin(angle), o.y + r * Math.cos(angle)] as const;
    const phi = (18 + 2 * M) / (2 * 40);
    const [ex, ey] = at(phi - 1e-6, 40);
    expect(inArc(f, M, ex, ey)).toBe(true);
    const [fx, fy] = at(phi + 1e-6, 40);
    expect(inArc(f, M, fx, fy)).toBe(false);
    const [gx, gy] = at(-(phi - 1e-6), 40);
    expect(inArc(f, M, gx, gy)).toBe(true);
    const [hx, hy] = at(-(phi + 1e-6), 40);
    expect(inArc(f, M, hx, hy)).toBe(false);
  });

  it('FR-199 a point exactly on the angular edge is inside (zero length and margin: K(0) = 1 gives equality)', () => {
    const f = arc(50.5, 40.5, 0, 6, 0, 30, 40);
    expect(inArc(f, 0, 50.5, 40.5)).toBe(true);
    expect(inArc(f, 0, 50.5 + 1e-6, 40.5)).toBe(false);
    expect(inArc(f, 0, 50.5 - 1e-6, 40.5)).toBe(false);
  });

  it('FR-199 a bend < 0 puts the circle centre on the other side (a cap), and the points behind the circle centre are outside', () => {
    const cup = arc(50.5, 40.5, 0, 6, 18, 30, 40);
    const cap = arc(50.5, 40.5, 0, 6, 18, -30, 40);
    expect(inArc(cup, M, 50.5, 30.5)).toBe(false);
    expect(inArc(cap, M, 50.5, 50.5)).toBe(false);
    expect(inArc(cup, M, 50.5, 43.5)).toBe(true);
    expect(inArc(cap, M, 50.5, 37.5)).toBe(true);
    expect(inArc(cup, M, 50.5, 37.5)).toBe(true);
    expect(inArc(cap, M, 50.5, 43.5)).toBe(true);
    // far from the middle along the circle: the cup rises, the cap falls
    expect(inArc(cup, M, 50.5 + 8, 40.5 - 0.8)).toBe(true);
    expect(inArc(cap, M, 50.5 + 8, 40.5 + 0.8)).toBe(true);
  });

  it('FR-199 the decision equals the trigonometric geometry away from the edges, for every angle and both signs', () => {
    const next = rng(21);
    for (const angle of ANGLES) {
      for (const bend of [30, -30, 60, -60]) {
        const h = 2 + Math.floor(next() * 6);
        const w = 8 + Math.floor(next() * 24);
        const radius = 25 + Math.floor(next() * 40);
        const f = arc(40.5 + Math.floor(next() * 5), 40.5 + Math.floor(next() * 5), angle, h, w, bend, radius);
        let inside = 0;
        const wrong: string[] = [];
        for (let py = -40.5; py < 120; py++) {
          for (let px = -40.5; px < 120; px++) {
            const expected = geometricArc(f, M, px, py);
            if (expected === undefined) continue;
            if (inArc(f, M, px, py) !== expected) wrong.push(`${px},${py}`);
            if (expected) inside++;
          }
        }
        expect(wrong, `angle ${angle} bend ${bend}`).toStrictEqual([]);
        expect(inside, `angle ${angle} bend ${bend}`).toBeGreaterThan(10);
      }
    }
  });

  it('FR-199 the centre of every frame lies in its own grown footprint, so only units of the set can be centres', () => {
    const next = rng(77);
    for (const angle of ANGLES) {
      for (let i = 0; i < 6; i++) {
        const h = 1 + Math.floor(next() * 12);
        const w = 1 + Math.floor(next() * 40);
        const margin = 1 + Math.floor(next() * 3);
        const cx = 20.5 + Math.floor(next() * 9);
        const cy = 20.5 + Math.floor(next() * 9);
        expect(inStraight(straight(cx, cy, angle, h, w), margin, cx, cy)).toBe(true);
        for (const bend of [30, -30, 60, -60]) {
          const radius = 15 + Math.floor(next() * 80);
          expect(inArc(arc(cx, cy, angle, h, w, bend, radius), margin, cx, cy), `angle ${angle} bend ${bend}`).toBe(true);
        }
      }
    }
  });
});

const sp = SHAPE_PARAMS;
const lp = (margin: number, maxHeight: number) => ({ margin, maxHeight });

/** Set, 005 horizontal box and the three results to compare, for units given by whole coordinates. */
function searchOf(units: readonly Unit[], aspect: number, params: { margin: number; maxHeight: number }, width?: number, height?: number) {
  const { p, pieces } = setOfUnits(units, width, height);
  const hBox = fitLabel(p, pieces, aspect, params);
  return { p, pieces, hBox, got: inLandFrame(p, pieces, aspect, hBox, params, sp), expected: refInLand(units, aspect, params, sp, hBox) };
}

describe('FR-198 NFR-38 the squared distance map and the disc filter', () => {
  it('NFR-38 the squared distance to the nearest non-set unit centre equals the brute force, window with a one-unit ring', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const units = blobUnits(seed, 20);
      const { p, pieces } = setOfUnits(units, 24, 24);
      const map = squaredDistanceMap(p, pieces);
      const inSet = new Set(units.map(([x, y]) => `${x},${y}`));
      const minX = Math.min(...units.map((u) => u[0]));
      const minY = Math.min(...units.map((u) => u[1]));
      const maxX = Math.max(...units.map((u) => u[0]));
      const maxY = Math.max(...units.map((u) => u[1]));
      expect([map.x0, map.y0, map.w, map.h], `seed ${seed}`).toStrictEqual([minX - 1, minY - 1, maxX - minX + 3, maxY - minY + 3]);
      const wrong: string[] = [];
      for (let y = map.y0; y < map.y0 + map.h; y++) {
        for (let x = map.x0; x < map.x0 + map.w; x++) {
          let best = 0;
          if (inSet.has(`${x},${y}`)) {
            best = Infinity;
            for (let qy = map.y0 - 40; qy < map.y0 + map.h + 40; qy++) {
              for (let qx = map.x0 - 40; qx < map.x0 + map.w + 40; qx++) {
                if (inSet.has(`${qx},${qy}`)) continue;
                best = Math.min(best, (qx - x) * (qx - x) + (qy - y) * (qy - y));
              }
            }
          }
          if (map.d2[(y - map.y0) * map.w + (x - map.x0)] !== best) wrong.push(`${x},${y}`);
        }
      }
      expect(wrong, `seed ${seed}`).toStrictEqual([]);
    }
  });

  it('NFR-38 a set touching the image edge counts the outside as non-set', () => {
    const { p, pieces } = setOfUnits(rectUnits(0, 0, 5, 5), 5, 5);
    const map = squaredDistanceMap(p, pieces);
    expect([map.x0, map.y0, map.w, map.h]).toStrictEqual([-1, -1, 7, 7]);
    expect(map.d2[(2 + 1) * 7 + (2 + 1)]).toBe(9); // the middle unit: three steps to the outside
    expect(map.d2[1 * 7 + 1]).toBe(1); // the corner unit: one step
  });

  it('NFR-38 the disc filter keeps a centre when the nearest non-set unit is at least rho - EPS away; EPS is far above rounding', () => {
    expect(DISC_EPS).toBe(1e-6);
    // sqrt(2) squared is 2.0000000000000004: without EPS a non-set unit at exactly sqrt(2) would reject the centre
    expect(Math.sqrt(2) * Math.sqrt(2)).toBeGreaterThan(2);
    expect(discAllows(2, Math.sqrt(2))).toBe(true);
    expect(discAllows(3, Math.sqrt(3))).toBe(true);
    expect(discAllows(4, 2)).toBe(true);
    expect(discAllows(3, 2)).toBe(false);
    expect(discAllows(9, 3.0000005)).toBe(true);
    expect(discAllows(9, 3.00001)).toBe(false);
    expect(discAllows(1, 0)).toBe(true);
    expect(discAllows(1, 0.0000005)).toBe(true);
  });
});

/** The offsets inside a footprint at a centre: its runs, plus the cells near an edge decided by the pinned formula. */
function footprintCells(fp: Footprint, near: (dx: number, dy: number) => boolean): Set<string> {
  const cells = new Set<string>();
  for (let i = 0; i < fp.rows.length; i += 3) {
    for (let k = 0; k < fp.rows[i + 2]!; k++) cells.add(`${fp.rows[i + 1]! + k},${fp.rows[i]!}`);
  }
  for (const [dx, dy] of fp.border) if (near(dx, dy)) cells.add(`${dx},${dy}`);
  return cells;
}

describe('FR-199 NFR-38 the footprint of a frame (runs and edge cells) equals the pinned membership', () => {
  it('FR-199 NFR-38 straight footprints equal inStraight over the whole box, at any centre (the test depends on the offset only)', () => {
    const next = rng(31);
    let checked = 0;
    for (const angle of ANGLES) {
      for (const h of [1, 2, 3, 6, 7, 12, 25]) {
        const margin = 1 + Math.floor(next() * 2);
        const w = h * (1.5 + next() * 2.5);
        const fp = straightFootprint(angle, w, h, margin);
        expect(fp.border, `angle ${angle} h ${h}`).toStrictEqual([]);
        const got = footprintCells(fp, () => false);
        const reach = Math.ceil(h / 2 + margin + w / 2 + margin) + 2;
        for (const [cx, cy] of [[0.5, 0.5], [2000.5, 3001.5]] as const) {
          const f = straight(cx, cy, angle, h, w);
          const want = new Set<string>();
          for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) if (inStraight(f, margin, cx + dx, cy + dy)) want.add(`${dx},${dy}`);
          expect([...got].sort(), `angle ${angle} h ${h} centre ${cx}`).toStrictEqual([...want].sort());
          checked += want.size;
        }
      }
    }
    expect(checked).toBeGreaterThan(10000);
  });

  it('FR-199 NFR-38 arc footprints plus the edge cells decided per centre equal inArc over the whole box, at large centres, with cells on the edges', () => {
    const next = rng(32);
    let withBorder = 0;
    let frames = 0;
    for (const angle of ANGLES) {
      if (angle === 90) continue;
      for (const bend of [30, -30, 60, -60]) {
        for (const h of [2, 3, 6, 7, 12]) {
          const margin = 1 + Math.floor(next() * 2);
          const w = h * (1.5 + next() * 2.5);
          const radius = h / 2 + margin + 8 + next() * 70;
          const proto = arc(0.5, 0.5, angle, h, w, bend, radius);
          const fp = arcFootprint(proto, margin);
          if (fp.border.length > 0) withBorder++;
          const reach = Math.ceil(h / 2 + margin + w / 2 + margin) + 2;
          for (const [cx, cy] of [[0.5, 0.5], [1234.5, 2999.5], [3500.5, 77.5]] as const) {
            const f = arc(cx, cy, angle, h, w, bend, radius);
            const got = footprintCells(fp, (dx, dy) => inArc(f, margin, cx + dx, cy + dy));
            const want = new Set<string>();
            for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) if (inArc(f, margin, cx + dx, cy + dy)) want.add(`${dx},${dy}`);
            expect([...got].sort(), `angle ${angle} bend ${bend} h ${h} centre ${cx},${cy}`).toStrictEqual([...want].sort());
            frames++;
          }
        }
      }
    }
    expect(frames).toBeGreaterThan(500);
    expect(withBorder).toBeGreaterThan(5); // axis cells with even h lie exactly on a radial edge
  });

  it('FR-199 NFR-38 an arc at angle 0 with an even height has the cells straight above and below its centre on the radial edges', () => {
    const fp = arcFootprint(arc(0.5, 0.5, 0, 2, 9, 30, 40), 1); // h / 2 + M = 2
    const keys = fp.border.map(([dx, dy]) => `${dx},${dy}`);
    expect(keys).toContain('0,2');
    expect(keys).toContain('0,-2');
  });
});

describe('FR-195 FR-197 FR-198 NFR-38 the in-land frame equals the brute-force definition', () => {
  it('FR-198 FR-197 inLandFrame, shapedCandidate and shapedHeight equal the definition on 200 fixed-seed random grids, and the grids cover the rules', () => {
    const seen = { shaped: 0, horizontal: 0, undef: 0, atBound: 0, belowBound: 0, tie: 0, tieDiffers: 0, arcs: 0, negative: 0 };
    for (let seed = 1; seed <= 200; seed++) {
      const units = blobUnits(seed, 16 + (seed % 5));
      const params = lp(seed % 2 === 0 ? 1 : 2, 5 + (seed % 4));
      const aspect = 1.5 + 0.5 * (seed % 5);
      const { p, pieces, hBox, got, expected } = searchOf(units, aspect, params);
      expect(got, `seed ${seed}`).toStrictEqual(expected);
      const ref = refShapedSearch(units, aspect, params, sp);
      expect(shapedHeight(p, pieces, aspect, params, sp), `hS seed ${seed}`).toBe(ref.hS);
      expect(shapedCandidate(p, pieces, aspect, params, sp, 1), `shaped seed ${seed}`).toStrictEqual(ref.frame);
      // the pruned search equals shapedHeight plus the G rule
      const hS = shapedHeight(p, pieces, aspect, params, sp);
      const viaRule: InLandFrame | undefined =
        hS !== undefined && (hBox === undefined || hS >= 1.5 * hBox.h)
          ? shapedCandidate(p, pieces, aspect, params, sp, 1)
          : hBox === undefined
            ? undefined
            : { shape: 'horizontal', box: hBox };
      expect(got, `rule seed ${seed}`).toStrictEqual(viaRule);
      if (got === undefined) seen.undef++;
      else if (got.shape === 'horizontal') seen.horizontal++;
      else seen.shaped++;
      if (hS !== undefined && hBox !== undefined) {
        if (hS === Math.ceil(1.5 * hBox.h)) seen.atBound++;
        if (hS === Math.ceil(1.5 * hBox.h) - 1) seen.belowBound++;
      }
      if (ref.tied.length > 1) {
        seen.tie++;
        const byY = [...ref.tied].sort((a, b) => a.cy - b.cy || a.cx - b.cx)[0]!;
        const byX = [...ref.tied].sort((a, b) => a.cx - b.cx || a.cy - b.cy)[0]!;
        if (byY.cx !== byX.cx || byY.cy !== byX.cy) seen.tieDiffers++;
      }
      if (ref.frame?.shape === 'arc') seen.arcs++;
      if (ref.frame !== undefined && ref.frame.angle < 0) seen.negative++;
    }
    // the generator must exercise every branch the mutations below depend on
    expect(seen.shaped).toBeGreaterThan(10);
    expect(seen.horizontal).toBeGreaterThan(10);
    expect(seen.atBound).toBeGreaterThan(0);
    expect(seen.belowBound).toBeGreaterThan(0);
    expect(seen.negative).toBeGreaterThan(0);
    console.log(`label-shape: random grids ${JSON.stringify(seen)}`);
  });

  it('FR-195 a horizontal in-land frame holds the very 005 box object', () => {
    const { hBox, got } = searchOf(rectUnits(2, 2, 14, 10), 3, lp(2, 20));
    expect(hBox).toBeDefined();
    expect(got?.shape).toBe('horizontal');
    expect((got as { box: LabelBox }).box).toBe(hBox);
  });

  it('FR-198 a horizontal candidate of height Hmax is always kept, whatever the shape', () => {
    const { p, pieces, hBox, got } = searchOf(rectUnits(5, 5, 40, 40), 3, lp(2, 8));
    expect(hBox?.h).toBe(8);
    expect(got).toStrictEqual({ shape: 'horizontal', box: hBox });
    expect((got as { box: LabelBox }).box).toBe(hBox);
    // a long strip with a horizontal box at Hmax: also kept although a rotated frame could be as tall
    const strip = searchOf(rectUnits(2, 2, 90, 10), 1.5, lp(2, 6));
    expect(strip.hBox?.h).toBe(6);
    expect(strip.got?.shape).toBe('horizontal');
    expect(shapedHeight(p, pieces, 3, lp(2, 8), sp)).toBe(8); // the unpruned shaped height may exist and is still not used
  });

  it('FR-198 a near-compact region stays horizontal: the shaped height is below 1.5 times the horizontal one', () => {
    const { p, pieces, hBox, got } = searchOf(rectUnits(2, 2, 14, 10), 3, lp(2, 20));
    const hS = shapedHeight(p, pieces, 3, lp(2, 20), sp);
    expect(hBox).toBeDefined();
    expect(hS === undefined || hS < 1.5 * hBox!.h).toBe(true);
    expect(got?.shape).toBe('horizontal');
  });

  it('FR-198 a label without a horizontal box takes the shaped candidate whatever its height, and none if none exists', () => {
    // a 3-unit-wide strip: no 005 box at M = 2 (needs 5 columns and 5 rows), but a frame along it needs only h + 2M <= ...
    const thin = searchOf(rectUnits(4, 4, 3, 40), 2, lp(1, 10));
    expect(thin.got).toStrictEqual(thin.expected);
    const none = searchOf(rectUnits(4, 4, 1, 1), 2, lp(2, 10));
    expect(none.hBox).toBeUndefined();
    expect(none.got).toBeUndefined();
    expect(none.expected).toBeUndefined();
  });

  it('FR-197 FR-198 a vertical strip is read from bottom to top at +90, and the even centre tie goes to the smallest y', () => {
    const units = rectUnits(10, 5, 8, 60);
    const { hBox, got } = searchOf(units, 3, lp(2, 20), 30, 70);
    expect(hBox?.h).toBe(1);
    // 8 columns hold a frame of height 3 (grown height 7) at two x positions, and the 60 rows hold 44 y positions: the
    // mean is the middle of an even run, so four frames tie; the smallest y, then the smallest x, wins
    expect(got).toStrictEqual({ shape: 'straight', cx: 13.5, cy: 34.5, angle: 90, h: 3, w: 9 });
    const ref = refShapedSearch(units, 3, lp(2, 20), sp);
    expect(ref.tied.map((f) => [f.cx, f.cy]).sort((a, b) => a[1]! - b[1]! || a[0]! - b[0]!)).toStrictEqual([
      [13.5, 34.5],
      [14.5, 34.5],
      [13.5, 35.5],
      [14.5, 35.5],
    ]);
  });

  it('FR-197 FR-198 a diagonal band is covered by the straight frame at +45', () => {
    const units: Unit[] = [];
    for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) if (Math.abs(x + y - 59) <= 3) units.push([x, y]);
    const { got, expected } = searchOf(units, 3, lp(2, 20));
    expect(got).toStrictEqual(expected);
    expect(got?.shape).toBe('straight');
    expect((got as ShapedFrame).angle).toBe(45);
  });

  it('FR-197 FR-198 a cup band (a circular band below its centre) takes a cup arc (bend > 0) and a cap band a cap arc (bend < 0)', () => {
    const cupResult = searchOf(arcBandUnits(8, 8, 40, 1), 3, lp(1, 24));
    expect(cupResult.hBox?.h).toBe(2);
    expect(cupResult.got).toStrictEqual(cupResult.expected);
    expect(cupResult.got?.shape).toBe('arc');
    expect((cupResult.got as ArcFrame).bend).toBe(60);
    expect((cupResult.got as ArcFrame).h).toBe(3);
    const capResult = searchOf(arcBandUnits(8, 8, 40, -1), 3, lp(1, 24));
    expect(capResult.got).toStrictEqual(capResult.expected);
    expect(capResult.got?.shape).toBe('arc');
    expect((capResult.got as ArcFrame).bend).toBe(-60);
  });

  it('FR-198 a thin straight run with a gentle bend keeps its horizontal box: the G rule needs a 1.5 times taller frame', () => {
    const band = searchOf(bandUnits(0, 70, 9, (x) => 4 + ((x - 35) * (x - 35)) / 28), 3, lp(2, 24));
    expect(band.got).toStrictEqual(band.expected);
    expect(band.got?.shape).toBe('horizontal');
    expect(shapedHeight(band.p, band.pieces, 3, lp(2, 24), sp)).toBeDefined();
  });

  it('FR-198 FR-199 a region on the image edge: the outside belongs to no set, the frame stays inside', () => {
    const edge = searchOf(rectUnits(0, 3, 8, 60), 3, lp(2, 20), 8, 66);
    expect(edge.got).toStrictEqual(edge.expected);
    expect(edge.got?.shape).toBe('straight');
    expect((edge.got as ShapedFrame).angle).toBe(90);
    const corner = searchOf(rectUnits(0, 0, 8, 50), 3, lp(2, 20), 8, 50);
    expect(corner.got).toStrictEqual(corner.expected);
  });

  it('FR-197 on a symmetric square the first shape in shape order wins: the straight shape at theta* - 15 before theta* + 15', () => {
    const units = rectUnits(2, 2, 30, 30);
    const params = lp(2, 20);
    const { p, pieces } = setOfUnits(units);
    const frame = shapedCandidate(p, pieces, 3, params, sp, 1);
    expect(frame).toStrictEqual(refShapedSearch(units, 3, params, sp).frame);
    expect(frame?.shape).toBe('straight');
    expect(frame?.angle).toBe(-15);
  });

  it('FR-197 the centre tie is decided by the smallest y, then the smallest x (decided exactly): a diagonal band with an even number of centres', () => {
    let cases = 0;
    for (let length = 30; length <= 44; length++) {
      const units: Unit[] = [];
      for (let y = 0; y < length; y++) for (let x = 0; x < length; x++) if (Math.abs(x + y - (length - 1)) <= 3) units.push([x, y]);
      const params = lp(2, 6);
      const { p, pieces } = setOfUnits(units);
      const ref = refShapedSearch(units, 3, params, sp);
      const frame = shapedCandidate(p, pieces, 3, params, sp, 1);
      expect(frame, `length ${length}`).toStrictEqual(ref.frame);
      const [a, b] = ref.tied;
      if (ref.tied.length === 2 && a!.cx !== b!.cx && a!.cy !== b!.cy) {
        cases++;
        const smallestY = a!.cy < b!.cy ? a! : b!;
        expect(frame).toStrictEqual(smallestY);
      }
    }
    expect(cases).toBeGreaterThan(0);
  });

  it('NFR-38 the height prune: heights below ceil(G * hH) are not searched, and the search is skipped when that exceeds Hmax', () => {
    const { p, pieces, hBox } = searchOf(rectUnits(2, 2, 14, 10), 3, lp(2, 20));
    const bound = Math.ceil(1.5 * hBox!.h);
    const params = lp(2, 20);
    const hS = shapedHeight(p, pieces, 3, params, sp);
    expect(hS).toBeDefined();
    // with a minimum height above hS nothing is returned, with one at hS the unpruned candidate is returned
    expect(shapedCandidate(p, pieces, 3, params, sp, hS! + 1)).toBeUndefined();
    expect(shapedCandidate(p, pieces, 3, params, sp, hS!)?.h).toBe(hS);
    expect(bound).toBeGreaterThan(hS!);
    // the bound ceil(1.5 * hH) of an odd height rounds up
    expect(Math.ceil(1.5 * 5)).toBe(8);
  });

  it('FR-198 an aspect or parameter that is not valid is refused as in 005', () => {
    const { p, pieces } = setOfUnits(rectUnits(2, 2, 14, 10));
    expect(() => inLandFrame(p, pieces, 0, undefined, lp(2, 20), sp)).toThrow(RangeError);
    expect(() => inLandFrame(p, pieces, Number.NaN, undefined, lp(2, 20), sp)).toThrow(RangeError);
    expect(() => inLandFrame(p, pieces, 3, undefined, lp(0, 20), sp)).toThrow(RangeError);
    expect(() => shapedCandidate(p, pieces, 3, lp(2, 0), sp, 1)).toThrow(RangeError);
  });
});

describe('FR-195 FR-197 FR-198 FR-199 NFR-38 the in-land frames of the dev map', () => {
  it('FR-195 FR-198 NFR-38 territories (aspect 3) and factions of seed 1 round 0 (aspect 4): the frames are the horizontal box or a maximal fitting shaped frame; times are logged', async () => {
    const { decodeIdPng } = await import('../src/core/png');
    const { buildEntryIndex, factionIndexOf, ownerTable } = await import('../src/core/entries');
    const { buildPieceIndex, mainPieces } = await import('../src/core/regions');
    const { sceneAt } = await import('../src/core/scene');
    const { getRounds, getState, ownerOf, totalRounds } = await import('@mbrg/sim');
    const { inflateStream } = await import('../src/ui/load');
    const { DEV_MAP, DEV_PRESENTATION, devPngBytes } = await import('./helpers/dev-map');
    const decoded = await decodeIdPng(devPngBytes(), inflateStream);
    if (!decoded.ok) throw new Error('png');
    const index = buildEntryIndex(DEV_MAP, decoded.value.width, decoded.value.height, decoded.value.values);
    const p = buildPieceIndex(index);
    const params = { margin: LABEL_PARAMS.margin, maxHeight: LABEL_PARAMS.maxHeight };

    /** Every unit centre in the grown footprint of the frame belongs to the set (an independent scan). */
    const fits = (frame: ShapedFrame, pieces: readonly number[]): boolean => {
      const inPieces = new Set(pieces);
      const reach = Math.ceil(frame.h / 2 + params.margin + frame.w / 2 + params.margin) + 1;
      for (let y = Math.floor(frame.cy) - reach; y <= Math.floor(frame.cy) + reach; y++) {
        for (let x = Math.floor(frame.cx) - reach; x <= Math.floor(frame.cx) + reach; x++) {
          const inside = frame.shape === 'straight' ? inStraight(frame, params.margin, x + 0.5, y + 0.5) : inArc(frame, params.margin, x + 0.5, y + 0.5);
          if (!inside) continue;
          if (x < 0 || y < 0 || x >= p.width || y >= p.height || !inPieces.has(p.pieceOf[y * p.width + x]!)) return false;
        }
      }
      return true;
    };
    const tally = { horizontal: 0, shaped: 0, none: 0 };
    const check = (label: string, pieces: readonly number[], aspect: number, hBox: LabelBox | undefined, got: InLandFrame | undefined): void => {
      if (got === undefined) {
        tally.none++;
        expect(hBox, label).toBeUndefined();
        return;
      }
      if (got.shape === 'horizontal') {
        tally.horizontal++;
        expect(got.box, label).toBe(hBox);
        return;
      }
      tally.shaped++;
      expect(fits(got, pieces), `${label} fits`).toBe(true);
      expect(hBox === undefined || got.h >= 1.5 * hBox.h, `${label} G rule`).toBe(true);
      // maximal: no taller shaped frame exists
      expect(shapedCandidate(p, pieces, aspect, params, sp, got.h + 1), `${label} maximal`).toBeUndefined();
    };

    const t0 = performance.now();
    const main = mainPieces(p);
    let territoryCount = 0;
    for (let entry = 1; entry < p.entries; entry++) {
      const piece = main[entry]!;
      if (piece < 0) continue;
      const hBox = fitLabel(p, [piece], 3, params);
      check(`territory ${entry}`, [piece], 3, hBox, inLandFrame(p, [piece], 3, hBox, params, sp));
      territoryCount++;
    }
    const t1 = performance.now();

    const factionIndex = factionIndexOf(DEV_MAP);
    const aspects = new Map<number, number>([...factionIndex.values()].map((f) => [f, 4]));
    const sim = { totalRounds, getState, getRounds, ownerOf };
    const scene = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, 0, sim);
    if (!scene.ok) throw new Error('scene');
    const boxes = factionBoxes(p, ownerTable(index, scene.value.owners, factionIndex), aspects, LABEL_PARAMS);
    let factionCount = 0;
    const t2 = performance.now();
    const results: Array<{ faction: number; pieces: readonly number[]; hBox: LabelBox | undefined; got: InLandFrame | undefined }> = [];
    for (const [faction, label] of boxes.labels) {
      results.push({ faction, pieces: label.pieces, hBox: label.box, got: inLandFrame(p, label.pieces, label.aspect, label.box, params, sp) });
      factionCount++;
    }
    const t3 = performance.now();
    for (const r of results) check(`faction ${r.faction}`, r.pieces, 4, r.hBox, r.got);
    console.log(
      `label-shape: dev map shaped search ${territoryCount} territories ${(t1 - t0).toFixed(0)} ms, ${factionCount} factions (seed 1 round 0) ${(t3 - t2).toFixed(0)} ms; ` +
        `frames ${JSON.stringify(tally)}`,
    );
    expect(territoryCount).toBeGreaterThan(50);
    expect(factionCount).toBeGreaterThan(0);
  }, 120000);
});

describe('FR-199 NFR-38 the arc footprint raster agrees with the pinned membership at every centre', () => {
  const centres = [[0, 0], [1, 3], [17, 5], [100, 100], [333, 777], [1500, 2000], [2047, 2047], [999, 1]] as const;

  /** Cells where the raster (runs, plus border cells decided by inArc) differs from inArc at the centre, over a window around it. */
  function disagreements(frame: ArcFrame, span: number): string[] {
    const fp = arcFootprint(frame, M);
    const inRows = new Set<string>();
    for (let i = 0; i < fp.rows.length; i += 3) for (let k = 0; k < fp.rows[i + 2]!; k++) inRows.add(`${fp.rows[i + 1]! + k},${fp.rows[i]!}`);
    const inBorder = new Set(fp.border.map(([dx, dy]) => `${dx},${dy}`));
    const wrong: string[] = [];
    for (const [x, y] of centres) {
      const at = { ...frame, cx: x + 0.5, cy: y + 0.5 };
      for (let dy = -span; dy <= span; dy++) {
        for (let dx = -span; dx <= span; dx++) {
          const want = inArc(at, M, x + dx + 0.5, y + dy + 0.5);
          const key = `${dx},${dy}`;
          if ((inRows.has(key) || (inBorder.has(key) && want)) !== want) wrong.push(`centre ${x},${y} cell ${key}`);
        }
      }
    }
    return wrong;
  }

  it('FR-199 cells within rounding of an arc edge are decided per centre, so the raster never differs from inArc (EDGE_SLACK)', () => {
    // Found by a scan with EDGE_SLACK = 0: an edge circle of this frame passes within 1e-12 of the
    // cell (7, 0) of this frame, and the pinned formula decides that cell differently at some centres.
    const frame = arc(0.5, 0.5, -30, 2, 20, 30, 40 - 39 * 1.3e-14);
    expect(disagreements(frame, 60)).toStrictEqual([]);
    // R = 50 + eps puts cells exactly on, or within a rounding step of, the inner and outer edge circles
    for (const eps of [0, 1e-14, 3e-14, 1e-13, -1e-13, -1e-12]) {
      for (const angle of [0, 90, 45] as const) {
        for (const bend of [30, -30] as const) expect(disagreements(arc(0.5, 0.5, angle, 4, 40, bend, 50 + eps), 60), `${eps} ${angle} ${bend}`).toStrictEqual([]);
      }
    }
  }, 120000);
});

describe('NFR-38 the per-shape binary search on the weaker test returns the heights of the unpruned definition', () => {
  it('NFR-38 shapedCandidate equals the brute force on circular bands of many radii, thicknesses, spans and aspects, and on diagonal bands', () => {
    const params = lp(1, 14);
    let arcs = 0;
    let straights = 0;
    let checked = 0;
    for (const sign of [1, -1] as const) {
      for (const radius of [6, 10, 14]) {
        for (const thick of [3, 6]) {
          for (const halfAngle of [30, 55, 80]) {
            for (const aspect of [2, 4.5]) {
              const units = arcBandUnits(radius, thick, halfAngle, sign);
              if (units.length === 0) continue;
              const { p, pieces } = setOfUnits(units, 200, 240);
              const got = shapedCandidate(p, pieces, aspect, params, sp, 1);
              expect(got, `sign ${sign} R ${radius} T ${thick} A ${halfAngle} a ${aspect}`).toStrictEqual(refShapedSearch(units, aspect, params, sp).frame);
              checked++;
              if (got?.shape === 'arc') arcs++;
              if (got?.shape === 'straight') straights++;
            }
          }
        }
      }
    }
    for (const slope of [0.4, 1, 2.5]) {
      const units: Unit[] = [];
      for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) if (Math.abs(y - slope * x - 4) <= 3 + slope) units.push([x, y]);
      const { p, pieces } = setOfUnits(units, 52, 52);
      expect(shapedCandidate(p, pieces, 3, params, sp, 1), `slope ${slope}`).toStrictEqual(refShapedSearch(units, 3, params, sp).frame);
      checked++;
    }
    console.log(`label-shape: binary-search sweep ${checked} sets, ${arcs} arc results, ${straights} straight results`);
    expect(arcs).toBeGreaterThan(5);
    expect(straights).toBeGreaterThan(3);
  });
});
