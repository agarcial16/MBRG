// Role placements (spec 006 FR-206, FR-209, FR-213, FR-215, FR-216; plan D5 and section 7). Pure.
// Territory labels are placed once per load from their main pieces (owners play no part, FR-209). Faction labels are
// placed for every displayed state: the in-land frame of a faction whose main region did not change is reused from
// the state being left; off-land boxes are always searched again (D5), because they depend on the other labels.
import { factionBoxes, territoryBoxes } from './label-layout';
import type { FactionBoxes, LabelBox, LayoutParams } from './label-layout';
import { placeRole } from './label-offland';
import type { Placed, RoleLabel } from './label-offland';
import { inLandFrame } from './label-shape';
import type { InLandFrame } from './label-shape';
import { mainPieces } from './regions';
import type { PieceIndex } from './regions';
import type { ShapeParams } from './shape-params';

export type { Placed } from './label-offland';

const isAspect = (a: unknown): a is number => typeof a === 'number' && Number.isFinite(a) && a > 0;

/** The territory placement: per entry index (undefined where there is none). */
export interface TerritoryLayout {
  /** The 005 horizontal candidates. */
  boxes: readonly (LabelBox | undefined)[];
  /** The in-land frame of each eligible entry (FR-198): undefined when it has no frame at all. */
  inLand: readonly (InLandFrame | undefined)[];
  /** Only the labels whose drawn frame is not the horizontal in-land candidate: a shaped frame or an off-land box. */
  placed: readonly (Placed | undefined)[];
  /** 1 for an entry with a main piece and a valid aspect (the labels that exist), else 0. */
  eligible: Uint8Array;
}

/** The faction placement of one state. */
export interface FactionLayout {
  /** The 005 result: the pieces, aspect and horizontal candidate of every faction label. */
  boxes: FactionBoxes;
  /** Faction -> in-land frame (undefined when it has none), for every faction of `boxes`. */
  inLand: ReadonlyMap<number, InLandFrame | undefined>;
  /** Faction -> placed frame, only for factions whose drawn frame is shaped or off-land. */
  placed: ReadonlyMap<number, Placed>;
  /** Factions whose in-land frame was computed by this call, ascending (the others were reused). */
  recomputed: readonly number[];
  /** The shape parameters the in-land frames were computed with (a result is reused only with equal ones). */
  shapeParams: ShapeParams;
}

const sameShapeParams = (a: ShapeParams, b: ShapeParams): boolean =>
  a.angleStep === b.angleStep &&
  a.shapeGain === b.shapeGain &&
  a.arcBends.length === b.arcBends.length &&
  a.arcBends.every((v, i) => v === b.arcBends[i]) &&
  a.offLandHeight.faction === b.offLandHeight.faction &&
  a.offLandHeight.territory === b.offLandHeight.territory &&
  a.offLandReach === b.offLandReach &&
  a.leaderGap === b.leaderGap;

/**
 * The territory labels once per load: horizontal candidate, in-land frame, then the off-land placement in ascending
 * entry order (FR-203, FR-205, FR-206, FR-215). Takes no owner table: the result is the same at every round.
 */
export function placeTerritories(p: PieceIndex, aspects: ArrayLike<number | undefined>, params: LayoutParams, sp: ShapeParams): TerritoryLayout {
  const boxes = territoryBoxes(p, aspects, params);
  const main = mainPieces(p);
  const eligible = new Uint8Array(p.entries);
  const inLand: (InLandFrame | undefined)[] = new Array<InLandFrame | undefined>(p.entries).fill(undefined);
  const placed: (Placed | undefined)[] = new Array<Placed | undefined>(p.entries).fill(undefined);
  const entries: number[] = [];
  const labels: RoleLabel[] = [];
  for (let entry = 1; entry < p.entries; entry++) {
    const piece = main[entry]!;
    const aspect = aspects[entry];
    if (piece < 0 || !isAspect(aspect)) continue;
    eligible[entry] = 1;
    inLand[entry] = inLandFrame(p, [piece], aspect, boxes[entry], params, sp);
    entries.push(entry);
    labels.push({ pieces: [piece], aspect, inLand: inLand[entry] });
  }
  const result = placeRole(p, labels, sp.offLandHeight.territory, params, sp);
  entries.forEach((entry, i) => (placed[entry] = result[i]));
  return { boxes, inLand, placed, eligible };
}

/**
 * The faction labels of one state (owners: faction index per entry). `previous` is the layout of the state being
 * left: a faction whose main region has the same pieces, aspect and parameters keeps its in-land frame (FR-216);
 * everything else, and every off-land box, is computed again. The result equals a computation from this state alone.
 */
export function placeFactions(
  p: PieceIndex,
  owners: ArrayLike<number>,
  aspects: ReadonlyMap<number, number>,
  params: LayoutParams,
  sp: ShapeParams,
  previous?: FactionLayout,
): FactionLayout {
  const boxes = factionBoxes(p, owners, aspects, params, previous?.boxes);
  const reusable = previous !== undefined && previous.boxes.index === p && sameShapeParams(previous.shapeParams, sp);
  const inLand = new Map<number, InLandFrame | undefined>();
  const recomputed: number[] = [];
  const factions: number[] = [];
  const labels: RoleLabel[] = [];
  for (const [faction, label] of boxes.labels) {
    let frame: InLandFrame | undefined;
    if (reusable && previous.boxes.labels.get(faction) === label && previous.inLand.has(faction)) {
      frame = previous.inLand.get(faction);
    } else {
      frame = inLandFrame(p, label.pieces, label.aspect, label.box, params, sp);
      recomputed.push(faction);
    }
    inLand.set(faction, frame);
    factions.push(faction);
    labels.push({ pieces: label.pieces, aspect: label.aspect, inLand: frame });
  }
  const result = placeRole(p, labels, sp.offLandHeight.faction, params, sp);
  const placed = new Map<number, Placed>();
  factions.forEach((faction, i) => {
    const one = result[i];
    if (one !== undefined) placed.set(faction, one);
  });
  return { boxes, inLand, placed, recomputed, shapeParams: sp };
}
