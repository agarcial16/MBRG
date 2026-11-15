// Faction names (spec 012 FR-453, FR-454): read from the public presentation file of the map; a faction without a name is
// shown by its number. Pure.
import { STRINGS, fill } from './strings';
import type { Named } from './text';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** The factions of a presentation file; entries that are not a whole id with a text name are dropped. */
export function readFactionNames(input: unknown): Named[] {
  if (!isObject(input) || !hasOwn(input, 'factions') || !Array.isArray(input.factions)) return [];
  const out: Named[] = [];
  for (const entry of input.factions as unknown[]) {
    if (!isObject(entry) || !hasOwn(entry, 'id') || !hasOwn(entry, 'name')) continue;
    const { id, name } = entry;
    if (typeof id === 'number' && Number.isSafeInteger(id) && id >= 1 && typeof name === 'string' && name.trim() !== '') out.push({ id, name });
  }
  return out;
}

export interface NameBook {
  nameOf(id: number): string;
  /** The named candidates for these ids, in the order given. */
  named(ids: readonly number[]): Named[];
}

export function nameBook(factions: readonly Named[]): NameBook {
  const byId = new Map(factions.map((f) => [f.id, f.name]));
  const nameOf = (id: number): string => byId.get(id) ?? fill(STRINGS.factionFallback, { id });
  return { nameOf, named: (ids) => ids.map((id) => ({ id, name: nameOf(id) })) };
}
