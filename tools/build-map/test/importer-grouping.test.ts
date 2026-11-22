import { describe, expect, it } from 'vitest';
import { parseCuration, type Curation } from '../src/importer/curation';
import { groupFactions, groupTerritories, type FactionPlan, type Territory } from '../src/importer/grouping';
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
function feature(props: Record<string, unknown>): ImportFeature {
  const index = counter++;
  return { index, props, polygons: [{ outer: { coords: ring(index * 2, 0) as [number, number][] }, holes: [] }] };
}

/** The units of the features, all selected (the grouping takes the selected units). */
function unitsOf(features: ImportFeature[], c: Curation): Unit[] {
  const r = buildUnits(features, c);
  if (!r.ok) throw new Error(`fixture units are invalid: ${JSON.stringify(r.errors)}`);
  return r.value;
}

function groups(features: ImportFeature[], c: Curation): Territory[] {
  const r = groupTerritories(unitsOf(features, c), c);
  if (!r.ok) throw new Error(`expected territories, got ${JSON.stringify(r.errors)}`);
  return r.value;
}
function failures(features: ImportFeature[], c: Curation): unknown[] {
  const r = groupTerritories(unitsOf(features, c), c);
  if (r.ok) throw new Error('expected errors');
  return r.errors;
}
const summary = (list: Territory[]) => list.map((t) => ({ key: t.key, kind: t.kind, name: t.name, units: t.units.map((u) => u.key) }));

describe('FR-596 the territories of the selected units', () => {
  it('FR-596 gives a unit with no rule a territory of its own, keyed by its unit key and named by the unit', () => {
    const c = curation();
    expect(summary(groups([feature({ code: 'B', name: 'Beta' }), feature({ code: 'A', name: 'Alfa' })], c))).toStrictEqual([
      { key: 'B', kind: 'land', name: 'Beta', units: ['B'] },
      { key: 'A', kind: 'land', name: 'Alfa', units: ['A'] },
    ]);
  });

  it('FR-596 takes the territory of a unit from its units entry, else from territoryBy, and merges units with one key in order of first unit', () => {
    const c = curation((x) => {
      x.territoryBy = { property: 'group' };
      x.territoryNames = { north: 'North', south: 'South', odd: 'Odd' };
      x.units = { C: { territory: 'odd' } };
    });
    const list = groups(
      [
        feature({ code: 'A', name: 'a', group: 'north' }),
        feature({ code: 'B', name: 'b', group: 'south' }),
        feature({ code: 'C', name: 'c', group: 'north' }),
        feature({ code: 'D', name: 'd', group: 'north' }),
        feature({ code: 'E', name: 'e', group: 'south' }),
      ],
      c,
    );
    // C is moved out of "north" by its per-unit entry, which wins over the rule
    expect(summary(list)).toStrictEqual([
      { key: 'north', kind: 'land', name: 'North', units: ['A', 'D'] },
      { key: 'south', kind: 'land', name: 'South', units: ['B', 'E'] },
      { key: 'odd', kind: 'land', name: 'Odd', units: ['C'] },
    ]);
  });

  it('FR-596 reads an integer value of the territoryBy property as its decimal text', () => {
    const c = curation((x) => ((x.territoryBy = { property: 'g' }), (x.territoryNames = { 8019: 'Named' })));
    const list = groups([feature({ code: 'A', name: 'a', g: 8019 }), feature({ code: 'B', name: 'b', g: '8019' })], c);
    expect(list.map((t) => [t.key, t.units.length])).toStrictEqual([['8019', 2]]);
    // without the curated name the territory of two units needs one
    const bare = curation((x) => (x.territoryBy = { property: 'g' }));
    expect(failures([feature({ code: 'A', name: 'a', g: 1 }), feature({ code: 'B', name: 'b', g: 1 })], bare)).toStrictEqual([
      { kind: 'missing-territory-name', territory: '1' },
    ]);
  });

  it('FR-596 fails with missing-group-value for a unit with no usable value of the territoryBy property and no entry of its own', () => {
    const c = curation((x) => {
      x.territoryBy = { property: 'g' };
      x.units = { B: { territory: 'by-hand' } };
    });
    expect(
      failures([feature({ code: 'A', name: 'a' }), feature({ code: 'B', name: 'b' }), feature({ code: 'C', name: 'c', g: 5.5 }), feature({ code: 'D', name: 'd', g: null })], c),
    ).toStrictEqual([
      { kind: 'missing-group-value', unit: 'A', property: 'g' },
      { kind: 'missing-group-value', unit: 'C', property: 'g' },
      { kind: 'missing-group-value', unit: 'D', property: 'g' },
    ]);
  });

  it('FR-596 names a territory from territoryNames, else from the nameProperty of a territoryBy key, else from its only unit', () => {
    const c = curation((x) => {
      x.territoryBy = { property: 'g', nameProperty: 'gname' };
      x.territoryNames = { first: 'Curated' };
      x.units = { Z: { territory: 'solo', name: 'Solo by hand' } };
    });
    const list = groups(
      [
        feature({ code: 'A', name: 'a', g: 'first', gname: 'From the column' }),
        feature({ code: 'B', name: 'b', g: 'second', gname: 'Second' }),
        feature({ code: 'C', name: 'c', g: 'second', gname: 'Second' }),
        feature({ code: 'Z', name: 'z', g: 'ignored' }),
      ],
      c,
    );
    expect(list.map((t) => [t.key, t.name])).toStrictEqual([
      ['first', 'Curated'],
      ['second', 'Second'],
      ['solo', 'Solo by hand'],
    ]);
  });

  it('FR-596 falls back to the name of the only unit when the nameProperty is absent from every unit, and fails otherwise with missing-territory-name', () => {
    const c = curation((x) => (x.territoryBy = { property: 'g', nameProperty: 'gname' }));
    const one = groups([feature({ code: 'A', name: 'Only', g: 'x' })], c);
    expect(one[0]!.name).toBe('Only');
    expect(
      failures([feature({ code: 'A', name: 'a', g: 'x' }), feature({ code: 'B', name: 'b', g: 'x' }), feature({ code: 'C', g: 'y' })], c),
    ).toStrictEqual([
      { kind: 'missing-territory-name', territory: 'x' },
      { kind: 'missing-territory-name', territory: 'y' },
    ]);
  });

  it('FR-596 fails with conflicting-group-name when the units of a territoryBy territory do not share the nameProperty value', () => {
    const c = curation((x) => (x.territoryBy = { property: 'g', nameProperty: 'gname' }));
    expect(
      failures(
        [
          feature({ code: 'A', name: 'a', g: 'x', gname: 'One' }),
          feature({ code: 'B', name: 'b', g: 'x', gname: 'Two' }),
          feature({ code: 'C', name: 'c', g: 'y', gname: 'Same' }),
          feature({ code: 'D', name: 'd', g: 'y' }),
          feature({ code: 'E', name: 'e', g: 'z', gname: 'Same' }),
          feature({ code: 'F', name: 'f', g: 'z', gname: 'Same' }),
        ],
        c,
      ),
    ).toStrictEqual([
      { kind: 'conflicting-group-name', territory: 'x' },
      { kind: 'conflicting-group-name', territory: 'y' },
    ]);
  });

  it('FR-596 reads the name column of the units that got the key from the rule only, and an empty value names nothing', () => {
    const c = curation((x) => {
      x.territoryBy = { property: 'g', nameProperty: 'gname' };
      x.units = { D: { territory: 'x' } };
    });
    // D joined "x" by hand: its own gname is not compared with the rule's units
    const list = groups([feature({ code: 'A', name: 'a', g: 'x', gname: 'One' }), feature({ code: 'D', name: 'd', g: 'other', gname: 'Other' })], c);
    expect(list.map((t) => [t.key, t.name])).toStrictEqual([['x', 'One']]);
    // an empty text is no name: the only unit names its territory
    expect(groups([feature({ code: 'A', name: 'Alone', g: 'y', gname: '' })], curation((x) => (x.territoryBy = { property: 'g', nameProperty: 'gname' })))[0]!.name).toBe('Alone');
  });

  it('every territoryNames key outside 1 to 256 code units fails invalid-key even when no unit uses it', () => {
    const long = 'n'.repeat(300);
    const c = curation((x) => (x.territoryNames = { [long]: 'Nobody', '': 'Nothing', ok: 'Fine' }));
    expect(failures([feature({ code: 'A', name: 'a' })], c)).toStrictEqual([
      { kind: 'invalid-key', territory: '' },
      { kind: 'invalid-key', territory: long },
    ]);
  });

  it('FR-596 fails with mixed-territory-kind for a territory of land and sea units, and keeps a sea territory a sea one', () => {
    const c = curation((x) => (x.territoryNames = { wet: 'Wet' }, x.units = { S1: { kind: 'sea', territory: 'wet' }, S2: { kind: 'sea', territory: 'wet' }, L: { territory: 'wet' }, T: { kind: 'sea' } }));
    expect(
      failures([feature({ code: 'S1', name: 's1' }), feature({ code: 'L', name: 'l' }), feature({ code: 'S2', name: 's2' }), feature({ code: 'T', name: 't' })], c),
    ).toStrictEqual([{ kind: 'mixed-territory-kind', territory: 'wet' }]);
    const sea = curation((x) => (x.territoryNames = { gulf: 'Gulf' }, x.units = { T: { kind: 'sea' }, U: { kind: 'sea', territory: 'gulf' }, V: { kind: 'sea', territory: 'gulf' }, W: { kind: 'sea', territory: 'gulf' } }));
    expect(summary(groups([feature({ code: 'T', name: 'Strait' }), feature({ code: 'U' }), feature({ code: 'V' }), feature({ code: 'W' }), feature({ code: 'L', name: 'Land' })], sea).slice(0, 1))).toStrictEqual([
      { key: 'T', kind: 'sea', name: 'Strait', units: ['T'] },
    ]);
  });

  it('every territory key outside 1 to 256 code units fails invalid-key, whether curated or generated, and is never invalid-curation', () => {
    const long = 'k'.repeat(257);
    const edge = 'k'.repeat(256);
    // the schema accepts all of these: key lengths are the curation stage's concern
    const c = curation((x) => {
      x.territoryBy = { property: 'g' };
      x.territoryNames = { [long]: 'Long name', [edge]: 'Edge' };
      x.units = { A: { territory: '' }, B: { territory: long } };
    });
    expect(
      failures(
        [
          feature({ code: 'A', name: 'a', g: 'ok' }),
          feature({ code: 'B', name: 'b', g: 'ok' }),
          feature({ code: 'C', name: 'c', g: 'x'.repeat(300) }),
          feature({ code: 'D', name: 'd', g: edge }),
        ],
        c,
      ),
    ).toStrictEqual([
      { kind: 'invalid-key', territory: '' },
      { kind: 'invalid-key', territory: long },
      { kind: 'invalid-key', territory: 'x'.repeat(300) },
    ]);
    // a unit key of the wrong length is the territory key of a unit with no rule
    const own = curation();
    expect(failures([feature({ code: long, name: 'n' })], own)).toStrictEqual([{ kind: 'invalid-key', territory: long }]);
    // 256 code units is fine, and a curated key of an unselected unit is still checked
    expect(groups([feature({ code: edge, name: 'n' })], own).length).toBe(1);
    const unselected = curation((x) => (x.units = { GONE: { territory: long } }));
    expect(groupTerritories([], unselected)).toStrictEqual({ ok: false, errors: [{ kind: 'invalid-key', territory: long }] });
  });

  it('FR-596 counts the key length in code units, not characters', () => {
    const c = curation();
    const pairs = '\u{1F600}'.repeat(128);
    expect(groups([feature({ code: pairs, name: 'n' })], c).length).toBe(1);
    expect(failures([feature({ code: pairs + '\u{1F600}', name: 'n' })], c)).toStrictEqual([{ kind: 'invalid-key', territory: pairs + '\u{1F600}' }]);
  });

  it('FR-596 gives the same territories for the same units, and never touches the units it reads', () => {
    const c = curation((x) => (x.territoryBy = { property: 'g' }));
    const list = unitsOf([feature({ code: 'A', name: 'a', g: 'x' }), feature({ code: 'B', name: 'b', g: 'x' })], c);
    const before = JSON.stringify(list);
    const a = groupTerritories(list, c);
    const b = groupTerritories(list, c);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(list)).toBe(before);
  });
});

/** The territories of the features and then their factions. */
function plan(features: ImportFeature[], c: Curation): FactionPlan {
  const territories = groups(features, c);
  const r = groupFactions(territories, c);
  if (!r.ok) throw new Error(`expected factions, got ${JSON.stringify(r.errors)}`);
  return r.value;
}
function factionFailures(features: ImportFeature[], c: Curation): unknown[] {
  const r = groupFactions(groups(features, c), c);
  if (r.ok) throw new Error('expected errors');
  return r.errors;
}
const ofTerritory = (p: FactionPlan) => [...p.factionOf];

describe('FR-597 the factions of the land territories', () => {
  it('FR-597 gives a territory the faction of its units: the units entry first, else the factionBy value', () => {
    const c = curation((x) => {
      x.factionBy = { property: 'country', nameProperty: 'country_name' };
      x.units = { B: { faction: 'XX' }, XB: { faction: 'XX' } };
      x.factions = [{ key: 'XX', name: 'Hand made' }];
    });
    const p = plan(
      [
        feature({ code: 'A', name: 'a', country: 'ES', country_name: 'Espana' }),
        feature({ code: 'B', name: 'b', country: 'ES', country_name: 'Espana' }),
        feature({ code: 'XB', name: 'xb', country: 'FR' }),
      ],
      c,
    );
    expect(ofTerritory(p)).toStrictEqual([['A', 'ES'], ['B', 'XX'], ['XB', 'XX']]);
    expect(p.factions.map((f) => f.key)).toStrictEqual(['XX', 'ES']);
  });

  it('FR-597 gives a territory of several units one faction, and fails split-territory-faction when its units disagree', () => {
    const c = curation((x) => {
      x.territoryBy = { property: 'g' };
      x.territoryNames = { one: 'One', two: 'Two' };
      x.factionBy = { property: 'country', nameProperty: 'cname' };
    });
    const ok = plan(
      [feature({ code: 'A', name: 'a', g: 'one', country: 'ES', cname: 'Espana' }), feature({ code: 'B', name: 'b', g: 'one', country: 'ES', cname: 'Espana' })],
      c,
    );
    expect(ofTerritory(ok)).toStrictEqual([['one', 'ES']]);
    expect(
      factionFailures(
        [
          feature({ code: 'A', name: 'a', g: 'one', country: 'PT', cname: 'p' }),
          feature({ code: 'B', name: 'b', g: 'one', country: 'ES', cname: 'e' }),
          feature({ code: 'C', name: 'c', g: 'one', country: 'PT', cname: 'p' }),
          feature({ code: 'D', name: 'd', g: 'two', country: 'ES', cname: 'e' }),
        ],
        c,
      ),
    ).toStrictEqual([{ kind: 'split-territory-faction', territory: 'one', factions: ['ES', 'PT'] }]);
  });

  it('FR-597 fails with missing-faction for each land unit with no faction, and asks no faction of a sea territory', () => {
    const c = curation((x) => {
      x.factionBy = { property: 'country', nameProperty: 'cname' };
      x.units = { S: { kind: 'sea' }, E: { faction: 'hand' } };
      x.factions = [{ key: 'hand', name: 'Hand' }];
    });
    expect(
      factionFailures([feature({ code: 'A', name: 'a' }), feature({ code: 'S', name: 's' }), feature({ code: 'B', name: 'b', country: 7.5 }), feature({ code: 'E', name: 'e' })], c),
    ).toStrictEqual([
      { kind: 'missing-faction', unit: 'A' },
      { kind: 'missing-faction', unit: 'B' },
    ]);
    const sea = curation((x) => {
      x.units = { S: { kind: 'sea' }, E: { faction: 'e' } };
      x.factions = [{ key: 'e', name: 'E' }];
    });
    const ok = plan([feature({ code: 'S', name: 's' }), feature({ code: 'E', name: 'e' })], sea);
    expect(ofTerritory(ok)).toStrictEqual([['E', 'e']]);
  });

  it('FR-597 lists the factions of the curation first, in its order, then every other used faction in code-unit order', () => {
    const c = curation((x) => {
      x.factionBy = { property: 'c', nameProperty: 'cn' };
      x.factions = [
        { key: 'Z', name: 'Zeta', color: '#112233' },
        { key: 'm', name: 'Mu' },
      ];
    });
    const p = plan(
      [
        feature({ code: 'A', name: 'a', c: 'b', cn: 'Beta' }),
        feature({ code: 'B', name: 'b', c: 'Z' }),
        feature({ code: 'C', name: 'c', c: 'a', cn: 'Alfa' }),
        feature({ code: 'D', name: 'd', c: 'm' }),
        feature({ code: 'E', name: 'e', c: 'B', cn: 'Capital' }),
      ],
      c,
    );
    expect(p.factions).toStrictEqual([
      { key: 'Z', name: 'Zeta', color: '#112233' },
      { key: 'm', name: 'Mu' },
      { key: 'B', name: 'Capital' },
      { key: 'a', name: 'Alfa' },
      { key: 'b', name: 'Beta' },
    ]);
  });

  it('FR-597 validates the name and the color of a listed faction and fails duplicate-faction-key for a repeated key', () => {
    const c = curation((x) => {
      x.factions = [
        { key: 'a', name: '' },
        { key: 'b', name: 'Bee', color: '#ABCDEF' },
        { key: 'c', name: 'Cee', color: '#abcdeg' },
        { key: 'd', name: ' padded' },
        { key: 'a', name: 'Again' },
        { key: 'e', name: 'e'.repeat(81) },
        { key: 'f', name: 'Fine', color: '#00ff00' },
      ];
      x.units = { A: { faction: 'a' }, B: { faction: 'b' }, C: { faction: 'c' }, D: { faction: 'd' }, E: { faction: 'e' }, F: { faction: 'f' } };
    });
    expect(factionFailures(['A', 'B', 'C', 'D', 'E', 'F'].map((code) => feature({ code, name: code })), c)).toStrictEqual([
      { kind: 'invalid-name', path: 'factions[0].name' },
      { kind: 'invalid-name', path: 'factions[3].name' },
      { kind: 'invalid-name', path: 'factions[5].name' },
      { kind: 'invalid-color', path: 'factions[1].color' },
      { kind: 'invalid-color', path: 'factions[2].color' },
      { kind: 'duplicate-faction-key', faction: 'a' },
    ]);
  });

  it('FR-597 names an unlisted faction by the nameProperty its units share, else fails conflicting-group-name or missing-faction-name', () => {
    const c = curation((x) => (x.factionBy = { property: 'c', nameProperty: 'cn' }));
    expect(
      factionFailures(
        [
          feature({ code: 'A', name: 'a', c: 'p', cn: 'One' }),
          feature({ code: 'B', name: 'b', c: 'p', cn: 'Two' }),
          feature({ code: 'C', name: 'c', c: 'q' }),
          feature({ code: 'D', name: 'd', c: 'r', cn: 'conflict' }),
          feature({ code: 'E', name: 'e', c: 'r', cn: 'conflict' }),
        ],
        c,
      ),
    ).toStrictEqual([
      { kind: 'conflicting-group-name', faction: 'p' },
      { kind: 'missing-faction-name', faction: 'q' },
    ]);
    // a name that happens to be the word "conflict" is a name
    expect(plan([feature({ code: 'D', name: 'd', c: 'r', cn: 'conflict' })], c).factions).toStrictEqual([{ key: 'r', name: 'conflict' }]);
    // no nameProperty at all: every unlisted faction fails missing-faction-name
    const none = curation((x) => (x.units = { A: { faction: 'u1' }, B: { faction: 'u2' } }));
    expect(factionFailures([feature({ code: 'A', name: 'a' }), feature({ code: 'B', name: 'b' })], none)).toStrictEqual([
      { kind: 'missing-faction-name', faction: 'u1' },
      { kind: 'missing-faction-name', faction: 'u2' },
    ]);
  });

  it('FR-597 fails with faction-without-territory for a listed faction that no land territory uses', () => {
    const c = curation((x) => {
      x.units = { A: { faction: 'used' }, S: { kind: 'sea' } };
      x.factions = [{ key: 'used', name: 'Used' }, { key: 'idle', name: 'Idle' }, { key: 'asleep', name: 'Asleep' }];
    });
    expect(factionFailures([feature({ code: 'A', name: 'a' }), feature({ code: 'S', name: 's' })], c)).toStrictEqual([
      { kind: 'faction-without-territory', faction: 'asleep' },
      { kind: 'faction-without-territory', faction: 'idle' },
    ]);
  });

  it('every faction key outside 1 to 256 code units fails invalid-key, curated or generated, and is never invalid-curation', () => {
    const long = 'f'.repeat(257);
    const edge = 'f'.repeat(256);
    const c = curation((x) => {
      x.factionBy = { property: 'c', nameProperty: 'cn' };
      x.factions = [{ key: long, name: 'Long' }, { key: '', name: 'Empty' }, { key: edge, name: 'Edge' }];
      x.units = { A: { faction: long }, GONE: { faction: 'g'.repeat(300) } };
    });
    expect(
      factionFailures([feature({ code: 'A', name: 'a' }), feature({ code: 'B', name: 'b', c: 'x'.repeat(260), cn: 'X' }), feature({ code: 'C', name: 'c', c: edge })], c),
    ).toStrictEqual([
      { kind: 'invalid-key', faction: '' },
      { kind: 'invalid-key', faction: long },
      { kind: 'invalid-key', faction: 'g'.repeat(300) },
      { kind: 'invalid-key', faction: 'x'.repeat(260) },
      { kind: 'faction-without-territory', faction: '' },
    ]);
  });

  it('a count of land factions above 9,999 fails too-many-factions with the cap and the count, and 9,999 is fine', () => {
    const c = curation((x) => (x.factionBy = { property: 'f', nameProperty: 'f' }));
    const many = (n: number) => Array.from({ length: n }, (_, i) => feature({ code: `u${i}`, name: `u${i}`, f: `f${i}` }));
    expect(plan(many(9999), c).factions.length).toBe(9999);
    expect(factionFailures(many(10000), c)).toStrictEqual([{ kind: 'too-many-factions', cap: 9999, count: 10000 }]);
  });

  it('FR-597 gives the same factions for the same territories and never touches what it reads', () => {
    const c = curation((x) => (x.factionBy = { property: 'c', nameProperty: 'cn' }));
    const territories = groups([feature({ code: 'A', name: 'a', c: 'k', cn: 'K' }), feature({ code: 'B', name: 'b', c: 'j', cn: 'J' })], c);
    const before = JSON.stringify(territories);
    const a = groupFactions(territories, c);
    const b = groupFactions(territories, c);
    expect(a.ok && b.ok && JSON.stringify([...a.value.factionOf, a.value.factions])).toBe(a.ok && b.ok && JSON.stringify([...b.value.factionOf, b.value.factions]));
    expect(JSON.stringify(territories)).toBe(before);
  });
});
