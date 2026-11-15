import { describe, expect, it } from 'vitest';
import { checkPresentation } from '../src/presentation';
import { validateMap } from '../src/validate';
import { twoLandMap, twoLandPresentation } from './helpers/package-fixtures';

const map = twoLandMap();
const errorsOf = (data: unknown, m: unknown = map): unknown[] => {
  const r = checkPresentation(m, data);
  return r.ok ? [] : r.errors;
};

describe('presentation structural phase', () => {
  it('FR-84 FR-85 FR-86 FR-93 valid data returns ok with the same object', () => {
    const data = twoLandPresentation();
    const r = checkPresentation(map, data);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(data);
  });

  it('FR-91 an invalid map returns exactly the map errors and runs no presentation check', () => {
    const bad = { territories: [{ id: 0, owner: 1, neighbors: [] }] };
    const expected = validateMap(bad);
    expect(expected.ok).toBe(false);
    expect(checkPresentation(bad, 'not an object')).toStrictEqual(expected);
  });

  it('FR-95 data that is not an object gives only invalid-presentation', () => {
    for (const bad of [null, [], 3, 'x', undefined, true]) {
      expect(errorsOf(bad)).toStrictEqual([{ kind: 'invalid-presentation' }]);
    }
  });

  it('FR-95 a missing or non-list factions or territories gives invalid-presentation-list', () => {
    const base = twoLandPresentation();
    expect(errorsOf({ territories: base.territories })).toStrictEqual([
      { kind: 'invalid-presentation-list', list: 'factions' },
    ]);
    expect(errorsOf({ factions: {}, territories: null })).toStrictEqual([
      { kind: 'invalid-presentation-list', list: 'factions' },
      { kind: 'invalid-presentation-list', list: 'territories' },
    ]);
    expect(errorsOf({ factions: base.factions, territories: 'x' })).toStrictEqual([
      { kind: 'invalid-presentation-list', list: 'territories' },
    ]);
  });

  it('FR-89 FR-95 inherited lists count as missing', () => {
    const base = twoLandPresentation();
    const data = Object.create({ factions: base.factions, territories: base.territories });
    expect(errorsOf(data)).toStrictEqual([
      { kind: 'invalid-presentation-list', list: 'factions' },
      { kind: 'invalid-presentation-list', list: 'territories' },
    ]);
  });

  it('FR-96 a non-object element gives invalid-presentation-entry (list, null, primitive, hole)', () => {
    const base = twoLandPresentation();
    const factions = [base.factions[0], [], null, 5, 'x'];
    expect(errorsOf({ factions, territories: base.territories })).toStrictEqual([
      { kind: 'invalid-presentation-entry', list: 'factions', position: 1 },
      { kind: 'invalid-presentation-entry', list: 'factions', position: 2 },
      { kind: 'invalid-presentation-entry', list: 'factions', position: 3 },
      { kind: 'invalid-presentation-entry', list: 'factions', position: 4 },
    ]);
    const sparse: unknown[] = [{ id: 1, name: 'A' }];
    sparse.length = 3;
    expect(errorsOf({ factions: base.factions, territories: sparse })).toStrictEqual([
      { kind: 'invalid-presentation-entry', list: 'territories', position: 1 },
      { kind: 'invalid-presentation-entry', list: 'territories', position: 2 },
    ]);
  });

  it('FR-96 a missing or invalid id gives invalid-presentation-id and name errors without id', () => {
    const base = twoLandPresentation();
    const bad = [0, -1, 1.5, '1', 16777216, null, NaN];
    for (const id of bad) {
      expect(errorsOf({ factions: [{ id, name: '' }], territories: base.territories })).toStrictEqual([
        { kind: 'invalid-presentation-id', list: 'factions', position: 0 },
        { kind: 'invalid-name', list: 'factions', position: 0 },
      ]);
    }
    const noId = errorsOf({ factions: [{ name: 'X' }], territories: base.territories });
    expect(noId).toStrictEqual([{ kind: 'invalid-presentation-id', list: 'factions', position: 0 }]);
    const inherited = Object.create({ id: 5 });
    inherited.name = 'X';
    expect(errorsOf({ factions: [inherited], territories: base.territories })).toStrictEqual([
      { kind: 'invalid-presentation-id', list: 'factions', position: 0 },
    ]);
  });

  it('FR-96 duplicate ids give one duplicate-presentation-id each, ordered by first position', () => {
    const base = twoLandPresentation();
    const factions = [
      { id: 5, name: 'a' },
      { id: 7, name: 'b' },
      { id: 3, name: 'c' },
      { id: 9, name: 'd' },
      { id: 7, name: 'e' },
      { id: 3, name: 'f' },
      { id: 7, name: 'g' },
    ];
    expect(errorsOf({ factions, territories: base.territories })).toStrictEqual([
      { kind: 'duplicate-presentation-id', list: 'factions', id: 7, positions: [1, 4, 6] },
      { kind: 'duplicate-presentation-id', list: 'factions', id: 3, positions: [2, 5] },
    ]);
  });

  it('FR-94 FR-96 the 7/3 example: id 7 at positions 4 and 1 comes before id 3 at 2 and 5', () => {
    const base = twoLandPresentation();
    const factions = [
      { id: 1, name: 'a' },
      { id: 7, name: 'b' },
      { id: 3, name: 'c' },
      { id: 2, name: 'd' },
      { id: 7, name: 'e' },
      { id: 3, name: 'f' },
    ];
    expect(errorsOf({ factions, territories: base.territories })).toStrictEqual([
      { kind: 'duplicate-presentation-id', list: 'factions', id: 7, positions: [1, 4] },
      { kind: 'duplicate-presentation-id', list: 'factions', id: 3, positions: [2, 5] },
    ]);
  });

  it('FR-96 equal ids in factions and territories are not duplicates', () => {
    const data = {
      factions: [
        { id: 1, name: 'A' },
        { id: 2, name: 'C' },
      ],
      territories: [
        { id: 1, name: 'B' },
        { id: 2, name: 'D' },
      ],
    };
    const sameIds = {
      territories: [
        { id: 1, owner: 1, neighbors: [2] },
        { id: 2, owner: 2, neighbors: [1] },
      ],
    };
    expect(checkPresentation(sameIds, data).ok).toBe(true);
  });

  it('FR-97 an invalid or missing name gives invalid-name, with id when valid', () => {
    const factions = [{ id: 10, name: ' x' }, { id: 20 }];
    const territories = [{ id: 1, name: 3 }, { id: 2, name: 'ok' }];
    expect(errorsOf({ factions, territories })).toStrictEqual([
      { kind: 'invalid-name', list: 'factions', position: 0, id: 10 },
      { kind: 'invalid-name', list: 'factions', position: 1, id: 20 },
      { kind: 'invalid-name', list: 'territories', position: 0, id: 1 },
    ]);
  });

  it('FR-89 FR-97 an inherited name is missing', () => {
    const base = twoLandPresentation();
    const entry = Object.create({ name: 'Aragon' });
    entry.id = 10;
    expect(errorsOf({ factions: [entry, base.factions[1]], territories: base.territories })).toStrictEqual([
      { kind: 'invalid-name', list: 'factions', position: 0, id: 10 },
    ]);
  });

  it('FR-98 an own invalid color gives invalid-color; absent is fine', () => {
    const base = twoLandPresentation();
    for (const color of [null, '#FFFFFF', '#fff', 'red', 5, undefined, '#00ff7a ']) {
      const factions = [{ id: 10, name: 'Aragon', color }, base.factions[1]];
      expect(errorsOf({ factions, territories: base.territories })).toStrictEqual([
        { kind: 'invalid-color', list: 'factions', position: 0, id: 10 },
      ]);
    }
    const noId = [{ name: 'Aragon', color: 'red' }, base.factions[1]];
    expect(errorsOf({ factions: noId, territories: base.territories })).toStrictEqual([
      { kind: 'invalid-presentation-id', list: 'factions', position: 0 },
      { kind: 'invalid-color', list: 'factions', position: 0 },
    ]);
  });

  it('FR-89 FR-98 an inherited color is absent', () => {
    const base = twoLandPresentation();
    const entry = Object.create({ color: 'red' });
    entry.id = 10;
    entry.name = 'Aragon';
    expect(errorsOf({ factions: [entry, base.factions[1]], territories: base.territories })).toStrictEqual([]);
  });

  it('FR-99 FR-89 unknown fields at top level and in entries, one per field in code-unit order', () => {
    const base = twoLandPresentation();
    const data = {
      version: 1,
      seed: 3,
      factions: [{ id: 10, name: 'Aragon', zeta: 1, anchor: [0, 0] }, base.factions[1]],
      territories: [
        { id: 1, name: 'Huesca', color: '#00ff7a' },
        { name: 'B', id: 2, Z: 0 },
      ],
    };
    expect(errorsOf(data)).toStrictEqual([
      { kind: 'presentation-unknown-field', location: { at: 'presentation' }, field: 'seed' },
      { kind: 'presentation-unknown-field', location: { at: 'presentation' }, field: 'version' },
      {
        kind: 'presentation-unknown-field',
        location: { at: 'entry', list: 'factions', position: 0, id: 10 },
        field: 'anchor',
      },
      {
        kind: 'presentation-unknown-field',
        location: { at: 'entry', list: 'factions', position: 0, id: 10 },
        field: 'zeta',
      },
      {
        kind: 'presentation-unknown-field',
        location: { at: 'entry', list: 'territories', position: 0, id: 1 },
        field: 'color',
      },
      {
        kind: 'presentation-unknown-field',
        location: { at: 'entry', list: 'territories', position: 1, id: 2 },
        field: 'Z',
      },
    ]);
  });

  it('FR-99 the location of an unknown field omits id when the entry id is invalid', () => {
    const base = twoLandPresentation();
    const data = {
      factions: [{ id: 0, name: 'A', extra: 1 }, base.factions[1]],
      territories: base.territories,
    };
    expect(errorsOf(data)).toStrictEqual([
      { kind: 'invalid-presentation-id', list: 'factions', position: 0 },
      {
        kind: 'presentation-unknown-field',
        location: { at: 'entry', list: 'factions', position: 0 },
        field: 'extra',
      },
    ]);
    const loc = (errorsOf(data)[1] as { location: object }).location;
    expect(Object.hasOwn(loc, 'id')).toBe(false);
  });

  it('FR-92 an omitted id key is absent, not undefined', () => {
    const base = twoLandPresentation();
    const e = errorsOf({ factions: [{ id: -1, name: '' }], territories: base.territories })[1] as object;
    expect(Object.hasOwn(e, 'id')).toBe(false);
  });

  it('FR-92 FR-94 FR-93 every structural kind but invalid-presentation at once, in table order', () => {
    const data = {
      seed: 1,
      factions: [
        { id: 10, name: 'ok' },
        { id: 20, name: ' bad', color: 'red', junk: 1 },
        { id: 10, name: 'dup' },
        7,
        { name: 'noid' },
      ],
      territories: 'nope',
    };
    expect(errorsOf(data)).toStrictEqual([
      { kind: 'invalid-presentation-list', list: 'territories' },
      { kind: 'invalid-presentation-entry', list: 'factions', position: 3 },
      { kind: 'invalid-presentation-id', list: 'factions', position: 4 },
      { kind: 'duplicate-presentation-id', list: 'factions', id: 10, positions: [0, 2] },
      { kind: 'invalid-name', list: 'factions', position: 1, id: 20 },
      { kind: 'invalid-color', list: 'factions', position: 1, id: 20 },
      { kind: 'presentation-unknown-field', location: { at: 'presentation' }, field: 'seed' },
      {
        kind: 'presentation-unknown-field',
        location: { at: 'entry', list: 'factions', position: 1, id: 20 },
        field: 'junk',
      },
    ]);
  });

  it('FR-94 errors of one kind keep factions before territories, then position', () => {
    const data = {
      factions: [
        { id: 10, name: '' },
        { id: 20, name: '' },
      ],
      territories: [
        { id: 1, name: '' },
        { id: 2, name: '' },
      ],
    };
    expect(errorsOf(data)).toStrictEqual([
      { kind: 'invalid-name', list: 'factions', position: 0, id: 10 },
      { kind: 'invalid-name', list: 'factions', position: 1, id: 20 },
      { kind: 'invalid-name', list: 'territories', position: 0, id: 1 },
      { kind: 'invalid-name', list: 'territories', position: 1, id: 2 },
    ]);
  });

  it('FR-93 a blocking error skips relational checks (no unknown-presentation-id)', () => {
    const data = {
      factions: [
        { id: 10, name: 'A' },
        { id: 10, name: 'B' },
      ],
      territories: [{ id: 999, name: 'Nowhere' }],
    };
    expect(errorsOf(data)).toStrictEqual([
      { kind: 'duplicate-presentation-id', list: 'factions', id: 10, positions: [0, 1] },
    ]);
  });

  it('FR-93 non-blocking structural errors alone do not block valid data', () => {
    const data = { ...twoLandPresentation(), seed: 1 };
    expect(errorsOf(data)).toStrictEqual([
      { kind: 'presentation-unknown-field', location: { at: 'presentation' }, field: 'seed' },
    ]);
  });
});
