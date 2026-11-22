import { isValidName, type Result } from '@mbrg/shared';
import type { Curation } from './curation';
import { ErrorCollector } from './errors';
import { formFactions, formTerritories, type Faction, type FactionError, type Territory, type TerritoryError } from './grouping';
import { partitionUnits, type SelectError, type Selection } from './select';
import type { ImportFeature } from './types';
import { formUnits, type Unit, type UnitError } from './units';

/** FR-599: every error the curation stage can find (the schema's `invalid-curation` is found before it). */
export type CurationStageError = UnitError | SelectError | TerritoryError | FactionError;

/** What the next stage (projection) takes from a sound curation. */
export interface CurationPlan {
  /** Every unit of the primary source, in order of first feature. */
  units: Unit[];
  selection: Selection;
  /** The territories of the selected units, in order of first unit. */
  territories: Territory[];
  /** The factions in faction order, and the faction key of each land territory (by territory key). */
  factions: Faction[];
  factionOf: Map<string, string>;
}

/**
 * FR-599: the complete curation stage. One pass over the curation and the features of the primary source reports every
 * problem of FR-592 to FR-598 that needs the data: the unit keys and their conflicts, the selection, the names and
 * colors the curation itself gives (PD9: a name taken from a source is left to the self-check), the territory layer and
 * the faction layer, each producer going on with what the one before could form. The errors are collected once per
 * distinct data, in the FR-599 kind order and then the code-unit order of the first data field; on any error the
 * import stops before the projection and prints these errors alone. A sound curation gives the plan. Pure.
 */
export function checkCuration(features: readonly ImportFeature[], curation: Curation): Result<CurationPlan, CurationStageError> {
  const errors = new ErrorCollector<CurationStageError>();

  const formed = formUnits(features, curation);
  errors.addAll(formed.errors);
  const parted = partitionUnits(formed.units, curation);
  errors.addAll(parted.errors);

  // PD9: the names the curation gives; the faction names and colors are checked with the faction layer.
  for (const [key, entry] of curation.units) {
    if (entry.name !== undefined && !isValidName(entry.name)) errors.add({ kind: 'invalid-name', path: `units.${key}.name` });
  }
  for (const [key, name] of curation.territoryNames) {
    if (!isValidName(name)) errors.add({ kind: 'invalid-name', path: `territoryNames.${key}` });
  }
  curation.seas.forEach((sea, i) => {
    if (!isValidName(sea.name)) errors.add({ kind: 'invalid-name', path: `seas[${i}].name` });
  });

  const territories = formTerritories(parted.selection.selected, curation, errors);
  const plan = formFactions(territories, curation, errors);
  if (errors.size > 0) return { ok: false, errors: errors.list() };
  return {
    ok: true,
    value: { units: formed.units, selection: parted.selection, territories, factions: plan.factions, factionOf: plan.factionOf },
  };
}
