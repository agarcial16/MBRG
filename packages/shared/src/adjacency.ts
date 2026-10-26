import type { MapFormatV1 } from './map.js';

/**
 * Union of land + sea connections per territory, sorted for determinism.
 * Self-references are dropped. Used by the sim and (later) the importer/UI.
 */
export function buildAdjacency(map: MapFormatV1): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const t of map.territories) {
    const union = new Set<string>([...(t.neighbors ?? []), ...(t.seaLinks ?? [])]);
    union.delete(t.id);
    result.set(t.id, [...union].sort());
  }
  return result;
}
