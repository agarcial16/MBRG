// Readable label sizing, tier selection, and screen-space overlap resolution (spec 032 FR-620..FR-624, NFR-150).
// Pure, deterministic, ASCII-only.
import type { Camera, Viewport } from './camera';
import type { CentreParams } from './centre-params';
import { centredInLand } from './label-centred';
import type { Counts } from './label-counts';
import { LABEL_HALO, LABEL_INK, frameOf, labelsAt } from './label-frame';
import type { AnyLabelDraw, FactionLabelInput, LabelRole, RoundLabels, TerritoryLabelInput } from './label-frame';
import type { LabelTexts } from './label-input';
import type { FactionBoxes, FactionLabel, LabelBox, LayoutParams } from './label-layout';
import type { InLandFrame, ShapedFrame } from './label-shape';
import { abbreviateName } from './label-abbreviate';
import { mainPieces, mainRegions, regionsOf } from './regions';
import type { PieceIndex } from './regions';
import type { ShapeParams } from './shape-params';

export interface ReadableParams {
  /** Minimum drawn height in CSS pixels (labels below this are hidden). */
  readonly minPx: number;
  /** Maximum drawn height in CSS pixels, per role (FR-621). */
  readonly maxPx: { readonly faction: number; readonly territory: number };
  /** Minimum clear gap in CSS pixels between adjacent drawn labels of the same role (FR-620). */
  readonly minGapPx: number;
}

export const READABLE_PARAMS: ReadableParams = {
  minPx: 9,
  maxPx: { faction: 48, territory: 28 },
  minGapPx: 4,
};

/** One precomputed in-land display tier for a label (ordered fullest -> shortest). */
export interface LabelTier {
  readonly text: string;
  readonly box?: LabelBox;
  readonly frame?: ShapedFrame;
  readonly height: number;
}

/** A label draw that may carry precomputed shorter display-form tiers and its faction/territory id. */
export type ReadableDraw = AnyLabelDraw & {
  readonly id?: number;
  readonly tiers?: readonly LabelTier[];
};

/** Clamps a raw on-screen height (h * scale) to [minPx, maxPx[role]], or 0 when below minPx. */
export function clampScreenHeight(rawPx: number, role: LabelRole, params: ReadableParams = READABLE_PARAMS): number {
  if (!(rawPx >= params.minPx)) return 0;
  return Math.min(rawPx, params.maxPx[role]);
}

/** Picks the first (fullest) tier whose on-screen height reaches minPx, or undefined if none fits. */
export function selectTier(tiers: readonly LabelTier[], scale: number, minPx: number = READABLE_PARAMS.minPx): LabelTier | undefined {
  for (const tier of tiers) {
    if (tier.height * scale >= minPx) return tier;
  }
  return undefined;
}

/** Converts a single tier into an AnyLabelDraw (no leader line). */
export function drawFromTier(tier: LabelTier, role: LabelRole, factor: number): AnyLabelDraw | undefined {
  if (tier.frame !== undefined) {
    return { text: tier.text, role, frame: tier.frame, factor, ink: LABEL_INK, halo: LABEL_HALO };
  }
  if (tier.box !== undefined) {
    return { text: tier.text, role, box: tier.box, factor, ink: LABEL_INK, halo: LABEL_HALO };
  }
  return undefined;
}

/** Selects the active tier at `scale` and returns its AnyLabelDraw (or undefined if hidden). */
export function tierDraws(
  tiers: readonly LabelTier[],
  role: LabelRole,
  factor: number,
  scale: number,
  minPx: number = READABLE_PARAMS.minPx,
): AnyLabelDraw | undefined {
  const chosen = selectTier(tiers, scale, minPx);
  return chosen === undefined ? undefined : drawFromTier(chosen, role, factor);
}

interface ScreenRect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const DEG = Math.PI / 180;

/** Padded screen-space AABB of raw geometry (cx, cy, w, h, angle) after clamping height to maxPx[role]. */
function screenRectOfGeom(
  cx: number,
  cy: number,
  w: number,
  h: number,
  angle: number,
  role: LabelRole,
  cam: Camera,
  vp: Viewport,
  params: ReadableParams,
): ScreenRect | undefined {
  const rawH = h * cam.scale;
  const drawnH = clampScreenHeight(rawH, role, params);
  if (drawnH <= 0) return undefined;
  const k = drawnH / rawH;
  const drawnW = w * cam.scale * k;
  const sx = (cx - cam.x) * cam.scale + vp.width / 2;
  const sy = (cy - cam.y) * cam.scale + vp.height / 2;
  const rad = Math.abs(angle) * DEG;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const halfW = (drawnW * cos + drawnH * sin) / 2 + params.minGapPx / 2;
  const halfH = (drawnW * sin + drawnH * cos) / 2 + params.minGapPx / 2;
  return { minX: sx - halfW, minY: sy - halfH, maxX: sx + halfW, maxY: sy + halfH };
}

/** Padded screen-space AABB of a tier without allocating a draw or FrameData. */
function tierScreenRect(
  tier: LabelTier,
  role: LabelRole,
  cam: Camera,
  vp: Viewport,
  params: ReadableParams,
): ScreenRect | undefined {
  if (tier.frame !== undefined) {
    const f = tier.frame;
    return screenRectOfGeom(f.cx, f.cy, f.w, f.h, f.angle, role, cam, vp, params);
  }
  if (tier.box !== undefined) {
    const b = tier.box;
    return screenRectOfGeom(b.x0 + b.w / 2, b.y0 + b.h / 2, b.w, b.h, 0, role, cam, vp, params);
  }
  return undefined;
}

/** Padded screen-space AABB of a draw after clamping its height to maxPx[role]. */
function screenRectOf(draw: AnyLabelDraw, cam: Camera, vp: Viewport, params: ReadableParams): ScreenRect | undefined {
  const f = frameOf(draw);
  return screenRectOfGeom(f.cx, f.cy, f.w, f.h, f.angle, draw.role, cam, vp, params);
}

const overlaps = (a: ScreenRect, b: ScreenRect): boolean =>
  a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

const GRID_CELL = 64;
const GRID_BIAS = 32768;
const GRID_STRIDE = 65536;

const gridKey = (gx: number, gy: number): number => (gy + GRID_BIAS) * GRID_STRIDE + (gx + GRID_BIAS);

function gridHits(grid: Map<number, ScreenRect[]>, rect: ScreenRect): boolean {
  const gx0 = Math.floor(rect.minX / GRID_CELL);
  const gx1 = Math.floor(rect.maxX / GRID_CELL);
  const gy0 = Math.floor(rect.minY / GRID_CELL);
  const gy1 = Math.floor(rect.maxY / GRID_CELL);
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const cell = grid.get(gridKey(gx, gy));
      if (cell === undefined) continue;
      for (let i = 0; i < cell.length; i++) {
        if (overlaps(rect, cell[i]!)) return true;
      }
    }
  }
  return false;
}

function gridInsert(grid: Map<number, ScreenRect[]>, rect: ScreenRect): void {
  const gx0 = Math.floor(rect.minX / GRID_CELL);
  const gx1 = Math.floor(rect.maxX / GRID_CELL);
  const gy0 = Math.floor(rect.minY / GRID_CELL);
  const gy1 = Math.floor(rect.maxY / GRID_CELL);
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const k = gridKey(gx, gy);
      let cell = grid.get(k);
      if (cell === undefined) {
        cell = [];
        grid.set(k, cell);
      }
      cell.push(rect);
    }
  }
}

/**
 * Resolves screen-space overlaps among labels of the same role (FR-620), picking the fullest non-overlapping tier
 * per label (FR-623) and hiding labels that still collide or fall below minPx (FR-624). Culls to the viewport
 * and uses a 64 px spatial hash grid for O(1) overlap queries (NFR-151). Different roles remain independent.
 */
export function resolveFrameLabels(
  draws: readonly ReadableDraw[],
  camera: Camera,
  viewport: Viewport,
  params: ReadableParams = READABLE_PARAMS,
): AnyLabelDraw[] {
  const accepted: (AnyLabelDraw | undefined)[] = new Array<AnyLabelDraw | undefined>(draws.length).fill(undefined);
  const vpW = viewport.width;
  const vpH = viewport.height;
  const scale = camera.scale;

  for (const role of ['faction', 'territory'] as const) {
    interface Entry {
      readonly idx: number;
      readonly priority: number;
      readonly candidates: readonly { readonly draw: AnyLabelDraw; readonly rect: ScreenRect }[];
    }
    const entries: Entry[] = [];
    for (let idx = 0; idx < draws.length; idx++) {
      const d = draws[idx]!;
      if (d.role !== role) continue;
      const candidates: { draw: AnyLabelDraw; rect: ScreenRect }[] = [];
      if (d.tiers !== undefined && d.tiers.length > 0) {
        // Tiers are strictly increasing in height; if the shortest tier fails minPx, skip in O(1).
        if (d.tiers[d.tiers.length - 1]!.height * scale < params.minPx) continue;
        for (const tier of d.tiers) {
          if (tier.height * scale < params.minPx) continue;
          const rect = tierScreenRect(tier, role, camera, viewport, params);
          if (rect === undefined) continue;
          if (rect.maxX < 0 || rect.minX > vpW || rect.maxY < 0 || rect.minY > vpH) continue;
          const td = drawFromTier(tier, role, d.factor);
          if (td === undefined) continue;
          candidates.push({ draw: td, rect });
        }
      } else {
        const rect = screenRectOf(d, camera, viewport, params);
        if (rect !== undefined && rect.maxX >= 0 && rect.minX <= vpW && rect.maxY >= 0 && rect.minY <= vpH) {
          candidates.push({ draw: d, rect });
        }
      }
      if (candidates.length === 0) continue;
      const top = candidates[0]!;
      const topH = clampScreenHeight(frameOf(top.draw).h * scale, role, params);
      entries.push({ idx, priority: topH, candidates });
    }
    // Taller / more prominent labels win; ties keep deterministic input order.
    entries.sort((a, b) => (b.priority !== a.priority ? b.priority - a.priority : a.idx - b.idx));

    const grid = new Map<number, ScreenRect[]>();
    for (const entry of entries) {
      for (const cand of entry.candidates) {
        if (!gridHits(grid, cand.rect)) {
          gridInsert(grid, cand.rect);
          accepted[entry.idx] = cand.draw;
          break;
        }
      }
    }
  }

  const out: AnyLabelDraw[] = [];
  for (const d of accepted) if (d !== undefined) out.push(d);
  return out;
}

const isAspect = (a: unknown): a is number => typeof a === 'number' && Number.isFinite(a) && a > 0;

/** Height of an in-land frame (0 if undefined). */
const frameHeight = (frame: InLandFrame | undefined): number =>
  frame === undefined ? 0 : frame.shape === 'horizontal' ? frame.box.h : frame.h;

const toTier = (text: string, frame: InLandFrame): LabelTier =>
  frame.shape === 'horizontal'
    ? { text, box: frame.box, height: frame.box.h }
    : { text, frame, height: frame.h };

/** Map-unit height threshold below which shorter abbreviation tiers are also computed. */
const TIER_THRESHOLD = { faction: 36, territory: 12 } as const;

/**
 * Computes strictly-growing in-land tiers (fullest -> shortest) for one region. Never places off-land boxes
 * or leader lines (FR-624).
 */
export function computeRegionTiers(
  p: PieceIndex,
  pieces: readonly number[],
  fullName: string,
  aspectOf: ReadonlyMap<string, number>,
  role: LabelRole,
  params: LayoutParams,
  sp: ShapeParams,
  cp: CentreParams,
): readonly LabelTier[] {
  const names = abbreviateName(fullName);
  const tiers: LabelTier[] = [];
  let bestHeight = 0;
  let lastAspect = Infinity;
  const threshold = TIER_THRESHOLD[role];

  for (let i = 0; i < names.length; i++) {
    const cand = names[i]!;
    const aspect = aspectOf.get(cand);
    if (!isAspect(aspect)) continue;
    if (i > 0 && aspect >= lastAspect * 0.92) continue;
    const found = centredInLand(p, pieces, aspect, role, params, sp, cp);
    const h = frameHeight(found.frame);
    if (found.frame !== undefined && h > bestHeight) {
      tiers.push(toTier(cand, found.frame));
      bestHeight = h;
      lastAspect = aspect;
      if (bestHeight >= threshold) break;
    }
  }
  return tiers;
}

/** Collects every candidate display form across all faction and territory names so aspects are measured once. */
export function allCandidateTexts(names: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const name of names) {
    for (const cand of abbreviateName(name)) seen.add(cand);
  }
  return [...seen];
}

export interface ReadableTerritoryTiers {
  readonly tiers: readonly (readonly LabelTier[] | undefined)[];
}

export interface ReadableFactionTiers {
  readonly tiers: ReadonlyMap<number, readonly LabelTier[]>;
  readonly piecesByFaction: ReadonlyMap<number, readonly number[]>;
}

const samePieces = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Computes territory tiers once per map load (no off-land, no leader lines). */
export function placeReadableTerritories(
  p: PieceIndex,
  names: readonly (string | undefined)[],
  aspectOf: ReadonlyMap<string, number>,
  params: LayoutParams,
  sp: ShapeParams,
  cp: CentreParams,
): ReadableTerritoryTiers {
  const main = mainPieces(p);
  const tiers: (readonly LabelTier[] | undefined)[] = new Array<readonly LabelTier[] | undefined>(p.entries).fill(undefined);
  for (let entry = 1; entry < p.entries; entry++) {
    const piece = main[entry]!;
    const name = names[entry];
    if (piece < 0 || name === undefined) continue;
    tiers[entry] = computeRegionTiers(p, [piece], name, aspectOf, 'territory', params, sp, cp);
  }
  return { tiers };
}

/** Computes faction tiers for one state, reusing unchanged factions from `previous` (FR-623, NFR-151). */
export function placeReadableFactions(
  p: PieceIndex,
  owners: ArrayLike<number>,
  names: ReadonlyMap<number, string>,
  aspectOf: ReadonlyMap<string, number>,
  params: LayoutParams,
  sp: ShapeParams,
  cp: CentreParams,
  previous?: ReadableFactionTiers,
): ReadableFactionTiers {
  const main = mainRegions(regionsOf(p, owners));
  const tiers = new Map<number, readonly LabelTier[]>();
  const piecesByFaction = new Map<number, readonly number[]>();
  for (const faction of Array.from(main.keys()).sort((a, b) => a - b)) {
    const name = names.get(faction);
    if (name === undefined) continue;
    const region = main.get(faction)!;
    piecesByFaction.set(faction, region.pieces);
    const prevPieces = previous?.piecesByFaction.get(faction);
    const prevTiers = previous?.tiers.get(faction);
    if (prevPieces !== undefined && prevTiers !== undefined && samePieces(prevPieces, region.pieces)) {
      tiers.set(faction, prevTiers);
    } else {
      tiers.set(faction, computeRegionTiers(p, region.pieces, name, aspectOf, 'faction', params, sp, cp));
    }
  }
  return { tiers, piecesByFaction };
}

/** Builds FactionBoxes from readable faction tiers so reveal-tour framing (`framingBoxOf`) stays intact. */
export function factionBoxesOf(
  p: PieceIndex,
  readable: ReadableFactionTiers,
  names: ReadonlyMap<number, string>,
  aspectOf: ReadonlyMap<string, number>,
  params: LayoutParams,
): FactionBoxes {
  const labels = new Map<number, FactionLabel>();
  for (const [faction, pieces] of readable.piecesByFaction) {
    const name = names.get(faction);
    if (name === undefined) continue;
    const primary = readable.tiers.get(faction)?.[0];
    const aspect = aspectOf.get(primary?.text ?? name) ?? 1;
    labels.set(faction, { pieces, aspect, box: primary?.box });
  }
  return { index: p, params: { margin: params.margin, maxHeight: params.maxHeight }, labels, recomputed: [] };
}

/** Builds RoundLabels and ReadableDraw[] (with tiers attached, zero off-land boxes or leader lines). */
export function readableRoundLabels(
  texts: LabelTexts,
  table: ArrayLike<number>,
  factionsLayout: ReadableFactionTiers,
  territoriesLayout: ReadableTerritoryTiers,
  aspectOf: ReadonlyMap<string, number>,
): { readonly labels: RoundLabels; readonly draws: ReadableDraw[] } {
  const factions: FactionLabelInput[] = [];
  const draws: ReadableDraw[] = [];
  for (const faction of Array.from(factionsLayout.tiers.keys()).sort((a, b) => a - b)) {
    const tiers = factionsLayout.tiers.get(faction);
    if (tiers === undefined || tiers.length === 0) continue;
    const primary = tiers[0]!;
    const aspect = aspectOf.get(primary.text) ?? 1;
    factions.push({
      faction,
      text: primary.text,
      box: primary.box,
      ...(primary.frame !== undefined ? { frame: primary.frame } : {}),
      aspect,
    });
    const base = drawFromTier(primary, 'faction', 1);
    if (base !== undefined) draws.push({ ...base, id: faction, tiers });
  }
  const territories: TerritoryLabelInput[] = [];
  for (let entry = 1; entry < table.length; entry++) {
    const owner = table[entry]!;
    if (owner <= 0) continue;
    const tiers = territoriesLayout.tiers[entry];
    if (tiers === undefined || tiers.length === 0) continue;
    const primary = tiers[0]!;
    territories.push({
      entry,
      text: primary.text,
      box: primary.box,
      ...(primary.frame !== undefined ? { frame: primary.frame } : {}),
    });
    const base = drawFromTier(primary, 'territory', 1);
    if (base !== undefined) draws.push({ ...base, id: entry, tiers });
  }
  return { labels: { factions, territories }, draws };
}

/** Counts of primary in-land shapes for the debug panel (offLand is always 0 under FR-624). */
export function readableCounts(
  table: ArrayLike<number>,
  factionsLayout: ReadableFactionTiers,
  territoriesLayout: ReadableTerritoryTiers,
): { readonly faction: Counts; readonly territory: Counts } {
  const countOf = (lists: Iterable<readonly LabelTier[] | undefined>): Counts => {
    let horizontal = 0;
    let straight = 0;
    let arc = 0;
    let none = 0;
    for (const tiers of lists) {
      const primary = tiers?.[0];
      if (primary === undefined) none++;
      else if (primary.frame === undefined) horizontal++;
      else if (primary.frame.shape === 'straight') straight++;
      else arc++;
    }
    return { horizontal, straight, arc, offLand: 0, none };
  };
  const territoryLists: (readonly LabelTier[] | undefined)[] = [];
  for (let entry = 1; entry < table.length; entry++) {
    if (table[entry]! > 0 && territoriesLayout.tiers[entry] !== undefined) territoryLists.push(territoriesLayout.tiers[entry]);
  }
  return { faction: countOf(factionsLayout.tiers.values()), territory: countOf(territoryLists) };
}

/**
 * Builds step labels at `scale` using each label's active tier (FR-627): keeps abbreviated labels visible
 * mid-step instead of blinking out on tiers[0], and crossfades smoothly when display forms change.
 */
export function stepReadableLabels(
  earlier: ReadableFactionTiers,
  later: ReadableFactionTiers,
  territories: ReadableTerritoryTiers,
  table: ArrayLike<number>,
  meta: { readonly eliminated: number; readonly absorber: number },
  aspectOf: ReadonlyMap<string, number>,
  scale: number,
  forward: number,
  minPx: number = READABLE_PARAMS.minPx,
): AnyLabelDraw[] {
  const out: AnyLabelDraw[] = [];
  const factionIds = [...new Set([...earlier.tiers.keys(), ...later.tiers.keys()])].sort((a, b) => a - b);

  for (const id of factionIds) {
    const bList = earlier.tiers.get(id);
    const aList = later.tiers.get(id);
    const b = bList === undefined ? undefined : selectTier(bList, scale, minPx);
    const a = aList === undefined ? undefined : selectTier(aList, scale, minPx);

    if (id === meta.eliminated) {
      if (b !== undefined && 1 - forward > 0) {
        const d = drawFromTier(b, 'faction', 1 - forward);
        if (d !== undefined) out.push(d);
      }
      continue;
    }

    if (id === meta.absorber && b !== undefined && a !== undefined && b.text === a.text) {
      const aspect = aspectOf.get(a.text) ?? 1;
      const single = labelsAt(
        {
          earlier: { factions: [{ faction: id, text: b.text, box: b.box, ...(b.frame !== undefined ? { frame: b.frame } : {}), aspect }], territories: [] },
          later: { factions: [{ faction: id, text: a.text, box: a.box, ...(a.frame !== undefined ? { frame: a.frame } : {}), aspect }], territories: [] },
          eliminated: meta.eliminated,
          absorber: meta.absorber,
          transferred: new Set(),
        },
        forward,
      );
      for (const d of single) out.push(d);
      continue;
    }

    if (b !== undefined && a !== undefined && b.text === a.text && b.height === a.height && b.box?.x0 === a.box?.x0 && b.box?.y0 === a.box?.y0) {
      const d = drawFromTier(forward < 0.5 ? b : a, 'faction', 1);
      if (d !== undefined) out.push(d);
      continue;
    }

    // Display form or geometry changed: smooth crossfade.
    if (b !== undefined && 1 - forward > 0) {
      const d = drawFromTier(b, 'faction', 1 - forward);
      if (d !== undefined) out.push(d);
    }
    if (a !== undefined && forward > 0) {
      const d = drawFromTier(a, 'faction', forward);
      if (d !== undefined) out.push(d);
    }
  }

  for (let entry = 1; entry < table.length; entry++) {
    if (table[entry]! <= 0) continue;
    const tList = territories.tiers[entry];
    if (tList === undefined) continue;
    const chosen = selectTier(tList, scale, minPx);
    if (chosen === undefined) continue;
    const d = drawFromTier(chosen, 'territory', 1);
    if (d !== undefined) out.push(d);
  }
  return out;
}

/**
 * Upgrades tour label draws to their active tier at `scale` while preserving each draw's tour opacity factor (FR-627).
 * Keys tiers by faction/territory id (from `roundLabels` matching `tourLabelDraws` order, or `draw.id`) so duplicate
 * names or abbreviations never mispair during tours.
 */
export function upgradeTourDraws(
  tourDraws: readonly ReadableDraw[],
  currentDraws: readonly ReadableDraw[],
  scale: number,
  minPx: number = READABLE_PARAMS.minPx,
  roundLabels?: RoundLabels,
): AnyLabelDraw[] {
  const byId = new Map<string, readonly LabelTier[]>();
  const byText = new Map<string, readonly LabelTier[]>();
  for (const d of currentDraws) {
    if (d.tiers === undefined || d.tiers.length === 0) continue;
    if (d.id !== undefined) byId.set(`${d.role}:${d.id}`, d.tiers);
    byText.set(`${d.role}:${d.text}`, d.tiers);
  }
  let orderKeys: string[] | undefined;
  if (roundLabels !== undefined) {
    orderKeys = [];
    for (const l of [...roundLabels.factions].sort((a, b) => a.faction - b.faction)) {
      if (l.frame !== undefined || l.box !== undefined) orderKeys.push(`faction:${l.faction}`);
    }
    for (const l of [...roundLabels.territories].sort((a, b) => a.entry - b.entry)) {
      if (l.frame !== undefined || l.box !== undefined) orderKeys.push(`territory:${l.entry}`);
    }
  }
  const out: AnyLabelDraw[] = [];
  for (let i = 0; i < tourDraws.length; i++) {
    const d = tourDraws[i]!;
    const idKey = d.id !== undefined ? `${d.role}:${d.id}` : orderKeys?.[i];
    const tiers = (idKey !== undefined ? byId.get(idKey) : undefined) ?? byText.get(`${d.role}:${d.text}`);
    if (tiers === undefined) {
      out.push(d);
      continue;
    }
    const chosen = selectTier(tiers, scale, minPx);
    if (chosen === undefined) continue;
    const upgraded = drawFromTier(chosen, d.role, d.factor);
    if (upgraded !== undefined) out.push(upgraded);
  }
  return out;
}
