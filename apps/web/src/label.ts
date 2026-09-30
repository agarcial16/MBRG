import type { Coord, FactionId, MapFormatV1, Ownership, Territory } from '@mbrg/shared';

import { edgeKey } from './topology.js';
import { factionName } from './names.js';

/**
 * A faction label anchored at the visual center of its *block* (all the
 * provinces the faction currently owns), so annexations never leave duplicated
 * or stale names behind.
 *
 * The geometry adapts to the block's *corridor*: the anchor is the pole of
 * inaccessibility, rays find the longest straight run, and then the centerline
 * is walked with transverse sections so it bends toward the local middle —
 * the text runs along that curve, filling concave blocks (an L-shape gets its
 * name along the L, not cut across it). Span/thickness come from the curve,
 * never from the bounding box (which may include enemy land). Text measurement
 * happens at draw time (needs a canvas context), together with glyph-by-glyph
 * containment validation, keeping this module pure.
 */
export interface FactionLabel {
  faction: FactionId;
  /** Text to draw (the faction's display name). */
  text: string;
  /** Visual center of the label (the curve's midpoint). */
  x: number;
  y: number;
  /** Base font size in world units (may be shrunk at draw time to fit `span`). */
  size: number;
  /** Base rotation in radians: the corridor's canonical axis (0 = horizontal). */
  angle: number;
  /** Target width of the text along its curve, in world units. */
  span: number;
  /** Centerline the glyphs run along (a straight corridor is a 2-point curve). */
  curve: LabelCurve;
  /** Filled area of the block (outer ring + holes), for draw-time containment checks. */
  zones: Zone[];
  /** Opacity (1 at rest; used mid-animation for fading labels). */
  alpha?: number;
  /** True while animating between rounds: containment validation is skipped. */
  moving?: boolean;
  /** Mid-animation: the fitted layout this label morphs from, and progress. */
  morph?: { from: FactionLabel; t: number };
}

/** Centerline of a label, with arc-length and thickness tables. */
export interface LabelCurve {
  /** World-space points of the centerline (≥ 2). */
  pts: Coord[];
  /** Cumulative arc length at each point; `cum[0] === 0`, last = `total`. */
  cum: number[];
  /** Total arc length. */
  total: number;
  /** Block thickness measured transversally at each point. */
  thick: number[];
}

/** Position + tangent angle at an arc-length offset of a curve. */
export interface CurveFrame {
  x: number;
  y: number;
  angle: number;
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

// --- Label curves -----------------------------------------------------------

/** Curve construction tuning (relative to the corridor length). */
const CURVE_STEPS = 24; // transverse samples walked along the corridor
const CURVE_SMOOTH = 2; // moving-average passes (endpoints fixed)
const CURVE_MAX_BEND = 0.6; // max lateral correction per step = 0.6 × step
const CURVE_MIN_ARC = 0.5; // distrust a walk below 50% of the straight corridor
const GLYPH_AVG = 0.6; // rough advance of a bold glyph in em (layout estimate)

/**
 * Build a curve from walk points: dedupe, arc-length table, and transverse
 * thickness measured with each point's local tangent.
 */
function curveOf(pts: Coord[], boundary: Segment[]): LabelCurve {
  const clean: Coord[] = [];
  for (const p of pts) {
    const last = clean[clean.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) clean.push(p);
  }
  while (clean.length < 2) clean.push(clean[clean.length - 1] ?? [0, 0]);
  const cum = [0];
  for (let i = 1; i < clean.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(clean[i][0] - clean[i - 1][0], clean[i][1] - clean[i - 1][1]));
  }
  const thick: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const a = clean[Math.max(i - 1, 0)];
    const b = clean[Math.min(i + 1, clean.length - 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len > 1e-9) {
      dx /= len;
      dy /= len;
    } else {
      dx = 1;
      dy = 0;
    }
    const p = clean[i];
    const t1 = rayDistance(p, [-dy, dx], boundary);
    const t2 = rayDistance(p, [dy, -dx], boundary);
    thick.push(isFinite(t1) && isFinite(t2) ? t1 + t2 : 0);
  }
  return { pts: clean, cum, total: cum[cum.length - 1], thick };
}

/**
 * Moving average over interior points; a smoothed point is kept only if it
 * stays inside the block (averaging must never cut across a concave notch).
 */
function smoothCurve(pts: Coord[], passes: number, zones: Zone[]): Coord[] {
  let out = pts.slice();
  for (let pass = 0; pass < passes; pass++) {
    const next: Coord[] = [out[0]];
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1];
      const b = out[i];
      const c = out[i + 1];
      const m: Coord = [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4];
      next.push(pointInBlock(m, zones) ? m : b);
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/** The straight corridor as a 2-point curve (degenerate cases / fallback). */
function straightCurve(
  anchor: Coord,
  dir: Coord,
  dFwd: number,
  dBack: number,
  boundary: Segment[],
): LabelCurve {
  return curveOf(
    [
      [anchor[0] - dir[0] * dBack, anchor[1] - dir[1] * dBack],
      [anchor[0] + dir[0] * dFwd, anchor[1] + dir[1] * dFwd],
    ],
    boundary,
  );
}

/**
 * Walk the corridor and bend the centerline toward the local middle: at every
 * step the transverse cross-section is measured with two rays (the whole
 * segment is inside by ray property) and the walk advances to its center —
 * with a per-step bend limit so the curve stays readable. Falls back to the
 * straight corridor when the walk can't stay inside or gets truncated.
 */
function buildCurve(
  anchor: Coord,
  dir: Coord,
  dFwd: number,
  dBack: number,
  boundary: Segment[],
  zones: Zone[],
): LabelCurve {
  const straight = (): LabelCurve => straightCurve(anchor, dir, dFwd, dBack, boundary);
  const L = dFwd + dBack;
  const step = L / CURVE_STEPS;
  const eps = step * 0.25;
  const budget = L - 2 * eps;
  if (!(L > 1e-6) || !(budget > 1e-6) || boundary.length === 0) return straight();

  let c: Coord = [anchor[0] - dir[0] * (dBack - eps), anchor[1] - dir[1] * (dBack - eps)];
  let tangent: Coord = [dir[0], dir[1]];
  const pts: Coord[] = [];
  let moved = 0;
  let guard = 0;
  while (moved < budget - 1e-6 && guard++ < CURVE_STEPS * 4) {
    pts.push([c[0], c[1]]);
    const nx = -tangent[1];
    const ny = tangent[0];
    const t1 = rayDistance(c, [nx, ny], boundary); // +n side
    const t2 = rayDistance(c, [-nx, -ny], boundary); // -n side
    if (!isFinite(t1) || !isFinite(t2)) break;
    // Move to the center of the cross-section, clamped for aesthetics.
    let latX = (nx * (t1 - t2)) / 2;
    let latY = (ny * (t1 - t2)) / 2;
    const lat = Math.hypot(latX, latY);
    const maxLat = step * CURVE_MAX_BEND;
    if (lat > maxLat) {
      latX *= maxLat / lat;
      latY *= maxLat / lat;
    }
    let adv = Math.min(step, budget - moved);
    let advanced = false;
    for (let k = 0; k < 4; k++) {
      const np: Coord = [c[0] + latX + tangent[0] * adv, c[1] + latY + tangent[1] * adv];
      if (pointInBlock(np, zones)) {
        const mLen = Math.hypot(np[0] - c[0], np[1] - c[1]);
        if (mLen > 1e-9) tangent = [(np[0] - c[0]) / mLen, (np[1] - c[1]) / mLen];
        c = np;
        moved += adv;
        advanced = true;
        break;
      }
      adv *= 0.5;
    }
    if (!advanced) break; // can't stay inside: keep what we walked
  }
  pts.push([c[0], c[1]]);

  const smoothed = smoothCurve(pts, CURVE_SMOOTH, zones);
  if (smoothed.length < 2) return straight();
  const curve = curveOf(smoothed, boundary);
  // A truncated walk would give the text too little room — use the straight corridor.
  if (!isFinite(curve.total) || curve.total < L * CURVE_MIN_ARC) return straight();
  return curve;
}

/** Local block thickness at arc offset `s` (linear interpolation). */
function thicknessAt(curve: LabelCurve, s: number): number {
  const { cum, thick } = curve;
  const sc = s < 0 ? 0 : s > curve.total ? curve.total : s;
  let i = 0;
  while (i < thick.length - 2 && cum[i + 1] < sc) i++;
  const segLen = cum[i + 1] - cum[i];
  const t = segLen > 0 ? (sc - cum[i]) / segLen : 0;
  return thick[i] + (thick[i + 1] - thick[i]) * t;
}

/** Point + tangent at arc offset `s` (clamped to the curve). */
export function frameAt(curve: LabelCurve, s: number): CurveFrame {
  const { pts, cum } = curve;
  const sc = s < 0 ? 0 : s > curve.total ? curve.total : s;
  let i = 0;
  while (i < pts.length - 2 && cum[i + 1] < sc) i++;
  const a = pts[i];
  const b = pts[i + 1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const segLen = cum[i + 1] - cum[i];
  const t = segLen > 0 ? (sc - cum[i]) / segLen : 0;
  return { x: a[0] + dx * t, y: a[1] + dy * t, angle: Math.atan2(dy, dx) };
}

/** Layout cache: maps are immutable and `owners` objects are stable per round. */
const cache = new WeakMap<MapFormatV1, WeakMap<Ownership, FactionLabel[]>>();

/** EU4-style label tuning (world units relative to block size). */
const AREA_K = 3; // font ≈ area^0.25 * K, clamped below
const MIN_SIZE = 14;
const MAX_SIZE = 60;
const CROSS_FIT = 0.8; // text height ≤ 80% of the block's local thickness
const SPAN_MARGIN = 0.85; // text spans 85% of the curve
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
    const text = factionName(map, faction);
    const geom = blockGeometry(group);
    const anchor = blockAnchor(group, geom);
    const { size, angle, span, curve } = blockShape(group, geom, anchor, text);
    const mid = frameAt(curve, curve.total / 2);
    labels.push({
      faction,
      text,
      x: mid.x,
      y: mid.y,
      size,
      angle,
      span,
      curve,
      zones: geom.zones,
    });
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
 * crossfade): surviving factions glide to their new anchor/size/orientation
 * and carry their `morph` (from-layout + progress) so the renderer can move
 * glyph by glyph along both curves; labels of factions that just died fade
 * out in place, and reappearing ones (restart) fade in.
 *
 * `from` and `to` should be the *fitted* layouts (see `fitLabels`), so the
 * morph lands exactly on the rest state at t = 1.
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
      morph: { from: old, t },
    });
  }
  // Factions eliminated this round: fade out where they stood.
  for (const dead of prev.values()) out.push({ ...dead, alpha: 1 - t });
  return out;
}

/**
 * EU4-style metrics for a block, measured along its *real corridor*: rays from
 * the anchor find the straight run, then `buildCurve` bends the centerline
 * through the block so concave shapes get their name along their body instead
 * of cut across it. `span` is the arc length; the font is capped by the
 * block's thickness under the estimated glyph positions (iterating, because a
 * smaller font shortens the run). Falls back to the bounding box when no
 * usable corridor exists (numerically degenerate blocks).
 */
function blockShape(group: Territory[], geom: BlockGeom, anchor: Coord, text: string): {
  size: number;
  angle: number;
  span: number;
  curve: LabelCurve;
} {
  const { boundary, zones } = geom;
  let area = 0;
  for (const t of group) area += Math.abs(signedArea(t.polygon)) / 2;
  const areaSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, area ** 0.25 * AREA_K));

  let bestSpan = -1;
  let bestTheta = 0;
  let bestDir: Coord = [1, 0];
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
      bestDir = dir;
    }
  }
  if (bestSpan <= 0) return bboxShape(group, areaSize, geom, anchor); // degenerate

  // Canonical angle in (-PI/2, PI/2]: same axis, but the glyphs are never
  // upside-down and interpolating between rounds can't spin them around.
  const angle = bestTheta > Math.PI / 2 ? bestTheta - Math.PI : bestTheta;
  const dFwd = rayDistance(anchor, bestDir, boundary);
  const dBack = rayDistance(anchor, [-bestDir[0], -bestDir[1]], boundary);
  const curve = buildCurve(anchor, bestDir, dFwd, dBack, boundary, zones);
  const span = curve.total * SPAN_MARGIN;
  const size = thicknessCap(curve, areaSize, span, text);
  return { size, angle, span, curve };
}

/**
 * Cap the font by the block's thickness under the *estimated* glyph positions
 * (uniform along the run), iterating because a smaller font shortens the run.
 * An estimate only — the exact fit measures with canvas at draw time; this
 * just starts close so the fit-time retries barely move the label.
 */
function thicknessCap(curve: LabelCurve, areaSize: number, span: number, text: string): number {
  const n = [...text].length;
  if (n === 0 || curve.thick.length === 0 || span <= 0) return areaSize;
  const center = curve.total / 2;
  let size = areaSize;
  for (let iter = 0; iter < 3; iter++) {
    const run = Math.min(span, n * GLYPH_AVG * size);
    const half = run / 2;
    if (half <= 0) break;
    let minThick = 0;
    for (let i = 0; i < n; i++) {
      const s = center - half + ((i + 0.5) / n) * (2 * half);
      const th = thicknessAt(curve, s);
      if (th > 0 && (minThick === 0 || th < minThick)) minThick = th;
    }
    if (minThick <= 0) break; // no usable measurement: keep the area size
    const cap = minThick * CROSS_FIT;
    if (cap >= size) break;
    size = cap;
  }
  return size;
}

/** Fallback shape from the bounding box (used only for degenerate corridors). */
function bboxShape(
  group: Territory[],
  areaSize: number,
  geom: BlockGeom,
  anchor: Coord,
): { size: number; angle: number; span: number; curve: LabelCurve } {
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
  // Straight corridor along the bbox axis, ray-measured so it touches the border.
  const { boundary } = geom;
  const dir: Coord = angle === 0 ? [1, 0] : [0, 1];
  const dFwd = boundary.length > 0 ? rayDistance(anchor, dir, boundary) : along / 2;
  const dBack = boundary.length > 0 ? rayDistance(anchor, [-dir[0], -dir[1]], boundary) : along / 2;
  const curve = straightCurve(
    anchor,
    dir,
    isFinite(dFwd) ? dFwd : along / 2,
    isFinite(dBack) ? dBack : along / 2,
    boundary,
  );
  return { size, angle, span: curve.total * SPAN_MARGIN, curve };
}
