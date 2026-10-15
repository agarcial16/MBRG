import type { Result } from '@mbrg/shared';
import { compareCodeUnits } from '../core/errors';
import { formatJson } from '../core/json';
import type { SourceFeature } from '../core/types';

/**
 * FR-131: the pure part of the extraction step. It turns the records read from the two Natural
 * Earth datasets (first-level divisions, admin-0 countries) into the committed source data. No
 * file, clock or randomness access (NFR-14 scan); the files are read by the command and the
 * shapefile library lives only in `read-shapefile.ts`.
 */

/** The version text file shipped with each dataset used. */
export const VERSION_FILES = {
  admin1: 'ne_10m_admin_1_states_provinces.VERSION.txt',
  admin0: 'ne_10m_admin_0_countries.VERSION.txt',
} as const;

/** The fixed longitude/latitude extraction box (degrees). */
export interface ExtractBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface ExtractSource {
  admin1: SourceFeature[];
  admin0: SourceFeature[];
  /** Text of each version file by file name; a missing file is absent or undefined. */
  versionTexts: Record<string, string | undefined>;
}

/** The four committed source files, as the fixed builder JSON text. */
export interface ExtractFiles {
  provinces: Uint8Array;
  countries: Uint8Array;
  otherLand: Uint8Array;
  meta: Uint8Array;
}

export type ExtractError = { kind: 'invalid-source-version'; files: string[] };

/** Decimal places kept in every coordinate (about one metre; at least 4 by the spec). */
export const DEFAULT_DECIMALS = 5;

const PROVINCE_PROPS = ['adm1_code', 'adm0_a3', 'name', 'name_es'] as const;
const COUNTRY_PROPS = ['adm0_a3', 'name', 'name_es'] as const;
const OTHER_LAND_PROPS = ['adm0_a3'] as const;

/** Version text with its trailing line breaks removed; undefined when missing or empty. */
function versionOf(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const version = text.replace(/[\r\n]+$/, '');
  return version === '' ? undefined : version;
}

/** The wanted properties by case-insensitive name, written in the wanted order and lower case. */
function pickProps(props: Record<string, unknown>, wanted: readonly string[]): Record<string, unknown> {
  const lower = new Map<string, unknown>();
  for (const key of Object.keys(props)) lower.set(key.toLowerCase(), props[key]);
  const out: Record<string, unknown> = {};
  for (const key of wanted) if (lower.has(key)) out[key] = lower.get(key);
  return out;
}

function codeOf(feature: SourceFeature, key: string): string {
  const value = pickProps(feature.props, [key])[key];
  return typeof value === 'string' ? value : '';
}

type Pair = [number, number];

/** Rounds to `decimals` places and collapses consecutive equal vertices; never removes any other vertex. */
function roundRing(coords: readonly Pair[], scale: number): Pair[] {
  const out: Pair[] = [];
  for (const [x, y] of coords) {
    const rx = Math.round(x * scale) / scale + 0;
    const ry = Math.round(y * scale) / scale + 0;
    const last = out[out.length - 1];
    if (last !== undefined && last[0] === rx && last[1] === ry) continue;
    out.push([rx, ry]);
  }
  return out;
}

function geometryOf(polygons: SourceFeature['polygons'], scale: number): unknown {
  const rings = polygons.map((p) => [p.outer, ...p.holes].map((r) => roundRing(r.coords, scale)));
  return rings.length === 1
    ? { type: 'Polygon', coordinates: rings[0] }
    : { type: 'MultiPolygon', coordinates: rings };
}

/** True when the polygon's own bounding box intersects or touches the box. */
function boxTouches(polygon: SourceFeature['polygons'][number], box: ExtractBox): boolean {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [x, y] of polygon.outer.coords) {
    if (x < west) west = x;
    if (x > east) east = x;
    if (y < south) south = y;
    if (y > north) north = y;
  }
  return west <= box.east && east >= box.west && south <= box.north && north >= box.south;
}

function bySortKey<T>(items: readonly T[], key: (item: T) => string): T[] {
  // Array.prototype.sort is stable, so equal keys keep the order of the source file.
  return [...items].sort((a, b) => compareCodeUnits(key(a), key(b)));
}

/**
 * FR-131: the committed source data from the two datasets, the selected country codes and the
 * extraction box. Fails with `invalid-source-version` when a dataset's version text is missing or
 * the two differ (trailing line breaks ignored); `files` names both version files in code-unit order.
 */
export function extract(
  source: ExtractSource,
  selected: readonly string[],
  box: ExtractBox,
  decimals: number = DEFAULT_DECIMALS,
): Result<ExtractFiles, ExtractError> {
  const first = versionOf(source.versionTexts[VERSION_FILES.admin1]);
  const second = versionOf(source.versionTexts[VERSION_FILES.admin0]);
  if (first === undefined || second === undefined || first !== second) {
    const files = [VERSION_FILES.admin1, VERSION_FILES.admin0].sort(compareCodeUnits);
    return { ok: false, errors: [{ kind: 'invalid-source-version', files }] };
  }
  const scale = 10 ** decimals;
  const isSelected = (feature: SourceFeature): boolean => selected.includes(codeOf(feature, 'adm0_a3'));

  const provinces = bySortKey(source.admin1.filter(isSelected), (f) => codeOf(f, 'adm1_code')).map((f) => ({
    type: 'Feature',
    properties: pickProps(f.props, PROVINCE_PROPS),
    geometry: geometryOf(f.polygons, scale),
  }));

  const countries = bySortKey(source.admin0.filter(isSelected), (f) => codeOf(f, 'adm0_a3')).map((f) =>
    pickProps(f.props, COUNTRY_PROPS),
  );

  // Other land: per polygon, decided by the polygon's own bounding box; a feature keeps its kept polygons whole.
  const otherLand = bySortKey(
    source.admin0
      .filter((f) => !isSelected(f))
      .map((f) => ({ props: f.props, polygons: f.polygons.filter((p) => boxTouches(p, box)) }))
      .filter((f) => f.polygons.length > 0),
    (f) => codeOf(f, 'adm0_a3'),
  ).map((f) => ({
    type: 'Feature',
    properties: pickProps(f.props, OTHER_LAND_PROPS),
    geometry: geometryOf(f.polygons, scale),
  }));

  const collection = (features: unknown[]): unknown => ({ type: 'FeatureCollection', features });
  return {
    ok: true,
    value: {
      provinces: formatJson(collection(provinces)),
      countries: formatJson(countries),
      otherLand: formatJson(collection(otherLand)),
      meta: formatJson({ version: first }),
    },
  };
}
