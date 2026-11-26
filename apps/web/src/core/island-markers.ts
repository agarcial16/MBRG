// Pacific-style dashed maritime borders for tiny island territories (spec 039 FR-729..FR-731, NFR-192, NFR-193).
// Pure, deterministic, no DOM or clock. Clusters are computed once per map load; per-frame resolution is O(clusters).
import type { Rgb } from '@mbrg/shared';
import type { Camera, Viewport } from './camera';
import { smoothstep } from './lines';
import type { PieceIndex } from './regions';

export interface IslandMarkerParams {
  /** Maximum map-unit gap between two pieces of the same island territory to share one maritime frame. */
  readonly clusterGap: number;
  /** Maximum share of the map's longer side a pure island territory's largest piece may span to count as tiny (FR-731). */
  readonly maxMapShare: number;
  /** On-screen largest-piece extent (CSS px) at or below which the maritime border renders at full strength (FR-730). */
  readonly fullBelowPx: number;
  /** On-screen largest-piece extent (CSS px) at or above which the maritime border fades to 0% (FR-730). */
  readonly fadeOutPx: number;
  /** Maximum minimum-frame width/height in CSS px (scaled down gently on narrow mobile viewports, FR-729). */
  readonly minBoxPx: number;
  /** Padding around the projected cluster bounding box in CSS px. */
  readonly padPx: number;
  /** Corner radius of the rounded dashed frame in CSS px. */
  readonly cornerRadiusPx: number;
  /** Opacity multiplier for non-lit island markers during dimmed tours or round captures (FR-730). */
  readonly dimAlpha: number;
}

export const ISLAND_MARKER_PARAMS: IslandMarkerParams = {
  clusterGap: 80,
  maxMapShare: 0.012,
  fullBelowPx: 10,
  fadeOutPx: 18,
  minBoxPx: 16,
  padPx: 4,
  cornerRadiusPx: 5,
  dimAlpha: 0.35,
};

/** One precomputed spatial cluster of pieces belonging to a pure island territory, in map units (half-open box). */
export interface IslandCluster {
  readonly entry: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** Larger side (in map units) of this territory's largest piece. */
  readonly mainExtent: number;
}

/** One screen-space rounded dashed maritime border ready for Canvas 2D drawing. */
export interface IslandMarkerDraw {
  readonly entry: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly radius: number;
  readonly color: Rgb;
  readonly alpha: number;
}

/**
 * Computes spatial island clusters once per map load (NFR-193). Includes only pure island territories - entries
 * whose pieces have zero land contact with any other territory (`nbStart[p] === nbStart[p + 1]`, FR-731) - so
 * continental coastlines and coastal skerries are never cluttered.
 */
export function buildIslandClusters(
  p: PieceIndex,
  clusterGap: number = ISLAND_MARKER_PARAMS.clusterGap,
  maxMapShare: number = ISLAND_MARKER_PARAMS.maxMapShare,
): readonly IslandCluster[] {
  const byEntry = new Map<number, number[]>();
  const hasLandNeighbor = new Uint8Array(p.entries);
  const maxIslandExtent = Math.max(p.width, p.height) * maxMapShare;

  for (let piece = 0; piece < p.entryOf.length; piece++) {
    const entry = p.entryOf[piece]!;
    if (entry <= 0) continue;
    if (p.nbStart[piece]! < p.nbStart[piece + 1]!) {
      hasLandNeighbor[entry] = 1;
    }
    let list = byEntry.get(entry);
    if (list === undefined) {
      list = [];
      byEntry.set(entry, list);
    }
    list.push(piece);
  }

  const gapSq = clusterGap * clusterGap;
  const clusters: IslandCluster[] = [];

  for (let entry = 1; entry < p.entries; entry++) {
    if (hasLandNeighbor[entry] === 1) continue;
    const list = byEntry.get(entry);
    if (list === undefined || list.length === 0) continue;

    // Largest piece extent (tie-broken by smallest first unit, matching mainPieces).
    let bestPiece = list[0]!;
    for (let i = 1; i < list.length; i++) {
      const piece = list[i]!;
      if (p.size[piece]! > p.size[bestPiece]! || (p.size[piece] === p.size[bestPiece] && p.first[piece]! < p.first[bestPiece]!)) {
        bestPiece = piece;
      }
    }
    const mb = bestPiece * 4;
    const mainExtent = Math.max(p.box[mb + 2]! - p.box[mb]! + 1, p.box[mb + 3]! - p.box[mb + 1]! + 1);
    if (mainExtent > maxIslandExtent) continue;

    // Union-find pieces of this entry within `clusterGap` map units.
    const n = list.length;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (a: number): number => {
      let r = a;
      while (parent[r] !== r) r = parent[r]!;
      while (parent[a] !== r) {
        const next = parent[a]!;
        parent[a] = r;
        a = next;
      }
      return r;
    };

    for (let i = 0; i < n; i++) {
      const bi = list[i]! * 4;
      const ax0 = p.box[bi]!;
      const ay0 = p.box[bi + 1]!;
      const ax1 = p.box[bi + 2]! + 1;
      const ay1 = p.box[bi + 3]! + 1;
      for (let j = i + 1; j < n; j++) {
        const bj = list[j]! * 4;
        const bx0 = p.box[bj]!;
        const by0 = p.box[bj + 1]!;
        const bx1 = p.box[bj + 2]! + 1;
        const by1 = p.box[bj + 3]! + 1;
        const dx = Math.max(0, Math.max(ax0 - bx1, bx0 - ax1));
        const dy = Math.max(0, Math.max(ay0 - by1, by0 - ay1));
        if (dx * dx + dy * dy <= gapSq) {
          const ra = find(i);
          const rb = find(j);
          if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
        }
      }
    }

    const boxes = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      const bi = list[i]! * 4;
      const x0 = p.box[bi]!;
      const y0 = p.box[bi + 1]!;
      const x1 = p.box[bi + 2]! + 1;
      const y1 = p.box[bi + 3]! + 1;
      const cur = boxes.get(root);
      if (cur === undefined) {
        boxes.set(root, { x0, y0, x1, y1 });
      } else {
        if (x0 < cur.x0) cur.x0 = x0;
        if (y0 < cur.y0) cur.y0 = y0;
        if (x1 > cur.x1) cur.x1 = x1;
        if (y1 > cur.y1) cur.y1 = y1;
      }
    }

    for (const root of [...boxes.keys()].sort((a, b) => a - b)) {
      const b = boxes.get(root)!;
      clusters.push({ entry, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, mainExtent });
    }
  }

  return clusters;
}

/** Zoom fade curve for an island marker given its territory's largest-piece screen extent in CSS px (FR-730). */
export function islandMarkerAlpha(piecePx: number, params: IslandMarkerParams = ISLAND_MARKER_PARAMS): number {
  return 1 - smoothstep(params.fullBelowPx, params.fadeOutPx, piecePx);
}

/**
 * Projects visible tiny-island clusters into screen-space Pacific-style dashed frames (FR-729, FR-730).
 * Culls off-screen clusters and fades markers out smoothly as real island geometry becomes legible.
 */
export function resolveIslandMarkers(
  clusters: readonly IslandCluster[],
  table: ArrayLike<number>,
  colors: readonly Rgb[],
  camera: Camera,
  viewport: Viewport,
  dim?: { readonly lit: readonly number[]; readonly dim: number },
  params: IslandMarkerParams = ISLAND_MARKER_PARAMS,
): IslandMarkerDraw[] {
  const out: IslandMarkerDraw[] = [];
  const halfW = viewport.width / 2;
  const halfH = viewport.height / 2;
  const dimActive = dim !== undefined && dim.dim > 0;

  for (const c of clusters) {
    const owner = table[c.entry] ?? 0;
    if (owner <= 0) continue;
    const zoomAlpha = islandMarkerAlpha(c.mainExtent * camera.scale, params);
    if (!(zoomAlpha > 0)) continue;
    const dimMul = dimActive && !dim.lit.includes(owner) ? params.dimAlpha : 1;
    const alpha = zoomAlpha * dimMul;
    if (!(alpha > 0)) continue;

    const sx0 = (c.x0 - camera.x) * camera.scale + halfW;
    const sy0 = (c.y0 - camera.y) * camera.scale + halfH;
    const sx1 = (c.x1 - camera.x) * camera.scale + halfW;
    const sy1 = (c.y1 - camera.y) * camera.scale + halfH;
    const rawW = sx1 - sx0 + params.padPx * 2;
    const rawH = sy1 - sy0 + params.padPx * 2;
    const minBox = Math.max(10, Math.min(params.minBoxPx, viewport.width * 0.028));
    const w = Math.max(minBox, rawW);
    const h = Math.max(minBox, rawH);
    const cx = (sx0 + sx1) / 2;
    const cy = (sy0 + sy1) / 2;
    const x = cx - w / 2;
    const y = cy - h / 2;
    if (x + w < 0 || y + h < 0 || x > viewport.width || y > viewport.height) continue;

    const color = colors[owner] ?? ([255, 255, 255] as Rgb);
    const radius = Math.min(params.cornerRadiusPx, w / 2, h / 2);
    out.push({ entry: c.entry, x, y, w, h, radius, color, alpha });
  }
  return out;
}
