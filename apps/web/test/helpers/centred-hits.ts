// Hit finding for the NFR-45 centred review set (plan 007 section 12): the 007 layout with the text aspects measured in
// Chrome (PD10), the ordered step search and the territory lists the close-up scenes are taken from.
import { CENTRE_PARAMS } from '../../src/core/centre-params';
import type { EntryIndex } from '../../src/core/entries';
import { placeCentredFactions } from '../../src/core/label-centred-place';
import type { CentredFactionLayout } from '../../src/core/label-centred-place';
import { LABEL_PARAMS } from '../../src/core/label-params';
import { centreSums } from '../../src/core/label-centre';
import { mainPieces } from '../../src/core/regions';
import type { PieceIndex } from '../../src/core/regions';
import { SHAPE_PARAMS } from '../../src/core/shape-params';
import { withCentred } from './centred-digest-run';
import type { CentredDevRun } from './centred-digest-run';
import { aspectsOf, centreOf, drawnOf, heightOf, measuredRun, tablesOf } from './shaped-hits';
import type { Drawn } from './shaped-hits';

export { centreOf, heightOf };

/** The measured-aspect run with its 007 placement. */
export async function centredMeasuredRun(): Promise<CentredDevRun> {
  return withCentred(await measuredRun());
}

/** The 006 and the 007 drawn frame of a territory entry. */
export function territoryFrames(run: CentredDevRun, entry: number): { before: Drawn | undefined; after: Drawn | undefined } {
  return {
    before: drawnOf(run.territories.placed[entry], run.territories.inLand[entry]),
    after: drawnOf(run.centredTerritories.placed[entry], run.centredTerritories.inLand[entry]),
  };
}

/** Territory entries (entry order) whose 006 frame is a straight frame steeper than 45 degrees. */
export function steepTerritories(run: CentredDevRun): number[] {
  const out: number[] = [];
  for (let entry = 1; entry < run.p.entries; entry++) {
    if (run.territories.eligible[entry] !== 1) continue;
    const before = territoryFrames(run, entry).before;
    if (before !== undefined && before.shape === 'straight' && Math.abs(before.angle) > 45) out.push(entry);
  }
  return out;
}

/** Territory entries (entry order) whose 006 frame has shape `from` and whose 007 frame has shape `to`. */
export function changedShape(run: CentredDevRun, from: 'horizontal' | 'arc', to: 'straight'): number[] {
  const out: number[] = [];
  for (let entry = 1; entry < run.p.entries; entry++) {
    if (run.territories.eligible[entry] !== 1) continue;
    const { before, after } = territoryFrames(run, entry);
    if (before?.shape === from && after?.shape === to) out.push(entry);
  }
  return out;
}

/** Exact centre of mass of a territory's main piece, to one decimal: (Sx / n + 0.5, Sy / n + 0.5). */
export function massCentre(p: PieceIndex, entry: number): { x: number; y: number } {
  const s = centreSums(p, [mainPieces(p)[entry]!]);
  const n = Number(s.n);
  const round1 = (v: number): number => Math.round(v * 10) / 10;
  return { x: round1(Number(s.sx) / n + 0.5), y: round1(Number(s.sy) / n + 0.5) };
}

export interface CentredStepHit {
  seed: number;
  /** The step goes from this round to the next. */
  round: number;
  faction: number;
  name: string;
  before: Drawn;
  after: Drawn;
}

/**
 * The first (seed ascending, then round) forward step whose absorber (the faction whose in-land frame the step
 * recomputes) is drawn horizontal in the earlier round and straight in the later one (spec NFR-45).
 */
export function centredStepHit(index: EntryIndex, p: PieceIndex, maxSeed: number): { hit: CentredStepHit | undefined; seeds: number } {
  return stepHitWhere(index, p, maxSeed, (before, after) => before?.shape === 'horizontal' && after?.shape === 'straight');
}

/**
 * The first (seed ascending, then round) forward step whose absorber is drawn as an in-land arc at the earlier round or
 * at the later one (spec D19: such a step is a crossfade, 006 FR-210 c).
 */
export function centredArcStepHit(index: EntryIndex, p: PieceIndex, maxSeed: number): { hit: CentredStepHit | undefined; seeds: number } {
  return stepHitWhere(index, p, maxSeed, (before, after) => before?.shape === 'arc' || after?.shape === 'arc');
}

function stepHitWhere(
  index: EntryIndex,
  p: PieceIndex,
  maxSeed: number,
  match: (before: Drawn | undefined, after: Drawn | undefined) => boolean,
): { hit: CentredStepHit | undefined; seeds: number } {
  const a = aspectsOf(index);
  let seeds = 0;
  for (let seed = 1; seed <= maxSeed; seed++) {
    seeds = seed;
    const tables = tablesOf(index, seed);
    let previous: CentredFactionLayout = placeCentredFactions(p, tables[0]!, a.factionAspects, LABEL_PARAMS, SHAPE_PARAMS, CENTRE_PARAMS);
    for (let round = 0; round + 1 < tables.length; round++) {
      const next = placeCentredFactions(p, tables[round + 1]!, a.factionAspects, LABEL_PARAMS, SHAPE_PARAMS, CENTRE_PARAMS, previous);
      for (const faction of next.recomputed) {
        const before = drawnOf(previous.placed.get(faction), previous.inLand.get(faction));
        const after = drawnOf(next.placed.get(faction), next.inLand.get(faction));
        if (before !== undefined && after !== undefined && match(before, after)) {
          return { hit: { seed, round, faction, name: a.texts.factions.get(faction)!, before, after }, seeds };
        }
      }
      previous = next;
    }
  }
  return { hit: undefined, seeds };
}
