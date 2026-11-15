/**
 * FR-114: Lambert azimuthal equal-area projection on the unit sphere (north up), the square
 * frame and the point-to-pixel mapping. Pure functions of their arguments (NFR-14).
 * The radius is 1: the scale cancels in the frame, which is measured in the same units.
 */

const RAD = Math.PI / 180;

/** Centre of the projection, degrees. */
export interface ProjectionCenter {
  lon0: number;
  lat0: number;
}

/** The square of projected coordinates mapped onto the W x W image: west edge, north edge, side. */
export interface Frame {
  west: number;
  north: number;
  side: number;
}

/** A projected point in continuous pixel coordinates; x and y are only meaningful when inside. */
export interface PixelPoint {
  u: number;
  v: number;
  inside: boolean;
  x: number;
  y: number;
}

/** FR-114: midpoint of the longitude range and midpoint of the latitude range of the vertices. */
export function projectionCenter(points: readonly (readonly [number, number])[]): ProjectionCenter {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { lon0: (minLon + maxLon) / 2, lat0: (minLat + maxLat) / 2 };
}

/** FR-114: project degrees to (X, Y) on the unit sphere, X east, Y north. */
export function project(center: ProjectionCenter, lon: number, lat: number): [number, number] {
  const f0 = center.lat0 * RAD;
  const f = lat * RAD;
  const dl = (lon - center.lon0) * RAD;
  const sinF0 = Math.sin(f0);
  const cosF0 = Math.cos(f0);
  const sinF = Math.sin(f);
  const cosF = Math.cos(f);
  const cosDl = Math.cos(dl);
  const k = Math.sqrt(2 / (1 + sinF0 * sinF + cosF0 * cosF * cosDl));
  return [k * cosF * Math.sin(dl), k * (cosF0 * sinF - sinF0 * cosF * cosDl)];
}

/** Inverse of `project`, degrees. Used only to check that the extraction box covers the frame. */
export function unproject(center: ProjectionCenter, x: number, y: number): [number, number] {
  const f0 = center.lat0 * RAD;
  const rho = Math.sqrt(x * x + y * y);
  if (rho === 0) return [center.lon0, center.lat0];
  const c = 2 * Math.asin(rho / 2);
  const sinC = Math.sin(c);
  const cosC = Math.cos(c);
  const lat = Math.asin(cosC * Math.sin(f0) + (y * sinC * Math.cos(f0)) / rho);
  const lon =
    center.lon0 * RAD + Math.atan2(x * sinC, rho * Math.cos(f0) * cosC - y * Math.sin(f0) * sinC);
  return [lon / RAD, lat / RAD];
}

/**
 * FR-114: bounding box of the projected vertices, expanded symmetrically along its shorter
 * side into a square, then by margin * side on each of the four sides.
 */
export function frameFor(points: readonly (readonly [number, number])[], margin: number): Frame {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const side = Math.max(width, height);
  const m = margin * side;
  return {
    west: minX - (side - width) / 2 - m,
    north: maxY + (side - height) / 2 + m,
    side: side + 2 * m,
  };
}

/** Side of one pixel in projected units: the frame is divided into W x W equal squares. */
export function pixelSide(frame: Frame, width: number): number {
  return frame.side / width;
}

/**
 * FR-114: u = (X - west) / pixel, v = (north - Y) / pixel; inside iff 0 <= u < W and 0 <= v < W;
 * the pixel is (floor u, floor v), so a point on an edge lies in the pixel to its east or south.
 */
export function toPixel(frame: Frame, width: number, px: number, py: number): PixelPoint {
  const pixel = pixelSide(frame, width);
  const u = (px - frame.west) / pixel;
  const v = (frame.north - py) / pixel;
  const inside = u >= 0 && u < width && v >= 0 && v < width;
  return { u, v, inside, x: Math.floor(u), y: Math.floor(v) };
}
