import { own, presentText } from './errors';
import type { BuiltPresentation, CountryRecord, NumberedPlan, SourceFeature } from './types';

/** First present name among the given fields of a record, taken exactly as given (FR-121). */
function firstPresent(record: object | undefined, fields: readonly string[]): string | undefined {
  if (record === undefined) return undefined;
  for (const field of fields) {
    const name = presentText(record, field);
    if (name !== undefined) return name;
  }
  return undefined;
}

/**
 * FR-121: the presentation data in faction order and map order. Names are taken as given: never
 * trimmed, normalized or replaced by another source because a present name is invalid (FR-122
 * reports that). An entry with no present name gets no `name` field. Colours only from the table.
 */
export function buildPresentation(
  plan: NumberedPlan,
  countries: readonly CountryRecord[],
  provinces: readonly SourceFeature[],
): BuiltPresentation {
  const records = new Map<string, CountryRecord>();
  for (const record of countries) {
    const code = own(record, 'adm0_a3');
    if (typeof code === 'string' && !records.has(code)) records.set(code, record);
  }
  const propsByCode = new Map<string, Record<string, unknown>>();
  for (const feature of provinces) {
    const code = own(feature.props, 'adm1_code');
    if (typeof code === 'string' && !propsByCode.has(code)) propsByCode.set(code, feature.props);
  }

  const factions = plan.factions.map((f) => {
    const out: BuiltPresentation['factions'][number] = { id: f.id };
    const name = firstPresent(records.get(f.country), ['name_es', 'name']);
    if (name !== undefined) out.name = name;
    if (f.color !== undefined) out.color = f.color;
    return out;
  });

  const territories: BuiltPresentation['territories'] = [];
  for (const t of plan.land) {
    const out: BuiltPresentation['territories'][number] = { id: t.id };
    const tableName = typeof t.name === 'string' && t.name !== '' ? t.name : undefined;
    const name =
      tableName ??
      (t.provinces.length === 1 ? firstPresent(propsByCode.get(t.provinces[0] as string), ['name_es', 'name']) : undefined);
    if (name !== undefined) out.name = name;
    territories.push(out);
  }
  for (const s of plan.sea) {
    const out: BuiltPresentation['territories'][number] = { id: s.id };
    if (s.name !== '') out.name = s.name;
    territories.push(out);
  }
  return { factions, territories };
}
