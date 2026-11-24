/**
 * FR-600: the Equal Earth projection on the unit sphere (Savric, Patterson and Jenny, 2018), own code on the four
 * published constants (NFR-133). `theta = asin(M sin lat)`, `M = sqrt(3) / 2`,
 * `F(theta) = A1 theta + A2 theta^3 + A3 theta^7 + A4 theta^9`, `x = lon cos(theta) / (M dF/dtheta)`, `y = F(theta)`;
 * longitude and latitude in radians, the central meridian at longitude 0. Pure and deterministic (NFR-134).
 */

/** The published constants of the polynomial, as literals. */
export const EQUAL_EARTH_A1 = 1.340264;
export const EQUAL_EARTH_A2 = -0.081106;
export const EQUAL_EARTH_A3 = 0.000893;
export const EQUAL_EARTH_A4 = 0.003796;

/** M = sqrt(3) / 2. */
const M = Math.sqrt(3) / 2;

/** (x, y) of a point on the unit sphere, longitude and latitude in radians; x east, y north. */
export function equalEarth(lon: number, lat: number): [number, number] {
  const theta = Math.asin(M * Math.sin(lat));
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  const y = theta * (EQUAL_EARTH_A1 + EQUAL_EARTH_A2 * t2 + t6 * (EQUAL_EARTH_A3 + EQUAL_EARTH_A4 * t2));
  const slope = EQUAL_EARTH_A1 + 3 * EQUAL_EARTH_A2 * t2 + t6 * (7 * EQUAL_EARTH_A3 + 9 * EQUAL_EARTH_A4 * t2);
  const x = (lon * Math.cos(theta)) / (M * slope);
  return [x, y];
}
