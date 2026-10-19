import { describe, expect, it } from 'vitest';
import { arcExists, arcRadius, cosK, inArc, inStraight } from '../src/core/label-shape';
import type { ArcFrame, StraightFrame } from '../src/core/label-shape';
import { geometricArc, geometricStraight } from './helpers/label-reference';
import { rng } from './helpers/label-grids';

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
});
