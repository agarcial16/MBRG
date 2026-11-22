import type { Result } from '@mbrg/shared';
import type { Curation, Filter, Usable } from './curation';
import type { Extent } from './types';
import { unitValue, type Unit } from './units';

/** FR-594: the errors of selecting units. */
export type SelectError = { kind: 'unknown-unit'; unit: string } | { kind: 'empty-selection' };

/** FR-594: the selected units, and every other unit of the primary source (other land, drawn as background). */
export interface Selection {
  selected: Unit[];
  /** Unselected and excluded units, in unit order. */
  other: Unit[];
}

/** The longitude and latitude range of every ring of every polygon of a unit; null when it has no position. */
export function unitExtent(unit: Unit): Extent | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const widen = (coords: readonly (readonly [number, number])[]): void => {
    for (const [lon, lat] of coords) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  };
  for (const polygon of unit.polygons) {
    widen(polygon.outer.coords);
    for (const hole of polygon.holes) widen(hole.coords);
  }
  return west > east ? null : { west, south, east, north };
}

/** `a` against `b` of the same kind: two integers as numbers, two texts by code units; any other pair never compares. */
function compare(a: Usable, b: Usable): number | undefined {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return undefined;
}

/** FR-594: whether a unit matches one filter (an absent value never matches). */
export function matchesFilter(unit: Unit, filter: Filter): boolean {
  if ('bbox' in filter) {
    const extent = unitExtent(unit);
    if (extent === null) return false;
    const [west, south, east, north] = filter.bbox;
    return filter.mode === 'within'
      ? extent.west >= west && extent.east <= east && extent.south >= south && extent.north <= north
      : extent.west <= east && extent.east >= west && extent.south <= north && extent.north >= south;
  }
  const value = unitValue(unit, filter.property);
  if (value === undefined) return false;
  if ('eq' in filter) return compare(value, filter.eq) === 0;
  if ('in' in filter) return filter.in.some((v) => compare(value, v) === 0);
  if ('gte' in filter) {
    const c = compare(value, filter.gte);
    return c !== undefined && c >= 0;
  }
  const c = compare(value, filter.lte);
  return c !== undefined && c <= 0;
}

/**
 * FR-594: the units that match every filter of `select` (all units when it is empty) and are neither in `exclude`
 * nor of kind `exclude`. An `exclude` entry or a `units` key that names no unit is `unknown-unit` (once per key);
 * nothing selected is `empty-selection`. Pure.
 */
export function selectUnits(units: readonly Unit[], curation: Curation): Result<Selection, SelectError> {
  const parted = partitionUnits(units, curation);
  return parted.errors.length > 0 ? { ok: false, errors: parted.errors } : { ok: true, value: parted.selection };
}

/** FR-594: the selection of `selectUnits` and its errors together (the curation stage goes on with the units it has). */
export function partitionUnits(units: readonly Unit[], curation: Curation): { selection: Selection; errors: SelectError[] } {
  const known = new Set(units.map((u) => u.key));
  const errors: SelectError[] = [];
  const unknown = new Set<string>();
  for (const key of [...curation.exclude, ...curation.units.keys()]) {
    if (!known.has(key) && !unknown.has(key)) {
      unknown.add(key);
      errors.push({ kind: 'unknown-unit', unit: key });
    }
  }
  const excluded = new Set(curation.exclude);
  const selected: Unit[] = [];
  const other: Unit[] = [];
  for (const unit of units) {
    const keep = unit.kind !== 'exclude' && !excluded.has(unit.key) && curation.select.every((f) => matchesFilter(unit, f));
    (keep ? selected : other).push(unit);
  }
  if (selected.length === 0) errors.push({ kind: 'empty-selection' });
  return { selection: { selected, other }, errors };
}
