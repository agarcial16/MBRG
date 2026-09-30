import type { FactionId, MapFormatV1, Ownership, TerritoryId } from '@mbrg/shared';

import type { Camera } from './camera.js';
import { layoutLabels, rectInsideBlock, type FactionLabel } from './label.js';
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

  // 1) Fills.
  for (const t of map.territories) {
    ctx.beginPath();
    tracePath(ctx, t.polygon);
    ctx.fillStyle = resolved[t.id] ?? FALLBACK;
    ctx.fill();
  }

  // 2) Borders: only visible edges, batched into a single stroke call.
  const sharing = edgeSharing(map);
  const drawn = new Set<string>();
  ctx.beginPath();
  for (const t of map.territories) {
    const owner = owners[t.id];
    const poly = t.polygon;
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % poly.length];
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
  for (const label of labels ?? layoutLabels(map, owners)) {
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

/**
 * Draw one faction label at EU4 style, adapted to the block's *corridor*:
 * fit the base size along the corridor span, spread the glyphs (letter
 * tracking) to fill it, and validate glyph by glyph that every letter really
 * stays inside the block — shrinking span+size together and retrying if not
 * (the corridor guarantees the centerline; concave sides may still pinch the
 * glyph height). At the legible screen minimum the label keeps that size and
 * overflows just enough: an impossible case, not unreadable text.
 *
 * `scale` is the camera zoom: the font is clamped to a legible screen range
 * (12–72 px) and labels of blocks that are tiny *on screen* fade out instead of
 * shrinking into noise. Validation only runs at rest — mid-animation labels
 * (`moving` / fading) interpolate positions and are checked on arrival.
 */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  label: FactionLabel,
  scale: number,
): void {
  const { text, x, y, angle, span } = label;
  if (!text || span <= 0 || scale <= 0) return;
  let alpha = label.alpha ?? 1;
  // Fade labels of blocks too small to read at this zoom.
  const spanPx = span * scale;
  if (spanPx < FADE_FULL_PX) {
    alpha *= Math.max(0, Math.min(1, (spanPx - FADE_BELOW_PX) / (FADE_FULL_PX - FADE_BELOW_PX)));
  }
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  if (angle !== 0) ctx.rotate(angle);

  // Clamp the font to a legible size ON SCREEN at the current zoom.
  const minWorld = MIN_FONT_PX / scale;
  const maxWorld = MAX_FONT_PX / scale;
  let size = Math.min(Math.max(Math.max(4, label.size), minWorld), maxWorld);
  let target = span;
  const chars = [...text];
  const validate = label.alpha === undefined && !label.moving && (label.zones?.length ?? 0) > 0;

  let widths: number[] = [];
  let xs: number[] = [];
  let gap = 0;
  for (let attempt = 0; attempt < MAX_FIT_ATTEMPTS; attempt++) {
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    let natural = ctx.measureText(text).width;
    if (natural > target) {
      // Long name in a small block: shrink until it fits along the corridor
      // (a hard geometric cap — it wins over the screen-px minimum).
      size *= target / natural;
      ctx.font = `bold ${size}px system-ui, sans-serif`;
      natural = ctx.measureText(text).width;
    }

    widths = chars.map((ch) => ctx.measureText(ch).width);
    let naturalTotal = 0;
    for (const w of widths) naturalTotal += w;
    gap = chars.length > 1 && naturalTotal < target ? (target - naturalTotal) / (chars.length - 1) : 0;
    const total = naturalTotal + gap * (chars.length - 1);
    xs = [];
    let cx = -total / 2;
    for (const w of widths) {
      xs.push(cx);
      cx += w + gap;
    }

    if (!validate) break;
    const halfH = size * GLYPH_HALF;
    let fits = true;
    for (let i = 0; i < chars.length; i++) {
      if (!rectInsideBlock(label.zones, [x, y], angle, xs[i], -halfH, widths[i], 2 * halfH)) {
        fits = false;
        break;
      }
    }
    if (fits) break;
    if (size <= minWorld + 1e-9) break; // legible floor reached: allow the tiny overflow
    const next = Math.max(minWorld, size * FIT_SHRINK);
    target *= next / size; // shrink span too, so tracking pulls the ends back in
    size = next;
  }

  for (let i = 0; i < chars.length; i++) ctx.fillText(chars[i], xs[i], 0);
  ctx.restore();
}
