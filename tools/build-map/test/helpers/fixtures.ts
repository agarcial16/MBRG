import type {
  BuildInputs,
  CountryRecord,
  GroupingTable,
  InputName,
  SourceFeature,
} from '../../src/core/types';

/** A closed square ring [lon, lat] with its south-west corner at (x, y). */
function squareCoords(x: number, y: number, size: number): [number, number][] {
  return [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y],
  ];
}

/** A source feature made of one square polygon. */
export function feature(props: Record<string, unknown>, x = 0, y = 0, size = 1): SourceFeature {
  return {
    props,
    polygons: [{ outer: { coords: squareCoords(x, y, size) }, holes: [] }],
  };
}

/** A first-level province feature. Extra props (name, name_es) go in `extra`. */
export function province(
  adm1_code: string,
  adm0_a3: string,
  extra: Record<string, unknown> = {},
  x = 0,
  y = 0,
): SourceFeature {
  return feature({ adm1_code, adm0_a3, ...extra }, x, y);
}

/** The GeoJSON FeatureCollection value the builder reads for a list of features. */
export function toGeoJson(features: SourceFeature[]): unknown {
  return {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature',
      properties: f.props,
      geometry:
        f.polygons.length === 1
          ? { type: 'Polygon', coordinates: ringsOf(f.polygons[0]!) }
          : { type: 'MultiPolygon', coordinates: f.polygons.map(ringsOf) },
    })),
  };
}

function ringsOf(polygon: SourceFeature['polygons'][number]): [number, number][][] {
  return [polygon.outer.coords, ...polygon.holes.map((h) => h.coords)];
}

/** Valid, small, complete inputs: three countries, a lake-free layout is not needed here. */
export function baseInputs(): BuildInputs {
  const countries: CountryRecord[] = [
    { adm0_a3: 'DEU', name: 'Germany', name_es: 'Alemania' },
    { adm0_a3: 'ESP', name: 'Spain', name_es: 'Espana' },
    { adm0_a3: 'FRA', name: 'France', name_es: 'Francia' },
  ];
  const grouping: GroupingTable = {
    countries: [{ country: 'DEU' }, { country: 'ESP' }, { country: 'FRA' }],
    territories: [
      { key: 'baviera', country: 'DEU', provinces: ['DE-BY'] },
      { key: 'baden', country: 'DEU', provinces: ['DE-BW'] },
      { key: 'madrid', country: 'ESP', provinces: ['ES-MD'] },
      { key: 'paris', country: 'FRA', provinces: ['FR-IDF'] },
      { key: 'lyon', country: 'FRA', provinces: ['FR-ARA'] },
    ],
    excluded: [],
  };
  return {
    provinces: [
      province('DE-BY', 'DEU', { name: 'Bavaria', name_es: 'Baviera' }, 0, 0),
      province('DE-BW', 'DEU', { name: 'Baden-Wurttemberg', name_es: 'Baden' }, 1, 0),
      province('ES-MD', 'ESP', { name: 'Madrid', name_es: 'Madrid' }, 2, 0),
      province('FR-IDF', 'FRA', { name: 'Ile-de-France', name_es: 'Isla de Francia' }, 3, 0),
      province('FR-ARA', 'FRA', { name: 'Auvergne-Rhone-Alpes', name_es: 'Auvernia' }, 4, 0),
    ],
    countries,
    otherLand: [feature({ adm0_a3: 'CHE' }, 5, 0)],
    grouping,
    seeds: [
      { name: 'Mar Cantabrico', lon: 0.5, lat: 3 },
      { name: 'Mediterraneo', lon: 1.5, lat: 3 },
    ],
    meta: { version: '5.1.2' },
    params: { width: 64, margin: 0.02, minPieceSize: 4 },
  };
}

/** The raw text of every input file for the given inputs, as the builder reads them. */
export function inputTexts(inputs: BuildInputs = baseInputs()): Record<InputName, string> {
  return {
    provinces: JSON.stringify(toGeoJson(inputs.provinces)),
    countries: JSON.stringify(inputs.countries),
    otherLand: JSON.stringify(toGeoJson(inputs.otherLand)),
    grouping: JSON.stringify(inputs.grouping),
    seeds: JSON.stringify(inputs.seeds),
    meta: JSON.stringify(inputs.meta),
    params: JSON.stringify(inputs.params),
  };
}

/** A rectangle polygon (closed ring) with the corners (x0, y0) and (x1, y1), with optional holes. */
function rectPolygon(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  holes: [number, number, number, number][] = [],
): SourceFeature['polygons'][number] {
  const ring = (a: number, b: number, c: number, d: number): { coords: [number, number][] } => ({
    coords: [
      [a, b],
      [c, b],
      [c, d],
      [a, d],
      [a, b],
    ],
  });
  return { outer: ring(x0, y0, x1, y1), holes: holes.map(([a, b, c, d]) => ring(a, b, c, d)) };
}

/** A feature made of rectangle polygons (the first rectangle may carry holes). */
function rects(
  props: Record<string, unknown>,
  ...polygons: SourceFeature['polygons']
): SourceFeature {
  return { props, polygons };
}

/**
 * The "mini" fixture of the in-memory build tests (W = 64, S = 4), in lon/lat degrees:
 *   AAA: territories `norte` (AA-N, plus a tiny islet far above it, smaller than S) and
 *        `sur` (AA-S, plus an islet below it of about 12 pixels: a second piece);
 *   BBB: territory `centro` made of BB-W and BB-E (BB-E has a lake: a hole no seed reaches);
 *   CCC: territories `este` (CC-E) and `isla` (CC-I, an island), and the excluded province CC-X;
 *   other land DDD between BBB and CCC; three sea seeds around the land.
 * Ids: see `MINI_IDS`.
 */
export function miniInputs(): BuildInputs {
  const provinces: SourceFeature[] = [
    rects(
      { adm1_code: 'AA-N', adm0_a3: 'AAA', name: 'North A', name_es: 'Norte A' },
      rectPolygon(0, 3, 3, 6),
      rectPolygon(2.0, 7.0, 2.19, 7.19),
    ),
    rects(
      { adm1_code: 'AA-S', adm0_a3: 'AAA', name: 'South A', name_es: 'Sur A' },
      rectPolygon(0, 0, 3, 3),
      rectPolygon(1.2, -1.3, 1.8, -0.7),
    ),
    rects({ adm1_code: 'BB-W', adm0_a3: 'BBB', name: 'West B', name_es: 'Oeste B' }, rectPolygon(3, 0, 6, 3)),
    rects(
      { adm1_code: 'BB-E', adm0_a3: 'BBB', name: 'East B', name_es: 'Este B' },
      rectPolygon(3, 3, 6, 6, [[4, 4, 5, 5]]),
    ),
    rects({ adm1_code: 'CC-E', adm0_a3: 'CCC', name: 'East C', name_es: 'Este C' }, rectPolygon(6, 0, 9, 3)),
    rects({ adm1_code: 'CC-I', adm0_a3: 'CCC', name: 'Island C', name_es: 'Isla C' }, rectPolygon(9.5, 4, 11, 6)),
    rects({ adm1_code: 'CC-X', adm0_a3: 'CCC', name: 'Far C', name_es: 'Lejos C' }, rectPolygon(10, 0.5, 11, 1.5)),
  ];
  return {
    provinces,
    countries: [
      { adm0_a3: 'AAA', name: 'Aland', name_es: 'Alfa' },
      { adm0_a3: 'BBB', name: 'Bland', name_es: 'Breta\u00f1a' },
      { adm0_a3: 'CCC', name: 'Cland', name_es: 'Cielo' },
    ],
    otherLand: [rects({ adm0_a3: 'DDD' }, rectPolygon(6, 3, 8, 6))],
    grouping: {
      countries: [{ country: 'AAA' }, { country: 'BBB' }, { country: 'CCC' }],
      territories: [
        { key: 'sur', country: 'AAA', provinces: ['AA-S'] },
        { key: 'norte', country: 'AAA', provinces: ['AA-N'] },
        { key: 'centro', country: 'BBB', provinces: ['BB-W', 'BB-E'], name: 'Centro' },
        { key: 'isla', country: 'CCC', provinces: ['CC-I'] },
        { key: 'este', country: 'CCC', provinces: ['CC-E'] },
      ],
      excluded: ['CC-X'],
    },
    seeds: [
      { name: 'Mar del Norte', lon: 1, lat: 7.5 },
      { name: 'Mar Este', lon: 10, lat: 7.5 },
      { name: 'Mar del Sur', lon: 5.5, lat: -1.5 },
    ],
    meta: { version: '5.1.2' },
    params: { width: 64, margin: 0.02, minPieceSize: 4 },
  };
}

/** Ids of the mini fixture in map order (FR-120). */
export const MINI_IDS = {
  factions: { AAA: 1, BBB: 2, CCC: 3 },
  land: { norte: 1, sur: 2, centro: 3, este: 4, isla: 5 },
  sea: { norte: 6, este: 7, sur: 8 },
} as const;
