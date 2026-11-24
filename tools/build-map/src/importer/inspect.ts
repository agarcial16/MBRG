import { own } from '../core/errors';
import { formatJson } from '../core/json';
import type { ReadSource } from './types';

/** FR-591: the value types a property can show, in the fixed order they are listed. */
export const VALUE_TYPES = ['string', 'integer', 'number', 'boolean', 'null', 'object', 'array'] as const;
type ValueType = (typeof VALUE_TYPES)[number];

/** FR-591: how many distinct values a property line shows. */
const FIRST_VALUES = 5;

/** FR-592, FR-600: the development parameters the draft starts from (003b dev map). */
export const DRAFT_PARAMS = { side: 2048, margin: 0.02, minPieceSize: 40, projection: 'laea' } as const;

function typeOf(value: unknown): ValueType {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return Number.isSafeInteger(value) ? 'integer' : 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : 'object';
}

/** A usable value (FR-593): a text, or an integer read as its shortest decimal text; anything else is not usable. */
function usableText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : undefined;
}

/** What is counted for one property over the features that have it. */
interface PropertyStats {
  features: number;
  types: Set<ValueType>;
  /** Usable values by their text; the first one seen keeps its original form for display. */
  distinct: Map<string, unknown>;
  usable: number;
}

const range = (low: number, high: number): string => `${low} to ${high}`;

/**
 * FR-591: the deterministic summary of a source and the draft curation. The summary has English labels: the
 * feature count (features with a geometry), the skipped null geometries, the positions, the longitude and
 * latitude range, and for each property in order of first appearance the number of features having it, the value
 * types seen, the number of distinct usable values, whether those values are unique over the features (a key
 * candidate) and the first 5 distinct ones. `primary` is the text written to the draft's `primary` member (the
 * path from the draft to the source, decided by the caller). Pure.
 */
export function inspectSource(source: ReadSource, primary: string): { summary: string; draft: Uint8Array } {
  const stats = new Map<string, PropertyStats>();
  for (const feature of source.features) {
    for (const name of Object.keys(feature.props)) {
      const value = own(feature.props, name);
      let entry = stats.get(name);
      if (entry === undefined) {
        entry = { features: 0, types: new Set(), distinct: new Map(), usable: 0 };
        stats.set(name, entry);
      }
      entry.features++;
      entry.types.add(typeOf(value));
      const text = usableText(value);
      if (text !== undefined) {
        entry.usable++;
        if (!entry.distinct.has(text)) entry.distinct.set(text, value);
      }
    }
  }

  const lines: string[] = [
    `features: ${source.features.length}`,
    `skippedNullGeometries: ${source.skippedNull}`,
    `positions: ${source.positions}`,
    `longitude: ${source.extent === null ? 'none' : range(source.extent.west, source.extent.east)}`,
    `latitude: ${source.extent === null ? 'none' : range(source.extent.south, source.extent.north)}`,
    `properties: ${stats.size}`,
  ];
  for (const [name, entry] of stats) {
    const first = [...entry.distinct.values()].slice(0, FIRST_VALUES).map((v) => JSON.stringify(v));
    lines.push(
      `property: ${JSON.stringify(name)}`,
      `  features: ${entry.features}`,
      `  types: ${VALUE_TYPES.filter((t) => entry.types.has(t)).join(', ')}`,
      `  distinctValues: ${entry.distinct.size}`,
      `  unique: ${entry.usable > 0 && entry.usable === entry.distinct.size ? 'yes' : 'no'}`,
      `  firstValues: ${first.length === 0 ? 'none' : first.join(', ')}`,
    );
  }

  // Every member of the schema, in the order of the spec; the empty key and name list make an unedited draft fail.
  const draft = formatJson({
    primary,
    context: [],
    columns: { key: '', name: [] },
    select: [],
    exclude: [],
    params: { ...DRAFT_PARAMS },
    units: {},
    territoryBy: { property: '' },
    territoryNames: {},
    factions: [],
    factionBy: { property: '' },
    seas: [],
    insets: [],
  });
  return { summary: lines.join('\n') + '\n', draft };
}
