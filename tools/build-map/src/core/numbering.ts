import { compareCodeUnits } from './errors';
import type { GroupingTable, NumberedLand, NumberedPlan, SeaSeed } from './types';

/**
 * FR-119, FR-120: one faction per selected country (code-unit order of the code, ids 1..K); land
 * territories grouped by faction and, inside a faction, by key in code-unit order (ids 1..L); sea
 * zones after them in the order of the seeds (ids L+1..). Expects a table that passed checkGrouping.
 */
export function numberEntries(table: GroupingTable, seeds: readonly SeaSeed[]): NumberedPlan {
  const byCode = new Map<string, { country: string; color?: string }>();
  for (const c of table.countries) if (!byCode.has(c.country)) byCode.set(c.country, c);
  const codes = [...byCode.keys()].sort(compareCodeUnits);

  const factions = codes.map((country, i) => {
    const color = byCode.get(country)?.color;
    return color === undefined ? { id: i + 1, country } : { id: i + 1, country, color };
  });

  const land: NumberedLand[] = [];
  for (const faction of factions) {
    const own = table.territories
      .filter((t) => t.country === faction.country)
      .sort((a, b) => compareCodeUnits(a.key, b.key));
    for (const t of own) {
      const entry: NumberedLand = {
        id: land.length + 1,
        key: t.key,
        country: faction.country,
        owner: faction.id,
        provinces: [...t.provinces],
      };
      if (Object.hasOwn(t, 'name')) entry.name = t.name;
      land.push(entry);
    }
  }

  const sea = seeds.map((seed, i) => ({ id: land.length + i + 1, seed: i, name: seed.name }));
  return { factions, land, sea };
}
