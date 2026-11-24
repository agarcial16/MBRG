import { WATER } from '../core/rasterize';

/** FR-602: the widest strip, in kilometres, that two sources that do not fit each other along a border are assumed to leave. */
export const DEFAULT_CONTEXT_GAP_KM = 3.5;

/** FR-602: the largest `contextGap` (pixels) the curation may give. */
export const MAX_CONTEXT_GAP = 16;

/**
 * FR-602: the context gap used when the curation gives no `contextGap`: the width of a strip of DEFAULT_CONTEXT_GAP_KM at the
 * pixel size of the map, rounded to whole pixels and capped at MAX_CONTEXT_GAP (1 at the scale of a world map is a width the
 * rule cannot see, and it does nothing).
 */
export function defaultContextGap(pixelSideKm: number): number {
  if (!(pixelSideKm > 0)) return 0;
  return Math.min(MAX_CONTEXT_GAP, Math.round(DEFAULT_CONTEXT_GAP_KM / pixelSideKm));
}

/** The chamfer weights of a step along an axis and along a diagonal; distances are kept times three. */
const AXIS = 3;
const DIAGONAL = 4;
const FAR = 65535;

/** A two-pass chamfer distance transform (times three) of `dist`, whose sources already hold 0. */
function chamfer(width: number, dist: Uint16Array): void {
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let v = dist[i]!;
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, dist[i - 1]! + AXIS);
      if (y > 0) {
        v = Math.min(v, dist[i - width]! + AXIS);
        if (x > 0) v = Math.min(v, dist[i - width - 1]! + DIAGONAL);
        if (x < width - 1) v = Math.min(v, dist[i - width + 1]! + DIAGONAL);
      }
      dist[i] = v;
    }
  }
  for (let y = width - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      let v = dist[i]!;
      if (v === 0) continue;
      if (x < width - 1) v = Math.min(v, dist[i + 1]! + AXIS);
      if (y < width - 1) {
        v = Math.min(v, dist[i + width]! + AXIS);
        if (x < width - 1) v = Math.min(v, dist[i + width + 1]! + DIAGONAL);
        if (x > 0) v = Math.min(v, dist[i + width - 1]! + DIAGONAL);
      }
      dist[i] = v;
    }
  }
}

/**
 * FR-602: the open water of a raster. Wet is every pixel that is neither a land territory (`isLand`) nor other land (0).
 * A wet pixel is open when a disk of radius `radius` pixels fits in the water around it: the morphological opening of
 * the water by that disk, with chamfer distances (the disk is an octagon). Water of width at most 2 * radius is never
 * open; water of width 2 * radius + 1 is. Returns one byte per pixel, 1 for open wet pixels.
 */
export function openWater(width: number, pixels: Uint32Array, radius: number, isLand: (value: number) => boolean): Uint8Array {
  const total = width * width;
  const dry = (value: number): boolean => value === 0 || isLand(value);
  const dist = new Uint16Array(total);
  for (let i = 0; i < total; i++) dist[i] = dry(pixels[i]!) ? 0 : FAR;
  chamfer(width, dist);
  // the core is the water at least radius + 1 from the dry land; the open water is everything within radius of the core
  const near = AXIS * (radius + 1);
  for (let i = 0; i < total; i++) dist[i] = !dry(pixels[i]!) && dist[i]! >= near ? 0 : FAR;
  chamfer(width, dist);
  const open = new Uint8Array(total);
  for (let i = 0; i < total; i++) if (!dry(pixels[i]!) && dist[i]! <= AXIS * radius) open[i] = 1;
  return open;
}

/**
 * FR-602: the context gap G (pixels, 0 turns the rule off). Water of the pre-sea raster that is not open at radius
 * floor(G / 2) (water of width at most G, a strip or a channel) is thin. A connected set of thin water (8-neighbourhood)
 * that touches a land territory AND other land (value 0: a context feature, an excluded or an unselected unit) is a
 * sliver between two sources that do not fit along a shared border, or a river narrower than the map can tell: every
 * pixel of it becomes other land, so it is never a sea that links the land territories along the border through a zone.
 * Thin water that touches only land territories (a notch between municipalities, the gap fill's business), only other
 * land, or neither, and the pixels of a sea zone, are never changed. Pure apart from the pixels it turns into other
 * land; returns how many it turned.
 */
export function closeContextGaps(width: number, pixels: Uint32Array, gap: number, isLand: (value: number) => boolean): number {
  const radius = Math.floor(gap / 2);
  if (radius < 1) return 0;
  const total = width * width;
  const open = openWater(width, pixels, radius, isLand);
  const seen = new Uint8Array(total);
  let closed = 0;
  for (let start = 0; start < total; start++) {
    if (pixels[start] !== WATER || open[start] === 1 || seen[start] === 1) continue;
    const members = [start];
    seen[start] = 1;
    let touchesLand = false;
    let touchesOther = false;
    for (let head = 0; head < members.length; head++) {
      const p = members[head]!;
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= width) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if ((dx === 0 && dy === 0) || xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          const value = pixels[q]!;
          if (value === 0) touchesOther = true;
          else if (isLand(value)) touchesLand = true;
          else if (value === WATER && open[q] === 0 && seen[q] === 0) {
            seen[q] = 1;
            members.push(q);
          }
        }
      }
    }
    if (touchesLand && touchesOther) {
      for (const p of members) pixels[p] = 0;
      closed += members.length;
    }
  }
  return closed;
}
