/**
 * The NFR-46 figures table of spec 007 (plan 007 sections 12 and 15): for every territory label and every faction
 * label at every round of seed 1, the centre of mass C, n, rho, the in-land frame, its centre offset, the side gaps of
 * a horizontal frame and the in-land / off-land status. The "before" columns come from the retained 006 placement
 * with the aspects measured in Chrome (plan PD10). Test code: doubles are fine here, nothing in it decides a layout.
 */
import { setSums } from '../../src/core/label-axis';
import type { InLandFrame } from '../../src/core/label-shape';
import type { Placed } from '../../src/core/label-place';
import { mainPieces } from '../../src/core/regions';
import type { PieceIndex } from '../../src/core/regions';
import type { CentredDevRun } from './centred-digest-run';
import type { MeasuredRun } from './shaped-hits';

/** q = 7/50 as a double, for display only. */
export const Q = 0.14;

export interface FrameFigure {
  shape: 'horizontal' | 'straight' | 'arc';
  /** Degrees; 0 for a horizontal frame. */
  angle: number;
  h: number;
  /** Frame centre in map units. */
  x: number;
  y: number;
}

export interface FigureRow {
  role: 'territory' | 'faction';
  /** Round of seed 1 for a faction label; -1 for a territory label. */
  round: number;
  name: string;
  n: number;
  /** Centre of mass (Sx / n + 0.5, Sy / n + 0.5). */
  cx: number;
  cy: number;
  /** q x sqrt(n). */
  rho: number;
  /** The in-land frame (undefined when the label has none). */
  frame: FrameFigure | undefined;
  /** In-land when the drawn frame is the in-land one, off-land when it is an off-land box, none without any frame. */
  status: 'in-land' | 'off-land' | 'none';
  /** Offset of the frame centre from C: units, and as a fraction of sqrt(n). */
  dx: number;
  dy: number;
  dist: number;
  fraction: number;
  /** Side gaps of a horizontal frame (left, right), in map units. */
  gaps: { left: number; right: number } | undefined;
}

/** The figure of an in-land frame. */
export function frameFigure(f: InLandFrame): FrameFigure {
  if (f.shape === 'horizontal') return { shape: 'horizontal', angle: 0, h: f.box.h, x: f.box.x0 + f.box.w / 2, y: f.box.y0 + f.box.h / 2 };
  return { shape: f.shape, angle: f.angle, h: f.h, x: f.cx, y: f.cy };
}

/** Left and right gaps of a horizontal frame to the set's leftmost / rightmost unit in the rows it covers. */
export function sideGaps(p: PieceIndex, pieces: readonly number[], f: InLandFrame): { left: number; right: number } | undefined {
  if (f.shape !== 'horizontal') return undefined;
  const { x0, y0, h, w } = f.box;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const piece of pieces) {
    for (let k = p.unitStart[piece]!; k < p.unitStart[piece + 1]!; k++) {
      const u = p.units[k]!;
      const x = u % p.width;
      const y = (u - x) / p.width;
      if (y < y0 || y > y0 + h - 1) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }
  if (minX === Infinity) return undefined;
  return { left: x0 - minX, right: maxX + 1 - (x0 + w) };
}

/** One row of the table from a label's pieces, in-land frame and drawn (placed) frame. */
export function figureRow(
  p: PieceIndex,
  role: 'territory' | 'faction',
  round: number,
  name: string,
  pieces: readonly number[],
  inLand: InLandFrame | undefined,
  placed: Placed | undefined,
): FigureRow {
  const s = setSums(p, pieces);
  const cx = s.sx / s.n + 0.5;
  const cy = s.sy / s.n + 0.5;
  const frame = inLand === undefined ? undefined : frameFigure(inLand);
  const dx = frame === undefined ? 0 : frame.x - cx;
  const dy = frame === undefined ? 0 : frame.y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return {
    role,
    round,
    name,
    n: s.n,
    cx,
    cy,
    rho: Q * Math.sqrt(s.n),
    frame,
    status: placed?.shape === 'off-land' ? 'off-land' : frame === undefined ? 'none' : 'in-land',
    dx,
    dy,
    dist,
    fraction: dist / Math.sqrt(s.n),
    gaps: inLand === undefined ? undefined : sideGaps(p, pieces, inLand),
  };
}

/** The "before" table: every eligible territory label (entry order), then every faction label of rounds 0..T. */
export function beforeFigures(run: MeasuredRun): FigureRow[] {
  const rows: FigureRow[] = [];
  const main = mainPieces(run.p);
  // territory labels: the label set is the main piece of the entry (006 placeTerritories)
  for (let entry = 1; entry < run.p.entries; entry++) {
    if (run.territories.eligible[entry] !== 1) continue;
    rows.push(figureRow(run.p, 'territory', -1, run.texts.territories[entry]!, [main[entry]!], run.territories.inLand[entry], run.territories.placed[entry]));
  }
  for (let round = 0; round <= run.rounds; round++) {
    const layout = run.factions[round]!;
    for (const [faction, label] of layout.boxes.labels) {
      rows.push(figureRow(run.p, 'faction', round, run.texts.factions.get(faction)!, label.pieces, layout.inLand.get(faction), layout.placed.get(faction)));
    }
  }
  return rows;
}

/** An "after" row: the figure of a 007 frame plus the widening step k it was chosen at (disc radius k rho). */
export interface AfterRow extends FigureRow {
  k: number;
}

/**
 * The "after" table (T8): the same labels as `beforeFigures` with the 007 placement of the same run (measured aspects).
 * The label sets (main pieces) are the ones of the 006 layouts: both placements use the same main regions.
 */
export function afterFigures(run: CentredDevRun): AfterRow[] {
  const rows: AfterRow[] = [];
  const main = mainPieces(run.p);
  for (let entry = 1; entry < run.p.entries; entry++) {
    if (run.territories.eligible[entry] !== 1) continue;
    const t = run.centredTerritories;
    rows.push({
      ...figureRow(run.p, 'territory', -1, run.texts.territories[entry]!, [main[entry]!], t.inLand[entry], t.placed[entry]),
      k: t.steps[entry] ?? 0,
    });
  }
  for (let round = 0; round <= run.rounds; round++) {
    const before = run.factions[round]!;
    const after = run.centredFactions[round]!;
    for (const [faction, label] of before.boxes.labels) {
      rows.push({
        ...figureRow(run.p, 'faction', round, run.texts.factions.get(faction)!, label.pieces, after.inLand.get(faction), after.placed.get(faction)),
        k: after.steps.get(faction) ?? 0,
      });
    }
  }
  return rows;
}

/** An "after" row as a fixed-format line: the before format plus k and the offset in units of k rho. */
export function formatAfterRow(r: AfterRow): string {
  return `${formatRow(r)} | k${String(r.k)} d/(k rho) ${(r.k > 0 ? r.dist / (r.k * r.rho) : 0).toFixed(3)}`;
}

const f1 = (v: number): string => v.toFixed(1);
const f3 = (v: number): string => v.toFixed(3);

/** One row as a fixed-format line (rounded for reading; the table is pinned through these lines). */
export function formatRow(r: FigureRow): string {
  const frame = r.frame === undefined ? 'no frame' : `${r.frame.shape} ${r.frame.angle} h${r.frame.h} @(${f1(r.frame.x)},${f1(r.frame.y)})`;
  const off = r.frame === undefined ? '-' : `(${f1(r.dx)},${f1(r.dy)}) d${f1(r.dist)} f${f3(r.fraction)}`;
  const gaps = r.gaps === undefined ? '-' : `L${f1(r.gaps.left)} R${f1(r.gaps.right)}`;
  const who = r.role === 'territory' ? `T ${r.name}` : `F r${r.round} ${r.name}`;
  return `${who} | n${r.n} C(${f1(r.cx)},${f1(r.cy)}) rho${f1(r.rho)} | ${frame} | off ${off} | gaps ${gaps} | ${r.status}`;
}
