import type { FactionId, MapFormatV1, Ownership, TerritoryId } from '@mbrg/shared';

import { layoutLabels, type FactionLabel } from './label.js';

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

/** Canonical key for a segment so both neighbor polygons produce the same key. */
function edgeKey(p1: readonly number[], p2: readonly number[]): string {
  const a = `${p1[0]},${p1[1]}`;
  const b = `${p2[0]},${p2[1]}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

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
 * Draw the whole map. `fills` overrides per-territory colors (mid-animation
 * crossfades).
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
  fills?: Record<TerritoryId, string>,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = map.width ?? 800;
  canvas.height = map.height ?? 600;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

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
  for (const label of layoutLabels(map, owners)) drawLabel(ctx, label);
  ctx.shadowBlur = 0;
}

/**
 * Draw one faction label at EU4 style: fit the base size so the text never
 * outgrows the block's long axis, then spread the glyphs (letter tracking) to
 * span it. `label.angle` handles tall, narrow blocks (text runs top→bottom).
 */
function drawLabel(ctx: CanvasRenderingContext2D, label: FactionLabel): void {
  const { text, x, y, angle, span } = label;
  if (!text || span <= 0) return;

  ctx.save();
  ctx.translate(x, y);
  if (angle !== 0) ctx.rotate(angle);

  let size = Math.max(4, label.size);
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  let natural = ctx.measureText(text).width;
  if (natural > span) {
    // Long name in a small block: shrink until it fits along the block.
    size *= span / natural;
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    natural = ctx.measureText(text).width;
  }

  const chars = [...text];
  if (chars.length > 1) {
    // Spread glyphs to span the block (classic map-game tracking).
    let naturalTotal = 0;
    for (const ch of chars) naturalTotal += ctx.measureText(ch).width;
    const gap = naturalTotal < span ? (span - naturalTotal) / (chars.length - 1) : 0;
    const total = naturalTotal + gap * (chars.length - 1);
    let cx = -total / 2;
    for (const ch of chars) {
      const w = ctx.measureText(ch).width;
      ctx.fillText(ch, cx, 0);
      cx += w + gap;
    }
  } else {
    ctx.fillText(text, -natural / 2, 0);
  }
  ctx.restore();
}
