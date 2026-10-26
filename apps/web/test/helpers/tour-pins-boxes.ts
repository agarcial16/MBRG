// Framing boxes of a state for the pin helpers: from `factionBoxes` with one label aspect for every faction, or from the real
// `placeCentredFactions` layout (the one the browser uses, with its own aspects). Test helper only.
import type { EntryIndex } from '../../src/core/entries';
import { factionBoxes } from '../../src/core/label-layout';
import type { FactionBoxes } from '../../src/core/label-layout';
import { placeCentredFactions } from '../../src/core/label-centred-place';
import { CENTRE_PARAMS } from '../../src/core/centre-params';
import { LABEL_PARAMS } from '../../src/core/label-params';
import { buildPieceIndex } from '../../src/core/regions';
import { SHAPE_PARAMS } from '../../src/core/shape-params';

export type BoxSource = { readonly aspect: number } | { readonly centred: number };

/** `{ aspect }`: factionBoxes; `{ centred }`: placeCentredFactions, both with that label aspect for every living faction. */
export function framePinsAspects(index: EntryIndex, table: Uint8Array, factions: ReadonlyMap<number, number>, source: BoxSource): FactionBoxes {
  const pieces = buildPieceIndex(index);
  const value = 'aspect' in source ? source.aspect : source.centred;
  const aspects = new Map([...factions.values()].map((f) => [f, value] as [number, number]));
  return 'aspect' in source
    ? factionBoxes(pieces, table, aspects, LABEL_PARAMS)
    : placeCentredFactions(pieces, table, aspects, LABEL_PARAMS, SHAPE_PARAMS, CENTRE_PARAMS).boxes;
}
