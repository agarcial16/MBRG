import type { Result } from '@mbrg/shared';
import { own } from '../core/errors';
import type { SourcePolygon } from '../core/types';
import type { Extent, ImportFeature, ReadSource, SourceError } from './types';

/** FR-587: the coordinate reference system names a source may declare (WGS 84 and ETRS89 in degrees). */
export const ACCEPTED_CRS = ['urn:ogc:def:crs:OGC:1.3:CRS84', 'EPSG:4326', 'EPSG:4258'] as const;

/** One source file as the reader takes it: a label for errors and the file's bytes. */
export interface SourceInput {
  file: string;
  bytes: Uint8Array;
}

/** What the reader needs besides the bytes. */
export interface ReadOptions {
  /** Property names the curation uses (FR-588 caps their values); a value of any other property is never capped. */
  usedProperties: readonly string[];
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

type Pair = [number, number];

/** Running state of one read: the errors found and the numbers the report needs. */
interface Reading {
  file: string;
  errors: SourceError[];
  positions: number;
  west: number;
  south: number;
  east: number;
  north: number;
  /** The first feature with a position outside degrees, once found. */
  outOfRange: number | undefined;
}

/** True for a position of at least two numbers (JSON numbers are finite). */
function isPosition(p: unknown): p is number[] {
  return Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number';
}

/** One ring read on the first two numbers of each position; null when it is no ring of positions. */
function readRing(value: unknown, state: Reading, feature: number): Pair[] | null {
  if (!Array.isArray(value)) return null;
  let exact = true;
  for (const p of value) {
    if (!isPosition(p)) return null;
    if (p.length !== 2) exact = false;
  }
  const positions = value as number[][];
  const coords: Pair[] = exact ? (positions as Pair[]) : positions.map((p) => [p[0]!, p[1]!] as Pair);
  for (const [lon, lat] of coords) {
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      if (state.outOfRange === undefined) state.outOfRange = feature;
    }
    if (lon < state.west) state.west = lon;
    if (lon > state.east) state.east = lon;
    if (lat < state.south) state.south = lat;
    if (lat > state.north) state.north = lat;
  }
  state.positions += coords.length;
  return coords;
}

/** The rings of one polygon: the first is the outer ring, the others its holes; null when malformed. */
function readPolygon(value: unknown, state: Reading, feature: number): SourcePolygon | null | 'empty' {
  if (!Array.isArray(value)) return null;
  const rings: Pair[][] = [];
  for (const r of value) {
    const coords = readRing(r, state, feature);
    if (coords === null) return null;
    rings.push(coords);
  }
  if (rings.length === 0) return 'empty';
  return { outer: { coords: rings[0]! }, holes: rings.slice(1).map((coords) => ({ coords })) };
}

/** FR-587: the polygons of a Polygon or MultiPolygon geometry; null when its coordinates are malformed. */
function readGeometry(geometry: Record<string, unknown>, type: string, state: Reading, feature: number): SourcePolygon[] | null {
  const coordinates = own(geometry, 'coordinates');
  const polygons: SourcePolygon[] = [];
  const parts = type === 'Polygon' ? [coordinates] : Array.isArray(coordinates) ? coordinates : null;
  if (parts === null) return null;
  for (const part of parts) {
    const polygon = readPolygon(part, state, feature);
    if (polygon === null) return null;
    if (polygon !== 'empty') polygons.push(polygon);
  }
  return polygons;
}

/** FR-587: the name a `crs` member declares, or the empty text when it declares none readable. */
function crsName(root: Record<string, unknown>): string | undefined {
  if (!Object.hasOwn(root, 'crs')) return undefined;
  const crs = own(root, 'crs');
  if (!isObject(crs)) return '';
  const properties = own(crs, 'properties');
  const name = isObject(properties) ? own(properties, 'name') : undefined;
  return typeof name === 'string' ? name : '';
}

/**
 * FR-587: reads one GeoJSON `FeatureCollection` from UTF-8 bytes. Polygon and MultiPolygon features are kept with
 * their properties; a null geometry is skipped and counted; every other geometry type, any `crs` but the three
 * accepted, a position outside degrees and any malformed structure are errors, all reported together. Pure:
 * the same bytes always give the same result; every read of untrusted data uses the own-property rule.
 */
export function readSource(input: SourceInput, _options: ReadOptions): Result<ReadSource, SourceError> {
  const file = input.file;
  const fail = (error: SourceError): Result<ReadSource, SourceError> => ({ ok: false, errors: [error] });

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
  } catch {
    return fail({ kind: 'invalid-source', file, reason: 'not-utf8' });
  }
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return fail({ kind: 'invalid-source', file, reason: 'not-json' });
  }
  const list = isObject(root) ? own(root, 'features') : undefined;
  if (!isObject(root) || own(root, 'type') !== 'FeatureCollection' || !Array.isArray(list)) {
    return fail({ kind: 'invalid-source', file, reason: 'not-feature-collection' });
  }
  const crs = crsName(root);
  if (crs !== undefined && !(ACCEPTED_CRS as readonly string[]).includes(crs)) {
    return fail({ kind: 'unsupported-crs', file, crs });
  }

  const state: Reading = {
    file,
    errors: [],
    positions: 0,
    west: Infinity,
    south: Infinity,
    east: -Infinity,
    north: -Infinity,
    outOfRange: undefined,
  };
  const features: ImportFeature[] = [];
  let skippedNull = 0;
  for (let index = 0; index < list.length; index++) {
    const item: unknown = list[index];
    if (!isObject(item) || own(item, 'type') !== 'Feature' || !Object.hasOwn(item, 'geometry')) {
      state.errors.push({ kind: 'invalid-source', file, reason: 'bad-feature', feature: index });
      continue;
    }
    const properties = own(item, 'properties');
    if (properties !== null && !isObject(properties)) {
      state.errors.push({ kind: 'invalid-source', file, reason: 'bad-feature', feature: index });
      continue;
    }
    const geometry = own(item, 'geometry');
    if (geometry === null) {
      skippedNull++;
      continue;
    }
    if (!isObject(geometry)) {
      state.errors.push({ kind: 'invalid-source', file, reason: 'bad-geometry', feature: index });
      continue;
    }
    const type = own(geometry, 'type');
    if (type !== 'Polygon' && type !== 'MultiPolygon') {
      state.errors.push({ kind: 'unsupported-geometry', file, feature: index, type: typeof type === 'string' ? type : 'unknown' });
      continue;
    }
    const polygons = readGeometry(geometry, type, state, index);
    if (polygons === null) {
      state.errors.push({ kind: 'invalid-source', file, reason: 'bad-geometry', feature: index });
      continue;
    }
    features.push({ index, props: properties ?? {}, polygons });
  }
  if (state.outOfRange !== undefined) {
    state.errors.push({ kind: 'coordinates-not-degrees', file, feature: state.outOfRange });
  }
  if (state.errors.length > 0) return { ok: false, errors: state.errors };

  const extent: Extent | null =
    state.positions === 0 ? null : { west: state.west, south: state.south, east: state.east, north: state.north };
  return { ok: true, value: { file, features, skippedNull, positions: state.positions, extent } };
}
