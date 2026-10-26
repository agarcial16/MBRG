import { GROUPING_KIND_ORDER, compareCodeUnits, own, presentText } from './errors';
import type { CountryRecord, GroupingError, GroupingTable, SourceFeature } from './types';

/** First and second data field of an error: the sort keys inside a kind (FR-113). */
function dataFields(e: GroupingError): [string, string] {
  switch (e.kind) {
    case 'duplicate-country':
    case 'unknown-country':
    case 'empty-country':
      return [e.country, ''];
    case 'unknown-province':
    case 'duplicate-province-assignment':
    case 'unassigned-province':
      return [e.province, ''];
    case 'province-country-mismatch':
      return [e.province, e.territory];
    default:
      return [e.territory, ''];
  }
}

function count(values: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}

/**
 * FR-113: every problem of the grouping table, none blocking the others. One error per distinct
 * data, ordered by kind in table order, then by the code-unit order of the first and second data field.
 */
export function checkGrouping(
  table: GroupingTable,
  provinces: readonly SourceFeature[],
  countries: readonly CountryRecord[],
): GroupingError[] {
  const found = new Map<string, GroupingError>();
  const add = (e: GroupingError): void => {
    const [a, b] = dataFields(e);
    const key = JSON.stringify([e.kind, a, b]);
    if (!found.has(key)) found.set(key, e);
  };

  const selected = new Set(table.countries.map((c) => c.country));
  const recordCodes = new Set<string>();
  for (const record of countries) {
    const code = own(record, 'adm0_a3');
    if (typeof code === 'string') recordCodes.add(code);
  }

  // Source provinces of selected countries: province code -> country code.
  const sourceCountry = new Map<string, string>();
  for (const feature of provinces) {
    const code = own(feature.props, 'adm1_code');
    const country = own(feature.props, 'adm0_a3');
    if (typeof code === 'string' && typeof country === 'string' && selected.has(country) && !sourceCountry.has(code)) {
      sourceCountry.set(code, country);
    }
  }

  for (const [country, n] of count(table.countries.map((c) => c.country))) {
    if (n > 1) add({ kind: 'duplicate-country', country });
  }
  for (const country of selected) {
    if (!recordCodes.has(country)) add({ kind: 'unknown-country', country });
  }
  for (const [territory, n] of count(table.territories.map((t) => t.key))) {
    if (n > 1) add({ kind: 'duplicate-territory-key', territory });
  }

  const validCountry = (t: GroupingTable['territories'][number]): t is { country: string } & typeof t =>
    t.country !== undefined && selected.has(t.country);
  for (const t of table.territories) {
    const territory = t.key;
    if (!validCountry(t)) add({ kind: 'invalid-territory-country', territory });
    if (t.color !== undefined && t.color !== null) add({ kind: 'territory-color', territory });
    if (t.provinces.length === 0) add({ kind: 'empty-territory', territory });
    if (t.provinces.length >= 2 && presentText(t, 'name') === undefined) {
      add({ kind: 'missing-territory-name', territory });
    }
  }

  const listed = count([...table.territories.flatMap((t) => t.provinces), ...table.excluded]);
  for (const [province, n] of listed) {
    if (!sourceCountry.has(province)) add({ kind: 'unknown-province', province });
    else if (n > 1) add({ kind: 'duplicate-province-assignment', province });
  }

  for (const t of table.territories) {
    if (!validCountry(t)) continue;
    for (const province of t.provinces) {
      const country = sourceCountry.get(province);
      if (country !== undefined && country !== t.country) {
        add({ kind: 'province-country-mismatch', province, territory: t.key });
      }
    }
  }

  for (const province of sourceCountry.keys()) {
    if (!listed.has(province)) add({ kind: 'unassigned-province', province });
  }

  const excluded = new Set(table.excluded);
  const populated = new Set<string>();
  for (const [province, country] of sourceCountry) {
    if (!excluded.has(province)) populated.add(country);
  }
  for (const country of selected) {
    if (!populated.has(country)) add({ kind: 'empty-country', country });
  }

  const rank = new Map(GROUPING_KIND_ORDER.map((kind, i) => [kind, i]));
  return [...found.values()].sort((x, y) => {
    const byKind = (rank.get(x.kind) as number) - (rank.get(y.kind) as number);
    if (byKind !== 0) return byKind;
    const [x1, x2] = dataFields(x);
    const [y1, y2] = dataFields(y);
    return compareCodeUnits(x1, y1) || compareCodeUnits(x2, y2);
  });
}
