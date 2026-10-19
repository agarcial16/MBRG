// Hit finding for the NFR-40 shaped review set (plan 006 section 12): the dev-map layout with the text aspects
// measured in Chrome (D10), and the ordered searches whose first hit each scene pins.
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import { buildEntryIndex, factionIndexOf, ownerTable } from '../../src/core/entries';
import type { EntryIndex } from '../../src/core/entries';
import { labelTexts } from '../../src/core/label-input';
import type { LabelTexts } from '../../src/core/label-input';
import { placeFactions, placeTerritories } from '../../src/core/label-place';
import type { FactionLayout, Placed, TerritoryLayout } from '../../src/core/label-place';
import { LABEL_PARAMS } from '../../src/core/label-params';
import { shapedHeight } from '../../src/core/label-shape';
import type { InLandFrame } from '../../src/core/label-shape';
import { decodeIdPng } from '../../src/core/png';
import { buildPieceIndex, mainPieces } from '../../src/core/regions';
import type { PieceIndex } from '../../src/core/regions';
import { sceneAt } from '../../src/core/scene';
import type { SimPort } from '../../src/core/scene';
import { SHAPE_PARAMS } from '../../src/core/shape-params';
import type { ShapeParams } from '../../src/core/shape-params';
import { inflateStream } from '../../src/ui/load';
import { DEV_MAP, DEV_PRESENTATION, devPngBytes } from './dev-map';
import { MEASURED_ASPECTS } from './measured-aspects';

const REAL: SimPort = { totalRounds, getState, getRounds, ownerOf };

export type Drawn = InLandFrame | Placed;

export interface MeasuredRun {
  index: EntryIndex;
  p: PieceIndex;
  texts: LabelTexts;
  factionAspects: Map<number, number>;
  territoryAspects: number[];
  rounds: number;
  tables: Uint8Array[];
  territories: TerritoryLayout;
  /** Each round placed from that state alone (seed 1). */
  factions: FactionLayout[];
  sp: ShapeParams;
}

export const shapeParamsWith = (territory: number): ShapeParams => ({
  ...SHAPE_PARAMS,
  offLandHeight: { faction: SHAPE_PARAMS.offLandHeight.faction, territory },
});

export async function loadIndex(): Promise<{ index: EntryIndex; p: PieceIndex }> {
  const decoded = await decodeIdPng(devPngBytes(), inflateStream);
  if (!decoded.ok) throw new Error('png');
  const index = buildEntryIndex(DEV_MAP, decoded.value.width, decoded.value.height, decoded.value.values);
  return { index, p: buildPieceIndex(index) };
}

export function aspectsOf(index: EntryIndex): { texts: LabelTexts; factionAspects: Map<number, number>; territoryAspects: number[] } {
  const texts = labelTexts(DEV_MAP, DEV_PRESENTATION, factionIndexOf(DEV_MAP));
  const factionAspects = new Map<number, number>();
  for (const [f, name] of texts.factions) factionAspects.set(f, MEASURED_ASPECTS[name]!);
  const territoryAspects: number[] = [];
  for (let e = 0; e < index.fills.length; e++) {
    const name = texts.territories[e];
    territoryAspects.push(index.fills[e] === 'land' && name !== undefined ? MEASURED_ASPECTS[name]! : 0);
  }
  return { texts, factionAspects, territoryAspects };
}

/** Owner table of every round 0..T of a seed. */
export function tablesOf(index: EntryIndex, seed: number): Uint8Array[] {
  const factionIndex = factionIndexOf(DEV_MAP);
  const total = totalRounds(DEV_MAP);
  if (!total.ok) throw new Error('rounds');
  const tables: Uint8Array[] = [];
  for (let round = 0; round <= total.value; round++) {
    const scene = sceneAt(DEV_MAP, DEV_PRESENTATION, seed, round, REAL);
    if (!scene.ok) throw new Error('scene');
    tables.push(ownerTable(index, scene.value.owners, factionIndex));
  }
  return tables;
}

export async function measuredRun(sp: ShapeParams = SHAPE_PARAMS): Promise<MeasuredRun> {
  const { index, p } = await loadIndex();
  const a = aspectsOf(index);
  const tables = tablesOf(index, 1);
  const territories = placeTerritories(p, a.territoryAspects, LABEL_PARAMS, sp);
  const factions = tables.map((t) => placeFactions(p, t, a.factionAspects, LABEL_PARAMS, sp));
  return { index, p, ...a, rounds: tables.length - 1, tables, territories, factions, sp };
}

export const drawnOf = (placed: Placed | undefined, inLand: InLandFrame | undefined): Drawn | undefined => placed ?? inLand;

/** Scene kinds, in the order of plan section 12. */
export type HitKind =
  | 'steep-straight'
  | 'diagonal-straight'
  | 'arc-cup'
  | 'arc-cap'
  | 'kept-horizontal'
  | 'off-land-island'
  | 'off-land-inland'
  | 'off-land-leader';

/** Whether a drawn frame (with the data of its label) is a hit of the kind. */
export function isHit(kind: HitKind, drawn: Drawn | undefined, inLand: InLandFrame | undefined, hS: number | undefined, piece: number, run: { p: PieceIndex; sp: ShapeParams }): boolean {
  if (drawn === undefined) return false;
  const noNeighbour = run.p.nbStart[piece + 1]! === run.p.nbStart[piece]!;
  switch (kind) {
    case 'steep-straight':
      return drawn.shape === 'straight' && Math.abs(drawn.angle) >= 60;
    case 'diagonal-straight':
      return drawn.shape === 'straight' && Math.abs(drawn.angle) >= 30 && Math.abs(drawn.angle) <= 45;
    case 'arc-cup':
      return drawn.shape === 'arc' && drawn.bend > 0;
    case 'arc-cap':
      return drawn.shape === 'arc' && drawn.bend < 0;
    case 'kept-horizontal':
      return drawn.shape === 'horizontal' && inLand?.shape === 'horizontal' && hS !== undefined && hS < run.sp.shapeGain * inLand.box.h;
    case 'off-land-island':
      return drawn.shape === 'off-land' && noNeighbour;
    case 'off-land-inland':
      return drawn.shape === 'off-land' && !noNeighbour;
    case 'off-land-leader':
      return drawn.shape === 'off-land' && drawn.leader !== undefined;
  }
}

export interface TerritoryHit {
  entry: number;
  name: string;
  frame: Drawn;
}

/** First territory (entry order) that is a hit of the kind. */
export function territoryHit(run: MeasuredRun, kind: HitKind): TerritoryHit | undefined {
  const main = mainPieces(run.p);
  for (let entry = 1; entry < run.p.entries; entry++) {
    if (run.territories.eligible[entry] !== 1) continue;
    const inLand = run.territories.inLand[entry];
    const drawn = drawnOf(run.territories.placed[entry], inLand);
    let hS: number | undefined;
    if (kind === 'kept-horizontal' && inLand?.shape === 'horizontal') {
      hS = shapedHeight(run.p, [main[entry]!], run.territoryAspects[entry]!, LABEL_PARAMS, run.sp);
    }
    if (isHit(kind, drawn, inLand, hS, main[entry]!, run)) return { entry, name: run.texts.territories[entry]!, frame: drawn! };
  }
  return undefined;
}

export interface FactionHit {
  round: number;
  faction: number;
  name: string;
  frame: Drawn;
}

/** First faction label (round, then faction order) that is a hit of the kind, or any off-land one. */
export function factionHit(run: MeasuredRun, kind: HitKind | 'off-land'): FactionHit | undefined {
  for (let round = 0; round <= run.rounds; round++) {
    const layout = run.factions[round]!;
    for (const [faction, label] of layout.boxes.labels) {
      const inLand = layout.inLand.get(faction);
      const drawn = drawnOf(layout.placed.get(faction), inLand);
      if (drawn === undefined) continue;
      let hit: boolean;
      if (kind === 'off-land') hit = drawn.shape === 'off-land';
      else {
        let hS: number | undefined;
        if (kind === 'kept-horizontal' && inLand?.shape === 'horizontal') hS = shapedHeight(run.p, label.pieces, label.aspect, LABEL_PARAMS, run.sp);
        hit = isHit(kind, drawn, inLand, hS, label.pieces[0]!, run);
      }
      if (hit) return { round, faction, name: run.texts.factions.get(faction)!, frame: drawn };
    }
  }
  return undefined;
}

/** The step scene kinds of plan section 12 item 11. */
export type StepKind = 'straight' | 'arc' | 'off-land';

export interface StepHit {
  kind: StepKind;
  seed: number;
  /** The step goes from this round to the next. */
  round: number;
  faction: number;
  name: string;
  before: Drawn;
  after: Drawn;
}

/** Which step scene kinds an absorber's pair of drawn frames satisfies. */
export function stepKinds(before: Drawn, after: Drawn): StepKind[] {
  const out: StepKind[] = [];
  const box = (d: Drawn): boolean => d.shape === 'horizontal' || d.shape === 'straight';
  if (box(before) && box(after) && (before.shape === 'straight' || after.shape === 'straight') && before.shape !== after.shape) out.push('straight');
  if (before.shape === 'arc' || after.shape === 'arc') out.push('arc');
  if ((before.shape === 'off-land') !== (after.shape === 'off-land')) out.push('off-land');
  return out;
}

/**
 * The first (seed ascending, then round) step of each wanted kind over seeds 1..maxSeed: the absorber is the faction
 * whose in-land frame the step recomputes. Stops when every kind has a hit. `visited` counts the states placed.
 */
export function stepHits(index: EntryIndex, p: PieceIndex, maxSeed: number, wanted: readonly StepKind[]): { hits: Map<StepKind, StepHit>; seeds: number } {
  const a = aspectsOf(index);
  const hits = new Map<StepKind, StepHit>();
  let seeds = 0;
  for (let seed = 1; seed <= maxSeed && hits.size < wanted.length; seed++) {
    seeds = seed;
    const tables = tablesOf(index, seed);
    let previous = placeFactions(p, tables[0]!, a.factionAspects, LABEL_PARAMS, SHAPE_PARAMS);
    for (let round = 0; round + 1 < tables.length; round++) {
      const next = placeFactions(p, tables[round + 1]!, a.factionAspects, LABEL_PARAMS, SHAPE_PARAMS, previous);
      for (const faction of next.recomputed) {
        const before = drawnOf(previous.placed.get(faction), previous.inLand.get(faction));
        const after = drawnOf(next.placed.get(faction), next.inLand.get(faction));
        if (before === undefined || after === undefined) continue;
        for (const kind of stepKinds(before, after)) {
          if (wanted.includes(kind) && !hits.has(kind)) hits.set(kind, { kind, seed, round, faction, name: a.texts.factions.get(faction)!, before, after });
        }
      }
      previous = next;
    }
  }
  return { hits, seeds };
}

/** Centre of a drawn frame, in map units. */
export function centreOf(d: Drawn): { x: number; y: number } {
  if (d.shape === 'horizontal' || d.shape === 'off-land') return { x: d.box.x0 + d.box.w / 2, y: d.box.y0 + d.box.h / 2 };
  return { x: d.cx, y: d.cy };
}

/** Height of a drawn frame, in map units. */
export const heightOf = (d: Drawn): number => (d.shape === 'horizontal' || d.shape === 'off-land' ? d.box.h : d.h);
