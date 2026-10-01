import { describe, expect, it } from 'vitest';

import { assembleMap } from '../src/assemble.js';
import { detectAdjacency } from '../src/adjacency.js';
import { traceContours, type ContourOptions } from '../src/contours.js';
import { detectFlatColorRegions } from '../src/flatColors.js';
import { createRaster, setPixel } from '../src/raster.js';

const SEA = 0x101018;
const RED = 0xc0392b;
const GREEN = 0x27ae60;

/** A solid rectangle of one colour, as land. */
function fill(img: ReturnType<typeof createRaster>, x0: number, y0: number, w: number, h: number, rgb: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x >= 0 && y >= 0 && x < img.width && y < img.height) setPixel(img, x, y, rgb);
    }
  }
}

/**
 * A map whose provinces have text painted on them.
 *
 * This is what most good-looking maps look like: Azgaar exports, EU4
 * screenshots, anything with the names drawn in. The letters are dark, so the
 * border test takes them for land that is not there and the tracer finds each
 * letter as a lake. These tests pin what happens to them.
 *
 * The sizes are deliberately realistic (a 120x60 province, 8x6 letters) because
 * that is the whole point of a *relative* threshold: the letters are 0.7% of
 * their province, and any fixed pixel size would be wrong on a different map.
 */
function mapWithText(options: Partial<ContourOptions> = {}) {
  const img = createRaster(130, 75, SEA);
  fill(img, 0, 0, 120, 60, RED); // province A, with letters
  fill(img, 0, 60, 120, 10, GREEN); // province B, plain
  for (let i = 0; i < 6; i++) {
    fill(img, 8 + i * 18, 26, 8, 6, SEA); // six painted letters
  }

  const flat = detectFlatColorRegions(img, { minRegionArea: 16 });
  const adjacency = detectAdjacency(flat);
  const contours = traceContours(flat, { simplify: 0, ...options });
  return { flat, contours, assembled: assembleMap(flat, adjacency, contours, { name: 'painted' }) };
}

describe('mapas con texto pintado', () => {
  it('las letras se leen como lagos, no como tierra', () => {
    // The raw behaviour, with no filtering at all: one hole per letter.
    const { contours, flat } = mapWithText({ minHoleRatio: 0 });
    const withText = flat.regions.find((r) => r.color === RED)!;
    const holes = contours.holesByRegion.get(withText.index) ?? [];
    expect(holes).toHaveLength(6);
    // Every one of them holds no region: painted ink, not land.
    expect(holes.every((h) => h.enclosed === -1)).toBe(true);
  });

  it('descarta los agujeros pequeños por defecto y lo dice', () => {
    const { contours, assembled, flat } = mapWithText();
    const withText = flat.regions.find((r) => r.color === RED)!;
    expect(contours.holesByRegion.get(withText.index) ?? []).toHaveLength(0);
    expect(contours.droppedHoles).toBe(6);
    const warning = assembled.warnings.find((w) => w.code === 'tinyHolesDropped');
    expect(warning).toBeDefined();
    expect(warning!.numbers!.count).toBe(6);
    expect(warning!.detail).toMatch(/painted on it/);
    // ...and the exported map comes out clean.
    expect(assembled.errors).toEqual([]);
    expect(assembled.map.territories.every((t) => !t.holes)).toBe(true);
  });

  it('un lago de verdad sobrevive al filtro', () => {
    // 40x20 inside a 120x60 province: 11% of it, far above the 1% threshold.
    const img = createRaster(130, 70, SEA);
    fill(img, 0, 0, 120, 60, RED);
    fill(img, 40, 20, 40, 20, SEA);
    const flat = detectFlatColorRegions(img, { minRegionArea: 16 });
    const contours = traceContours(flat, { simplify: 0 });
    const region = flat.regions.find((r) => r.color === RED)!;
    expect(contours.holesByRegion.get(region.index) ?? []).toHaveLength(1);
    expect(contours.droppedHoles).toBe(0);
  });

  it('nunca descarta un enclava, por pequeño que sea', () => {
    // A tiny province inside a big one is another territory, and dropping its
    // hole would let the surrounding fill paint over it.
    //
    // `smallRegionRatio: 0` on purpose: with only these two regions the relative
    // floor would compare a 1 px enclave against a 7200 px province and drop it
    // as speckle, which is a different question from the one this test asks.
    const img = createRaster(130, 70, SEA);
    fill(img, 0, 0, 120, 60, RED);
    setPixel(img, 60, 30, GREEN, 255);
    const flat = detectFlatColorRegions(img, {
      minRegionArea: 1,
      smallRegionRatio: 0,
      sea: 'picked',
      seaColor: SEA,
    });
    const contours = traceContours(flat, { simplify: 0, minHoleRatio: 0.9 });
    const outer = flat.regions.find((r) => r.color === RED)!;
    const inner = flat.regions.find((r) => r.color === GREEN)!;
    const holes = contours.holesByRegion.get(outer.index) ?? [];
    expect(holes).toHaveLength(1);
    expect(holes[0].enclosed).toBe(inner.index);
    expect(contours.droppedHoles).toBe(0);
  });

  it('el umbral se puede desactivar sin tocar el resto', () => {
    const { contours, flat } = mapWithText({ minHoleRatio: 0 });
    const withText = flat.regions.find((r) => r.color === RED)!;
    expect(contours.holesByRegion.get(withText.index) ?? []).toHaveLength(6);
    expect(contours.droppedHoles).toBe(0);
  });
});
