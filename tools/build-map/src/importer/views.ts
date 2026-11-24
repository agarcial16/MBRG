import type { Result } from '@mbrg/shared';
import { frameFor, project, projectionCenter, toPixel, type Frame, type ProjectionCenter } from '../core/projection';
import type { SourcePolygon } from '../core/types';
import type { Filter, Params } from './curation';
import { robinson } from '../core/robinson';
import { equalEarth } from './equal-earth';
import { ErrorCollector } from './errors';
import { matchesFilter } from './select';
import type { Unit } from './units';

const RAD = Math.PI / 180;

/** FR-600, FR-601: where a polygon of a view comes from: a unit of the primary source, or a feature of a context file. */
export type ItemOrigin = { unit: string } | { file: string; feature: number };

/** The polygons of one unit or one context feature, as a view takes them. */
export interface ViewItem {
  origin: ItemOrigin;
  polygons: readonly SourcePolygon[];
}

/** FR-600: the errors of building a view. */
export type ViewError =
  | { kind: 'selection-too-wide'; unit: string }
  | { kind: 'antimeridian-edge'; unit: string }
  | { kind: 'antimeridian-edge'; file: string; feature: number };

/**
 * FR-600, FR-601: one view of the image: its own projection centre (`lon0`, `lat0`) and frame, and the raster side its
 * pixel coordinates (`toUV`) are measured in. `plane` is the projection itself, on the unit sphere.
 */
export interface View {
  kind: 'main' | 'inset';
  projection: Params['projection'];
  /** Central meridian in degrees: the centre longitude with `laea`, the wrapping meridian with `equal-earth`. */
  lon0: number;
  lat0: number;
  frame: Frame;
  /** The side of the raster `toUV` addresses, in pixels (W for the main map). */
  side: number;
  plane(lon: number, lat: number): [number, number];
  /** Continuous pixel coordinates (u, v) of a point: the projected point mapped through the frame (003b FR-114). */
  toUV(lon: number, lat: number): [number, number];
  /**
   * FR-600 (the antimeridian fix): one ring's vertices in continuous pixel coordinates, the ring-aware form of
   * `toUV`: an exactly-antimeridian vertex lies on its ring's own side. Every view the importer builds has it; a
   * hand-made view may leave it out, and the pixel step then falls back to `toUV` point by point.
   */
  ringToUV?: (coords: readonly (readonly [number, number])[]) => [number, number][];
}

/** `lon - lon0` wrapped into (-180, 180]. */
export function wrapLon(lon: number, lon0: number): number {
  let r = (((lon - lon0) % 360) + 360) % 360;
  if (r > 180) r -= 360;
  return r;
}

/**
 * FR-600 (the antimeridian fix): the wrapped longitudes of one ring, with every vertex exactly on the antimeridian
 * (wrapped value 180) placed on the ring's own side, the side of its other vertices, the same side
 * `crossesAntimeridian` puts such a vertex on when it judges an edge. A ring whose other vertices lie on both sides
 * of the antimeridian, or have none, keeps the plain wrapped value: a point alone has no side, and seeds and single
 * vertices keep wrapping as points (`wrapLon` places the antimeridian itself east).
 */
export function ringWrappedLons(coords: readonly (readonly [number, number])[], lon0: number): number[] {
  const wrapped = coords.map(([lon]) => wrapLon(lon, lon0));
  let west = false;
  let east = false;
  for (const w of wrapped) {
    if (w === 180) continue;
    if (w < 0) west = true;
    else east = true;
  }
  if (west && !east) {
    for (let i = 0; i < wrapped.length; i++) {
      if (wrapped[i] === 180) wrapped[i] = -180;
    }
  }
  return wrapped;
}

/** The projection of a view on the unit sphere: Lambert as 003b builds it, or Equal Earth on the wrapped longitude. */
export function planeOf(projection: Params['projection'], lon0: number, lat0: number): (lon: number, lat: number) => [number, number] {
  if (projection === 'laea') {
    const center: ProjectionCenter = { lon0, lat0 };
    return (lon, lat) => project(center, lon, lat);
  }
  const flat = flatProjection(projection);
  return (lon, lat) => flat(wrapLon(lon, lon0) * RAD, lat * RAD);
}

/** FR-600, FR-698: the flat world projections, longitude and latitude in radians. */
function flatProjection(projection: Params['projection']): (lon: number, lat: number) => [number, number] {
  return projection === 'robinson' ? robinson : equalEarth;
}

/**
 * FR-600 (the antimeridian fix): the projection of a view applied to whole rings: one ring's vertices in plane
 * coordinates, every exactly-antimeridian vertex on its ring's own side. With `laea` a ring projects point by point
 * (the projection is periodic in longitude: -180 and +180 are one point); with `equal-earth` the side-placed wrapped
 * longitudes of the ring go straight to the projection, never wrapped a second time.
 */
export function ringProjector(projection: Params['projection'], lon0: number, lat0: number): (coords: readonly (readonly [number, number])[]) => [number, number][] {
  if (projection === 'laea') {
    const plane = planeOf(projection, lon0, lat0);
    return (coords) => coords.map(([lon, lat]) => plane(lon, lat));
  }
  const flat = flatProjection(projection);
  return (coords) => {
    const wrapped = ringWrappedLons(coords, lon0);
    // the wrapped value of a non-adjusted vertex is what `plane` computes; -180 is the ring's own side
    return coords.map(([, lat], i) => flat(wrapped[i]! * RAD, lat * RAD));
  };
}

/** Slack for the exactly-90-degrees horizon test: a point on the horizon is not beyond it (float noise of cos 90). */
const HORIZON = 1e-12;

/** True when (lon, lat) is more than 90 degrees of great-circle arc from the centre (the Lambert projection is undefined there). */
export function beyondHorizon(lon0: number, lat0: number): (lon: number, lat: number) => boolean {
  const f0 = lat0 * RAD;
  const sin0 = Math.sin(f0);
  const cos0 = Math.cos(f0);
  return (lon, lat) => {
    const f = lat * RAD;
    return sin0 * Math.sin(f) + cos0 * Math.cos(f) * Math.cos((lon - lon0) * RAD) < -HORIZON;
  };
}

/** Calls `visit` with every raw vertex of the unit: the outer ring and every hole of every polygon, in file order. */
export function eachVertex(polygons: readonly SourcePolygon[], visit: (lon: number, lat: number) => void): void {
  for (const polygon of polygons) {
    for (const [lon, lat] of polygon.outer.coords) visit(lon, lat);
    for (const hole of polygon.holes) for (const [lon, lat] of hole.coords) visit(lon, lat);
  }
}

/** The bounding box of the raw vertices of the units, or null when they have none. */
export function vertexBox(units: readonly Unit[]): { west: number; south: number; east: number; north: number } | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const unit of units) {
    eachVertex(unit.polygons, (lon, lat) => {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    });
  }
  return west > east ? null : { west, south, east, north };
}

/**
 * FR-600: the frame of the units' raw vertices as the view's ring projection sees them: the bounding box of the
 * projected vertices, FR-114. `projectRing` comes from `ringProjector` of the same view (the antimeridian fix: the
 * frame of a ring split at the antimeridian is the band the ring covers, never a stripe around the whole globe).
 */
export function frameOfUnits(units: readonly Unit[], projectRing: (coords: readonly (readonly [number, number])[]) => [number, number][], margin: number): Frame | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const unit of units) {
    for (const polygon of unit.polygons) {
      for (const ring of [polygon.outer, ...polygon.holes]) {
        for (const [x, y] of projectRing(ring.coords)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }
  // frameFor only reads the bounding box of its points
  return minX > maxX ? null : frameFor([[minX, minY], [maxX, maxY]], margin);
}

/** The frame a view gets when it has no vertex at all: the whole disc of the Lambert projection. */
export const EMPTY_FRAME: Frame = { west: -2, north: 2, side: 4 };

/** Assembles a view from its centre, frame and raster side. */
export function makeView(
  kind: View['kind'],
  projection: Params['projection'],
  lon0: number,
  lat0: number,
  frame: Frame,
  side: number,
  width: number,
): View {
  const plane = planeOf(projection, lon0, lat0);
  const projectRing = ringProjector(projection, lon0, lat0);
  const at = (px: number, py: number): [number, number] => {
    const pixel = toPixel(frame, width, px, py);
    return [pixel.u, pixel.v];
  };
  return {
    kind,
    projection,
    lon0,
    lat0,
    frame,
    side,
    plane,
    toUV: (lon, lat) => {
      const [px, py] = plane(lon, lat);
      return at(px, py);
    },
    // FR-600 (the antimeridian fix): the ring form of toUV
    ringToUV: (coords) => projectRing(coords).map(([px, py]) => at(px, py)),
  };
}

/**
 * FR-600: the polygons of a context feature or other land that a view can draw: with `laea`, a polygon with any vertex
 * beyond 90 degrees of arc from the centre is dropped (never an error); with `equal-earth` every polygon is kept.
 */
export function visiblePolygons(view: Pick<View, 'projection' | 'lon0' | 'lat0'>, polygons: readonly SourcePolygon[]): SourcePolygon[] {
  if (view.projection !== 'laea') return [...polygons];
  const beyond = beyondHorizon(view.lon0, view.lat0);
  return polygons.filter((polygon) => {
    let seen = false;
    eachVertex([polygon], (lon, lat) => {
      if (!seen && beyond(lon, lat)) seen = true;
    });
    return !seen;
  });
}

/** True when an edge between two longitudes crosses the antimeridian of a view (the ends wrapped as `lon - lon0`). */
function crossesAntimeridian(a: number, b: number, lon0: number): boolean {
  let wa = wrapLon(a, lon0);
  let wb = wrapLon(b, lon0);
  // a vertex exactly on the antimeridian is the same point on either side: only the other end decides
  if (wa === 180 && wb < 0) wa = -180;
  if (wb === 180 && wa < 0) wb = -180;
  return Math.abs(wa - wb) > 180;
}

/**
 * FR-600, FR-601: with `equal-earth`, every ring edge of the items whose two ends, each wrapped as `lon - lon0` into
 * (-180, 180], differ by more than 180 degrees is an `antimeridian-edge` (unit key, or context file and feature index;
 * one error per item). The Lambert projection is periodic in longitude and has no such rule.
 */
export function antimeridianErrors(view: Pick<View, 'projection' | 'lon0'>, items: readonly ViewItem[]): ViewError[] {
  if (view.projection === 'laea') return [];
  const errors: ViewError[] = [];
  for (const item of items) {
    const rings = item.polygons.flatMap((p) => [p.outer, ...p.holes]);
    const crossing = rings.some((ring) => {
      const n = ring.coords.length;
      for (let i = 0; i < n; i++) {
        if (crossesAntimeridian(ring.coords[i]![0], ring.coords[(i + 1) % n]![0], view.lon0)) return true;
      }
      return false;
    });
    if (!crossing) continue;
    errors.push('unit' in item.origin ? { kind: 'antimeridian-edge', unit: item.origin.unit } : { kind: 'antimeridian-edge', file: item.origin.file, feature: item.origin.feature });
  }
  return errors;
}

/** FR-600: `selection-too-wide` for every unit with a vertex beyond 90 degrees of arc from the centre (`laea` only). */
export function tooWideErrors(view: Pick<View, 'projection' | 'lon0' | 'lat0'>, units: readonly Unit[]): ViewError[] {
  if (view.projection !== 'laea') return [];
  const beyond = beyondHorizon(view.lon0, view.lat0);
  const errors: ViewError[] = [];
  for (const unit of units) {
    let seen = false;
    eachVertex(unit.polygons, (lon, lat) => {
      if (!seen && beyond(lon, lat)) seen = true;
    });
    if (seen) errors.push({ kind: 'selection-too-wide', unit: unit.key });
  }
  return errors;
}

/** What the main view takes: the selected units that lie outside every inset, other land and context items, the parameters. */
export interface MainViewInput {
  units: readonly Unit[];
  /** Other land and context features drawn in the view (checked for the antimeridian only). */
  others?: readonly ViewItem[];
  params: Params;
}

/**
 * FR-600: the main view. With `laea`: the projection of 003b FR-114 reused (`core/projection.ts` unchanged), its
 * centre the midpoint rule over the raw outer and hole vertices of the selected LAND units outside every inset (no step
 * between the source rings and the projection, exactly what 003b `build.ts` feeds it), the frame from the same
 * vertices; a selected unit with a vertex beyond 90 degrees of arc from the centre is `selection-too-wide`. With
 * `equal-earth`: central meridian 0 for the main map, the same frame rule; an edge crossing the antimeridian is
 * `antimeridian-edge`. A main view with no land unit takes the vertices of whatever units it has, else a frame of its
 * own. Errors are collected once per distinct data. Pure.
 */
export function buildMainView(input: MainViewInput): Result<View, ViewError> {
  const { params } = input;
  const land = input.units.filter((u) => u.kind !== 'sea');
  const basis = vertexBox(land) !== null ? land : input.units;
  const box = vertexBox(basis);

  let lon0 = 0;
  let lat0 = 0;
  if (params.projection === 'laea' && box !== null) {
    const center = projectionCenter([[box.west, box.south], [box.east, box.north]]);
    lon0 = center.lon0;
    lat0 = center.lat0;
  }
  const projectRing = ringProjector(params.projection, lon0, lat0);
  const frame = frameOfUnits(basis, projectRing, params.margin) ?? EMPTY_FRAME;
  const view = makeView('main', params.projection, lon0, lat0, frame, params.side, params.side);

  const errors = new ErrorCollector<ViewError>();
  errors.addAll(tooWideErrors(view, input.units));
  const items: ViewItem[] = [...input.units.map((u): ViewItem => ({ origin: { unit: u.key }, polygons: u.polygons })), ...(input.others ?? [])];
  errors.addAll(antimeridianErrors(view, items));
  return errors.size > 0 ? { ok: false, errors: errors.list() } : { ok: true, value: view };
}

/** FR-601: an inset's rectangle in the composed image, top-left at (x, y). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** FR-601: an inset view: its own centre, frame and square raster of side max(w, h), blitted to `rect`. */
export interface InsetView extends View {
  kind: 'inset';
  /** Position of the inset in the curation's `insets` list. */
  index: number;
  rect: Rect;
  /** The selected units drawn in it. */
  units: Unit[];
}

/** FR-600, FR-601: the main view and the insets of one import. */
export interface ViewSet {
  /** The image side W. */
  width: number;
  main: View;
  /** The selected units drawn by the main view: those in no inset. */
  mainUnits: Unit[];
  insets: InsetView[];
}

/** FR-601: the errors of the insets. */
export type InsetError =
  | { kind: 'unit-in-two-insets'; unit: string }
  | { kind: 'empty-inset'; inset: number }
  | { kind: 'inset-outside-image'; inset: number }
  | { kind: 'insets-overlap'; insets: [number, number] }
  | { kind: 'inset-hides-land'; inset: number };

/**
 * FR-601: the centre longitude of a set of longitudes (degrees, each in -180 to 180): the midpoint of their range, but
 * on the other side of the globe when the set straddles the antimeridian and the range taken that way is the narrower
 * one (a ring with vertices at 178 and -178 is centred on 180, not on 0). For every set that does not straddle it this
 * is the plain midpoint of the range. The result is wrapped into (-180, 180].
 */
export function centerLongitude(west: number, east: number, shiftedWest: number, shiftedEast: number): number {
  const raw = east - west;
  const shifted = shiftedEast - shiftedWest;
  const mid = shifted < raw ? (shiftedWest + shiftedEast) / 2 : (west + east) / 2;
  return wrapLon(mid, 0);
}

/** The longitude range of the units' vertices as they are and with the negative ones moved east by 360, and the latitude range. */
function ranges(units: readonly Unit[]): { west: number; east: number; shiftedWest: number; shiftedEast: number; south: number; north: number } | null {
  let west = Infinity;
  let east = -Infinity;
  let shiftedWest = Infinity;
  let shiftedEast = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const unit of units) {
    eachVertex(unit.polygons, (lon, lat) => {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      const s = lon < 0 ? lon + 360 : lon;
      if (s < shiftedWest) shiftedWest = s;
      if (s > shiftedEast) shiftedEast = s;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    });
  }
  return west > east ? null : { west, east, shiftedWest, shiftedEast, south, north };
}

/** The inset's own projection, frame and rectangle, or null when its units have no vertex. */
function insetView(index: number, units: Unit[], at: readonly [number, number], params: Params, mainFrame: Frame): InsetView | null {
  const r = ranges(units);
  if (r === null) return null;
  const lon0 = centerLongitude(r.west, r.east, r.shiftedWest, r.shiftedEast);
  const lat0 = (r.south + r.north) / 2;
  const plane = planeOf(params.projection, lon0, lat0);
  const projectRing = ringProjector(params.projection, lon0, lat0);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const unit of units) {
    for (const polygon of unit.polygons) {
      for (const ring of [polygon.outer, ...polygon.holes]) {
        for (const [x, y] of projectRing(ring.coords)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }
  // the main scale: one pixel is mainFrame.side / W plane units; the margin is a share of the main frame side
  const pixel = mainFrame.side / params.side;
  const margin = params.margin * mainFrame.side;
  const west = minX - margin;
  const north = maxY + margin;
  const w = Math.max(1, Math.ceil((maxX + margin - west) / pixel));
  const h = Math.max(1, Math.ceil((north - (minY - margin)) / pixel));
  return {
    kind: 'inset',
    index,
    projection: params.projection,
    lon0,
    lat0,
    frame: { west, north, side: pixel * params.side },
    side: Math.max(w, h),
    plane,
    toUV: (lon, lat) => {
      const [px, py] = plane(lon, lat);
      return [(px - west) / pixel, (north - py) / pixel];
    },
    // FR-600 (the antimeridian fix): the ring form of toUV
    ringToUV: (coords) => projectRing(coords).map(([px, py]) => [(px - west) / pixel, (north - py) / pixel]),
    rect: { x: at[0], y: at[1], w, h },
    units,
  };
}

/** Whether two rectangles share a pixel. */
const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** What the views take. */
export interface ViewsInput {
  /** Every selected unit, land and sea, in unit order. */
  selected: readonly Unit[];
  /** Other land and context items: drawn in every view, checked for the antimeridian (an inset only on the rows it covers). */
  others?: readonly ViewItem[];
  params: Params;
  insets: readonly { select: readonly Filter[]; at: readonly [number, number] }[];
}

/**
 * FR-601: the main view and the insets. Each inset takes the selected units matching its filters (`unit-in-two-insets`
 * for a unit two insets take, `empty-inset` for an inset with none), centred on the midpoint of their own longitude and
 * latitude ranges (`centerLongitude`; with `equal-earth` that longitude is its own central meridian), at the main
 * frame's pixel scale, in the rectangle of their projected bounding box expanded by margin x main frame side on each
 * side, rounded outward to whole pixels, with its top-left at `at`. The raster of an inset is its own square of side
 * max(w, h), never a second W x W image. A rectangle that leaves the image is `inset-outside-image`, two that share a
 * pixel are `insets-overlap`. The units no inset takes go to the main view, which is built as T2.4 says. Every
 * longitude of a view wraps as `lon - lon0` into (-180, 180]; `antimeridian-edge` is judged against the view's own
 * meridian (an inset: for its units, and for the context and other-land items on the rows of its raster, which is what
 * could be drawn in it). Errors are collected once per distinct data. Pure.
 */
export function buildViews(input: ViewsInput): Result<ViewSet, ViewError | InsetError> {
  const errors = new ErrorCollector<ViewError | InsetError>();
  const { params } = input;
  const assigned = new Map<string, number>();
  const taken: Unit[][] = input.insets.map((inset, i) => {
    const units = input.selected.filter((unit) => inset.select.every((filter) => matchesFilter(unit, filter)));
    if (units.length === 0) errors.add({ kind: 'empty-inset', inset: i });
    for (const unit of units) {
      if (assigned.has(unit.key)) errors.add({ kind: 'unit-in-two-insets', unit: unit.key });
      else assigned.set(unit.key, i);
    }
    return units;
  });
  const mainUnits = input.selected.filter((unit) => !assigned.has(unit.key));
  const others = input.others ?? [];
  const main = buildMainView({ units: mainUnits, others, params });
  if (!main.ok) errors.addAll(main.errors);

  const insets: InsetView[] = [];
  if (main.ok) {
    input.insets.forEach((inset, i) => {
      const view = insetView(i, taken[i]!, inset.at, params, main.value.frame);
      if (view === null) return;
      insets.push(view);
      const { rect } = view;
      if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > params.side || rect.y + rect.h > params.side) errors.add({ kind: 'inset-outside-image', inset: i });
      errors.addAll(tooWideErrors(view, view.units));
      const items: ViewItem[] = view.units.map((u): ViewItem => ({ origin: { unit: u.key }, polygons: u.polygons }));
      errors.addAll(antimeridianErrors(view, [...items, ...others.filter((item) => touchesRows(view, item))]));
    });
    for (let a = 0; a < insets.length; a++) {
      for (let b = a + 1; b < insets.length; b++) {
        if (overlap(insets[a]!.rect, insets[b]!.rect)) errors.add({ kind: 'insets-overlap', insets: [insets[a]!.index, insets[b]!.index] });
      }
    }
  }
  if (errors.size > 0 || !main.ok) return { ok: false, errors: errors.list() };
  return { ok: true, value: { width: params.side, main: main.value, mainUnits, insets } };
}

/** True when an item projects, in this view, onto rows of the view's raster: what could be drawn in it. */
function touchesRows(view: InsetView, item: ViewItem): boolean {
  let low = Infinity;
  let high = -Infinity;
  eachVertex(item.polygons, (lon, lat) => {
    const v = view.toUV(lon, lat)[1];
    if (v < low) low = v;
    if (v > high) high = v;
  });
  return !(low > view.rect.h || high < 0);
}

/**
 * FR-601: `inset-hides-land` for every inset whose rectangle covers a pixel the main projection gives to a selected land
 * unit: `mainPixels` is the W x W raster of the main view, `isLand` tells the value of a land territory from the rest.
 */
export function insetHidesLand(set: ViewSet, mainPixels: Uint32Array, isLand: (value: number) => boolean): InsetError[] {
  const errors: InsetError[] = [];
  for (const inset of set.insets) {
    const { x, y, w, h } = inset.rect;
    let hidden = false;
    for (let row = Math.max(0, y); row < Math.min(set.width, y + h) && !hidden; row++) {
      for (let col = Math.max(0, x); col < Math.min(set.width, x + w); col++) {
        if (isLand(mainPixels[row * set.width + col]!)) {
          hidden = true;
          break;
        }
      }
    }
    if (hidden) errors.push({ kind: 'inset-hides-land', inset: inset.index });
  }
  return errors;
}

/** Where a seed lies: the view that owns it and its pixel in the composed image. */
export interface SeedLocation {
  view: View;
  x: number;
  y: number;
}

/**
 * FR-601: a seed lies in the first inset whose projection puts it inside that inset's rectangle, else in the main
 * projection; null when the main projection puts it outside the frame (`seed-outside-frame`). The pixel of an edge point
 * is the one to the east or south (003b FR-114).
 */
export function locateSeed(set: ViewSet, lon: number, lat: number): SeedLocation | null {
  for (const inset of set.insets) {
    const [u, v] = inset.toUV(lon, lat);
    if (u >= 0 && u < inset.rect.w && v >= 0 && v < inset.rect.h) {
      return { view: inset, x: inset.rect.x + Math.floor(u), y: inset.rect.y + Math.floor(v) };
    }
  }
  const [u, v] = set.main.toUV(lon, lat);
  if (u >= 0 && u < set.width && v >= 0 && v < set.width) return { view: set.main, x: Math.floor(u), y: Math.floor(v) };
  return null;
}
