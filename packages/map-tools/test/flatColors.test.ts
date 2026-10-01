import { describe, expect, it } from 'vitest';

import { describeRgb, detectFlatColorRegions, isBorderColor } from '../src/flatColors.js';
import { setPixel } from '../src/raster.js';
import { fillRect, rasterFromArt } from './fixtures/raster.js';

const PAL = { R: '#ff0000', G: '#00ff00', B: '#0000ff', '.': null, '-': '#000000' } as const;

describe('detectFlatColorRegions', () => {
  it('finds one region per connected piece, biggest first', () => {
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
    expect(result.ignored.speckle).toBe(0);
  });

  it('a colour in two separate places is two regions', () => {
    // Green is a single 2x1 block hanging off the top row, and a 4x1 block on
    // the bottom. The two do not touch, so they are two provinces.
    const img = rasterFromArt(['RRRRRRRR', 'RRRRRRGG', 'GGGGBBBB'], PAL);
    const result = detectFlatColorRegions(img, { minRegionArea: 1 });
    const greens = result.regions.filter((r) => r.color === 0x00ff00);
    expect(greens).toHaveLength(2);
    expect(greens.map((r) => r.area)).toEqual([4, 2]);
    // Ordering stays largest first: red 14, green 4, blue 4, green 2.
    expect(result.regions.map((r) => r.area)).toEqual([14, 4, 4, 2]);
    expect(result.regions.map((r) => r.color)).toEqual([
      0xff0000, 0x00ff00, 0x0000ff, 0x00ff00,
    ]);
  });

  it('reports pixel positions as y * width + x', () => {
    const img = rasterFromArt(['RG', 'GR'], PAL);
    const regions = detectFlatColorRegions(img, { minRegionArea: 1 }).regions;
    // Red sits at (0,0) and (1,1) of a 2-wide image, and those are two regions.
    const reds = regions.filter((r) => r.color === 0xff0000);
    expect(reds.map((r) => r.pixels)).toEqual([[0], [3]]);
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
    expect(result.ignored.transparent).toBe(1);
    expect(result.labels[3]).toBe(-1);
  });

  it('keeps dark pixels as land, because dark is not a border any more', () => {
    // The regression this whole change exists for: a night-theme map is mostly
    // dark, and "dark and grey means border" threw most of it away.
    const img = rasterFromArt(['--', '-R'], PAL);
    const result = detectFlatColorRegions(img, { minRegionArea: 1 });
    expect(result.regions.map((r) => r.color)).toEqual([0x000000, 0xff0000]);
    expect(result.ignored.speckle).toBe(0);
  });

  it('still keeps dark colours that a luminance test would have deleted', () => {
    // Pure navy has a luminance of 29. Under the old rule it was a border.
    const navy = rasterFromArt(['NN', 'RR'], { ...PAL, N: '#000080' });
    const regions = detectFlatColorRegions(navy, { minRegionArea: 1 });
    expect(regions.regions.map((r) => r.color)).toContain(0x000080);
  });

  it('drops a colour once it is chosen as sea', () => {
    const img = rasterFromArt(['--', '-R'], PAL);
    const result = detectFlatColorRegions(img, { minRegionArea: 1, sea: 'picked', seaColor: 0x000000 });
    expect(result.regions.map((r) => r.color)).toEqual([0xff0000]);
    expect(result.ignored.sea).toBe(3);
    expect(result.seaColor).toBe(0x000000);
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

    // With exact matching, every shade is its own region, and the pieces that
    // ended up next to each other merge back into one piece per shade.
    const exact = detectFlatColorRegions(img, { minRegionArea: 1, tolerance: 0 });
    expect(exact.regions).toHaveLength(4);
  });

  it('keeps distinct colours apart when they are far enough', () => {
    const img = rasterFromArt(['RG'], PAL);
    const result = detectFlatColorRegions(img, { minRegionArea: 1, tolerance: 32 });
    expect(result.regions).toHaveLength(2);
  });

  it('discards speckle below the minimum area and counts it', () => {
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
    expect(result.ignored.speckle).toBe(1);
    expect(result.droppedSmallRegions).toBe(1);
  });

  it('returns nothing for an image with no land at all', () => {
    const empty = rasterFromArt(['....', '....'], PAL);
    const result = detectFlatColorRegions(empty);
    expect(result.regions).toEqual([]);
    expect(result.ignored.transparent).toBe(8);
    expect(result.distinctColors).toBe(0);
    expect(result.seaColor).toBeNull();
  });

  it('is deterministic: same image, same result, twice', () => {
    const img = rasterFromArt(['RGBRGB', 'GRBGRB'], PAL);
    const a = detectFlatColorRegions(img, { minRegionArea: 1, tolerance: 10 });
    const b = detectFlatColorRegions(img, { minRegionArea: 1, tolerance: 10 });
    expect(a).toEqual(b);
  });
});

describe('isBorderColor', () => {
  it('is a description of a colour, not a decision about land', () => {
    // Kept so the validation screen can explain why a map looked the way it
    // did. Nothing in the detection path calls it any more.
    expect(isBorderColor(0x000000)).toBe(true); // black
    expect(isBorderColor(0x202020)).toBe(true); // dark grey
    expect(isBorderColor(0x0000ff)).toBe(false); // pure blue: dark but a hue
    expect(isBorderColor(0x808080)).toBe(false); // mid grey: not dark
  });
});

describe('describeRgb', () => {
  it('pads to six digits so two regions never print the same colour', () => {
    expect(describeRgb(0x00ff00)).toBe('#00ff00');
    expect(describeRgb(0xff0000)).toBe('#ff0000');
    expect(describeRgb(0x0000ff)).toBe('#0000ff');
  });
});