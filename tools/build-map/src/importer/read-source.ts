import type { Result } from '@mbrg/shared';
import { own } from '../core/errors';
import type { SourcePolygon } from '../core/types';
import type { CapName, Extent, ImportFeature, ReadSource, SourceError } from './types';

/** FR-587: the coordinate reference system names a source may declare (WGS 84 and ETRS89 in degrees). */
export const ACCEPTED_CRS = ['urn:ogc:def:crs:OGC:1.3:CRS84', 'EPSG:4326', 'EPSG:4258'] as const;

/** One source file as the reader takes it: a label for errors and the file's bytes. */
export interface SourceInput {
  file: string;
  bytes: Uint8Array;
  /**
   * The property names whose values this source is capped on; when absent the read's `usedProperties` apply. A context
   * source (FR-589) uses no property of the curation, so the caller passes an empty list for it.
   */
  usedProperties?: readonly string[];
}

/** FR-588: the resource guards of a read; each is a count over all sources together except the per-feature ones. */
export interface SourceCaps {
  /** Bytes of one source file. */
  bytes: number;
  /** Features of all sources together (null geometries included). */
  features: number;
  /** Positions of all sources together. */
  positions: number;
  /** Properties of one feature. */
  properties: number;
  /** Code units of the value of one used property. */
  value: number;
}

export const SOURCE_CAPS: SourceCaps = { bytes: 256 * 1024 * 1024, features: 100_000, positions: 20_000_000, properties: 256, value: 1024 };

/** What the reader needs besides the bytes. */
export interface ReadOptions {
  /** Property names the curation uses (FR-588 caps their values); a value of any other property is never capped. */
  usedProperties: readonly string[];
  /** Overrides of the caps (a test seam: the real run uses `SOURCE_CAPS`). */
  caps?: Partial<SourceCaps>;
}

/** Counts that run over all the sources of one read. */
interface Totals {
  features: number;
  positions: number;
}

/** Thrown inside one read to stop it at the offending record (never leaves this module). */
class CapStop extends Error {
  constructor(readonly error: SourceError) {
    super('source cap exceeded');
  }
}

function tooLarge(file: string, what: CapName, cap: number, found: number, extra: { feature?: number; property?: string } = {}): SourceError {
  return { kind: 'source-too-large', file, what, cap, found, ...extra };
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

type Pair = [number, number];

/** Running state of one read: the errors found and the numbers the report needs. */
interface Reading {
  file: string;
  caps: SourceCaps;
  totals: Totals;
  errors: SourceError[];
  /** Positions of this source only. */
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
  state.totals.positions += coords.length;
  if (state.totals.positions > state.caps.positions) {
    throw new CapStop(tooLarge(state.file, 'positions', state.caps.positions, state.totals.positions, { feature }));
  }
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

/** One source read within the shared caps and totals; the errors come back with the stop, when there was one. */
function readOne(input: SourceInput, options: ReadOptions, caps: SourceCaps, totals: Totals): Result<ReadSource, SourceError> {
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
  // FR-588: the feature count of all sources together is known from the list before any record is read.
  totals.features += list.length;
  if (totals.features > caps.features) return fail(tooLarge(file, 'features', caps.features, totals.features));

  const state: Reading = {
    file,
    caps,
    totals,
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
  try {
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
      if (properties !== null) checkProperties(properties, input.usedProperties ?? options.usedProperties, caps, file, index);
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
  } catch (error) {
    if (error instanceof CapStop) return { ok: false, errors: [...state.errors, error.error] };
    throw error;
  }
  if (state.outOfRange !== undefined) {
    state.errors.push({ kind: 'coordinates-not-degrees', file, feature: state.outOfRange });
  }
  if (state.errors.length > 0) return { ok: false, errors: state.errors };

  const extent: Extent | null =
    state.positions === 0 ? null : { west: state.west, south: state.south, east: state.east, north: state.north };
  return { ok: true, value: { file, features, skippedNull, positions: state.positions, extent } };
}

/** FR-588: the property count of one feature and the length of each used property's text value. */
function checkProperties(properties: Record<string, unknown>, used: readonly string[], caps: SourceCaps, file: string, feature: number): void {
  const count = Object.keys(properties).length;
  if (count > caps.properties) throw new CapStop(tooLarge(file, 'properties', caps.properties, count, { feature }));
  for (const property of used) {
    const value = own(properties, property);
    if (typeof value === 'string' && value.length > caps.value) {
      throw new CapStop(tooLarge(file, 'value', caps.value, value.length, { feature, property }));
    }
  }
}

/**
 * FR-587, FR-588: reads GeoJSON `FeatureCollection` sources from UTF-8 bytes under one set of caps. The byte
 * length of every file is checked first, before any of them is decoded or parsed; then the sources are read in
 * order, the feature and position counts running over all of them together. Polygon and MultiPolygon features
 * are kept with their properties; a null geometry is skipped and counted; every other geometry type, any `crs` but
 * the three accepted, a position outside degrees and any malformed structure are errors; a cap stops the read
 * at the offending record. Pure: the same bytes always give the same result; every read of untrusted data
 * uses the own-property rule.
 */
export function readSources(inputs: readonly SourceInput[], options: ReadOptions): Result<ReadSource[], SourceError> {
  const caps: SourceCaps = { ...SOURCE_CAPS, ...options.caps };
  const oversized = inputs.filter((input) => input.bytes.length > caps.bytes);
  if (oversized.length > 0) {
    return { ok: false, errors: oversized.map((input) => tooLarge(input.file, 'bytes', caps.bytes, input.bytes.length)) };
  }
  const totals: Totals = { features: 0, positions: 0 };
  const sources: ReadSource[] = [];
  const errors: SourceError[] = [];
  for (const input of inputs) {
    const result = readOne(input, options, caps, totals);
    if (result.ok) sources.push(result.value);
    else {
      errors.push(...result.errors);
      // a cap stops the whole read; other faults of one source never hide those of the next
      if (result.errors.some((e) => e.kind === 'source-too-large')) return { ok: false, errors };
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: sources };
}

/** FR-587: one source, read as `readSources` reads a list of one. */
export function readSource(input: SourceInput, options: ReadOptions): Result<ReadSource, SourceError> {
  const result = readSources([input], options);
  return result.ok ? { ok: true, value: result.value[0]! } : result;
}
