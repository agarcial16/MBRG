import { describe, expect, it } from 'vitest';
import { equalEarth } from '../src/importer/equal-earth';

const RAD = Math.PI / 180;
const source = (import.meta.glob('../src/importer/equal-earth.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)['../src/importer/equal-earth.ts']!;

describe('FR-600 the Equal Earth projection', () => {
  it('FR-600 is own code on the four published constants, written as literals', () => {
    for (const literal of ['1.340264', '0.081106', '0.000893', '0.003796']) expect(source, literal).toContain(literal);
    expect(source).toMatch(/Math\.sqrt\(3\) \/ 2/);
    // no import at all: nothing third party and nothing shared with the Lambert code
    expect(/^import /m.test(source)).toBe(false);
  });

  it('FR-600 matches the published extent of the map: width 5.4132 and height 2.6347 on the unit sphere', () => {
    const [east, equator] = equalEarth(Math.PI, 0);
    expect(east).toBeCloseTo(2.70659, 4);
    expect(equator).toBe(0);
    const [pole, top] = equalEarth(0, Math.PI / 2);
    expect(pole).toBe(0);
    expect(top).toBeCloseTo(1.31736, 4);
  });

  it('FR-600 puts the central meridian on x = 0 and is odd in longitude and in latitude', () => {
    for (const lat of [-80, -45, -10, 0, 12.5, 60, 89]) {
      expect(equalEarth(0, lat * RAD)[0]).toBe(0);
      for (const lon of [1, 37.5, 90, 179.9, 180]) {
        const [x, y] = equalEarth(lon * RAD, lat * RAD);
        const [xw, yw] = equalEarth(-lon * RAD, lat * RAD);
        const [, ys] = equalEarth(lon * RAD, -lat * RAD);
        expect(xw).toBeCloseTo(-x, 14);
        expect(yw).toBeCloseTo(y, 14);
        expect(ys).toBeCloseTo(-y, 14);
      }
    }
  });

  it('FR-600 keeps the poles finite: the pole is a line, theta = 60 degrees', () => {
    for (const sign of [1, -1]) {
      const [x, y] = equalEarth(Math.PI, sign * (Math.PI / 2));
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      expect(Math.abs(y)).toBeCloseTo(1.31736, 4);
      expect(x).toBeCloseTo(1.6036, 3);
    }
  });

  it('FR-600 is equal-area: the planar area of a latitude band equals the spherical one, to a relative error under 1e-9', () => {
    const bands: [number, number][] = [[-90, 90], [0, 30], [30, 60], [-20, 75], [60, 90], [-90, -45]];
    const n = 40000;
    for (const [from, to] of bands) {
      const a = from * RAD;
      const b = to * RAD;
      // planar area = the integral of the width of the band at each latitude times dy (midpoint rule on the width)
      let planar = 0;
      let previousY = equalEarth(0, a)[1];
      for (let i = 0; i < n; i++) {
        const phi = a + ((i + 1) * (b - a)) / n;
        const mid = a + ((i + 0.5) * (b - a)) / n;
        const y = equalEarth(0, phi)[1];
        const width = 2 * equalEarth(Math.PI, mid)[0];
        planar += width * (y - previousY);
        previousY = y;
      }
      const sphere = 2 * Math.PI * (Math.sin(b) - Math.sin(a));
      expect(Math.abs(planar - sphere) / sphere, `${from}..${to}`).toBeLessThan(1e-9);
    }
  });

  it('FR-600 gives the same point for the same input', () => {
    expect(equalEarth(1.2345, 0.6789)).toStrictEqual(equalEarth(1.2345, 0.6789));
  });
});
