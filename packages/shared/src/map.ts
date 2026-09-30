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
  /** Outer ring of the territory polygon. At least 3 points, no repeated last point. */
  polygon: Coord[];
  /** Optional inner rings (enclaves / lakes). */
  holes?: Coord[][];
  /** Label position; defaults to the average of the polygon vertices. */
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
