import { describe, expect, it } from 'vitest';

import { detectAdjacency, islandIds, labelAt, neighborIdLists, type AdjacencyResult } from '../src/adjacency.js';
import { detectFlatColorRegions, type FlatColorResult } from '../src/flatColors.js';
import { parseHex } from '../src/raster.js';
import { rasterFromArt } from './fixtures/raster.js';

const PAL = { R: '#ff0000', G: '#00ff00', B: '#0000ff', '.': null } as const;

interface Fixture {
  result: FlatColorResult;
  adjacency: AdjacencyResult;
  /** Region index for a colour, so tests can talk about colours not indices. */
  indexOf: (hex: string) => number;
  /** Colours this region borders, e.g. `neighborsOf('#ff0000') === ['#00ff00']`. */
  neighborsOf: (hex: string) => string[];
  /** Every region index with this colour: one per connected piece. */
  indicesOf: (hex: string) => number[];
  islandsAsColors: () => string[];
}

/**
 * Region indices are assigned by descending area, not by position in the art,
 * so tests address regions by colour and let the fixture do the lookup.
 *
 * A colour can be several regions — two patches of the same colour that do not
 * touch are two provinces, not one broken one — so `neighborsOf` answers for
 * the colour as a whole. Tests that care about one specific piece use `indicesOf`.
 */
function detect(art: string[], minRegionArea = 1): Fixture {
  const img = rasterFromArt(art, { ...PAL, Y: '#ffff00' });
  const result = detectFlatColorRegions(img, { minRegionArea });
  const adjacency = detectAdjacency(result);

  const colorOf = (index: number): string =>
    `#${(result.regions[index]?.color ?? 0).toString(16).padStart(6, '0')}`;
  const indicesOf = (hex: string): number[] => {
    const want = parseHex(hex);
    const found = result.regions.filter((r) => r.color === want);
    if (found.length === 0) throw new Error(`no region with colour ${hex}`);
    return found.map((r) => r.index);
  };
  const indexOf = (hex: string): number => indicesOf(hex)[0];

  return {
    result,
    adjacency,
    indexOf,
    indicesOf,
    neighborsOf: (hex) => [
      ...new Set(
        indicesOf(hex).flatMap((index) => (adjacency.neighbors.get(index) ?? []).map(colorOf)),
      ),
    ].sort(),
    islandsAsColors: () => adjacency.islands.map(colorOf),
  };
}

describe('labelAt', () => {
  it('returns -1 outside the image and where there is no land', () => {
    const { result, indexOf } = detect(['R.', '.G']);
    expect(labelAt(result, 0, 0)).toBe(indexOf('#ff0000'));
    expect(labelAt(result, 1, 1)).toBe(indexOf('#00ff00'));
    expect(labelAt(result, 1, 0)).toBe(-1); // transparent
    expect(labelAt(result, -1, 0)).toBe(-1);
    expect(labelAt(result, 2, 0)).toBe(-1);
  });
});

describe('detectAdjacency', () => {
  it('links regions that share an edge', () => {
    const f = detect(['RRG', 'RRG']);
    expect(f.neighborsOf('#ff0000')).toEqual(['#00ff00']);
    expect(f.neighborsOf('#00ff00')).toEqual(['#ff0000']);
    expect(f.adjacency.islands).toEqual([]);
  });

  it('is symmetric and sorted', () => {
    const f = detect(['RGBY'], { ...PAL, Y: '#ffff00' });
    const lists = neighborIdLists(f.adjacency, (i) => `r${i}`);
    // Equal areas, so indices follow colour value: blue < green < red < yellow.
    // Green borders blue and red, and its list is sorted by index, not by
    // position along the row.
    expect(lists.get(f.indexOf('#00ff00'))).toEqual([
      `r${f.indexOf('#0000ff')}`,
      `r${f.indexOf('#ff0000')}`,
    ]);
    expect(f.neighborsOf('#ff0000')).toEqual(['#00ff00']);
    // Blue sits in the middle of the row, between green and yellow.
    expect(f.neighborsOf('#0000ff')).toEqual(['#00ff00', '#ffff00']);
    expect(f.neighborsOf('#ffff00')).toEqual(['#0000ff']);
  });

  it('a row of three is a chain, not a clique', () => {
    // Three regions cannot all border each other on a 4-connected grid: where
    // three meet, two of them only touch at a corner.
    const f = detect(['RGB']);
    expect(f.neighborsOf('#00ff00')).toEqual(['#0000ff', '#ff0000']);
    expect(f.neighborsOf('#0000ff')).toEqual(['#00ff00']);
  });

  it('reports a region with no land neighbour as an island', () => {
    const f = detect(['RRGG', 'RRGG', '....', '..BB']);
    expect(f.islandsAsColors()).toEqual(['#0000ff']);
    expect(islandIds(f.adjacency, (i) => `r${i}`)).toEqual([`r${f.indexOf('#0000ff')}`]);
    expect(f.result.regions).toHaveLength(3);
  });

  it('treats a corner-only touch as no border, and says so', () => {
    // Red and blue meet at a single corner; green sits between them, in two
    // pieces of its own, since those two pixels only touch at that corner.
    const f = detect(['RG', 'GB']);
    expect(f.neighborsOf('#ff0000')).toEqual(['#00ff00']);
    expect(f.neighborsOf('#00ff00')).toEqual(['#0000ff', '#ff0000']);
    expect(f.neighborsOf('#0000ff')).toEqual(['#00ff00']);
    // Two regions for the two green pixels: same colour, separate provinces.
    expect(f.indicesOf('#00ff00')).toHaveLength(2);
    const corners = f.adjacency.cornerTouches.map(
      ([a, b]) => `${colorName(f, a)}|${colorName(f, b)}`,
    );
    // Pairs are emitted in region-index order: blue|red, and the two greens.
    expect(corners).toEqual(['#0000ff|#ff0000', '#00ff00|#00ff00']);
  });

  it('counts a region reachable only diagonally as an island', () => {
    const f = detect(['RR', '..', 'BB']);
    expect(f.islandsAsColors().sort()).toEqual(['#0000ff', '#ff0000']);
  });

  it('does not report a corner touch between regions that also share a border', () => {
    const f = detect(['RR', 'RG']);
    expect(f.neighborsOf('#ff0000')).toEqual(['#00ff00']);
    expect(f.adjacency.cornerTouches).toEqual([]);
  });

  it('handles a landmass fully surrounded by sea', () => {
    const f = detect(['...', '.R.', '...']);
    expect(f.neighborsOf('#ff0000')).toEqual([]);
    expect(f.adjacency.islands).toHaveLength(1);
  });

  it('is deterministic', () => {
    const art = ['RGBR', 'GBRG', 'BRGB'];
    expect(detect(art).adjacency).toEqual(detect(art).adjacency);
  });
});

function colorName(f: Fixture, index: number): string {
  return `#${(f.result.regions[index]?.color ?? 0).toString(16).padStart(6, '0')}`;
}

describe('label map', () => {
  it('carries the image size and labels in row-major order', () => {
    // Red appears twice, on opposite corners, so it is two regions.
    const img = rasterFromArt(['RG', 'BR'], PAL);
    const result = detectFlatColorRegions(img, { minRegionArea: 1 });
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    const [redA, redB] = result.regions.filter((r) => r.color === parseHex('#ff0000'));
    const green = result.regions.find((r) => r.color === parseHex('#00ff00'))!;
    const blue = result.regions.find((r) => r.color === parseHex('#0000ff'))!;
    expect(redA.index).not.toBe(redB.index);
    expect([...result.labels]).toEqual([redA.index, green.index, blue.index, redB.index]);
  });

  it('marks speckle as -1 once it is dropped', () => {
    const img = rasterFromArt(['RRR', 'RGR'], PAL);
    const result = detectFlatColorRegions(img, { minRegionArea: 4 });
    const red = result.regions[0].index;
    expect(result.regions).toHaveLength(1);
    // The lone green pixel is not land.
    expect([...result.labels]).toEqual([red, red, red, red, -1, red]);
  });
});
