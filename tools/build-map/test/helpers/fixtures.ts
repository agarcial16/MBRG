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
