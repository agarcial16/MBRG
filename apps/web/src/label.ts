import type { Coord, FactionId, MapFormatV1, Ownership, Territory } from '@mbrg/shared';

/**
 * A faction label anchored at the visual center of its *block* (all the
 * provinces the faction currently owns), so annexations never leave duplicated
 * or stale names behind.
 *
 * The geometry (size / orientation / span) adapts to the block's shape like
 * EU4 country names: sized from the block area, spread along its long axis and
 * rotated vertical when the block is a tall strip. Text measurement happens at
 * draw time (needs a canvas context), keeping this module pure.
 */
export interface FactionLabel {
  faction: FactionId;
  /** Text to draw (the faction id/name). */
  text: string;
  x: number;
  y: number;
  /** Base font size in world units (may be shrunk at draw time to fit `span`). */
  size: number;
  /** Rotation in radians: 0 (horizontal) or PI/2 (tall, narrow blocks). */
  angle: number;
  /** Target width of the text along its direction, in world units. */
  span: number;
}

/** Signed polygon area (shoelace); sign follows the winding order. */
function signedArea(poly: Coord[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

function vertexAverage(poly: Coord[]): Coord {
  let x = 0;
  let y = 0;
  for (const [px, py] of poly) {
    x += px;
    y += py;
  }
  const n = poly.length || 1;
  return [x / n, y / n];
}

/** Area centroid; vertex average for degenerate (zero-area) rings. */
function polygonCentroid(poly: Coord[]): Coord {
  let cross = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const c = x1 * y2 - x2 * y1;
    cross += c;
    cx += (x1 + x2) * c;
    cy += (y1 + y2) * c;
  }
  if (Math.abs(cross) < 1e-9) return vertexAverage(poly);
  return [cx / (3 * cross), cy / (3 * cross)];
}

/** Ray casting point-in-polygon test. */
function pointInPolygon(p: Coord, poly: Coord[]): boolean {
  const [x, y] = p;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A guaranteed-plausible label point for a single territory. */
function territoryAnchor(t: Territory): Coord {
  if (t.center) return t.center;
  const c = polygonCentroid(t.polygon);
  if (pointInPolygon(c, t.polygon)) return c;
  return vertexAverage(t.polygon);
}

/**
 * Visual center of a faction's block: the area-weighted centroid of its
 * provinces. Falls back to the largest province's anchor when the centroid
 * lands outside the (possibly concave) block.
 */
function blockAnchor(group: Territory[]): Coord {
  let weightSum = 0;
  let sx = 0;
  let sy = 0;
  let largest = group[0];
  let largestArea = -1;
  for (const t of group) {
    const area = Math.abs(signedArea(t.polygon));
    const c = polygonCentroid(t.polygon);
    weightSum += area;
    sx += c[0] * area;
    sy += c[1] * area;
    if (area > largestArea) {
      largestArea = area;
      largest = t;
    }
  }
  if (weightSum <= 0) return territoryAnchor(largest);
  const p: Coord = [sx / weightSum, sy / weightSum];
  if (group.some((t) => pointInPolygon(p, t.polygon))) return p;
  return territoryAnchor(largest); // concave block (centroid fell outside)
}

/** Layout cache: maps are immutable and `owners` objects are stable per round. */
const cache = new WeakMap<MapFormatV1, WeakMap<Ownership, FactionLabel[]>>();

/** EU4-style label tuning (world units relative to block size). */
const AREA_K = 3; // font ≈ area^0.25 * K, clamped below
const MIN_SIZE = 14;
const MAX_SIZE = 60;
const CROSS_FIT = 0.75; // text height ≤ 75% of the block's thickness
const SPAN_MARGIN = 0.85; // text spans 85% of the block's long axis
const ROTATE_RATIO = 1.6; // rotate 90° when the block is taller than 1.6× wider

/** One label per living faction, EU4-style, adapted to its block's shape. */
export function layoutLabels(map: MapFormatV1, owners: Ownership): FactionLabel[] {
  let perOwners = cache.get(map);
  if (!perOwners) {
    perOwners = new WeakMap();
    cache.set(map, perOwners);
  }
  const hit = perOwners.get(owners);
  if (hit) return hit;

  const groups = new Map<FactionId, Territory[]>();
  for (const t of map.territories) {
    const faction = owners[t.id] ?? t.id;
    const group = groups.get(faction);
    if (group) group.push(t);
    else groups.set(faction, [t]);
  }

  const labels: FactionLabel[] = [];
  for (const [faction, group] of groups) {
    const [x, y] = blockAnchor(group);
    const { size, angle, span } = blockShape(group);
    labels.push({ faction, text: faction, x, y, size, angle, span });
  }
  labels.sort((a, b) => (a.faction < b.faction ? -1 : a.faction > b.faction ? 1 : 0));
  perOwners.set(owners, labels);
  return labels;
}

/**
 * EU4-style metrics for a block: font size from its area (bigger faction →
 * bigger name), oriented along the long axis, spread to span it.
 */
function blockShape(group: Territory[]): { size: number; angle: number; span: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let area = 0;
  for (const t of group) {
    area += Math.abs(signedArea(t.polygon)) / 2;
    for (const [px, py] of t.polygon) {
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const angle = h > w * ROTATE_RATIO ? Math.PI / 2 : 0;
  const along = angle === 0 ? w : h;
  const cross = angle === 0 ? h : w;

  const areaSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, area ** 0.25 * AREA_K));
  const size = Math.min(areaSize, cross * CROSS_FIT);
  return { size, angle, span: along * SPAN_MARGIN };
}
