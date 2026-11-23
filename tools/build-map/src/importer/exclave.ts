import { contactPairs } from '@mbrg/shared';

/** FR-602: the reach in pixels used when the curation gives no `exclaveReach`. */
export const DEFAULT_EXCLAVE_REACH = 64;

/** FR-602: how many territories of the main group an exclave group is linked to. */
export const EXCLAVE_LINKS = 3;

/** What the exclave pass takes. `pixels` is the final raster (no water left) and is updated in place. */
export interface ExclaveInput {
  width: number;
  pixels: Uint32Array;
  /** The ids of the land territories. */
  landIds: readonly number[];
  /** The ids of the sea zones. */
  seaIds: readonly number[];
  /** The farthest a territory may lie, in pixels between pixel centres; 0 turns the pass off. */
  reach: number;
  /** The number of territories to link each group to. */
  links: number;
}

/** FR-602: one bridge, in the order they were drawn. */
export interface Bridge {
  /** The land territory of the exclave group that drew it. */
  from: number;
  /** The land territory it reaches. */
  to: number;
  /** The pixels painted in `from`'s id. */
  pixels: number;
  /** How many of them replaced sea pixels. */
  water: number;
  /** The distance between the two nearest pixels, rounded to two decimals. */
  distance: number;
}

/** FR-602: a group of land territories with no territory of the main group within the reach. */
export interface UnreachableExclave {
  kind: 'unreachable-exclave';
  /** The land territories of the group, in id order. */
  territories: number[];
  reach: number;
}

export type ExclaveResult = { ok: true; bridges: Bridge[] } | { ok: false; errors: UnreachableExclave[] };

/** The groups of entries linked by pixel contact: land and sea entries, each as a sorted id list, in order of their lowest id. */
function groupsOf(width: number, pixels: Uint32Array, ids: readonly number[]): number[][] {
  const parent = new Map<number, number>();
  for (const id of ids) parent.set(id, id);
  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const pairs = contactPairs(width, width, pixels);
  if (pairs.ok) {
    for (const [a, b] of pairs.value) {
      if (!parent.has(a) || !parent.has(b)) continue;
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
    }
  }
  const byRoot = new Map<number, number[]>();
  for (const id of [...ids].sort((x, y) => x - y)) {
    const root = find(id);
    const list = byRoot.get(root);
    if (list) list.push(id);
    else byRoot.set(root, [id]);
  }
  return [...byRoot.values()].sort((x, y) => x[0]! - y[0]!);
}

/**
 * FR-602: the pixels of a 4-connected line from (ax, ay) to (bx, by), both ends excluded, in order from a to b. Each step
 * moves along one axis, on the side the true line is nearer to, so consecutive pixels always share an edge.
 */
function linePixels(ax: number, ay: number, bx: number, by: number): [number, number][] {
  const nx = Math.abs(bx - ax);
  const ny = Math.abs(by - ay);
  const sx = Math.sign(bx - ax);
  const sy = Math.sign(by - ay);
  const out: [number, number][] = [];
  let x = ax;
  let y = ay;
  let ix = 0;
  let iy = 0;
  while (ix < nx || iy < ny) {
    if ((0.5 + ix) / nx < (0.5 + iy) / ny) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    out.push([x, y]);
  }
  out.pop();
  return out;
}

/**
 * FR-602: a group of land territories that touches no territory of the main group (the largest group linked by pixel
 * contact, ties to the lowest id), an exclave such as Llivia inside France, is linked to the nearest ones. For each
 * territory of the main group within `reach` pixels (the distance between the nearest pixels of the two, pixel centres),
 * nearest first and ties to the lower id, a 4-connected line of the exclave's own id is painted from its nearest pixel to
 * that pixel, over other land and over sea; the line stops at the first land territory it meets, which takes the link
 * (a territory is linked once), until `links` territories are linked. A line over sea pixels is flanked: the sea pixels
 * 4-adjacent to it become other land, so the exclave never touches the zone, the zone keeps its id and its neighbours,
 * and may be cut into several pieces. A group linked to the main group takes part as a target for the groups after it, so
 * a chain of exclaves resolves. A group with no territory in reach fails the whole pass with `unreachable-exclave` and the
 * pixels stay as they were. Pure apart from the pixels it paints.
 */
export function bridgeExclaves(input: ExclaveInput): ExclaveResult {
  const { width, pixels, reach, links } = input;
  if (reach <= 0 || links <= 0) return { ok: true, bridges: [] };
  const ids = [...input.landIds, ...input.seaIds];
  const all = groupsOf(width, pixels, ids);
  const landSet = new Set(input.landIds);
  const landOf = (group: readonly number[]): number[] => group.filter((id) => landSet.has(id));
  const landCount = (group: readonly number[]): number => landOf(group).length;
  let mainIndex = -1;
  all.forEach((g, i) => {
    if (mainIndex === -1 || landCount(g) > landCount(all[mainIndex]!)) mainIndex = i;
  });
  const pending = all.filter((g, i) => i !== mainIndex && landCount(g) > 0);
  if (pending.length === 0) return { ok: true, bridges: [] };

  const backup = pixels.slice();
  let maxId = 0;
  for (const id of ids) if (id > maxId) maxId = id;
  const isSea = new Uint8Array(maxId + 1);
  for (const id of input.seaIds) isSea[id] = 1;
  const isLand = new Uint8Array(maxId + 1);
  for (const id of input.landIds) isLand[id] = 1;
  const mainLand = new Uint8Array(maxId + 1);
  for (const id of landOf(all[mainIndex]!)) mainLand[id] = 1;

  const bridges: Bridge[] = [];
  let remaining = pending;
  for (let progress = true; progress && remaining.length > 0; ) {
    progress = false;
    const next: number[][] = [];
    for (const group of remaining) {
      const own = new Uint8Array(maxId + 1);
      for (const id of landOf(group)) own[id] = 1;
      const made = bridgeGroup(input, own, mainLand, isLand, isSea);
      if (made.length === 0) {
        next.push(group);
        continue;
      }
      bridges.push(...made);
      for (const id of landOf(group)) mainLand[id] = 1;
      progress = true;
    }
    remaining = next;
  }
  if (remaining.length > 0) {
    pixels.set(backup);
    return { ok: false, errors: remaining.map((g) => ({ kind: 'unreachable-exclave', territories: landOf(g), reach })) };
  }
  return { ok: true, bridges };
}

/** The bridges of one group: nothing when no territory of the main group is within the reach. */
function bridgeGroup(input: ExclaveInput, own: Uint8Array, mainLand: Uint8Array, isLand: Uint8Array, isSea: Uint8Array): Bridge[] {
  const { width, pixels, reach, links } = input;
  const total = width * width;
  const reach2 = reach * reach;
  // the rim of the group: its pixels with a different value in the 8-neighbourhood
  const rim: number[] = [];
  for (let p = 0; p < total; p++) {
    const v = pixels[p]!;
    if (v >= own.length || own[v] === 0) continue;
    const x = p % width;
    const y = (p - x) / width;
    let edge = false;
    for (let dy = -1; dy <= 1 && !edge; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || xx >= width || yy < 0 || yy >= width) continue;
        if (pixels[yy * width + xx] !== v) {
          edge = true;
          break;
        }
      }
    }
    if (edge) rim.push(p);
  }
  // the nearest pair of pixels to each territory of the main group
  const best = new Map<number, { d2: number; a: number; b: number }>();
  for (const a of rim) {
    const ax = a % width;
    const ay = (a - ax) / width;
    for (let dy = -reach; dy <= reach; dy++) {
      const y = ay + dy;
      if (y < 0 || y >= width) continue;
      for (let dx = -reach; dx <= reach; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > reach2) continue;
        const x = ax + dx;
        if (x < 0 || x >= width) continue;
        const b = y * width + x;
        const v = pixels[b]!;
        if (v >= mainLand.length || mainLand[v] === 0) continue;
        const current = best.get(v);
        if (current === undefined || d2 < current.d2) best.set(v, { d2, a, b });
      }
    }
  }
  const candidates = [...best].sort((p, q) => p[1].d2 - q[1].d2 || p[0] - q[0]);
  const made: Bridge[] = [];
  const linked = new Set<number>();
  for (const [target, { d2, a, b }] of candidates) {
    if (linked.size >= links) break;
    if (linked.has(target)) continue;
    const ax = a % width;
    const ay = (a - ax) / width;
    const from = pixels[a]!;
    const path: number[] = [];
    let touched = target;
    let blocked = false;
    for (const [x, y] of linePixels(ax, ay, b % width, (b - (b % width)) / width)) {
      const v = pixels[y * width + x]!;
      if (v < own.length && own[v] === 1) continue;
      if (v < isLand.length && isLand[v] === 1) {
        // a land territory met on the way takes the link, unless it is not a territory of the main group
        if (mainLand[v] === 0) blocked = true;
        touched = v;
        break;
      }
      path.push(y * width + x);
    }
    if (blocked || linked.has(touched)) continue;
    let water = 0;
    for (const p of path) {
      if (isSea[pixels[p]!] === 1) water++;
      pixels[p] = from;
    }
    // the flanks: sea pixels 4-adjacent to a painted pixel become other land, so the exclave never touches the zone
    for (const p of path) {
      const x = p % width;
      const neighbours = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p >= width ? p - width : -1, p + width < total ? p + width : -1];
      for (const q of neighbours) if (q !== -1 && pixels[q]! < isSea.length && isSea[pixels[q]!] === 1) pixels[q] = 0;
    }
    linked.add(touched);
    made.push({ from, to: touched, pixels: path.length, water, distance: Math.round(Math.sqrt(d2) * 100) / 100 });
  }
  return made;
}
