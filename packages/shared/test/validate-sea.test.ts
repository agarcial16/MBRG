import { describe, expect, it } from 'vitest';
import { sortErrors, validateMap } from '../src/validate';
import { validateStructural } from '../src/validate-structural';

// Structural phase only, sorted as validateMap does.
const errorsOf = (input: unknown) => sortErrors(validateStructural(input).errors);
const blockingOf = (input: unknown) => validateStructural(input).blocking;
const land = (id: number, owner: number, neighbors: number[]) => ({ id, owner, neighbors });
const sea = (id: number, neighbors: number[]) => ({ id, kind: 'sea', neighbors });

describe('structural validation of kinds', () => {
  it('FR-58 FR-64 kind "land" and "sea" entries are accepted; sea needs no owner', () => {
    const input = { territories: [{ ...land(1, 1, [3]), kind: 'land' }, land(2, 2, [3]), sea(3, [1, 2])] };
    expect(errorsOf(input)).toStrictEqual([]);
    expect(blockingOf(input)).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty text', ''],
    ['Sea', 'Sea'],
    ['LAND', 'LAND'],
    ['neutral', 'neutral'],
    ['a number', 1],
    ['true', true],
    ['a list', []],
    ['an object', {}],
  ])('FR-58 FR-66 a present kind of %s is invalid-kind and non-blocking', (_l, kind) => {
    const input = { territories: [{ ...land(5, 1, []), kind }] };
    expect(errorsOf(input)).toStrictEqual([{ kind: 'invalid-kind', position: 0, id: 5 }]);
    expect(blockingOf(input)).toBe(false);
  });

  it('FR-58 an inherited kind is ignored: the entry is land', () => {
    const e = Object.create({ kind: 'sea' }) as Record<string, unknown>;
    Object.assign(e, land(1, 1, []));
    expect(errorsOf({ territories: [e] })).toStrictEqual([]);
    const f = Object.create({ kind: 'bogus' }) as Record<string, unknown>;
    Object.assign(f, { id: 1, neighbors: [] });
    expect(errorsOf({ territories: [f] })).toStrictEqual([{ kind: 'missing-owner', position: 0, id: 1 }]);
  });

  it('FR-59 FR-65 land with kind "land" and no owner is missing-owner; a bad owner is invalid-owner', () => {
    const input = {
      territories: [
        { id: 1, kind: 'land', neighbors: [] },
        { id: 2, kind: 'land', owner: 0, neighbors: [] },
        { id: 3, kind: 'land', owner: null, neighbors: [] },
      ],
    };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'missing-owner', position: 0, id: 1 },
      { kind: 'missing-owner', position: 2, id: 3 },
      { kind: 'invalid-owner', position: 1, id: 2 },
    ]);
  });

  it('FR-59 FR-65 a sea zone never gets missing-owner or invalid-owner', () => {
    expect(errorsOf({ territories: [sea(1, [])] })).toStrictEqual([]);
  });

  it.each([
    ['a valid id', 3],
    ['null', null],
    ['undefined', undefined],
    ['an invalid id', 0],
    ['text', 'x'],
  ])('FR-67 a sea zone with an own owner of %s is only sea-owner and non-blocking', (_l, owner) => {
    const input = { territories: [{ ...sea(4, []), owner }] };
    expect(errorsOf(input)).toStrictEqual([{ kind: 'sea-owner', position: 0, id: 4 }]);
    expect(blockingOf(input)).toBe(false);
  });

  it('FR-67 an inherited owner on a sea zone is not sea-owner', () => {
    const e = Object.create({ owner: 3 }) as Record<string, unknown>;
    Object.assign(e, sea(1, []));
    expect(errorsOf({ territories: [e] })).toStrictEqual([]);
  });

  it('FR-66 an invalid-kind entry gets no owner check, whatever its owner', () => {
    const input = {
      territories: [
        { id: 1, kind: 'x', neighbors: [] },
        { id: 2, kind: 'x', owner: 0, neighbors: [] },
        { id: 3, kind: 'x', owner: 7, neighbors: [] },
        { id: 4, kind: 'x', owner: null, neighbors: [] },
      ],
    };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'invalid-kind', position: 0, id: 1 },
      { kind: 'invalid-kind', position: 1, id: 2 },
      { kind: 'invalid-kind', position: 2, id: 3 },
      { kind: 'invalid-kind', position: 3, id: 4 },
    ]);
  });

  it('FR-68 kind and owner are never unknown-field; other names are, on sea and invalid-kind too', () => {
    const input = {
      territories: [
        { ...sea(1, []), name: 'a' },
        { id: 2, kind: 'zzz', neighbors: [], name: 'b' },
        { ...land(3, 1, []), kind: 'land', name: 'c' },
        { ...sea(4, []), owner: 1 },
      ],
    };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'invalid-kind', position: 1, id: 2 },
      { kind: 'sea-owner', position: 3, id: 4 },
      { kind: 'unknown-field', location: { at: 'territory', position: 0, id: 1 }, field: 'name' },
      { kind: 'unknown-field', location: { at: 'territory', position: 1, id: 2 }, field: 'name' },
      { kind: 'unknown-field', location: { at: 'territory', position: 2, id: 3 }, field: 'name' },
    ]);
  });

  it.each([
    ['a missing id', { kind: 'sea', neighbors: [] }, { kind: 'invalid-territory-id', position: 0 }],
    ['an invalid id', { id: 0, kind: 'sea', neighbors: [] }, { kind: 'invalid-territory-id', position: 0 }],
    ['missing neighbors', { id: 1, kind: 'sea' }, { kind: 'invalid-neighbors', position: 0, id: 1 }],
    ['an invalid neighbor id', { id: 1, kind: 'sea', neighbors: [0] }, { kind: 'invalid-neighbors', position: 0, id: 1 }],
    ['a sparse neighbor list', { id: 1, kind: 'sea', neighbors: new Array(2) }, { kind: 'invalid-neighbors', position: 0, id: 1 }],
  ])('FR-61 a sea zone with %s is a blocking error', (_l, entry, expected) => {
    const input = { territories: [entry] };
    expect(errorsOf(input)).toStrictEqual([expected]);
    expect(blockingOf(input)).toBe(true);
  });

  it('FR-61 FR-66 an invalid-kind entry with a missing id also reports invalid-territory-id and invalid-kind', () => {
    const input = { territories: [{ kind: 'x', neighbors: [] }] };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'invalid-territory-id', position: 0 },
      { kind: 'invalid-kind', position: 0 },
    ]);
    expect(blockingOf(input)).toBe(true);
  });

  it('FR-61 FR-66 an invalid-kind entry with invalid neighbors also reports invalid-neighbors and invalid-kind', () => {
    const input = { territories: [{ id: 1, kind: 'x', neighbors: 'n' }] };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'invalid-neighbors', position: 0, id: 1 },
      { kind: 'invalid-kind', position: 0, id: 1 },
    ]);
    expect(blockingOf(input)).toBe(true);
  });

  it('FR-61 a land and a sea entry with the same id are duplicate-territory-id; so are invalid-kind entries', () => {
    expect(errorsOf({ territories: [land(1, 1, []), sea(1, [])] })).toStrictEqual([
      { kind: 'duplicate-territory-id', id: 1, positions: [0, 1] },
    ]);
    const input = { territories: [sea(2, []), { id: 2, kind: 'x', neighbors: [] }, sea(2, [])] };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'duplicate-territory-id', id: 2, positions: [0, 1, 2] },
      { kind: 'invalid-kind', position: 1, id: 2 },
    ]);
  });

  it('FR-61 a non-object element is invalid-territory whatever the surrounding kinds', () => {
    expect(errorsOf({ territories: [sea(1, []), 'sea', null] })).toStrictEqual([
      { kind: 'invalid-territory', position: 1 },
      { kind: 'invalid-territory', position: 2 },
    ]);
  });

  it('FR-64 invalid-kind and sea-owner never block: the relational phase still runs', () => {
    const input = {
      territories: [
        { id: 1, kind: 'x', neighbors: [9] },
        { ...sea(2, []), owner: 1 },
        land(3, 1, []),
      ],
    };
    expect(blockingOf(input)).toBe(false);
    const r = validateMap(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.kind)).toContain('unknown-neighbor');
  });

  it('FR-64 every structural kind at once, with sea and invalid kind: exact list and order', () => {
    const input = {
      version: 1,
      territories: [
        3,
        { kind: 'sea', neighbors: [] },
        { id: 1, kind: 'sea' },
        sea(2, []),
        sea(2, []),
        { id: 6, kind: 7, neighbors: [] },
        { id: 7, neighbors: [] },
        { id: 8, owner: 'y', neighbors: [] },
        { ...sea(9, []), owner: 1 },
        { ...land(10, 1, []), name: 'n' },
      ],
    };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'invalid-territory', position: 0 },
      { kind: 'invalid-territory-id', position: 1 },
      { kind: 'invalid-neighbors', position: 2, id: 1 },
      { kind: 'duplicate-territory-id', id: 2, positions: [3, 4] },
      { kind: 'invalid-kind', position: 5, id: 6 },
      { kind: 'missing-owner', position: 6, id: 7 },
      { kind: 'invalid-owner', position: 7, id: 8 },
      { kind: 'sea-owner', position: 8, id: 9 },
      { kind: 'unknown-field', location: { at: 'map' }, field: 'version' },
      { kind: 'unknown-field', location: { at: 'territory', position: 9, id: 10 }, field: 'name' },
    ]);
  });

  it('FR-64 errors of equal kind are ordered by position, mixing sea and invalid-kind entries', () => {
    const input = {
      territories: [
        { ...sea(1, []), owner: 1 },
        { id: 2, kind: null, neighbors: [] },
        { ...sea(3, []), owner: null },
        { id: 4, kind: 'q', neighbors: [] },
      ],
    };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'invalid-kind', position: 1, id: 2 },
      { kind: 'invalid-kind', position: 3, id: 4 },
      { kind: 'sea-owner', position: 0, id: 1 },
      { kind: 'sea-owner', position: 2, id: 3 },
    ]);
  });

  it('FR-64 FR-66 invalid-kind plus a blocking error elsewhere gives only structural errors', () => {
    const input = {
      territories: [
        { id: 1, kind: 'x', neighbors: [9] },
        { id: 2, owner: 1 },
      ],
    };
    const r = validateMap(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toStrictEqual([
        { kind: 'invalid-neighbors', position: 1, id: 2 },
        { kind: 'invalid-kind', position: 0, id: 1 },
      ]);
    }
  });

  it('NFR-8 a map without any kind field gets exactly the structural errors of the old rules', () => {
    const input = {
      territories: [land(1, 1, []), { id: 2, neighbors: [] }, { id: 3, owner: 'z', neighbors: [] }, { ...land(4, 1, []), name: 1 }],
    };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'missing-owner', position: 1, id: 2 },
      { kind: 'invalid-owner', position: 2, id: 3 },
      { kind: 'unknown-field', location: { at: 'territory', position: 3, id: 4 }, field: 'name' },
    ]);
  });

  it('NFR-8 (b) a kind field is no unknown-field, a sea zone has no missing-owner, its owner is sea-owner', () => {
    const input = { territories: [{ id: 1, kind: 'sea', neighbors: [] }, { id: 2, kind: 'sea', owner: 5, neighbors: [] }] };
    expect(errorsOf(input)).toStrictEqual([{ kind: 'sea-owner', position: 1, id: 2 }]);
  });

  it('FR-28 structural validation with sea and invalid-kind entries does not mutate its input', () => {
    const input = {
      version: 1,
      territories: [{ ...sea(1, [2]), owner: 3 }, { id: 2, kind: 'q', neighbors: [1] }, land(3, 1, [])],
    };
    const copy = structuredClone(input);
    validateMap(input);
    expect(input).toStrictEqual(copy);
  });
});

// Full validation (structural + relational), as validateMap returns it.
const fullErrors = (input: unknown) => {
  const r = validateMap(input);
  return r.ok ? [] : r.errors;
};

describe('relational validation with sea', () => {
  it('FR-66 an invalid-kind entry with unknown, self, duplicate and asymmetric links reports all in one pass', () => {
    const input = {
      territories: [land(1, 1, [2]), land(2, 2, [1]), { id: 3, kind: 'x', neighbors: [9, 3, 1, 1, 2] }],
    };
    expect(fullErrors(input)).toStrictEqual([
      { kind: 'invalid-kind', position: 2, id: 3 },
      { kind: 'unknown-neighbor', territory: 3, neighbor: 9 },
      { kind: 'self-neighbor', territory: 3 },
      { kind: 'duplicate-neighbor', territory: 3, neighbor: 1 },
      { kind: 'asymmetric-adjacency', from: 3, to: 1 },
      { kind: 'asymmetric-adjacency', from: 3, to: 2 },
      { kind: 'disconnected-map', groups: [[1, 2], [3]] },
    ]);
  });

  it('FR-66 invalid-kind plus a blocking error elsewhere gives only structural errors', () => {
    const input = { territories: [{ id: 1, kind: 'x', neighbors: [9] }, { id: 2, owner: 1, neighbors: 'n' }] };
    expect(fullErrors(input).map((e) => e.kind)).toStrictEqual(['invalid-neighbors', 'invalid-kind']);
  });

  it('FR-66 FR-71 an invalid-kind entry is the only bridge and still connects the map', () => {
    const input = { territories: [land(1, 1, [2]), { id: 2, kind: 'x', neighbors: [1, 3] }, land(3, 2, [2])] };
    expect(fullErrors(input)).toStrictEqual([{ kind: 'invalid-kind', position: 1, id: 2 }]);
  });

  it('FR-66 FR-70 owners on invalid-kind entries never count as factions', () => {
    const input = { territories: [land(1, 1, [2]), { id: 2, kind: 'x', owner: 2, neighbors: [1] }] };
    expect(fullErrors(input)).toStrictEqual([
      { kind: 'invalid-kind', position: 1, id: 2 },
      { kind: 'too-few-factions', count: 1 },
    ]);
  });

  it('FR-70 an owner on a sea zone is sea-owner and never counts as a faction', () => {
    const input = { territories: [land(1, 1, [2, 3]), land(2, 2, [1, 3]), { ...sea(3, [1, 2]), owner: 3 }] };
    expect(fullErrors(input)).toStrictEqual([{ kind: 'sea-owner', position: 2, id: 3 }]);
    const lone = { territories: [land(1, 1, [2]), { ...sea(2, [1]), owner: 3 }] };
    expect(fullErrors(lone)).toStrictEqual([
      { kind: 'sea-owner', position: 1, id: 2 },
      { kind: 'too-few-factions', count: 1 },
    ]);
  });

  it('FR-70 a map of only sea zones gives too-few-factions 0 and the sea groups', () => {
    const input = { territories: [sea(1, [2]), sea(2, [1]), sea(3, [])] };
    expect(fullErrors(input)).toStrictEqual([
      { kind: 'too-few-factions', count: 0 },
      { kind: 'disconnected-map', groups: [[1, 2], [3]] },
    ]);
    expect(fullErrors({ territories: [sea(1, [])] })).toStrictEqual([{ kind: 'too-few-factions', count: 0 }]);
  });

  it('FR-70 one faction with seas gives too-few-factions 1, a faction on two lands counts once', () => {
    const input = { territories: [land(1, 5, [3]), land(2, 5, [3]), sea(3, [1, 2])] };
    expect(fullErrors(input)).toStrictEqual([{ kind: 'too-few-factions', count: 1 }]);
  });

  it('FR-70 D4 an inherited owner is not a faction: it is only missing-owner', () => {
    const e = Object.create({ owner: 2 }) as Record<string, unknown>;
    Object.assign(e, { id: 2, neighbors: [1] });
    const input = { territories: [land(1, 1, [2]), e] };
    expect(fullErrors(input)).toStrictEqual([
      { kind: 'missing-owner', position: 1, id: 2 },
      { kind: 'too-few-factions', count: 1 },
    ]);
  });

  it('FR-71 FR-62 two islands joined only through a sea zone are connected', () => {
    const input = { territories: [land(1, 1, [3]), land(2, 2, [3]), sea(3, [1, 2])] };
    expect(validateMap(input).ok).toBe(true);
  });

  it('FR-71 FR-62 disconnected groups list sea ids in entry order; a lone sea zone is its own group', () => {
    const input = {
      territories: [land(1, 1, [3]), sea(5, []), land(2, 2, [3]), sea(3, [1, 2]), land(4, 3, [6]), sea(6, [4])],
    };
    expect(fullErrors(input)).toStrictEqual([{ kind: 'disconnected-map', groups: [[1, 2, 3], [5], [4, 6]] }]);
  });

  it('FR-71 a one-way land-sea link is asymmetric-adjacency and does not connect', () => {
    const input = { territories: [land(1, 1, [2]), sea(2, []), land(3, 2, [2])] };
    expect(fullErrors(input)).toStrictEqual([
      { kind: 'asymmetric-adjacency', from: 1, to: 2 },
      { kind: 'asymmetric-adjacency', from: 3, to: 2 },
      { kind: 'disconnected-map', groups: [[1], [2], [3]] },
    ]);
  });

  it('FR-62 moving a sea zone in the list changes only positions and group order', () => {
    const a = [land(1, 1, [3]), land(2, 2, [3]), sea(3, [1, 2]), land(4, 3, [])];
    const b = [sea(3, [1, 2]), land(1, 1, [3]), land(2, 2, [3]), land(4, 3, [])];
    expect(fullErrors({ territories: a })).toStrictEqual([{ kind: 'disconnected-map', groups: [[1, 2, 3], [4]] }]);
    expect(fullErrors({ territories: b })).toStrictEqual([{ kind: 'disconnected-map', groups: [[3, 1, 2], [4]] }]);
    const bad = [{ ...sea(3, [1, 2]), owner: 1 }, land(1, 1, [3]), land(2, 2, [])];
    const badMoved = [land(1, 1, [3]), land(2, 2, []), { ...sea(3, [1, 2]), owner: 1 }];
    expect(fullErrors({ territories: bad }).map((e) => e.kind)).toStrictEqual(
      fullErrors({ territories: badMoved }).map((e) => e.kind),
    );
  });

  it('FR-63 adding kind "land" to all or some entries gives identical results', () => {
    const maps: Array<{ territories: Array<Record<string, unknown>> }> = [
      { territories: [land(1, 1, [2]), land(2, 2, [1, 3]), sea(3, [2])] },
      { territories: [land(1, 1, [2, 9]), land(2, 1, [1]), land(3, 3, [])] },
      { territories: [{ id: 1, neighbors: [] }, land(2, 2, [1])] },
      { territories: [land(1, 1, [2]), land(2, 2, [1])] },
    ];
    for (const m of maps) {
      const some = { territories: m.territories.map((e, i) => (i === 0 && !('kind' in e) ? { ...e, kind: 'land' } : e)) };
      const all = { territories: m.territories.map((e) => ('kind' in e ? e : { ...e, kind: 'land' })) };
      expect(fullErrors(some)).toStrictEqual(fullErrors(m));
      expect(fullErrors(all)).toStrictEqual(fullErrors(m));
    }
  });

  const OLD_FIXTURES: Array<[string, unknown[], unknown[]]> = [
    ['valid', [land(1, 1, [2]), land(2, 2, [1])], []],
    ['one faction', [land(1, 5, [2]), land(2, 5, [1])], [{ kind: 'too-few-factions', count: 1 }]],
    [
      'one way',
      [land(1, 1, [2]), land(2, 2, [])],
      [
        { kind: 'asymmetric-adjacency', from: 1, to: 2 },
        { kind: 'disconnected-map', groups: [[1], [2]] },
      ],
    ],
    [
      'unknown and self',
      [land(1, 1, [1, 9]), land(2, 2, [])],
      [
        { kind: 'unknown-neighbor', territory: 1, neighbor: 9 },
        { kind: 'self-neighbor', territory: 1 },
        { kind: 'disconnected-map', groups: [[1], [2]] },
      ],
    ],
    ['multi-territory faction', [land(1, 7, [2]), land(2, 8, [1, 3]), land(3, 7, [2])], []],
  ];
  it.each(OLD_FIXTURES)('NFR-8 (a) the 001 fixture "%s" (no kind field) gives the same errors', (_l, entries, expected) => {
    expect(fullErrors({ territories: entries })).toStrictEqual(expected);
  });

  it('NFR-8 (b) the only differences from 001: kind accepted, sea needs no owner, factions are land owners', () => {
    expect(validateMap({ territories: [land(1, 1, [3]), land(2, 2, [3]), sea(3, [1, 2])] }).ok).toBe(true);
    const lone = { territories: [land(1, 1, [2]), { ...sea(2, [1]), owner: 2 }] };
    expect(fullErrors(lone).map((e) => e.kind)).toStrictEqual(['sea-owner', 'too-few-factions']);
  });

  it('FR-28 relational validation with sea and invalid-kind entries does not mutate its input', () => {
    const input = {
      territories: [land(1, 1, [3, 9]), land(2, 2, [3]), sea(3, [1, 2]), { id: 4, kind: 'q', neighbors: [1] }],
    };
    const copy = structuredClone(input);
    validateMap(input);
    expect(input).toStrictEqual(copy);
  });
});
