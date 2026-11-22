import { describe, expect, it } from 'vitest';
import { CURATION_KIND_ORDER, ErrorCollector, type KindedError } from '../src/importer/errors';

// The FR-599 order, a literal list copied from the spec (not imported from src).
const KINDS = [
  'invalid-curation',
  'missing-unit-key',
  'invalid-unit-key',
  'conflicting-unit-property',
  'unknown-unit',
  'empty-selection',
  'invalid-name',
  'invalid-color',
  'invalid-key',
  'duplicate-faction-key',
  'sea-with-faction',
  'missing-group-value',
  'mixed-territory-kind',
  'conflicting-group-name',
  'missing-territory-name',
  'missing-faction',
  'split-territory-faction',
  'missing-faction-name',
  'faction-without-territory',
  'too-many-factions',
];

/** One synthetic error of every kind, with the data fields its producer will give it (first field first). */
const SYNTHETIC: Record<string, KindedError> = {
  'invalid-curation': { kind: 'invalid-curation', path: 'params.side' } as KindedError,
  'missing-unit-key': { kind: 'missing-unit-key', feature: 3 } as KindedError,
  'invalid-unit-key': { kind: 'invalid-unit-key', feature: 4 } as KindedError,
  'conflicting-unit-property': { kind: 'conflicting-unit-property', unit: 'A', property: 'name' } as KindedError,
  'unknown-unit': { kind: 'unknown-unit', unit: 'ZED' } as KindedError,
  'empty-selection': { kind: 'empty-selection' },
  'invalid-name': { kind: 'invalid-name', territory: 't', name: '' } as KindedError,
  'invalid-color': { kind: 'invalid-color', faction: 'f', color: 'red' } as KindedError,
  'invalid-key': { kind: 'invalid-key', territory: '' } as KindedError,
  'duplicate-faction-key': { kind: 'duplicate-faction-key', faction: 'f' } as KindedError,
  'sea-with-faction': { kind: 'sea-with-faction', unit: 'S' } as KindedError,
  'missing-group-value': { kind: 'missing-group-value', unit: 'U' } as KindedError,
  'mixed-territory-kind': { kind: 'mixed-territory-kind', territory: 't' } as KindedError,
  'conflicting-group-name': { kind: 'conflicting-group-name', territory: 't', names: ['a', 'b'] } as KindedError,
  'missing-territory-name': { kind: 'missing-territory-name', territory: 't' } as KindedError,
  'missing-faction': { kind: 'missing-faction', unit: 'U' } as KindedError,
  'split-territory-faction': { kind: 'split-territory-faction', territory: 't', factions: ['a', 'b'] } as KindedError,
  'missing-faction-name': { kind: 'missing-faction-name', faction: 'f' } as KindedError,
  'faction-without-territory': { kind: 'faction-without-territory', faction: 'f' } as KindedError,
  'too-many-factions': { kind: 'too-many-factions', cap: 9999, count: 10000 } as KindedError,
};

const collect = (errors: KindedError[]): KindedError[] => {
  const collector = new ErrorCollector<KindedError>();
  collector.addAll(errors);
  return collector.list();
};
const kindsOf = (errors: KindedError[]): string[] => errors.map((e) => e.kind);

/** Every permutation of a short list (the collector must not depend on the order errors were found in). */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

describe('the error collector of the curation stages', () => {
  it('the kind order is the literal list of the curation stage, from invalid-curation to too-many-factions', () => {
    expect([...CURATION_KIND_ORDER]).toStrictEqual(KINDS);
    expect(KINDS).toHaveLength(20);
    expect(Object.keys(SYNTHETIC)).toStrictEqual(KINDS);
  });

  it('the collector orders errors of every kind by the kind order, whatever order they were found in', () => {
    const all = Object.values(SYNTHETIC);
    expect(kindsOf(collect([...all].reverse()))).toStrictEqual(KINDS);
    expect(kindsOf(collect(all))).toStrictEqual(KINDS);
    const shuffled = [...all].sort((a, b) => (a.kind.length % 7) - (b.kind.length % 7) || a.kind.localeCompare(b.kind));
    expect(kindsOf(collect(shuffled))).toStrictEqual(KINDS);
  });

  it('the collector keeps an error of one invalid-key kind in its place, after invalid-color and before duplicate-faction-key', () => {
    const list = kindsOf(
      collect([SYNTHETIC['duplicate-faction-key']!, SYNTHETIC['invalid-key']!, SYNTHETIC['invalid-color']!, SYNTHETIC['invalid-name']!]),
    );
    expect(list).toStrictEqual(['invalid-name', 'invalid-color', 'invalid-key', 'duplicate-faction-key']);
  });

  it('the collector reports each error once per distinct data tuple, never once per kind and first field', () => {
    const a1 = { kind: 'conflicting-unit-property', unit: 'A', property: 'name' } as KindedError;
    const a2 = { kind: 'conflicting-unit-property', unit: 'A', property: 'from' } as KindedError;
    const b1 = { kind: 'conflicting-unit-property', unit: 'B', property: 'name' } as KindedError;
    const list = collect([a1, { ...a1 }, a2, b1, { ...a2 }, { ...b1 }]);
    expect(list).toStrictEqual([a2, a1, b1]);
    // key order inside an error does not make a different tuple; a different list value does
    const swapped = { property: 'name', unit: 'A', kind: 'conflicting-unit-property' } as KindedError;
    expect(collect([a1, swapped])).toHaveLength(1);
    const f1 = { kind: 'split-territory-faction', territory: 't', factions: ['a', 'b'] } as KindedError;
    const f2 = { kind: 'split-territory-faction', territory: 't', factions: ['a', 'c'] } as KindedError;
    expect(collect([f1, f2, { ...f1, factions: ['a', 'b'] } as KindedError])).toStrictEqual([f1, f2]);
    // an error with no data field is one error however often it is added
    expect(collect([{ kind: 'empty-selection' }, { kind: 'empty-selection' }])).toHaveLength(1);
  });

  it('the collector orders the errors of one kind by the code-unit order of the first data field', () => {
    const unit = (u: string) => ({ kind: 'unknown-unit', unit: u }) as KindedError;
    const list = collect(['b', 'B', 'a', 'é', 'A', 'aa', ''].map(unit));
    expect(list.map((e) => (e as unknown as { unit: string }).unit)).toStrictEqual(['', 'A', 'B', 'a', 'aa', 'b', 'é']);
  });

  it('the collector orders numbers as numbers, so feature 9 comes before feature 10', () => {
    const f = (n: number) => ({ kind: 'missing-unit-key', feature: n }) as KindedError;
    const list = collect([f(10), f(9), f(100), f(2)]);
    expect(list.map((e) => (e as unknown as { feature: number }).feature)).toStrictEqual([2, 9, 10, 100]);
  });

  it('the collector breaks a tie on the first data field by the next fields, so a pair with one first field is in a fixed order', () => {
    const e = (property: string, extra: string) => ({ kind: 'conflicting-unit-property', unit: 'A', property, extra }) as KindedError;
    const pair = [e('zeta', '1'), e('alpha', '2'), e('alpha', '1')];
    const expected = [e('alpha', '1'), e('alpha', '2'), e('zeta', '1')];
    for (const order of permutations(pair)) expect(collect(order)).toStrictEqual(expected);
  });

  it('the collector gives the same list for every order of a mixed set of errors', () => {
    const mixed = [
      SYNTHETIC['unknown-unit']!,
      { kind: 'unknown-unit', unit: 'AA' } as KindedError,
      SYNTHETIC['invalid-curation']!,
      { kind: 'invalid-curation', path: 'columns.key' } as KindedError,
      SYNTHETIC['conflicting-unit-property']!,
    ];
    const reference = collect(mixed);
    for (const order of permutations(mixed)) expect(collect(order)).toStrictEqual(reference);
    expect(reference.map((e) => e.kind)).toStrictEqual([
      'invalid-curation',
      'invalid-curation',
      'conflicting-unit-property',
      'unknown-unit',
      'unknown-unit',
    ]);
  });

  it('the collector puts a kind outside the order after every listed kind, by kind name', () => {
    const list = collect([{ kind: 'zebra' }, SYNTHETIC['too-many-factions']!, { kind: 'aardvark' }, SYNTHETIC['invalid-curation']!]);
    expect(kindsOf(list)).toStrictEqual(['invalid-curation', 'too-many-factions', 'aardvark', 'zebra']);
  });

  it('the collector counts the distinct errors and does not change what it was given', () => {
    const collector = new ErrorCollector<KindedError>();
    const first = { kind: 'unknown-unit', unit: 'a' } as KindedError;
    collector.add(first);
    collector.add({ ...first });
    collector.add({ kind: 'unknown-unit', unit: 'b' } as KindedError);
    expect(collector.size).toBe(2);
    const given = [SYNTHETIC['unknown-unit']!, SYNTHETIC['invalid-curation']!];
    const copy = structuredClone(given);
    collect(given);
    expect(given).toStrictEqual(copy);
    // list() is a copy: sorting it again or adding after it changes nothing already returned
    const out = collector.list();
    collector.add({ kind: 'unknown-unit', unit: 'c' } as KindedError);
    expect(out).toHaveLength(2);
    expect(collector.list()).toHaveLength(3);
  });
});
