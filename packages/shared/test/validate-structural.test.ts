import { describe, expect, it } from 'vitest';
import { sortErrors, validateMap } from '../src/validate';
import { validateStructural } from '../src/validate-structural';

// A valid map.
const ok = () => ({
  territories: [
    { id: 1, owner: 1, neighbors: [2] },
    { id: 2, owner: 2, neighbors: [1] },
  ],
});

// Structural phase only (sorted as validateMap does); relational errors are covered in validate-relational.test.ts.
const errorsOf = (input: unknown) => sortErrors(validateStructural(input).errors);

describe('structural validation', () => {
  it('FR-9 a structurally valid map is accepted and the same object is returned', () => {
    const input = ok();
    const r = validateMap(input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(input);
  });

  it.each([
    ['null', null],
    ['a list', []],
    ['a number', 3],
    ['text', 'map'],
    ['undefined', undefined],
    ['true', true],
  ])('FR-12 %s is only invalid-map', (_l, input) => {
    expect(errorsOf(input)).toStrictEqual([{ kind: 'invalid-map' }]);
  });

  it.each([
    ['missing', {}],
    ['not a list', { territories: {} }],
    ['null', { territories: null }],
  ])('FR-13 territories %s gives invalid-territories', (_l, input) => {
    expect(errorsOf(input)).toStrictEqual([{ kind: 'invalid-territories' }]);
  });

  it('FR-13 invalid-territories is blocking and reported with top-level unknown fields', () => {
    expect(errorsOf({ version: 1 })).toStrictEqual([
      { kind: 'invalid-territories' },
      { kind: 'unknown-field', location: { at: 'map' }, field: 'version' },
    ]);
  });

  it('FR-14 a non-object territory gives invalid-territory with its position', () => {
    const input = { territories: [{ id: 1, owner: 1, neighbors: [] }, 5, null, []] };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'invalid-territory', position: 1 },
      { kind: 'invalid-territory', position: 2 },
      { kind: 'invalid-territory', position: 3 },
    ]);
  });

  it.each([
    ['missing', { owner: 1, neighbors: [] }],
    ['zero', { id: 0, owner: 1, neighbors: [] }],
    ['text', { id: '1', owner: 1, neighbors: [] }],
    ['1.5', { id: 1.5, owner: 1, neighbors: [] }],
    ['null', { id: null, owner: 1, neighbors: [] }],
  ])('FR-15 %s id gives invalid-territory-id', (_l, t) => {
    expect(errorsOf({ territories: [t] })).toStrictEqual([
      { kind: 'invalid-territory-id', position: 0 },
    ]);
  });

  it.each([
    ['missing', { id: 4, owner: 1 }],
    ['not a list', { id: 4, owner: 1, neighbors: 'x' }],
    ['invalid entry', { id: 4, owner: 1, neighbors: [1, '2'] }],
    ['zero entry', { id: 4, owner: 1, neighbors: [0] }],
  ])('FR-16 %s neighbors give one invalid-neighbors with the id', (_l, t) => {
    expect(errorsOf({ territories: [t] })).toStrictEqual([
      { kind: 'invalid-neighbors', position: 0, id: 4 },
    ]);
  });

  it('FR-16 several bad entries still give a single invalid-neighbors; id omitted when invalid', () => {
    expect(
      errorsOf({ territories: [{ id: 'a', owner: 1, neighbors: [0, -1, 'x'] }] }),
    ).toStrictEqual([
      { kind: 'invalid-territory-id', position: 0 },
      { kind: 'invalid-neighbors', position: 0 },
    ]);
  });

  it.each([
    ['missing', { id: 3, neighbors: [] }],
    ['null', { id: 3, owner: null, neighbors: [] }],
  ])('FR-17 %s owner gives missing-owner', (_l, t) => {
    expect(errorsOf({ territories: [t] })).toStrictEqual([
      { kind: 'missing-owner', position: 0, id: 3 },
    ]);
  });

  it.each([
    ['zero', 0],
    ['text', '1'],
    ['empty text', ''],
    ['1.5', 1.5],
    ['too big', 16_777_216],
    ['boolean', false],
    ['list', []],
    ['object', {}],
  ])('FR-18 owner %s gives invalid-owner (not missing-owner)', (_l, owner) => {
    expect(errorsOf({ territories: [{ id: 3, owner, neighbors: [] }] })).toStrictEqual([
      { kind: 'invalid-owner', position: 0, id: 3 },
    ]);
  });

  it('FR-18 invalid-owner omits id when the territory id is invalid', () => {
    expect(errorsOf({ territories: [{ id: 0, owner: 0, neighbors: [] }] })).toStrictEqual([
      { kind: 'invalid-territory-id', position: 0 },
      { kind: 'invalid-owner', position: 0 },
    ]);
  });

  it('FR-19 FR-4 version at top level and name on a territory give two unknown-field errors', () => {
    const input = {
      version: 1,
      territories: [{ id: 1, owner: 1, neighbors: [], name: 'A' }],
    };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'unknown-field', location: { at: 'map' }, field: 'version' },
      { kind: 'unknown-field', location: { at: 'territory', position: 0, id: 1 }, field: 'name' },
    ]);
  });

  it('FR-19 unknown fields are one per field, sorted by field name (code units), omit id if invalid', () => {
    const input = {
      zeta: 1,
      Alpha: 2,
      alpha: 3,
      territories: [{ id: 'x', owner: 1, neighbors: [], colour: 1, Name: 2 }],
    };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'invalid-territory-id', position: 0 },
      { kind: 'unknown-field', location: { at: 'map' }, field: 'Alpha' },
      { kind: 'unknown-field', location: { at: 'map' }, field: 'alpha' },
      { kind: 'unknown-field', location: { at: 'map' }, field: 'zeta' },
      { kind: 'unknown-field', location: { at: 'territory', position: 0 }, field: 'Name' },
      { kind: 'unknown-field', location: { at: 'territory', position: 0 }, field: 'colour' },
    ]);
  });

  it('FR-20 one duplicate-territory-id per repeated id with all positions ascending', () => {
    const t = (id: number) => ({ id, owner: id, neighbors: [] as number[] });
    const input = { territories: [t(5), t(6), t(5), t(6), t(5), t(7)] };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'duplicate-territory-id', id: 5, positions: [0, 2, 4] },
      { kind: 'duplicate-territory-id', id: 6, positions: [1, 3] },
    ]);
  });

  it('FR-20 invalid ids are not duplicates of each other', () => {
    const input = {
      territories: [
        { id: 0, owner: 1, neighbors: [] },
        { id: 0, owner: 2, neighbors: [] },
      ],
    };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'invalid-territory-id', position: 0 },
      { kind: 'invalid-territory-id', position: 1 },
    ]);
  });

  it('FR-9 blocking errors are flagged; non-blocking ones are not', () => {
    const blocking = [
      'not a map',
      {},
      { territories: [1] },
      { territories: [{ owner: 1, neighbors: [] }] },
      { territories: [{ id: 1, owner: 1 }] },
      {
        territories: [
          { id: 1, owner: 1, neighbors: [] },
          { id: 1, owner: 2, neighbors: [] },
        ],
      },
    ];
    for (const input of blocking) expect(validateStructural(input).blocking).toBe(true);

    const nonBlocking = [
      ok(),
      { territories: [{ id: 1, neighbors: [] }] },
      { territories: [{ id: 1, owner: 0, neighbors: [] }] },
      { extra: 1, territories: [{ id: 1, owner: 1, neighbors: [], name: 'x' }] },
    ];
    for (const input of nonBlocking) expect(validateStructural(input).blocking).toBe(false);
  });

  it('FR-9 FR-11 every structural kind at once: exact list and order', () => {
    const input = {
      version: 1,
      territories: [
        5, // 0 invalid-territory
        { owner: 1, neighbors: [] }, // 1 invalid-territory-id
        { id: 7, owner: 1, neighbors: 'x' }, // 2 invalid-neighbors
        { id: 8, neighbors: [] }, // 3 missing-owner
        { id: 9, owner: 0, neighbors: [], name: 'x' }, // 4 invalid-owner + unknown-field
        { id: 10, owner: 2, neighbors: [] }, // 5 duplicate id 10
        { id: 10, owner: 3, neighbors: [] }, // 6 duplicate id 10
      ],
    };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'invalid-territory', position: 0 },
      { kind: 'invalid-territory-id', position: 1 },
      { kind: 'invalid-neighbors', position: 2, id: 7 },
      { kind: 'duplicate-territory-id', id: 10, positions: [5, 6] },
      { kind: 'missing-owner', position: 3, id: 8 },
      { kind: 'invalid-owner', position: 4, id: 9 },
      { kind: 'unknown-field', location: { at: 'map' }, field: 'version' },
      { kind: 'unknown-field', location: { at: 'territory', position: 4, id: 9 }, field: 'name' },
    ]);
  });

  it('FR-11 errors of one kind are ordered by territory position', () => {
    const input = {
      territories: [
        { id: 1, neighbors: [] },
        { id: 2, owner: 1, neighbors: [] },
        { id: 3, owner: null, neighbors: [] },
      ],
    };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'missing-owner', position: 0, id: 1 },
      { kind: 'missing-owner', position: 2, id: 3 },
    ]);
  });

  it('FR-28 validation never mutates or copies the input', () => {
    const input = {
      version: 1,
      territories: [
        5,
        { id: 1, owner: 'x', neighbors: [0], name: 'A' },
        { id: 1, neighbors: [] },
      ],
    };
    const before = structuredClone(input);
    validateMap(input);
    validateStructural(input);
    expect(input).toStrictEqual(before);
  });

  it('FR-28 a valid map returns the same object, deep-equal to its clone', () => {
    const input = ok();
    const before = structuredClone(input);
    const r = validateMap(input);
    expect(input).toStrictEqual(before);
    expect(r.ok && r.value === input).toBe(true);
  });
  describe('arrays with empty slots never throw', () => {
    const holeInTerritories = (): unknown => {
      // eslint-disable-next-line no-sparse-arrays
      return { territories: [, { id: 2, owner: 2, neighbors: [] }] };
    };
    it('FR-14 an empty slot in territories is invalid-territory and blocks', () => {
      expect(errorsOf(holeInTerritories())).toStrictEqual([{ kind: 'invalid-territory', position: 0 }]);
      expect(validateStructural(holeInTerritories()).blocking).toBe(true);
    });
    it('FR-14 new Array(3) gives one invalid-territory per slot', () => {
      expect(errorsOf({ territories: new Array(3) })).toStrictEqual([
        { kind: 'invalid-territory', position: 0 },
        { kind: 'invalid-territory', position: 1 },
        { kind: 'invalid-territory', position: 2 },
      ]);
    });
    it('FR-14 validateMap returns errors instead of throwing', () => {
      const r = validateMap(holeInTerritories());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors).toStrictEqual([{ kind: 'invalid-territory', position: 0 }]);
    });
    it('FR-16 an empty slot in neighbors is invalid-neighbors', () => {
      // eslint-disable-next-line no-sparse-arrays
      const input = { territories: [{ id: 1, owner: 1, neighbors: [, 2] }, { id: 2, owner: 2, neighbors: [1] }] };
      const e = errorsOf(input);
      expect(e).toStrictEqual([{ kind: 'invalid-neighbors', position: 0, id: 1 }]);
      expect(validateMap(input).ok).toBe(false);
    });
  });
});
