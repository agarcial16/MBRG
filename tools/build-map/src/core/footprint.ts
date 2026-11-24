import { WATER } from './rasterize';

/** FR-705: a land unit that grew: its id and its pixel count before and after. */
export interface Grown {
  id: number;
  from: number;
  to: number;
}

/**
 * A donor must keep at least this many times the minimum footprint after giving a pixel away: a unit that is itself
 * small is never taken from.
 */
const DONOR_FACTOR = 4;

/** Land that is not water costs this much more per squared pixel of distance than water, so water is preferred. */
const LAND_PENALTY = 2;

/** The smallest window radius, in pixels, searched for the first pixel of a unit that has none. */
const FIRST_RADIUS = 4;

/**
 * FR-705: every land unit of `ids` (in the order given, which is map order) with fewer than `min` pixels grows to
 * exactly `min` pixels, deterministically, around its centre: the centroid of its own pixels, else the given anchor
 * (continuous pixel coordinates, `u` east, `v` south). The new pixels are the 4-connected neighbours of the unit with
 * the smallest squared distance to the centre (then the smallest row, then the smallest column), so the unit stays one
 * blob. A pixel it may take is water, or a pixel of another land unit that has at least `DONOR_FACTOR` times `min`
 * pixels left (land counts `LAND_PENALTY` times its squared distance, so water wins when it is near). The background
 * (value 0), other small units and sea zones are never written. A unit with nothing to claim stays as it is. Returns a
 * new array; the height is `pixels.length / width`. Pure (NFR-181).
 */
export function growFootprints(
  width: number,
  pixels: Uint32Array,
  ids: readonly number[],
  anchors: readonly (readonly [number, number])[],
  min: number,
): { pixels: Uint32Array; grown: Grown[] } {
  const out = Uint32Array.from(pixels);
  const height = out.length / width;
  const landIds = new Set(ids);
  const live = new Map<number, number>(ids.map((id) => [id, 0]));
  for (const value of out) {
    const n = live.get(value);
    if (n !== undefined) live.set(value, n + 1);
  }
  const donorMin = DONOR_FACTOR * min;
  const own = new Map<number, number[]>();
  for (const id of ids) if (live.get(id)! < min) own.set(id, []);
  if (own.size > 0) {
    out.forEach((value, i) => {
      const list = own.get(value);
      if (list !== undefined) list.push(i);
    });
  }

  const grown: Grown[] = [];
  ids.forEach((id, index) => {
    const blob = own.get(id);
    if (blob === undefined) return;
    const from = blob.length;

    // the centre: the centroid of its pixels (pixel centres), else the anchor clamped into the image
    let cu: number;
    let cv: number;
    if (blob.length > 0) {
      let sx = 0;
      let sy = 0;
      for (const p of blob) {
        sx += (p % width) + 0.5;
        sy += Math.floor(p / width) + 0.5;
      }
      cu = sx / blob.length;
      cv = sy / blob.length;
    } else {
      const [u, v] = anchors[index]!;
      cu = Math.min(Math.max(u, 0), width - 1e-9);
      cv = Math.min(Math.max(v, 0), height - 1e-9);
    }

    // a pixel this unit may take, and what it costs
    const cost = (x: number, y: number): number => {
      const p = y * width + x;
      const value = out[p]!;
      const d2 = (x + 0.5 - cu) ** 2 + (y + 0.5 - cv) ** 2;
      if (value === WATER) return d2;
      if (value !== id && landIds.has(value) && !own.has(value) && live.get(value)! >= donorMin) return d2 * LAND_PENALTY;
      return Infinity;
    };
    const take = (x: number, y: number): void => {
      const p = y * width + x;
      const value = out[p]!;
      const donor = live.get(value);
      if (donor !== undefined) live.set(value, donor - 1);
      out[p] = id;
      blob.push(p);
    };

    // a unit with no pixel starts at the cheapest pixel of a window around its centre, which widens until one is found
    if (blob.length === 0) {
      const x0 = Math.floor(cu);
      const y0 = Math.floor(cv);
      let best = Infinity;
      let bx = -1;
      let by = -1;
      for (let r = FIRST_RADIUS; best === Infinity && r < 2 * Math.max(width, height); r *= 2) {
        for (let y = Math.max(0, y0 - r); y <= Math.min(height - 1, y0 + r); y++) {
          for (let x = Math.max(0, x0 - r); x <= Math.min(width - 1, x0 + r); x++) {
            const c = cost(x, y);
            if (c < best || (c === best && c !== Infinity && (y < by || (y === by && x < bx)))) {
              best = c;
              bx = x;
              by = y;
            }
          }
        }
      }
      if (best === Infinity) return;
      take(bx, by);
    }

    // then the cheapest 4-connected neighbour of the blob, until the minimum is reached or nothing is left
    while (blob.length < min) {
      let best = Infinity;
      let bx = -1;
      let by = -1;
      for (const p of blob) {
        const x = p % width;
        const y = (p - x) / width;
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const c = cost(nx, ny);
          if (c < best || (c === best && c !== Infinity && (ny < by || (ny === by && nx < bx)))) {
            best = c;
            bx = nx;
            by = ny;
          }
        }
      }
      if (best === Infinity) break;
      take(bx, by);
    }
    if (blob.length > from) grown.push({ id, from, to: blob.length });
  });
  return { pixels: out, grown };
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
