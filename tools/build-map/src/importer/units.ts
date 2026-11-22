import type { Result } from '@mbrg/shared';
import { own, presentText } from '../core/errors';
import type { SourcePolygon } from '../core/types';
import { usedProperties, type Curation, type Usable, type UnitEntry } from './curation';
import type { ImportFeature } from './types';

/** FR-593: one place of the primary source: all the features that share a key. */
export interface Unit {
  /** The usable value of `columns.key` as text. */
  key: string;
  /** The features of the unit, in file order. */
  features: ImportFeature[];
  /** Index of the first feature of the unit in the file. */
  firstFeature: number;
  /** The union of the polygons of its features, in feature order. */
  polygons: SourcePolygon[];
  /** The first present `columns.name` value on the first feature, exactly as given (FR-593). */
  sourceName: string | undefined;
  /** The name the unit goes on with: the per-unit layer's `name` when it has one, else the source name. */
  name: string | undefined;
  /** FR-595: `land` unless the layer says `sea` or `exclude`. */
  kind: 'land' | 'sea' | 'exclude';
  territory: string | undefined;
  faction: string | undefined;
  /** The unit's entry of the per-unit layer, when it has one. */
  layer: UnitEntry | undefined;
}

/** FR-593, FR-595: the errors of forming the units. */
export type UnitError =
  | { kind: 'missing-unit-key'; feature: number }
  | { kind: 'invalid-unit-key'; feature: number }
  | { kind: 'conflicting-unit-property'; unit: string; property: string }
  | { kind: 'sea-with-faction'; unit: string };

/** A usable value (FR-593): a text, or a safe integer; anything else is not usable. */
export function usableOf(value: unknown): Usable | undefined {
  if (typeof value === 'string') return value;
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

/** The usable value a unit has for a property: that of its first feature that has one (own-property rule). */
export function unitValue(unit: Unit, property: string): Usable | undefined {
  for (const feature of unit.features) {
    const value = usableOf(own(feature.props, property));
    if (value !== undefined) return value;
  }
  return undefined;
}

/** A value with its kind, so that the text 5 and the integer 5 are two values. */
const identity = (value: Usable): string => `${typeof value}:${String(value)}`;

/**
 * FR-593, FR-595: forms the units of the primary source. Each feature takes the usable value of `columns.key` as its
 * key (`missing-unit-key` when absent, `invalid-unit-key` when it is no usable value or is an empty text); one unit
 * per distinct key in order of first feature; a unit's name is the first present `columns.name` value on its first
 * feature, exactly as given. Two features of one unit with different values of a name column, or of any property a
 * filter or a rule uses, are `conflicting-unit-property`; a property some features lack is not compared there.
 * The per-unit layer is applied by key as text; a `sea` unit may not name a faction. Pure.
 */
export function buildUnits(features: readonly ImportFeature[], curation: Curation): Result<Unit[], UnitError> {
  const errors: UnitError[] = [];
  const byKey = new Map<string, Unit>();
  const key = curation.columns.key;
  for (const feature of features) {
    if (!Object.hasOwn(feature.props, key)) {
      errors.push({ kind: 'missing-unit-key', feature: feature.index });
      continue;
    }
    const usable = usableOf(own(feature.props, key));
    if (usable === undefined || usable === '') {
      errors.push({ kind: 'invalid-unit-key', feature: feature.index });
      continue;
    }
    const text = String(usable);
    let unit = byKey.get(text);
    if (unit === undefined) {
      const layer = curation.units.get(text);
      const sourceName = curation.columns.name.map((p) => presentText(feature.props, p)).find((n) => n !== undefined);
      unit = {
        key: text,
        features: [],
        firstFeature: feature.index,
        polygons: [],
        sourceName,
        name: layer?.name ?? sourceName,
        kind: layer?.kind ?? 'land',
        territory: layer?.territory,
        faction: layer?.faction,
        layer,
      };
      byKey.set(text, unit);
    }
    unit.features.push(feature);
    unit.polygons.push(...feature.polygons);
  }

  // Name columns are compared as present texts; every other property a filter or a rule uses, as usable values.
  const names = curation.columns.name;
  const others = usedProperties(curation).filter((p) => p !== key && !names.includes(p));
  for (const unit of byKey.values()) {
    const compare: [string, (value: unknown) => Usable | undefined][] = [
      ...names.map((p): [string, (value: unknown) => Usable | undefined] => [p, (v) => (typeof v === 'string' && v !== '' ? v : undefined)]),
      ...others.map((p): [string, (value: unknown) => Usable | undefined] => [p, usableOf]),
    ];
    for (const [property, read] of compare) {
      let first: Usable | undefined;
      for (const feature of unit.features) {
        const value = read(own(feature.props, property));
        if (value === undefined) continue;
        if (first === undefined) first = value;
        else if (identity(first) !== identity(value)) {
          errors.push({ kind: 'conflicting-unit-property', unit: unit.key, property });
          break;
        }
      }
    }
    if (unit.kind === 'sea' && unit.faction !== undefined) errors.push({ kind: 'sea-with-faction', unit: unit.key });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: [...byKey.values()] };
}
