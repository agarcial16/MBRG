// Label inputs of a round (FR-167, FR-168, FR-174, FR-189). Pure glue between the presentation data, the owner
// table, the label boxes and the drawing data of `label-frame.ts`: names in, one `RoundLabels` out.
import { entryKind } from '@mbrg/shared';
import type { FactionId, MapData, PresentationData } from '@mbrg/shared';
import type { RoundLabels } from './label-frame';
import type { FactionBoxes, LabelBox } from './label-layout';
import type { LeaderLine, OffLand, Placed } from './label-offland';

/**
 * The labels whose drawn frame is not their horizontal in-land candidate (plan D3): a shaped frame or an off-land
 * box, by faction index and by entry index (`placeFactions` and `placeTerritories` give them).
 */
export interface Placement {
  factions: ReadonlyMap<number, Placed>;
  territories: readonly (Placed | undefined)[];
}

/** The texts to draw: names from the presentation data, nothing else (NFR-37). */
export interface LabelTexts {
  /** Name by entry index; undefined for index 0 and for sea entries (no sea labels). */
  territories: readonly (string | undefined)[];
  /** Name by faction index 1..F. */
  factions: ReadonlyMap<number, string>;
}

/** Territory and faction names by entry index and faction index. */
export function labelTexts(map: MapData, presentation: PresentationData, factionIndex: ReadonlyMap<FactionId, number>): LabelTexts {
  const names = new Map(presentation.territories.map((t) => [t.id, t.name]));
  const territories: (string | undefined)[] = [undefined];
  for (const entry of map.territories) territories.push(entryKind(entry) === 'sea' ? undefined : names.get(entry.id));
  const factions = new Map<number, string>();
  for (const f of presentation.factions) {
    const i = factionIndex.get(f.id);
    if (i !== undefined) factions.set(i, f.name);
  }
  return { territories, factions };
}

/**
 * The labels of one round: a faction label for every faction the layout holds (its box may be absent) and a
 * territory label for every owned land entry with a box, for the owner table `table` (faction index by entry
 * index). Labels carry no colour: the ink is fixed (FR-174).
 */
export function roundLabels(
  texts: LabelTexts,
  table: ArrayLike<number>,
  boxes: FactionBoxes,
  territoryBoxes: readonly (LabelBox | undefined)[],
  placed?: Placement,
): RoundLabels {
  const factions: RoundLabels['factions'][number][] = [];
  for (const [faction, label] of boxes.labels) {
    const text = texts.factions.get(faction);
    if (text === undefined) continue;
    const one = placed?.factions.get(faction);
    if (one === undefined) factions.push({ faction, text, box: label.box, aspect: label.aspect });
    else if (one.shape === 'off-land') factions.push({ faction, text, box: one.box, aspect: label.aspect, ...offLandFields(one) });
    else factions.push({ faction, text, box: undefined, aspect: label.aspect, frame: one });
  }
  const territories: RoundLabels['territories'][number][] = [];
  for (let entry = 1; entry < table.length; entry++) {
    const text = texts.territories[entry];
    const owner = table[entry]!;
    if (text === undefined || owner <= 0) continue;
    const one = placed?.territories[entry];
    if (one === undefined) {
      const box = territoryBoxes[entry];
      if (box !== undefined) territories.push({ entry, text, box });
    } else if (one.shape === 'off-land') {
      territories.push({ entry, text, box: one.box, ...offLandFields(one) });
    } else {
      territories.push({ entry, text, box: undefined, frame: one });
    }
  }
  return { factions, territories };
}

/** The off-land marker and, only when the box has one, its leader line (optional fields are never undefined). */
const offLandFields = (one: OffLand): { offLand: true; leader?: LeaderLine } => ({
  offLand: true,
  ...(one.leader !== undefined ? { leader: one.leader } : {}),
});
