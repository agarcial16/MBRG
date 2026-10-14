import type { MapData, MapEntry } from '@mbrg/shared';

/** One entry of a sea fixture: a land territory with its owner, or a sea zone (no owner). */
export type SeaSpec = { id: number; owner: number } | { id: number; sea: true };

/**
 * Builds a map from land/sea entries and mutual links (both sides list each other).
 * `oneWay` pairs are listed on the first entry only (a link the second entry does not confirm).
 */
export function seaMapFrom(specs: SeaSpec[], links: [number, number][], oneWay: [number, number][] = []): MapData {
  const entries = specs.map((s): MapEntry => {
    const neighbors: number[] = [];
    return 'sea' in s ? { id: s.id, neighbors, kind: 'sea' } : { id: s.id, owner: s.owner, neighbors };
  });
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const [a, b] of links) {
    byId.get(a)!.neighbors.push(b);
    byId.get(b)!.neighbors.push(a);
  }
  for (const [a, b] of oneWay) byId.get(a)!.neighbors.push(b);
  return { territories: entries };
}

export const land = (id: number, owner: number): SeaSpec => ({ id, owner });
export const sea = (id: number): SeaSpec => ({ id, sea: true });
