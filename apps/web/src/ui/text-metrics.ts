// Text aspect ratios (spec 005 definitions; FR-175 input): the advance width of a text in the label font at one
// reference size, divided by that size. Measured here, outside the pure layout code, and passed in (NFR-33).
import { fontString } from '../core/label-params';

/** The one reference size, in pixels. */
export const REFERENCE_PX = 100;

/** Advance width of a text in a CSS font, in pixels. */
export type TextMeasurer = (font: string, text: string) => number;

/** A measurer on a Canvas 2D context (created on first use). */
export function canvasMeasurer(): TextMeasurer {
  const ctx = document.createElement('canvas').getContext('2d');
  if (ctx === null) throw new Error('no 2D context to measure text');
  return (font, text) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}

/** One aspect ratio per distinct text; a text that measures as zero or not a number gets none. */
export function measureAspects(texts: Iterable<string>, measure: TextMeasurer = canvasMeasurer()): Map<string, number> {
  const font = fontString(REFERENCE_PX);
  const out = new Map<string, number>();
  const seen = new Set<string>();
  for (const text of texts) {
    if (seen.has(text)) continue;
    seen.add(text);
    const width = measure(font, text);
    if (Number.isFinite(width) && width > 0) out.set(text, width / REFERENCE_PX);
  }
  return out;
}
