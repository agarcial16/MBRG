/**
 * Tiny index grids for the border tests. Cell values are dense entry indexes (0 = outside the map);
 * there is no text art, so the fixtures read as numbers. `kinds` says what each non-zero index is.
 */
import type { IndexGrid } from '../../src/core/borders';
import type { FillClass } from '../../src/core/theme';

export type Kinds = Record<number, 'land' | 'sea'>;

function fillsOf(kinds: Kinds, cells: ArrayLike<number>): FillClass[] {
  let max = 0;
  for (let i = 0; i < cells.length; i++) max = Math.max(max, cells[i]!);
  const fills: FillClass[] = ['outside'];
  for (let v = 1; v <= max; v++) {
    const kind = kinds[v];
    if (kind === undefined) throw new Error(`grid helper: index ${v} has no kind`);
    fills.push(kind);
  }
  return fills;
}

/** Grid from rows of dense indexes. */
export function gridFrom(rows: number[][], kinds: Kinds): IndexGrid {
  const height = rows.length;
  const width = rows[0]!.length;
  const cells = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error('grid helper: ragged rows');
    row.forEach((v, x) => (cells[y * width + x] = v));
  });
  return { width, height, cells, fills: fillsOf(kinds, cells) };
}

/** Grid of the given size whose cell values come from a function of the position. */
export function gridOf(width: number, height: number, at: (x: number, y: number) => number, kinds: Kinds): IndexGrid {
  const cells = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells[y * width + x] = at(x, y);
  return { width, height, cells, fills: fillsOf(kinds, cells) };
}

/** Owner table: entry index -> faction index (0 = none), from the entries that have an owner. */
export function ownersOf(owned: Record<number, number>, entries: number): number[] {
  const table = new Array<number>(entries + 1).fill(0);
  for (const [entry, faction] of Object.entries(owned)) table[Number(entry)] = faction;
  return table;
}
