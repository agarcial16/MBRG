import { colorDistance, luminance, parseHex, type RGB, type RasterImage } from './raster.js';

/**
 * Mode A: one flat colour per region.
 *
 * The naive read — "every distinct RGB is a region" — falls apart on real
 * exports: JPEG artefacts, anti-aliasing border pixels and dithering produce
 * thousands of near-identical colours, and each becomes its own speck of land.
 * So colours are first counted, then the frequent ones *represent* regions and
 * the rare ones are absorbed into the nearest representative (that's what the
 * tolerance is for).
 *
 * Three decisions here are what make the difference between "a pile of garbage"
 * and "a map", and all three came out of trying it on a real one:
 *
 * 1. **Regions are connected, not just coloured.** A colour bucket can hold
 *    hundreds of separate pieces — every letter of "RUSSIAN FED" drawn in the
 *    same grey, or a texture that repeats. Reporting that as one province gives
 *    it a hundred neighbours, which is nonsense, and calls every map "split".
 *    So each bucket is cut into its 4-connected pieces and each piece is a
 *    region. This is the single biggest change to how a real map reads.
 *
 * 2. **The sea is identified, not guessed from darkness.** "Dark and greyy =
 *    border" was a reasonable assumption for maps on white paper and a disaster
 *    for a night-theme map, where most of the image is dark and gets thrown
 *    away. The sea is now either transparency or a colour the user can see and
 *    pick, and dark pixels are just land unless they were chosen as sea.
 *
 * 3. **Smallness is relative.** A letter is 0.5% of the province it sits on, a
 *    real province is never that small compared to its peers. So the floor is a
 *    fraction of the *median* region rather than a pixel count, which is what
 *    makes the same setting work on a 400px map and a 4000px one.
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
   * Fraction of the median region area below which a region is dropped. This is
   * what removes painted text: letters are a rounding error next to a province,
   * and there are far more of them, so the median sits firmly on the provinces.
   */
  smallRegionRatio: number;
  /**
   * How the sea is found.
   *
   * `auto` prefers transparency when the image has enough of it and falls back to
   * the most common colour when it does not, which is the right answer for both
   * kinds of map without asking: a PNG with real transparency already says where
   * the water is, and a JPEG or an opaque PNG of a map does not, but on those
   * there is more water than land.
   *
   * `transparent` forces the transparency, and `picked` takes `seaColor`, which is
   * what the user gets after clicking the sea.
   *
   * There is deliberately no "always the most common colour" mode. On an image
   * that is mostly transparent it can only choose among the opaque colours, where
   * the most common one is the biggest province — so it would confidently eat the
   * wrong thing. `auto` reaching that conclusion on its own, from the transparency
   * it can actually see, is the useful version of the same idea.
   */
  sea: 'auto' | 'picked' | 'transparent';
  /** Sea colour for `sea: 'picked'`, as 0xRRGGBB. */
  seaColor: number;
  /** Treat fully transparent pixels as "not land" (sea / background). */
  ignoreTransparent: boolean;
  /**
   * Share of transparent pixels above which `auto` trusts the transparency
   * rather than guessing a colour. Low on purpose: a map exported with a
   * transparent sea has *some* transparency by definition, and mistaking a few
   * stray transparent pixels for a sea is much cheaper than mistaking a real
   * ocean for the largest province.
   */
  transparentShare: number;
}

export const DEFAULT_FLAT_COLOR_OPTIONS: FlatColorOptions = {
  tolerance: 32,
  minRegionArea: 24,
  // 2%: an enclave of 60x60 inside a 600x600 province survives (0.1% is
  // dropped), while a painted letter, at a few hundred pixels against a
  // province in the thousands, does not.
  smallRegionRatio: 0.02,
  sea: 'auto',
  seaColor: -1,
  ignoreTransparent: true,
  transparentShare: 0.02,
};

/** Why the importer threw pixels away, to explain it in the validation screen. */
export interface IgnoredPixels {
  /** Transparent background, when transparency is read as sea. */
  transparent: number;
  /** Pixels matching the sea colour. */
  sea: number;
  /** Speckle: colour buckets and connected pieces below the area floor. */
  speckle: number;
  /** Total pixels in the image. */
  total: number;
}

/** How the sea was decided, so the screen can say which rule applied. */
export type SeaChoice = 'transparency' | 'colour' | 'picked' | 'none';

/** A detected flat-colour region: one connected piece of land. */
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
  /** Image size, carried along so the labels below are self-describing. */
  width: number;
  height: number;
  regions: ColorRegion[];
  /**
   * Region index per pixel, row-major, or -1 where there is not land. This is
   * the intermediate form the rest of the importer works on: adjacency, contour
   * tracing and validation all read labels rather than colours.
   */
  labels: Int32Array;
  /** Where the non-land pixels went, so the screen can say so. */
  ignored: IgnoredPixels;
  /** The colour that was read as sea, or null when there was none. */
  seaColor: RGB | null;
  /** Which rule produced that decision. */
  seaChoice: SeaChoice;
  /** Distinct colours counted in the image, before merging or filtering. */
  distinctColors: number;
  /**
 * Area that covers half the map, the reference the relative floor is measured
 * against. Not a plain median: see `weightedMedian`.
 */
  medianArea: number;
  /**
   * Connected pieces dropped by the relative floor. Almost always painted
   * text; reported so the user can tell "my map has names on it" from "my map
   * is broken".
   */
  droppedSmallRegions: number;
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
  const ignored: IgnoredPixels = { transparent: 0, sea: 0, speckle: 0, total };

  // 1. Count every colour, transparency aside, and find the sea.
  //
  //    The sea is decided from the histogram rather than from a colour test,
  //    because "this is dark" is only meaningful on paper maps. `auto` takes the
  //    single most frequent colour, on the grounds that there is more water
    // than land; `picked` takes what the user clicked.
  const histogram = new Map<RGB, number>();
  const seaVotes = new Map<RGB, number>();
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (opts.ignoreTransparent && img.data[i + 3] < 128) {
      ignored.transparent++;
      continue;
    }
    const rgb = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
    histogram.set(rgb, (histogram.get(rgb) ?? 0) + 1);
    if (opts.sea !== 'picked') seaVotes.set(rgb, (seaVotes.get(rgb) ?? 0) + 1);
  }

  // The sea is decided once and said out loud, because "this came out wrong" and
    // "this came out wrong because that colour was the sea" are different
    // problems with different fixes.
  //
  // `auto` is the rule that answers both kinds of map without asking. A PNG with
  // real transparency has already said where the water is, and picking a colour
  // instead would pick the largest province. A map with no transparency has said
  // nothing, and there the most common colour is the ocean, because there is
  // more water than land.
  const transparentShare = opts.ignoreTransparent ? ignored.transparent / total : 0;
  const trustTransparency = transparentShare >= opts.transparentShare;
  const seaColor =
    opts.sea === 'picked'
      ? opts.seaColor
      : opts.sea === 'transparent' || trustTransparency
        ? -1
        : mostFrequent(seaVotes);
  const seaChoice: SeaChoice =
    opts.sea === 'picked' && opts.seaColor >= 0
      ? 'picked'
      : opts.sea === 'transparent' || (opts.sea === 'auto' && trustTransparency)
        ? 'transparency'
        : seaColor >= 0
          ? 'colour'
          : 'none';
  const isSea = (rgb: number): boolean =>
    seaColor >= 0 && colorDistance(rgb, seaColor) <= opts.tolerance;

  // 2. Re-walk the pixels, dropping the sea, and bucket the rest by colour.
  //
  //    Buckets are provisional: a bucket is a *colour*, and one colour can hold
  //    many separate pieces, so step 4 cuts them apart.
  const buckets = new Map<RGB, number[]>();
  const labels = new Int32Array(total).fill(-1);
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (opts.ignoreTransparent && img.data[i + 3] < 128) continue; // already counted
    const rgb = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
    if (isSea(rgb)) {
      ignored.sea++;
      continue;
    }
    const bucket = buckets.get(rgb);
    if (bucket) bucket.push(p);
    else buckets.set(rgb, [p]);
  }

  // 3. Absorb rare colours into the nearest frequent representative.
  //    Sorting by (count desc, colour asc) keeps it deterministic and makes the
  //    biggest representative index 0.
  const ranked = [...buckets.entries()]
    .map(([color, pixels]) => [color, pixels] as const)
    .sort(([ca, na], [cb, nb]) => nb.length - na.length || ca - cb);

  const representatives: RGB[] = [];
  const bucketToRepresentative: Map<RGB, number> = new Map();
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
    bucketToRepresentative.set(color, target);
  }

  // Pixels grouped by representative, ready to be cut into pieces.
  const byRepresentative: number[][] = representatives.map(() => []);
  for (const [color, pixels] of buckets) {
    const representative = bucketToRepresentative.get(color)!;
    const target = byRepresentative[representative];
    for (const p of pixels) target.push(p);
  }

  // 4. Cut each colour into its 4-connected pieces. Only neighbours within one
  //    colour join, so this is a scan of the label grid, not a flood fill per
  //    region: a pixel joins the piece of the pixel above it or to its left,
  //    when they share a colour, which is enough to make each piece one set.
  const pieces = splitConnected(byRepresentative, img.width, img.height, repsAt(byRepresentative, labels));

  // 5. Drop speckle: a piece too small to be a province is noise, not land.
  //    Two floors, both needed. The absolute one catches the noise that never
  //    joins anything; the relative one catches painted text, whose letters are
  //    big enough to pass any pixel count yet tiny next to the provinces around
  //    them.
  const areas = pieces.map((piece) => piece.pixels.length);
  const medianArea = weightedMedian(areas);
  const floor = Math.max(opts.minRegionArea, medianArea * opts.smallRegionRatio);

  const regions: ColorRegion[] = [];
  let droppedSmallRegions = 0;
  for (const piece of pieces) {
    if (piece.pixels.length < floor) {
      droppedSmallRegions++;
      ignored.speckle += piece.pixels.length;
      for (const p of piece.pixels) labels[p] = -1;
      continue;
    }
    const index = regions.length;
    for (const p of piece.pixels) labels[p] = index;
    regions.push({
      index,
      color: representatives[piece.representative],
      area: piece.pixels.length,
      pixels: piece.pixels,
    });
  }

  return {
    width: img.width,
    height: img.height,
    regions,
    labels,
    ignored,
    seaColor: seaColor >= 0 ? seaColor : null,
    seaChoice,
    distinctColors: histogram.size,
    medianArea,
    droppedSmallRegions,
  };
}

/**
 * The most frequent colour, ties broken by value so the answer does not depend
 * on Map iteration order.
 */
function mostFrequent(votes: Map<RGB, number>): number {
  let best = -1;
  let bestCount = 0;
  for (const [rgb, count] of votes) {
    if (count > bestCount || (count === bestCount && rgb < best)) {
      best = rgb;
      bestCount = count;
    }
  }
  return bestCount > 0 ? best : -1;
}

/**
 * The area that covers half the map, counting pixels rather than pieces.
 *
 * A plain median would be useless here, and not for a subtle reason: painted
 * text produces *more* pieces than the map has provinces — a map of 200
 * provinces with 2000 letters has 2200 pieces, and the middle of that sorted
 * list is a letter. The median would then define a letter as the typical
 * province and drop the real ones. Weighting by area asks the question that
 * actually matters: what size covers half the land on this map? Letters never
 * get there, however many of them there are.
 */
function weightedMedian(areas: number[]): number {
  if (areas.length === 0) return 0;
  const sorted = [...areas].sort((a, b) => a - b);
  let total = 0;
  for (const area of sorted) total += area;
  if (total === 0) return 0;
  let seen = 0;
  for (const area of sorted) {
    seen += area;
    if (seen * 2 >= total) return area;
  }
  return sorted[sorted.length - 1];
}

interface Piece {
  /** Which colour representative this piece was cut from. */
  representative: number;
  pixels: number[];
}

/** Write the representative index of each pixel into `out`, or -1. */
function repsAt(byRepresentative: number[][], out: Int32Array): Int32Array {
  out.fill(-1);
  for (let r = 0; r < byRepresentative.length; r++) {
    for (const p of byRepresentative[r]) out[p] = r;
  }
  return out;
}

/**
 * Split each representative's pixels into 4-connected pieces, largest first.
 *
 * A scan, not a flood fill: a pixel joins the piece of the pixel above or to its
 * left when they share a representative, so one pass over the list in row-major
 * order is enough. The list is sorted by construction (the histogram walk went
 * row-major), which is what makes the scan valid.
 */
function splitConnected(
  byRepresentative: number[][],
  width: number,
  height: number,
  representativeAt: Int32Array,
): Piece[] {
  const total = width * height;
  // DSU over every pixel that belongs to some representative.
  const parent = new Int32Array(total);
  for (let i = 0; i < total; i++) parent[i] = i;
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    // Path compression, so a long horizontal province stays near-linear.
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let r = 0; r < byRepresentative.length; r++) {
    for (const p of byRepresentative[r]) {
      if (p % width !== 0 && representativeAt[p - 1] === r) union(p, p - 1);
      if (p >= width && representativeAt[p - width] === r) union(p, p - width);
    }
  }

  const pieces = new Map<number, Piece>();
  for (let r = 0; r < byRepresentative.length; r++) {
    for (const p of byRepresentative[r]) {
      const root = find(p);
      let piece = pieces.get(root);
      if (!piece) {
        piece = { representative: r, pixels: [] };
        pieces.set(root, piece);
      }
      piece.pixels.push(p);
    }
  }

  // Largest first, then by colour, so region indices are stable across runs and
  // index 0 is the biggest region on the map.
  return [...pieces.values()].sort(
    (a, b) => b.pixels.length - a.pixels.length || a.representative - b.representative,
  );
}

/**
 * Legacy helper kept for the diagnostics the validation screen prints: a pixel
 * is dark *and* grey when it is much darker than a province but carries no hue.
 * Not used to decide land any more (see the module comment), only to explain
 * why a map looked the way it did.
 */
export function isBorderColor(rgb: RGB, maxLuminance = 40, maxChroma = 24): boolean {
  if (luminance(rgb) > maxLuminance) return false;
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return Math.max(r, g, b) - Math.min(r, g, b) <= maxChroma;
}

/** Hex string for a colour, for messages that name a region. */
export function describeRgb(rgb: RGB): string {
  return `#${rgb.toString(16).padStart(6, '0')}`;
}

/** `parseHex` re-exported so the UI can turn a clicked colour into a number. */
export { parseHex };