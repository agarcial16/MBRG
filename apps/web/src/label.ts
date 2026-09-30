import type { Coord, FactionId, MapFormatV1, Ownership, Territory } from '@mbrg/shared';

import { edgeKey } from './topology.js';

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
  /** Opacity (1 at rest; used mid-animation for fading labels). */
  alpha?: number;
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

/** A territory's filled area: outer ring plus holes (lakes / enclaves). */
interface Zone {
  outer: Coord[];
  holes: Coord[][];
}

type Segment = [Coord, Coord];

/** The union of a faction's provinces: its zones and its *visible* boundary. */
interface BlockGeom {
  zones: Zone[];
  /**
   * Segments of the union boundary: member edges not shared with another
   * member (i.e. facing an enemy or the map edge) plus every hole ring.
   * Internal seams between two provinces of the same faction cancel out.
   */
  boundary: Segment[];
}

/** Computes zones + union boundary for a faction's provinces. */
function blockGeometry(group: Territory[]): BlockGeom {
  const zones: Zone[] = group.map((t) => ({ outer: t.polygon, holes: t.holes ?? [] }));
  const counts = new Map<string, { seg: Segment; n: number }>();
  const addRing = (ring: Coord[]): void => {
    for (let i = 0; i < ring.length; i++) {
      const seg: Segment = [ring[i], ring[(i + 1) % ring.length]];
      const key = edgeKey(seg[0], seg[1]);
      const entry = counts.get(key);
      if (entry) entry.n++;
      else counts.set(key, { seg, n: 1 });
    }
  };
  for (const z of zones) {
    addRing(z.outer);
    for (const h of z.holes) addRing(h);
  }
  const boundary: Segment[] = [];
  for (const { seg, n } of counts.values()) if (n === 1) boundary.push(seg);
  return { zones, boundary };
}

/** Inside the zone: within the outer ring and outside every hole. */
function pointInZone(p: Coord, z: Zone): boolean {
  if (!pointInPolygon(p, z.outer)) return false;
  for (const h of z.holes) if (pointInPolygon(p, h)) return false;
  return true;
}

function pointInBlock(p: Coord, zones: Zone[]): boolean {
  for (const z of zones) if (pointInZone(p, z)) return true;
  return false;
}

/** Euclidean distance from a point to a segment. */
function distToSegment(p: Coord, seg: Segment): number {
  const [a, b] = seg;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const ex = a[0] + t * dx - p[0];
  const ey = a[1] + t * dy - p[1];
  return Math.hypot(ex, ey);
}

/** Distance from a point to the block's visible boundary (0 = on the border). */
function distToBoundary(p: Coord, boundary: Segment[]): number {
  let best = Infinity;
  for (const seg of boundary) {
    const d = distToSegment(p, seg);
    if (d < best) best = d;
  }
  return best;
}

/** Sample an n×n grid of cell centers; return the interior point farthest from the border. */
function bestSample(
  x0: number,
  y0: number,
  w: number,
  h: number,
  n: number,
  zones: Zone[],
  boundary: Segment[],
): { x: number; y: number; dist: number } | null {
  const stepX = w / n;
  const stepY = h / n;
  let best: { x: number; y: number; dist: number } | null = null;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const p: Coord = [x0 + (i + 0.5) * stepX, y0 + (j + 0.5) * stepY];
      if (!pointInBlock(p, zones)) continue;
      const dist = distToBoundary(p, boundary);
      if (!best || dist > best.dist) best = { x: p[0], y: p[1], dist };
    }
  }
  return best;
}

const POI_COARSE = 24; // first pass: grid over the whole block bbox
const POI_REFINE = 12; // second pass: finer grid around the coarse winner

/** A guaranteed-plausible label point for a single territory. */
function territoryAnchor(t: Territory): Coord {
  if (t.center) return t.center;
  const c = polygonCentroid(t.polygon);
  if (pointInPolygon(c, t.polygon)) return c;
  return vertexAverage(t.polygon);
}

/**
 * Pole of inaccessibility: the interior point farthest from the block's
 * visible boundary (grid sampling with a refinement pass). Guarantees the
 * label anchor sits *inside* the block even for concave shapes (the classic
 * failure: the centroid of a C-shaped faction landing in a neighbor's land).
 */
function blockAnchor(group: Territory[], geom: BlockGeom): Coord {
  const { zones, boundary } = geom;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const z of zones) {
    for (const [x, y] of z.outer) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w > 0 && h > 0 && boundary.length > 0) {
    const coarse = bestSample(minX, minY, w, h, POI_COARSE, zones, boundary);
    if (coarse) {
      const cw = w / POI_COARSE;
      const ch = h / POI_COARSE;
      const fine = bestSample(coarse.x - cw, coarse.y - ch, 2 * cw, 2 * ch, POI_REFINE, zones, boundary);
      const best = fine && fine.dist > coarse.dist ? fine : coarse;
      return [best.x, best.y];
    }
  }
  // Very thin shapes can dodge the grid: fall back to the best province anchor.
  let bestAnchor: Coord | null = null;
  let bestDist = -1;
  for (const t of group) {
    const c = territoryAnchor(t);
    if (!pointInBlock(c, zones)) continue;
    const d = distToBoundary(c, boundary);
    if (d > bestDist) {
      bestDist = d;
      bestAnchor = c;
    }
  }
  if (bestAnchor) return bestAnchor;
  let largest = group[0];
  let largestArea = -1;
  for (const t of group) {
    const area = Math.abs(signedArea(t.polygon));
    if (area > largestArea) {
      largestArea = area;
      largest = t;
    }
  }
  return territoryAnchor(largest);
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
    const geom = blockGeometry(group);
    const [x, y] = blockAnchor(group, geom);
    const { size, angle, span } = blockShape(group);
    labels.push({ faction, text: faction, x, y, size, angle, span });
  }
  labels.sort((a, b) => (a.faction < b.faction ? -1 : a.faction > b.faction ? 1 : 0));
  perOwners.set(owners, labels);
  return labels;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Interpolate two layouts for the absorption animation (same `t` as the color
 * crossfade): surviving factions glide to their new anchor/size/orientation,
 * labels of factions that just died fade out in place, and reappearing ones
 * (restart) fade in.
 */
export function interpolateLabels(
  from: FactionLabel[],
  to: FactionLabel[],
  t: number,
): FactionLabel[] {
  const prev = new Map(from.map((l) => [l.faction, l]));
  const out: FactionLabel[] = [];
  for (const label of to) {
    const old = prev.get(label.faction);
    prev.delete(label.faction);
    if (!old) {
      out.push({ ...label, alpha: t });
      continue;
    }
    out.push({
      ...label,
      x: lerp(old.x, label.x, t),
      y: lerp(old.y, label.y, t),
      size: lerp(old.size, label.size, t),
      angle: lerp(old.angle, label.angle, t),
      span: lerp(old.span, label.span, t),
      alpha: 1,
    });
  }
  // Factions eliminated this round: fade out where they stood.
  for (const dead of prev.values()) out.push({ ...dead, alpha: 1 - t });
  return out;
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
