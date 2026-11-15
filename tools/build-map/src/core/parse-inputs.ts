import type { Result } from '@mbrg/shared';
import { own } from './errors';
import type {
  BuildInputs,
  BuildParams,
  CountryRecord,
  GroupingTable,
  InputError,
  InputName,
  SeaSeed,
  SourceFeature,
  SourcePolygon,
} from './types';

/** FR-112: the inputs in the order their errors are reported. */
export const INPUT_NAMES: readonly InputName[] = [
  'provinces',
  'countries',
  'otherLand',
  'grouping',
  'seeds',
  'meta',
  'params',
];

/** The first problem found in one input; caught by `parseBuildInputs`. */
class Problem extends Error {}

const problem = (text: string): never => {
  throw new Problem(text);
};

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function readText(object: object, key: string, path: string, optional = false): string | undefined {
  const value = own(object, key);
  if (value === undefined && optional && !Object.hasOwn(object, key)) return undefined;
  if (typeof value !== 'string') return problem(`${path} must be text${optional ? ' when given' : ''}`);
  return value;
}

function readList(object: object, key: string, path: string, what = 'a list'): unknown[] {
  const value = own(object, key);
  return Array.isArray(value) ? value : problem(`${path} must be ${what}`);
}

function readTextList(object: object, key: string, path: string): string[] {
  const value = own(object, key);
  if (!Array.isArray(value) || !value.every((x) => typeof x === 'string')) {
    return problem(`${path} must be a list of text`);
  }
  return value as string[];
}

const NOT_COLLECTION = 'must be a FeatureCollection object with a features list';

function parseRing(value: unknown, path: string): { coords: [number, number][] } {
  if (!Array.isArray(value)) return problem(`${path} must be a list of positions`);
  const coords: [number, number][] = [];
  for (let i = 0; i < value.length; i++) {
    const p: unknown = value[i];
    if (!Array.isArray(p) || p.length !== 2 || !isFiniteNumber(p[0]) || !isFiniteNumber(p[1])) {
      return problem(`${path}[${i}] must be a [longitude, latitude] pair of finite numbers`);
    }
    coords.push([p[0], p[1]]);
  }
  return { coords };
}

function parsePolygon(value: unknown, path: string): SourcePolygon {
  if (!Array.isArray(value) || value.length === 0) return problem(`${path} must have at least one ring`);
  const rings = value.map((ring, r) => parseRing(ring, `${path}[${r}]`));
  return { outer: rings[0]!, holes: rings.slice(1) };
}

function parseFeatures(root: unknown, provinceProps: boolean): SourceFeature[] {
  if (!isObject(root) || !Array.isArray(own(root, 'features'))) return problem(NOT_COLLECTION);
  const features = own(root, 'features') as unknown[];
  return features.map((f, i) => {
    const at = `features[${i}]`;
    if (!isObject(f)) return problem(`${at} must be an object`);
    const props = own(f, 'properties');
    if (!isObject(props)) return problem(`${at}.properties must be an object`);
    if (provinceProps) {
      readText(props, 'adm1_code', `${at}.properties.adm1_code`);
      readText(props, 'adm0_a3', `${at}.properties.adm0_a3`);
    }
    const geometry = own(f, 'geometry');
    const type = isObject(geometry) ? own(geometry, 'type') : undefined;
    if (!isObject(geometry) || (type !== 'Polygon' && type !== 'MultiPolygon')) {
      return problem(`${at}.geometry must be a Polygon or MultiPolygon`);
    }
    const coordinates = own(geometry, 'coordinates');
    const path = `${at}.geometry.coordinates`;
    let polygons: SourcePolygon[];
    if (type === 'Polygon') {
      polygons = [parsePolygon(coordinates, path)];
    } else {
      if (!Array.isArray(coordinates)) return problem(`${path} must be a list of polygons`);
      polygons = coordinates.map((polygon, p) => parsePolygon(polygon, `${path}[${p}]`));
    }
    return { props: props as Record<string, unknown>, polygons };
  });
}

function parseCountries(root: unknown): CountryRecord[] {
  if (!Array.isArray(root)) return problem('must be a list');
  return root.map((r, i) => {
    if (!isObject(r)) return problem(`[${i}] must be an object`);
    readText(r, 'adm0_a3', `[${i}].adm0_a3`);
    return r as unknown as CountryRecord;
  });
}

function parseGrouping(root: unknown): GroupingTable {
  if (!isObject(root)) return problem('must be an object');
  const countries = readList(root, 'countries', 'countries').map((c, i) => {
    const at = `countries[${i}]`;
    if (!isObject(c)) return problem(`${at} must be an object`);
    const country = readText(c, 'country', `${at}.country`) as string;
    const color = readText(c, 'color', `${at}.color`, true);
    return color === undefined ? { country } : { country, color };
  });
  const territories = readList(root, 'territories', 'territories').map((t, i) => {
    const at = `territories[${i}]`;
    if (!isObject(t)) return problem(`${at} must be an object`);
    const key = readText(t, 'key', `${at}.key`) as string;
    const country = readText(t, 'country', `${at}.country`, true);
    const provinces = readTextList(t, 'provinces', `${at}.provinces`);
    const out: GroupingTable['territories'][number] = { key, provinces };
    if (country !== undefined) out.country = country;
    if (Object.hasOwn(t, 'name')) out.name = t.name;
    if (Object.hasOwn(t, 'color')) out.color = t.color;
    return out;
  });
  const excluded = readTextList(root, 'excluded', 'excluded');
  return { countries, territories, excluded };
}

function parseSeeds(root: unknown): SeaSeed[] {
  if (!Array.isArray(root)) return problem('must be a list');
  return root.map((s, i) => {
    if (!isObject(s)) return problem(`[${i}] must be an object`);
    const name = readText(s, 'name', `[${i}].name`) as string;
    const lon = own(s, 'lon');
    if (!isFiniteNumber(lon)) return problem(`[${i}].lon must be a finite number`);
    const lat = own(s, 'lat');
    if (!isFiniteNumber(lat)) return problem(`[${i}].lat must be a finite number`);
    return { name, lon, lat };
  });
}

function parseMeta(root: unknown): { version: string } {
  if (!isObject(root)) return problem('must be an object');
  return { version: readText(root, 'version', 'version') as string };
}

function parseParams(root: unknown): BuildParams {
  if (!isObject(root)) return problem('must be an object');
  const width = own(root, 'width');
  if (typeof width !== 'number' || !Number.isInteger(width) || width < 1) {
    return problem('width must be an integer of at least 1');
  }
  const margin = own(root, 'margin');
  if (!isFiniteNumber(margin) || margin < 0) return problem('margin must be a finite number of at least 0');
  const minPieceSize = own(root, 'minPieceSize');
  if (typeof minPieceSize !== 'number' || !Number.isInteger(minPieceSize) || minPieceSize < 1) {
    return problem('minPieceSize must be an integer of at least 1');
  }
  return { width, margin, minPieceSize };
}

const PARSERS: { [K in InputName]: (root: unknown) => BuildInputs[K] } = {
  provinces: (root) => parseFeatures(root, true),
  countries: parseCountries,
  otherLand: (root) => parseFeatures(root, false),
  grouping: parseGrouping,
  seeds: parseSeeds,
  meta: parseMeta,
  params: parseParams,
};

/**
 * FR-112: parse the text of the seven inputs. Every malformed input gives one `invalid-input`
 * (the first problem found in it), in the order of INPUT_NAMES. Other keys of `texts` are ignored;
 * the parsed inputs hold exactly the seven inputs (no seed, round or match state).
 */
export function parseBuildInputs(texts: Record<InputName, string>): Result<BuildInputs, InputError> {
  const errors: InputError[] = [];
  const parsed: Record<string, unknown> = {};
  for (const name of INPUT_NAMES) {
    const text: unknown = Object.hasOwn(texts, name) ? texts[name] : undefined;
    try {
      if (typeof text !== 'string') problem('input is unreadable');
      let root: unknown;
      try {
        root = JSON.parse(text as string);
      } catch {
        problem('not valid JSON');
      }
      parsed[name] = PARSERS[name](root);
    } catch (e) {
      if (!(e instanceof Problem)) throw e;
      errors.push({ kind: 'invalid-input', reason: `${name}: ${e.message}` });
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: parsed as unknown as BuildInputs };
}
