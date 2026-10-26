import type { Coord, FactionId, MapFormatV1, Ownership, Territory } from '@mbrg/shared';
import { mainRing } from '@mbrg/shared';

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

/**
 * A territory's filled area: every one of its pieces minus its holes.
 *
 * `outers` rather than one ring because a province can be an archipelago, and a
 * label sitting on the mainland has to be able to call a point "inside" when it
 * happens to land on the island.
 */
export interface Zone {
  outers: Coord[][];
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
  const zones: Zone[] = group.map((t) => ({ outers: t.polygons, holes: t.holes ?? [] }));
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
    for (const outer of z.outers) addRing(outer);
    for (const h of z.holes) addRing(h);
  }
  const boundary: Segment[] = [];
  for (const { seg, n } of counts.values()) if (n === 1) boundary.push(seg);
  return { zones, boundary };
}

/** Inside the zone: within some outer ring and outside every hole. */
function pointInZone(p: Coord, z: Zone): boolean {
  let inside = false;
  for (const outer of z.outers) {
    if (pointInPolygon(p, outer)) {
      inside = true;
      break;
    }
  }
  if (!inside) return false;
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
  // The biggest piece, so a province with an island next to it does not get its
  // label (or its anchor) out at sea between the two.
  const ring = mainRing(t);
  const c = polygonCentroid(ring);
  if (pointInPolygon(c, ring)) return c;
  return vertexAverage(ring);
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
    for (const outer of z.outers) {
      for (const [x, y] of outer) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
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
    let area = 0;
    for (const ring of t.polygons) area += Math.abs(signedArea(ring));
    if (area > largestArea) {
      largestArea = area;
      largest = t;
    }
  }
  return territoryAnchor(largest);
}

// --- Label curves -----------------------------------------------------------

/** Curve construction tuning (relative to the corridor length). */
const GLYPH_AVG = 0.6; // rough advance of a bold glyph in em (layout estimate)
/** Samples used to draw a crescent arc. */
const ARC_STEPS = 20;
/**
 * How far past the 10%/90% section centers the arc may reach at each end, as a
 * fraction of the corridor. Tried in order: the first arc whose samples all
 * stay inside the block wins, so a crescent never bulges out of the land.
 */
const ARC_EXTEND = [0.1, 0.05, 0];
/** Below this sagitta the three section centers are just noise: keep it straight. */
const ARC_MIN_SAGITTA = 0.03;
/** A crescent must beat the straight line by this much font size to be worth it. */
const ARC_GAIN = 1.15;

/**
 * How far a local tangent may tilt from the label's base axis before the label
 * stops reading as one line. 60° still looks like text (never upside down,
 * never with the glyph order reversed) while leaving room for a real crescent.
 */
const MAX_TANGENT_DEV = (60 * Math.PI) / 180;

/**
 * Is `curve` readable along `dir`? Every segment must advance in the reading
 * direction (cos > 0: never backwards, never upside down) and stay within
 * MAX_TANGENT_DEV of it. A curve that fails is unusable as a label axis —
 * callers fall back to the straight corridor, which always passes.
 */
function isReadable(curve: LabelCurve, dir: Coord): boolean {
  const maxSin = Math.sin(MAX_TANGENT_DEV);
  for (let i = 1; i < curve.pts.length; i++) {
    const dx = curve.pts[i][0] - curve.pts[i - 1][0];
    const dy = curve.pts[i][1] - curve.pts[i - 1][1];
    const len = Math.hypot(dx, dy);
    if (len <= 1e-9) continue;
    if ((dx * dir[0] + dy * dir[1]) / len <= 0) return false; // reads backwards
    if (Math.abs(dy * dir[0] - dx * dir[1]) / len > maxSin) return false; // too tilted
  }
  return true;
}

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
 * The straight corridor as a 2-point curve (the default label axis, and the
 * fallback whenever a curve can't be trusted). Endpoints are pulled a hair
 * inside the block: the rays stop *on* the border, and a centerline point that
 * sits exactly on it is ambiguous for inside tests and for glyph containment.
 *
 * The pull is 1% of the corridor, with no absolute cap. A cap looks harmless and
 * is not: it makes this curve a different shape on a small map than on a large
 * one, and the crescent-vs-straight comparison downstream then flips depending on
 * how big the map happens to be. One label out of four was quietly getting the
 * wrong shape purely because of it.
 *
 * The corridor is sampled at `STRAIGHT_STEPS` points rather than just its two
 * ends, and that is not a nicety. Thickness is measured transversally *at each
 * walk point*, so a two-point curve has exactly two thickness samples — both of
 * them at the ends, where the block is by definition as thin as it will ever be.
 * The font cap then reads that minimum and shrinks the label to fit a sliver that
 * is nowhere near where the text sits. On the handmade map it cost a third of
 * the size; on a grid of provinces it reported a thickness of 18 units where the
 * real one was 349, which pinned every label to the smallest size allowed and
 * then let the on-screen minimum rescue them all to the same 12px. Every label
 * identical, on every province: the size was being decided by the floor instead
 * of by the province.
 *
 * NOT FIXED HERE, on purpose: sampling the corridor properly makes the crescent
 * stop winning (it was partly winning against this sliver), so the two changes
 * have to be reviewed together. See `STRAIGHT_STEPS` below.
 */
function straightCurve(
  anchor: Coord,
  dir: Coord,
  dFwd: number,
  dBack: number,
  boundary: Segment[],
): LabelCurve {
  const L = dFwd + dBack;
  const eps = L * 0.01;
  const from = -(dBack - eps);
  const to = dFwd - eps;
  const end: Coord = [anchor[0] + dir[0] * to, anchor[1] + dir[1] * to];
  if (STRAIGHT_STEPS === 0) {
    return curveOf(
      [
        [anchor[0] - dir[0] * (dBack - eps), anchor[1] - dir[1] * (dBack - eps)],
        end,
      ],
      boundary,
    );
  }
  const pts: Coord[] = [];
  for (let i = 0; i <= STRAIGHT_STEPS; i++) {
    const d = from + ((to - from) * i) / STRAIGHT_STEPS;
    pts.push([anchor[0] + dir[0] * d, anchor[1] + dir[1] * d]);
  }
  return curveOf(pts, boundary);
}

/**
 * Samples the straight corridor should be measured at, once it is sampled.
 *
 * Set to 0 for now, which keeps the two-endpoint behaviour and with it the
 * crescent decision as it was. The right value is 20, and turning it on is a
 * one-line change — but it also retires the crescent on every shape tried
 * (a 207-case sweep over curved bands and concave horseshoes: best arc gain
 * 1.137 against a 1.15 threshold, so the arc never wins). That may well be the
 * honest answer — a straight label through a correctly-measured block is a fine
 * label — but it is a visible change to how curved provinces read, and it does
 * not belong hidden inside a commit about scaling. It gets its own.
 */
const STRAIGHT_STEPS = 0;

/** Circumcenter of three points, or null when they are (near) collinear. */
function circumcenter(a: Coord, b: Coord, c: Coord): Coord | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a[0] * a[0] + a[1] * a[1];
  const b2 = b[0] * b[0] + b[1] * b[1];
  const c2 = c[0] * c[0] + c[1] * c[1];
  return [
    (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d,
    (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d,
  ];
}

/**
 * One crescent — a single circular arc — through the three transverse section
 * centers of the straight corridor (start, middle, end).
 *
 * The three points are all inside the block (each section is the middle of a
 * segment that two rays proved to be inside), so the arc through them bends
 * exactly where the block is thick, and the sagitta gives both the radius and
 * the *side*: an interior or an exterior crescent for free. Sampling 1 → 2 → 3
 * keeps the tangent rotating monotonically, so a crescent can never fold back
 * on itself the way a free walk used to.
 *
 * Returns null when the block is effectively straight, the arc would swing too
 * far to stay readable, or any sample would leave the block: the caller then
 * keeps the straight line.
 */
function crescentCurve(
  anchor: Coord,
  dir: Coord,
  dFwd: number,
  dBack: number,
  boundary: Segment[],
  zones: Zone[],
): LabelCurve | null {
  const L = dFwd + dBack;
  if (!(L > 1e-6) || boundary.length === 0) return null;
  const start: Coord = [anchor[0] - dir[0] * dBack, anchor[1] - dir[1] * dBack];
  const end: Coord = [anchor[0] + dir[0] * dFwd, anchor[1] + dir[1] * dFwd];
  const at = (t: number): Coord => [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
  ];
  // Middle of the transverse section at t: a whole segment inside the block
  // (both rays stop at the border), so its midpoint is inside too.
  const sectionCenter = (p: Coord): Coord | null => {
    const n: Coord = [-dir[1], dir[0]];
    const t1 = rayDistance(p, n, boundary);
    const t2 = rayDistance(p, [-n[0], -n[1]], boundary);
    if (!isFinite(t1) || !isFinite(t2)) return null;
    return [p[0] + (n[0] * (t1 - t2)) / 2, p[1] + (n[1] * (t1 - t2)) / 2];
  };

  const a = sectionCenter(at(0.1));
  const b = sectionCenter(at(0.5));
  const c = sectionCenter(at(0.9));
  if (!a || !b || !c) return null;

  // Sagitta of b against the a→c chord: the whole point of the crescent. If
  // it's noise, the block is a rectangle-ish corridor and straight wins.
  const cdx = c[0] - a[0];
  const cdy = c[1] - a[1];
  const chord = Math.hypot(cdx, cdy);
  if (!(chord > 1e-6)) return null;
  const sagitta = Math.abs((b[0] - a[0]) * (cdy / chord) - (b[1] - a[1]) * (cdx / chord));
  if (sagitta < L * ARC_MIN_SAGITTA) return null;

  const center = circumcenter(a, b, c);
  if (!center) return null;
  const radius = Math.hypot(a[0] - center[0], a[1] - center[1]);
  if (!isFinite(radius) || radius <= 1e-6) return null;

  // Angles of the three points around the center: the middle one must fall
  // *between* the ends, otherwise the arc would bulge the wrong way round.
  const ang = (p: Coord): number => Math.atan2(p[1] - center[1], p[0] - center[0]);
  const wrap = (rad: number): number => {
    let w = rad;
    while (w > Math.PI) w -= 2 * Math.PI;
    while (w < -Math.PI) w += 2 * Math.PI;
    return w;
  };
  const d1 = wrap(ang(b) - ang(a));
  const d2 = wrap(ang(c) - ang(b));
  if (Math.abs(d1) < 1e-6 || Math.abs(d2) < 1e-6) return null;
  if (d1 * d2 <= 0) return null; // b is not between a and c: wrong bulge
  // A hook is not a crescent: beyond 120° the label stops reading as one line.
  if (Math.abs(d1) + Math.abs(d2) > (120 * Math.PI) / 180) return null;

  const phiA = ang(a);
  // The three centers sit at 10% / 50% / 90% of the corridor, so the arc through
  // them stops short. Extending it along the *same circle* to cover the full
  // run is worth trying — the fitted circle rarely matches the block all the
  // way to the ends, so back off until every sample stays inside.
  const turn = d1 + d2;
  const sgn = turn < 0 ? -1 : 1;
  for (const frac of ARC_EXTEND) {
    const extend = (frac * L) / radius; // radians covering `frac` at each end
    const from = phiA - sgn * extend;
    const to = phiA + turn + sgn * extend;
    const pts: Coord[] = [];
    for (let i = 0; i <= ARC_STEPS; i++) {
      const phi = from + ((to - from) * i) / ARC_STEPS;
      pts.push([center[0] + radius * Math.cos(phi), center[1] + radius * Math.sin(phi)]);
    }
    if (pts.some((p) => !pointInBlock(p, zones))) continue;
    const curve = curveOf(pts, boundary);
    if (!isFinite(curve.total) || curve.total <= 0) continue;
    if (!isReadable(curve, dir)) return null; // more reach won't fix legibility
    return curve;
  }
  return null;
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

/**
 * The map's short side in world units, which is the unit every label size is
 * measured in. That is what makes a label mean the same thing on a 400-unit
 * handmade map and a 4000-unit imported one.
 *
 * Falls back to the territory bounding box when the map carries no size hint, so
 * a hand-written map in a test still gets sizes proportional to itself instead of
 * to a unit that happens to be 1.
 */
export function mapUnit(map: MapFormatV1): number {
  const hinted = Math.min(map.width ?? Infinity, map.height ?? Infinity);
  if (Number.isFinite(hinted) && hinted > 0) return hinted;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of map.territories) {
    for (const ring of t.polygons) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const short = Math.min(maxX - minX, maxY - minY);
  return Number.isFinite(short) && short > 0 ? short : 1;
}

/** Base font for a block of `area` world units², in world units. */
function blockSize(area: number, mapL: number): number {
  const raw = Math.sqrt(mapL) * area ** 0.25 * AREA_K;
  return Math.max(MIN_SIZE * mapL, Math.min(MAX_SIZE * mapL, raw));
}

/**
 * EU4-style label tuning, as **fractions of the map's short side** rather than
 * world units.
 *
 * The three numbers were calibrated by eye against one map of 415 units across,
 * which quietly turned every size into "pixels on that map" and into nothing at
 * all on any other. `area^0.25` was the part that hid it: an area grows like
 * length squared, so its fourth root grows like the *square root* of length.
 * Double the map and every label came out √2 too small, which is not dramatic
 * enough to notice on the next map and not small enough to look obviously wrong.
 * On a big imported map with many provinces it compounds into labels that are
 * barely a few pixels tall, where `MIN_FONT_PX` rescues them all to the same
 * 12px — and 200 provinces all labelled in the same 12px is noise, not a map.
 *
 * So the sizes travel with the map. `MIN_SIZE`/`MAX_SIZE` are plain fractions: a
 * size is proportional to length. `AREA_K` carries a `sqrt(L)` because it
 * multiplies a fourth root of an area; that is the whole of the derivation, and
 * the constants are calibrated to reproduce the 415-unit map exactly, so nothing
 * that already looked right moves.
 */
const AREA_K = 3 / Math.sqrt(415); // font ≈ √L · area^0.25 · K
const MIN_SIZE = 14 / 415; // × L
const MAX_SIZE = 60 / 415; // × L
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

  const unit = mapUnit(map);
  const labels: FactionLabel[] = [];
  for (const [faction, group] of groups) {
    const text = factionName(map, faction);
    const geom = blockGeometry(group);
    const anchor = blockAnchor(group, geom);
    const { size, angle, span, curve } = blockShape(group, geom, anchor, text, unit);
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
function blockShape(
  group: Territory[],
  geom: BlockGeom,
  anchor: Coord,
  text: string,
  mapL: number,
): {
  size: number;
  angle: number;
  span: number;
  curve: LabelCurve;
} {
  const { boundary, zones } = geom;
  let area = 0;
  for (const t of group) {
    for (const ring of t.polygons) area += Math.abs(signedArea(ring)) / 2;
  }
  const areaSize = blockSize(area, mapL);

  let bestSpan = -1;
  let bestTheta = 0;
  for (let i = 0; i < CORRIDOR_RAYS; i++) {
    const theta = (i * Math.PI) / CORRIDOR_RAYS; // [0, PI) covers every axis
    const probe: Coord = [Math.cos(theta), Math.sin(theta)];
    const d1 = rayDistance(anchor, probe, boundary);
    const d2 = rayDistance(anchor, [-probe[0], -probe[1]], boundary);
    if (!isFinite(d1) || !isFinite(d2)) continue;
    const total = d1 + d2;
    if (total > bestSpan) {
      bestSpan = total;
      bestTheta = theta;
    }
  }
  if (bestSpan <= 0) return bboxShape(group, areaSize, geom, anchor); // degenerate


  // Canonical angle in (-PI/2, PI/2]: the axis is kept, but flipped so the text
  // always *reads* along it. `bestTheta` is probed over [0, PI), so half the
  // time the winning corridor points "backwards" — building the curve along
  // that direction is what used to leave labels (Estalia) upside down, since
  // each glyph takes its local tangent from the curve. Flipping the axis here
  // makes the whole centerline advance in reading order by construction, and
  // interpolating between rounds can't spin glyphs around either.
  const angle = bestTheta > Math.PI / 2 ? bestTheta - Math.PI : bestTheta;
  const dir: Coord = [Math.cos(angle), Math.sin(angle)];
  const dFwd = rayDistance(anchor, dir, boundary);
  const dBack = rayDistance(anchor, [-dir[0], -dir[1]], boundary);

  // Straight first — a rectangle-ish block should never get a fancy curve just
  // because one was available. The crescent is only worth its readability cost
  // when it buys a clearly bigger label, i.e. when the straight line is
  // pinched (a concave block) or too short (a curved one).
  const straight = straightCurve(anchor, dir, dFwd, dBack, boundary);
  const spanOf = (c: LabelCurve): number => c.total * SPAN_MARGIN;
  let curve = straight;
  let size = labelSize(straight, areaSize, text);
  const crescent = crescentCurve(anchor, dir, dFwd, dBack, boundary, zones);
  if (crescent) {
    const arcSize = labelSize(crescent, areaSize, text);
    if (arcSize > size * ARC_GAIN) {
      curve = crescent;
      size = arcSize;
    }
  }
  return { size, angle, span: spanOf(curve), curve };
}

/**
 * Font size this curve can actually deliver: capped by the block's thickness
 * under the estimated glyphs, and by the room the run gives the name. Both
 * caps bite in practice, and a crescent can win on either one — a curved block
 * gives a longer run, a pinched one more thickness — so both must be compared
 * before deciding to curve.
 */
function labelSize(curve: LabelCurve, areaSize: number, text: string): number {
  const n = [...text].length;
  const span = curve.total * SPAN_MARGIN;
  const byThickness = thicknessCap(curve, areaSize, span, text);
  if (n === 0 || span <= 0) return byThickness;
  return Math.min(byThickness, span / (n * GLYPH_AVG));
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
    for (const ring of t.polygons) {
      for (const [px, py] of ring) {
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
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
