import { isValidColor, isValidName, type Result } from '@mbrg/shared';
import { compareCodeUnits } from '../core/errors';
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

/** Where a producer puts its errors: the collector of one layer or of the whole curation stage. */
export interface ErrorSink<E> {
  add(error: E): void;
}

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
  const territories = formTerritories(selected, curation, errors);
  return errors.size > 0 ? { ok: false, errors: errors.list() } : { ok: true, value: territories };
}

/** FR-596: the territories of `groupTerritories`, whatever the errors (the curation stage goes on to the factions with them). */
export function formTerritories(selected: readonly Unit[], curation: Curation, errors: ErrorSink<TerritoryError>): Territory[] {
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
  return territories;
}

/**
 * The text every one of `units` has as its value of `property` (an empty text counts as absent): `value` is undefined
 * when none has one, and `conflict` is true when they do not all share it (a unit without it against one with it is a
 * conflict).
 */
function sharedValue(units: readonly Unit[], property: string): { conflict: boolean; value: string | undefined } {
  const values = units.map((unit) => {
    const value = unitValue(unit, property);
    return value === undefined || value === '' ? undefined : usableText(value);
  });
  return { conflict: values.some((v) => v !== values[0]), value: values[0] };
}

/** FR-596: the name of one territory, or undefined after recording why it has none. */
function nameOf(group: { key: string; units: Unit[]; byRule: Unit[] }, curation: Curation, errors: ErrorSink<TerritoryError>): string | undefined {
  const named = curation.territoryNames.get(group.key);
  if (named !== undefined) return named;
  const property = curation.territoryBy?.nameProperty;
  if (property !== undefined && group.byRule.length > 0) {
    const shared = sharedValue(group.byRule, property);
    if (shared.conflict) {
      errors.add({ kind: 'conflicting-group-name', territory: group.key });
      return undefined;
    }
    if (shared.value !== undefined) return shared.value;
  }
  if (group.units.length === 1 && group.units[0]!.name !== undefined) return group.units[0]!.name;
  errors.add({ kind: 'missing-territory-name', territory: group.key });
  return undefined;
}

/** FR-597: the cap on the factions of land territories (FR-607). */
export const MAX_FACTIONS = 9999;

/** FR-597: one faction of the map, in faction order; `color` is present only when the curation gave one. */
export interface Faction {
  key: string;
  name: string;
  color?: string;
}

/** FR-597: the factions in faction order and the faction key of every land territory (by territory key). */
export interface FactionPlan {
  factions: Faction[];
  factionOf: Map<string, string>;
}

/** FR-597, FR-599: the errors of the faction layer. */
export type FactionError =
  | { kind: 'invalid-name'; path: string }
  | { kind: 'invalid-color'; path: string }
  | { kind: 'invalid-key'; faction: string }
  | { kind: 'duplicate-faction-key'; faction: string }
  | { kind: 'missing-faction'; unit: string }
  | { kind: 'split-territory-faction'; territory: string; factions: string[] }
  | { kind: 'conflicting-group-name'; faction: string }
  | { kind: 'missing-faction-name'; faction: string }
  | { kind: 'faction-without-territory'; faction: string }
  | { kind: 'too-many-factions'; cap: number; count: number };

/**
 * FR-597: gives every land territory exactly one faction: that of its land units, each taken from its `units` entry
 * when it has one, else from the `factionBy` property (`missing-faction` for a land unit with none;
 * `split-territory-faction` when the units of one territory disagree). The factions are the curation's `factions` list
 * (its names checked as `invalid-name`, its colors as `invalid-color`, a repeated key `duplicate-faction-key`) followed
 * by every other used key in code-unit order, named by the `nameProperty` of the units that got the key from the rule
 * (`conflicting-group-name` when they differ, `missing-faction-name` when nothing names it). A listed faction no land
 * territory uses is `faction-without-territory`; more than 9,999 factions is `too-many-factions`; every faction key the
 * curation names or the rule generates outside 1 to 256 code units is `invalid-key`. Errors come back collected, once
 * per distinct data, in the FR-599 order. Pure.
 */
export function groupFactions(territories: readonly Territory[], curation: Curation): Result<FactionPlan, FactionError> {
  const errors = new ErrorCollector<FactionError>();
  const plan = formFactions(territories, curation, errors);
  return errors.size > 0 ? { ok: false, errors: errors.list() } : { ok: true, value: plan };
}

/** FR-597: the plan of `groupFactions`, whatever the errors. */
export function formFactions(territories: readonly Territory[], curation: Curation, errors: ErrorSink<FactionError>): FactionPlan {
  const checkKey = (key: string): void => {
    if (!isKeyLength(key)) errors.add({ kind: 'invalid-key', faction: key });
  };
  const listed = new Map<string, Faction>();
  curation.factions.forEach((entry, i) => {
    checkKey(entry.key);
    if (!isValidName(entry.name)) errors.add({ kind: 'invalid-name', path: `factions[${i}].name` });
    if (entry.color !== undefined && !isValidColor(entry.color)) errors.add({ kind: 'invalid-color', path: `factions[${i}].color` });
    if (listed.has(entry.key)) errors.add({ kind: 'duplicate-faction-key', faction: entry.key });
    else listed.set(entry.key, entry.color === undefined ? { key: entry.key, name: entry.name } : { key: entry.key, name: entry.name, color: entry.color });
  });
  for (const entry of curation.units.values()) if (entry.faction !== undefined) checkKey(entry.faction);

  const rule = curation.factionBy;
  const factionOf = new Map<string, string>();
  const used = new Set<string>();
  /** The units that got each faction key from the rule. */
  const byRule = new Map<string, Unit[]>();
  for (const territory of territories) {
    if (territory.kind !== 'land') continue;
    const keys = new Set<string>();
    for (const unit of territory.units) {
      // a sea unit of a mixed territory is asked for nothing: the territory fails mixed-territory-kind already
      if (unit.kind === 'sea') continue;
      let key: string | undefined;
      if (unit.faction !== undefined) key = unit.faction;
      else if (rule !== undefined) {
        const value = unitValue(unit, rule.property);
        if (value !== undefined) {
          key = usableText(value);
          checkKey(key);
          const group = byRule.get(key);
          if (group === undefined) byRule.set(key, [unit]);
          else group.push(unit);
        }
      }
      if (key === undefined) errors.add({ kind: 'missing-faction', unit: unit.key });
      else keys.add(key);
    }
    if (keys.size > 1) errors.add({ kind: 'split-territory-faction', territory: territory.key, factions: [...keys].sort(compareCodeUnits) });
    else if (keys.size === 1) {
      const key = [...keys][0]!;
      factionOf.set(territory.key, key);
      used.add(key);
    }
  }

  for (const key of listed.keys()) if (!used.has(key)) errors.add({ kind: 'faction-without-territory', faction: key });

  const factions: Faction[] = [...listed.values()];
  for (const key of [...used].filter((k) => !listed.has(k)).sort(compareCodeUnits)) {
    const property = rule?.nameProperty;
    const units = byRule.get(key) ?? [];
    const shared = property !== undefined && units.length > 0 ? sharedValue(units, property) : { conflict: false, value: undefined };
    if (shared.conflict) errors.add({ kind: 'conflicting-group-name', faction: key });
    else if (shared.value === undefined) errors.add({ kind: 'missing-faction-name', faction: key });
    else factions.push({ key, name: shared.value });
  }
  if (factions.length > MAX_FACTIONS) errors.add({ kind: 'too-many-factions', cap: MAX_FACTIONS, count: factions.length });
  return { factions, factionOf };
}
