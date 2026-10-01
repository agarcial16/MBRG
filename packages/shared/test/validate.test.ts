import { describe, expect, it } from 'vitest';

import { normalizeMap, validateMap, buildAdjacency, type MapFormatV1 } from '@mbrg/shared';

function validMap(): MapFormatV1 {
  return {
    version: 1,
    name: 'triangle',
    territories: [
      { id: 'A', neighbors: ['B', 'C'], polygons: [[[0, 0], [10, 0], [10, 10], [0, 10]]] },
      { id: 'B', neighbors: ['A', 'C'], polygons: [[[10, 0], [20, 0], [20, 10], [10, 10]]] },
      { id: 'C', neighbors: ['A', 'B'], polygons: [[[0, 10], [10, 10], [10, 20], [0, 20]]] },
    ],
  };
}

describe('validateMap', () => {
  it('accepts a valid map with no warnings', () => {
    const result = validateMap(validMap());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('rejects non-objects', () => {
    expect(validateMap(null).errors.length).toBeGreaterThan(0);
    expect(validateMap('nope').errors.length).toBeGreaterThan(0);
    expect(validateMap([]).errors.length).toBeGreaterThan(0);
  });

  it('rejects a wrong version', () => {
    const map = { ...validMap(), version: 2 };
    expect(validateMap(map).errors.join()).toMatch(/unsupported version/);
  });

  it('rejects an empty name and empty territories', () => {
    expect(validateMap({ ...validMap(), name: '  ' }).errors.join()).toMatch(/name/);
    expect(validateMap({ ...validMap(), territories: [] }).errors.join()).toMatch(/territories/);
  });

  it('rejects duplicate ids', () => {
    const map = validMap();
    map.territories[1] = { ...map.territories[1], id: 'A' };
    const result = validateMap(map);
    expect(result.errors.join()).toMatch(/duplicate territory id/);
    // A lost its true twin → its old references dangle as well.
    expect(result.errors.join()).toMatch(/not symmetric|unknown/);
  });

  it('rejects unknown references and asymmetry', () => {
    const unknown = validMap();
    unknown.territories[0].neighbors = ['B', 'C', 'Z'];
    expect(validateMap(unknown).errors.join()).toMatch(/unknown territory "Z"/);

    const asymmetric = validMap();
    asymmetric.territories[0].neighbors = ['B']; // dropped C, but C still lists A
    expect(validateMap(asymmetric).errors.join()).toMatch(/not symmetric/);
  });

  it('rejects self references', () => {
    const map = validMap();
    map.territories[0].neighbors = ['A', 'B', 'C'];
    expect(validateMap(map).errors.join()).toMatch(/contains itself/);
  });

  it('rejects malformed polygons', () => {
    const tooFew = validMap();
    tooFew.territories[0].polygons[0] = [[0, 0], [1, 1]];
    expect(validateMap(tooFew).errors.join()).toMatch(/at least 3 points/);

    const nonFinite = validMap();
    nonFinite.territories[0].polygons[0] = [[0, 0], [Number.NaN, 1], [2, 2]];
    expect(validateMap(nonFinite).errors.join()).toMatch(/finite numbers/);
  });

  it('warns about islands instead of failing', () => {
    const map = validMap();
    map.territories.push({ id: 'I', neighbors: [], polygons: [[[50, 50], [60, 50], [60, 60]]] });
    const result = validateMap(map);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join()).toMatch(/"I" has no connections/);
  });

  it('rejects an empty polygons list', () => {
    const map = validMap();
    (map.territories[0] as { polygons: unknown[] }).polygons = [];
    expect(validateMap(map).errors.join()).toMatch(/needs at least one ring/);
  });

  it('rejects a malformed ring inside a multi-piece territory', () => {
    const map = validMap();
    map.territories[0].polygons.push([[0, 0]]);
    expect(validateMap(map).errors.join()).toMatch(/polygons\[1\] needs at least 3 points/);
  });

  it('accepts a territory made of several pieces', () => {
    const map = validMap();
    // A mainland plus an island: one province, conquered as one.
    map.territories[0].polygons.push([[100, 100], [110, 100], [110, 110]]);
    expect(validateMap(map).errors).toEqual([]);
  });

  it('accepts the pre-polygons shape and lifts it', () => {
    // A map saved before the rename: one ring per territory, called `polygon`.
    const legacy = {
      version: 1,
      name: 'legacy',
      territories: [
        { id: 'A', neighbors: ['B'], polygon: [[0, 0], [10, 0], [10, 10]] },
        { id: 'B', neighbors: ['A'], polygon: [[10, 0], [20, 0], [20, 10]] },
      ],
    };
    expect(validateMap(legacy).errors).toEqual([]);

    const lifted = normalizeMap(legacy) as MapFormatV1;
    expect(lifted.territories[0].polygons).toEqual([[[0, 0], [10, 0], [10, 10]]]);
    // The old key is gone, so a stale `polygon` can never shadow `polygons`.
    expect('polygon' in (lifted.territories[0] as object)).toBe(false);
  });

  it('leaves a current-shape map untouched and does not mutate the input', () => {
    const map = validMap();
    const before = JSON.stringify(map);
    expect(normalizeMap(map)).toEqual(map);
    expect(JSON.stringify(map)).toBe(before);
  });
});

describe('buildAdjacency', () => {
  it('unions land and sea links, sorted, without self-references', () => {
    const map: MapFormatV1 = {
      version: 1,
      name: 'sea',
      territories: [
        { id: 'A', neighbors: ['C'], seaLinks: ['B'], polygons: [[[0, 0], [1, 0], [1, 1]]] },
        { id: 'B', neighbors: [], seaLinks: ['A'], polygons: [[[2, 0], [3, 0], [3, 1]]] },
        { id: 'C', neighbors: ['A'], polygons: [[[0, 2], [1, 2], [1, 3]]] },
      ],
    };
    const adjacency = buildAdjacency(map);
    expect(adjacency.get('A')).toEqual(['B', 'C']);
    expect(adjacency.get('B')).toEqual(['A']);
    expect(adjacency.get('C')).toEqual(['A']);
  });
});
