/**
 * Shared edge-topology helpers: the renderer strokes borders segment by
 * segment, and the label layout needs the very same notion of "which
 * territories share this segment" — one canonical key, no duplicated logic.
 */

/** Canonical key for a segment so both neighbor polygons produce the same key. */
export function edgeKey(p1: readonly number[], p2: readonly number[]): string {
  const a = `${p1[0]},${p1[1]}`;
  const b = `${p2[0]},${p2[1]}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
