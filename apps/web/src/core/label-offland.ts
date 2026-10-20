// Off-land label boxes (spec 006 FR-203 to FR-207, FR-215; plan D6, D7 and section 7). Pure.
// The search is the definition: every whole (x0, y0) of the window where a box can be within reach, decided with
// the formulas of the spec "Number reference" in the written order. The obstacles (FR-215) and the label's own set
// are rasterised once per search into a bitmap of unit centres with a 2-D prefix sum, so each candidate box costs
// O(1) for the blocking test; the gap and the anchor come from the boundary units of the set (D7, exact).
import type { LabelBox, LayoutParams } from './label-layout';
import { arcFootprint, inArc, straightFootprint } from './label-shape';
import type { InLandFrame, ShapedFrame } from './label-shape';
import type { PieceIndex } from './regions';
import type { ShapeParams } from './shape-params';

/** A straight segment from the point of an off-land box nearest to its anchor unit's centre to that centre. */
export interface LeaderLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** An off-land box: `gap2` is its squared gap, `anchor` the row-major index of its anchor unit. */
export interface OffLand {
  shape: 'off-land';
  box: LabelBox;
  gap2: number;
  anchor: number;
  /** Present only when the squared gap is above Gl squared. */
  leader?: LeaderLine;
}

/** What a label's search must avoid: an in-land frame of a label of the same role, or an off-land box placed before. */
export type Obstacle = InLandFrame | OffLand;

/** A frame that is not the horizontal in-land candidate: it needs placement data (a shaped frame or an off-land box). */
export type Placed = ShapedFrame | OffLand;

/**
 * Spec "Leader line": from (Math.min(Math.max(px, x0), x0 + w), Math.min(Math.max(py, y0), y0 + h)) to the anchor
 * centre (px, py).
 */
export function leaderLine(box: LabelBox, px: number, py: number): LeaderLine {
  return {
    x1: Math.min(Math.max(px, box.x0), box.x0 + box.w),
    y1: Math.min(Math.max(py, box.y0), box.y0 + box.h),
    x2: px,
    y2: py,
  };
}

/**
 * The row-major indexes (ascending) of the units of the pieces that have a 4-neighbour outside the set, the image
 * border counting as outside. D7: for a box that holds no unit of the set, the nearest unit always has such a
 * neighbour, so the squared gap and the anchor over these units equal those over every unit.
 */
export function boundaryUnits(p: PieceIndex, pieces: readonly number[]): Int32Array {
  const member = new Uint8Array(p.entryOf.length);
  for (const piece of pieces) member[piece] = 1;
  const inSet = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < p.width && y < p.height && member[p.pieceOf[y * p.width + x]!] === 1 && p.pieceOf[y * p.width + x]! >= 0;
  const out: number[] = [];
  for (const piece of pieces) {
    for (let k = p.unitStart[piece]!; k < p.unitStart[piece + 1]!; k++) {
      const u = p.units[k]!;
      const x = u % p.width;
      const y = (u - x) / p.width;
      if (!inSet(x - 1, y) || !inSet(x + 1, y) || !inSet(x, y - 1) || !inSet(x, y + 1)) out.push(u);
    }
  }
  out.sort((a, b) => a - b);
  return Int32Array.from(out);
}

/**
 * The smallest squared gap from the box [x0, x0 + w] x [y0, y0 + h] to a unit centre of `units` (row-major indexes)
 * and the nearest unit, ties by the smallest row-major index. Spec: "ex = Math.max(x0 - px, 0, px - (x0 + w)),
 * ey = Math.max(y0 - py, 0, py - (y0 + h)), g2 = (ex * ex) + (ey * ey)".
 */
export function nearestUnit(width: number, units: ArrayLike<number>, x0: number, y0: number, w: number, h: number): { gap2: number; anchor: number } {
  let gap2 = Infinity;
  let anchor = -1;
  for (let k = 0; k < units.length; k++) {
    const u = units[k]!;
    const x = u % width;
    const px = x + 0.5;
    const py = (u - x) / width + 0.5;
    const ex = Math.max(x0 - px, 0, px - (x0 + w));
    const ey = Math.max(y0 - py, 0, py - (y0 + h));
    const g2 = ex * ex + ey * ey;
    if (g2 < gap2 || (g2 === gap2 && u < anchor)) {
      gap2 = g2;
      anchor = u;
    }
  }
  return { gap2, anchor };
}

/** The smallest lattice index i with i + 0.5 >= v, decided by the comparison itself. */
function firstIndexAtLeast(v: number): number {
  let i = Math.ceil(v - 0.5) - 1;
  while (i + 0.5 < v) i++;
  return i;
}

/** The largest lattice index i with i + 0.5 <= v, decided by the comparison itself. */
function lastIndexAtMost(v: number): number {
  let i = Math.floor(v - 0.5) + 1;
  while (i + 0.5 > v) i--;
  return i;
}

function checkInputs(aspect: number, height: number, params: LayoutParams): void {
  if (!(typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0)) throw new RangeError(`label aspect must be a positive finite number, got ${String(aspect)}`);
  if (!Number.isInteger(height) || height < 1) throw new RangeError(`off-land height must be a whole number >= 1, got ${String(height)}`);
  if (!Number.isInteger(params.margin) || params.margin < 1) throw new RangeError(`label margin must be a whole number >= 1, got ${String(params.margin)}`);
}

/** The bitmap of blocked unit centres of one search window, with a prefix sum for O(1) rectangle counts. */
class Window {
  readonly width: number;
  readonly height: number;
  private readonly flags: Uint8Array;
  private sums: Int32Array | undefined;
  constructor(
    readonly x0: number,
    readonly y0: number,
    x1: number,
    y1: number,
  ) {
    this.width = Math.max(0, x1 - x0 + 1);
    this.height = Math.max(0, y1 - y0 + 1);
    this.flags = new Uint8Array(this.width * this.height);
  }
  mark(x: number, y: number): void {
    const ix = x - this.x0;
    const iy = y - this.y0;
    if (ix >= 0 && iy >= 0 && ix < this.width && iy < this.height) this.flags[iy * this.width + ix] = 1;
  }
  /** Marks the lattice rectangle [xa, xb] x [ya, yb] (clipped to the window). */
  markRect(xa: number, ya: number, xb: number, yb: number): void {
    for (let y = Math.max(ya, this.y0); y <= Math.min(yb, this.y0 + this.height - 1); y++) {
      for (let x = Math.max(xa, this.x0); x <= Math.min(xb, this.x0 + this.width - 1); x++) this.flags[(y - this.y0) * this.width + (x - this.x0)] = 1;
    }
  }
  meets(xa: number, ya: number, xb: number, yb: number): boolean {
    return xb >= this.x0 && yb >= this.y0 && xa < this.x0 + this.width && ya < this.y0 + this.height;
  }
  build(): void {
    const w1 = this.width + 1;
    const sums = new Int32Array(w1 * (this.height + 1));
    for (let y = 0; y < this.height; y++) {
      let row = 0;
      for (let x = 0; x < this.width; x++) {
        row += this.flags[y * this.width + x]!;
        sums[(y + 1) * w1 + (x + 1)] = sums[y * w1 + (x + 1)]! + row;
      }
    }
    this.sums = sums;
  }
  /** Number of blocked cells in the lattice rectangle [xa, xb] x [ya, yb] (clipped to the window). */
  count(xa: number, ya: number, xb: number, yb: number): number {
    const sums = this.sums!;
    const w1 = this.width + 1;
    const ax = Math.max(xa, this.x0) - this.x0;
    const ay = Math.max(ya, this.y0) - this.y0;
    const bx = Math.min(xb, this.x0 + this.width - 1) - this.x0 + 1;
    const by = Math.min(yb, this.y0 + this.height - 1) - this.y0 + 1;
    if (bx <= ax || by <= ay) return 0;
    return sums[by * w1 + bx]! - sums[ay * w1 + bx]! - sums[by * w1 + ax]! + sums[ay * w1 + ax]!;
  }
}

/** The grown box of a horizontal box: spec "x0 - M <= px <= (x0 + w) + M" and likewise in y, as lattice ranges. */
function grownRange(box: LabelBox, margin: number): { xa: number; xb: number; ya: number; yb: number } {
  return {
    xa: firstIndexAtLeast(box.x0 - margin),
    xb: lastIndexAtMost(box.x0 + box.w + margin),
    ya: firstIndexAtLeast(box.y0 - margin),
    yb: lastIndexAtMost(box.y0 + box.h + margin),
  };
}

/** Marks the unit centres of the grown footprint of an obstacle that fall in the window (pinned memberships). */
function markObstacle(win: Window, ob: Obstacle, margin: number): void {
  if (ob.shape === 'horizontal' || ob.shape === 'off-land') {
    const r = grownRange(ob.box, margin);
    if (win.meets(r.xa, r.ya, r.xb, r.yb)) win.markRect(r.xa, r.ya, r.xb, r.yb);
    return;
  }
  // A point of a grown footprint is within (w / 2 + M) along the middle line and (h / 2 + M) across it of the centre.
  const reach = Math.ceil(ob.w / 2 + ob.h / 2 + 2 * margin) + 2;
  const x = ob.cx - 0.5;
  const y = ob.cy - 0.5;
  if (!win.meets(Math.floor(x) - reach, Math.floor(y) - reach, Math.floor(x) + reach, Math.floor(y) + reach)) return;
  if (ob.shape === 'straight') {
    const fp = straightFootprint(ob.angle, ob.w, ob.h, margin);
    for (let i = 0; i < fp.rows.length; i += 3) {
      const row = y + fp.rows[i]!;
      const first = x + fp.rows[i + 1]!;
      win.markRect(first, row, first + fp.rows[i + 2]! - 1, row);
    }
    return;
  }
  const fp = arcFootprint(ob, margin);
  for (let i = 0; i < fp.rows.length; i += 3) {
    const row = y + fp.rows[i]!;
    const first = x + fp.rows[i + 1]!;
    win.markRect(first, row, first + fp.rows[i + 2]! - 1, row);
  }
  for (const [dx, dy] of fp.border) {
    if (inArc(ob, margin, x + dx + 0.5, y + dy + 0.5)) win.mark(x + dx, y + dy);
  }
}

/**
 * The best acceptable off-land box of a label (FR-203 to FR-205), or undefined. `height` is the role's
 * `offLandHeight`; `obstacles` are the in-land frames of every label of the same role in the state and the off-land
 * boxes already placed before this label (FR-215). Acceptable: whole x0, y0; grown box inside the image; no unit of
 * the label's own set in the grown box; squared gap at most Dr squared; no unit centre in both the grown box and the
 * grown footprint of an obstacle. Best: smallest squared gap, then squared distance of the box centre to the set
 * centre, then y0, then x0.
 */
export function offLandBox(
  p: PieceIndex,
  pieces: readonly number[],
  aspect: number,
  height: number,
  obstacles: readonly Obstacle[],
  params: LayoutParams,
  sp: ShapeParams,
): OffLand | undefined {
  checkInputs(aspect, height, params);
  const margin = params.margin;
  const W = p.width;
  const H = p.height;
  const w = height * aspect;
  let n = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = W;
  let maxX = -1;
  let minY = H;
  let maxY = -1;
  for (const piece of pieces) {
    for (let k = p.unitStart[piece]!; k < p.unitStart[piece + 1]!; k++) {
      const u = p.units[k]!;
      const x = u % W;
      const y = (u - x) / W;
      n++;
      sumX += x + 0.5;
      sumY += y + 0.5;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (n === 0) return undefined;
  const mx = sumX / n;
  const my = sumY / n;
  const reach = sp.offLandReach;
  const reach2 = reach * reach;
  // Candidate range (a superset: the exact conditions below decide): the box must come within Dr of the set's extent.
  const xlo = Math.max(margin, Math.ceil(minX + 0.5 - reach - w) - 1);
  const xhi = Math.min(W, Math.floor(maxX + 0.5 + reach) + 1);
  const ylo = Math.max(margin, Math.ceil(minY + 0.5 - reach - height) - 1);
  const yhi = Math.min(H, Math.floor(maxY + 0.5 + reach) + 1);
  if (xlo > xhi || ylo > yhi) return undefined;
  // Window of unit centres the grown boxes of the candidates can cover (inside the image).
  const win = new Window(Math.max(0, xlo - margin), Math.max(0, ylo - margin), Math.min(W - 1, xhi + Math.ceil(w) + margin + 1), Math.min(H - 1, yhi + height + margin + 1));
  for (const piece of pieces) {
    for (let k = p.unitStart[piece]!; k < p.unitStart[piece + 1]!; k++) {
      const u = p.units[k]!;
      const x = u % W;
      win.mark(x, (u - x) / W);
    }
  }
  for (const ob of obstacles) markObstacle(win, ob, margin);
  win.build();
  const border = boundaryUnits(p, pieces);

  let best: OffLand | undefined;
  let bestDist = 0;
  let bestY = 0;
  let bestX = 0;
  for (let y0 = ylo; y0 <= yhi; y0++) {
    for (let x0 = xlo; x0 <= xhi; x0++) {
      // Spec: the grown box is inside the id image iff x0 - M >= 0, (x0 + w) + M <= W, y0 - M >= 0, (y0 + h) + M <= H.
      if (!(x0 - margin >= 0 && x0 + w + margin <= W && y0 - margin >= 0 && y0 + height + margin <= H)) continue;
      const xa = firstIndexAtLeast(x0 - margin);
      const xb = lastIndexAtMost(x0 + w + margin);
      const ya = firstIndexAtLeast(y0 - margin);
      const yb = lastIndexAtMost(y0 + height + margin);
      if (win.count(xa, ya, xb, yb) > 0) continue;
      const g = nearestUnit(W, border, x0, y0, w, height);
      if (g.gap2 > reach2) continue;
      const dx = x0 + w / 2 - mx;
      const dy = y0 + height / 2 - my;
      const dist = dx * dx + dy * dy;
      if (best !== undefined) {
        if (g.gap2 > best.gap2) continue;
        if (g.gap2 === best.gap2 && dist > bestDist) continue;
        if (g.gap2 === best.gap2 && dist === bestDist && (y0 > bestY || (y0 === bestY && x0 > bestX))) continue;
      }
      best = { shape: 'off-land', box: { x0, y0, h: height, w }, gap2: g.gap2, anchor: g.anchor };
      bestDist = dist;
      bestY = y0;
      bestX = x0;
    }
  }
  if (best === undefined) return undefined;
  if (best.gap2 > sp.leaderGap * sp.leaderGap) {
    const ax = best.anchor % W;
    best.leader = leaderLine(best.box, ax + 0.5, (best.anchor - ax) / W + 0.5);
  }
  return best;
}

/** One label of a role, in placement order: its label set, its text aspect ratio and its in-land frame (FR-198). */
export interface RoleLabel {
  pieces: readonly number[];
  aspect: number;
  inLand: InLandFrame | undefined;
}

/**
 * The placement of the labels of one role in one state (plan section 7; FR-203, FR-205, FR-206, FR-215). `labels`
 * are in placement order (ascending entry or faction). All in-land frames are decided first and are obstacles for
 * every search, whether or not their label goes off-land; each off-land box placed becomes an obstacle for the
 * labels after it. A label goes off-land when it has no in-land frame or its in-land height is below `height`
 * (`offLandHeight` of the role). The result has, per label: its off-land box; else its shaped in-land frame (FR-206
 * fallback or a kept shaped frame); else undefined (a horizontal in-land frame is the 005 box, drawn by the 005 path,
 * and a label with no frame at all is not drawn).
 */
export function placeRole(p: PieceIndex, labels: readonly RoleLabel[], height: number, params: LayoutParams, sp: ShapeParams): (Placed | undefined)[] {
  const obstacles: Obstacle[] = [];
  for (const label of labels) if (label.inLand !== undefined) obstacles.push(label.inLand);
  const out: (Placed | undefined)[] = [];
  for (const label of labels) {
    const frame = label.inLand;
    const inHeight = frame === undefined ? undefined : frame.shape === 'horizontal' ? frame.box.h : frame.h;
    if (inHeight === undefined || inHeight < height) {
      const box = offLandBox(p, label.pieces, label.aspect, height, obstacles, params, sp);
      if (box !== undefined) {
        out.push(box);
        obstacles.push(box);
        continue;
      }
    }
    out.push(frame !== undefined && frame.shape !== 'horizontal' ? frame : undefined);
  }
  return out;
}
