import type { Result } from '@mbrg/shared';

/**
 * FR-117: small-piece cleanup. A piece is a 4-connected set of pixels of one non-zero value;
 * background (0) is never a piece and is never reassigned. Pure and deterministic (NFR-14).
 *
 * `cleanupPieces` is the incremental form of the loop of FR-117 ("take the smallest piece below
 * S, reassign it, recompute the pieces"). A reassignment only ever merges whole pieces (the
 * reassigned piece joins the pieces of the target it touches, or leaves the picture as
 * background), so pieces are kept in a union-find and a heap instead of being recomputed. The
 * literal loop lives in `test/helpers/cleanup-direct.ts`; tests prove both give identical results.
 */

/** An entry of the map in map order: a land territory (with its faction) or a sea zone. */
export type PieceEntry = { id: number; kind: 'land'; owner: number } | { id: number; kind: 'sea' };

/** One reassigned piece: the entry it belonged to, its pixel count and the new value (0 = background). */
export interface Reassignment {
  entry: number;
  pixels: number;
  to: number;
}

export interface CleanupResult {
  pixels: Uint32Array;
  reassigned: Reassignment[];
}

/** FR-117: reassigning a piece would leave this map entry with no pixel. */
export type CleanupError = { kind: 'vanished-entry'; territory: number };

export interface PieceLabels {
  /** The piece index of every pixel, or -1 for background. */
  label: Int32Array;
  /** Pieces in row-major order of their first pixel. */
  pieces: { value: number; size: number; first: number }[];
}

/** Labels the 4-connected pieces of non-zero values. */
export function labelPieces(width: number, pixels: Uint32Array): PieceLabels {
  const label = new Int32Array(pixels.length).fill(-1);
  const pieces: PieceLabels['pieces'] = [];
  const stack: number[] = [];
  for (let start = 0; start < pixels.length; start++) {
    const value = pixels[start]!;
    if (value === 0 || label[start]! >= 0) continue;
    const index = pieces.length;
    let size = 0;
    label[start] = index;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      size++;
      const x = i % width;
      if (x > 0) visit(i - 1);
      if (x < width - 1) visit(i + 1);
      if (i >= width) visit(i - width);
      if (i + width < pixels.length) visit(i + width);
    }
    pieces.push({ value, size, first: start });

    function visit(j: number): void {
      if (pixels[j] !== value || label[j]! >= 0) return;
      label[j] = index;
      stack.push(j);
    }
  }
  return { label, pieces };
}

/** Heap item: a piece below S, ordered by (size, first pixel); stale items are skipped when popped. */
interface Item {
  size: number;
  first: number;
  root: number;
}

class MinHeap {
  private readonly items: Item[] = [];
  get length(): number {
    return this.items.length;
  }
  private static before(a: Item, b: Item): boolean {
    return a.size < b.size || (a.size === b.size && a.first < b.first);
  }
  push(item: Item): void {
    const items = this.items;
    let i = items.length;
    items.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!MinHeap.before(items[i]!, items[parent]!)) break;
      [items[i], items[parent]] = [items[parent]!, items[i]!];
      i = parent;
    }
  }
  pop(): Item {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && MinHeap.before(items[l]!, items[m]!)) m = l;
        if (r < items.length && MinHeap.before(items[r]!, items[m]!)) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m]!, items[i]!];
        i = m;
      }
    }
    return top;
  }
}

/**
 * FR-117: reassigns, smallest first, every piece with fewer than `minPieceSize` pixels.
 * `entries` are in map order (ties between targets go to the first one). Returns a new pixel
 * array and the reassignments in the order they were made, or `vanished-entry` at the first
 * reassignment that would leave an entry without a pixel.
 */
export function cleanupPieces(
  width: number,
  input: Uint32Array,
  entries: readonly PieceEntry[],
  minPieceSize: number,
): Result<CleanupResult, CleanupError> {
  const pixels = Uint32Array.from(input);
  const total = pixels.length;
  const entryIndex = new Map<number, number>();
  entries.forEach((entry, index) => entryIndex.set(entry.id, index));
  const pixelCount = new Array<number>(entries.length).fill(0);
  for (let i = 0; i < total; i++) {
    const value = pixels[i]!;
    if (value === 0) continue;
    const index = entryIndex.get(value);
    if (index === undefined) throw new Error('pixel value ' + value + ' is not a map entry');
    pixelCount[index]!++;
  }

  const { label, pieces } = labelPieces(width, pixels);
  const count = pieces.length;
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const size = Int32Array.from(pieces, (p) => p.size);
  const first = Int32Array.from(pieces, (p) => p.first);
  const alive = new Uint8Array(count).fill(1);
  // Each piece keeps its pixels in a linked list, so merging two pieces is constant time.
  const head = new Int32Array(count).fill(-1);
  const tail = new Int32Array(count).fill(-1);
  const next = new Int32Array(total).fill(-1);
  for (let i = 0; i < total; i++) {
    const p = label[i]!;
    if (p < 0) continue;
    if (head[p] === -1) head[p] = i;
    else next[tail[p]!] = i;
    tail[p] = i;
  }
  const find = (p: number): number => {
    let root = p;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[p] !== root) {
      const up = parent[p]!;
      parent[p] = root;
      p = up;
    }
    return root;
  };

  const heap = new MinHeap();
  for (let p = 0; p < count; p++) if (size[p]! < minPieceSize) heap.push({ size: size[p]!, first: first[p]!, root: p });

  const neighbours = (i: number, visit: (j: number) => void): void => {
    const x = i % width;
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i + width < total) visit(i + width);
  };

  const reassigned: Reassignment[] = [];
  while (heap.length > 0) {
    const item = heap.pop();
    const r = item.root;
    // A piece that was merged, grown or removed since this item was pushed is stale.
    if (!alive[r] || parent[r] !== r || size[r] !== item.size || first[r] !== item.first) continue;

    const value = pixels[first[r]!]!;
    const own = entryIndex.get(value)!;
    const self = entries[own]!;

    // Contact count with each value: pairs of 4-adjacent pixels, one in the piece.
    const contact = new Map<number, number>();
    for (let i = head[r]!; i !== -1; i = next[i]!) {
      neighbours(i, (j) => {
        const v = pixels[j]!;
        if (v === 0 || v === value) return;
        contact.set(v, (contact.get(v) ?? 0) + 1);
      });
    }

    // Best entry of each target step: highest count, ties to the first entry in map order.
    let sameFaction = -1;
    let anyLand = -1;
    let anySea = -1;
    let sameCount = 0;
    let landCount = 0;
    let seaCount = 0;
    for (const [v, c] of contact) {
      const index = entryIndex.get(v)!;
      const entry = entries[index]!;
      if (entry.kind === 'sea') {
        if (c > seaCount || (c === seaCount && index < anySea)) [anySea, seaCount] = [index, c];
        continue;
      }
      if (self.kind === 'land') {
        if (c > landCount || (c === landCount && index < anyLand)) [anyLand, landCount] = [index, c];
        if (entry.owner === self.owner && (c > sameCount || (c === sameCount && index < sameFaction))) {
          [sameFaction, sameCount] = [index, c];
        }
      }
    }
    let targetIndex: number;
    if (self.kind === 'sea') targetIndex = anySea;
    else targetIndex = sameFaction !== -1 ? sameFaction : anyLand !== -1 ? anyLand : anySea;
    const target = targetIndex === -1 ? 0 : entries[targetIndex]!.id;

    if (pixelCount[own] === size[r]) {
      return { ok: false, errors: [{ kind: 'vanished-entry', territory: self.id }] };
    }
    reassigned.push({ entry: self.id, pixels: size[r]!, to: target });
    pixelCount[own]! -= size[r]!;
    for (let i = head[r]!; i !== -1; i = next[i]!) pixels[i] = target;

    if (target === 0) {
      alive[r] = 0;
      continue;
    }
    pixelCount[targetIndex]! += size[r]!;
    // Join the pieces of the target that the repainted pixels touch. `r` stays the root; the
    // walk stops at the piece's own last pixel because joining appends the other lists to it.
    const last = tail[r]!;
    for (let i = head[r]!; ; i = next[i]!) {
      neighbours(i, (j) => {
        if (pixels[j] !== target) return;
        const other = find(label[j]!);
        if (other === r) return;
        next[tail[r]!] = head[other]!;
        tail[r] = tail[other]!;
        size[r] = size[r]! + size[other]!;
        first[r] = Math.min(first[r]!, first[other]!);
        parent[other] = r;
      });
      if (i === last) break;
    }
    if (size[r]! < minPieceSize) heap.push({ size: size[r]!, first: first[r]!, root: r });
  }
  return { ok: true, value: { pixels, reassigned } };
}
