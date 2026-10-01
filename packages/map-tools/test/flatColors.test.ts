import { describe, expect, it } from 'vitest';

import { detectFlatColorRegions } from '../src/flatColors.js';
import { setPixel } from '../src/raster.js';
import { fillRect, rasterFromArt } from './fixtures/raster.js';

const PAL = { R: '#ff0000', G: '#00ff00', B: '#0000ff', '.': null, '-': '#000000' } as const;

describe('detectFlatColorRegions', () => {
  it('finds one region per flat colour, biggest first', () => {
    const img = rasterFromArt(
      [
        'RRRRRR',
        'RRRRRR',
        'GGGGGG',
        'GGGGGG',
        'BBBBBB',
        'BBBBBB',
      ],
      PAL,
    );
    const result = detectFlatColorRegions(img, { minRegionArea: 1 });

    expect(result.regions).toHaveLength(3);
    // All three have the same area, so ordering falls back to colour value:
    // blue (0x0000ff) < green (0x00ff00) < red (0xff0000).
    expect(result.regions.map((r) => r.color)).toEqual([0x0000ff, 0x00ff00, 0xff0000]);
    for (const region of result.regions) {
      expect(region.area).toBe(12);
      expect(region.pixels).toHaveLength(12);
    }
    expect(result.ignoredPixels).toBe(0);
  });

  it('orders by descending area when sizes differ', () => {
    const img = rasterFromArt(['RRRRRRRR', 'RRRRRRGG', 'GGGGBBBB'], PAL);
    const result = detectFlatColorRegions(img, { minRegionArea: 1 });
    expect(result.regions.map((r) => r.color)).toEqual([0xff0000, 0x00ff00, 0x0000ff]);
    // 8 + 6 reds, 2 + 4 greens, 4 blues.
    expect(result.regions.map((r) => r.area)).toEqual([14, 6, 4]);
  });

  it('reports pixel positions as y * width + x', () => {
    const img = rasterFromArt(['RG', 'GR'], PAL);
    const regions = detectFlatColorRegions(img, { minRegionArea: 1 }).regions;
    const red = regions.find((r) => r.color === 0xff0000)!;
    // Red sits at (0,0) and (1,1) of a 2-wide image.
    expect(red.pixels).toEqual([0, 3]);
  });

  it('treats transparent pixels as sea, not land', () => {
    const img = rasterFromArt(['RR', 'R.'], PAL);
    // Give the transparent pixel a colour that would pass as land if the
    // importer looked at RGB alone, so this tests the alpha check and nothing
    // else.
    setPixel(img, 1, 1, 0x00ff00, 0);

    const result = detectFlatColorRegions(img, { minRegionArea: 1 });
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].color).toBe(0xff0000);
    expect(result.ignoredPixels).toBe(1);

    // ...unless the caller asks for them.
    const opaque = detectFlatColorRegions(img, { minRegionArea: 1, ignoreTransparent: false });
    expect(opaque.regions).toHaveLength(2);
  });

  it('treats dark grey pixels as borders, but keeps dark colours as land', () => {
    const bordered = rasterFromArt(['RR', 'R-'], PAL);
    const withBorder = detectFlatColorRegions(bordered, { minRegionArea: 1 });
    expect(withBorder.regions).toHaveLength(1);
    expect(withBorder.ignoredPixels).toBe(1);

    // Dark navy has a low luminance (and used to be thrown away as a border).
    const navy = rasterFromArt(['NN', 'RR'], { ...PAL, N: '#000080' });
    const regions = detectFlatColorRegions(navy, { minRegionArea: 1 });
    expect(regions.regions.map((r) => r.color)).toContain(0x000080);
  });

  it('merges colours within tolerance, so anti-aliasing does not create regions', () => {
    const img = rasterFromArt(['RRRR', 'RRRR'], PAL);
    // Row 0 gets three nearly identical reds, row 1 keeps the pure one.
    fillRect(img, 0, 0, 1, 1, '#f80000');
    fillRect(img, 1, 0, 1, 1, '#f50000');
    fillRect(img, 2, 0, 2, 1, '#f20000');

    const loose = detectFlatColorRegions(img, { minRegionArea: 1, tolerance: 20 });
    expect(loose.regions).toHaveLength(1);
    expect(loose.distinctColors).toBe(4);

    // With exact matching, every shade becomes its own region.
    const exact = detectFlatColorRegions(img, { minRegionArea: 1, tolerance: 0 });
    expect(exact.regions).toHaveLength(4);
  });

  it('keeps distinct colours apart when they are far enough', () => {
    const img = rasterFromArt(['RG'], PAL);
    const result = detectFlatColorRegions(img, { minRegionArea: 1, tolerance: 32 });
    expect(result.regions).toHaveLength(2);
  });

  it('discards speckle below the minimum area', () => {
    const img = rasterFromArt(
      [
        'RRRRRRRR',
        'RRRRRRRR',
        'RRRRRGRR',
      ],
      PAL,
    );
    const result = detectFlatColorRegions(img, { minRegionArea: 4 });
    // The single green pixel is noise, not a province.
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].color).toBe(0xff0000);
    expect(result.ignoredPixels).toBe(1);
  });

  it('returns nothing for an image with no land at all', () => {
    const empty = rasterFromArt(['----', '....'], PAL);
    const result = detectFlatColorRegions(empty);
    expect(result.regions).toEqual([]);
    expect(result.ignoredPixels).toBe(8);
    expect(result.distinctColors).toBe(0);
  });

  it('is deterministic: same image, same result, twice', () => {
    const img = rasterFromArt(['RGBRGB', 'GRBGRB'], PAL);
    const a = detectFlatColorRegions(img, { minRegionArea: 1, tolerance: 10 });
    const b = detectFlatColorRegions(img, { minRegionArea: 1, tolerance: 10 });
    expect(a).toEqual(b);
  });
});
