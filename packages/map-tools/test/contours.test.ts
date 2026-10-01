import { describe, expect, it } from 'vitest';

import { detectAdjacency } from '../src/adjacency.js';
import { detectFlatColorRegions } from '../src/flatColors.js';
import { simplifyRing, traceContours, type ContourResult, type ContourLoop } from '../src/contours.js';
import { parseHex, type RGB } from '../src/raster.js';
import { rasterFromArt } from './fixtures/raster.js';

const PAL = { R: '#ff0000', G: '#00ff00', B: '#0000ff', Y: '#ffff00', '.': null } as const;

interface Fixture {
  result: ReturnType<typeof detectFlatColorRegions>;
  contours: ContourResult;
  indexOf: (hex: string) => number;
  /** Every region index with this colour: one per connected piece. */
  indicesOf: (hex: string) => number[];
  ringsOf: (hex: string) => ContourLoop[];
  holesOf: (hex: string) => ContourLoop[];
  /** The single ring of a region, asserting there is exactly one. */
  ringOf: (hex: string) => ContourLoop;
  /** Colours this region's colour borders, sorted. */
  neighborsOf: (hex: string) => string[];
}

function detect(art: string[], simplify = 0): Fixture {
  const img = rasterFromArt(art, PAL);
  const result = detectFlatColorRegions(img, { minRegionArea: 1, sea: 'transparent' });
  const contours = traceContours(result, { simplify });
  const indicesOf = (hex: string): number[] => {
    const want = parseHex(hex) as RGB;
    const found = result.regions.filter((r) => r.color === want);
    if (found.length === 0) throw new Error(`no region with colour ${hex}`);
    return found.map((r) => r.index);
  };
  const indexOf = (hex: string): number => indicesOf(hex)[0];
  const colorOf = (index: number): string =>
    `#${(result.regions[index]?.color ?? 0).toString(16).padStart(6, '0')}`;
  const adjacency = detectAdjacency(result);
  const ringsOf = (hex: string) => contours.ringsByRegion.get(indexOf(hex)) ?? [];
  return {
    result,
    contours,
    indexOf,
    indicesOf,
    ringsOf,
    holesOf: (hex) => contours.holesByRegion.get(indexOf(hex)) ?? [],
    ringOf: (hex) => {
      const rings = ringsOf(hex);
      if (rings.length !== 1) throw new Error(`${hex} has ${rings.length} rings`);
      return rings[0];
    },
    neighborsOf: (hex) =>
      [
        ...new Set(
          indicesOf(hex).flatMap((index) => (adjacency.neighbors.get(index) ?? []).map(colorOf)),
        ),
      ].sort(),
  };
}

/** A set of points, so two loops can be compared regardless of direction/order. */
function pointSet(loop: ContourLoop): string {
  return [...loop.points].map(([x, y]) => `${x},${y}`).sort().join(' ');
}

describe('traceContours: geometry', () => {
  it('traces a solid block on the pixel grid, staircase and all', () => {
    const f = detect(['RRR', 'RRR']); // 3x2 pixels
    const ring = f.ringOf('#ff0000');
    // Without simplification the outline is the pixel staircase: every corner
    // of every pixel, which is what a neighbour also sees. A 3x2 block has
    // 2 * (3 + 2) = 10 of them.
    expect(ring.points).toHaveLength(10);
    expect(ring.area).toBe(6);
    expect(ring.enclosed).toBe(f.indexOf('#ff0000'));
    expect(ring.surrounds).toBe(-1); // sea all around
  });

  it('simplifies that staircase into the rectangle it really is', () => {
    const f = detect(['RRR', 'RRR'], 0.5);
    const ring = f.ringOf('#ff0000');
    expect([...ring.points].sort()).toEqual([
      [0, 0],
      [0, 2],
      [3, 0],
      [3, 2],
    ]);
    expect(ring.area).toBe(6);
  });

  it('walks every loop exactly once, with no repeated closing point', () => {
    // Four regions: the two green pixels only touch at the centre corner, so
    // they are two provinces and the map has four outlines, not three.
    const f = detect(['RRG', 'GGB']);
    expect(f.contours.loops.length).toBe(4);
    for (const loop of f.contours.loops) {
      expect(loop.points.length).toBeGreaterThanOrEqual(3);
      const first = loop.points[0];
      const last = loop.points[loop.points.length - 1];
      expect(first).not.toEqual(last);
    }
  });

  it('every loop names a valid region on each side it has one', () => {
    const f = detect(['RRGG', 'RRGG', 'GGBB']);
    const known = new Set(f.result.regions.map((r) => r.index));
    for (const loop of f.contours.loops) {
      expect(known.has(loop.enclosed) || loop.enclosed === -1).toBe(true);
      expect(known.has(loop.surrounds) || loop.surrounds === -1).toBe(true);
    }
  });
});

describe('traceContours: shared vertices', () => {
  it('two neighbours quote the very same loop, not two similar ones', () => {
    // Green surrounds blue, so blue's outer ring is a hole in green. It must be
    // the identical point set, or the renderer strokes a seam down the middle.
    const f = detect(['RRRR', 'RRRR', 'RRRR', 'RRRR']);
    expect(f.contours.loops).toHaveLength(1);
  });

  it('an enclave becomes a hole in its surrounding region', () => {
    const f = detect(['RRRR', 'RBBR', 'RBBR', 'RRRR']);
    const blue = f.ringOf('#0000ff');
    const greenHoles = f.holesOf('#ff0000');
    expect(greenHoles).toHaveLength(1);
    // Same loop, quoted by both sides: identical points, whatever the order.
    expect(pointSet(greenHoles[0])).toBe(pointSet(blue));
  });

  it('keeps every border as one shared loop per side', () => {
    // Three regions in a row: the shared borders must be the same corners for
    // both neighbours.
    const f = detect(['RGB']);
    const red = f.ringOf('#ff0000');
    const green = f.ringOf('#00ff00');
    const blue = f.ringOf('#0000ff');
    // Red and green share the x=1 column of corners; green and blue, x=2.
    const greenX = new Set(green.points.map(([x]) => x));
    const redX = new Set(red.points.map(([x]) => x));
    const blueX = new Set(blue.points.map(([x]) => x));
    expect([...redX].filter((x) => greenX.has(x))).toEqual([1]);
    expect([...blueX].filter((x) => greenX.has(x))).toEqual([2]);
  });
});

describe('traceContours: holes and disconnection', () => {
  it('a lake is a hole in the region around it', () => {
    // Red ring with transparent water in the middle: the lake encloses no
    // region, so it is a hole and not a ring of anyone's.
    const f = detect(['RRR', 'R.R', 'RRR']);
    const red = f.ringOf('#ff0000');
    // The outer ring wraps the whole 3x3 square; the lake is the hole in it.
    expect(red.area).toBe(9);
    expect(red.surrounds).toBe(-1);

    const holes = f.holesOf('#ff0000');
    expect(holes).toHaveLength(1);
    expect(holes[0].enclosed).toBe(-1); // a lake, not a province
    expect(holes[0].area).toBe(1);
    expect([...holes[0].points].sort()).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
    ]);
  });

  it('land cut in two is two regions, not one broken one', () => {
    // Red above and below, green in the middle cutting clean through. Regions
    // are connected pieces, so this is two red provinces and nothing is
    // reported: there is no such thing as a split region any more.
    const f = detect(['RRRRR', 'GGGGG', 'RRRRR']);
    expect(f.indicesOf('#ff0000')).toHaveLength(2);
    expect(f.result.regions).toHaveLength(3);
    expect(f.contours.splitRegions).toEqual([]);
  });

  it('does not flag a donut as split: that is a hole, not two pieces', () => {
    const f = detect(['RRR', 'RGR', 'RRR']);
    expect(f.contours.splitRegions).toEqual([]);
    expect(f.holesOf('#ff0000')).toHaveLength(1);
  });

  it('bordering a region is not the same as being inside it', () => {
    // Red is cut in two by the green strip. Both halves border green, but
    // neither is inside green, so green gets no hole. This is the check that
    // keeps a shared border from being reported as an enclave.
    const f = detect(['RRRRR', 'GGGGG', 'RRRRR']);
    expect(f.holesOf('#00ff00')).toEqual([]);
    expect(f.neighborsOf('#ff0000')).toEqual(['#00ff00']);
  });

  it('an enclave is a hole, and the region it sits in is not', () => {
    // Blue inside a red ring: red gets the hole, blue gets nothing.
    const f = detect(['RRR', 'RBR', 'RRR']);
    expect(f.holesOf('#ff0000')).toHaveLength(1);
    expect(f.holesOf('#0000ff')).toEqual([]);
    expect(f.contours.splitRegions).toEqual([]);
  });

  it('a block of provinces seen from outside belongs to none of them', () => {
    // A frame around a 2x2 block of provinces, which is what a map looks like
    // once an opaque background is read as land. The outline of the whole block
    // has three different regions on its inside, so it cannot be the outer ring
    // of any one of them: it is the frame's hole.
    //
    // It used to be handed to whichever province was first along the walk, which
    // gave that province a second "outer ring" and a "your map is split in two"
    // warning on a perfectly square block.
    const f = detect([
      'YYYYY',
      'YRRGY',
      'YGGGY',
      'YYYYY',
    ], 0);
    expect(f.ringsOf('#ff0000')).toHaveLength(1);
    expect(f.ringsOf('#00ff00')).toHaveLength(1);
    expect(f.contours.splitRegions).toEqual([]);
    // The frame surrounds the block, so the block is a hole in the frame.
    expect(f.holesOf('#ffff00')).toHaveLength(1);
  });
});

describe('simplifyRing', () => {
  it('drops collinear points', () => {
    const ring: [number, number][] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [0, 1],
    ];
    expect(simplifyRing(ring, 0.1)).toEqual([
      [0, 0],
      [2, 0],
      [2, 1],
      [0, 1],
    ]);
  });

  it('keeps points that matter and is stable under rotation', () => {
    const ring: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 1],
      [2, 2],
      [0, 1],
    ];
    const simplified = simplifyRing(ring, 0.5);
    expect(simplified).toHaveLength(5);
    // Starting from a different corner gives the same shape.
    const rotated = [...ring.slice(2), ...ring.slice(0, 2)];
    expect(simplifyRing(rotated, 0.5).length).toBe(5);
  });

  it('is a no-op with zero tolerance or too few points', () => {
    const ring: [number, number][] = [
      [0, 0],
      [1, 0],
      [2, 1],
    ];
    expect(simplifyRing(ring, 0)).toBe(ring);
  });

  it('is applied once per loop, so both neighbours keep the same points', () => {
    // Blue enclave inside red, with simplification on: the hole red quotes and
    // the ring blue quotes must be the identical point set.
    const f = detect(['RRRR', 'RBBR', 'RBBR', 'RRRR'], 0.5);
    const blue = f.ringOf('#0000ff');
    const holes = f.holesOf('#ff0000');
    expect(holes).toHaveLength(1);
    expect(pointSet(holes[0])).toBe(pointSet(blue));
    expect(holes[0].points).toBe(blue.points); // same array, not a copy
  });
});

describe('traceContours: determinism', () => {
  it('same image, same loops, twice', () => {
    const art = ['RGBR', 'GRBG', 'BRGB', 'RGBR'];
    const a = detect(art);
    const b = detect(art);
    expect(a.contours).toEqual(b.contours);
  });
});
