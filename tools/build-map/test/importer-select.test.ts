import { describe, expect, it } from 'vitest';
import { parseCuration, type Curation } from '../src/importer/curation';
import { selectUnits, unitExtent } from '../src/importer/select';
import { buildUnits, type Unit } from '../src/importer/units';
import type { ImportFeature } from '../src/importer/types';
import { ring, textBytes } from './helpers/geo-fixture';

function curation(change: (c: Record<string, any>) => void = () => undefined): Curation {
  const c: Record<string, any> = {
    primary: 'p.geojson',
    columns: { key: 'code', name: ['name'] },
    params: { side: 2048, margin: 0.02, minPieceSize: 40, projection: 'laea' },
  };
  change(c);
  const r = parseCuration(textBytes(JSON.stringify(c)), 'c.json');
  if (!r.ok) throw new Error(`fixture curation is invalid: ${JSON.stringify(r.errors)}`);
  return r.value;
}

let counter = 0;
function feature(props: Record<string, unknown>, x = counter * 3, y = 0, size = 1): ImportFeature {
  return { index: counter++, props, polygons: [{ outer: { coords: ring(x, y, size) as [number, number][] }, holes: [] }] };
}

function unitsOf(features: ImportFeature[], c: Curation): Unit[] {
  const r = buildUnits(features, c);
  if (!r.ok) throw new Error(`units failed: ${JSON.stringify(r.errors)}`);
  return r.value;
}

/** The keys of the selected units, or the errors when the selection fails. */
function pick(features: ImportFeature[], change: (c: Record<string, any>) => void = () => undefined): string[] {
  const c = curation(change);
  const r = selectUnits(unitsOf(features, c), c);
  if (!r.ok) throw new Error(`selection failed: ${JSON.stringify(r.errors)}`);
  return r.value.selected.map((u) => u.key);
}
function failures(features: ImportFeature[], change: (c: Record<string, any>) => void = () => undefined): unknown[] {
  const c = curation(change);
  const r = selectUnits(unitsOf(features, c), c);
  if (r.ok) throw new Error('expected errors');
  return r.errors;
}

const letters = () => ['A', 'B', 'C'].map((code, i) => feature({ code, n: i + 1, t: code.toLowerCase() }));

describe('FR-594 the selection of units', () => {
  it('FR-594 selects every unit when select is absent or empty, and keeps the rest in other', () => {
    for (const change of [() => undefined, (c: Record<string, any>) => (c.select = [])]) {
      const c = curation(change);
      const r = selectUnits(unitsOf(letters(), c), c);
      expect(r.ok && r.value.selected.map((u) => u.key)).toStrictEqual(['A', 'B', 'C']);
      expect(r.ok && r.value.other).toStrictEqual([]);
    }
  });

  it('FR-594 drops the units of exclude, and the units whose per-unit kind is exclude, into other land in unit order', () => {
    const c = curation((x) => {
      x.exclude = ['B'];
      x.units = { C: { kind: 'exclude' } };
    });
    const r = selectUnits(unitsOf(letters(), c), c);
    expect(r.ok && r.value.selected.map((u) => u.key)).toStrictEqual(['A']);
    expect(r.ok && r.value.other.map((u) => u.key)).toStrictEqual(['B', 'C']);
  });

  it('FR-594 keeps the units that fail a filter in other land, with the excluded ones, in unit order', () => {
    const c = curation((x) => {
      x.select = [{ property: 'n', gte: 2 }];
      x.exclude = ['C'];
    });
    const r = selectUnits(unitsOf(letters(), c), c);
    expect(r.ok && r.value.selected.map((u) => u.key)).toStrictEqual(['B']);
    expect(r.ok && r.value.other.map((u) => u.key)).toStrictEqual(['A', 'C']);
  });

  it('FR-594 matches eq on a text or an integer exactly, never a text with an integer, never an absent value', () => {
    expect(pick(letters(), (c) => (c.select = [{ property: 't', eq: 'b' }]))).toStrictEqual(['B']);
    expect(pick(letters(), (c) => (c.select = [{ property: 'n', eq: 3 }]))).toStrictEqual(['C']);
    expect(failures(letters(), (c) => (c.select = [{ property: 'n', eq: '3' }]))).toStrictEqual([{ kind: 'empty-selection' }]);
    expect(failures(letters(), (c) => (c.select = [{ property: 't', eq: 5 }]))).toStrictEqual([{ kind: 'empty-selection' }]);
    expect(failures(letters(), (c) => (c.select = [{ property: 'absent', eq: 'x' }]))).toStrictEqual([{ kind: 'empty-selection' }]);
    // a code that lost its leading zeros: the integer 8019 is not the text 08019
    const codes = [feature({ code: 'X', zip: 8019 }), feature({ code: 'Y', zip: '08019' })];
    expect(pick(codes, (c) => (c.select = [{ property: 'zip', eq: '08019' }]))).toStrictEqual(['Y']);
    expect(pick(codes, (c) => (c.select = [{ property: 'zip', eq: 8019 }]))).toStrictEqual(['X']);
  });

  it('FR-594 matches in against any of its values of the same kind', () => {
    expect(pick(letters(), (c) => (c.select = [{ property: 't', in: ['a', 'c', 'z'] }]))).toStrictEqual(['A', 'C']);
    expect(pick(letters(), (c) => (c.select = [{ property: 'n', in: [1, '2', 3] }]))).toStrictEqual(['A', 'C']);
    expect(failures(letters(), (c) => (c.select = [{ property: 't', in: [] }]))).toStrictEqual([{ kind: 'empty-selection' }]);
  });

  it('FR-594 compares gte and lte on two integers as numbers and on two texts by code units', () => {
    const f = () => [9, 10, 100].map((n) => feature({ code: `K${n}`, n }));
    expect(pick(f(), (c) => (c.select = [{ property: 'n', gte: 10 }]))).toStrictEqual(['K10', 'K100']);
    expect(pick(f(), (c) => (c.select = [{ property: 'n', lte: 10 }]))).toStrictEqual(['K9', 'K10']);
    const words = () => ['B', 'a', 'b', '10', '9'].map((t) => feature({ code: `W${t}`, t }));
    // by code units: digits < capitals < lower case, '10' < '9'
    expect(pick(words(), (c) => (c.select = [{ property: 't', gte: 'B' }]))).toStrictEqual(['WB', 'Wa', 'Wb']);
    expect(pick(words(), (c) => (c.select = [{ property: 't', lte: '9' }]))).toStrictEqual(['W10', 'W9']);
    // a text and an integer never compare
    expect(failures(letters(), (c) => (c.select = [{ property: 'n', gte: '0' }]))).toStrictEqual([{ kind: 'empty-selection' }]);
    expect(failures(letters(), (c) => (c.select = [{ property: 't', lte: 99 }]))).toStrictEqual([{ kind: 'empty-selection' }]);
    expect(failures(letters(), (c) => (c.select = [{ property: 'absent', lte: 99 }]))).toStrictEqual([{ kind: 'empty-selection' }]);
  });

  it('FR-594 requires every filter to match', () => {
    expect(
      pick(letters(), (c) => (c.select = [{ property: 'n', gte: 2 }, { property: 'n', lte: 2 }])),
    ).toStrictEqual(['B']);
    expect(failures(letters(), (c) => (c.select = [{ property: 'n', gte: 2 }, { property: 't', eq: 'a' }]))).toStrictEqual([{ kind: 'empty-selection' }]);
  });

  it('FR-594 selects the map of a given day from a collection of one feature per country and period', () => {
    // a 1914-style source: one feature per polity and period, each with its own id; ISO dates written as text
    const periods = [
      { id: 'FRA-1', country: 'FRA', from: '1871-05-10', to: '1914-06-27' },
      { id: 'FRA-2', country: 'FRA', from: '1914-06-28', to: '1940-06-21' },
      { id: 'AUH-1', country: 'AUH', from: '1867-03-30', to: '1918-11-11' },
      { id: 'RUS-1', country: 'RUS', from: '1721-11-02', to: '1917-03-15' },
      { id: 'YUG-1', country: 'YUG', from: '1918-12-01', to: '1941-04-17' },
    ];
    const at = (day: string) => (c: Record<string, any>) => {
      c.columns.key = 'id';
      c.select = [{ property: 'from', lte: day }, { property: 'to', gte: day }];
    };
    const f = () => periods.map((p) => feature({ ...p }));
    expect(pick(f(), at('1914-06-28'))).toStrictEqual(['FRA-2', 'AUH-1', 'RUS-1']);
    expect(pick(f(), at('1914-06-27'))).toStrictEqual(['FRA-1', 'AUH-1', 'RUS-1']);
    expect(pick(f(), at('1920-01-01'))).toStrictEqual(['FRA-2', 'YUG-1']);
    expect(failures(f(), at('1700-01-01'))).toStrictEqual([{ kind: 'empty-selection' }]);
  });

  it('FR-594 two periods of one country that share a key fail with conflicting-unit-property when their dates differ', () => {
    const c = curation((x) => (x.select = [{ property: 'from', lte: '1914-06-28' }, { property: 'to', gte: '1914-06-28' }]));
    const features = [
      feature({ code: 'FRA', from: '1871-05-10', to: '1914-06-27' }),
      feature({ code: 'FRA', from: '1914-06-28', to: '1940-06-21' }),
    ];
    const r = buildUnits(features, c);
    expect(r.ok ? [] : r.errors).toStrictEqual([
      { kind: 'conflicting-unit-property', unit: 'FRA', property: 'from' },
      { kind: 'conflicting-unit-property', unit: 'FRA', property: 'to' },
    ]);
  });

  it('FR-594 keeps a unit whose longitude and latitude range lies inside the box with within, touching edges included', () => {
    const f = () => [feature({ code: 'IN' }, 1, 1, 1), feature({ code: 'EDGE' }, 0, 0, 1), feature({ code: 'OUT' }, 9, 9, 1), feature({ code: 'ACROSS' }, 4, 4, 3)];
    const within = (c: Record<string, any>) => (c.select = [{ bbox: [0, 0, 5, 5], mode: 'within' }]);
    expect(pick(f(), within)).toStrictEqual(['IN', 'EDGE']);
    expect(pick(f(), (c) => (c.select = [{ bbox: [0, 0, 5, 5], mode: 'intersects' }]))).toStrictEqual(['IN', 'EDGE', 'ACROSS']);
    // a box touching a unit only at an edge intersects it
    expect(pick(f(), (c) => (c.select = [{ bbox: [10, 10, 12, 12], mode: 'intersects' }]))).toStrictEqual(['OUT']);
    expect(failures(f(), (c) => (c.select = [{ bbox: [20, 20, 30, 30], mode: 'intersects' }]))).toStrictEqual([{ kind: 'empty-selection' }]);
  });

  it('FR-594 judges a box on the range of all the polygons of a unit, and never matches a unit without a position', () => {
    const two: ImportFeature[] = [feature({ code: 'U' }, 0, 0, 1), feature({ code: 'U' }, 8, 0, 1)];
    expect(failures(two, (c) => (c.select = [{ bbox: [0, 0, 5, 5], mode: 'within' }]))).toStrictEqual([{ kind: 'empty-selection' }]);
    expect(pick(two, (c) => (c.select = [{ bbox: [0, 0, 5, 5], mode: 'intersects' }]))).toStrictEqual(['U']);
    expect(pick(two, (c) => (c.select = [{ bbox: [0, 0, 9, 1], mode: 'within' }]))).toStrictEqual(['U']);
  });

  it('FR-594 never matches a box against a unit without a position, in either mode', () => {
    for (const mode of ['within', 'intersects'] as const) {
      const c = curation((x) => (x.select = [{ bbox: [-180, -90, 180, 90], mode }]));
      const [u] = unitsOf([feature({ code: 'A' })], c);
      const r = selectUnits([{ ...u!, polygons: [] }], c);
      expect(r.ok ? [] : r.errors, mode).toStrictEqual([{ kind: 'empty-selection' }]);
    }
  });

  it('FR-594 fails with empty-selection when nothing is selected, also with no unit at all', () => {
    expect(failures(letters(), (c) => (c.exclude = ['A', 'B', 'C']))).toStrictEqual([{ kind: 'empty-selection' }]);
    const c = curation();
    const none = selectUnits([], c);
    expect(none.ok ? [] : none.errors).toStrictEqual([{ kind: 'empty-selection' }]);
  });

  it('FR-594 fails with unknown-unit for an exclude entry or a units key that names no unit, once per key', () => {
    const r = failures(letters(), (c) => {
      c.exclude = ['ZED', 'A', 'ZED'];
      c.units = { ZED: { kind: 'sea' }, NOPE: { name: 'x' }, B: { name: 'Bee' } };
    });
    expect(r).toStrictEqual([
      { kind: 'unknown-unit', unit: 'ZED' },
      { kind: 'unknown-unit', unit: 'NOPE' },
    ]);
  });

  it('FR-594 reports the unknown units and the empty selection together, in that order', () => {
    const r = failures(letters(), (c) => {
      c.exclude = ['A', 'B', 'C', 'Q'];
    });
    expect(r).toStrictEqual([{ kind: 'unknown-unit', unit: 'Q' }, { kind: 'empty-selection' }]);
  });

  it('FR-594 compares an entry to a unit key as text exactly: 08019 names no unit that is the integer 8019', () => {
    const f = () => [feature({ code: 8019 })];
    expect(failures(f(), (c) => (c.exclude = ['08019']))).toStrictEqual([{ kind: 'unknown-unit', unit: '08019' }]);
    expect(failures(f(), (c) => (c.exclude = ['8019']))).toStrictEqual([{ kind: 'empty-selection' }]);
  });

  it('FR-594 gives the extent of a unit over every ring of every polygon, and none for a unit without positions', () => {
    const c = curation();
    const [u] = unitsOf([feature({ code: 'A' }, 2, 3, 1), feature({ code: 'A' }, 10, -4, 2)], c);
    expect(unitExtent(u!)).toStrictEqual({ west: 2, south: -4, east: 12, north: 4 });
    const empty: Unit = { ...u!, polygons: [] };
    expect(unitExtent(empty)).toBeNull();
    const holed: Unit = {
      ...u!,
      polygons: [{ outer: { coords: [[0, 0], [1, 0], [1, 1], [0, 0]] }, holes: [{ coords: [[-5, -5], [-4, -5], [-4, -4], [-5, -5]] }] }],
    };
    expect(unitExtent(holed)).toStrictEqual({ west: -5, south: -5, east: 1, north: 1 });
  });

  it('FR-594 gives the same selection twice', () => {
    const c = curation((x) => (x.select = [{ property: 'n', lte: 2 }]));
    const list = unitsOf(letters(), c);
    expect(JSON.stringify(selectUnits(list, c))).toBe(JSON.stringify(selectUnits(list, c)));
  });
});
