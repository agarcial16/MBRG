/** Territory identifier: integer 1..16,777,215 (FR-3). */
export type TerritoryId = number;
/** Faction identifier: same rule as territory ids, separate namespace (FR-8). */
export type FactionId = number;

/** FR-2 */
export interface Territory {
  id: TerritoryId;
  owner: FactionId;
  neighbors: TerritoryId[];
}

/** FR-1 */
export interface MapData {
  territories: Territory[];
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; errors: E[] };
