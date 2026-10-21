// Role placements of the centred labels (spec 007 FR-217, FR-223, FR-224, FR-225, FR-229; plan 007 PD2, PD9 and
// section 7). Pure. Territory labels are placed once per load from their main pieces (owners play no part, FR-224).
// Faction labels are placed for every displayed state: the in-land frame of a faction whose main region has the same
// pieces and aspect is reused from the state being left (the result equals a computation from the state alone).
// Both roles go through the same origin-free `centredInLand` (FR-223); the 006 off-land search is reused unchanged.
import type { CentreParams } from './centre-params';
import { centredInLand } from './label-centred';
import type { FactionLabel, LabelBox, LayoutParams } from './label-layout';
import { placeRole } from './label-offland';
import type { Placed, RoleLabel } from './label-offland';
import type { FactionLayout, TerritoryLayout } from './label-place';
import type { InLandFrame } from './label-shape';
import { mainPieces, mainRegions, regionsOf } from './regions';
import type { PieceIndex } from './regions';
import type { ShapeParams } from './shape-params';

const isAspect = (a: unknown): a is number => typeof a === 'number' && Number.isFinite(a) && a > 0;

/** The 007 territory placement: the 006 layout type plus the widening step each frame was chosen at. */
export interface CentredTerritoryLayout extends TerritoryLayout {
  /** Entry -> step k of the in-land frame (undefined for an entry with no label). */
  steps: readonly (number | undefined)[];
}

/** The 007 faction placement of one state: the 006 layout type plus the steps and the centre parameters used. */
export interface CentredFactionLayout extends FactionLayout {
  /** Faction -> step k of its in-land frame. */
  steps: ReadonlyMap<number, number>;
  /** The centre parameters the in-land frames were computed with (a result is reused only with equal ones). */
  centreParams: CentreParams;
}

/** The 007 horizontal frame as the `boxes` entry of a layout: only a horizontal in-land frame is a box (PD2). */
const boxOf = (frame: InLandFrame | undefined): LabelBox | undefined => (frame !== undefined && frame.shape === 'horizontal' ? frame.box : undefined);

const sameRatio = (a: { num: number; den: number }, b: { num: number; den: number }): boolean => a.num === b.num && a.den === b.den;

const sameCentreParams = (a: CentreParams, b: CentreParams): boolean =>
  sameRatio(a.centreFraction, b.centreFraction) &&
  a.angleLimit === b.angleLimit &&
  sameRatio(a.arcGain, b.arcGain) &&
  a.arcTangentLimit.faction === b.arcTangentLimit.faction &&
  a.arcTangentLimit.territory === b.arcTangentLimit.territory &&
  a.straightAngles.length === b.straightAngles.length &&
  a.straightAngles.every((v, i) => v === b.straightAngles[i]) &&
  sameRatio(a.factionAreaShare, b.factionAreaShare);

const sameShapeParams = (a: ShapeParams, b: ShapeParams): boolean =>
  a.angleStep === b.angleStep &&
  a.shapeGain === b.shapeGain &&
  a.arcBends.length === b.arcBends.length &&
  a.arcBends.every((v, i) => v === b.arcBends[i]) &&
  a.offLandHeight.faction === b.offLandHeight.faction &&
  a.offLandHeight.territory === b.offLandHeight.territory &&
  a.offLandReach === b.offLandReach &&
  a.leaderGap === b.leaderGap;

const samePieces = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The territory labels once per load: the centred in-land frame of every eligible entry (a main piece and a valid
 * aspect), then the 006 off-land placement in ascending entry order. Takes no owner table (FR-224). `boxes` holds the
 * 007 horizontal frames only: an entry whose frame is straight, an arc or none has no box (PD2).
 */
export function placeCentredTerritories(
  p: PieceIndex,
  aspects: ArrayLike<number | undefined>,
  params: LayoutParams,
  sp: ShapeParams,
  cp: CentreParams,
): CentredTerritoryLayout {
  const main = mainPieces(p);
  const boxes: (LabelBox | undefined)[] = new Array<LabelBox | undefined>(p.entries).fill(undefined);
  const eligible = new Uint8Array(p.entries);
  const inLand: (InLandFrame | undefined)[] = new Array<InLandFrame | undefined>(p.entries).fill(undefined);
  const placed: (Placed | undefined)[] = new Array<Placed | undefined>(p.entries).fill(undefined);
  const steps: (number | undefined)[] = new Array<number | undefined>(p.entries).fill(undefined);
  const entries: number[] = [];
  const labels: RoleLabel[] = [];
  for (let entry = 1; entry < p.entries; entry++) {
    const piece = main[entry]!;
    const aspect = aspects[entry];
    if (piece < 0 || !isAspect(aspect)) continue;
    eligible[entry] = 1;
    const found = centredInLand(p, [piece], aspect, 'territory', params, sp, cp);
    inLand[entry] = found.frame;
    steps[entry] = found.k;
    boxes[entry] = boxOf(found.frame);
    entries.push(entry);
    labels.push({ pieces: [piece], aspect, inLand: found.frame });
  }
  const result = placeRole(p, labels, sp.offLandHeight.territory, params, sp);
  entries.forEach((entry, i) => (placed[entry] = result[i]));
  return { boxes, inLand, placed, eligible, steps };
}

/**
 * The faction labels of one state (owners: faction index per entry). `previous` is the layout of the state being
 * left: a faction whose main region has the same pieces and aspect, on the same piece index and with equal layout,
 * shape and centre parameters, keeps its in-land frame (PD9); everything else, and every off-land box, is computed
 * again. The result equals a computation from this state alone. `boxes.labels` hold the 007 horizontal frames.
 */
export function placeCentredFactions(
  p: PieceIndex,
  owners: ArrayLike<number>,
  aspects: ReadonlyMap<number, number>,
  params: LayoutParams,
  sp: ShapeParams,
  cp: CentreParams,
  previous?: CentredFactionLayout,
): CentredFactionLayout {
  const main = mainRegions(regionsOf(p, owners));
  const reusable =
    previous !== undefined &&
    previous.boxes.index === p &&
    previous.boxes.params.margin === params.margin &&
    previous.boxes.params.maxHeight === params.maxHeight &&
    sameShapeParams(previous.shapeParams, sp) &&
    sameCentreParams(previous.centreParams, cp);
  const labelsOut = new Map<number, FactionLabel>();
  const inLand = new Map<number, InLandFrame | undefined>();
  const steps = new Map<number, number>();
  const recomputed: number[] = [];
  const factions: number[] = [];
  const roleLabels: RoleLabel[] = [];
  for (const faction of Array.from(main.keys()).sort((a, b) => a - b)) {
    const aspect = aspects.get(faction);
    if (!isAspect(aspect)) continue;
    const region = main.get(faction)!;
    const old = reusable ? previous.boxes.labels.get(faction) : undefined;
    let label: FactionLabel;
    let frame: InLandFrame | undefined;
    if (old !== undefined && old.aspect === aspect && samePieces(old.pieces, region.pieces) && previous!.inLand.has(faction) && previous!.steps.has(faction)) {
      label = old;
      frame = previous!.inLand.get(faction);
      steps.set(faction, previous!.steps.get(faction)!);
    } else {
      const found = centredInLand(p, region.pieces, aspect, 'faction', params, sp, cp);
      frame = found.frame;
      label = { pieces: region.pieces, aspect, box: boxOf(frame) };
      steps.set(faction, found.k);
      recomputed.push(faction);
    }
    labelsOut.set(faction, label);
    inLand.set(faction, frame);
    factions.push(faction);
    roleLabels.push({ pieces: label.pieces, aspect, inLand: frame });
  }
  const result = placeRole(p, roleLabels, sp.offLandHeight.faction, params, sp);
  const placed = new Map<number, Placed>();
  factions.forEach((faction, i) => {
    const one = result[i];
    if (one !== undefined) placed.set(faction, one);
  });
  const boxes = { index: p, params: { margin: params.margin, maxHeight: params.maxHeight }, labels: labelsOut, recomputed };
  return { boxes, inLand, placed, recomputed, shapeParams: sp, steps, centreParams: cp };
}
