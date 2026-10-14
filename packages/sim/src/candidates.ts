// Internal absorption candidates (FR-81). Not re-exported from index.ts.
import { isSeaZone } from '@mbrg/shared';
import type { FactionId, MapData, MapEntry } from '@mbrg/shared';
import { livingFactions } from './internal';
import type { MatchState } from './types';

/** FR-81: the absorption candidates of a faction and how they were found. */
export type Candidates =
  | { how: 'direct'; factions: FactionId[] }
  | { how: 'widened'; distance: number; factions: FactionId[] }
  | { how: 'none'; factions: [] };

/**
 * FR-75, FR-76, FR-81 (direct part): the land-neighbor factions of `faction` and the living
 * factions sharing a sea zone with it, as one set, each faction once, in faction order of the
 * current state; if that group is empty, widens through the sea (FR-77, FR-78). Takes no RNG. Requires `faction` to be living in `state`.
 */
export function absorptionCandidates(map: MapData, state: MatchState, faction: FactionId): Candidates {
  const living = livingFactions(state);
  if (!living.includes(faction)) throw new Error('absorptionCandidates needs a living faction');

  const ownerById = new Map(state.owners);
  const entryById = new Map(map.territories.map((t) => [t.id, t]));
  const linked = (a: MapEntry, b: MapEntry): boolean =>
    a.id !== b.id && a.neighbors.includes(b.id) && b.neighbors.includes(a.id);

  const found = new Set<FactionId>();
  const coast = new Set<MapEntry>();
  for (const t of map.territories) {
    if (isSeaZone(t) || ownerById.get(t.id) !== faction) continue;
    for (const n of t.neighbors) {
      const m = entryById.get(n);
      if (m === undefined || !linked(t, m)) continue;
      if (isSeaZone(m)) coast.add(m);
      else {
        const owner = ownerById.get(m.id);
        if (owner !== undefined && owner !== faction) found.add(owner);
      }
    }
  }
  // Land factions (not `faction`) that touch the sea zone `z` through a mutual link.
  const touchers = (z: MapEntry): void => {
    for (const n of z.neighbors) {
      const m = entryById.get(n);
      if (m === undefined || isSeaZone(m) || !linked(z, m)) continue;
      const owner = ownerById.get(m.id);
      if (owner !== undefined && owner !== faction) found.add(owner);
    }
  };
  const order = (): FactionId[] => living.filter((f) => found.has(f));

  for (const z of coast) touchers(z);
  if (found.size > 0) return { how: 'direct', factions: order() };

  // FR-77: widen one sea hop at a time, every zone at the next distance in one step.
  const visited = new Set<number>([...coast].map((z) => z.id));
  let frontier = [...coast];
  for (let distance = 1; ; distance++) {
    const next = new Map<number, MapEntry>();
    for (const z of frontier) {
      for (const n of z.neighbors) {
        const m = entryById.get(n);
        if (m === undefined || !isSeaZone(m) || visited.has(m.id) || !linked(z, m)) continue;
        visited.add(m.id);
        next.set(m.id, m);
      }
    }
    // FR-78: nothing left to add.
    if (next.size === 0) return { how: 'none', factions: [] };
    for (const z of next.values()) touchers(z);
    if (found.size > 0) return { how: 'widened', distance, factions: order() };
    frontier = [...next.values()];
  }
}
