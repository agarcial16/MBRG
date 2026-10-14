/** Territory identifier: integer 1..16,777,215 (FR-3). */
export type TerritoryId = number;
/** Faction identifier: same rule as territory ids, separate namespace (FR-8). */
export type FactionId = number;

/** FR-2, FR-57: a land territory. `kind` is optional and, when present, `'land'`. */
export interface LandTerritory {
  id: TerritoryId;
  owner: FactionId;
  neighbors: TerritoryId[];
  kind?: 'land';
}

/** FR-57: a sea zone. It has no owner and never appears in a match state. */
export interface SeaZone {
  id: TerritoryId;
  neighbors: TerritoryId[];
  kind: 'sea';
}

/** FR-57: one entry of the map. */
export type MapEntry = LandTerritory | SeaZone;

/** FR-58: result of the kind rule; `'invalid'` is any present `kind` other than land or sea. */
export type EntryKind = 'land' | 'sea' | 'invalid';

/** FR-1 */
export interface MapData {
  territories: MapEntry[];
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; errors: E[] };
