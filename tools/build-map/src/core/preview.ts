import { WATER } from './rasterize';
import type { PreviewSource } from './types';

/**
 * FR-126: the review preview. Each faction is drawn in its preferred colour when given, else in a
 * colour distinct from every other base colour; sea zones share one colour and background has
 * another; all base colours are pairwise distinct. Every pixel with a 4-adjacent pixel of another
 * value is drawn darker (each channel floor(c / 2)); every other pixel in exactly its base colour.
 * Pure and deterministic (NFR-14).
 */

const SEA_COLOR = '#3c6e9e';
const BACKGROUND_COLOR = '#cdc6b4';

/** A fixed palette for factions without a preferred colour (and for a default that is taken). */
const PALETTE: readonly string[] = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6',
  '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', '#aaffc3',
];

/** The base colours of a preview: one per faction (same order as the source), the sea and the background. */
export interface PreviewColors {
  factions: string[];
  sea: string;
  background: string;
}

/** First candidate not used yet, else `#000001`, `#000002`, ... (so the result is always free). */
function takeFree(candidates: readonly string[], used: Set<string>): string {
  for (const color of candidates) {
    if (!used.has(color)) {
      used.add(color);
      return color;
    }
  }
  for (let n = 1; ; n++) {
    const color = '#' + n.toString(16).padStart(6, '0');
    if (!used.has(color)) {
      used.add(color);
      return color;
    }
  }
}

/**
 * Assigns the base colours: preferred faction colours first (a colour already taken is skipped, so
 * the colours stay distinct), then the sea, then the background, then the other factions.
 */
export function previewColors(source: PreviewSource): PreviewColors {
  const used = new Set<string>();
  const factions: (string | undefined)[] = source.factions.map((f) => {
    if (f.color === undefined || used.has(f.color)) return undefined;
    used.add(f.color);
    return f.color;
  });
  const sea = takeFree([SEA_COLOR, ...PALETTE], used);
  const background = takeFree([BACKGROUND_COLOR, ...PALETTE], used);
  return {
    factions: factions.map((c) => c ?? takeFree(PALETTE, used)),
    sea,
    background,
  };
}

function channels(color: string): [number, number, number] {
  return [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
  ];
}

/** The preview as raw RGB bytes (three per pixel, row-major), ready for the PNG codec. */
export function previewRgb(source: PreviewSource): Uint8Array {
  const { width, pixels } = source;
  const colors = previewColors(source);
  const sea = channels(colors.sea);
  const background = channels(colors.background);
  const byValue = new Map<number, [number, number, number]>();
  byValue.set(0, background);
  byValue.set(WATER, sea);
  const byFaction = new Map<number, [number, number, number]>();
  source.factions.forEach((f, i) => byFaction.set(f.id, channels(colors.factions[i]!)));
  for (const entry of source.entries) {
    byValue.set(entry.id, entry.kind === 'sea' ? sea : (byFaction.get(entry.owner) ?? background));
  }

  const rows = pixels.length / width;
  const out = new Uint8Array(3 * pixels.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const value = pixels[i]!;
      const base = byValue.get(value) ?? background;
      const border =
        (x > 0 && pixels[i - 1] !== value) ||
        (x < width - 1 && pixels[i + 1] !== value) ||
        (y > 0 && pixels[i - width] !== value) ||
        (y < rows - 1 && pixels[i + width] !== value);
      for (let c = 0; c < 3; c++) out[3 * i + c] = border ? Math.floor(base[c]! / 2) : base[c]!;
    }
  }
  return out;
}
