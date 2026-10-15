import { contactPairs, validateMap } from '@mbrg/shared';
import { describe, expect, it } from 'vitest';
import { buildMapData } from '../src/core/adjacency';
import type { NumberedPlan } from '../src/core/types';

function plan(land: [id: number, owner: number][], sea: number[] = []): NumberedPlan {
  return {
    factions: [...new Set(land.map(([, owner]) => owner))].map((id) => ({ id, country: `C${id}` })),
    land: land.map(([id, owner]) => ({
      id,
      key: `t${id}`,
      country: `C${owner}`,
      owner,
      provinces: [`p${id}`],
    })),
    sea: sea.map((id, i) => ({ id, seed: i, name: `mar ${id}` })),
  };
}

function grid(width: number, rows: number[][]): Uint32Array {
  const out = new Uint32Array(width * width);
  rows.forEach((row, y) => row.forEach((v, x) => (out[y * width + x] = v)));
  return out;
}

describe('FR-118 adjacency from contact', () => {
  // Land 1 (faction 1), 2 and 3 (faction 2), sea 4 and 5; 0 = background.
  const width = 5;
  const pixels = grid(width, [
    [1, 1, 2, 2, 0],
    [1, 1, 2, 2, 0],
    [0, 0, 0, 3, 3],
    [4, 4, 0, 3, 3],
    [4, 4, 5, 5, 5],
  ]);
  const entries = plan(
    [
      [1, 1],
      [2, 2],
      [3, 2],
    ],
    [4, 5],
  );

  it('FR-118 every link equals a pair of 4-adjacent pixels (land and sea zones)', () => {
    const map = buildMapData(width, pixels, entries);
    const pairs = contactPairs(width, width, pixels);
    expect(pairs.ok).toBe(true);
    const fromMap: [number, number][] = [];
    for (const entry of map.territories) {
      for (const n of entry.neighbors) if (entry.id < n) fromMap.push([entry.id, n]);
    }
    expect(fromMap).toStrictEqual(pairs.ok ? pairs.value : []);
    expect(fromMap).toStrictEqual([
      [1, 2],
      [2, 3],
      [3, 5],
      [4, 5],
    ]);
  });

  it('FR-118 a corner-only touch is not a link', () => {
    // 1 and 3 touch only by the corner (1,1)-(2,2) diagonal; 4 and 3 touch only by corners.
    const map = buildMapData(width, pixels, entries);
    const byId = new Map(map.territories.map((e) => [e.id, e.neighbors]));
    expect(byId.get(1)).toStrictEqual([2]);
    expect(byId.get(4)).toStrictEqual([5]);
  });

  it('FR-118 entries are in map order with land before sea, owners kept, and sea zones typed', () => {
    const map = buildMapData(width, pixels, entries);
    expect(map).toStrictEqual({
      territories: [
        { id: 1, owner: 1, neighbors: [2] },
        { id: 2, owner: 2, neighbors: [1, 3] },
        { id: 3, owner: 2, neighbors: [2, 5] },
        { id: 4, kind: 'sea', neighbors: [5] },
        { id: 5, kind: 'sea', neighbors: [3, 4] },
      ],
    });
  });

  it('FR-118 neighbour lists are in ascending map order', () => {
    // Entry 5 touches 2, 7 and 3: its list must be [2, 3, 7].
    const w = 4;
    const p = grid(w, [
      [2, 5, 5, 7],
      [2, 5, 5, 7],
      [3, 3, 0, 0],
      [3, 3, 0, 0],
    ]);
    const map = buildMapData(w, p, plan([[2, 1], [3, 1], [5, 1], [7, 1]]));
    expect(map.territories.find((e) => e.id === 5)!.neighbors).toStrictEqual([2, 3, 7]);
    for (const e of map.territories) expect(e.neighbors).toStrictEqual([...e.neighbors].sort((a, b) => a - b));
  });

  it('FR-118 an entry with no contact has an empty list and no link is added by hand', () => {
    // Entries 1 and 2 are separated by background and by one pixel gap: no link, even though
    // their ids are consecutive and they share a faction.
    const w = 5;
    const p = grid(w, [
      [1, 1, 0, 2, 2],
      [1, 1, 0, 2, 2],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 3],
      [0, 0, 0, 0, 0],
    ]);
    const map = buildMapData(w, p, plan([[1, 1], [2, 1], [3, 1]]));
    expect(map.territories.map((e) => e.neighbors)).toStrictEqual([[], [], []]);
  });

  it('FR-118 the same contact gives the same links when the image is rebuilt (deterministic)', () => {
    expect(buildMapData(width, pixels, entries)).toStrictEqual(buildMapData(width, pixels, entries));
  });

  it('FR-118 the derived map passes map validation (links symmetric, no self links)', () => {
    const map = buildMapData(width, pixels, entries);
    expect(validateMap(map)).toStrictEqual({ ok: true, value: map });
  });

  it('FR-118 on generated images every link equals contact and nothing else', () => {
    let seed = 12345;
    const next = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed >>> 8;
    };
    const w = 12;
    for (let run = 0; run < 25; run++) {
      const p = new Uint32Array(w * w);
      for (let i = 0; i < p.length; i++) p[i] = next() % 6; // 0 background, 1..5
      const map = buildMapData(w, p, plan([[1, 1], [2, 1], [3, 2]], [4, 5]));
      const pairs = contactPairs(w, w, p);
      const expected = new Map<number, number[]>();
      for (const id of [1, 2, 3, 4, 5]) expected.set(id, []);
      if (pairs.ok) {
        for (const [a, b] of pairs.value) {
          expected.get(a)!.push(b);
          expected.get(b)!.push(a);
        }
      }
      for (const e of map.territories) {
        expect(e.neighbors).toStrictEqual(expected.get(e.id)!.sort((a, b) => a - b));
      }
    }
  });
});
