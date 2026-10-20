// The reference glyph layout and the per-glyph transform (spec 006 FR-200 to FR-202). Pure and on the drawing
// side: it is not part of the number-reference files (FR-213), so it may use trigonometric functions; the drawn
// result is checked by the FR-202 tolerance only. No DOM and no measuring here: advances come in as numbers.
import type { ArcFrame } from './label-shape';

/** The reference font size, in pixels, at which glyph advances are measured: the size of the text aspect ratios (005). */
export const GLYPH_REFERENCE_PX = 100;

const RAD = Math.PI / 180;

/** The interval of one glyph along the centre line: `start` from the start of the text, its `advance`. */
export interface GlyphOffset {
  start: number;
  advance: number;
}

/**
 * The advances measured at the reference size, all multiplied by one factor so that their sum is `w`; glyph i starts
 * at the sum of the scaled advances before it (FR-202 a). No glyphs, or advances that do not sum above 0, give none.
 */
export function glyphOffsets(advances: readonly number[], w: number): GlyphOffset[] {
  let total = 0;
  for (const a of advances) total += a;
  if (!(total > 0)) return [];
  const k = w / total;
  const out: GlyphOffset[] = [];
  let start = 0;
  for (const a of advances) {
    const advance = a * k;
    out.push({ start, advance });
    start += advance;
  }
  return out;
}

/** One arc glyph: the point of its reference position on the middle line (map units) and its tangent screen angle (degrees). */
export interface GlyphPlace {
  x: number;
  y: number;
  angle: number;
}

/**
 * The midpoint of each glyph's advance on the middle line of an arc frame (FR-201). The text is centred on (cx, cy):
 * the arc length s from it runs from -w/2 to w/2. With sign = +1 for a positive bend, the circle centre is at
 * (cx, cy) + sign x R x (-sin theta, -cos theta) (screen y grows downwards, so the ends of a positive bend are above
 * the middle at theta 0); the tangent turns by sign x s / R from theta.
 */
export function arcGlyphs(f: ArcFrame, offsets: readonly GlyphOffset[]): GlyphPlace[] {
  const sign = f.bend > 0 ? 1 : -1;
  const t = f.angle * RAD;
  const ox = f.cx + sign * f.radius * -Math.sin(t);
  const oy = f.cy + sign * f.radius * -Math.cos(t);
  return offsets.map((o) => {
    const s = o.start + o.advance / 2 - f.w / 2;
    const phi = t + (sign * s) / f.radius;
    return { x: ox + sign * f.radius * Math.sin(phi), y: oy + sign * f.radius * Math.cos(phi), angle: phi / RAD };
  });
}

/** A 2D affine matrix in the order of `CanvasRenderingContext2D.transform`. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/**
 * translate(centre) x rotate(-angle) x scale(w / measured, 1): the stretch is along the reading direction only
 * (FR-202 c). `frame` is on screen; `w` is its on-screen length and `measured` the advance width of the text in the
 * font the text is drawn with.
 */
export function straightMatrix(frame: { cx: number; cy: number; angle: number }, w: number, measured: number): Affine {
  const k = w / measured;
  const t = frame.angle * RAD;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { a: k * c, b: -k * s, c: s, d: c, e: frame.cx, f: frame.cy };
}
