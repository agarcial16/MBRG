/**
 * FR-697: the Robinson projection on the unit sphere (Robinson, 1974), own code on the published table. The table has
 * one row every 5 degrees of latitude from 0 to 90: the length factor PLEN (the parallel's length against the
 * equator's) and the distance factor PDFE (its distance from the equator against the pole's). Between rows the
 * values follow a cubic (Catmull-Rom) through the four nearest rows: the value is the table value exactly at a row;
 * the length factor is even and the distance factor odd about the equator, and the pole end is clamped to the last
 * row. `x = 0.8487 PLEN(lat) lon`, `y = 1.3523 PDFE(lat)`, longitude and latitude in radians, the central meridian
 * at longitude 0, x east, y north. The poles are lines. Pure and deterministic (NFR-181); no import (NFR-180).
 */

/** The standard table: PLEN and PDFE at latitude 0, 5, ... 90 degrees. */
export const ROBINSON_ROWS: readonly (readonly [number, number])[] = [
  [1.0, 0.0],
  [0.9986, 0.062],
  [0.9954, 0.124],
  [0.99, 0.186],
  [0.9822, 0.248],
  [0.973, 0.31],
  [0.96, 0.372],
  [0.9427, 0.434],
  [0.9216, 0.4958],
  [0.8962, 0.5571],
  [0.8679, 0.6176],
  [0.835, 0.6769],
  [0.7986, 0.7346],
  [0.7597, 0.7903],
  [0.7186, 0.8435],
  [0.6732, 0.8936],
  [0.6213, 0.9394],
  [0.5722, 0.9761],
  [0.5322, 1.0],
];

/** The two published scale constants: x = X_SCALE PLEN lon, y = Y_SCALE PDFE. */
const X_SCALE = 0.8487;
const Y_SCALE = 1.3523;

/** The last row index. */
const LAST = ROBINSON_ROWS.length - 1;

/** Degrees between two rows, as radians. */
const STEP = (5 * Math.PI) / 180;

/** The table value at a row index `i` (a half-line: -1 mirrors the row 1 as an even column, clamped above LAST). */
function row(i: number, column: 0 | 1): number {
  if (i < 0) return column === 0 ? ROBINSON_ROWS[-i]![0] : -ROBINSON_ROWS[-i]![1];
  return ROBINSON_ROWS[Math.min(i, LAST)]![column];
}

/** The cubic through four rows at the fraction `t` of the middle interval (Catmull-Rom). */
function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

/** PLEN (column 0) or PDFE (column 1) at |latitude| in radians (0 to pi/2). */
function factor(absLat: number, column: 0 | 1): number {
  const at = Math.min(absLat / STEP, LAST);
  const i = Math.min(Math.floor(at), LAST - 1);
  return cubic(row(i - 1, column), row(i, column), row(i + 1, column), row(i + 2, column), at - i);
}

/** (x, y) of a point on the unit sphere, longitude and latitude in radians; x east, y north. */
export function robinson(lon: number, lat: number): [number, number] {
  const abs = Math.abs(lat);
  const plen = factor(abs, 0);
  const pdfe = factor(abs, 1);
  return [X_SCALE * plen * lon, lat < 0 ? -Y_SCALE * pdfe : Y_SCALE * pdfe];
}
