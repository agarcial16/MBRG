// Label layout (FR-169, FR-170, FR-171, FR-189; plan D4, D5 and section 5). Pure: the same pieces,
// owners, aspects and parameters always give the same boxes; nothing here reads a clock or a random source.
import type { LabelParams } from './label-params';
import { mainPieces, mainRegions, regionsOf } from './regions';
import type { PieceIndex } from './regions';

/** The label box in map coordinates: x0 and y0 are whole numbers, h is a whole number, w = h * aspect. */
export interface LabelBox {
  x0: number;
  y0: number;
  h: number;
  w: number;
}

/** The parameters the layout reads. */
export type LayoutParams = Pick<LabelParams, 'margin' | 'maxHeight'>;

/** One faction label: the pieces of its main region, the aspect used, and the box (absent when none fits). */
export interface FactionLabel {
  pieces: readonly number[];
  aspect: number;
  box: LabelBox | undefined;
}

export interface FactionBoxes {
  /** The piece index the labels were laid out on (a result is reused only on the same index). */
  index: PieceIndex;
  params: LayoutParams;
  /** Faction index -> label, ascending. Factions without land or without an aspect have no entry. */
  labels: ReadonlyMap<number, FactionLabel>;
  /** Factions laid out again by this call, ascending (the others were taken from `previous`). */
  recomputed: readonly number[];
}

const isAspect = (a: unknown): a is number => typeof a === 'number' && Number.isFinite(a) && a > 0;

function checkParams(params: LayoutParams): void {
  if (!Number.isInteger(params.margin) || params.margin < 1) throw new RangeError(`label margin must be a whole number >= 1, got ${String(params.margin)}`);
  if (!Number.isInteger(params.maxHeight) || params.maxHeight < 1) {
    throw new RangeError(`label maximum height must be a whole number >= 1, got ${String(params.maxHeight)}`);
  }
}

/**
 * The label box of a set of pieces (a region or a main piece), or undefined when no box of height 1 fits.
 *
 * A box (x0, y0, h, w = h * aspect) fits when every unit whose centre lies in [x0 - M, x0 + w + M] x
 * [y0 - M, y0 + h + M] belongs to the set (units outside the image belong to no set). That is the columns
 * x0 - M .. x0 + M + floor(w - 0.5) and the rows y0 - M .. y0 + h + M - 1. Fitting is monotone in h, so the
 * largest h is found by binary search; among the boxes of that height the winner is the one whose centre
 * is nearest to the mean centre, then the smallest y0, then the smallest x0.
 */
export function fitLabel(p: PieceIndex, pieces: readonly number[], aspect: number, params: LayoutParams): LabelBox | undefined {
  checkParams(params);
  if (!isAspect(aspect)) throw new RangeError(`label aspect must be a positive finite number, got ${String(aspect)}`);
  if (pieces.length === 0) return undefined;
  const margin = params.margin;

  // Bounding box of the set.
  let bx0 = p.width;
  let by0 = p.height;
  let bx1 = -1;
  let by1 = -1;
  for (const piece of pieces) {
    bx0 = Math.min(bx0, p.box[4 * piece]!);
    by0 = Math.min(by0, p.box[4 * piece + 1]!);
    bx1 = Math.max(bx1, p.box[4 * piece + 2]!);
    by1 = Math.max(by1, p.box[4 * piece + 3]!);
  }
  const bw = bx1 - bx0 + 1;
  const bh = by1 - by0 + 1;

  // down[y * bw + x] = number of consecutive units of the set from (x, y) downwards inside the box (one extra
  // zero row below). A box of `rows` rows fits at columns c..c+cols-1 when down >= rows in all of them.
  const inSet = new Uint8Array(p.entryOf.length);
  for (const piece of pieces) inSet[piece] = 1;
  const down: Uint16Array | Int32Array = bh <= 0xffff ? new Uint16Array((bh + 1) * bw) : new Int32Array((bh + 1) * bw);
  // The longest horizontal and vertical runs of the set bound the width and height of any box (exact pruning).
  let longestX = 0;
  let longestY = 0;
  for (let y = bh - 1; y >= 0; y--) {
    const base = y * bw;
    const mapRow = (by0 + y) * p.width + bx0;
    let runX = 0;
    for (let x = 0; x < bw; x++) {
      const piece = p.pieceOf[mapRow + x]!;
      if (piece !== -1 && inSet[piece] === 1) {
        const v = down[base + bw + x]! + 1;
        down[base + x] = v;
        if (v > longestY) longestY = v;
        runX++;
        if (runX > longestX) longestX = runX;
      } else {
        runX = 0;
      }
    }
  }

  // Visits the fitting (x0, y0) of height h in row-major order; stops when the visitor returns true.
  const scan = (h: number, visit: (x0: number, y0: number) => boolean | void): void => {
    const extra = Math.floor(h * aspect - 0.5); // columns to the right of x0 + M
    const cols = 2 * margin + extra + 1;
    const rows = h + 2 * margin;
    if (rows > longestY || cols > longestX) return;
    for (let y0 = by0 + margin; y0 + h + margin - 1 <= by1; y0++) {
      const base = (y0 - margin - by0) * bw;
      let run = 0;
      for (let c = 0; c < bw; c++) {
        if (down[base + c]! >= rows) {
          run++;
          if (run >= cols && visit(bx0 + margin + c - cols + 1, y0) === true) return;
        } else {
          run = 0;
        }
      }
    }
  };
  const anyFit = (h: number): boolean => {
    const extra = Math.floor(h * aspect - 0.5);
    const cols = 2 * margin + extra + 1;
    const rows = h + 2 * margin;
    if (rows > longestY || cols > longestX) return false;
    for (let y0 = by0 + margin; y0 + h + margin - 1 <= by1; y0++) {
      const base = (y0 - margin - by0) * bw;
      let run = 0;
      for (let c = 0; c < bw; c++) {
        if (down[base + c]! >= rows) {
          if (++run >= cols) return true;
        } else {
          run = 0;
        }
      }
    }
    return false;
  };

  if (!anyFit(1)) return undefined;
  let lo = 1;
  let hi = Math.min(params.maxHeight, bh - 2 * margin);
  if (hi > lo && anyFit(hi)) lo = hi; // the cap fits: no search
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (anyFit(mid)) lo = mid;
    else hi = mid - 1;
  }
  const h = lo;

  // The centre is (x0 + w / 2, y0 + h / 2): w and h are the same for every box here, so the distance to the
  // mean centre is the distance of (x0, y0) to the mean of the (x0, y0).
  let n = 0;
  let sx = 0;
  let sy = 0;
  scan(h, (x0, y0) => {
    n++;
    sx += x0;
    sy += y0;
  });
  const approx = (x0: number, y0: number): number => (n * x0 - sx) ** 2 + (n * y0 - sy) ** 2;
  // One pass keeps every box that could still be within the tie tolerance of the nearest one (a superset of
  // the final candidates: the tolerance only shrinks as the nearest distance improves), in row-major order.
  const slack = (d: number): number => d * (1 + 1e-9) + 1;
  let dmin = Infinity;
  let candidates: number[] = [];
  scan(h, (x0, y0) => {
    const d = approx(x0, y0);
    if (d < dmin) {
      dmin = d;
      if (candidates.length > 128) {
        const keep: number[] = [];
        const bound = slack(dmin);
        for (let i = 0; i < candidates.length; i += 2) {
          if (approx(candidates[i]!, candidates[i + 1]!) <= bound) keep.push(candidates[i]!, candidates[i + 1]!);
        }
        candidates = keep;
      }
    }
    if (d <= slack(dmin)) candidates.push(x0, y0);
  });
  // Exact comparison (whole numbers) among the boxes that could tie; row-major order gives y0 then x0.
  const bigN = BigInt(n);
  const bigSx = BigInt(sx);
  const bigSy = BigInt(sy);
  const exact = (x0: number, y0: number): bigint => (bigN * BigInt(x0) - bigSx) ** 2n + (bigN * BigInt(y0) - bigSy) ** 2n;
  const limit = slack(dmin);
  let best: { x0: number; y0: number } | undefined;
  let bestD = 0n;
  for (let i = 0; i < candidates.length; i += 2) {
    const x0 = candidates[i]!;
    const y0 = candidates[i + 1]!;
    if (approx(x0, y0) > limit) continue;
    const d = exact(x0, y0);
    if (best === undefined || d < bestD) {
      best = { x0, y0 };
      bestD = d;
    }
  }
  return { x0: best!.x0, y0: best!.y0, h, w: h * aspect };
}

/**
 * The territory label boxes, one per entry index (undefined for sea, for an entry without land, without a
 * valid aspect, or whose main piece holds no box). Owners play no part: they are computed once (FR-171).
 */
export function territoryBoxes(p: PieceIndex, aspects: ArrayLike<number | undefined>, params: LayoutParams): (LabelBox | undefined)[] {
  checkParams(params);
  const main = mainPieces(p);
  const boxes: (LabelBox | undefined)[] = new Array<LabelBox | undefined>(p.entries).fill(undefined);
  for (let entry = 1; entry < p.entries; entry++) {
    const piece = main[entry]!;
    const aspect = aspects[entry];
    if (piece < 0 || !isAspect(aspect)) continue;
    boxes[entry] = fitLabel(p, [piece], aspect, params);
  }
  return boxes;
}

const samePieces = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The faction label boxes for an owner table (faction index per entry). `previous` is the result for the
 * round being left on the same piece index: a faction whose main region has the same pieces, the same
 * aspect and the same parameters keeps its label object; the others are laid out again. The result equals a
 * full recomputation (FR-171).
 */
export function factionBoxes(
  p: PieceIndex,
  owners: ArrayLike<number>,
  aspects: ReadonlyMap<number, number>,
  params: LayoutParams,
  previous?: FactionBoxes,
): FactionBoxes {
  checkParams(params);
  const main = mainRegions(regionsOf(p, owners));
  const reusable = previous !== undefined && previous.index === p && previous.params.margin === params.margin && previous.params.maxHeight === params.maxHeight;
  const labels = new Map<number, FactionLabel>();
  const recomputed: number[] = [];
  for (const faction of Array.from(main.keys()).sort((a, b) => a - b)) {
    const aspect = aspects.get(faction);
    if (!isAspect(aspect)) continue;
    const region = main.get(faction)!;
    const old = reusable ? previous.labels.get(faction) : undefined;
    if (old !== undefined && old.aspect === aspect && samePieces(old.pieces, region.pieces)) {
      labels.set(faction, old);
      continue;
    }
    recomputed.push(faction);
    labels.set(faction, { pieces: region.pieces, aspect, box: fitLabel(p, region.pieces, aspect, params) });
  }
  return { index: p, params: { margin: params.margin, maxHeight: params.maxHeight }, labels, recomputed };
}
