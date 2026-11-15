import { describe, expect, it } from 'vitest';
import { validateMap } from '../src/validate';

const t = (id: number, owner: number | null, neighbors: unknown[]) => ({ id, owner, neighbors });

const errorsOf = (input: unknown) => {
  const r = validateMap(input);
  return r.ok ? [] : r.errors;
};

describe('relational validation', () => {
  it('FR-21 unknown neighbor gives unknown-neighbor and no asymmetric-adjacency', () => {
    const input = { territories: [t(1, 1, [2, 9]), t(2, 2, [1])] };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'unknown-neighbor', territory: 1, neighbor: 9 },
    ]);
  });

  it('FR-21 an unknown id repeated gives unknown-neighbor and duplicate-neighbor', () => {
    const input = { territories: [t(1, 1, [2, 9, 9]), t(2, 2, [1])] };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'unknown-neighbor', territory: 1, neighbor: 9 },
      { kind: 'duplicate-neighbor', territory: 1, neighbor: 9 },
    ]);
  });

  it('FR-22 a territory listing itself gives self-neighbor once', () => {
    const input = { territories: [t(1, 1, [2, 1]), t(2, 2, [1])] };
    expect(errorsOf(input)).toStrictEqual([{ kind: 'self-neighbor', territory: 1 }]);
  });

  it('FR-22 FR-23 a self-link listed twice gives self-neighbor once plus duplicate-neighbor once', () => {
    const input = { territories: [t(1, 1, [1, 2, 1]), t(2, 2, [1])] };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'self-neighbor', territory: 1 },
      { kind: 'duplicate-neighbor', territory: 1, neighbor: 1 },
    ]);
  });

  it('FR-23 a repeated neighbor gives one duplicate-neighbor per repeated id, never deduplicated', () => {
    const input = {
      territories: [t(1, 1, [2, 3, 2, 3, 2]), t(2, 2, [1]), t(3, 3, [1])],
    };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'duplicate-neighbor', territory: 1, neighbor: 2 },
      { kind: 'duplicate-neighbor', territory: 1, neighbor: 3 },
    ]);
    expect(input.territories[0]?.neighbors).toStrictEqual([2, 3, 2, 3, 2]);
  });

  it('FR-24 a one-way link gives asymmetric-adjacency for the listing territory', () => {
    const input = { territories: [t(1, 1, [2]), t(2, 2, [3]), t(3, 3, [2])] };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'asymmetric-adjacency', from: 1, to: 2 },
      { kind: 'disconnected-map', groups: [[1], [2, 3]] },
    ]);
  });

  it('FR-24 a repeated one-way link gives a single asymmetric-adjacency', () => {
    const input = { territories: [t(1, 1, [2, 3, 2]), t(2, 2, []), t(3, 3, [1])] };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'duplicate-neighbor', territory: 1, neighbor: 2 },
      { kind: 'asymmetric-adjacency', from: 1, to: 2 },
      { kind: 'disconnected-map', groups: [[1, 3], [2]] },
    ]);
  });

  it('FR-24 FR-27 edge case: A lists B only, map of A and B gives asymmetric plus disconnected [[A],[B]]', () => {
    const input = { territories: [t(1, 1, [2]), t(2, 2, [])] };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'asymmetric-adjacency', from: 1, to: 2 },
      { kind: 'disconnected-map', groups: [[1], [2]] },
    ]);
  });

  it('FR-60 FR-69 a faction owning several territories is valid: no multiple-initial-territories error', () => {
    const input = {
      territories: [t(1, 7, [2, 3]), t(2, 8, [1, 3]), t(3, 7, [1, 2]), t(4, 8, [3])],
    };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'asymmetric-adjacency', from: 4, to: 3 },
      { kind: 'disconnected-map', groups: [[1, 2, 3], [4]] },
    ]);
  });

  it('FR-70 FR-69 all territories owned by one faction gives only too-few-factions 1', () => {
    const input = { territories: [t(1, 5, [2]), t(2, 5, [1])] };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'too-few-factions', count: 1 },
    ]);
  });

  it('FR-26 an empty territory list gives only too-few-factions 0', () => {
    expect(errorsOf({ territories: [] })).toStrictEqual([{ kind: 'too-few-factions', count: 0 }]);
  });

  it('FR-26 FR-27 a single territory gives only too-few-factions 1', () => {
    expect(errorsOf({ territories: [t(1, 1, [])] })).toStrictEqual([
      { kind: 'too-few-factions', count: 1 },
    ]);
  });

  it('FR-26 territories with missing or invalid owner do not count as factions', () => {
    const input = {
      territories: [
        t(1, 1, [2, 3]),
        { id: 2, neighbors: [1, 3] },
        { id: 3, owner: 0, neighbors: [1, 2] },
      ],
    };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'missing-owner', position: 1, id: 2 },
      { kind: 'invalid-owner', position: 2, id: 3 },
      { kind: 'too-few-factions', count: 1 },
    ]);
  });

  it('FR-27 an empty neighbor list in a map of 2+ territories forms its own group', () => {
    const input = { territories: [t(1, 1, [2]), t(2, 2, [1]), t(3, 3, [])] };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'disconnected-map', groups: [[1, 2], [3]] },
    ]);
  });

  it('FR-27 a map split into 3 groups gives one disconnected-map listing every group with all ids', () => {
    const input = {
      territories: [
        t(10, 1, [11]),
        t(20, 2, [21]),
        t(11, 3, [10]),
        t(30, 4, []),
        t(21, 5, [20, 22]),
        t(22, 6, [21]),
      ],
    };
    expect(errorsOf(input)).toStrictEqual([
      {
        kind: 'disconnected-map',
        groups: [[10, 11], [20, 21, 22], [30]],
      },
    ]);
  });

  it('FR-27 unknown ids and self-links do not connect territories', () => {
    const input = { territories: [t(1, 1, [1, 9]), t(2, 2, [])] };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'unknown-neighbor', territory: 1, neighbor: 9 },
      { kind: 'self-neighbor', territory: 1 },
      { kind: 'disconnected-map', groups: [[1], [2]] },
    ]);
  });

  it('FR-8 a faction id equal to a territory id is valid', () => {
    const input = { territories: [t(1, 2, [2]), t(2, 1, [1])] };
    expect(validateMap(input).ok).toBe(true);
  });

  it('FR-5 FR-59 a valid map (one territory per faction, mutual links, connected) is accepted as the same object', () => {
    const input = { territories: [t(1, 1, [2]), t(2, 2, [1, 3]), t(3, 3, [2])] };
    const r = validateMap(input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(input);
  });

  it('FR-7 map order is part of the input: errors follow territory and neighbor-list order', () => {
    const a = { territories: [t(1, 1, [3, 2]), t(2, 2, []), t(3, 3, [])] };
    const b = { territories: [t(3, 3, []), t(2, 2, []), t(1, 1, [3, 2])] };
    expect(errorsOf(a)).toStrictEqual([
      { kind: 'asymmetric-adjacency', from: 1, to: 3 },
      { kind: 'asymmetric-adjacency', from: 1, to: 2 },
      { kind: 'disconnected-map', groups: [[1], [2], [3]] },
    ]);
    expect(errorsOf(b)).toStrictEqual([
      { kind: 'asymmetric-adjacency', from: 1, to: 3 },
      { kind: 'asymmetric-adjacency', from: 1, to: 2 },
      { kind: 'disconnected-map', groups: [[3], [2], [1]] },
    ]);
  });

  it('FR-9 FR-11 non-blocking structural errors are merged with relational ones in FR-10 order', () => {
    const input = {
      territories: [
        { id: 1, neighbors: [2], name: 'x' },
        t(2, 2, []),
      ],
    };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'missing-owner', position: 0, id: 1 },
      { kind: 'unknown-field', location: { at: 'territory', position: 0, id: 1 }, field: 'name' },
      { kind: 'asymmetric-adjacency', from: 1, to: 2 },
      { kind: 'too-few-factions', count: 1 },
      { kind: 'disconnected-map', groups: [[1], [2]] },
    ]);
  });

  it('FR-9 a blocking structural error stops the relational phase (duplicate id)', () => {
    const input = { territories: [t(1, 1, [9, 1]), t(1, 1, [])] };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'duplicate-territory-id', id: 1, positions: [0, 1] },
    ]);
  });

  it.each([
    ['invalid-territory', { territories: [t(1, 1, [9]), 5] }, [{ kind: 'invalid-territory', position: 1 }]],
    [
      'invalid-neighbors',
      { territories: [t(1, 1, [9]), { id: 2, owner: 1, neighbors: 'x' }] },
      [{ kind: 'invalid-neighbors', position: 1, id: 2 }],
    ],
    [
      'invalid-territory-id',
      { territories: [t(1, 1, [9]), { owner: 1, neighbors: [] }] },
      [{ kind: 'invalid-territory-id', position: 1 }],
    ],
    ['invalid-territories', { territories: 'x' }, [{ kind: 'invalid-territories' }]],
  ])('FR-9 blocking %s stops the relational phase', (_l, input, expected) => {
    expect(errorsOf(input)).toStrictEqual(expected);
  });

  it('FR-9 FR-11 FR-21..FR-27 FR-64 every relational kind at once: exact list and order', () => {
    const input = {
      territories: [
        t(1, 1, [2, 99, 1, 2, 3]), // unknown 99, self, duplicate 2, one-way to 3
        t(2, 1, [1, 3]), // one-way to 3
        t(3, 1, []),
        t(4, 1, [98]), // unknown 98
      ],
    };
    expect(errorsOf(input)).toStrictEqual([
      { kind: 'unknown-neighbor', territory: 1, neighbor: 99 },
      { kind: 'unknown-neighbor', territory: 4, neighbor: 98 },
      { kind: 'self-neighbor', territory: 1 },
      { kind: 'duplicate-neighbor', territory: 1, neighbor: 2 },
      { kind: 'asymmetric-adjacency', from: 1, to: 3 },
      { kind: 'asymmetric-adjacency', from: 2, to: 3 },
      { kind: 'too-few-factions', count: 1 },
      { kind: 'disconnected-map', groups: [[1, 2], [3], [4]] },
    ]);
  });

  it('FR-28 relational validation never mutates the input', () => {
    const input = { territories: [t(1, 1, [2, 9, 1, 2]), t(2, 1, [3]), t(3, 1, [])] };
    const before = structuredClone(input);
    validateMap(input);
    expect(input).toStrictEqual(before);
  });
});
