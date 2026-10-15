import { contactPairs, type MapData, type MapEntry } from '@mbrg/shared';
import type { NumberedPlan } from './types';

/**
 * FR-118: the map data derived from the final pixel assignment. Every link is a pair of
 * 4-adjacent pixels with different non-zero values (003a FR-108, reused as it is); no link is
 * added or removed by hand. Entries are in map order (land territories, then sea zones, ids
 * ascending) and each neighbour list is ascending. Pure (NFR-14).
 */
export function buildMapData(width: number, pixels: Uint32Array, plan: NumberedPlan): MapData {
  const pairs = contactPairs(width, width, pixels);
  if (!pairs.ok) throw new Error('the id image is not a valid image: ' + pairs.errors[0]!.kind);
  const neighbors = new Map<number, number[]>();
  const entries: MapEntry[] = [];
  for (const land of plan.land) {
    const list: number[] = [];
    neighbors.set(land.id, list);
    entries.push({ id: land.id, owner: land.owner, neighbors: list });
  }
  for (const sea of plan.sea) {
    const list: number[] = [];
    neighbors.set(sea.id, list);
    entries.push({ id: sea.id, kind: 'sea', neighbors: list });
  }
  for (const [a, b] of pairs.value) {
    neighbors.get(a)?.push(b);
    neighbors.get(b)?.push(a);
  }
  for (const list of neighbors.values()) list.sort((x, y) => x - y);
  return { territories: entries };
}
