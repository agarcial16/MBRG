// Colour front distances (FR-179, FR-189; plan D6 and D13). Pure: pieces, owners and entries in, distances out.
// A transferred piece is a connected set of map units of transferred entries. Its colour changes along a
// front that starts at the units touching the absorber (the contact set) and walks inside the piece.
import type { PieceIndex } from './regions';

/**
 * Normalised front distance of every unit of the transferred pieces, over the bounding box of those pieces.
 * `values` is row-major inside the box; units of the box that are not in a transferred piece hold -1.
 */
export interface FrontField {
  x0: number;
  y0: number;
  width: number;
  height: number;
  values: Float32Array;
}

/** Normalised distance at a map unit, or -1 when the unit is outside the box or not in a transferred piece. */
export function frontAt(field: FrontField, x: number, y: number): number {
  const fx = x - field.x0;
  const fy = y - field.y0;
  if (fx < 0 || fy < 0 || fx >= field.width || fy >= field.height) return -1;
  return field.values[fy * field.width + fx]!;
}

/** Maximal connected sets of pieces of transferred entries, each ascending, ordered by their first piece. */
export function transferredPieces(p: PieceIndex, transferred: ReadonlySet<number>): number[][] {
  const pieceCount = p.entryOf.length;
  const seen = new Uint8Array(pieceCount);
  const out: number[][] = [];
  for (let start = 0; start < pieceCount; start++) {
    if (seen[start] === 1 || !transferred.has(p.entryOf[start]!)) continue;
    const component: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const a = stack.pop()!;
      component.push(a);
      for (let k = p.nbStart[a]!; k < p.nbStart[a + 1]!; k++) {
        const b = p.nb[k]!;
        if (seen[b] === 0 && transferred.has(p.entryOf[b]!)) {
          seen[b] = 1;
          stack.push(b);
        }
      }
    }
    out.push(component.sort((s, t) => s - t));
  }
  return out;
}

/** Side of the square buckets used to find the nearest absorber unit, in map units. */
const BUCKET = 128;

/** Whether the piece at map position v exists and belongs to a land entry owned by the absorber. */
function absorberOwns(p: PieceIndex, before: ArrayLike<number>, absorber: number, v: number): boolean {
  const piece = p.pieceOf[v]!;
  return piece !== -1 && before[p.entryOf[piece]!] === absorber;
}

/** Neighbour of map position u in direction k (0 left, 1 right, 2 up, 3 down), or -1 outside the image. */
function step(p: PieceIndex, u: number, k: number): number {
  if (k === 0) return u % p.width > 0 ? u - 1 : -1;
  if (k === 1) return u % p.width < p.width - 1 ? u + 1 : -1;
  if (k === 2) return u >= p.width ? u - p.width : -1;
  return u < p.width * (p.height - 1) ? u + p.width : -1;
}

/** 4-neighbours inside the image of map position u. */
function neighboursOf(p: PieceIndex, u: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < 4; k++) {
    const v = step(p, u, k);
    if (v !== -1) out.push(v);
  }
  return out;
}

/** Units of the pieces in piece order (not sorted: callers sort what they return). */
function unitsOf(p: PieceIndex, pieces: readonly number[]): Int32Array {
  let count = 0;
  for (const piece of pieces) count += p.unitStart[piece + 1]! - p.unitStart[piece]!;
  const units = new Int32Array(count);
  let used = 0;
  for (const piece of pieces) {
    const part = p.units.subarray(p.unitStart[piece], p.unitStart[piece + 1]);
    units.set(part, used);
    used += part.length;
  }
  return units;
}

/** Units of the component 4-adjacent to a land unit of the absorber at the earlier state (row-major). */
export function contactSet(p: PieceIndex, component: readonly number[], before: ArrayLike<number>, absorber: number): Int32Array {
  // One byte per piece: does it belong to a land entry owned by the absorber? (typed mask, no per-unit lookups)
  const theirs = new Uint8Array(p.entryOf.length);
  for (let piece = 0; piece < theirs.length; piece++) theirs[piece] = before[p.entryOf[piece]!] === absorber ? 1 : 0;
  const width = p.width;
  const last = width * (p.height - 1);
  const units = unitsOf(p, component);
  const contact = new Int32Array(units.length);
  let count = 0;
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    const x = u % width;
    let touches = false;
    if (x > 0) touches = absorberAt(p, theirs, u - 1);
    if (!touches && x < width - 1) touches = absorberAt(p, theirs, u + 1);
    if (!touches && u >= width) touches = absorberAt(p, theirs, u - width);
    if (!touches && u < last) touches = absorberAt(p, theirs, u + width);
    if (touches) contact[count++] = u;
  }
  return contact.slice(0, count).sort();
}

/** Whether map position v holds a piece of the absorber's land (`theirs` is the per-piece mask). */
function absorberAt(p: PieceIndex, theirs: Uint8Array, v: number): boolean {
  const piece = p.pieceOf[v]!;
  return piece !== -1 && theirs[piece] === 1;
}

/** Boundary units of the absorber's earlier land: the ones with a 4-neighbour that is not absorber land. */
function absorberBoundary(p: PieceIndex, before: ArrayLike<number>, absorber: number): number[] {
  const theirs = new Uint8Array(p.entryOf.length);
  let any = false;
  for (let piece = 0; piece < theirs.length; piece++) {
    if (before[p.entryOf[piece]!] === absorber) {
      theirs[piece] = 1;
      any = true;
    }
  }
  if (!any) throw new RangeError(`faction ${absorber} owns no land at the earlier state`);
  const width = p.width;
  const last = width * (p.height - 1);
  const boundary: number[] = [];
  for (let piece = 0; piece < theirs.length; piece++) {
    if (theirs[piece] === 0) continue;
    for (let i = p.unitStart[piece]!; i < p.unitStart[piece + 1]!; i++) {
      const u = p.units[i]!;
      const x = u % width;
      if (
        (x > 0 && !absorberAt(p, theirs, u - 1)) ||
        (x < width - 1 && !absorberAt(p, theirs, u + 1)) ||
        (u >= width && !absorberAt(p, theirs, u - width)) ||
        (u < last && !absorberAt(p, theirs, u + width))
      ) {
        boundary.push(u);
      }
    }
  }
  return boundary;
}

/**
 * Seeds of a component: its contact set, or when that is empty its units at the minimum squared distance
 * to the absorber's land. The minimum is taken over boundary units only: a closest unit of the piece, or
 * of the absorber, with all four neighbours on its own side could step towards the other one and get closer.
 */
export function seedSet(
  p: PieceIndex,
  component: readonly number[],
  before: ArrayLike<number>,
  absorber: number,
  boundary?: () => ArrayLike<number>,
): Int32Array {
  const contact = contactSet(p, component, before, absorber);
  if (contact.length > 0) return contact;
  const theirs = (boundary ?? (() => absorberBoundary(p, before, absorber)))();
  const inside = new Uint8Array(p.entryOf.length);
  for (const piece of component) inside[piece] = 1;
  const own: number[] = [];
  for (const u of unitsOf(p, component)) {
    for (let k = 0; k < 4; k++) {
      const v = step(p, u, k);
      if (v !== -1 && inside[p.pieceOf[v]!] !== 1) {
        own.push(u);
        break;
      }
    }
  }

  // Nearest absorber boundary unit by rings of square buckets; a unit stops looking when no unseen
  // bucket can be closer than its own minimum or than the best minimum found so far. Buckets are stored in
  // typed arrays (counting sort by bucket) and a bucket whose nearest possible point is farther than the
  // unit's minimum or the best minimum is skipped: neither can change which units are kept.
  const C = BUCKET;
  const width = p.width;
  const bw = Math.ceil(width / C);
  const bh = Math.ceil(p.height / C);
  const count = theirs.length;
  const keyOf = new Int32Array(count);
  const bucketStart = new Int32Array(bw * bh + 1);
  for (let i = 0; i < count; i++) {
    const a = theirs[i]!;
    const ax = a % width;
    const key = Math.floor((a - ax) / width / C) * bw + Math.floor(ax / C);
    keyOf[i] = key;
    bucketStart[key + 1]!++;
  }
  for (let k = 0; k < bw * bh; k++) bucketStart[k + 1] = bucketStart[k + 1]! + bucketStart[k]!;
  const fill = bucketStart.slice(0, bw * bh);
  const pointX = new Int32Array(count);
  const pointY = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const a = theirs[i]!;
    const ax = a % width;
    const slot = fill[keyOf[i]!]!++;
    pointX[slot] = ax;
    pointY[slot] = (a - ax) / width;
  }
  let best = Infinity;
  const near: number[] = [];
  for (const u of own) {
    const ux = u % width;
    const uy = (u - ux) / width;
    const bx = Math.floor(ux / C);
    const by = Math.floor(uy / C);
    let min = Infinity;
    for (let r = 0; r <= Math.max(bw, bh); r++) {
      const gap = r === 0 ? 0 : ((r - 1) * C + 1) ** 2;
      if (gap > min || gap > best) break;
      for (let gy = by - r; gy <= by + r; gy++) {
        if (gy < 0 || gy >= bh) continue;
        const edge = gy === by - r || gy === by + r;
        const ey = Math.max(gy * C - uy, uy - (gy * C + C - 1), 0);
        for (let gx = bx - r; gx <= bx + r; gx += edge || r === 0 ? 1 : 2 * r) {
          if (gx < 0 || gx >= bw) continue;
          const from = bucketStart[gy * bw + gx]!;
          const to = bucketStart[gy * bw + gx + 1]!;
          if (from === to) continue;
          const ex = Math.max(gx * C - ux, ux - (gx * C + C - 1), 0);
          const nearest = ex * ex + ey * ey;
          if (nearest > min || nearest > best) continue;
          for (let i = from; i < to; i++) {
            const dx = ux - pointX[i]!;
            const dy = uy - pointY[i]!;
            const d = dx * dx + dy * dy;
            if (d < min) min = d;
          }
        }
      }
    }
    if (min < best) {
      best = min;
      near.length = 0;
    }
    if (min === best) near.push(u);
  }
  return Int32Array.from(near).sort();
}

/**
 * Front field of a step: for each transferred piece, the number of 4-adjacent steps inside the piece from
 * its seed set divided by the largest such number in the same piece (0 when that is 0). `transferred` holds
 * entry indexes, `before` the owner table of the earlier state and `absorber` the absorbing faction index.
 */
export function frontField(p: PieceIndex, transferred: ReadonlySet<number>, before: ArrayLike<number>, absorber: number): FrontField {
  const components = transferredPieces(p, transferred);
  if (components.length === 0) return { x0: 0, y0: 0, width: 0, height: 0, values: new Float32Array(0) };

  let x0 = p.width;
  let y0 = p.height;
  let x1 = 0;
  let y1 = 0;
  const componentOf = new Int32Array(p.entryOf.length).fill(-1);
  components.forEach((component, c) => {
    for (const piece of component) {
      componentOf[piece] = c;
      x0 = Math.min(x0, p.box[piece * 4]!);
      y0 = Math.min(y0, p.box[piece * 4 + 1]!);
      x1 = Math.max(x1, p.box[piece * 4 + 2]!);
      y1 = Math.max(y1, p.box[piece * 4 + 3]!);
    }
  });
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  // First holds the integer step counts (exact in float32), then each component is divided by its largest.
  const values = new Float32Array(width * height).fill(-1);
  const slot = (u: number): number => {
    const x = u % p.width;
    return ((u - x) / p.width - y0) * width + (x - x0);
  };

  let boundary: ArrayLike<number> | undefined;
  const sharedBoundary = (): ArrayLike<number> => (boundary ??= absorberBoundary(p, before, absorber));

  components.forEach((component, c) => {
    const units = unitsOf(p, component);
    const queue = new Int32Array(units.length);
    const slots = new Int32Array(units.length); // slots[i] = position of queue[i] in the field
    let tail = 0;
    for (const u of seedSet(p, component, before, absorber, sharedBoundary)) {
      slots[tail] = slot(u);
      queue[tail++] = u;
      values[slot(u)] = 0;
    }
    let max = 0;
    const W = p.width;
    for (let head = 0; head < tail; head++) {
      const u = queue[head]!;
      const x = u % W;
      const s = ((u - x) / W - y0) * width + (x - x0);
      const d = values[s]!;
      if (d > max) max = d;
      // left, right, up, down; a neighbour joins when it is in this component and not reached yet
      if (x > 0) {
        const piece = p.pieceOf[u - 1]!;
        if (piece !== -1 && componentOf[piece] === c && values[s - 1] === -1) {
          values[s - 1] = d + 1;
          slots[tail] = s - 1;
          queue[tail++] = u - 1;
        }
      }
      if (x < W - 1) {
        const piece = p.pieceOf[u + 1]!;
        if (piece !== -1 && componentOf[piece] === c && values[s + 1] === -1) {
          values[s + 1] = d + 1;
          slots[tail] = s + 1;
          queue[tail++] = u + 1;
        }
      }
      if (u >= W) {
        const piece = p.pieceOf[u - W]!;
        if (piece !== -1 && componentOf[piece] === c && values[s - width] === -1) {
          values[s - width] = d + 1;
          slots[tail] = s - width;
          queue[tail++] = u - W;
        }
      }
      if (u < W * (p.height - 1)) {
        const piece = p.pieceOf[u + W]!;
        if (piece !== -1 && componentOf[piece] === c && values[s + width] === -1) {
          values[s + width] = d + 1;
          slots[tail] = s + width;
          queue[tail++] = u + W;
        }
      }
    }
    // Every unit of the component was reached (its pieces are connected and the seeds lie inside it).
    for (let i = 0; i < tail; i++) values[slots[i]!] = max === 0 ? 0 : values[slots[i]!]! / max;
  });
  return { x0, y0, width, height, values };
}
