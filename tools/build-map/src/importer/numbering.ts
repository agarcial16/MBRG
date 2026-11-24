import { compareCodeUnits } from '../core/errors';
import type { BuiltPresentation, NumberedPlan } from '../core/types';
import type { SeaEntry } from './curation';
import type { Faction, Territory } from './grouping';
import type { PieceEntry } from '../core/pieces';

/** One numbered land territory. */
export interface NumberedLandTerritory {
  id: number;
  territory: Territory;
  /** The faction id (1..K) that owns it. */
  owner: number;
}

/** One numbered sea zone: a sea territory, or a seed of the curation. */
export interface NumberedSeaZone {
  id: number;
  /** The name of the zone, exactly as the curation or the source gave it (absent only for a nameless sea territory). */
  name: string | undefined;
  /** The sea territory, absent for a seed zone. */
  territory?: Territory;
  /** The position in the seed list, absent for a sea territory. */
  seed?: number;
}

/** FR-605: the ids of the whole map and the values built from them. */
export interface ImportNumbering {
  /** The factions with their ids 1..K, in faction order. */
  factions: { id: number; key: string; name: string; color?: string }[];
  /** The land territories with ids 1..L, grouped by faction. */
  land: NumberedLandTerritory[];
  /** The sea zones with ids L+1.., sea territories before seeds. */
  sea: NumberedSeaZone[];
  /** The plan `buildMapData` reads (003b, unchanged): faction ids, land ids and owners, sea ids. */
  plan: NumberedPlan;
  /** The entries in map order for the piece cleanup. */
  pieceEntries: PieceEntry[];
  /** The presentation values: faction names and colors and the name of every entry, as given. */
  presentation: BuiltPresentation;
}

/** What the numbering takes from the curation stage. */
export interface NumberingInput {
  territories: readonly Territory[];
  factions: readonly Faction[];
  /** The faction key of each land territory, by territory key. */
  factionOf: ReadonlyMap<string, string>;
  seas: readonly SeaEntry[];
}

/**
 * FR-605: numbers the map. Factions 1..K in faction order (the curation's list, then the other keys in code-unit
 * order); land territories 1..L grouped by faction in faction order and, inside a faction, in code-unit order of
 * territory key; then the sea zones: sea territories in code-unit order of key, then the seeds in list order. The
 * plan is the one `buildMapData` takes (neighbours ascending in map order, links only from pixel contact, no link
 * field anywhere); the presentation values hold every name exactly as given, never trimmed or normalised. Pure.
 */
export function numberMap(input: NumberingInput): ImportNumbering {
  const factions = input.factions.map((faction, i) => (faction.color === undefined ? { id: i + 1, key: faction.key, name: faction.name } : { id: i + 1, key: faction.key, name: faction.name, color: faction.color }));
  const land: NumberedLandTerritory[] = [];
  for (const faction of factions) {
    const own = input.territories
      .filter((t) => t.kind === 'land' && input.factionOf.get(t.key) === faction.key)
      .sort((a, b) => compareCodeUnits(a.key, b.key));
    for (const territory of own) land.push({ id: land.length + 1, territory, owner: faction.id });
  }
  const sea: NumberedSeaZone[] = [];
  const seaTerritories = input.territories.filter((t) => t.kind === 'sea').sort((a, b) => compareCodeUnits(a.key, b.key));
  for (const territory of seaTerritories) sea.push({ id: land.length + sea.length + 1, name: territory.name, territory });
  input.seas.forEach((seed, i) => sea.push({ id: land.length + sea.length + 1, name: seed.name, seed: i }));

  const plan: NumberedPlan = {
    factions: factions.map((f) => (f.color === undefined ? { id: f.id, country: f.key } : { id: f.id, country: f.key, color: f.color })),
    land: land.map((l) => ({
      id: l.id,
      key: l.territory.key,
      country: factions[l.owner - 1]!.key,
      owner: l.owner,
      provinces: l.territory.units.map((u) => u.key),
      ...(l.territory.name === undefined ? {} : { name: l.territory.name }),
    })),
    sea: sea.map((s) => ({ id: s.id, seed: s.seed ?? -1, name: s.name ?? '' })),
  };
  const pieceEntries: PieceEntry[] = [
    ...land.map((l): PieceEntry => ({ id: l.id, kind: 'land', owner: l.owner })),
    ...sea.map((s): PieceEntry => ({ id: s.id, kind: 'sea' })),
  ];
  const presentation: BuiltPresentation = {
    factions: factions.map((f) => (f.color === undefined ? { id: f.id, name: f.name } : { id: f.id, name: f.name, color: f.color })),
    territories: [
      ...land.map((l) => (l.territory.name === undefined ? { id: l.id } : { id: l.id, name: l.territory.name })),
      ...sea.map((s) => (s.name === undefined ? { id: s.id } : { id: s.id, name: s.name })),
    ],
  };
  return { factions, land, sea, plan, pieceEntries, presentation };
}
