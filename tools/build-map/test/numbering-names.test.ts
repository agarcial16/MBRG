import { describe, expect, it } from 'vitest';
import { numberEntries } from '../src/core/numbering';
import { buildPresentation } from '../src/core/presentation';
import type { CountryRecord, GroupingTable, SeaSeed, SourceFeature } from '../src/core/types';
import { baseInputs, province } from './helpers/fixtures';

const SEEDS: SeaSeed[] = [
  { name: 'Mar Cantabrico', lon: 0, lat: 0 },
  { name: 'Mediterraneo', lon: 1, lat: 1 },
];

function table(territories: GroupingTable['territories'], countries: GroupingTable['countries']): GroupingTable {
  return { countries, territories, excluded: [] };
}

describe('FR-119 FR-120 numbering', () => {
  it('FR-119 one faction per selected country owns every land territory of that country', () => {
    const plan = numberEntries(baseInputs().grouping, SEEDS);
    expect(plan.factions.map((f) => f.country)).toStrictEqual(['DEU', 'ESP', 'FRA']);
    for (const t of plan.land) {
      const faction = plan.factions.find((f) => f.country === t.country);
      expect(t.owner).toBe(faction?.id);
    }
    expect(plan.land.map((t) => [t.key, t.owner])).toStrictEqual([
      ['baden', 1],
      ['baviera', 1],
      ['madrid', 2],
      ['lyon', 3],
      ['paris', 3],
    ]);
  });

  it('FR-119 sea zones have no owner', () => {
    const plan = numberEntries(baseInputs().grouping, SEEDS);
    expect(plan.sea.length).toBe(2);
    for (const s of plan.sea) expect('owner' in s).toBe(false);
  });

  it('FR-120 factions are in code-unit order of the country code and numbered 1 to K', () => {
    const t = table([], [{ country: 'FRA' }, { country: 'aaa' }, { country: 'BBB' }, { country: 'DEU' }]);
    const plan = numberEntries(t, []);
    expect(plan.factions).toStrictEqual([
      { id: 1, country: 'BBB' },
      { id: 2, country: 'DEU' },
      { id: 3, country: 'FRA' },
      { id: 4, country: 'aaa' },
    ]);
  });

  it('FR-120 preferred country colours are carried to the faction and only there', () => {
    const t = table([], [{ country: 'FRA', color: '#0055a4' }, { country: 'DEU' }]);
    expect(numberEntries(t, []).factions).toStrictEqual([
      { id: 1, country: 'DEU' },
      { id: 2, country: 'FRA', color: '#0055a4' },
    ]);
  });

  it('FR-120 land territories are grouped by faction, then by key in code-unit order, ids 1 to N', () => {
    const t = table(
      [
        { key: 'paris', country: 'FRA', provinces: ['a'] },
        { key: 'baviera', country: 'DEU', provinces: ['b'] },
        { key: 'alfa', country: 'DEU', provinces: ['c'] },
        { key: 'Zeta', country: 'DEU', provinces: ['d'] },
        { key: 'lyon', country: 'FRA', provinces: ['e'] },
      ],
      [{ country: 'FRA' }, { country: 'DEU' }],
    );
    const plan = numberEntries(t, SEEDS);
    expect(plan.land.map((x) => [x.id, x.key, x.owner])).toStrictEqual([
      [1, 'Zeta', 1],
      [2, 'alfa', 1],
      [3, 'baviera', 1],
      [4, 'lyon', 2],
      [5, 'paris', 2],
    ]);
  });

  it('FR-120 sea zones come after all land territories in the order of the seeds', () => {
    const plan = numberEntries(baseInputs().grouping, SEEDS);
    expect(plan.sea).toStrictEqual([
      { id: 6, seed: 0, name: 'Mar Cantabrico' },
      { id: 7, seed: 1, name: 'Mediterraneo' },
    ]);
  });

  it('FR-120 faction order equals faction id order', () => {
    const plan = numberEntries(baseInputs().grouping, SEEDS);
    expect(plan.factions.map((f) => f.id)).toStrictEqual([1, 2, 3]);
  });

  it('FR-120 the numbering does not depend on the order of the grouping table lists', () => {
    const a = baseInputs().grouping;
    const b = baseInputs().grouping;
    b.territories.reverse();
    b.countries.reverse();
    expect(numberEntries(b, SEEDS)).toStrictEqual(numberEntries(a, SEEDS));
  });

  it('FR-120 the land entries keep their provinces and an own name, and nothing else of the table', () => {
    const t = table(
      [
        { key: 'a', country: 'DEU', provinces: ['P1', 'P2'], name: 'Uno' },
        { key: 'b', country: 'DEU', provinces: ['P3'] },
      ],
      [{ country: 'DEU' }],
    );
    expect(numberEntries(t, []).land).toStrictEqual([
      { id: 1, key: 'a', country: 'DEU', owner: 1, provinces: ['P1', 'P2'], name: 'Uno' },
      { id: 2, key: 'b', country: 'DEU', owner: 1, provinces: ['P3'] },
    ]);
  });

  it('FR-120 numbering does not change its arguments', () => {
    const t = baseInputs().grouping;
    const snapshot = JSON.stringify([t, SEEDS]);
    numberEntries(t, SEEDS);
    expect(JSON.stringify([t, SEEDS])).toBe(snapshot);
  });
});

/** Presentation of a single DEU faction and the given territories and seeds. */
function present(
  countries: CountryRecord[],
  provinces: SourceFeature[],
  territories: GroupingTable['territories'],
  seeds: SeaSeed[] = [],
  tableCountries: GroupingTable['countries'] = [{ country: 'DEU' }],
) {
  const plan = numberEntries(table(territories, tableCountries), seeds);
  return buildPresentation(plan, countries, provinces);
}

const DEU = (extra: Record<string, unknown> = {}): CountryRecord[] => [{ adm0_a3: 'DEU', ...extra }];

describe('FR-121 presentation names', () => {
  it('FR-121 factions and territories are in faction order and map order, land then sea', () => {
    const inputs = baseInputs();
    const plan = numberEntries(inputs.grouping, inputs.seeds);
    const p = buildPresentation(plan, inputs.countries, inputs.provinces);
    expect(p).toStrictEqual({
      factions: [
        { id: 1, name: 'Alemania' },
        { id: 2, name: 'Espana' },
        { id: 3, name: 'Francia' },
      ],
      territories: [
        { id: 1, name: 'Baden' },
        { id: 2, name: 'Baviera' },
        { id: 3, name: 'Madrid' },
        { id: 4, name: 'Auvernia' },
        { id: 5, name: 'Isla de Francia' },
        { id: 6, name: 'Mar Cantabrico' },
        { id: 7, name: 'Mediterraneo' },
      ],
    });
  });

  it('FR-121 a faction is named from name_es when present, otherwise from name', () => {
    const t: GroupingTable['territories'] = [];
    expect(present(DEU({ name: 'Germany', name_es: 'Alemania' }), [], t).factions[0]?.name).toBe('Alemania');
    for (const name_es of [undefined, null, '', 5, ['x']]) {
      const p = present(DEU({ name: 'Germany', name_es }), [], t);
      expect(p.factions[0]?.name).toBe('Germany');
    }
  });

  it('FR-121 a faction with neither name present gets no name field', () => {
    for (const extra of [{}, { name: '', name_es: null }, { name: 7 }]) {
      const faction = present(DEU(extra), [], []).factions[0]!;
      expect(Object.keys(faction)).toStrictEqual(['id']);
    }
  });

  it('FR-121 a name with a trailing space is used as given: no trim, no fallback', () => {
    const p = present(DEU({ name: 'Germany', name_es: 'Alemania ' }), [], []);
    expect(p.factions[0]?.name).toBe('Alemania ');
  });

  it('FR-121 names are never normalized: a decomposed accent stays decomposed', () => {
    const decomposed = 'Baviéra';
    const prov = [province('P1', 'DEU', { name: 'Bavaria', name_es: decomposed })];
    const p = present(DEU({ name_es: 'Alemania' }), prov, [{ key: 'a', country: 'DEU', provinces: ['P1'] }]);
    expect(p.territories[0]?.name).toBe(decomposed);
    expect(p.territories[0]?.name).not.toBe(decomposed.normalize('NFC'));
  });

  it('FR-121 an invalid but present name is kept, with no fallback to another source', () => {
    const prov = [province('P1', 'DEU', { name: 'Bavaria', name_es: 'Baviera' })];
    const p = present(DEU({ name_es: 'X' }), prov, [{ key: 'a', country: 'DEU', provinces: ['P1'], name: ' Baviera ' }]);
    expect(p.territories[0]?.name).toBe(' Baviera ');
    const long = 'x'.repeat(200);
    const p2 = present(DEU({ name_es: 'X' }), prov, [{ key: 'a', country: 'DEU', provinces: ['P1'], name: long }]);
    expect(p2.territories[0]?.name).toBe(long);
  });

  it('FR-121 a territory takes the grouping table name when present, even with one province', () => {
    const prov = [province('P1', 'DEU', { name: 'Bavaria', name_es: 'Baviera' })];
    const p = present(DEU({ name_es: 'A' }), prov, [{ key: 'a', country: 'DEU', provinces: ['P1'], name: 'Mi nombre' }]);
    expect(p.territories[0]?.name).toBe('Mi nombre');
  });

  it('FR-121 a one-province territory without a table name takes the province name_es, else its name', () => {
    const prov = [
      province('P1', 'DEU', { name: 'Bavaria', name_es: 'Baviera' }),
      province('P2', 'DEU', { name: 'Hesse', name_es: null }),
      province('P3', 'DEU', { name: 'Saxony', name_es: '' }),
      province('P4', 'DEU', {}),
    ];
    const names = (tableName: unknown) =>
      present(
        DEU({ name_es: 'A' }),
        prov,
        ['P1', 'P2', 'P3', 'P4'].map((code, i) => ({
          key: `k${i}`,
          country: 'DEU',
          provinces: [code],
          name: tableName,
        })),
      ).territories.map((t) => t.name);
    for (const absent of [undefined, null, '', 4]) {
      expect(names(absent)).toStrictEqual(['Baviera', 'Hesse', 'Saxony', undefined]);
    }
  });

  it('FR-121 an entry with no name present gets no name field', () => {
    const prov = [province('P4', 'DEU', {})];
    const p = present(DEU({ name_es: 'A' }), prov, [{ key: 'a', country: 'DEU', provinces: ['P4'] }]);
    expect(Object.keys(p.territories[0]!)).toStrictEqual(['id']);
  });

  it('FR-121 a territory of several provinces without a table name gets no name field (never the first province)', () => {
    const prov = [province('P1', 'DEU', { name_es: 'Uno' }), province('P2', 'DEU', { name_es: 'Dos' })];
    const p = present(DEU({ name_es: 'A' }), prov, [{ key: 'a', country: 'DEU', provinces: ['P1', 'P2'] }]);
    expect(Object.keys(p.territories[0]!)).toStrictEqual(['id']);
  });

  it('FR-121 sea zone names come from the seeds as given; an empty seed name gives no name field', () => {
    const p = present(DEU({ name_es: 'A' }), [], [], [
      { name: 'Mar ', lon: 0, lat: 0 },
      { name: '', lon: 1, lat: 1 },
    ]);
    expect(p.territories).toStrictEqual([{ id: 1, name: 'Mar ' }, { id: 2 }]);
  });

  it('FR-121 preferred colours only where the grouping table gives them for a selected country', () => {
    const countries: CountryRecord[] = [
      { adm0_a3: 'DEU', name_es: 'Alemania' },
      { adm0_a3: 'FRA', name_es: 'Francia' },
    ];
    const plan = numberEntries(table([], [{ country: 'FRA', color: '#0055a4' }, { country: 'DEU' }]), []);
    const p = buildPresentation(plan, countries, []);
    expect(p.factions).toStrictEqual([
      { id: 1, name: 'Alemania' },
      { id: 2, name: 'Francia', color: '#0055a4' },
    ]);
    expect(Object.keys(p.factions[1]!)).toStrictEqual(['id', 'name', 'color']);
  });

  it('FR-121 the table cannot override a source faction name and the source cannot give a colour', () => {
    const countries: CountryRecord[] = [{ adm0_a3: 'DEU', name_es: 'Alemania', color: '#ff0000' } as CountryRecord];
    const plan = numberEntries(table([], [{ country: 'DEU' }]), []);
    expect(buildPresentation(plan, countries, []).factions).toStrictEqual([{ id: 1, name: 'Alemania' }]);
  });

  it('FR-121 a territory entry has exactly the keys id and name, in that order', () => {
    const prov = [province('P1', 'DEU', { name_es: 'Uno' })];
    const p = present(DEU({ name_es: 'A' }), prov, [{ key: 'a', country: 'DEU', provinces: ['P1'] }]);
    expect(Object.keys(p.territories[0]!)).toStrictEqual(['id', 'name']);
  });

  it('FR-121 building the presentation does not change its arguments', () => {
    const inputs = baseInputs();
    const plan = numberEntries(inputs.grouping, inputs.seeds);
    const snapshot = JSON.stringify([plan, inputs.countries, inputs.provinces]);
    buildPresentation(plan, inputs.countries, inputs.provinces);
    expect(JSON.stringify([plan, inputs.countries, inputs.provinces])).toBe(snapshot);
  });

  it('FR-121 a name read from an inherited property is not present', () => {
    const inherited = Object.create({ name_es: 'Heredado', name: 'Heredado' }) as Record<string, unknown>;
    inherited.adm0_a3 = 'DEU';
    const p = present([inherited as unknown as CountryRecord], [], []);
    expect(Object.keys(p.factions[0]!)).toStrictEqual(['id']);
  });
});
