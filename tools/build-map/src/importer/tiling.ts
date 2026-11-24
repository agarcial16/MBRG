import type { Result } from '@mbrg/shared';

/**
 * Spec 035 (ocean tiles): the pure core that splits the water of every basin (a sea zone as 028 builds it) into tiles.
 * It reads only the raster: water pixels carry the id of their basin, every other value is not water. Deterministic and
 * pure (NFR-175): fixed iteration orders, no ambient state, no clock, no randomness.
 */

/** FR-670: the resolved spacings of a tiling, in kilometres. */
export interface TilingConfig {
  /** Coast spacing: the tile edge where coast distance is at most `bandKm`. */
  tileKm: number;
  /** Open-sea spacing, from the band to `reachKm`. */
  openKm: number;
  /** Far spacing, beyond `reachKm`. */
  farKm: number;
  bandKm: number;
  reachKm: number;
}

/** One basin as the tiler sees it, in the FR-605 order. */
export interface TilingBasin {
  name: string;
  /** FR-674: a basin kept as one entry (`zones[name] = 0`). */
  whole: boolean;
  /** FR-670: the basin's own coast tile in km (`zones`); every spacing of the basin scales with it. Absent: the global one. */
  tileKm?: number;
}

/** FR-671: the search for `tileKm` that makes the number of seeds the largest not above a target. */
export interface TilingSearch {
  targetTiles: number;
  /** FR-670: spacings the author gave besides `tileKm`; they win over the derived ones. */
  overrides?: Partial<Omit<TilingConfig, 'tileKm'>>;
  /** The frame side in km (F of FR-671). */
  frameKm: number;
}

export interface TilingInput {
  width: number;
  /** The raster after the water pass: a water pixel carries `firstId + basin index`; nothing else is read as water. */
  pixels: Uint32Array;
  /** The id of the first basin; the basins hold consecutive ids (FR-605). */
  firstId: number;
  basins: readonly TilingBasin[];
  pixelKm: number;
  minPieceSize: number;
  maxTiles: number;
  /** Either the spacings in force, or the search of FR-671 that finds `tileKm` and derives the rest. */
  spacing: TilingConfig | TilingSearch;
}

/** One tile in FR-678 order: the basin it belongs to, the pixel of its seed and its pixel count. */
export interface Tile {
  basin: number;
  seed: number;
  pixels: number;
}

/** FR-676: a tile merged into its neighbour, for the report. */
export interface MergedTile {
  basin: number;
  pixels: number;
}

/** The per-basin facts of the report (FR-686). */
export interface BasinStat {
  pixels: number;
  pieces: number;
  tiles: number;
}

export interface TilingResult {
  /** The tile ordinal (into `tiles`) of every water pixel of a basin, -1 elsewhere. */
  labels: Int32Array;
  tiles: Tile[];
  /** The spacings in force. */
  config: TilingConfig;
  /** The number of seeds before merges (what FR-671 counts and FR-685 caps). */
  seeds: number;
  merged: MergedTile[];
  basins: BasinStat[];
}

export type TilingError = { kind: 'too-many-tiles'; cap: number; count: number; basins: { basin: number; tiles: number }[] };

/** FR-674: a piece with fewer pixels than this and no seed of its own joins the nearest tile of its basin. */
const TINY_PIECE = 30;
const WEIGHT_ORTHOGONAL = 5;
const WEIGHT_DIAGONAL = 7;
const WEIGHT_KNIGHT = 11;
/** The largest edge weight plus one: the Dial queue keeps this many buckets. */
const BUCKETS = WEIGHT_KNIGHT + 1;

const isSearch = (s: TilingConfig | TilingSearch): s is TilingSearch => 'targetTiles' in s;

/** FR-671: the other spacings from the coast tile. */
export function configFromTile(tileKm: number, overrides: Partial<Omit<TilingConfig, 'tileKm'>> = {}): TilingConfig {
  return { tileKm, openKm: overrides.openKm ?? 2 * tileKm, farKm: overrides.farKm ?? 4 * tileKm, bandKm: overrides.bandKm ?? tileKm, reachKm: overrides.reachKm ?? 6 * tileKm };
}

interface Piece {
  basin: number;
  size: number;
  sx: number;
  sy: number;
}

interface Seed {
  pixel: number;
  piece: number;
}

/** One pass of the exact squared Euclidean distance transform over `d[0..len)` (Felzenszwalb and Huttenlocher). */
function distancePass(d: Float64Array, out: Float64Array, len: number, v: Int32Array, z: Float64Array, inf: number): void {
  let k = 0;
  v[0] = 0;
  z[0] = -inf;
  z[1] = inf;
  for (let q = 1; q < len; q++) {
    let s: number;
    for (;;) {
      const p = v[k]!;
      s = (d[q]! + q * q - (d[p]! + p * p)) / (2 * q - 2 * p);
      if (s <= z[k]!) k--;
      else break;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = inf;
  }
  k = 0;
  for (let q = 0; q < len; q++) {
    while (z[k + 1]! < q) k++;
    const p = v[k]!;
    out[q] = (q - p) * (q - p) + d[p]!;
  }
}

/** The squared distance, in pixels, from every pixel to the nearest pixel that is not water (exact, Euclidean). */
function coastDistanceSquared(width: number, isWater: Uint8Array): Float32Array {
  const total = width * width;
  const INF = 1e12;
  const f = new Float32Array(total);
  for (let i = 0; i < total; i++) f[i] = isWater[i]! ? INF : 0;
  const d = new Float64Array(width);
  const out = new Float64Array(width);
  const v = new Int32Array(width);
  const z = new Float64Array(width + 1);
  for (let x = 0; x < width; x++) {
    for (let q = 0; q < width; q++) d[q] = f[q * width + x]!;
    distancePass(d, out, width, v, z, INF * 10);
    for (let q = 0; q < width; q++) f[q * width + x] = out[q]!;
  }
  for (let y = 0; y < width; y++) {
    const row = y * width;
    for (let q = 0; q < width; q++) d[q] = f[row + q]!;
    distancePass(d, out, width, v, z, INF * 10);
    for (let q = 0; q < width; q++) f[row + q] = out[q]!;
  }
  return f;
}

/**
 * FR-674: the 4-connected pieces of every basin, labelled in row-major order of their first pixel; `piece[i]` is -1 on
 * every pixel that is not water of a basin.
 */
function labelBasinPieces(width: number, basinOf: Int32Array): { piece: Int32Array; pieces: Piece[] } {
  const total = width * width;
  const piece = new Int32Array(total).fill(-1);
  const pieces: Piece[] = [];
  const stack = new Int32Array(total);
  for (let start = 0; start < total; start++) {
    if (basinOf[start]! < 0 || piece[start]! >= 0) continue;
    const basin = basinOf[start]!;
    const id = pieces.length;
    const info: Piece = { basin, size: 0, sx: 0, sy: 0 };
    let top = 0;
    stack[top++] = start;
    piece[start] = id;
    while (top > 0) {
      const p = stack[--top]!;
      const x = p % width;
      const y = (p - x) / width;
      info.size++;
      info.sx += x;
      info.sy += y;
      if (x > 0 && piece[p - 1]! < 0 && basinOf[p - 1] === basin) {
        piece[p - 1] = id;
        stack[top++] = p - 1;
      }
      if (x < width - 1 && piece[p + 1]! < 0 && basinOf[p + 1] === basin) {
        piece[p + 1] = id;
        stack[top++] = p + 1;
      }
      if (y > 0 && piece[p - width]! < 0 && basinOf[p - width] === basin) {
        piece[p - width] = id;
        stack[top++] = p - width;
      }
      if (y < width - 1 && piece[p + width]! < 0 && basinOf[p + width] === basin) {
        piece[p + width] = id;
        stack[top++] = p + width;
      }
    }
    pieces.push(info);
  }
  return { piece, pieces };
}

/** The per-piece spacings in pixels. */
interface PieceSpacing {
  tile: Float64Array;
  open: Float64Array;
  far: Float64Array;
  band: Float64Array;
  reach: Float64Array;
}

/** The factor that scales every spacing of a basin: its own `tileKm` over the global one. */
const scaleOf = (basin: TilingBasin, config: TilingConfig): number => (basin.tileKm === undefined ? 1 : basin.tileKm / config.tileKm);

function pieceSpacing(pieces: readonly Piece[], basins: readonly TilingBasin[], config: TilingConfig, pixelKm: number): PieceSpacing {
  const n = pieces.length;
  const out: PieceSpacing = { tile: new Float64Array(n), open: new Float64Array(n), far: new Float64Array(n), band: new Float64Array(n), reach: new Float64Array(n) };
  pieces.forEach((p, i) => {
    const s = scaleOf(basins[p.basin]!, config) / pixelKm;
    out.tile[i] = config.tileKm * s;
    out.open[i] = config.openKm * s;
    out.far[i] = config.farKm * s;
    out.band[i] = config.bandKm * s;
    out.reach[i] = config.reachKm * s;
  });
  return out;
}

/** The shared per-raster facts every seeding run reads. */
interface Field {
  width: number;
  piece: Int32Array;
  pieces: Piece[];
  /** Water pixels of the basins that get seeds, by coast distance (ceil, in pixels), row-major inside a distance. */
  order: Int32Array;
  distance: Uint16Array;
  /** Per basin: whole basins are not seeded. */
  whole: Uint8Array;
}

/**
 * FR-674: Poisson-disc seeding by increasing coast distance, then row-major order. A candidate is refused when a seed of
 * its piece lies closer than the spacing at the candidate (the later of the two, because the order only grows in coast
 * distance and so in spacing). One bitmap per tier keeps the test O(1): a seed stamps the disk of its own tier's
 * spacing for the tiers it can block.
 */
function seed(field: Field, basins: readonly TilingBasin[], config: TilingConfig, pixelKm: number): Seed[] {
  const { width, piece, pieces, order, distance } = field;
  const sp = pieceSpacing(pieces, basins, config, pixelKm);
  const total = width * width;
  const coverBand = new Uint8Array(total);
  const coverOpen = new Uint8Array(total);
  const coverFar = new Uint8Array(total);
  const seeds: Seed[] = [];
  const stamp = (cover: Uint8Array, cx: number, cy: number, radius: number, id: number): void => {
    const r = Math.ceil(radius);
    const r2 = radius * radius;
    const y0 = Math.max(0, cy - r);
    const y1 = Math.min(width - 1, cy + r);
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      const rest = r2 - dy * dy;
      if (rest <= 0) continue;
      // the pixels with dx^2 + dy^2 < r^2: |dx| <= ceil(sqrt(rest)) - 1
      const half = Math.ceil(Math.sqrt(rest)) - 1;
      const x0 = Math.max(0, cx - half);
      const x1 = Math.min(width - 1, cx + half);
      for (let p = y * width + x0, end = y * width + x1; p <= end; p++) if (piece[p] === id) cover[p] = 1;
    }
  };
  for (let k = 0; k < order.length; k++) {
    const p = order[k]!;
    const id = piece[p]!;
    const d = distance[p]!;
    const x = p % width;
    const y = (p - x) / width;
    if (d <= sp.band[id]!) {
      if (coverBand[p]) continue;
      seeds.push({ pixel: p, piece: id });
      stamp(coverBand, x, y, sp.tile[id]!, id);
      stamp(coverOpen, x, y, sp.open[id]!, id);
      stamp(coverFar, x, y, sp.far[id]!, id);
    } else if (d <= sp.reach[id]!) {
      if (coverOpen[p]) continue;
      seeds.push({ pixel: p, piece: id });
      stamp(coverOpen, x, y, sp.open[id]!, id);
      stamp(coverFar, x, y, sp.far[id]!, id);
    } else {
      if (coverFar[p]) continue;
      seeds.push({ pixel: p, piece: id });
      stamp(coverFar, x, y, sp.far[id]!, id);
    }
  }
  return seeds;
}

/** The seed order every later tie goes by: seeds sorted by pixel (row-major). */
function inSeedOrder(seeds: Seed[]): Seed[] {
  return seeds.sort((x, y) => x.pixel - y.pixel);
}

/** The 16 steps of the chamfer: orthogonal (5), diagonal (7) and knight (11) moves. */
const STEPS: readonly { dx: number; dy: number; w: number }[] = [
  { dx: -1, dy: 0, w: WEIGHT_ORTHOGONAL },
  { dx: 1, dy: 0, w: WEIGHT_ORTHOGONAL },
  { dx: 0, dy: -1, w: WEIGHT_ORTHOGONAL },
  { dx: 0, dy: 1, w: WEIGHT_ORTHOGONAL },
  { dx: -1, dy: -1, w: WEIGHT_DIAGONAL },
  { dx: 1, dy: -1, w: WEIGHT_DIAGONAL },
  { dx: -1, dy: 1, w: WEIGHT_DIAGONAL },
  { dx: 1, dy: 1, w: WEIGHT_DIAGONAL },
  { dx: -1, dy: -2, w: WEIGHT_KNIGHT },
  { dx: 1, dy: -2, w: WEIGHT_KNIGHT },
  { dx: -1, dy: 2, w: WEIGHT_KNIGHT },
  { dx: 1, dy: 2, w: WEIGHT_KNIGHT },
  { dx: -2, dy: -1, w: WEIGHT_KNIGHT },
  { dx: 2, dy: -1, w: WEIGHT_KNIGHT },
  { dx: -2, dy: 1, w: WEIGHT_KNIGHT },
  { dx: 2, dy: 1, w: WEIGHT_KNIGHT },
];
const STEP_COUNT = STEPS.length;
const STEP_DX = Int32Array.from(STEPS, (s) => s.dx);
const STEP_DY = Int32Array.from(STEPS, (s) => s.dy);
const STEP_W = Int32Array.from(STEPS, (s) => s.w);
/** 0: orthogonal, 1: diagonal, 2: knight. */
const STEP_KIND = Int32Array.from(STEPS, (s) => (s.dx === 0 || s.dy === 0 ? 0 : Math.abs(s.dx) === Math.abs(s.dy) ? 1 : 2));
/** The long-axis half of a knight step. */
const STEP_MX = Int32Array.from(STEPS, (s) => (Math.abs(s.dx) === 2 ? Math.sign(s.dx) : 0));
const STEP_MY = Int32Array.from(STEPS, (s) => (Math.abs(s.dy) === 2 ? Math.sign(s.dy) : 0));

/** Whether the pixel (x, y) is inside the image and in the piece `id`. */
function inPiece(piece: Int32Array, width: number, id: number, x: number, y: number): boolean {
  return x >= 0 && x < width && y >= 0 && y < width && piece[y * width + x] === id;
}

/**
 * FR-675: every pixel of a piece goes to the tile of the nearest seed by distance through the piece's own water. The
 * distance is a 5-7-11 chamfer (orthogonal, diagonal and knight steps) searched with a circular Dial queue: within 1.5%
 * of the Euclidean distance, so a border on open water is the bisector of the seeds within a pixel up to 100 pixels
 * apart. A step across a pinch point (the pixels it squeezes between are all outside the piece) is refused, so a tile
 * never reaches across land. Ties go to the first seed in seed order, exactly: a label improves on equal distance.
 */
function partition(field: Field, seeds: readonly Seed[]): Int32Array {
  const { width, piece } = field;
  const total = width * width;
  const dist = new Int32Array(total).fill(0x7fffffff);
  const label = new Int32Array(total).fill(-1);
  const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
  const STEP_OFFSET = Int32Array.from(STEPS, (st) => st.dy * width + st.dx);
  let pending = 0;
  seeds.forEach((s, i) => {
    dist[s.pixel] = 0;
    label[s.pixel] = i;
    buckets[0]!.push(s.pixel);
    pending++;
  });
  for (let d = 0; pending > 0; d++) {
    const bucket = buckets[d % BUCKETS]!;
    for (let k = 0; k < bucket.length; k++) {
      const p = bucket[k]!;
      pending--;
      if (dist[p] !== d) continue;
      const id = piece[p]!;
      const l = label[p]!;
      const x = p % width;
      const y = (p - x) / width;
      const interior = x >= 2 && x < width - 2 && y >= 2 && y < width - 2;
      for (let s = 0; s < STEP_COUNT; s++) {
        const dx = STEP_DX[s]!;
        const dy = STEP_DY[s]!;
        let to: number;
        if (interior) to = p + STEP_OFFSET[s]!;
        else {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= width) continue;
          to = ny * width + nx;
        }
        if (piece[to] !== id) continue;
        const nd = d + STEP_W[s]!;
        const known = dist[to]!;
        // a step that cannot improve the pixel needs no pinch check
        if (nd > known || (nd === known && l >= label[to]!)) continue;
        if (STEP_KIND[s]! !== 0) {
          if (STEP_KIND[s] === 1) {
            if (!inPiece(piece, width, id, x + dx, y) && !inPiece(piece, width, id, x, y + dy)) continue;
          } else {
            // a knight step is two steps (one along its long axis, one diagonal): refused when neither route has an open pixel
            const mx = STEP_MX[s]!;
            const my = STEP_MY[s]!;
            if (!inPiece(piece, width, id, x + mx, y + my) && !inPiece(piece, width, id, x + dx - mx, y + dy - my)) continue;
          }
        }
        if (nd < known) {
          dist[to] = nd;
          label[to] = l;
          buckets[nd % BUCKETS]!.push(to);
          pending++;
        } else label[to] = l;
      }
    }
    bucket.length = 0;
  }
  return label;
}

/**
 * FR-674, FR-676, FR-682: the pixels no seed reached (a piece under 30 pixels or one that links to nothing, with no seed of its own) join the tile of their
 * basin whose seed is nearest by squared distance between pixel centres, ties to the first seed.
 */
function joinTinyPieces(field: Field, seeds: readonly Seed[], label: Int32Array): void {
  const { piece, pieces, width, whole } = field;
  const byBasin = new Map<number, number[]>();
  seeds.forEach((s, i) => {
    const basin = pieces[s.piece]!.basin;
    const list = byBasin.get(basin);
    if (list === undefined) byBasin.set(basin, [i]);
    else list.push(i);
  });
  const chosen = new Map<number, number>();
  const total = width * width;
  for (let i = 0; i < total; i++) {
    const id = piece[i]!;
    if (id < 0 || label[i]! >= 0 || whole[pieces[id]!.basin]) continue;
    let target = chosen.get(id);
    if (target === undefined) {
      const p = pieces[id]!;
      const list = byBasin.get(p.basin) ?? [];
      let best = list[0] ?? -1;
      let bestD = Infinity;
      for (const s of list) {
        const sx = seeds[s]!.pixel % width;
        const sy = (seeds[s]!.pixel - sx) / width;
        const dd = (sx - p.sx / p.size) ** 2 + (sy - p.sy / p.size) ** 2;
        if (dd < bestD) {
          bestD = dd;
          best = s;
        }
      }
      target = best;
      chosen.set(id, target);
    }
    label[i] = target;
  }
}

/**
 * FR-676: a tile under `max(S, 0.1 x spacing^2)` pixels merges into the tile of its piece that shares the longest border
 * with it (ties to the lower tile order), smallest first. Returns the surviving ordinals relabelled 0..m-1 in seed order.
 */
function mergeSmall(
  field: Field,
  seeds: readonly Seed[],
  label: Int32Array,
  minPieceSize: number,
  threshold: (seed: Seed) => number,
): { count: number; merged: MergedTile[]; origin: Int32Array } {
  const { width, piece, pieces } = field;
  const n = seeds.length;
  const size = new Float64Array(n);
  const total = width * width;
  const border = new Map<number, number>();
  const key = (a: number, b: number): number => (a < b ? a * 1_000_000 + b : b * 1_000_000 + a);
  for (let i = 0; i < total; i++) {
    const t = label[i]!;
    if (piece[i]! < 0 || t < 0) continue;
    size[t]!++;
    const x = i % width;
    if (x < width - 1 && piece[i + 1] === piece[i] && label[i + 1] !== t && label[i + 1]! >= 0) {
      const k = key(t, label[i + 1]!);
      border.set(k, (border.get(k) ?? 0) + 1);
    }
    if (i < total - width && piece[i + width] === piece[i] && label[i + width] !== t && label[i + width]! >= 0) {
      const k = key(t, label[i + width]!);
      border.set(k, (border.get(k) ?? 0) + 1);
    }
  }
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!;
      a = parent[a]!;
    }
    return a;
  };
  const adjacency: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  for (const [k, c] of border) {
    const a = Math.floor(k / 1_000_000);
    const b = k % 1_000_000;
    adjacency[a]!.set(b, c);
    adjacency[b]!.set(a, c);
  }
  const need = seeds.map((s) => Math.max(minPieceSize, threshold(s)));
  const merged: MergedTile[] = [];
  for (;;) {
    let small = -1;
    for (let i = 0; i < n; i++) {
      if (find(i) !== i || size[i]! >= need[i]! || adjacency[i]!.size === 0) continue;
      if (small < 0 || size[i]! < size[small]!) small = i;
    }
    if (small < 0) break;
    let best = -1;
    let bestCount = -1;
    for (const [nb, c] of adjacency[small]!) {
      if (c > bestCount || (c === bestCount && nb < best)) {
        bestCount = c;
        best = nb;
      }
    }
    parent[small] = best;
    merged.push({ basin: pieces[seeds[small]!.piece]!.basin, pixels: size[small]! });
    size[best]! += size[small]!;
    for (const [nb, c] of adjacency[small]!) {
      if (nb === best) continue;
      adjacency[nb]!.delete(small);
      adjacency[nb]!.set(best, (adjacency[nb]!.get(best) ?? 0) + c);
      adjacency[best]!.set(nb, (adjacency[best]!.get(nb) ?? 0) + c);
    }
    adjacency[best]!.delete(small);
    adjacency[small] = new Map();
  }
  const origin = new Int32Array(n).fill(-1);
  let count = 0;
  for (let i = 0; i < n; i++) if (find(i) === i) origin[i] = count++;
  const relabel = new Int32Array(n);
  for (let i = 0; i < n; i++) relabel[i] = origin[find(i)]!;
  for (let i = 0; i < total; i++) if (label[i]! >= 0) label[i] = relabel[label[i]!]!;
  const survivors = new Int32Array(count);
  for (let i = 0; i < n; i++) if (origin[i]! >= 0) survivors[origin[i]!] = i;
  return { count, merged, origin: survivors };
}

/** The seeds of FR-674 at a coast tile, for the search of FR-671 (counting only). */
function countSeeds(field: Field, basins: readonly TilingBasin[], config: TilingConfig, pixelKm: number): number {
  return seed(field, basins, config, pixelKm).length;
}

/**
 * FR-671: the coast tile whose seed count is not above the target and, when the search can, within 10% of it. Every
 * spacing scales with the coast tile, so the count falls with the square of it: each seeding is followed by one step
 * `tile x sqrt(count / target)`, at most 6 seedings, then 1% steps up until the count fits. The tile is a whole number
 * of kilometres rounded up (never below 3 pixels). A basin kept whole counts as one seed.
 */
function searchTile(field: Field, basins: readonly TilingBasin[], search: TilingSearch, pixelKm: number, wholeBasins: Uint8Array): number {
  const floor = 3 * pixelKm;
  const wholeCount = wholeBasins.reduce((n, w) => n + w, 0);
  const count = (km: number): number => countSeeds(field, basins, configFromTile(km, search.overrides), pixelKm) + wholeCount;
  const water = field.pieces.reduce((n, p) => n + p.size, 0) * pixelKm * pixelKm;
  let km = Math.min(search.frameKm, Math.max(floor, Math.sqrt(water / Math.max(1, search.targetTiles)) * 1.2));
  let best = Infinity;
  for (let step = 0; step < 6; step++) {
    km = roundTile(km, floor);
    const n = count(km);
    if (n <= search.targetTiles) {
      if (km < best) best = km;
      if (n >= 0.9 * search.targetTiles || km <= floor) return best;
    } else if (km >= search.frameKm) break;
    const next = km * Math.sqrt(Math.max(n, 1) / search.targetTiles);
    km = n <= search.targetTiles ? Math.min(next, best - 1) : Math.max(next, km + 1);
    if (km < floor) km = floor;
  }
  if (best < Infinity) return best;
  km = roundTile(km, floor);
  while (count(km) > search.targetTiles && km < search.frameKm) km = Math.max(km + 1, Math.ceil(km * 1.01));
  return km;
}

/** FR-671: whole kilometres rounded up, never below 3 pixels. */
function roundTile(km: number, floor: number): number {
  return Math.max(Math.ceil(km), floor);
}

/**
 * FR-673 to FR-677, FR-685: splits the water of every basin into tiles. Returns the tile of every water pixel and the
 * tiles in FR-678 order (basins in input order, the tiles of a basin by the row-major position of their seed pixel), or
 * `too-many-tiles` when the seeds exceed `maxTiles` (before any partition is computed).
 */
export function tileBasins(input: TilingInput): Result<TilingResult, TilingError> {
  const { width, pixels, firstId, basins } = input;
  const total = width * width;
  const basinOf = new Int32Array(total).fill(-1);
  for (let i = 0; i < total; i++) {
    const b = pixels[i]! - firstId;
    if (b >= 0 && b < basins.length) basinOf[i] = b;
  }
  const isWater = new Uint8Array(total);
  for (let i = 0; i < total; i++) isWater[i] = basinOf[i]! >= 0 ? 1 : 0;
  const { piece, pieces } = labelBasinPieces(width, basinOf);

  // Basins kept whole: by the override, or because they do not hold more than one tile of their own (FR-674).
  const basinPixels = new Float64Array(basins.length);
  for (const p of pieces) basinPixels[p.basin]! += p.size;
  const whole = new Uint8Array(basins.length);
  const knownConfig = isSearch(input.spacing) ? undefined : input.spacing;
  basins.forEach((b, i) => {
    if (b.whole) whole[i] = 1;
    else if (knownConfig !== undefined) {
      const tile = (knownConfig.tileKm * scaleOf(b, knownConfig)) / input.pixelKm;
      if (basinPixels[i]! <= tile * tile) whole[i] = 1;
    }
  });

  // The candidates: water pixels of the basins that get seeds, by coast distance, then row-major.
  // FR-674, FR-682: a piece under 30 pixels, and a piece that touches no land territory and no other basin (water
  // enclosed in other land that joined this basin), gets no seed when its basin has another piece: it joins the nearest
  // tile of its basin, as an entry with a piece apart does in 028, and never becomes a tile that links to nothing.
  const linked = new Uint8Array(pieces.length);
  for (let i = 0; i < total; i++) {
    const id = piece[i]!;
    if (id < 0 || linked[id]) continue;
    const x = i % width;
    const own = basinOf[i]!;
    for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i >= width ? i - width : -1, i < total - width ? i + width : -1]) {
      if (j < 0) continue;
      if (basinOf[j] === own) continue;
      const v = pixels[j]!;
      // another basin's water or a land territory (ids 1 .. firstId - 1); 0 and anything else is not a link
      if (basinOf[j]! >= 0 || (v >= 1 && v < firstId)) {
        linked[id] = 1;
        break;
      }
    }
  }
  const standalone = (id: number): boolean => pieces[id]!.size >= TINY_PIECE && linked[id] === 1;
  const hasStandalone = new Uint8Array(basins.length);
  pieces.forEach((p, id) => {
    if (standalone(id)) hasStandalone[p.basin] = 1;
  });
  const seeded = (i: number): boolean => {
    const id = piece[i]!;
    const basin = pieces[id]!.basin;
    return !whole[basin] && (standalone(id) || !hasStandalone[basin]);
  };
  const distance = new Uint16Array(total);
  const e2 = coastDistanceSquared(width, isWater);
  let maxD = 0;
  let candidates = 0;
  for (let i = 0; i < total; i++) {
    if (!isWater[i] || !seeded(i)) continue;
    const d = Math.min(65535, Math.ceil(Math.sqrt(e2[i]!)));
    distance[i] = d;
    if (d > maxD) maxD = d;
    candidates++;
  }
  const counts = new Int32Array(maxD + 2);
  for (let i = 0; i < total; i++) if (isWater[i] && seeded(i)) counts[distance[i]! + 1]!++;
  for (let d = 1; d < counts.length; d++) counts[d]! += counts[d - 1]!;
  const order = new Int32Array(candidates);
  for (let i = 0; i < total; i++) if (isWater[i] && seeded(i)) order[counts[distance[i]!]!++] = i;
  let field: Field = { width, piece, pieces, order, distance, whole };

  let config: TilingConfig;
  if (isSearch(input.spacing)) {
    // a basin that fits one tile of the searched size stays whole too, but the search counts it as one seed at most
    config = configFromTile(searchTile(field, basins, input.spacing, input.pixelKm, whole), input.spacing.overrides);
    let newlyWhole = false;
    basins.forEach((b, i) => {
      if (!b.whole && basinPixels[i]! <= ((config.tileKm * scaleOf(b, config)) / input.pixelKm) ** 2) {
        whole[i] = 1;
        newlyWhole = true;
      }
    });
    if (newlyWhole) field = { ...field, order: order.filter((p) => !whole[basinOf[p]!]) };
  } else config = input.spacing;

  const wholeSeeds: Seed[] = [];
  const firstPixel = new Int32Array(basins.length).fill(-1);
  for (let i = 0; i < total; i++) {
    const b = basinOf[i]!;
    if (b >= 0 && whole[b] && firstPixel[b]! < 0) firstPixel[b] = i;
  }
  basins.forEach((_, b) => {
    if (whole[b] && firstPixel[b]! >= 0) wholeSeeds.push({ pixel: firstPixel[b]!, piece: piece[firstPixel[b]!]! });
  });

  const seeds = inSeedOrder(seed(field, basins, config, input.pixelKm));
  const count = seeds.length + wholeSeeds.length;
  if (count > input.maxTiles) {
    const perBasin = new Map<number, number>();
    for (const s of seeds) perBasin.set(pieces[s.piece]!.basin, (perBasin.get(pieces[s.piece]!.basin) ?? 0) + 1);
    const biggest = [...perBasin].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 5).map(([basin, tiles]) => ({ basin, tiles }));
    return { ok: false, errors: [{ kind: 'too-many-tiles', cap: input.maxTiles, count, basins: biggest }] };
  }

  const label = partition(field, seeds);
  joinTinyPieces(field, seeds, label);
  const spacing = pieceSpacing(pieces, basins, config, input.pixelKm);
  const merge = mergeSmall(field, seeds, label, input.minPieceSize, (s) => {
    const d = distance[s.pixel]!;
    const id = s.piece;
    const px = d <= spacing.band[id]! ? spacing.tile[id]! : d <= spacing.reach[id]! ? spacing.open[id]! : spacing.far[id]!;
    return 0.1 * px * px;
  });

  // The tiles of the seeded basins, then the whole basins, in FR-678 order: basin by basin, seed pixel ascending.
  const tilesOfBasin: { seed: number; ordinal: number; whole: boolean }[][] = basins.map(() => []);
  for (let t = 0; t < merge.count; t++) {
    const s = seeds[merge.origin[t]!]!;
    tilesOfBasin[pieces[s.piece]!.basin]!.push({ seed: s.pixel, ordinal: t, whole: false });
  }
  basins.forEach((_, b) => {
    if (whole[b] && firstPixel[b]! >= 0) tilesOfBasin[b]!.push({ seed: firstPixel[b]!, ordinal: -1, whole: true });
  });
  const tiles: Tile[] = [];
  const finalOf = new Int32Array(merge.count).fill(-1);
  const wholeFinal = new Int32Array(basins.length).fill(-1);
  const stats: BasinStat[] = basins.map(() => ({ pixels: 0, pieces: 0, tiles: 0 }));
  for (const p of pieces) {
    stats[p.basin]!.pixels += p.size;
    stats[p.basin]!.pieces++;
  }
  tilesOfBasin.forEach((list, b) => {
    list.sort((x, y) => x.seed - y.seed);
    for (const t of list) {
      const ordinal = tiles.length;
      tiles.push({ basin: b, seed: t.seed, pixels: 0 });
      if (t.whole) wholeFinal[b] = ordinal;
      else finalOf[t.ordinal] = ordinal;
      stats[b]!.tiles++;
    }
  });
  const labels = new Int32Array(total).fill(-1);
  for (let i = 0; i < total; i++) {
    const b = basinOf[i]!;
    if (b < 0) continue;
    const t = whole[b] ? wholeFinal[b]! : finalOf[label[i]!]!;
    labels[i] = t;
    tiles[t]!.pixels++;
  }
  return { ok: true, value: { labels, tiles, config, seeds: count, merged: merge.merged, basins: stats } };
}
