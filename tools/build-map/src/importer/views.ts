import type { Result } from '@mbrg/shared';
import { frameFor, project, projectionCenter, toPixel, type Frame, type ProjectionCenter } from '../core/projection';
import type { SourcePolygon } from '../core/types';
import type { Params } from './curation';
import { equalEarth } from './equal-earth';
import { ErrorCollector } from './errors';
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
}

/** `lon - lon0` wrapped into (-180, 180]. */
export function wrapLon(lon: number, lon0: number): number {
  let r = (((lon - lon0) % 360) + 360) % 360;
  if (r > 180) r -= 360;
  return r;
}

/** The projection of a view on the unit sphere: Lambert as 003b builds it, or Equal Earth on the wrapped longitude. */
export function planeOf(projection: Params['projection'], lon0: number, lat0: number): (lon: number, lat: number) => [number, number] {
  if (projection === 'laea') {
    const center: ProjectionCenter = { lon0, lat0 };
    return (lon, lat) => project(center, lon, lat);
  }
  return (lon, lat) => equalEarth(wrapLon(lon, lon0) * RAD, lat * RAD);
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

/** The frame of the units' raw vertices as seen through `plane`: the bounding box of the projected points, FR-114. */
export function frameOfUnits(units: readonly Unit[], plane: View['plane'], margin: number): Frame | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const unit of units) {
    eachVertex(unit.polygons, (lon, lat) => {
      const [x, y] = plane(lon, lat);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
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
      const at = toPixel(frame, width, px, py);
      return [at.u, at.v];
    },
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
  if (view.projection !== 'equal-earth') return [];
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
  const plane = planeOf(params.projection, lon0, lat0);
  const frame = frameOfUnits(basis, plane, params.margin) ?? EMPTY_FRAME;
  const view = makeView('main', params.projection, lon0, lat0, frame, params.side, params.side);

  const errors = new ErrorCollector<ViewError>();
  errors.addAll(tooWideErrors(view, input.units));
  const items: ViewItem[] = [...input.units.map((u): ViewItem => ({ origin: { unit: u.key }, polygons: u.polygons })), ...(input.others ?? [])];
  errors.addAll(antimeridianErrors(view, items));
  return errors.size > 0 ? { ok: false, errors: errors.list() } : { ok: true, value: view };
}
