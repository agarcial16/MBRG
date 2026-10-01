import { colorDistance, luminance, type RGB, type RasterImage } from './raster.js';

/**
 * Mode A: one flat colour per region.
 *
 * The naive read — "every distinct RGB is a region" — falls apart on real
 * exports: JPEG artefacts, anti-aliased border pixels and dithering produce
 * thousands of near-identical colours, and each becomes its own speck of land.
 * So colours are first counted, then the frequent ones *represent* regions and
 * the rare ones are absorbed into the nearest representative (that's what the
 * tolerance is for), and finally a bucket too small to be a province is
 * discarded as speckle.
 *
 * Cost is linear in pixels plus a pass over distinct colours: a full EU4-size
 * bitmap (~11.5M pixels) is a couple of seconds at worst, and the flat-colour
 * path never touches a canvas.
 */

export interface FlatColorOptions {
  /**
   * Max distance between two colours to call them the same. 0 means exact
   * matching; typical exports want something like 20–60.
   */
  tolerance: number;
  /** Ignore regions smaller than this many pixels. */
  minRegionArea: number;
  /**
   * Ignore near-black pixels, whatever their colour: map borders are drawn
   * dark and anti-aliasing makes them grey, and they are borders, not land.
   */
  borderLuminance: number;
  /**
   * A pixel is only a border if it is dark *and* unsaturated. Luminance alone
   * is not enough: pure blue has a luminance of 29, and dropping it would
   * delete a perfectly valid province. Real borders are black or grey, so they
   * carry almost no colour.
   */
  borderChroma: number;
  /** Treat fully transparent pixels as "not land" (sea / background). */
  ignoreTransparent: boolean;
}

export const DEFAULT_FLAT_COLOR_OPTIONS: FlatColorOptions = {
  tolerance: 32,
  minRegionArea: 24,
  borderLuminance: 40,
  borderChroma: 24,
  ignoreTransparent: true,
};

/**
 * Is this colour a map border rather than land? Dark *and* grey: a black or
 * grey line is a border, a dark blue or dark green is a province.
 */
export function isBorderColor(rgb: RGB, options: FlatColorOptions): boolean {
  if (luminance(rgb) > options.borderLuminance) return false;
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return Math.max(r, g, b) - Math.min(r, g, b) <= options.borderChroma;
}

/** A detected flat-colour region. */
export interface ColorRegion {
  /** 0-based index, assigned by descending area so index 0 is the biggest. */
  index: number;
  /** Representative colour: the most common colour that fell in this region. */
  color: RGB;
  /** Pixel count. */
  area: number;
  /** Packed `(y * width + x)` positions, so callers can walk them cheaply. */
  pixels: number[];
}

/** Everything the importer learned from the image in mode A. */
export interface FlatColorResult {
  regions: ColorRegion[];
  /** Pixels that are not land: transparent, dark, or speckle. */
  ignoredPixels: number;
  /** Distinct colours counted in the image, before merging or filtering. */
  distinctColors: number;
}

/**
 * Detect flat-colour regions. Deterministic: no `Math.random`, no iteration
 * over hash order, so the same image always yields the same regions in the
 * same order.
 */
export function detectFlatColorRegions(
  img: RasterImage,
  options: Partial<FlatColorOptions> = {},
): FlatColorResult {
  const opts: FlatColorOptions = { ...DEFAULT_FLAT_COLOR_OPTIONS, ...options };
  const total = img.width * img.height;
  let ignoredPixels = 0;

  // 1. Count every candidate colour. Land pixels only: transparent and dark
  //    pixels are borders/sea and never become regions.
  const histogram = new Map<RGB, number>();
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (opts.ignoreTransparent && img.data[i + 3] < 128) {
      ignoredPixels++;
      continue;
    }
    const rgb = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
    if (isBorderColor(rgb, opts)) {
      ignoredPixels++;
      continue;
    }
    histogram.set(rgb, (histogram.get(rgb) ?? 0) + 1);
  }

  // 2. Most frequent colour becomes a region and absorbs the nearby ones.
  //    Sorting by (count desc, colour asc) keeps it deterministic and makes
  //    the biggest region index 0.
  const ranked = [...histogram.entries()].sort(
    ([ca, na], [cb, nb]) => nb - na || ca - cb,
  );

  const representatives: RGB[] = [];
  /** colour → region index, so step 3 is a single lookup per pixel. */
  const colorToRegion = new Map<RGB, number>();
  for (const [color] of ranked) {
    let target = -1;
    for (let r = 0; r < representatives.length; r++) {
      if (colorDistance(color, representatives[r]) <= opts.tolerance) {
        target = r;
        break;
      }
    }
    if (target < 0) {
      target = representatives.length;
      representatives.push(color);
    }
    colorToRegion.set(color, target);
  }

  // 3. Walk the pixels once more and fill the regions.
  const pixelsByRegion: number[][] = representatives.map(() => []);
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const rgb = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
    const region = colorToRegion.get(rgb);
    if (region === undefined) continue; // already counted as ignored above
    pixelsByRegion[region].push(p);
  }

  // 4. Drop speckle: a bucket too small to be a province is noise, not land.
  const regions: ColorRegion[] = [];
  for (let r = 0; r < pixelsByRegion.length; r++) {
    const pixels = pixelsByRegion[r];
    if (pixels.length < opts.minRegionArea) {
      ignoredPixels += pixels.length;
      continue;
    }
    regions.push({
      index: regions.length,
      color: representatives[r],
      area: pixels.length,
      pixels,
    });
  }

  return { regions, ignoredPixels, distinctColors: histogram.size };
}
