// Label counts of the debug panel (spec 006 FR-214). Pure: the layout of the displayed state in, exclusive counts
// out. The counts describe the layout, not the visibility at the current scale.
import type { LabelTexts } from './label-input';
import type { Placed } from './label-offland';
import type { FactionLayout, TerritoryLayout } from './label-place';
import type { InLandFrame } from './label-shape';

/** Exclusive categories of the drawn frame of a label (FR-214). */
export interface Counts {
  horizontal: number;
  straight: number;
  arc: number;
  offLand: number;
  none: number;
}

const zero = (): Counts => ({ horizontal: 0, straight: 0, arc: 0, offLand: 0, none: 0 });

/** The drawn frame is the placed one (shaped, off-land, FR-206 fallbacks included), else the horizontal in-land one. */
function countOne(counts: Counts, placed: Placed | undefined, inLand: InLandFrame | undefined): void {
  const drawn = placed ?? inLand;
  if (drawn === undefined) counts.none++;
  else if (drawn.shape === 'off-land') counts.offLand++;
  else if (drawn.shape === 'straight') counts.straight++;
  else if (drawn.shape === 'arc') counts.arc++;
  else counts.horizontal++;
}

/** The part of a faction layout the counts read. */
export type CountedFactions = Pick<FactionLayout, 'inLand' | 'placed'> & { boxes: { labels: ReadonlyMap<number, unknown> } };
/** The part of a territory layout the counts read. */
export type CountedTerritories = Pick<TerritoryLayout, 'inLand' | 'placed' | 'eligible'>;

/**
 * Counts of the faction labels and of the territory labels of one state. Only labels that have a 005 label entry
 * are counted: a faction of the layout with a text, and an owned land entry with a text and a text aspect and a main
 * piece (`eligible`). `table` is the faction index by entry index.
 */
export function labelCounts(
  texts: LabelTexts,
  table: ArrayLike<number>,
  factions: CountedFactions,
  territories: CountedTerritories,
): { faction: Counts; territory: Counts } {
  const faction = zero();
  for (const id of factions.boxes.labels.keys()) {
    if (texts.factions.get(id) === undefined) continue;
    countOne(faction, factions.placed.get(id), factions.inLand.get(id));
  }
  const territory = zero();
  for (let entry = 1; entry < table.length; entry++) {
    if (texts.territories[entry] === undefined || table[entry]! <= 0 || territories.eligible[entry] !== 1) continue;
    countOne(territory, territories.placed[entry], territories.inLand[entry]);
  }
  return { faction, territory };
}
