import { WATER } from '../core/rasterize';

/** FR-602: the gap used when the curation gives no `contextGap`: strips of up to this many pixels are closed. */
export const DEFAULT_CONTEXT_GAP = 3;

/**
 * FR-602: the context gap G. A water pixel (the pre-sea raster) lies in a gap when a land territory and other land (value
 * 0: a context feature, an excluded or an unselected unit) are both reachable from it through at most G pixels of water,
 * counting the pixel itself, in the 8-neighbourhood: every pixel of a strip of water of at most G pixels between a land
 * territory and other land. Sources that do not fit each other along a shared border (a municipal file against a country
 * file) leave exactly such a strip, and a strip joined to the sea at its ends would be a zone that links every land
 * territory along the border; each gap pixel becomes other land instead. A wider channel (a strait), water between two
 * land territories, water between two pieces of other land and the pixels of a sea zone are never touched. Pure apart from
 * the pixels it turns into other land; returns how many it turned. `gap` 0 does nothing.
 */
export function closeContextGaps(width: number, pixels: Uint32Array, gap: number, isLand: (value: number) => boolean): number {
  if (gap <= 0) return 0;
  const total = width * width;
  // distance (in pixels of water, 1 = next to the land) to the nearest land territory and to the nearest other land
  const toLand = new Uint8Array(total);
  const toOther = new Uint8Array(total);
  let landFront: number[] = [];
  let otherFront: number[] = [];
  const neighbours = (p: number, visit: (q: number) => void): void => {
    const x = p % width;
    const y = (p - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= width) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if ((dx === 0 && dy === 0) || xx < 0 || xx >= width) continue;
        visit(yy * width + xx);
      }
    }
  };
  for (let p = 0; p < total; p++) {
    if (pixels[p] !== WATER) continue;
    let nearLand = false;
    let nearOther = false;
    neighbours(p, (q) => {
      const value = pixels[q]!;
      if (value === 0) nearOther = true;
      else if (isLand(value)) nearLand = true;
    });
    if (nearLand) {
      toLand[p] = 1;
      landFront.push(p);
    }
    if (nearOther) {
      toOther[p] = 1;
      otherFront.push(p);
    }
  }
  const grow = (front: number[], dist: Uint8Array, step: number): number[] => {
    const next: number[] = [];
    for (const p of front) {
      neighbours(p, (q) => {
        if (pixels[q] === WATER && dist[q] === 0) {
          dist[q] = step;
          next.push(q);
        }
      });
    }
    return next;
  };
  for (let step = 2; step <= gap; step++) {
    landFront = grow(landFront, toLand, step);
    otherFront = grow(otherFront, toOther, step);
  }
  let closed = 0;
  const gapPixels: number[] = [];
  for (let p = 0; p < total; p++) {
    if (toLand[p] !== 0 && toOther[p] !== 0 && toLand[p]! + toOther[p]! <= gap + 1) gapPixels.push(p);
  }
  // every pixel is judged against the raster as it was: the gap pixels are written after all are found
  for (const p of gapPixels) {
    pixels[p] = 0;
    closed++;
  }
  return closed;
}
