import type { Result } from '@mbrg/shared';
import type { Curation, Usable } from './curation';
import { ErrorCollector } from './errors';
import { unitValue, type Unit } from './units';

/** The length of a territory or faction key, in code units (FR-599). */
export const KEY_MIN = 1;
export const KEY_MAX = 256;

/** FR-596: one territory: the units that share a territory key, in order of first unit. */
export interface Territory {
  key: string;
  kind: 'land' | 'sea';
  /** Absent only for a territory that failed `missing-territory-name`. */
  name: string | undefined;
  units: Unit[];
}

/** FR-596, FR-599: the errors of the territory layer. */
export type TerritoryError =
  | { kind: 'invalid-key'; territory: string }
  | { kind: 'missing-group-value'; unit: string; property: string }
  | { kind: 'mixed-territory-kind'; territory: string }
  | { kind: 'conflicting-group-name'; territory: string }
  | { kind: 'missing-territory-name'; territory: string };

/** True for a key of 1 to 256 code units. */
export const isKeyLength = (key: string): boolean => key.length >= KEY_MIN && key.length <= KEY_MAX;

/** A usable value read as the text a key or a name is made of. */
export const usableText = (value: Usable): string => String(value);

/**
 * FR-596: gives every selected unit a territory. A unit's territory is its `units` entry's `territory`; else, where
 * `territoryBy` is given, its usable value of the property (`missing-group-value` when it has none); else a territory
 * of its own keyed by the unit key. Units with one key form one territory, in order of first unit. A name comes, in
 * this order, from `territoryNames`, from the `nameProperty` of a `territoryBy` key (every unit that got the key from
 * the rule must share the value, else `conflicting-group-name`; a property present on no such unit says nothing),
 * from the only unit of the territory, else `missing-territory-name`. A territory of land and sea units is
 * `mixed-territory-kind`. Every territory key the curation names or a rule generates outside 1 to 256 code units is
 * `invalid-key` (never `invalid-curation`). The errors come back collected: once per distinct data, in the order of
 * the FR-599 kinds. Pure.
 */
export function groupTerritories(selected: readonly Unit[], curation: Curation): Result<Territory[], TerritoryError> {
  const errors = new ErrorCollector<TerritoryError>();
  const checkKey = (key: string): void => {
    if (!isKeyLength(key)) errors.add({ kind: 'invalid-key', territory: key });
  };
  // The keys the curation names, whether or not their units are selected.
  for (const entry of curation.units.values()) if (entry.territory !== undefined) checkKey(entry.territory);
  for (const key of curation.territoryNames.keys()) checkKey(key);

  interface Group {
    key: string;
    units: Unit[];
    /** The units that got the key from the `territoryBy` rule. */
    byRule: Unit[];
  }
  const groups = new Map<string, Group>();
  const rule = curation.territoryBy;
  for (const unit of selected) {
    let key: string;
    let byRule = false;
    if (unit.territory !== undefined) key = unit.territory;
    else if (rule !== undefined) {
      const value = unitValue(unit, rule.property);
      if (value === undefined) {
        errors.add({ kind: 'missing-group-value', unit: unit.key, property: rule.property });
        continue;
      }
      key = usableText(value);
      byRule = true;
      checkKey(key);
    } else {
      key = unit.key;
      checkKey(key);
    }
    let group = groups.get(key);
    if (group === undefined) {
      group = { key, units: [], byRule: [] };
      groups.set(key, group);
    }
    group.units.push(unit);
    if (byRule) group.byRule.push(unit);
  }

  const territories: Territory[] = [];
  for (const group of groups.values()) {
    const kinds = new Set(group.units.map((u) => (u.kind === 'sea' ? 'sea' : 'land')));
    if (kinds.size > 1) errors.add({ kind: 'mixed-territory-kind', territory: group.key });
    territories.push({ key: group.key, kind: kinds.has('sea') && kinds.size === 1 ? 'sea' : 'land', name: nameOf(group, curation, errors), units: group.units });
  }
  return errors.size > 0 ? { ok: false, errors: errors.list() } : { ok: true, value: territories };
}

/** FR-596: the name of one territory, or undefined after recording why it has none. */
function nameOf(group: { key: string; units: Unit[]; byRule: Unit[] }, curation: Curation, errors: ErrorCollector<TerritoryError>): string | undefined {
  const named = curation.territoryNames.get(group.key);
  if (named !== undefined) return named;
  const property = curation.territoryBy?.nameProperty;
  if (property !== undefined && group.byRule.length > 0) {
    const values = group.byRule.map((unit) => {
      const value = unitValue(unit, property);
      return value === undefined || value === '' ? undefined : usableText(value);
    });
    if (values.some((v) => v !== values[0])) {
      errors.add({ kind: 'conflicting-group-name', territory: group.key });
      return undefined;
    }
    if (values[0] !== undefined) return values[0];
  }
  if (group.units.length === 1 && group.units[0]!.name !== undefined) return group.units[0]!.name;
  errors.add({ kind: 'missing-territory-name', territory: group.key });
  return undefined;
}
