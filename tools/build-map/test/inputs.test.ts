import { describe, expect, it } from 'vitest';
import { INPUT_NAMES, parseBuildInputs } from '../src/core/parse-inputs';
import type { InputName } from '../src/core/types';
import { baseInputs, inputTexts } from './helpers/fixtures';

const ORDER: InputName[] = ['provinces', 'countries', 'otherLand', 'grouping', 'seeds', 'meta', 'params'];

/** Parse the base texts after replacing the text of the given inputs. */
function parseWith(changes: Partial<Record<InputName, string>>) {
  return parseBuildInputs({ ...inputTexts(), ...changes } as Record<InputName, string>);
}

/** Text of one input after a JSON-level edit. */
function edited(name: InputName, edit: (value: any) => void): string {
  const value = JSON.parse(inputTexts()[name]);
  edit(value);
  return JSON.stringify(value);
}

function reasons(changes: Partial<Record<InputName, string>>): unknown[] {
  const result = parseWith(changes);
  if (result.ok) return [];
  return result.errors.map((e) => [e.kind, e.reason]);
}

describe('FR-112 builder inputs', () => {
  it('FR-112 valid inputs parse to exactly the seven builder inputs', () => {
    const result = parseBuildInputs(inputTexts());
    expect(result).toStrictEqual({ ok: true, value: baseInputs() });
  });

  it('FR-112 the input keys are pinned and no seed, round or match state is an input', () => {
    expect(INPUT_NAMES).toStrictEqual(ORDER);
    const result = parseBuildInputs(inputTexts());
    if (!result.ok) throw new Error('expected ok');
    expect(Object.keys(result.value)).toStrictEqual(ORDER);
    const extra = { ...inputTexts(), seed: '42', round: '3', state: '{}' } as Record<InputName, string>;
    const withExtra = parseBuildInputs(extra);
    if (!withExtra.ok) throw new Error('expected ok');
    expect(Object.keys(withExtra.value)).toStrictEqual(ORDER);
  });

  it('FR-112 a seed or round key inside the parameters is not copied into the inputs', () => {
    const params = edited('params', (v) => {
      v.seed = 7;
      v.round = 2;
    });
    const result = parseWith({ params });
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.params).toStrictEqual({ width: 64, margin: 0.02, minPieceSize: 4 });
    expect(JSON.stringify(result.value)).not.toContain('seed":7');
  });

  it('FR-112 parsing twice from the same texts gives equal inputs', () => {
    expect(parseBuildInputs(inputTexts())).toStrictEqual(parseBuildInputs(inputTexts()));
  });

  it('FR-112 a province with several polygons, holes and a MultiPolygon parses to polygons with holes', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { adm1_code: 'A', adm0_a3: 'DEU' },
          geometry: {
            type: 'MultiPolygon',
            coordinates: [
              [
                [[0, 0], [4, 0], [4, 4], [0, 0]],
                [[1, 1], [2, 1], [2, 2], [1, 1]],
              ],
              [[[10, 10], [11, 10], [11, 11], [10, 10]]],
            ],
          },
        },
      ],
    };
    const result = parseWith({ provinces: JSON.stringify(fc) });
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.provinces).toStrictEqual([
      {
        props: { adm1_code: 'A', adm0_a3: 'DEU' },
        polygons: [
          {
            outer: { coords: [[0, 0], [4, 0], [4, 4], [0, 0]] },
            holes: [{ coords: [[1, 1], [2, 1], [2, 2], [1, 1]] }],
          },
          { outer: { coords: [[10, 10], [11, 10], [11, 11], [10, 10]] }, holes: [] },
        ],
      },
    ]);
  });

  it('FR-112 optional grouping fields are kept only when given', () => {
    const grouping = {
      countries: [{ country: 'DEU', color: '#112233' }],
      territories: [
        { key: 'a', country: 'DEU', provinces: ['P'], name: 'Uno', color: null },
        { key: 'b', provinces: [] },
      ],
      excluded: ['X'],
    };
    const result = parseWith({ grouping: JSON.stringify(grouping) });
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.grouping).toStrictEqual(grouping);
  });

  const MALFORMED: [string, InputName, () => string, string][] = [
    ['provinces unreadable', 'provinces', () => undefined as unknown as string, 'provinces: input is unreadable'],
    ['provinces not JSON', 'provinces', () => '{', 'provinces: not valid JSON'],
    ['provinces not an object', 'provinces', () => '[]', 'provinces: must be a FeatureCollection object with a features list'],
    ['provinces without features list', 'provinces', () => '{"type":"FeatureCollection"}', 'provinces: must be a FeatureCollection object with a features list'],
    ['provinces feature not an object', 'provinces', () => edited('provinces', (v) => (v.features[1] = 5)), 'provinces: features[1] must be an object'],
    ['provinces properties missing', 'provinces', () => edited('provinces', (v) => delete v.features[0].properties), 'provinces: features[0].properties must be an object'],
    ['provinces adm1_code not text', 'provinces', () => edited('provinces', (v) => (v.features[2].properties.adm1_code = 3)), 'provinces: features[2].properties.adm1_code must be text'],
    ['provinces adm0_a3 not text', 'provinces', () => edited('provinces', (v) => (v.features[0].properties.adm0_a3 = null)), 'provinces: features[0].properties.adm0_a3 must be text'],
    ['provinces geometry null', 'provinces', () => edited('provinces', (v) => (v.features[0].geometry = null)), 'provinces: features[0].geometry must be a Polygon or MultiPolygon'],
    ['provinces geometry other type', 'provinces', () => edited('provinces', (v) => (v.features[0].geometry.type = 'Point')), 'provinces: features[0].geometry must be a Polygon or MultiPolygon'],
    ['provinces polygon without rings', 'provinces', () => edited('provinces', (v) => (v.features[0].geometry.coordinates = [])), 'provinces: features[0].geometry.coordinates must have at least one ring'],
    ['provinces ring not a list', 'provinces', () => edited('provinces', (v) => (v.features[0].geometry.coordinates[0] = 'x')), 'provinces: features[0].geometry.coordinates[0] must be a list of positions'],
    ['provinces non-numeric coordinate', 'provinces', () => edited('provinces', (v) => (v.features[0].geometry.coordinates[0][1][0] = 'a')), 'provinces: features[0].geometry.coordinates[0][1] must be a [longitude, latitude] pair of finite numbers'],
    ['provinces position with three numbers', 'provinces', () => edited('provinces', (v) => v.features[0].geometry.coordinates[0][2].push(9)), 'provinces: features[0].geometry.coordinates[0][2] must be a [longitude, latitude] pair of finite numbers'],
    ['provinces non-finite coordinate', 'provinces', () => inputTexts().provinces.replace('"coordinates":[[[0,0]', '"coordinates":[[[1e999,0]'), 'provinces: features[0].geometry.coordinates[0][0] must be a [longitude, latitude] pair of finite numbers'],
    ['countries not a list', 'countries', () => '{}', 'countries: must be a list'],
    ['countries record not an object', 'countries', () => edited('countries', (v) => (v[1] = [])), 'countries: [1] must be an object'],
    ['countries adm0_a3 not text', 'countries', () => edited('countries', (v) => (v[0].adm0_a3 = 5)), 'countries: [0].adm0_a3 must be text'],
    ['otherLand not a collection', 'otherLand', () => '5', 'otherLand: must be a FeatureCollection object with a features list'],
    ['otherLand properties not an object', 'otherLand', () => edited('otherLand', (v) => (v.features[0].properties = [])), 'otherLand: features[0].properties must be an object'],
    ['otherLand bad coordinate', 'otherLand', () => edited('otherLand', (v) => (v.features[0].geometry.coordinates[0][3] = [1])), 'otherLand: features[0].geometry.coordinates[0][3] must be a [longitude, latitude] pair of finite numbers'],
    ['grouping not an object', 'grouping', () => '[]', 'grouping: must be an object'],
    ['grouping countries missing', 'grouping', () => edited('grouping', (v) => delete v.countries), 'grouping: countries must be a list'],
    ['grouping country entry not an object', 'grouping', () => edited('grouping', (v) => (v.countries[0] = 'DEU')), 'grouping: countries[0] must be an object'],
    ['grouping country code not text', 'grouping', () => edited('grouping', (v) => (v.countries[1].country = 3)), 'grouping: countries[1].country must be text'],
    ['grouping country colour not text', 'grouping', () => edited('grouping', (v) => (v.countries[0].color = 5)), 'grouping: countries[0].color must be text when given'],
    ['grouping territories not a list', 'grouping', () => edited('grouping', (v) => (v.territories = {})), 'grouping: territories must be a list'],
    ['grouping territory not an object', 'grouping', () => edited('grouping', (v) => (v.territories[2] = null)), 'grouping: territories[2] must be an object'],
    ['grouping territory key not text', 'grouping', () => edited('grouping', (v) => (v.territories[0].key = 1)), 'grouping: territories[0].key must be text'],
    ['grouping territory country not text', 'grouping', () => edited('grouping', (v) => (v.territories[0].country = 1)), 'grouping: territories[0].country must be text when given'],
    ['grouping territory provinces not text list', 'grouping', () => edited('grouping', (v) => (v.territories[3].provinces = ['A', 2])), 'grouping: territories[3].provinces must be a list of text'],
    ['grouping excluded missing', 'grouping', () => edited('grouping', (v) => delete v.excluded), 'grouping: excluded must be a list of text'],
    ['grouping excluded not text', 'grouping', () => edited('grouping', (v) => (v.excluded = [1])), 'grouping: excluded must be a list of text'],
    ['seeds not a list', 'seeds', () => '{}', 'seeds: must be a list'],
    ['seed not an object', 'seeds', () => edited('seeds', (v) => (v[0] = 1)), 'seeds: [0] must be an object'],
    ['seed without a text name', 'seeds', () => edited('seeds', (v) => delete v[1].name), 'seeds: [1].name must be text'],
    ['seed name not text', 'seeds', () => edited('seeds', (v) => (v[0].name = 9)), 'seeds: [0].name must be text'],
    ['seed longitude not a number', 'seeds', () => edited('seeds', (v) => (v[0].lon = '1')), 'seeds: [0].lon must be a finite number'],
    ['seed latitude not finite', 'seeds', () => inputTexts().seeds.replace('"lat":3', '"lat":1e999'), 'seeds: [0].lat must be a finite number'],
    ['meta not an object', 'meta', () => 'null', 'meta: must be an object'],
    ['meta version not text', 'meta', () => '{"version":5}', 'meta: version must be text'],
    ['params not an object', 'params', () => '3', 'params: must be an object'],
    ['params width zero', 'params', () => edited('params', (v) => (v.width = 0)), 'params: width must be an integer of at least 1'],
    ['params width fractional', 'params', () => edited('params', (v) => (v.width = 64.5)), 'params: width must be an integer of at least 1'],
    ['params width missing', 'params', () => edited('params', (v) => delete v.width), 'params: width must be an integer of at least 1'],
    ['params margin negative', 'params', () => edited('params', (v) => (v.margin = -0.01)), 'params: margin must be a finite number of at least 0'],
    ['params margin not finite', 'params', () => inputTexts().params.replace('"margin":0.02', '"margin":1e999'), 'params: margin must be a finite number of at least 0'],
    ['params margin text', 'params', () => edited('params', (v) => (v.margin = '0')), 'params: margin must be a finite number of at least 0'],
    ['params piece size zero', 'params', () => edited('params', (v) => (v.minPieceSize = 0)), 'params: minPieceSize must be an integer of at least 1'],
    ['params piece size fractional', 'params', () => edited('params', (v) => (v.minPieceSize = 2.5)), 'params: minPieceSize must be an integer of at least 1'],
  ];

  for (const [label, name, makeText, reason] of MALFORMED) {
    it(`FR-112 malformed input fails with one invalid-input: ${label}`, () => {
      expect(reasons({ [name]: makeText() })).toStrictEqual([['invalid-input', reason]]);
    });
  }

  it('FR-112 a margin of exactly 0 and a width and piece size of exactly 1 are valid', () => {
    const params = JSON.stringify({ width: 1, margin: 0, minPieceSize: 1 });
    expect(parseWith({ params }).ok).toBe(true);
  });

  it('FR-112 several malformed inputs give one error each in the order of the inputs', () => {
    const texts = {
      params: '{}',
      meta: '5',
      seeds: '5',
      grouping: '5',
      otherLand: '5',
      countries: '5',
      provinces: '5',
    } as Record<InputName, string>;
    const result = parseBuildInputs(texts);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.reason.split(':')[0])).toStrictEqual(ORDER);
    expect(result.errors.every((e) => e.kind === 'invalid-input')).toBe(true);
  });

  it('FR-112 only the first problem of an input is reported', () => {
    const params = JSON.stringify({ width: 0, margin: -1, minPieceSize: 0 });
    expect(reasons({ params })).toStrictEqual([['invalid-input', 'params: width must be an integer of at least 1']]);
  });

  it('FR-112 an unreadable input does not hide the problems of the others', () => {
    expect(reasons({ meta: undefined as unknown as string, params: '{}' })).toStrictEqual([
      ['invalid-input', 'meta: input is unreadable'],
      ['invalid-input', 'params: width must be an integer of at least 1'],
    ]);
  });
});
