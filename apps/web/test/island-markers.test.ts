import { describe, expect, it } from 'vitest';
import type { Rgb } from '@mbrg/shared';
import type { IndexGrid } from '../src/core/borders';
import {
  ISLAND_MARKER_PARAMS,
  buildIslandClusters,
  islandMarkerAlpha,
  resolveIslandMarkers,
} from '../src/core/island-markers';
import { buildPieceIndex } from '../src/core/regions';

function makeGrid(width: number, height: number, fills: readonly ('sea' | 'land')[], paint: (cells: Uint16Array) => void): IndexGrid {
  const cells = new Uint16Array(width * height);
  paint(cells);
  return { width, height, cells, fills: [...fills] };
}

describe('spec 039 tiny island markers (FR-729..FR-731, NFR-192)', () => {
  // Entry 0: sea, Entry 1: tiny island (2 close pieces), Entry 2+3: touching mainland countries (not pure islands),
  // Entry 4: tiny island with 2 very distant pieces (should form 2 separate clusters),
  // Entry 5: large pure island nation (> 1.2% of map side, e.g. Japan/NZ -> should NOT get a tiny-island box).
  const grid = makeGrid(300, 120, ['sea', 'land', 'land', 'land', 'land', 'land'], (cells) => {
    const set = (x0: number, y0: number, x1: number, y1: number, entry: number): void => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells[y * 300 + x] = entry;
    };
    // Entry 1: two 3x3 island dots 10 units apart -> 1 archipelago cluster
    set(20, 20, 22, 22, 1);
    set(33, 24, 35, 26, 1);
    // Entry 2 & 3: touching mainland (2 touches 3) + a tiny coastal skerry of entry 2
    set(100, 10, 140, 50, 2);
    set(141, 10, 180, 50, 3);
    set(92, 12, 93, 13, 2); // coastal skerry of mainland entry 2
    // Entry 4: two tiny islands 220 units apart -> 2 separate clusters
    set(10, 90, 12, 92, 4);
    set(260, 90, 262, 92, 4);
    // Entry 5: large pure island (20x20, > 300 * 0.012 = 3.6) -> excluded
    set(210, 10, 229, 29, 5);
  });
  const pieces = buildPieceIndex(grid);
  const clusters = buildIslandClusters(pieces);

  it('FR-731 includes only tiny pure island territories (no touching mainland, coastal skerries, or major island nations)', () => {
    const entries = new Set(clusters.map((c) => c.entry));
    expect(entries.has(1)).toBe(true);
    expect(entries.has(4)).toBe(true);
    expect(entries.has(2)).toBe(false);
    expect(entries.has(3)).toBe(false);
    expect(entries.has(5)).toBe(false);
  });

  it('FR-729 groups nearby archipelago pieces into one cluster and separates distant pieces', () => {
    const c1 = clusters.filter((c) => c.entry === 1);
    expect(c1).toHaveLength(1);
    expect(c1[0]).toMatchObject({ entry: 1, x0: 20, y0: 20, x1: 36, y1: 27, mainExtent: 3 });

    const c4 = clusters.filter((c) => c.entry === 4);
    expect(c4).toHaveLength(2);
  });

  it('FR-730 renders at full strength <= 14 px, fades smoothly 14..24 px, and hides >= 24 px', () => {
    expect(islandMarkerAlpha(5)).toBeCloseTo(1, 6);
    expect(islandMarkerAlpha(ISLAND_MARKER_PARAMS.fullBelowPx)).toBeCloseTo(1, 6);
    const mid = (ISLAND_MARKER_PARAMS.fullBelowPx + ISLAND_MARKER_PARAMS.fadeOutPx) / 2;
    expect(islandMarkerAlpha(mid)).toBeCloseTo(0.5, 6);
    expect(islandMarkerAlpha(ISLAND_MARKER_PARAMS.fadeOutPx)).toBeCloseTo(0, 6);
    expect(islandMarkerAlpha(40)).toBeCloseTo(0, 6);
  });

  it('FR-729 / FR-730 projects clusters with minimum readable frame size, owner colour, and dim consistency', () => {
    const table = new Uint16Array([0, 1, 2, 3, 2]); // entry 1 owned by faction 1; entry 4 owned by faction 2
    const colors: Rgb[] = [[0, 0, 0], [224, 108, 79], [91, 155, 213], [60, 140, 110]];
    const camera = { x: 150, y: 60, scale: 1 };
    const viewport = { width: 1000, height: 600 };

    const plain = resolveIslandMarkers(clusters, table, colors, camera, viewport);
    expect(plain).toHaveLength(3);
    const m1 = plain.find((m) => m.entry === 1)!;
    expect(m1.color).toStrictEqual([224, 108, 79]);
    expect(m1.w).toBeGreaterThanOrEqual(ISLAND_MARKER_PARAMS.minBoxPx);
    expect(m1.h).toBeGreaterThanOrEqual(ISLAND_MARKER_PARAMS.minBoxPx);
    expect(m1.alpha).toBeCloseTo(1, 6);

    // Narrow mobile viewport scales the minimum box down gently so markers stay crisp.
    const mobile = resolveIslandMarkers(clusters, table, colors, camera, { width: 390, height: 844 });
    const m4Mobile = mobile.find((m) => m.entry === 4)!;
    expect(m4Mobile.w).toBeGreaterThanOrEqual(10);
    expect(m4Mobile.w).toBeLessThan(ISLAND_MARKER_PARAMS.minBoxPx);

    // Dimmed capture/tour: lit faction 1 stays 1, non-lit faction 2 dims to dimAlpha.
    const dimmed = resolveIslandMarkers(clusters, table, colors, camera, viewport, { lit: [1], dim: 0.65 });
    const d1 = dimmed.find((m) => m.entry === 1)!;
    const d4 = dimmed.find((m) => m.entry === 4)!;
    expect(d1.alpha).toBeCloseTo(1, 6);
    expect(d4.alpha).toBeCloseTo(ISLAND_MARKER_PARAMS.dimAlpha, 6);

    // Zoomed in far enough that mainExtent * scale >= 24 px -> hidden.
    const zoomed = resolveIslandMarkers(clusters, table, colors, { x: 28, y: 23, scale: 10 }, viewport);
    expect(zoomed).toHaveLength(0);
  });
});
