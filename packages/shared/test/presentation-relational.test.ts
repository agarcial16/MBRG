import { describe, expect, it } from 'vitest';
import { factionOrder } from '../src/faction-order';
import { checkPresentation } from '../src/presentation';
import { twoLandMap, twoLandPresentation } from './helpers/package-fixtures';

// Faction order is 30, 10, 20 (first appearance); entries 1, 2, 3 land and 4 sea.
const seaMap = {
  territories: [
    { id: 1, owner: 30, neighbors: [4] },
    { id: 2, owner: 10, neighbors: [4] },
    { id: 3, owner: 20, neighbors: [4] },
    { id: 4, kind: 'sea', neighbors: [1, 2, 3] },
  ],
};
type Entries = Array<Record<string, unknown>>;
const validData = (): { factions: Entries; territories: Entries } => ({
  factions: [
    { id: 30, name: 'Tres', color: '#000001' },
    { id: 10, name: 'Uno', color: '#000002' },
    { id: 20, name: 'Dos' },
  ],
  territories: [
    { id: 1, name: 'A' },
    { id: 2, name: 'B' },
    { id: 3, name: 'C' },
    { id: 4, name: 'Mar' },
  ],
});
const errorsOf = (data: unknown, m: unknown = seaMap): unknown[] => {
  const r = checkPresentation(m, data);
  return r.ok ? [] : r.errors;
};

describe('presentation relational phase', () => {
  it('FR-90 FR-93 complete data for a map with a sea zone is ok', () => {
    expect(errorsOf(validData())).toStrictEqual([]);
  });

  it('FR-90 FR-101 the sea zone entry is required', () => {
    const d = validData();
    d.territories.pop();
    expect(errorsOf(d)).toStrictEqual([{ kind: 'missing-presentation', list: 'territories', id: 4 }]);
  });

  it('FR-100 a faction id equal to a territory id is unknown, and the other way round', () => {
    const d = validData();
    d.factions.push({ id: 1, name: 'Cuatro' });
    d.territories.push({ id: 10, name: 'X' });
    expect(errorsOf(d)).toStrictEqual([
      { kind: 'unknown-presentation-id', list: 'factions', id: 1 },
      { kind: 'unknown-presentation-id', list: 'territories', id: 10 },
    ]);
  });

  it('FR-101 missing factions in faction order and territories in map order', () => {
    const d = validData();
    d.factions = [{ id: 20, name: 'Dos' }];
    d.territories = [{ id: 3, name: 'C' }];
    expect(errorsOf(d)).toStrictEqual([
      { kind: 'missing-presentation', list: 'factions', id: 30 },
      { kind: 'missing-presentation', list: 'factions', id: 10 },
      { kind: 'missing-presentation', list: 'territories', id: 1 },
      { kind: 'missing-presentation', list: 'territories', id: 2 },
      { kind: 'missing-presentation', list: 'territories', id: 4 },
    ]);
  });

  it('FR-102 equal names are one duplicate listing the ids in faction order', () => {
    const d = validData();
    d.factions[0]!.name = 'Igual';
    d.factions[1]!.name = 'Igual';
    d.factions[2]!.name = 'Igual';
    d.factions.reverse();
    expect(errorsOf(d)).toStrictEqual([
      { kind: 'duplicate-faction-name', name: 'Igual', factions: [30, 10, 20] },
    ]);
  });

  it('FR-102 names compare exactly: Espana with and without a capital are not duplicates', () => {
    const d = validData();
    d.factions[0]!.name = 'España';
    d.factions[1]!.name = 'españa';
    expect(errorsOf(d)).toStrictEqual([]);
  });

  it('FR-102 unknown-id and invalid-name entries take no part', () => {
    const d = validData();
    d.factions.push({ id: 99, name: 'Uno' });
    expect(errorsOf(d)).toStrictEqual([{ kind: 'unknown-presentation-id', list: 'factions', id: 99 }]);
    const e = validData();
    e.factions[0]!.name = '';
    e.factions[1]!.name = '';
    expect(errorsOf(e)).toStrictEqual([
      { kind: 'invalid-name', list: 'factions', position: 0, id: 30 },
      { kind: 'invalid-name', list: 'factions', position: 1, id: 10 },
    ]);
  });

  it('FR-102 a faction name equal to a territory name and repeated territory names are valid', () => {
    const d = validData();
    d.factions[0]!.name = 'Portugal';
    d.territories[0]!.name = 'Portugal';
    d.territories[1]!.name = 'Portugal';
    expect(errorsOf(d)).toStrictEqual([]);
  });

  it('FR-103 equal colors are one duplicate in faction order, far apart in the list', () => {
    const d = validData();
    d.factions[0]!.color = '#aaaaaa';
    d.factions[2]!.color = '#aaaaaa';
    expect(errorsOf(d)).toStrictEqual([
      { kind: 'duplicate-color', color: '#aaaaaa', factions: [30, 20] },
    ]);
  });

  it('FR-103 absent, invalid and unknown-id colors take no part', () => {
    const d = validData();
    delete d.factions[0]!.color;
    delete d.factions[1]!.color;
    expect(errorsOf(d)).toStrictEqual([]);
    const e = validData();
    e.factions[0]!.color = 'RED';
    e.factions[1]!.color = 'RED';
    e.factions.push({ id: 99, name: 'Zzz', color: '#000002' });
    expect(errorsOf(e)).toStrictEqual([
      { kind: 'invalid-color', list: 'factions', position: 0, id: 30 },
      { kind: 'invalid-color', list: 'factions', position: 1, id: 10 },
      { kind: 'unknown-presentation-id', list: 'factions', id: 99 },
    ]);
  });

  it('FR-93 FR-94 every relational kind at once in exact order', () => {
    const d = {
      factions: [
        { id: 20, name: 'Dup', color: '#111111' },
        { id: 77, name: 'Fuera' },
        { id: 10, name: 'Dup', color: '#111111' },
        { id: 55, name: 'Otro', color: '#222222' },
      ],
      territories: [
        { id: 9, name: 'Z' },
        { id: 1, name: 'A' },
        { id: 8, name: 'Y' },
      ],
    };
    expect(errorsOf(d)).toStrictEqual([
      { kind: 'unknown-presentation-id', list: 'factions', id: 77 },
      { kind: 'unknown-presentation-id', list: 'factions', id: 55 },
      { kind: 'unknown-presentation-id', list: 'territories', id: 9 },
      { kind: 'unknown-presentation-id', list: 'territories', id: 8 },
      { kind: 'missing-presentation', list: 'factions', id: 30 },
      { kind: 'missing-presentation', list: 'territories', id: 2 },
      { kind: 'missing-presentation', list: 'territories', id: 3 },
      { kind: 'missing-presentation', list: 'territories', id: 4 },
      { kind: 'duplicate-faction-name', name: 'Dup', factions: [10, 20] },
      { kind: 'duplicate-color', color: '#111111', factions: [10, 20] },
    ]);
  });

  it('FR-94 duplicate groups are ordered by the faction order of their first faction', () => {
    const d = validData();
    d.factions[0]!.name = 'P';
    d.factions[1]!.name = 'Q';
    d.factions[2]!.name = 'P';
    d.factions.push({ id: 5, name: 'Q' });
    d.factions.reverse();
    // Q repeats only with unknown faction 5, which takes no part.
    expect(errorsOf(d)).toStrictEqual([
      { kind: 'unknown-presentation-id', list: 'factions', id: 5 },
      { kind: 'duplicate-faction-name', name: 'P', factions: [30, 20] },
    ]);
  });

  it('FR-94 shuffled lists give the same result', () => {
    const d = {
      factions: [
        { id: 20, name: 'Dup', color: '#111111' },
        { id: 10, name: 'Dup', color: '#111111' },
      ],
      territories: [
        { id: 3, name: 'C' },
        { id: 1, name: 'A' },
      ],
    };
    const shuffled = {
      factions: [...d.factions].reverse(),
      territories: [...d.territories].reverse(),
    };
    const expected = [
      { kind: 'missing-presentation', list: 'factions', id: 30 },
      { kind: 'missing-presentation', list: 'territories', id: 2 },
      { kind: 'missing-presentation', list: 'territories', id: 4 },
      { kind: 'duplicate-faction-name', name: 'Dup', factions: [10, 20] },
      { kind: 'duplicate-color', color: '#111111', factions: [10, 20] },
    ];
    expect(errorsOf(d)).toStrictEqual(expected);
    expect(errorsOf(shuffled)).toStrictEqual(expected);
  });

  it('FR-93 duplicates plus an unknown id report only the structural errors', () => {
    const d = validData();
    d.factions.push({ id: 30, name: 'Otra' });
    d.territories.push({ id: 99, name: 'Fuera' });
    expect(errorsOf(d)).toStrictEqual([
      { kind: 'duplicate-presentation-id', list: 'factions', id: 30, positions: [0, 3] },
    ]);
  });

  it('FR-93 a non-blocking structural error is reported together with relational ones', () => {
    const d = validData();
    d.factions[0]!.name = '';
    d.territories.pop();
    expect(errorsOf(d)).toStrictEqual([
      { kind: 'invalid-name', list: 'factions', position: 0, id: 30 },
      { kind: 'missing-presentation', list: 'territories', id: 4 },
    ]);
  });

  it('FR-93 the plain two-land fixture stays valid', () => {
    expect(errorsOf(twoLandPresentation(), twoLandMap())).toStrictEqual([]);
  });

  it('FR-101 factionOrder is the first appearance of land owners', () => {
    expect(factionOrder(seaMap)).toStrictEqual([30, 10, 20]);
    expect(
      factionOrder({
        territories: [
          { id: 1, owner: 5, neighbors: [] },
          { id: 2, owner: 6, neighbors: [] },
          { id: 3, owner: 5, neighbors: [] },
        ],
      }),
    ).toStrictEqual([5, 6]);
  });
});
