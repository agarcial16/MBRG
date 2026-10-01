/** A single map point in map coordinates. */
export type Coord = [number, number];

/**
 * A province/territory of the map.
 *
 * Exactly one faction starts per territory (faction id = territory id).
 * Colors are intentionally NOT part of the format: colors are only used while
 * *detecting* regions during import, and the engine assigns display colors
 * per match.
 */
export interface Territory {
  /** Unique, stable id (referenced by save files / match JSON). */
  id: string;
  /** Display name; defaults to `id`. */
  name?: string;
  /** Land-bordering territory ids. MUST be symmetric (if a lists b, b lists a). */
  neighbors: string[];
  /** Maritime connections (cross-sea adjacency). MUST be symmetric. */
  seaLinks?: string[];
  /**
   * Outer rings of the territory, one per connected piece of land.
   *
   * More than one is not an oddity: an archipelago, a province with an enclave
   * cut off by a neighbour, or a country drawn as a mainland plus a few islands.
   * They are ONE province and are conquered together, which is the whole point —
   * splitting them into separate territories would let a faction be annexed
   * halfway, from wherever the enemy happened to be standing.
   *
   * Every ring needs at least 3 points and no repeated last point.
   */
  polygons: Coord[][];
  /** Optional inner rings (enclaves / lakes), each belonging to `polygons[i]`. */
  holes?: Coord[][];
  /** Label position; defaults to the largest ring's interior point. */
  center?: Coord;
}

/** Versioned map interchange format (v1). */
export interface MapFormatV1 {
  version: 1;
  name: string;
  /** Render hint for the viewport (map units). */
  width?: number;
  /** Render hint for the viewport (map units). */
  height?: number;
  territories: Territory[];
}

/** Shoelace area of a ring, unsigned. */
export function ringArea(ring: readonly Coord[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/**
 * The ring a territory should be labelled and measured by.
 *
 * The biggest one **by area**, not by vertex count: a small island traced from a
 * noisy coastline can easily have more vertices than the mainland, and picking by
 * count puts the label — and the centroid the engine uses — out at sea.
 */
export function mainRing(territory: Territory): Coord[] {
  let best = territory.polygons[0] ?? [];
  let bestArea = -1;
  for (const ring of territory.polygons) {
    const area = ringArea(ring);
    if (area > bestArea) {
      best = ring;
      bestArea = area;
    }
  }
  return best;
}
