import { describe, expect, it } from 'vitest';
import { GROUPING_KIND_ORDER } from '../src/core/errors';
import { checkGrouping } from '../src/core/grouping';
import type { CountryRecord, GroupingTable, SourceFeature } from '../src/core/types';
import { feature, province } from './helpers/fixtures';

interface Case {
  table: GroupingTable;
  provinces: SourceFeature[];
  countries: CountryRecord[];
}

/** DEU, ESP, FRA selected, every province of them assigned: no error. */
function base(): Case {
  return {
    table: {
      countries: [{ country: 'DEU' }, { country: 'ESP' }, { country: 'FRA' }],
      territories: [
        { key: 'baviera', country: 'DEU', provinces: ['DE-BY'] },
        { key: 'baden', country: 'DEU', provinces: ['DE-BW'] },
        { key: 'madrid', country: 'ESP', provinces: ['ES-MD'] },
        { key: 'paris', country: 'FRA', provinces: ['FR-IDF'] },
        { key: 'lyon', country: 'FRA', provinces: ['FR-ARA'] },
      ],
      excluded: [],
    },
    provinces: [
      province('DE-BY', 'DEU'),
      province('DE-BW', 'DEU'),
      province('ES-MD', 'ESP'),
      province('FR-IDF', 'FRA'),
      province('FR-ARA', 'FRA'),
    ],
    countries: [
      { adm0_a3: 'DEU', name: 'Germany', name_es: 'Alemania' },
      { adm0_a3: 'ESP', name: 'Spain', name_es: 'Espana' },
      { adm0_a3: 'FRA', name: 'France', name_es: 'Francia' },
    ],
  };
}

const run = (c: Case) => checkGrouping(c.table, c.provinces, c.countries);

describe('FR-113 grouping table check', () => {
  it('FR-113 a consistent table has no error', () => {
    expect(run(base())).toStrictEqual([]);
  });

  it('FR-113 the kind order is the order of the table', () => {
    expect(GROUPING_KIND_ORDER).toStrictEqual([
      'duplicate-country',
      'unknown-country',
      'duplicate-territory-key',
      'invalid-territory-country',
      'territory-color',
      'empty-territory',
      'missing-territory-name',
      'unknown-province',
      'duplicate-province-assignment',
      'province-country-mismatch',
      'unassigned-province',
      'empty-country',
    ]);
  });

  it('FR-113 duplicate-country: a code declared more than once gives one error per code', () => {
    const c = base();
    c.table.countries.push({ country: 'DEU' }, { country: 'DEU' });
    expect(run(c)).toStrictEqual([{ kind: 'duplicate-country', country: 'DEU' }]);
  });

  it('FR-113 unknown-country: a selected country with no country record', () => {
    const c = base();
    c.countries = c.countries.filter((r) => r.adm0_a3 !== 'ESP');
    expect(run(c)).toStrictEqual([{ kind: 'unknown-country', country: 'ESP' }]);
  });

  it('FR-113 unknown-country: a country that is both unknown and empty reports both kinds', () => {
    const c = base();
    c.table.countries.push({ country: 'QQQ' });
    expect(run(c)).toStrictEqual([
      { kind: 'unknown-country', country: 'QQQ' },
      { kind: 'empty-country', country: 'QQQ' },
    ]);
  });

  it('FR-113 duplicate-territory-key: a key used twice gives one error', () => {
    const c = base();
    c.table.territories[4]!.key = 'paris';
    expect(run(c)).toStrictEqual([{ kind: 'duplicate-territory-key', territory: 'paris' }]);
  });

  it('FR-113 duplicate-territory-key: a key used three times still gives one error (bayern twice and more)', () => {
    const c = base();
    c.table.territories[1]!.key = 'baviera';
    c.table.territories[2]!.key = 'baviera';
    c.table.territories[2]!.country = 'DEU';
    c.table.territories[2]!.provinces = ['DE-BW'];
    c.table.territories[1]!.provinces = ['ES-MD'];
    const errors = run(c);
    expect(errors.filter((e) => e.kind === 'duplicate-territory-key')).toStrictEqual([
      { kind: 'duplicate-territory-key', territory: 'baviera' },
    ]);
  });

  it('FR-113 invalid-territory-country: a territory with no country', () => {
    const c = base();
    delete c.table.territories[3]!.country;
    expect(run(c)).toStrictEqual([{ kind: 'invalid-territory-country', territory: 'paris' }]);
  });

  it('FR-113 invalid-territory-country: a country that is not selected, with no mismatch for its provinces', () => {
    const c = base();
    c.table.territories[3]!.country = 'ITA';
    expect(run(c)).toStrictEqual([{ kind: 'invalid-territory-country', territory: 'paris' }]);
  });

  it('FR-113 territory-color: a territory with a colour gives one error', () => {
    const c = base();
    c.table.territories[3]!.color = '#ff0000';
    expect(run(c)).toStrictEqual([{ kind: 'territory-color', territory: 'paris' }]);
  });

  it('FR-113 territory-color: a null colour is no colour', () => {
    const c = base();
    c.table.territories[3]!.color = null;
    expect(run(c)).toStrictEqual([]);
  });

  it('FR-113 once per distinct data: two territories sharing a key that both have a colour give one territory-color', () => {
    const c = base();
    c.table.territories[4]!.key = 'paris';
    c.table.territories[3]!.color = '#ff0000';
    c.table.territories[4]!.color = '#00ff00';
    expect(run(c)).toStrictEqual([
      { kind: 'duplicate-territory-key', territory: 'paris' },
      { kind: 'territory-color', territory: 'paris' },
    ]);
  });

  it('FR-113 empty-territory: a territory that lists no province', () => {
    const c = base();
    c.table.territories.push({ key: 'vacio', country: 'FRA', provinces: [] });
    expect(run(c)).toStrictEqual([{ kind: 'empty-territory', territory: 'vacio' }]);
  });

  it('FR-113 missing-territory-name: two provinces and no name', () => {
    const c = base();
    c.table.territories.splice(3, 2, { key: 'francia', country: 'FRA', provinces: ['FR-IDF', 'FR-ARA'] });
    expect(run(c)).toStrictEqual([{ kind: 'missing-territory-name', territory: 'francia' }]);
  });

  it('FR-113 missing-territory-name: an empty or non-text name is not present', () => {
    for (const name of ['', null, 5, undefined]) {
      const c = base();
      c.table.territories.splice(3, 2, { key: 'francia', country: 'FRA', provinces: ['FR-IDF', 'FR-ARA'], name });
      expect(run(c)).toStrictEqual([{ kind: 'missing-territory-name', territory: 'francia' }]);
    }
  });

  it('FR-113 missing-territory-name: a present name, even blank or invalid as a name, is accepted here', () => {
    for (const name of ['Francia', ' ', ' Francia ']) {
      const c = base();
      c.table.territories.splice(3, 2, { key: 'francia', country: 'FRA', provinces: ['FR-IDF', 'FR-ARA'], name });
      expect(run(c)).toStrictEqual([]);
    }
  });

  it('FR-113 missing-territory-name: a single province needs no name', () => {
    const c = base();
    expect(run(c)).toStrictEqual([]);
  });

  it('FR-113 unknown-province: a code that is no source province, listed twice, gives one error', () => {
    const c = base();
    c.table.territories[0]!.provinces.push('XX-NOPE');
    c.table.territories[1]!.provinces.push('XX-NOPE');
    c.table.territories[0]!.name = 'Baviera';
    c.table.territories[1]!.name = 'Baden';
    expect(run(c)).toStrictEqual([{ kind: 'unknown-province', province: 'XX-NOPE' }]);
  });

  it('FR-113 unknown-province: the excluded list and a province of a country that is not selected count', () => {
    const c = base();
    c.provinces.push(province('IT-LAZ', 'ITA'));
    c.table.excluded.push('IT-LAZ', 'XX-NOPE');
    expect(run(c)).toStrictEqual([
      { kind: 'unknown-province', province: 'IT-LAZ' },
      { kind: 'unknown-province', province: 'XX-NOPE' },
    ]);
  });

  it('FR-113 duplicate-province-assignment: listed in two territories gives one error', () => {
    const c = base();
    c.table.territories[1]!.provinces = ['DE-BY', 'DE-BW'];
    c.table.territories[1]!.name = 'Baden';
    expect(run(c)).toStrictEqual([{ kind: 'duplicate-province-assignment', province: 'DE-BY' }]);
  });

  it('FR-113 duplicate-province-assignment: listed in a territory and in the excluded list, or twice in one territory', () => {
    const c = base();
    c.table.excluded.push('DE-BY');
    c.table.territories[3]!.provinces = ['FR-IDF', 'FR-IDF'];
    c.table.territories[3]!.name = 'Paris';
    expect(run(c)).toStrictEqual([
      { kind: 'duplicate-province-assignment', province: 'DE-BY' },
      { kind: 'duplicate-province-assignment', province: 'FR-IDF' },
    ]);
  });

  it('FR-113 province-country-mismatch: a FRA province in a DEU territory', () => {
    const c = base();
    c.table.territories[0]!.provinces = ['FR-IDF'];
    c.table.territories[3]!.provinces = ['DE-BY'];
    expect(run(c)).toStrictEqual([
      { kind: 'province-country-mismatch', province: 'DE-BY', territory: 'paris' },
      { kind: 'province-country-mismatch', province: 'FR-IDF', territory: 'baviera' },
    ]);
  });

  it('FR-113 province-country-mismatch: same province in two territories is ordered by territory in code-unit order', () => {
    const c = base();
    c.table.territories[0]!.provinces = ['DE-BY', 'FR-IDF'];
    c.table.territories[0]!.name = 'Baviera';
    c.table.territories[1]!.provinces = ['DE-BW', 'FR-IDF'];
    c.table.territories[1]!.name = 'Baden';
    c.table.territories[3]!.provinces = ['FR-ARA'];
    c.table.territories.splice(4, 1);
    expect(run(c)).toStrictEqual([
      { kind: 'duplicate-province-assignment', province: 'FR-IDF' },
      { kind: 'province-country-mismatch', province: 'FR-IDF', territory: 'baden' },
      { kind: 'province-country-mismatch', province: 'FR-IDF', territory: 'baviera' },
    ]);
  });

  it('FR-113 unassigned-province: a province of a selected country in no territory and not excluded, wherever it lies', () => {
    const c = base();
    c.provinces.push(feature({ adm1_code: 'FR-FAR', adm0_a3: 'FRA' }, 170, -80));
    expect(run(c)).toStrictEqual([{ kind: 'unassigned-province', province: 'FR-FAR' }]);
  });

  it('FR-113 unassigned-province: an excluded province is not unassigned and a non-selected one is not required', () => {
    const c = base();
    c.provinces.push(province('FR-DOM', 'FRA'), province('IT-LAZ', 'ITA'));
    c.table.excluded.push('FR-DOM');
    expect(run(c)).toStrictEqual([]);
  });

  it('FR-113 empty-country: every province excluded', () => {
    const c = base();
    c.table.excluded.push('ES-MD');
    c.table.territories.splice(2, 1);
    expect(run(c)).toStrictEqual([{ kind: 'empty-country', country: 'ESP' }]);
  });

  it('FR-113 a territory of a selected country listed with an empty list is the only error for it', () => {
    const c = base();
    c.table.territories[2]!.provinces = [];
    expect(run(c)).toStrictEqual([
      { kind: 'empty-territory', territory: 'madrid' },
      { kind: 'unassigned-province', province: 'ES-MD' },
    ]);
  });

  it('FR-113 every kind at once is reported in table order, code-unit order inside a kind, once per distinct data', () => {
    const c: Case = {
      table: {
        countries: [
          { country: 'DEU' },
          { country: 'FRA' },
          { country: 'ESP' },
          { country: 'DEU' },
          { country: 'QQQ' },
        ],
        territories: [
          { key: 'bayern', country: 'DEU', provinces: ['DE-BY', 'FR-IDF'], name: 'Baviera', color: '#111111' },
          { key: 'bayern', country: 'DEU', provinces: ['DE-BW'], color: '#222222' },
          { key: 'x-no-country', provinces: ['FR-D'] },
          { key: 'x-bad-country', country: 'ITA', provinces: ['FR-C'] },
          { key: 'vacio', country: 'FRA', provinces: [] },
          { key: 'multi', country: 'FRA', provinces: ['FR-A', 'FR-B'] },
          { key: 'dos', country: 'FRA', provinces: ['FR-A', 'B-2', 'A-1', 'a-1', 'B-2'], name: 'Dos' },
        ],
        excluded: ['ES-MD', 'Z-9'],
      },
      provinces: [
        province('DE-BY', 'DEU'),
        province('DE-BW', 'DEU'),
        province('DE-TT', 'DEU'),
        province('FR-IDF', 'FRA'),
        province('FR-A', 'FRA'),
        province('FR-B', 'FRA'),
        province('FR-C', 'FRA'),
        province('FR-D', 'FRA'),
        province('FR-U', 'FRA'),
        province('ES-MD', 'ESP'),
      ],
      countries: [
        { adm0_a3: 'DEU', name: 'Germany' },
        { adm0_a3: 'ESP', name: 'Spain' },
        { adm0_a3: 'FRA', name: 'France' },
      ],
    };
    const expected = [
      { kind: 'duplicate-country', country: 'DEU' },
      { kind: 'unknown-country', country: 'QQQ' },
      { kind: 'duplicate-territory-key', territory: 'bayern' },
      { kind: 'invalid-territory-country', territory: 'x-bad-country' },
      { kind: 'invalid-territory-country', territory: 'x-no-country' },
      { kind: 'territory-color', territory: 'bayern' },
      { kind: 'empty-territory', territory: 'vacio' },
      { kind: 'missing-territory-name', territory: 'multi' },
      { kind: 'unknown-province', province: 'A-1' },
      { kind: 'unknown-province', province: 'B-2' },
      { kind: 'unknown-province', province: 'Z-9' },
      { kind: 'unknown-province', province: 'a-1' },
      { kind: 'duplicate-province-assignment', province: 'FR-A' },
      { kind: 'province-country-mismatch', province: 'FR-IDF', territory: 'bayern' },
      { kind: 'unassigned-province', province: 'DE-TT' },
      { kind: 'unassigned-province', province: 'FR-U' },
      { kind: 'empty-country', country: 'ESP' },
      { kind: 'empty-country', country: 'QQQ' },
    ];
    expect(run(c)).toStrictEqual(expected);
  });

  it('FR-113 the result does not depend on the order of the input lists', () => {
    const c = base();
    c.table.territories[0]!.provinces = ['FR-IDF'];
    c.table.territories[3]!.provinces = ['DE-BY'];
    const first = run(c);
    c.table.territories.reverse();
    c.provinces.reverse();
    expect(run(c)).toStrictEqual(first);
  });

  it('FR-113 checking does not change its arguments', () => {
    const c = base();
    c.table.territories[0]!.provinces = ['FR-IDF', 'XX'];
    const snapshot = JSON.stringify(c);
    run(c);
    expect(JSON.stringify(c)).toBe(snapshot);
  });
});
