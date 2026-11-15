// Piece index and label regions (FR-167, FR-168, FR-171, FR-189; plan D3 and section 5). Pure.
// A piece is a 4-connected set of map units of one land entry. A region is a set of pieces of land
// entries with one owner that touch through 4-adjacency. The piece graph is built once per load, so a
// change of owners only runs union-find over pieces, never over the image.
import type { IndexGrid } from './borders';

export interface PieceIndex {
  width: number;
  height: number;
  /** Number of entry indexes, including 0 (`grid.fills.length`). */
  entries: number;
  /** Piece of every map unit, row-major; -1 = not land. */
  pieceOf: Int32Array;
  /** Entry index of every piece. Pieces are numbered by their first unit in row-major order. */
  entryOf: Int32Array;
  size: Int32Array;
  /** Row-major position of the first unit of every piece (smallest one). */
  first: Int32Array;
  /** Per piece x0, y0, x1, y1, all inclusive (4 values per piece). */
  box: Int32Array;
  /** CSR: the units (row-major positions) of piece p are `units[unitStart[p] .. unitStart[p + 1])`. */
  unitStart: Int32Array;
  units: Int32Array;
  /** CSR: ascending pieces of other land entries that are 4-adjacent to piece p. */
  nbStart: Int32Array;
  nb: Int32Array;
}

export interface Region {
  /** Faction index (1..F). */
  owner: number;
  /** Ascending piece numbers. */
  pieces: number[];
  size: number;
  /** Smallest `first` of its pieces. */
  first: number;
}

/** Splits every land entry of the grid into pieces and links the pieces that touch. */
export function buildPieceIndex(grid: IndexGrid): PieceIndex {
  const { width, height, cells, fills } = grid;
  const count = width * height;
  const pieceOf = new Int32Array(count).fill(-1);
  const entryList: number[] = [];
  const sizeList: number[] = [];
  const firstList: number[] = [];
  const boxList: number[] = [];
  const unitStartList: number[] = [0];
  const units = new Int32Array(count);
  let used = 0;
  const stack = new Int32Array(count);

  for (let start = 0; start < count; start++) {
    const entry = cells[start]!;
    if (fills[entry] !== 'land' || pieceOf[start] !== -1) continue;
    const piece = entryList.length;
    const begin = used;
    let x0 = width;
    let y0 = height;
    let x1 = 0;
    let y1 = 0;
    let top = 0;
    stack[top++] = start;
    pieceOf[start] = piece;
    while (top > 0) {
      const u = stack[--top]!;
      units[used++] = u;
      const x = u % width;
      const y = (u - x) / width;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && pieceOf[u - 1] === -1 && cells[u - 1] === entry) (pieceOf[u - 1] = piece), (stack[top++] = u - 1);
      if (x < width - 1 && pieceOf[u + 1] === -1 && cells[u + 1] === entry) (pieceOf[u + 1] = piece), (stack[top++] = u + 1);
      if (y > 0 && pieceOf[u - width] === -1 && cells[u - width] === entry) (pieceOf[u - width] = piece), (stack[top++] = u - width);
      if (y < height - 1 && pieceOf[u + width] === -1 && cells[u + width] === entry) (pieceOf[u + width] = piece), (stack[top++] = u + width);
    }
    entryList.push(entry);
    sizeList.push(used - begin);
    firstList.push(start);
    boxList.push(x0, y0, x1, y1);
    unitStartList.push(used);
  }

  // Piece graph: every horizontal or vertical contact between two different pieces.
  const pieceCount = entryList.length;
  const edges = new Set<number>();
  const addEdge = (a: number, b: number): void => {
    edges.add(a * pieceCount + b);
    edges.add(b * pieceCount + a);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = y * width + x;
      const a = pieceOf[u]!;
      if (a === -1) continue;
      if (x < width - 1) {
        const b = pieceOf[u + 1]!;
        if (b !== -1 && b !== a) addEdge(a, b);
      }
      if (y < height - 1) {
        const b = pieceOf[u + width]!;
        if (b !== -1 && b !== a) addEdge(a, b);
      }
    }
  }
  const sorted = Array.from(edges).sort((p, q) => p - q);
  const nbStart = new Int32Array(pieceCount + 1);
  const nb = new Int32Array(sorted.length);
  sorted.forEach((key, i) => {
    const a = Math.floor(key / pieceCount);
    nbStart[a + 1]!++;
    nb[i] = key - a * pieceCount;
  });
  for (let p = 0; p < pieceCount; p++) nbStart[p + 1] = nbStart[p + 1]! + nbStart[p]!;

  return {
    width,
    height,
    entries: fills.length,
    pieceOf,
    entryOf: Int32Array.from(entryList),
    size: Int32Array.from(sizeList),
    first: Int32Array.from(firstList),
    box: Int32Array.from(boxList),
    unitStart: Int32Array.from(unitStartList),
    units: units.slice(0, used),
    nbStart,
    nb,
  };
}

/**
 * Regions at one state: connected components of the piece graph where touching pieces have the same
 * non-zero owner. `owners` is the owner table (faction index per entry, 0 = none). Sorted by `first`.
 */
export function regionsOf(p: PieceIndex, owners: ArrayLike<number>): Region[] {
  const pieceCount = p.entryOf.length;
  const parent = new Int32Array(pieceCount);
  for (let i = 0; i < pieceCount; i++) parent[i] = i;
  const find = (a: number): number => {
    let r = a;
    while (parent[r] !== r) r = parent[r]!;
    while (parent[a] !== r) {
      const next = parent[a]!;
      parent[a] = r;
      a = next;
    }
    return r;
  };
  const ownerOfPiece = (piece: number): number => owners[p.entryOf[piece]!] ?? 0;
  for (let a = 0; a < pieceCount; a++) {
    const owner = ownerOfPiece(a);
    if (owner === 0) continue;
    for (let k = p.nbStart[a]!; k < p.nbStart[a + 1]!; k++) {
      const b = p.nb[k]!;
      if (b > a && ownerOfPiece(b) === owner) {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
      }
    }
  }
  const byRoot = new Map<number, Region>();
  for (let a = 0; a < pieceCount; a++) {
    const owner = ownerOfPiece(a);
    if (owner === 0) continue;
    const root = find(a);
    let region = byRoot.get(root);
    if (region === undefined) {
      region = { owner, pieces: [], size: 0, first: p.first[a]! };
      byRoot.set(root, region);
    }
    region.pieces.push(a);
    region.size += p.size[a]!;
    if (p.first[a]! < region.first) region.first = p.first[a]!;
  }
  return Array.from(byRoot.values()).sort((r, s) => r.first - s.first);
}

/** Main region of every faction (faction index -> region): the largest, ties by the smallest first unit. */
export function mainRegions(regions: readonly Region[]): Map<number, Region> {
  const main = new Map<number, Region>();
  for (const region of regions) {
    const best = main.get(region.owner);
    if (best === undefined || region.size > best.size || (region.size === best.size && region.first < best.first)) {
      main.set(region.owner, region);
    }
  }
  return main;
}

/** Main piece of every entry (entry index -> piece, -1 when the entry has no land piece). */
export function mainPieces(p: PieceIndex): Int32Array {
  const main = new Int32Array(p.entries).fill(-1);
  for (let piece = 0; piece < p.entryOf.length; piece++) {
    const entry = p.entryOf[piece]!;
    const best = main[entry]!;
    if (best === -1 || p.size[piece]! > p.size[best]! || (p.size[piece] === p.size[best] && p.first[piece]! < p.first[best]!)) {
      main[entry] = piece;
    }
  }
  return main;
}
