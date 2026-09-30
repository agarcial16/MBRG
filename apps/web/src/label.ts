import type { Coord, FactionId, MapFormatV1, Ownership, Territory } from '@mbrg/shared';

import { edgeKey } from './topology.js';

/**
 * A faction label anchored at the visual center of its *block* (all the
 * provinces the faction currently owns), so annexations never leave duplicated
 * or stale names behind.
 *
 * The geometry (size / orientation / span) adapts to the block's *corridor*:
 * the anchor is the pole of inaccessibility (farthest point from the visible
 * border), rays from the anchor find the longest straight corridor through the
 * block, and the text runs along it at a free angle. Span and thickness come
 * from those rays, not from the bounding box (which may include enemy land).
 * Text measurement happens at draw time (needs a canvas context), together
 * with glyph-by-glyph containment validation, keeping this module pure.
 */
export interface FactionLabel {
  faction: FactionId;
  /** Text to draw (the faction id/name). */
  text: string;
  x: number;
  y: number;
  /** Base font size in world units (may be shrunk at draw time to fit `span`). */
  size: number;
  /** Rotation in radians: free angle along the block's corridor (0 = horizontal). */
  angle: number;
  /** Target width of the text along its direction, in world units. */
  span: number;
  /** Filled area of the block (outer ring + holes), for draw-time containment checks. */
  zones: Zone[];
  /** Opacity (1 at rest; used mid-animation for fading labels). */
  alpha?: number;
  /** True while animating between rounds: containment validation is skipped. */
  moving?: boolean;
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
export interface Zone {
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

/**
 * Distance from `origin` along direction `dir` (unit) to the first boundary
 * crossing — exact ray/segment intersection, not marching. All points before
 * that distance are guaranteed inside the block. Infinity if the ray misses
 * (shouldn't happen for a closed union, but numerics happen).
 */
function rayDistance(origin: Coord, dir: Coord, boundary: Segment[]): number {
  const [ox, oy] = origin;
  const [dx, dy] = dir;
  let best = Infinity;
  for (const [a, b] of boundary) {
    const sx = b[0] - a[0];
    const sy = b[1] - a[1];
    const denom = dx * sy - dy * sx;
    if (Math.abs(denom) < 1e-12) continue; // parallel to this segment
    const rx = a[0] - ox;
    const ry = a[1] - oy;
    const t = (rx * sy - ry * sx) / denom; // along the ray
    const u = (rx * dy - ry * dx) / denom; // along the segment
    if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t;
  }
  return best;
}

/**
 * Is a rectangle (given in text-local coordinates relative to the anchor,
 * rotated by `angle`) fully inside the block? Checks the 4 corners.
 */
export function rectInsideBlock(
  zones: Zone[],
  anchor: Coord,
  angle: number,
  lx: number,
  ly: number,
  lw: number,
  lh: number,
): boolean {
  if (zones.length === 0) return true; // nothing to validate against
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners: Coord[] = [
    [lx, ly],
    [lx + lw, ly],
    [lx, ly + lh],
    [lx + lw, ly + lh],
  ];
  for (const [cx, cy] of corners) {
    const p: Coord = [anchor[0] + cx * cos - cy * sin, anchor[1] + cx * sin + cy * cos];
    if (!pointInBlock(p, zones)) return false;
  }
  return true;
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
const CORRIDOR_RAYS = 72; // corridor directions probed over 180° (every 2.5°)

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
const ROTATE_RATIO = 1.6; // rotate 90° when taller than 1.6× wider (bbox fallback)

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
    const anchor = blockAnchor(group, geom);
    const { size, angle, span } = blockShape(group, geom, anchor);
    labels.push({ faction, text: faction, x: anchor[0], y: anchor[1], size, angle, span, zones: geom.zones });
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
      moving: true, // mid-flight: glyph containment is validated only at rest
    });
  }
  // Factions eliminated this round: fade out where they stood.
  for (const dead of prev.values()) out.push({ ...dead, alpha: 1 - t });
  return out;
}

/**
 * EU4-style metrics for a block, measured along its *real corridor*: rays from
 * the anchor probe every direction and the text runs along the one with the
 * longest straight run through the block (free angle — the corridor of a C-shape
 * follows its arm instead of a crude horizontal/vertical bbox axis). `span` is
 * the corridor length; the font's height is capped by the thickness measured
 * perpendicular to the corridor at the anchor. Falls back to the bounding box
 * when no usable corridor exists (numerically degenerate blocks).
 */
function blockShape(group: Territory[], geom: BlockGeom, anchor: Coord): {
  size: number;
  angle: number;
  span: number;
} {
  const { boundary } = geom;
  let area = 0;
  for (const t of group) area += Math.abs(signedArea(t.polygon)) / 2;
  const areaSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, area ** 0.25 * AREA_K));

  let bestSpan = -1;
  let bestTheta = 0;
  for (let i = 0; i < CORRIDOR_RAYS; i++) {
    const theta = (i * Math.PI) / CORRIDOR_RAYS; // [0, PI) covers every axis
    const dir: Coord = [Math.cos(theta), Math.sin(theta)];
    const d1 = rayDistance(anchor, dir, boundary);
    const d2 = rayDistance(anchor, [-dir[0], -dir[1]], boundary);
    if (!isFinite(d1) || !isFinite(d2)) continue;
    const total = d1 + d2;
    if (total > bestSpan) {
      bestSpan = total;
      bestTheta = theta;
    }
  }
  if (bestSpan <= 0) return bboxShape(group, areaSize); // degenerate block

  // Canonical angle in (-PI/2, PI/2]: same axis, but the glyphs are never
  // upside-down and interpolating between rounds can't spin them around.
  const angle = bestTheta > Math.PI / 2 ? bestTheta - Math.PI : bestTheta;
  const px = -Math.sin(angle);
  const py = Math.cos(angle);
  const cross = 2 * Math.min(rayDistance(anchor, [px, py], boundary), rayDistance(anchor, [-px, -py], boundary));
  const size = Math.min(areaSize, cross * CROSS_FIT);
  return { size, angle, span: bestSpan * SPAN_MARGIN };
}

/** Fallback shape from the bounding box (used only for degenerate corridors). */
function bboxShape(group: Territory[], areaSize: number): { size: number; angle: number; span: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of group) {
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
  const size = Math.min(areaSize, cross * CROSS_FIT);
  return { size, angle, span: along * SPAN_MARGIN };
}
