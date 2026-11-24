// Deterministic procedural colour palette (spec 033 FR-642, FR-643, NFR-161). Pure: no randomness,
// no clock, no DOM. Used only as a last resort when the curated base palette is exhausted by a
// faction's land-adjacent neighbours.
import type { Rgb } from '@mbrg/shared';

/** Minimum perceptual RGB distance between procedural colours and land-adjacent neighbours. */
export const MIN_LAND_SEPARATION = 48;

/** Number of primary cartographic procedural colours searched before relaxing separation. */
export const PRIMARY_PROCEDURAL_LIMIT = 2048;

/** Packed 24-bit integer key for exact RGB equality and O(1) Set lookups. */
export function rgbKey(c: Rgb): number {
  return (c[0] << 16) | (c[1] << 8) | c[2];
}

/** Redmean weighted Euclidean RGB distance (0..~765), deterministic and fast. */
export function colorDistance(a: Rgb, b: Rgb): number {
  const rm = (a[0] + b[0]) * 0.5;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

/** Rejects near-black (FR-143: channel sum > 120) and near-white (keeps white labels and pick outline crisp). */
export function isValidFactionRgb(c: Rgb): boolean {
  const sum = c[0] + c[1] + c[2];
  if (sum <= 120 || sum >= 675) return false;
  if (c[0] > 225 && c[1] > 225 && c[2] > 225) return false;
  return true;
}

/** Pure HSL (h in 0..360, s and l in 0..1) to 8-bit RGB. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Cartographic saturation/lightness bands for Tier 1 golden-angle dispersion. */
const TIER1_BANDS: readonly (readonly [number, number])[] = [
  [0.58, 0.52],
  [0.48, 0.64],
  [0.64, 0.42],
  [0.42, 0.72],
  [0.54, 0.36],
  [0.68, 0.58],
  [0.36, 0.56],
  [0.60, 0.68],
];

const GOLDEN_ANGLE = 137.50776405003785;
/** Odd stride coprime to 2^24 (16,777,216): visits every 24-bit RGB once in deterministic dispersed order. */
const BIJECTION_STRIDE = 5_242_883;
const BIJECTION_START = 0x5a3c91;

export interface ProceduralPalette {
  next(): Rgb;
}

/**
 * Deterministic, seedless stream of pairwise distinct RGB colours excluding `excluded`.
 * Tier 1 emits cartographically balanced golden-angle HSL colours (skipping pale sea-blue hues);
 * Tier 2 walks a full-period 24-bit bijection so well over 65,535 distinct valid colours are always available.
 */
export function createProceduralPalette(excluded: ReadonlySet<number>): ProceduralPalette {
  const seen = new Set<number>(excluded);
  let tier1Step = 0;
  const maxTier1Steps = PRIMARY_PROCEDURAL_LIMIT * 2;
  let bijectionState = BIJECTION_START;

  return {
    next(): Rgb {
      while (tier1Step < maxTier1Steps) {
        const i = tier1Step++;
        const hue = (i * GOLDEN_ANGLE + 23) % 360;
        const [sat, light] = TIER1_BANDS[i % TIER1_BANDS.length]!;
        // Keep primary procedural shades visually clear of pale sea blue (#9cc0dc).
        if (hue >= 192 && hue <= 224 && light > 0.58) continue;
        const rgb = hslToRgb(hue, sat, light);
        if (!isValidFactionRgb(rgb)) continue;
        const k = rgbKey(rgb);
        if (seen.has(k)) continue;
        seen.add(k);
        return rgb;
      }

      // Tier 2: full-period bijection over the 24-bit RGB cube (guaranteed > 15M valid colours).
      for (;;) {
        bijectionState = (bijectionState + BIJECTION_STRIDE) & 0xffffff;
        const rgb: Rgb = [(bijectionState >> 16) & 255, (bijectionState >> 8) & 255, bijectionState & 255];
        if (!isValidFactionRgb(rgb)) continue;
        const k = rgbKey(rgb);
        if (seen.has(k)) continue;
        seen.add(k);
        return rgb;
      }
    },
  };
}
