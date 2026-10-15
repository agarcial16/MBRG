import type { SourceFeature, SourcePolygon } from './types';

type Point = [number, number];

/**
 * FR-115 rules 4 and 5, on SOURCE coordinates. Consecutive equal vertices count as one (also the
 * closing duplicate of a closed ring); the result is an open ring. Returns null when the ring is
 * ignored: fewer than three distinct vertices, or a shoelace area of exactly zero.
 */
export function normalizeRing(coords: readonly Point[]): Point[] | null {
  const out: Point[] = [];
  for (const p of coords) {
    const last = out[out.length - 1];
    if (last !== undefined && last[0] === p[0] && last[1] === p[1]) continue;
    out.push([p[0], p[1]]);
  }
  if (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (first[0] === last[0] && first[1] === last[1]) out.pop();
  }
  const distinct = new Set(out.map((p) => `${p[0]},${p[1]}`));
  if (distinct.size < 3) return null;
  let twice = 0;
  for (let i = 0; i < out.length; i++) {
    const a = out[i]!;
    const b = out[(i + 1) % out.length]!;
    twice += a[0] * b[1] - b[0] * a[1];
  }
  if (twice === 0) return null;
  return out;
}

/**
 * FR-115 rule 5: a polygon whose outer ring is ignored contains nothing (null); an ignored
 * hole removes nothing (dropped).
 */
export function normalizePolygon(polygon: SourcePolygon): SourcePolygon | null {
  const outer = normalizeRing(polygon.outer.coords);
  if (outer === null) return null;
  const holes: { coords: Point[] }[] = [];
  for (const hole of polygon.holes) {
    const h = normalizeRing(hole.coords);
    if (h !== null) holes.push({ coords: h });
  }
  return { outer: { coords: outer }, holes };
}

/**
 * Normalize the polygons of the features (source coordinates), then map every vertex with
 * `toUV` (projection then pixel space). Edges stay straight segments between mapped vertices.
 */
export function toPixelPolygons(
  features: readonly SourceFeature[],
  toUV: (lon: number, lat: number) => Point,
): SourcePolygon[] {
  const out: SourcePolygon[] = [];
  for (const feature of features) {
    for (const polygon of feature.polygons) {
      const n = normalizePolygon(polygon);
      if (n === null) continue;
      out.push({
        outer: { coords: n.outer.coords.map(([a, b]) => toUV(a, b)) },
        holes: n.holes.map((h) => ({ coords: h.coords.map(([a, b]) => toUV(a, b)) })),
      });
    }
  }
  return out;
}
