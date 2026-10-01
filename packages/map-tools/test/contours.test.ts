import { describe, expect, it } from 'vitest';

import { detectFlatColorRegions } from '../src/flatColors.js';
import { simplifyRing, traceContours, type ContourResult, type ContourLoop } from '../src/contours.js';
import { parseHex, type RGB } from '../src/raster.js';
import { rasterFromArt } from './fixtures/raster.js';

const PAL = { R: '#ff0000', G: '#00ff00', B: '#0000ff', Y: '#ffff00', '.': null } as const;

interface Fixture {
  result: ReturnType<typeof detectFlatColorRegions>;
  contours: ContourResult;
  indexOf: (hex: string) => number;
  ringsOf: (hex: string) => ContourLoop[];
  holesOf: (hex: string) => ContourLoop[];
  /** The single ring of a region, asserting there is exactly one. */
  ringOf: (hex: string) => ContourLoop;
}

function detect(art: string[], simplify = 0): Fixture {
  const img = rasterFromArt(art, PAL);
  const result = detectFlatColorRegions(img, { minRegionArea: 1 });
  const contours = traceContours(result, { simplify });
  const indexOf = (hex: string): number => {
    const want = parseHex(hex) as RGB;
    const found = result.regions.find((r) => r.color === want);
    if (!found) throw new Error(`no region with colour ${hex}`);
    return found.index;
  };
  const ringsOf = (hex: string) => contours.ringsByRegion.get(indexOf(hex)) ?? [];
  return {
    result,
    contours,
    indexOf,
    ringsOf,
    holesOf: (hex) => contours.holesByRegion.get(indexOf(hex)) ?? [],
    ringOf: (hex) => {
      const rings = ringsOf(hex);
      if (rings.length !== 1) throw new Error(`${hex} has ${rings.length} rings`);
      return rings[0];
    },
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
    const f = detect(['RRG', 'GGB']);
    expect(f.contours.loops.length).toBe(3);
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

  it('flags a region whose land is split in two', () => {
    // Red above and below, green in the middle cutting clean through.
    const f = detect(['RRRRR', 'GGGGG', 'RRRRR']);
    expect(f.contours.splitRegions).toContain(f.indexOf('#ff0000'));
  });

  it('does not flag a donut as split: that is a hole, not two pieces', () => {
    const f = detect(['RRR', 'RGR', 'RRR']);
    expect(f.contours.splitRegions).toEqual([]);
    expect(f.holesOf('#ff0000')).toHaveLength(1);
  });

  it('bordering a region is not the same as being inside it', () => {
    // Red is cut in two by the green strip. Both halves border green, but
    // neither is inside green, so green gets no hole and red is flagged split.
    const f = detect(['RRRRR', 'GGGGG', 'RRRRR']);
    expect(f.holesOf('#00ff00')).toEqual([]);
    expect(f.contours.splitRegions).toEqual([f.indexOf('#ff0000')]);
  });

  it('an enclave is a hole, and the region it sits in is not', () => {
    // Blue inside a red ring: red gets the hole, blue gets nothing.
    const f = detect(['RRR', 'RBR', 'RRR']);
    expect(f.holesOf('#ff0000')).toHaveLength(1);
    expect(f.holesOf('#0000ff')).toEqual([]);
    expect(f.contours.splitRegions).toEqual([]);
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
