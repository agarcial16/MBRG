import type { FactionId, MapFormatV1, Ownership, TerritoryId } from '@mbrg/shared';

import type { Camera } from './camera.js';
import { frameAt, layoutLabels, rectInsideBlock, type FactionLabel } from './label.js';
import { edgeKey } from './topology.js';

/** Distinct, pleasant colors assigned to factions in map-territory order. */
export const factionPalette = [
  '#e0a3a8', // salmon
  '#7c7ce0', // periwinkle
  '#e8dc6c', // yellow
  '#5fbf7a', // green
  '#4c9be8', // blue
  '#d87cc0', // pink
  '#e8934c', // orange
  '#4ce0c8', // teal
];

const FALLBACK = '#888899';

/** Resolved color per territory (owner faction → color). */
export function territoryColorsOf(
  owners: Ownership,
  colors: Record<FactionId, string>,
): Record<TerritoryId, string> {
  const out: Record<TerritoryId, string> = {};
  for (const [territory, faction] of Object.entries(owners)) {
    out[territory] = colors[faction] ?? FALLBACK;
  }
  return out;
}

function mixHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(bl)}`;
}

/**
 * Fill colors mid-transition: territories changing owner crossfade from their
 * previous faction color to the annexer's color as t goes 0 → 1.
 */
export function interpolateFills(
  from: Ownership,
  to: Ownership,
  colors: Record<FactionId, string>,
  t: number,
): Record<TerritoryId, string> {
  const out: Record<TerritoryId, string> = {};
  for (const [territory, faction] of Object.entries(to)) {
    const prev = from[territory] ?? faction;
    out[territory] =
      prev === faction
        ? (colors[faction] ?? FALLBACK)
        : mixHex(colors[prev] ?? FALLBACK, colors[faction] ?? FALLBACK, t);
  }
  return out;
}

/** Initial owners: every territory starts as its own faction. */
export function initialOwners(map: MapFormatV1): Ownership {
  const owners: Ownership = {};
  for (const t of map.territories) owners[t.id] = t.id;
  return owners;
}

/** One color per initial faction (factions never reappear after dying). */
export function initialColors(map: MapFormatV1): Record<FactionId, string> {
  const colors: Record<FactionId, string> = {};
  map.territories.forEach((t, i) => {
    colors[t.id] = factionPalette[i % factionPalette.length];
  });
  return colors;
}

const BORDER = '#17172a';

/**
 * segment key → territories containing that segment. Cached per map
 * (maps are immutable during a match).
 */
const edgeCache = new WeakMap<MapFormatV1, Map<string, string[]>>();

function edgeSharing(map: MapFormatV1): Map<string, string[]> {
  const cached = edgeCache.get(map);
  if (cached) return cached;
  const index = new Map<string, string[]>();
  for (const t of map.territories) {
    const poly = t.polygon;
    for (let i = 0; i < poly.length; i++) {
      const key = edgeKey(poly[i], poly[(i + 1) % poly.length]);
      const list = index.get(key);
      if (list) list.push(t.id);
      else index.set(key, [t.id]);
    }
  }
  edgeCache.set(map, index);
  return index;
}

/** Trace a polygon path (without stroking/filling it). */
function tracePath(ctx: CanvasRenderingContext2D, poly: readonly (readonly number[])[]): void {
  const [first, ...rest] = poly;
  ctx.moveTo(first[0], first[1]);
  for (const [x, y] of rest) ctx.lineTo(x, y);
  ctx.closePath();
}

/**
 * Draw the whole map through a viewport camera (world → screen). `fills`
 * overrides per-territory colors (mid-animation crossfades).
 *
 * Borders: only segments facing a DIFFERENT owner (or the map's outside) are
 * stroked, so an annexed faction reads as one single block with a single outer
 * border — internal seams of eliminated states never show.
 */
export function drawMap(
  canvas: HTMLCanvasElement,
  map: MapFormatV1,
  owners: Ownership,
  colors: Record<FactionId, string>,
  camera: Camera,
  fills?: Record<TerritoryId, string>,
  labels?: FactionLabel[],
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // The canvas is the viewport: bitmap = CSS size × devicePixelRatio, crisp
  // at every zoom level.
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW <= 0 || cssH <= 0) return;
  const bw = Math.round(cssW * dpr);
  const bh = Math.round(cssH * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // CSS px space
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.translate(camera.tx, camera.ty); // world → screen
  ctx.scale(camera.scale, camera.scale);

  const resolved = fills ?? territoryColorsOf(owners, colors);

  // 1) Fills. Holes (lakes, enclaves) go in the same path and the even-odd rule
  //    cuts them out, so ring orientation does not have to be normalised.
  for (const t of map.territories) {
    ctx.beginPath();
    tracePath(ctx, t.polygon);
    for (const hole of t.holes ?? []) tracePath(ctx, hole);
    ctx.fillStyle = resolved[t.id] ?? FALLBACK;
    ctx.fill('evenodd');
  }

  // 2) Borders: only visible edges, batched into a single stroke call. Holes
  //    are walked too: a lake has no territory of its own, so its coastline is
  //    the only thing that will ever draw that edge. An enclave's hole is
  //    skipped by the `drawn` set, since its own polygon is the same edge.
  const sharing = edgeSharing(map);
  const drawn = new Set<string>();
  ctx.beginPath();
  for (const t of map.territories) {
    const owner = owners[t.id];
    for (const ring of [t.polygon, ...(t.holes ?? [])]) {
      for (let i = 0; i < ring.length; i++) {
        const p1 = ring[i];
        const p2 = ring[(i + 1) % ring.length];
        const key = edgeKey(p1, p2);
        if (drawn.has(key)) continue;
        const neighbors = sharing.get(key);
        const visible =
          !neighbors ||
          neighbors.some((id) => id !== t.id && owners[id] !== undefined && owners[id] !== owner);
        if (visible) {
          drawn.add(key);
          ctx.moveTo(p1[0], p1[1]);
          ctx.lineTo(p2[0], p2[1]);
        }
      }
    }
  }
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // 3) Labels: ONE per faction, EU4-style (sized/spread/oriented by the block).
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgb(0 0 0 / 60%)';
  ctx.shadowBlur = 4;
  for (const label of labels ?? fitLabels(ctx, map, owners)) {
    drawLabel(ctx, label, camera.scale);
  }
  ctx.shadowBlur = 0;
}

/** Screen-space (px) limits for label fonts, regardless of zoom level. */
const MIN_FONT_PX = 12;
const MAX_FONT_PX = 72;
/** Blocks smaller than this on screen fade their label out (zoomed far away). */
const FADE_BELOW_PX = 24;
const FADE_FULL_PX = 40;
/** Glyph boxes are checked with a slightly generous half-height (em based). */
const GLYPH_HALF = 0.55;
/** Draw-time containment retries: shrink span+size together until glyphs fit. */
const MAX_FIT_ATTEMPTS = 6;
const FIT_SHRINK = 0.82;
/** Absolute floor (world units) of the scale-independent fit; the screen clamp dominates visually. */
const FIT_FLOOR = 1;
/**
 * Max letter gap as a fraction of the font size. A long corridor gives a long
 * target span, and spreading a 7-letter name across 400 units of map stops
 * looking like a word. This keeps names letterspaced, not scattered.
 */
const MAX_TRACK = 0.3;

/** One placed glyph of a run: world position + tangent angle. */
interface Glyph {
  ch: string;
  x: number;
  y: number;
  a: number;
  w: number;
}

/**
 * A label's fitted glyph run: final size/span after the span cap and the
 * glyph-containment retries, plus every glyph placed on the label's curve
 * (arc offset → world position + tangent).
 */
interface GlyphRun {
  size: number;
  span: number;
  /** Width actually occupied once tracking is capped (the real visual size). */
  width: number;
  glyphs: Glyph[];
}

/**
 * Measure and fit one label: cap the size along `span0`, then validate glyph
 * by glyph that every letter really stays inside the block — shrinking span
 * and size together and retrying if not (the corridor guarantees the
 * centerline; concave sides may still pinch the glyph height). Stops at
 * `floor`, keeping the minimum size and letting the label overflow just
 * enough: an impossible case, not unreadable text.
 *
 * Measurement only touches world units, so it is scale independent and can be
 * memoized per state (see `fitLabels`). `validate=false` lays the glyphs out
 * without containment checks — mid-animation frames are validated on arrival
 * instead (their zones change mid-flight, checking there would stutter).
 */
function runGlyphs(
  ctx: CanvasRenderingContext2D,
  label: FactionLabel,
  size0: number,
  span0: number,
  floor: number,
  validate: boolean,
): GlyphRun {
  const { text, zones, curve } = label;
  const chars = [...text];
  if (chars.length === 0 || span0 <= 0) return { size: size0, span: span0, width: 0, glyphs: [] };
  let size = size0;
  let span = span0;
  let width = 0;
  let glyphs: Glyph[] = [];
  const center = curve.total / 2;
  for (let attempt = 0; attempt < MAX_FIT_ATTEMPTS; attempt++) {
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    let natural = ctx.measureText(text).width;
    if (natural > span) {
      // Long name in a small block: shrink until it fits along the curve
      // (a hard geometric cap — it wins over the screen-px minimum).
      size *= span / natural;
      ctx.font = `bold ${size}px system-ui, sans-serif`;
      natural = ctx.measureText(text).width;
    }

    const widths = chars.map((ch) => ctx.measureText(ch).width);
    let naturalTotal = 0;
    for (const w of widths) naturalTotal += w;
    const spread = chars.length > 1 && naturalTotal < span ? (span - naturalTotal) / (chars.length - 1) : 0;
    const gap = Math.min(spread, MAX_TRACK * size);
    const total = naturalTotal + gap * (chars.length - 1);
    width = total;
    const xs: number[] = [];
    let cx = -total / 2;
    for (const w of widths) {
      xs.push(cx);
      cx += w + gap;
    }
    // Arc offsets around the curve's midpoint → world position + tangent.
    glyphs = chars.map((ch, i) => {
      const f = frameAt(curve, center + xs[i]);
      return { ch, x: f.x, y: f.y, a: f.angle, w: widths[i] };
    });

    if (!validate) break;
    const halfH = size * GLYPH_HALF;
    let fits = true;
    for (const g of glyphs) {
      if (!rectInsideBlock(zones, [g.x, g.y], g.a, 0, -halfH, g.w, 2 * halfH)) {
        fits = false;
        break;
      }
    }
    if (fits) break;
    if (size <= floor + 1e-9) break; // floor reached: allow the tiny overflow
    const next = Math.max(floor, size * FIT_SHRINK);
    span *= next / size; // shrink span too, so tracking pulls the ends back in
    size = next;
  }
  return { size, span, width, glyphs };
}

/** Fit cache: measurement is deterministic per state, so memoize by owners. */
const fitCache = new WeakMap<MapFormatV1, WeakMap<Ownership, FactionLabel[]>>();

/**
 * Measure + validate a layout once per state, memoized by `owners`.
 *
 * Rest frames and animation endpoints share the *same* fitted labels — that
 * is what kills the size pop at the end of a transition: at t=1 the
 * interpolated size IS the fitted size, and the draw-time validation becomes
 * a no-op instead of shrinking the label one frame late.
 */
export function fitLabels(
  ctx: CanvasRenderingContext2D,
  map: MapFormatV1,
  owners: Ownership,
): FactionLabel[] {
  let perOwners = fitCache.get(map);
  if (!perOwners) {
    perOwners = new WeakMap();
    fitCache.set(map, perOwners);
  }
  const hit = perOwners.get(owners);
  if (hit) return hit;
  const fitted = layoutLabels(map, owners).map((label) => {
    if ((label.zones?.length ?? 0) === 0 || !label.text || label.span <= 0) return label;
    const run = runGlyphs(ctx, label, label.size, label.span, FIT_FLOOR, true);
    if (run.size === label.size && run.span === label.span) return label;
    return { ...label, size: run.size, span: run.span };
  });
  perOwners.set(owners, fitted);
  return fitted;
}

/**
 * Draw one faction label at EU4 style along the block's *centerline curve*:
 * fit the base size along the curve span, spread the glyphs (letter tracking)
 * over the arc, and keep the glyph-containment safety net (a no-op for fitted
 * labels; it still catches the zoom clamp raising a tiny label past its
 * fitted size). Mid-animation labels morph glyph by glyph between their two
 * fitted layouts — each side placed on its own curve — so the transition
 * lands exactly on the rest state.
 *
 * `scale` is the camera zoom: the font is clamped to a legible screen range
 * (12–72 px) and labels of blocks that are tiny *on screen* fade out instead of
 * shrinking into noise. Validation only runs at rest — mid-animation labels
 * (`moving` / fading) are checked on arrival.
 */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  label: FactionLabel,
  scale: number,
): void {
  const { text, span } = label;
  if (!text || span <= 0 || scale <= 0) return;

  // Clamp the font to a legible size ON SCREEN at the current zoom.
  const minWorld = MIN_FONT_PX / scale;
  const maxWorld = MAX_FONT_PX / scale;
  const clampSize = (s: number): number => Math.min(Math.max(Math.max(4, s), minWorld), maxWorld);
  const validate = label.alpha === undefined && !label.moving && (label.zones?.length ?? 0) > 0;

  const morph = label.morph;
  if (label.moving && morph && morph.from.text === text) {
    const from = morph.from;
    const A = runGlyphs(ctx, from, clampSize(from.size), from.span, minWorld, false);
    const B = runGlyphs(ctx, label, clampSize(label.size), span, minWorld, false);
    if (!applyAlpha(ctx, label, mix(A.width, B.width, morph.t), scale)) return;
    const n = Math.min(A.glyphs.length, B.glyphs.length);
    for (let i = 0; i < n; i++) {
      const a = A.glyphs[i];
      const b = B.glyphs[i];
      fillGlyph(
        ctx,
        a.ch,
        mix(a.x, b.x, morph.t),
        mix(a.y, b.y, morph.t),
        mixAngle(a.a, b.a, morph.t),
        mix(A.size, B.size, morph.t),
      );
    }
  } else {
    const run = runGlyphs(ctx, label, clampSize(label.size), span, minWorld, validate);
    // Fade by the width the name really occupies, not by the whole corridor:
    // a label on a long block is no more unreadable than a short one.
    if (!applyAlpha(ctx, label, run.width, scale)) return;
    for (const g of run.glyphs) fillGlyph(ctx, g.ch, g.x, g.y, g.a, run.size);
  }
  ctx.restore();
}

/**
 * Combine the label's own opacity with the zoom fade and open the canvas
 * state. Returns false when the label is invisible and nothing was drawn.
 */
function applyAlpha(
  ctx: CanvasRenderingContext2D,
  label: FactionLabel,
  width: number,
  scale: number,
): boolean {
  let alpha = label.alpha ?? 1;
  const widthPx = width * scale;
  if (widthPx < FADE_FULL_PX) {
    alpha *= Math.max(0, Math.min(1, (widthPx - FADE_BELOW_PX) / (FADE_FULL_PX - FADE_BELOW_PX)));
  }
  if (alpha <= 0) return false;
  ctx.save();
  ctx.globalAlpha = alpha;
  return true;
}

/** Draw one glyph at its world position, rotated along the curve's tangent. */
function fillGlyph(
  ctx: CanvasRenderingContext2D,
  ch: string,
  x: number,
  y: number,
  angle: number,
  size: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  if (angle !== 0) ctx.rotate(angle);
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.fillText(ch, 0, 0);
  ctx.restore();
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolate an angle along the shortest arc (no spinning around). */
function mixAngle(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}
