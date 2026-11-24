import type { Result } from '@mbrg/shared';
import { normalizeEncoding, readDbfHeader, readDbfRows, type DbfEncoding } from './read-dbf';
import type { ExtractGeoError, ShpGeometry } from './types';

/** What the pure extraction takes: the geometries read by the shapefile adapter and the bytes and texts of the other files. */
export interface ExtractGeoInput {
  /** One entry per shapefile record, in record order; null for a null shape. */
  geometries: readonly (ShpGeometry | null)[];
  /** The bytes of the attribute table. */
  dbf: Uint8Array;
  /** The text of the `.cpg` file, when there is one. */
  cpg?: string;
  /** The text of the `.prj` file, when there is one. */
  prj?: string;
  /** The encoding the command names; it wins over the `.cpg` file. */
  encoding?: string;
  /** Property names to keep, in the order they are written; all when absent. */
  keep?: readonly string[];
  /** Decimal places to round the coordinates to; none when absent. */
  round?: number;
}

/** FR-590: the lowest rounding the extract mode accepts (about 0.1 m at the equator) and the highest a double can show. */
export const MIN_ROUND = 6;
export const MAX_ROUND = 15;

/** A `.cpg` text or a command value with the NUL, byte order mark and surrounding space of real files removed. */
function nameText(text: string): string {
  return text.replace(/[\u0000\ufeff]/g, '').trim();
}

type Pair = [number, number];

/** Rounds to `scale` and collapses consecutive equal vertices; never removes any other vertex (as the 003b step does). */
function roundRing(ring: readonly Pair[], scale: number): Pair[] {
  const out: Pair[] = [];
  for (const [x, y] of ring) {
    const rx = Math.round(x * scale) / scale;
    const ry = Math.round(y * scale) / scale;
    const last = out[out.length - 1];
    if (last !== undefined && last[0] === rx && last[1] === ry) continue;
    out.push([rx, ry]);
  }
  return out;
}

function geometryOf(geometry: ShpGeometry | null, scale: number | undefined): unknown {
  if (geometry === null) return null;
  if (scale === undefined) return geometry;
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geometry.coordinates.map((r) => roundRing(r, scale)) };
  }
  return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((p) => p.map((r) => roundRing(r, scale))) };
}

/**
 * FR-590: the pure part of the extract mode. It turns the geometries of a polygon shapefile and the bytes of its
 * attribute table into the bytes of a source (FR-587): a `FeatureCollection` with one feature per record, in record
 * order, one feature a line. Every problem of one run is reported together: a projected `.prj`, an unknown encoding,
 * a kept name that is no field, a table that does not fit the shapefile, a text that is not valid in its encoding.
 * No file, clock or randomness; two runs on the same input give the same bytes.
 */
export function extractGeo(input: ExtractGeoInput): Result<Uint8Array, ExtractGeoError> {
  const errors: ExtractGeoError[] = [];

  if (input.prj !== undefined && /^PROJCS/.test(input.prj.replace(/^[\s\u0000\ufeff]+/, ''))) {
    errors.push({ kind: 'projected-crs' });
  }

  // The command's encoding wins over the cpg file; neither names one: the author must say.
  const named = input.encoding !== undefined ? nameText(input.encoding) : input.cpg !== undefined ? nameText(input.cpg) : '';
  const encoding: DbfEncoding | undefined = normalizeEncoding(named);
  if (encoding === undefined) errors.push({ kind: 'unknown-dbf-encoding', encoding: named });

  const header = readDbfHeader(input.dbf);
  let names: string[] = [];
  if (!header.ok) errors.push(...header.errors);
  else {
    const known = new Set(header.value.fields.map((f) => f.name));
    names = input.keep === undefined ? header.value.fields.map((f) => f.name) : [...new Set(input.keep)];
    for (const name of names) if (!known.has(name)) errors.push({ kind: 'unknown-field', field: name });
    if (header.value.records !== input.geometries.length) {
      errors.push({ kind: 'invalid-input', reason: 'the table and the shapefile differ in record count' });
    }
  }
  if (errors.length > 0 || !header.ok || encoding === undefined) return { ok: false, errors };

  const rows = readDbfRows(input.dbf, header.value, encoding, names);
  if (!rows.ok) return { ok: false, errors: rows.errors };

  const scale = input.round === undefined ? undefined : 10 ** input.round;
  const lines = input.geometries.map((geometry, i) =>
    JSON.stringify({ type: 'Feature', properties: rows.value[i], geometry: geometryOf(geometry, scale) }),
  );
  const text = `{"type":"FeatureCollection","features":[\n${lines.join(',\n')}${lines.length > 0 ? '\n' : ''}]}\n`;
  return { ok: true, value: new TextEncoder().encode(text) };
}
