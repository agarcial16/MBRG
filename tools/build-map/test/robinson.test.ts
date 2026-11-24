import { describe, expect, it } from 'vitest';
import { ROBINSON_ROWS, robinson } from '../src/core/robinson';

const RAD = Math.PI / 180;
const source = (import.meta.glob('../src/core/robinson.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)['../src/core/robinson.ts']!;

/** The standard Robinson table (Robinson 1974): latitude, length factor PLEN, distance factor PDFE. */
const TABLE: readonly (readonly [number, number, number])[] = [
  [0, 1.0, 0.0],
  [5, 0.9986, 0.062],
  [10, 0.9954, 0.124],
  [15, 0.99, 0.186],
  [20, 0.9822, 0.248],
  [25, 0.973, 0.31],
  [30, 0.96, 0.372],
  [35, 0.9427, 0.434],
  [40, 0.9216, 0.4958],
  [45, 0.8962, 0.5571],
  [50, 0.8679, 0.6176],
  [55, 0.835, 0.6769],
  [60, 0.7986, 0.7346],
  [65, 0.7597, 0.7903],
  [70, 0.7186, 0.8435],
  [75, 0.6732, 0.8936],
  [80, 0.6213, 0.9394],
  [85, 0.5722, 0.9761],
  [90, 0.5322, 1.0],
];

describe('FR-697 the Robinson projection', () => {
  it('FR-697 is own code on the published table and the two scale constants, written as literals', () => {
    for (const literal of ['0.8487', '1.3523', '0.9986', '0.5722', '0.5322', '0.9761']) expect(source, literal).toContain(literal);
    // no import at all: nothing third party and nothing shared with the other projections
    expect(/^import /m.test(source)).toBe(false);
    expect(ROBINSON_ROWS.length).toBe(19);
  });

  it('FR-697 gives the table value exactly at every row: x = 0.8487 PLEN lon, y = 1.3523 PDFE', () => {
    for (const [lat, plen, pdfe] of TABLE) {
      const lon = 1.25;
      const [x, y] = robinson(lon, lat * RAD);
      expect(x, `x at ${lat}`).toBeCloseTo(0.8487 * plen * lon, 12);
      expect(y, `y at ${lat}`).toBeCloseTo(1.3523 * pdfe, 12);
    }
  });

  it('FR-697 matches the published extent: equator width 2.6664, pole line 1.4190, height 1.3523 on the unit sphere', () => {
    const [east, equator] = robinson(Math.PI, 0);
    expect(east).toBeCloseTo(0.8487 * Math.PI, 12);
    expect(equator).toBe(0);
    const [poleEnd, top] = robinson(Math.PI, Math.PI / 2);
    expect(poleEnd).toBeCloseTo(0.8487 * 0.5322 * Math.PI, 12);
    expect(top).toBeCloseTo(1.3523, 12);
  });

  it('FR-697 puts the central meridian on x = 0 and is odd in longitude and in latitude', () => {
    for (const lat of [-89, -62.5, -33, -1, 0, 7.25, 41, 77.7, 90]) {
      expect(robinson(0, lat * RAD)[0]).toBe(0);
      for (const lon of [1, 37.5, 90, 179.9, 180]) {
        const [x, y] = robinson(lon * RAD, lat * RAD);
        const [xw, yw] = robinson(-lon * RAD, lat * RAD);
        const [xs, ys] = robinson(lon * RAD, -lat * RAD);
        expect(xw).toBeCloseTo(-x, 14);
        expect(yw).toBeCloseTo(y, 14);
        expect(xs).toBeCloseTo(x, 14);
        expect(ys).toBeCloseTo(-y, 14);
      }
    }
  });

  it('FR-697 interpolates the rows with a cubic through them: the Catmull-Rom midpoints', () => {
    // latitude 22.5: PLEN rows 15, 20, 25, 30 -> (-p0 + 9 p1 + 9 p2 - p3) / 16
    const plen = (-0.99 + 9 * 0.9822 + 9 * 0.973 - 0.96) / 16;
    const pdfe = (-0.186 + 9 * 0.248 + 9 * 0.31 - 0.372) / 16;
    const [x, y] = robinson(1, 22.5 * RAD);
    expect(x).toBeCloseTo(0.8487 * plen, 12);
    expect(y).toBeCloseTo(1.3523 * pdfe, 12);
    // the first and last interval clamp the missing row: 2.5 (mirror: PLEN even, PDFE odd) and 87.5 (end clamped)
    const first = (-0.9986 + 9 * 1 + 9 * 0.9986 - 0.9954) / 16;
    expect(robinson(1, 2.5 * RAD)[0]).toBeCloseTo(0.8487 * first, 12);
    const last = (-0.6213 + 9 * 0.5722 + 9 * 0.5322 - 0.5322) / 16;
    expect(robinson(1, 87.5 * RAD)[0]).toBeCloseTo(0.8487 * last, 12);
  });

  it('FR-697 is continuous and monotone: y rises and the length factor falls with the latitude, every 0.05 degrees', () => {
    let lastX = Infinity;
    let lastY = -Infinity;
    for (let tenth = 0; tenth <= 1800; tenth++) {
      const [x, y] = robinson(1, (tenth / 20) * RAD);
      expect(x).toBeLessThanOrEqual(lastX + 1e-12);
      expect(y).toBeGreaterThanOrEqual(lastY - 1e-12);
      if (tenth > 0) expect(Math.abs(y - lastY)).toBeLessThan(0.002);
      lastX = x;
      lastY = y;
    }
  });

  it('FR-697 keeps the poles finite and flat: every longitude at the pole has the same y', () => {
    const ys = [-180, -90, 0, 45, 180].map((lon) => robinson(lon * RAD, Math.PI / 2)[1]);
    expect(new Set(ys).size).toBe(1);
    expect(Number.isFinite(ys[0])).toBe(true);
  });

  it('NFR-181 is deterministic', () => {
    expect(robinson(2.5, 0.7)).toStrictEqual(robinson(2.5, 0.7));
  });
});
