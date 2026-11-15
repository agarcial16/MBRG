import { describe, expect, it } from 'vitest';
import { normalizePolygon, normalizeRing, toPixelPolygons } from '../src/core/rings';
import { WATER, rasterize, type RasterLayer } from '../src/core/rasterize';
import type { SourceFeature, SourcePolygon } from '../src/core/types';

type P = [number, number];

function poly(outer: P[], ...holes: P[][]): SourcePolygon {
  return { outer: { coords: outer }, holes: holes.map((coords) => ({ coords })) };
}

/** Axis-aligned rectangle ring from (u0, v0) to (u1, v1), counter-clockwise on screen. */
function rect(u0: number, v0: number, u1: number, v1: number): P[] {
  return [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
    [u0, v0],
  ];
}

function layer(value: number, ...polygons: SourcePolygon[]): RasterLayer {
  return { value, polygons };
}

/** Render the grid: '.' water, 'o' background (0), otherwise the digit of the id. */
function show(pixels: Uint32Array, width: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < width; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const v = pixels[y * width + x];
      row += v === WATER ? '.' : v === 0 ? 'o' : String(v);
    }
    rows.push(row);
  }
  return rows;
}

function run(width: number, ...layers: RasterLayer[]): string[] {
  return show(rasterize(width, layers), width);
}

describe('FR-115 NFR-23 centre-point assignment', () => {
  it('FR-115 a pixel belongs to a polygon if its centre is inside, never by partial coverage', () => {
    // Covers 1.2 of the 5 pixel columns' area: only centres 1.5, 2.5, 3.5 are inside.
    expect(run(5, layer(1, poly(rect(1.2, 1.2, 3.8, 3.8))))).toStrictEqual([
      '.....',
      '.111.',
      '.111.',
      '.111.',
      '.....',
    ]);
    // Covers only a sliver of a pixel (no centre inside): nothing is painted.
    expect(run(3, layer(1, poly(rect(0.6, 0.6, 1.4, 1.4))))).toStrictEqual(['...', '...', '...']);
  });

  it('NFR-23 pixel centres exactly on the outer boundary count as inside (all four edges)', () => {
    // Edges at 1.5 and 3.5 pass exactly through centres.
    expect(run(5, layer(1, poly(rect(1.5, 1.5, 3.5, 3.5))))).toStrictEqual([
      '.....',
      '.111.',
      '.111.',
      '.111.',
      '.....',
    ]);
  });

  it('NFR-23 a centre exactly on a vertex counts as inside', () => {
    // Only the corner centre (1.5, 1.5) of this triangle region lies on a vertex.
    const tri: P[] = [
      [1.5, 1.5],
      [0.5, 1.7],
      [1.4, 0.5],
      [1.5, 1.5],
    ];
    const grid = run(3, layer(1, poly(tri)));
    expect(grid[1]?.[1]).toBe('1');
  });

  it('NFR-23 an apex that touches a pixel row exactly at the centre height is contained', () => {
    // Triangle apex at (2.5, 1.5) pointing up; the row of centres at v = 1.5 meets only the apex.
    const tri: P[] = [
      [0.5, 3.5],
      [4.5, 3.5],
      [2.5, 1.5],
      [0.5, 3.5],
    ];
    const grid = run(5, layer(1, poly(tri)));
    expect(grid[1]).toBe('..1..');
    expect(grid[2]).toBe('.111.');
    expect(grid[3]).toBe('11111');
  });

  it('NFR-23 a downward apex at a centre height is contained', () => {
    const tri: P[] = [
      [0.5, 0.5],
      [4.5, 0.5],
      [2.5, 2.5],
      [0.5, 0.5],
    ];
    const grid = run(5, layer(1, poly(tri)));
    expect(grid[0]).toBe('11111');
    expect(grid[1]).toBe('.111.');
    expect(grid[2]).toBe('..1..');
  });

  it('NFR-23 horizontal edges lying on the row of centres are contained', () => {
    // Square from v = 1.5 to v = 3.5: rows 1 and 3 are exactly on the horizontal edges.
    expect(run(5, layer(1, poly(rect(0.5, 1.5, 4.5, 3.5))))).toStrictEqual([
      '.....',
      '11111',
      '11111',
      '11111',
      '.....',
    ]);
  });

  it('FR-115 a horizontal edge at the centre height is contained even inside a concave polygon', () => {
    // U shape: the notch bottom is a horizontal edge exactly at v = 2.5.
    const u: P[] = [
      [0.5, 0.5],
      [1.5, 0.5],
      [1.5, 2.5],
      [3.5, 2.5],
      [3.5, 0.5],
      [4.5, 0.5],
      [4.5, 4.5],
      [0.5, 4.5],
      [0.5, 0.5],
    ];
    const grid = run(5, layer(1, poly(u)));
    expect(grid[0]).toBe('11.11');
    expect(grid[1]).toBe('11.11');
    expect(grid[2]).toBe('11111');
    expect(grid[3]).toBe('11111');
  });

  it('NFR-23 shared vertices and shared edges: a centre on a shared border goes to the first in map order', () => {
    // Two squares meet at u = 2.5 (a centre column).
    const a = layer(1, poly(rect(0.5, 0.5, 2.5, 4.5)));
    const b = layer(2, poly(rect(2.5, 0.5, 4.5, 4.5)));
    expect(run(5, a, b)[2]).toBe('11122');
    expect(run(5, b, a)[2]).toBe('11222');
    // Never lost to water.
    expect(run(5, a, b).join('')).not.toContain('.');
  });

  it('NFR-23 a vertex shared by four squares at a centre goes to the first of them in map order', () => {
    const layers = [
      layer(1, poly(rect(0.5, 0.5, 2.5, 2.5))),
      layer(2, poly(rect(2.5, 0.5, 4.5, 2.5))),
      layer(3, poly(rect(0.5, 2.5, 2.5, 4.5))),
      layer(4, poly(rect(2.5, 2.5, 4.5, 4.5))),
    ];
    expect(run(5, ...layers)).toStrictEqual(['11122', '11122', '11122', '33344', '33344']);
  });

  it('FR-115 several territories containing a centre: the first in map order, not the lowest value', () => {
    const big = layer(7, poly(rect(0, 0, 3, 3)));
    const small = layer(2, poly(rect(0, 0, 3, 3)));
    expect(run(3, big, small)).toStrictEqual(['777', '777', '777']);
    expect(run(3, small, big)).toStrictEqual(['222', '222', '222']);
  });

  it('FR-115 other land is background (0), after every land territory, and never water', () => {
    const land = layer(1, poly(rect(0, 0, 2, 3)));
    const other = layer(0, poly(rect(1, 0, 3, 3)));
    expect(run(3, land, other)).toStrictEqual(['11o', '11o', '11o']);
    expect(run(4, land, other)[0]).toBe('11o.');
  });

  it('FR-115 pixels in no layer are water pixels', () => {
    expect(run(2)).toStrictEqual(['..', '..']);
    expect(rasterize(2, []).every((v) => v === WATER)).toBe(true);
  });

  it('FR-115 polygons extending beyond the frame still fill it and parity is kept', () => {
    expect(run(3, layer(1, poly(rect(-10, -10, 20, 20))))).toStrictEqual(['111', '111', '111']);
    // A concave shape whose left part lies outside the frame to the west.
    const c: P[] = [
      [-5, 0],
      [2, 0],
      [2, 1],
      [-5, 1],
      [-5, 0],
    ];
    expect(run(3, layer(1, poly(c)))).toStrictEqual(['11.', '...', '...']);
  });

  it('NFR-23 only ids given as layer values (and background and water) appear in the output', () => {
    const layers = [
      layer(5, poly(rect(0.3, 0.3, 4.2, 3.1), rect(1.5, 1.5, 2.5, 2.5))),
      layer(9, poly(rect(2.5, 2.5, 7.9, 7.9))),
      layer(0, poly(rect(0, 5, 8, 8))),
      layer(16777215, poly([[6.5, 0.5], [7.5, 0.5], [7.5, 1.5], [6.5, 0.5]])),
    ];
    const px = rasterize(8, layers);
    const seen = new Set(px);
    for (const v of seen) expect([5, 9, 0, 16777215, WATER]).toContain(v);
  });

  it('NFR-23 the result is identical on every run (determinism)', () => {
    const layers = [
      layer(1, poly(rect(0.37, 0.41, 4.77, 3.13), rect(1.23, 1.11, 2.71, 2.29))),
      layer(2, poly([[2.2, 2.2], [7.7, 3.3], [5.5, 7.1], [2.2, 2.2]])),
    ];
    const a = rasterize(8, layers);
    const b = rasterize(8, layers);
    expect(Array.from(a)).toStrictEqual(Array.from(b));
  });
});

describe('FR-115 holes, overlaps and orientation', () => {
  it('FR-115 a hole removes the pixels whose centre is strictly inside it', () => {
    // Hole from 1.2 to 3.8: centres 1.5, 2.5, 3.5 are strictly inside.
    expect(run(5, layer(1, poly(rect(0, 0, 5, 5), rect(1.2, 1.2, 3.8, 3.8))))).toStrictEqual([
      '11111',
      '1...1',
      '1...1',
      '1...1',
      '11111',
    ]);
  });

  it('FR-115 a centre on the boundary of a hole is contained by the polygon', () => {
    // Hole 1.5..3.5: only centre 2.5 is strictly inside; the ring of centres on the boundary stays.
    expect(run(5, layer(1, poly(rect(0, 0, 5, 5), rect(1.5, 1.5, 3.5, 3.5))))).toStrictEqual([
      '11111',
      '11111',
      '11.11',
      '11111',
      '11111',
    ]);
  });

  it('FR-115 a hole outside the outer ring changes nothing', () => {
    expect(run(4, layer(1, poly(rect(0, 0, 2, 2), rect(2, 2, 4, 4))))).toStrictEqual([
      '11..',
      '11..',
      '....',
      '....',
    ]);
  });

  it('FR-115 overlapping holes each remove their interior (no cancelling by even-odd)', () => {
    // Hole A covers centres 1.5, 2.5; hole B covers 2.5, 3.5 in the same row; 2.5 is in both.
    const grid = run(6, layer(1, poly(rect(0, 0, 6, 6), rect(1, 1, 3, 3), rect(2, 1, 4, 3))));
    expect(grid[1]).toBe('1...11');
    expect(grid[2]).toBe('1...11');
    expect(grid[0]).toBe('111111');
    expect(grid[3]).toBe('111111');
  });

  it('FR-115 a hole wound the same way as its outer ring behaves as a hole', () => {
    const outerCcw = rect(0, 0, 5, 5);
    const holeSame = rect(1.2, 1.2, 3.8, 3.8);
    const holeOpposite = [...holeSame].reverse();
    expect(run(5, layer(1, poly(outerCcw, holeSame)))).toStrictEqual(
      run(5, layer(1, poly(outerCcw, holeOpposite))),
    );
  });

  it('FR-115 ring orientation has no effect on the outer ring', () => {
    const ccw = rect(0.2, 0.2, 3.8, 3.8);
    const cw = [...ccw].reverse();
    expect(run(4, layer(1, poly(cw)))).toStrictEqual(run(4, layer(1, poly(ccw))));
  });

  it('FR-115 overlapping polygons of one feature form a union and never cancel', () => {
    const p1 = poly(rect(0, 0, 3, 3));
    const p2 = poly(rect(2, 2, 5, 5));
    expect(run(5, layer(1, p1, p2))).toStrictEqual(['111..', '111..', '11111', '..111', '..111']);
  });

  it('FR-115 a polygon inside the hole of another polygon of the same feature is painted', () => {
    const ring = poly(rect(0, 0, 5, 5), rect(1, 1, 4, 4));
    const island = poly(rect(2, 2, 3, 3));
    expect(run(5, layer(1, ring, island)).join('/')).toBe('11111/1...1/1.1.1/1...1/11111');
  });

  it('FR-115 a boundary point inside a hole interval (a notch tip) is not strictly inside the hole', () => {
    // The hole has a V notch cut from the top whose tip is at the centre (2.5, 2.5).
    const hole: P[] = [
      [0.5, 0.5],
      [1.5, 0.5],
      [2.5, 2.5],
      [3.5, 0.5],
      [4.5, 0.5],
      [4.5, 4.5],
      [0.5, 4.5],
      [0.5, 0.5],
    ];
    const grid = run(5, layer(1, poly(rect(0, 0, 5, 5), hole)));
    expect(grid[2]).toBe('1.1.1');
    expect(grid[3]).toBe('1...1');
  });
});

describe('FR-115 duplicates and zero-area rings', () => {
  it('FR-115 consecutive equal vertices count as one vertex', () => {
    const plain = rect(0.2, 0.2, 3.8, 3.8);
    const dup: P[] = [
      plain[0]!,
      plain[0]!,
      plain[1]!,
      plain[1]!,
      plain[1]!,
      plain[2]!,
      plain[3]!,
      plain[3]!,
      plain[4]!,
    ];
    const a = toPixelPolygons([feat(poly(dup))], (lon, lat) => [lon, lat]);
    const b = toPixelPolygons([feat(poly(plain))], (lon, lat) => [lon, lat]);
    expect(a).toStrictEqual(b);
    expect(run(4, layer(1, ...a))).toStrictEqual(run(4, layer(1, ...b)));
  });

  it('FR-115 normalizeRing collapses consecutive duplicates and the closing duplicate', () => {
    expect(
      normalizeRing([
        [0, 0],
        [0, 0],
        [4, 0],
        [4, 4],
        [4, 4],
        [0, 4],
        [0, 0],
      ]),
    ).toStrictEqual([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ]);
  });

  it('FR-115 a ring with fewer than three distinct vertices is ignored', () => {
    expect(normalizeRing([[0, 0], [1, 1], [0, 0]])).toBeNull();
    expect(normalizeRing([[0, 0], [1, 1], [0, 0], [1, 1], [0, 0]])).toBeNull();
    expect(normalizeRing([[2, 2], [2, 2], [2, 2]])).toBeNull();
    expect(normalizeRing([])).toBeNull();
  });

  it('FR-115 a ring with a shoelace area of exactly zero is ignored', () => {
    expect(normalizeRing([[0, 0], [1, 1], [2, 2], [0, 0]])).toBeNull();
    expect(normalizeRing([[0, 0], [2, 0], [1, 0], [0, 0]])).toBeNull();
  });

  it('FR-115 a ring with a tiny but non-zero area is kept', () => {
    expect(normalizeRing([[0, 0], [1, 1], [2, 2.0000001], [0, 0]])).not.toBeNull();
  });

  it('FR-115 the shoelace test uses the source coordinates, whatever the ring orientation', () => {
    const cw = normalizeRing([[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]]);
    const ccw = normalizeRing([[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]);
    expect(cw).not.toBeNull();
    expect(ccw).not.toBeNull();
  });

  it('FR-115 as an outer ring a zero-area ring contains nothing, not even its boundary', () => {
    // A line along the centre row: ignored, so no pixel (not even those on the line) is painted.
    const line: P[] = [[0.5, 1.5], [4.5, 1.5], [0.5, 1.5]];
    const out = toPixelPolygons([feat(poly(line))], (lon, lat) => [lon, lat]);
    expect(out).toStrictEqual([]);
    expect(run(5, layer(1, ...out)).join('')).toBe('.'.repeat(25));
    // Also when its polygon has a valid hole.
    expect(toPixelPolygons([feat(poly(line, rect(1, 1, 2, 2)))], (a, b) => [a, b])).toStrictEqual([]);
  });

  it('FR-115 as a hole a zero-area ring removes nothing', () => {
    const outer = rect(0, 0, 5, 5);
    const lineHole: P[] = [[1.5, 2.5], [3.5, 2.5], [1.5, 2.5]];
    const dotHole: P[] = [[2, 2], [2, 2], [2, 2]];
    const polys = toPixelPolygons([feat(poly(outer, lineHole, dotHole))], (a, b) => [a, b]);
    expect(polys).toHaveLength(1);
    expect(polys[0]?.holes).toStrictEqual([]);
    expect(run(5, layer(1, ...polys))).toStrictEqual(Array(5).fill('11111'));
  });

  it('FR-115 normalizePolygon drops ignored holes and returns null for an ignored outer ring', () => {
    expect(normalizePolygon(poly([[0, 0], [1, 0], [0, 0]]))).toBeNull();
    const p = normalizePolygon(poly(rect(0, 0, 4, 4), rect(1, 1, 2, 2), [[1, 1], [1, 1], [1, 1]]));
    expect(p?.holes).toHaveLength(1);
  });

  it('FR-115 projection is applied vertex by vertex with straight edges', () => {
    const out = toPixelPolygons([feat(poly(rect(0, 0, 2, 2)))], (lon, lat) => [lon * 2 + 1, lat * 2 + 1]);
    expect(out[0]?.outer.coords).toStrictEqual([
      [1, 1],
      [5, 1],
      [5, 5],
      [1, 5],
    ]);
  });
});

function feat(...polygons: SourcePolygon[]): SourceFeature {
  return { props: {}, polygons };
}
