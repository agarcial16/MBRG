/**
 * Grids and generators for the label tests (spec 005). Numbers only, no text art.
 * Random data comes from a fixed-seed generator written here, never from `Math.random`.
 */
import type { IndexGrid } from '../../src/core/borders';
import { gridFrom, gridOf } from './grids';
import type { Kinds } from './grids';

/** mulberry32: a small deterministic generator returning floats in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random blob grid: entries 1..land are land, entry land + 1 is sea, 0 is outside. Cells are
 * assigned by a few random seeds grown by a noisy nearest rule, so entries split into several pieces.
 */
export function randomGrid(width: number, height: number, land: number, seed: number): IndexGrid {
  const next = rng(seed);
  const kinds: Kinds = { [land + 1]: 'sea' };
  for (let e = 1; e <= land; e++) kinds[e] = 'land';
  const points = Array.from({ length: land * 3 }, () => ({
    x: next() * width,
    y: next() * height,
    entry: 1 + Math.floor(next() * (land + 1)),
  }));
  const noise = Array.from({ length: width * height }, () => next());
  return gridOf(
    width,
    height,
    (x, y) => {
      if (noise[y * width + x]! < 0.06) return 0;
      let best = Infinity;
      let entry = 0;
      for (const p of points) {
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < best) {
          best = d;
          entry = p.entry;
        }
      }
      return entry;
    },
    kinds,
  );
}

/** Reference piece labelling by repeated relabelling to a fixed point (slow, obviously right). */
export function naivePieces(grid: IndexGrid): Int32Array {
  const { width, height, cells, fills } = grid;
  const label = new Int32Array(width * height).fill(-1);
  for (let i = 0; i < label.length; i++) if (fills[cells[i]!] === 'land') label[i] = i;
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (label[i] === -1) continue;
        for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (label[j] !== -1 && cells[j] === cells[i] && label[j]! < label[i]!) {
            label[i] = label[j]!;
            changed = true;
          }
        }
      }
    }
  }
  return label;
}

export { gridFrom, gridOf };
