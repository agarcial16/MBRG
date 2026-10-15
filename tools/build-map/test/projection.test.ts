import { describe, expect, it } from 'vitest';
import {
  frameFor,
  pixelSide,
  project,
  projectionCenter,
  toPixel,
  unproject,
} from '../src/core/projection';

describe('FR-114 projection centre', () => {
  it('FR-114 the centre is the midpoint of the longitude range and of the latitude range', () => {
    // The mean of the vertices would be (4, 1.33...); the range midpoints are (5, 2).
    const c = projectionCenter([
      [0, 0],
      [10, 0],
      [2, 4],
    ]);
    expect(c).toStrictEqual({ lon0: 5, lat0: 2 });
  });

  it('FR-114 the centre does not depend on the order of the vertices', () => {
    const pts: [number, number][] = [
      [-9, 36],
      [3, 51],
      [18, 47],
      [7, 38],
    ];
    expect(projectionCenter([...pts].reverse())).toStrictEqual(projectionCenter(pts));
    expect(projectionCenter(pts)).toStrictEqual({ lon0: 4.5, lat0: 43.5 });
  });
});

describe('FR-114 Lambert azimuthal equal-area projection', () => {
  const c = { lon0: 5, lat0: 42 };

  it('FR-114 the centre point projects to the origin', () => {
    const [x, y] = project(c, 5, 42);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(0, 12);
  });

  it('FR-114 known values on the equator (unit sphere)', () => {
    const eq = { lon0: 0, lat0: 0 };
    const east = project(eq, 90, 0);
    expect(east[0]).toBeCloseTo(Math.SQRT2, 12);
    expect(east[1]).toBeCloseTo(0, 12);
    const north = project(eq, 0, 90);
    expect(north[0]).toBeCloseTo(0, 12);
    expect(north[1]).toBeCloseTo(Math.SQRT2, 12);
  });

  it('FR-114 north is up and east is right (Y grows north, X grows east)', () => {
    const [x0, y0] = project(c, 5, 42);
    const [x1, y1] = project(c, 5, 44);
    const [x2, y2] = project(c, 7, 42);
    expect(y1).toBeGreaterThan(y0);
    expect(x2).toBeGreaterThan(x0);
    expect(Math.abs(x1 - x0)).toBeLessThan(1e-12);
    expect(y2).not.toBe(y0);
  });

  it('FR-114 unproject inverts project', () => {
    const pts: [number, number][] = [
      [5, 42],
      [-9.3, 36.9],
      [18.5, 47.1],
      [12, 35.5],
      [2.3, 51.1],
    ];
    for (const [lon, lat] of pts) {
      const [x, y] = project(c, lon, lat);
      const [lon2, lat2] = unproject(c, x, y);
      expect(lon2).toBeCloseTo(lon, 9);
      expect(lat2).toBeCloseTo(lat, 9);
    }
  });

  it('FR-114 the same arguments give bit-identical results', () => {
    expect(project(c, 13.37, 47.11)).toStrictEqual(project(c, 13.37, 47.11));
  });
});

describe('FR-114 frame', () => {
  it('FR-114 a wide box is expanded symmetrically along its shorter side, then by the margin', () => {
    // X 0..8, Y 0..4: square side 8, Y becomes -2..6; margin 0.25 * 8 = 2 on each side.
    const f = frameFor(
      [
        [0, 0],
        [8, 4],
        [3, 1],
      ],
      0.25,
    );
    expect(f).toStrictEqual({ west: -2, north: 8, side: 12 });
  });

  it('FR-114 a tall box is expanded along X', () => {
    // X 0..2, Y 0..8: side 8, X becomes -3..5; margin 0 keeps it.
    const f = frameFor(
      [
        [0, 0],
        [2, 8],
      ],
      0,
    );
    expect(f).toStrictEqual({ west: -3, north: 8, side: 8 });
  });

  it('FR-114 margin 0 on a square box keeps the box', () => {
    const f = frameFor(
      [
        [-1, -1],
        [3, 3],
      ],
      0,
    );
    expect(f).toStrictEqual({ west: -1, north: 3, side: 4 });
  });

  it('FR-114 the frame covers every vertex it was built from', () => {
    const pts: [number, number][] = [
      [-0.7, 0.2],
      [5.1, 3.3],
      [2.2, -1.9],
    ];
    const f = frameFor(pts, 0.02);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThan(f.west);
      expect(x).toBeLessThan(f.west + f.side);
      expect(y).toBeLessThan(f.north);
      expect(y).toBeGreaterThan(f.north - f.side);
    }
  });

  it('FR-114 each pixel covers an equal square of the frame', () => {
    expect(pixelSide({ west: 0, north: 0, side: 12 }, 4)).toBe(3);
  });
});

describe('FR-114 point to pixel', () => {
  const frame = { west: 10, north: 20, side: 8 }; // W = 4 -> pixel side 2
  const W = 4;

  it('FR-114 u = (X - west) / pixel and v = (north - Y) / pixel, x grows east, y grows south', () => {
    const p = toPixel(frame, W, 13, 17);
    expect(p).toStrictEqual({ u: 1.5, v: 1.5, inside: true, x: 1, y: 1 });
    const q = toPixel(frame, W, 17, 11);
    expect(q).toStrictEqual({ u: 3.5, v: 4.5, inside: false, x: 3, y: 4 });
  });

  it('FR-114 a point on a pixel edge lies in the pixel to its east or south', () => {
    expect(toPixel(frame, W, 12, 18)).toStrictEqual({ u: 1, v: 1, inside: true, x: 1, y: 1 });
    // On a vertical edge only: east pixel; on a horizontal edge only: south pixel.
    expect(toPixel(frame, W, 14, 17)).toMatchObject({ inside: true, x: 2, y: 1 });
    expect(toPixel(frame, W, 13, 16)).toMatchObject({ inside: true, x: 1, y: 2 });
  });

  it('FR-114 the north and west outer edges are inside, the east and south outer edges are not', () => {
    expect(toPixel(frame, W, 10, 20)).toMatchObject({ inside: true, x: 0, y: 0 });
    expect(toPixel(frame, W, 18, 17)).toMatchObject({ inside: false });
    expect(toPixel(frame, W, 13, 12)).toMatchObject({ inside: false });
    expect(toPixel(frame, W, 17.999999, 12.000001)).toMatchObject({ inside: true, x: 3, y: 3 });
  });

  it('FR-114 points west of or north of the frame are outside', () => {
    expect(toPixel(frame, W, 9.999, 17)).toMatchObject({ inside: false });
    expect(toPixel(frame, W, 13, 20.001)).toMatchObject({ inside: false });
  });

  it('FR-114 the centre of pixel (x, y) is at u = x + 0.5, v = y + 0.5', () => {
    // Pixel (2, 3): centre X = 10 + 2.5 * 2 = 15, Y = 20 - 3.5 * 2 = 13.
    expect(toPixel(frame, W, 15, 13)).toStrictEqual({ u: 2.5, v: 3.5, inside: true, x: 2, y: 3 });
  });
});
