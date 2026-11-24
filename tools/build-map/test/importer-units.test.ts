import { describe, expect, it } from 'vitest';
import { parseCuration, type Curation } from '../src/importer/curation';
import { buildUnits, unitValue, type Unit } from '../src/importer/units';
import type { ImportFeature } from '../src/importer/types';
import { ring, textBytes } from './helpers/geo-fixture';

function curation(change: (c: Record<string, any>) => void = () => undefined): Curation {
  const c: Record<string, any> = {
    primary: 'p.geojson',
    columns: { key: 'code', name: ['name_es', 'name'] },
    params: { side: 2048, margin: 0.02, minPieceSize: 40, projection: 'laea' },
  };
  change(c);
  const r = parseCuration(textBytes(JSON.stringify(c)), 'c.json');
  if (!r.ok) throw new Error(`fixture curation is invalid: ${JSON.stringify(r.errors)}`);
  return r.value;
}

let counter = 0;
/** A feature with one square polygon; `x` places it so the order of polygons can be read back. */
function feature(props: Record<string, unknown>, index = counter++, x = index * 2): ImportFeature {
  return { index, props, polygons: [{ outer: { coords: ring(x, 0) as [number, number][] }, holes: [] }] };
}

function units(features: ImportFeature[], c: Curation = curation()): Unit[] {
  const r = buildUnits(features, c);
  if (!r.ok) throw new Error(`expected units, got ${JSON.stringify(r.errors)}`);
  return r.value;
}
function errors(features: ImportFeature[], c: Curation = curation()): unknown[] {
  const r = buildUnits(features, c);
  if (r.ok) throw new Error('expected errors');
  return r.errors;
}

describe('FR-593 the units of the primary source', () => {
  it('FR-593 takes the usable value of the key column as the unit key: a text, or an integer as its shortest decimal', () => {
    const list = units([feature({ code: 'ES-M' }, 0), feature({ code: 8019 }, 1), feature({ code: 28 }, 2)]);
    expect(list.map((u) => u.key)).toStrictEqual(['ES-M', '8019', '28']);
  });

  it('FR-593 forms one unit per distinct key, in order of first feature, with the polygons of its features in that order', () => {
    const list = units([
      feature({ code: 'B' }, 0, 10),
      feature({ code: 'A' }, 1, 20),
      feature({ code: 'B' }, 2, 30),
      feature({ code: 'A' }, 3, 40),
      feature({ code: 'B' }, 4, 50),
    ]);
    expect(list.map((u) => u.key)).toStrictEqual(['B', 'A']);
    expect(list[0]!.polygons.map((p) => p.outer.coords[0]![0])).toStrictEqual([10, 30, 50]);
    expect(list[1]!.polygons.map((p) => p.outer.coords[0]![0])).toStrictEqual([20, 40]);
    expect(list[0]!.features.map((f) => f.index)).toStrictEqual([0, 2, 4]);
    expect(list[0]!.firstFeature).toBe(0);
    expect(list[1]!.firstFeature).toBe(1);
  });

  it('FR-593 fails with missing-unit-key for a feature without the key property, naming its index', () => {
    expect(errors([feature({ code: 'A' }, 0), feature({ other: 1 }, 1), feature({}, 5)])).toStrictEqual([
      { kind: 'missing-unit-key', feature: 1 },
      { kind: 'missing-unit-key', feature: 5 },
    ]);
  });

  it('FR-593 fails with invalid-unit-key for a key that is no usable value: null, a decimal, a boolean, a list, an object or no text', () => {
    const bad = [null, 1.5, true, [1], { a: 1 }, '', 1e21];
    const list = bad.map((code, i) => feature({ code }, i));
    expect(errors(list)).toStrictEqual(bad.map((_, i) => ({ kind: 'invalid-unit-key', feature: i })));
  });

  it('FR-593 reads the key by the own-property rule: a property of the prototype is no key', () => {
    Object.defineProperty(Object.prototype, 'code', { value: 'inherited', configurable: true, writable: true });
    try {
      expect(errors([feature({}, 0)])).toStrictEqual([{ kind: 'missing-unit-key', feature: 0 }]);
    } finally {
      delete (Object.prototype as Record<string, unknown>)['code'];
    }
  });

  it('FR-593 names a unit by the first present name column on its first feature, used exactly as given', () => {
    const list = units([
      feature({ code: 'A', name_es: '  Alcalá de Henares ', name: 'Alcala' }, 0),
      feature({ code: 'B', name_es: '', name: ' Beta ' }, 1),
      feature({ code: 'C', name_es: 7, name: 'Gamma' }, 2),
      feature({ code: 'D' }, 3),
      feature({ code: 'E', name: '' }, 4),
    ]);
    expect(list.map((u) => u.sourceName)).toStrictEqual(['  Alcalá de Henares ', ' Beta ', 'Gamma', undefined, undefined]);
    expect(list.map((u) => u.name)).toStrictEqual(['  Alcalá de Henares ', ' Beta ', 'Gamma', undefined, undefined]);
  });

  it('FR-593 takes the name of the first feature only: a later feature without a name does not change it', () => {
    const list = units([feature({ code: 'A', name: 'First' }, 0), feature({ code: 'A', name: 'First', name_es: '' }, 1)]);
    expect(list[0]!.sourceName).toBe('First');
    const none = units([feature({ code: 'A' }, 0), feature({ code: 'A', name: 'Late' }, 1)]);
    expect(none[0]!.sourceName).toBeUndefined();
  });

  it('FR-593 fails with conflicting-unit-property when two features of one unit have different names', () => {
    expect(errors([feature({ code: 'A', name: 'One' }, 0), feature({ code: 'A', name: 'Two' }, 1), feature({ code: 'B', name: 'Same' }, 2), feature({ code: 'B', name: 'Same' }, 3)])).toStrictEqual([
      { kind: 'conflicting-unit-property', unit: 'A', property: 'name' },
    ]);
    // a name column that only some features have is never a conflict
    expect(units([feature({ code: 'A', name: 'One' }, 0), feature({ code: 'A' }, 1)]).length).toBe(1);
  });

  it('FR-593 compares the first-present name of each feature, not each name column on its own: no false positive', () => {
    // both features are named "X" by the first column; their second column differs but is never their name
    const list = units([feature({ code: 'A', name_es: 'X', name: 'P' }, 0), feature({ code: 'A', name_es: 'X', name: 'Q' }, 1)]);
    expect(list.length).toBe(1);
    expect(list[0]!.sourceName).toBe('X');
    // the name comes from the second column on one feature and from the first on the other, and agrees
    expect(units([feature({ code: 'A', name: 'X' }, 0), feature({ code: 'A', name_es: 'X', name: 'Z' }, 1)]).length).toBe(1);
  });

  it('FR-593 compares the first-present name of each feature: no false negative', () => {
    // the second feature is named by the other column: "X" against "Y", though each column has one value only
    expect(errors([feature({ code: 'A', name_es: 'X' }, 0), feature({ code: 'A', name: 'Y' }, 1)])).toStrictEqual([
      { kind: 'conflicting-unit-property', unit: 'A', property: 'name' },
    ]);
    // the first column names the first feature, the second column names both: "X" against "Y"
    expect(errors([feature({ code: 'B', name_es: 'X', name: 'Y' }, 2), feature({ code: 'B', name: 'Y' }, 3)])).toStrictEqual([
      { kind: 'conflicting-unit-property', unit: 'B', property: 'name' },
    ]);
    // a feature with no present name at all is not compared
    expect(units([feature({ code: 'C', name_es: 'X' }, 4), feature({ code: 'C', name_es: '', name: null }, 5)]).length).toBe(1);
  });

  it('FR-593 fails with conflicting-unit-property for different usable values of a property a filter or a rule uses', () => {
    const c = curation((x) => {
      x.select = [{ property: 'adm', eq: 'ESP' }];
      x.territoryBy = { property: 'group', nameProperty: 'group_name' };
      x.factionBy = { property: 'country' };
      x.insets = [{ select: [{ property: 'region', in: ['IC'] }], at: [0, 0] }];
    });
    const base = { code: 'A', adm: 'ESP', group: 'g', group_name: 'G', country: 'ES', region: 'IC' };
    const same = [feature({ ...base }, 0), feature({ ...base }, 1)];
    expect(units(same, c).length).toBe(1);
    for (const property of ['adm', 'group', 'group_name', 'country', 'region']) {
      expect(errors([feature({ ...base }, 0), feature({ ...base, [property]: 'other' }, 1)], c), property).toStrictEqual([
        { kind: 'conflicting-unit-property', unit: 'A', property },
      ]);
    }
    // a property no filter or rule uses may differ freely
    expect(units([feature({ ...base, free: 1 }, 0), feature({ ...base, free: 2 }, 1)], c).length).toBe(1);
  });

  it('FR-593 checks a filter or rule property that doubles as a masked name column: an earlier name column never hides its conflict', () => {
    // `from` is the second name column and a filter's property; both features are named "Country" by the first
    // column, so the name comparison never reads `from`: the filter still checks its values (the date-range rule)
    const c = curation((x) => {
      x.columns = { key: 'code', name: ['label', 'from'] };
      x.select = [{ property: 'from', gte: '1915-01-01' }];
    });
    expect(errors([feature({ code: 'A', label: 'Country', from: '1910-01-01' }, 0), feature({ code: 'A', label: 'Country', from: '1920-01-01' }, 1)], c)).toStrictEqual([
      { kind: 'conflicting-unit-property', unit: 'A', property: 'from' },
    ]);
    // the first name column differs too: both conflicts are named, once each
    expect(errors([feature({ code: 'B', label: 'One', from: '1910-01-01' }, 2), feature({ code: 'B', label: 'Two', from: '1920-01-01' }, 3)], c)).toStrictEqual([
      { kind: 'conflicting-unit-property', unit: 'B', property: 'label' },
      { kind: 'conflicting-unit-property', unit: 'B', property: 'from' },
    ]);
    // a property that is the first name column AND a filter's property conflicts once, not twice
    const twice = curation((x) => {
      x.columns = { key: 'code', name: ['from'] };
      x.select = [{ property: 'from', lte: '1915-01-01' }];
    });
    expect(errors([feature({ code: 'C', from: '1910-01-01' }, 4), feature({ code: 'C', from: '1920-01-01' }, 5)], twice)).toStrictEqual([
      { kind: 'conflicting-unit-property', unit: 'C', property: 'from' },
    ]);
    // a name column that no filter or rule uses is still compared by name only: differing fallbacks are no error
    const free = curation((x) => {
      x.columns = { key: 'code', name: ['label', 'from'] };
    });
    expect(units([feature({ code: 'A', label: 'Country', from: '1910' }, 0), feature({ code: 'A', label: 'Country', from: '1920' }, 1)], free).length).toBe(1);
  });

  it('FR-593 keeps every conflict of a unit, each on its own property, and a conflict of each unit', () => {
    const c = curation((x) => (x.select = [{ property: 'a', eq: 'x' }, { property: 'b', eq: 'x' }]));
    const found = errors(
      [
        feature({ code: 'A', a: 'x', b: 'x', name: 'N' }, 0),
        feature({ code: 'A', a: 'y', b: 'y', name: 'M' }, 1),
        feature({ code: 'B', a: 'x', b: 'x' }, 2),
        feature({ code: 'B', a: 'z', b: 'x' }, 3),
      ],
      c,
    );
    expect(found).toStrictEqual([
      { kind: 'conflicting-unit-property', unit: 'A', property: 'name' },
      { kind: 'conflicting-unit-property', unit: 'A', property: 'a' },
      { kind: 'conflicting-unit-property', unit: 'A', property: 'b' },
      { kind: 'conflicting-unit-property', unit: 'B', property: 'a' },
    ]);
  });

  it('FR-593 counts a text and an integer as different usable values, and ignores values that are not usable', () => {
    const c = curation((x) => (x.select = [{ property: 'v', eq: '5' }]));
    expect(errors([feature({ code: 'A', v: 5 }, 0), feature({ code: 'A', v: '5' }, 1)], c)).toStrictEqual([
      { kind: 'conflicting-unit-property', unit: 'A', property: 'v' },
    ]);
    expect(units([feature({ code: 'A', v: 5 }, 0), feature({ code: 'A', v: 5.5 }, 1), feature({ code: 'A', v: null }, 2)], c).length).toBe(1);
  });

  it('FR-593 reads a property present on only some features by the own-property rule', () => {
    const c = curation((x) => (x.select = [{ property: 'v', eq: 'x' }]));
    const list = units([feature({ code: 'A' }, 0), feature({ code: 'A', v: 'x' }, 1), feature({ code: 'A', v: null }, 2)], c);
    expect(unitValue(list[0]!, 'v')).toBe('x');
    expect(unitValue(list[0]!, 'absent')).toBeUndefined();
    expect(unitValue(list[0]!, 'constructor')).toBeUndefined();
    expect(unitValue(list[0]!, 'toString')).toBeUndefined();
    // the first feature with a usable value wins; a number that is no integer is skipped
    const skip = units([feature({ code: 'B', v: 1.5 }, 0), feature({ code: 'B', v: 7 }, 1)], c);
    expect(unitValue(skip[0]!, 'v')).toBe(7);
  });

  it('FR-593 keeps a unit key named __proto__ as plain data', () => {
    const list = units([feature({ code: '__proto__' }, 0), feature({ code: 'constructor' }, 1)]);
    expect(list.map((u) => u.key)).toStrictEqual(['__proto__', 'constructor']);
  });

  it('FR-593 gives the same units twice on the same features', () => {
    const features = [feature({ code: 'A', name: 'x' }, 0), feature({ code: 'B' }, 1), feature({ code: 'A', name: 'x' }, 2)];
    expect(JSON.stringify(units(features))).toBe(JSON.stringify(units(features)));
  });
});

describe('FR-595 the per-unit layer', () => {
  const features = () => [feature({ code: 'A', name: 'Alfa' }, 0), feature({ code: 'B', name: 'Beta' }, 1), feature({ code: 'C' }, 2)];

  it('FR-595 gives a unit without an entry the kind land and no territory or faction', () => {
    const u = units(features())[0]!;
    expect(u.kind).toBe('land');
    expect(u.territory).toBeUndefined();
    expect(u.faction).toBeUndefined();
    expect(u.layer).toBeUndefined();
  });

  it('FR-595 applies name, kind, territory and faction from the entry of the unit key', () => {
    const c = curation((x) => {
      x.units = {
        A: { name: 'Curated', kind: 'land', territory: 't1', faction: 'f1' },
        B: { kind: 'sea' },
        C: { kind: 'exclude', territory: 't2' },
      };
    });
    const [a, b, cc] = units(features(), c);
    expect(a).toMatchObject({ name: 'Curated', sourceName: 'Alfa', kind: 'land', territory: 't1', faction: 'f1' });
    expect(b).toMatchObject({ name: 'Beta', kind: 'sea' });
    expect(b!.faction).toBeUndefined();
    expect(cc).toMatchObject({ kind: 'exclude', territory: 't2' });
    expect(cc!.name).toBeUndefined();
  });

  it('FR-595 lets the entry name a unit that has no source name, and keeps an empty curated name for the curation stage', () => {
    const c = curation((x) => (x.units = { C: { name: 'Gamma' }, A: { name: '' } }));
    const [a, , cc] = units(features(), c);
    expect(cc!.name).toBe('Gamma');
    expect(a!.name).toBe('');
  });

  it('FR-595 fails with sea-with-faction for a sea unit that names a faction, once per unit', () => {
    const c = curation((x) => (x.units = { A: { kind: 'sea', faction: 'f' }, B: { kind: 'sea', territory: 't' }, C: { kind: 'land', faction: 'f' } }));
    expect(errors(features(), c)).toStrictEqual([{ kind: 'sea-with-faction', unit: 'A' }]);
  });

  it('FR-595 matches an entry to a unit by the key as text: 8019 never matches 08019', () => {
    const c = curation((x) => (x.units = { '08019': { kind: 'sea' }, '8019': { name: 'Barcelona' } }));
    const [u] = units([feature({ code: 8019 }, 0)], c);
    expect(u!.key).toBe('8019');
    expect(u!.kind).toBe('land');
    expect(u!.name).toBe('Barcelona');
    const text = units([feature({ code: '08019' }, 0)], c)[0]!;
    expect(text.kind).toBe('sea');
  });

  it('FR-595 never trims a key: an entry matches the key exactly as written, spaces included', () => {
    const c = curation((x) => (x.units = { A: { kind: 'sea' }, ' B ': { kind: 'sea' } }));
    const list = units([feature({ code: ' A ' }, 0), feature({ code: ' B ' }, 1)], c);
    expect(list.map((u) => [u.key, u.kind])).toStrictEqual([[' A ', 'land'], [' B ', 'sea']]);
  });

  it('FR-595 leaves an entry that names no unit alone: the selection stage reports it', () => {
    const c = curation((x) => (x.units = { NOPE: { kind: 'sea' } }));
    expect(units(features(), c).map((u) => u.kind)).toStrictEqual(['land', 'land', 'land']);
  });

  it('FR-595 reads the entry of a key such as __proto__ and constructor from the curation map, never the prototype', () => {
    const c = curation((x) => (x.units = JSON.parse('{"__proto__":{"kind":"sea"}}')));
    const list = units([feature({ code: '__proto__' }, 0), feature({ code: 'constructor' }, 1)], c);
    expect(list.map((u) => u.kind)).toStrictEqual(['sea', 'land']);
  });
});
