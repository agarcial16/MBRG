import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import { buildEntryIndex, factionIndexOf, ownerTable } from '../src/core/entries';
import type { EntryIndex } from '../src/core/entries';
import { contactSet, frontAt, frontField, seedSet, transferredPieces } from '../src/core/front';
import { decodeIdPng } from '../src/core/png';
import { buildPieceIndex } from '../src/core/regions';
import type { PieceIndex } from '../src/core/regions';
import { sceneAt } from '../src/core/scene';
import type { SimPort } from '../src/core/scene';
import { inflateStream } from '../src/ui/load';
import { DEV_MAP, DEV_PRESENTATION, devPngBytes } from './helpers/dev-map';
import { gridFrom, randomGrid, rng } from './helpers/label-grids';
import type { IndexGrid } from '../src/core/borders';

const KINDS = { 1: 'land', 2: 'land', 3: 'land', 4: 'land', 5: 'land', 6: 'sea' } as const;
const f32 = Math.fround;

/** Owner table from a list indexed by entry (entry 0 first). */
const owners = (...perEntry: number[]): number[] => perEntry;

describe('FR-179 transferred pieces, contact set and seed set', () => {
  // entry 1 = absorber (owner 1), entries 2 and 3 = transferred (owner 2), entry 4 = third faction.
  const grid = gridFrom(
    [
      [1, 1, 2, 2, 3, 3, 4],
      [1, 1, 2, 2, 3, 3, 4],
      [6, 6, 6, 2, 3, 6, 4],
    ],
    KINDS,
  );
  const p = buildPieceIndex(grid);
  const before = owners(0, 1, 2, 2, 3, 0);

  it('FR-179 a transferred piece is a connected set of transferred entries, so it may span several entries', () => {
    expect(transferredPieces(p, new Set([2, 3]))).toStrictEqual([[1, 2]]);
  });

  it('FR-179 two transferred entries that do not touch are two pieces, ordered by their first unit', () => {
    const apart = buildPieceIndex(gridFrom([[2, 6, 3, 6, 2]], KINDS));
    expect(transferredPieces(apart, new Set([2, 3]))).toStrictEqual([[0], [1], [2]]);
  });

  it('FR-179 no transferred entry gives no piece', () => {
    expect(transferredPieces(p, new Set())).toStrictEqual([]);
  });

  it('FR-179 the contact set is the units of the piece next to a land unit of the absorber at the earlier state', () => {
    const [component] = transferredPieces(p, new Set([2, 3]));
    // units 2 (row 0) and 9 (row 1) touch entry 1; (3,2) touches sea and entry 4 owned by owner 3: not contact
    expect(Array.from(contactSet(p, component!, before, 1))).toStrictEqual([2, 9]);
  });

  it('FR-179 a neighbour of the third faction does not count as contact', () => {
    const [component] = transferredPieces(p, new Set([2, 3]));
    expect(Array.from(contactSet(p, component!, before, 3))).toStrictEqual([5, 12]);
  });

  it('FR-179 the seed set is the contact set when it is not empty', () => {
    const [component] = transferredPieces(p, new Set([2, 3]));
    expect(Array.from(seedSet(p, component!, before, 1))).toStrictEqual([2, 9]);
  });

  it('FR-179 with no contact the seed set is every unit at the minimum squared distance to the absorber land', () => {
    // absorber land is the unit (0,0); the sea separates it from the piece
    const far = buildPieceIndex(gridFrom([[1, 6, 2, 2], [6, 6, 2, 2]], KINDS));
    const [component] = transferredPieces(far, new Set([2]));
    expect(Array.from(contactSet(far, component!, owners(0, 1, 2), 1))).toStrictEqual([]);
    expect(Array.from(seedSet(far, component!, owners(0, 1, 2), 1))).toStrictEqual([2]);
  });

  it('FR-179 several units at the same minimum distance are all in the seed set', () => {
    const far = buildPieceIndex(gridFrom([[1, 1, 6, 6, 2, 2], [1, 1, 6, 6, 2, 2]], KINDS));
    const [component] = transferredPieces(far, new Set([2]));
    expect(Array.from(seedSet(far, component!, owners(0, 1, 2), 1))).toStrictEqual([4, 10]);
  });

  it('FR-179 an absorber with no land at the earlier state is an error', () => {
    const [component] = transferredPieces(p, new Set([2, 3]));
    expect(() => seedSet(p, component!, before, 5)).toThrow(RangeError);
  });
});

describe('FR-179 FR-189 the front distances', () => {
  it('FR-179 distances count 4-adjacent steps from the contact units and are divided by the largest of the piece', () => {
    const p = buildPieceIndex(gridFrom([[1, 1, 2, 2, 2, 2], [1, 1, 2, 2, 2, 2]], KINDS));
    const field = frontField(p, new Set([2]), owners(0, 1, 2), 1);
    expect([field.x0, field.y0, field.width, field.height]).toStrictEqual([2, 0, 4, 2]);
    expect(Array.from(field.values)).toStrictEqual([0, f32(1 / 3), f32(2 / 3), 1, 0, f32(1 / 3), f32(2 / 3), 1]);
    expect(field.values).toBeInstanceOf(Float32Array);
  });

  it('FR-179 steps stay inside the piece: a detour around a hole counts the extra steps', () => {
    // piece is a ring-shaped corridor: contact at the top-left, the far end is reached around the wall
    const p = buildPieceIndex(gridFrom([[1, 2, 2, 2], [6, 6, 6, 2], [6, 2, 2, 2]], KINDS));
    const field = frontField(p, new Set([2]), owners(0, 1, 2), 1);
    // path (1,0) (2,0) (3,0) (3,1) (3,2) (2,2) (1,2): distances 0..6
    const at = (x: number, y: number): number => frontAt(field, x, y);
    expect(at(1, 0)).toBe(0);
    expect(at(3, 1)).toBe(f32(3 / 6));
    expect(at(1, 2)).toBe(1);
  });

  it('FR-179 each piece is normalised by its own largest distance, not by the largest of all pieces', () => {
    // piece one has distances 0..3, piece two (separate) has distances 0..1
    const p = buildPieceIndex(gridFrom([[1, 2, 2, 2, 2, 6, 1, 3, 3]], KINDS));
    const field = frontField(p, new Set([2, 3]), owners(0, 1, 2, 3), 1);
    expect([1, 2, 3, 4].map((x) => frontAt(field, x, 0))).toStrictEqual([0, f32(1 / 3), f32(2 / 3), 1]);
    expect([7, 8].map((x) => frontAt(field, x, 0))).toStrictEqual([0, 1]);
  });

  it('FR-179 every piece reaches 1 at its farthest unit, so all finish together', () => {
    const p = buildPieceIndex(gridFrom([[1, 2, 2, 2, 6, 6, 1, 3, 3, 3, 3, 3]], KINDS));
    const field = frontField(p, new Set([2, 3]), owners(0, 1, 2, 3), 1);
    expect(frontAt(field, 3, 0)).toBe(1);
    expect(frontAt(field, 11, 0)).toBe(1);
    expect(frontAt(field, 1, 0)).toBe(0);
    expect(frontAt(field, 7, 0)).toBe(0);
  });

  it('FR-179 a piece of one unit has distance 0, normalised 0', () => {
    const p = buildPieceIndex(gridFrom([[1, 2, 6]], KINDS));
    const field = frontField(p, new Set([2]), owners(0, 1, 2), 1);
    expect(Array.from(field.values)).toStrictEqual([0]);
    expect([field.width, field.height]).toStrictEqual([1, 1]);
  });

  it('FR-179 one piece over several transferred entries is crossed by the front without a break', () => {
    const p = buildPieceIndex(gridFrom([[1, 2, 2, 3, 3, 3]], KINDS));
    const field = frontField(p, new Set([2, 3]), owners(0, 1, 2, 2), 1);
    expect(Array.from(field.values)).toStrictEqual([0, f32(1 / 4), f32(2 / 4), f32(3 / 4), 1]);
  });

  it('FR-179 the box covers the transferred pieces and holds -1 outside them', () => {
    const p = buildPieceIndex(gridFrom([[2, 6, 1, 6, 3], [6, 6, 6, 6, 6]], KINDS));
    const field = frontField(p, new Set([2, 3]), owners(0, 1, 2, 3), 1);
    expect([field.x0, field.y0, field.width, field.height]).toStrictEqual([0, 0, 5, 1]);
    expect(Array.from(field.values).map((v) => v >= 0)).toStrictEqual([true, false, false, false, true]);
    expect(frontAt(field, 1, 0)).toBe(-1);
    expect(frontAt(field, 9, 9)).toBe(-1);
    expect(frontAt(field, -1, 0)).toBe(-1);
  });

  it('FR-179 no transferred entry gives an empty field', () => {
    const p = buildPieceIndex(gridFrom([[1, 2]], KINDS));
    const field = frontField(p, new Set(), owners(0, 1, 2), 1);
    expect(field.values).toHaveLength(0);
    expect(frontAt(field, 0, 0)).toBe(-1);
  });
});

/** The rule of the spec written the slow way: relaxation to a fixed point, all pairs for the seed set. */
function naiveField(grid: IndexGrid, before: number[], transferred: Set<number>, absorber: number): Map<number, number> {
  const { width, height, cells, fills } = grid;
  const land = (u: number): boolean => fills[cells[u]!] === 'land';
  const moving = (u: number): boolean => transferred.has(cells[u]!);
  const neighbours = (u: number): number[] => {
    const x = u % width;
    const y = (u - x) / width;
    const out: number[] = [];
    if (x > 0) out.push(u - 1);
    if (x < width - 1) out.push(u + 1);
    if (y > 0) out.push(u - width);
    if (y < height - 1) out.push(u + width);
    return out;
  };
  // component labels by smallest unit
  const label = new Map<number, number>();
  for (let u = 0; u < width * height; u++) if (moving(u)) label.set(u, u);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [u, l] of label) {
      for (const v of neighbours(u)) {
        const lv = label.get(v);
        if (lv !== undefined && lv < l) {
          label.set(u, lv);
          changed = true;
        }
      }
    }
  }
  const absorberUnits: number[] = [];
  for (let u = 0; u < width * height; u++) if (land(u) && before[cells[u]!] === absorber) absorberUnits.push(u);
  const result = new Map<number, number>();
  const groups = new Map<number, number[]>();
  for (const [u, l] of label) groups.set(l, [...(groups.get(l) ?? []), u]);
  for (const units of groups.values()) {
    let seeds = units.filter((u) => neighbours(u).some((v) => land(v) && before[cells[v]!] === absorber));
    if (seeds.length === 0) {
      const d2 = (a: number, b: number): number => ((a % width) - (b % width)) ** 2 + (Math.floor(a / width) - Math.floor(b / width)) ** 2;
      let best = Infinity;
      for (const u of units) for (const a of absorberUnits) best = Math.min(best, d2(u, a));
      seeds = units.filter((u) => absorberUnits.some((a) => d2(u, a) === best));
    }
    const dist = new Map<number, number>(units.map((u) => [u, seeds.includes(u) ? 0 : Infinity]));
    for (let changed = true; changed; ) {
      changed = false;
      for (const u of units) {
        for (const v of neighbours(u)) {
          const dv = dist.get(v);
          if (dv !== undefined && dv + 1 < dist.get(u)!) {
            dist.set(u, dv + 1);
            changed = true;
          }
        }
      }
    }
    const max = Math.max(...dist.values());
    for (const [u, d] of dist) result.set(u, max === 0 ? 0 : f32(d / max));
  }
  return result;
}

describe('FR-179 FR-189 the front equals the naive rule', () => {
  it('FR-179 the field equals the relaxation and all-pairs rule on random grids, with and without contact', () => {
    let withoutContact = 0;
    let trials = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const grid = randomGrid(14, 11, 6, seed);
      const p = buildPieceIndex(grid);
      for (let moved = 1; moved <= 5; moved++) {
        for (let absorber = 1; absorber <= 5; absorber++) {
          if (absorber === moved) continue;
          // entry `moved` (and entry moved % 5 + 1 when it differs from the absorber) go to the absorber
          const transferred = new Set([moved]);
          const table = [0, 0, 0, 0, 0, 0, 0];
          table[moved] = 9;
          table[absorber] = 1;
          const component = transferredPieces(p, transferred);
          if (component.length === 0 || !p.entryOf.includes(absorber)) continue;
          trials++;
          const field = frontField(p, transferred, table, 1);
          const expected = naiveField(grid, table, transferred, 1);
          const actual: number[] = [];
          const wanted: number[] = [];
          for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x++) {
              actual.push(frontAt(field, x, y));
              wanted.push(expected.get(y * grid.width + x) ?? -1);
            }
          }
          expect(actual, `seed ${seed} moved ${moved} absorber ${absorber}`).toStrictEqual(wanted);
          if (component.some((c) => contactSet(p, c, table, 1).length === 0)) withoutContact++;
        }
      }
    }
    expect(trials).toBeGreaterThan(100);
    expect(withoutContact).toBeGreaterThan(10);
  });
});

describe('NFR-33 FR-189 the front is deterministic and needs no clock or randomness', () => {
  it('NFR-33 the same inputs give the same field with Math.random, Date.now and performance.now throwing', () => {
    const p = buildPieceIndex(gridFrom([[1, 6, 2, 2, 2], [1, 6, 2, 3, 3]], KINDS));
    const table = owners(0, 1, 2, 2);
    const first = frontField(p, new Set([2, 3]), table, 1);
    const boom = (): never => {
      throw new Error('ambient state read');
    };
    const spies = [vi.spyOn(Math, 'random').mockImplementation(boom), vi.spyOn(Date, 'now').mockImplementation(boom), vi.spyOn(performance, 'now').mockImplementation(boom)];
    try {
      expect(frontField(p, new Set([2, 3]), table, 1)).toStrictEqual(first);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('FR-179 the seed set search across distant buckets', () => {
  // Blobs far apart (several search buckets): entry 1 is the absorber (two blobs), entries 2 and 3 move.
  const box = (x: number, y: number, x0: number, y0: number, x1: number, y1: number): boolean => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const grid = gridFrom(
    Array.from({ length: 300 }, (_, y) =>
      Array.from({ length: 300 }, (_, x) => {
        if (box(x, y, 10, 10, 40, 40) || box(x, y, 100, 270, 125, 290)) return 1;
        if (box(x, y, 200, 150, 260, 230)) return 2;
        if (box(x, y, 250, 20, 280, 60) || box(x, y, 285, 100, 289, 103)) return 3;
        return 6;
      }),
    ),
    KINDS,
  );

  it('FR-179 the field equals the naive all-pairs rule when the nearest absorber unit is several buckets away', () => {
    const p = buildPieceIndex(grid);
    const before = [0, 1, 2, 2, 0, 0, 0];
    const field = frontField(p, new Set([2, 3]), before, 1);
    const expected = naiveField(grid, before, new Set([2, 3]), 1);
    const actual: number[] = [];
    const wanted: number[] = [];
    for (let y = 0; y < 300; y++) {
      for (let x = 0; x < 300; x++) {
        actual.push(frontAt(field, x, y));
        wanted.push(expected.get(y * 300 + x) ?? -1);
      }
    }
    expect(actual).toStrictEqual(wanted);
    const [first] = transferredPieces(p, new Set([2, 3]));
    expect(contactSet(p, first!, before, 1)).toHaveLength(0);
    expect(seedSet(p, first!, before, 1).length).toBeGreaterThan(0);
  });
});

describe('FR-179 equally near absorber units in different buckets', () => {
  it('FR-179 two seeds at the same distance both stay when the second one lies exactly on the edge of another bucket', () => {
    // Strip of entry 2 at x = 120, y = 90..110. Absorber units at (112, 90) and (128, 100): the strip units
    // (120, 90) and (120, 100) are both at squared distance 64; the bucket of (128, 100) starts at x = 128.
    const grid = gridFrom(
      Array.from({ length: 200 }, (_, y) =>
        Array.from({ length: 200 }, (_, x) => {
          if ((x === 112 && y === 90) || (x === 128 && y === 100)) return 1;
          if (x === 120 && y >= 90 && y <= 110) return 2;
          return 6;
        }),
      ),
      KINDS,
    );
    const p = buildPieceIndex(grid);
    const [component] = transferredPieces(p, new Set([2]));
    expect(Array.from(seedSet(p, component!, [0, 1, 2, 0, 0, 0, 0], 1))).toStrictEqual([90 * 200 + 120, 100 * 200 + 120]);
  });
});

describe('FR-179 the seed set on random scenes spread over many buckets', () => {
  it('FR-179 seedSet equals the contact rule, then the all-pairs minimum, on 40 random scenes of 420 x 300 units', () => {
    const next = rng(77);
    const int = (n: number): number => Math.floor(next() * n);
    let farScenes = 0;
    for (let scene = 0; scene < 40; scene++) {
      const rects: { entry: number; x0: number; y0: number; x1: number; y1: number }[] = [];
      for (let i = 0; i < 4 + int(3); i++) {
        const x0 = int(400);
        const y0 = int(280);
        rects.push({ entry: i === 0 ? 2 : 1, x0, y0, x1: Math.min(419, x0 + int(18)), y1: Math.min(299, y0 + int(18)) });
      }
      const grid = gridFrom(
        Array.from({ length: 300 }, (_, y) =>
          Array.from({ length: 420 }, (_, x) => {
            for (const r of rects) if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return r.entry;
            return 6;
          }),
        ),
        KINDS,
      );
      const p = buildPieceIndex(grid);
      const before = [0, 1, 2, 0, 0, 0, 0];
      const pieces = transferredPieces(p, new Set([2]));
      if (pieces.length === 0 || !p.entryOf.includes(1)) continue;
      const absorberUnits: number[] = [];
      for (let u = 0; u < grid.cells.length; u++) if (grid.cells[u] === 1) absorberUnits.push(u);
      for (const component of pieces) {
        const units: number[] = [];
        for (const piece of component) for (let i = p.unitStart[piece]!; i < p.unitStart[piece + 1]!; i++) units.push(p.units[i]!);
        const touching = units.filter((u) => {
          const x = u % 420;
          return [x > 0 ? u - 1 : -1, x < 419 ? u + 1 : -1, u >= 420 ? u - 420 : -1, u < 420 * 299 ? u + 420 : -1].some((v) => v !== -1 && grid.cells[v] === 1);
        });
        let expected = touching;
        if (expected.length === 0) {
          const d2 = (a: number, b: number): number => ((a % 420) - (b % 420)) ** 2 + (Math.floor(a / 420) - Math.floor(b / 420)) ** 2;
          let best = Infinity;
          for (const u of units) for (const a of absorberUnits) best = Math.min(best, d2(u, a));
          expected = units.filter((u) => absorberUnits.some((a) => d2(u, a) === best));
          if (Math.sqrt(best) > 128) farScenes++;
        }
        expect(Array.from(seedSet(p, component, before, 1)), `scene ${scene}`).toStrictEqual(expected.sort((a, b) => a - b));
      }
    }
    expect(farScenes).toBeGreaterThan(0);
  });
});

describe('FR-179 FR-189 on the dev map, seed 1', () => {
  let index: EntryIndex;
  let p: PieceIndex;
  const REAL: SimPort = { totalRounds, getState, getRounds, ownerOf };
  const factionIndex = factionIndexOf(DEV_MAP);

  beforeAll(async () => {
    const decoded = await decodeIdPng(devPngBytes(), inflateStream);
    if (!decoded.ok) throw new Error('png');
    index = buildEntryIndex(DEV_MAP, decoded.value.width, decoded.value.height, decoded.value.values);
    p = buildPieceIndex(index);
  });

  it('FR-179 round 1: the field covers exactly the transferred units and every piece reaches 1 (time logged)', () => {
    const s0 = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, 0, REAL);
    const s1 = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, 1, REAL);
    if (!s0.ok || !s1.ok || s1.value.record === undefined) throw new Error('scene');
    const before = ownerTable(index, s0.value.owners, factionIndex);
    const after = ownerTable(index, s1.value.owners, factionIndex);
    const moved = new Set<number>();
    for (let e = 1; e < index.fills.length; e++) if (before[e] !== after[e]) moved.add(e);
    expect(moved.size).toBeGreaterThan(0);
    const absorber = factionIndex.get(s1.value.record.absorber)!;
    const t0 = performance.now();
    const field = frontField(p, moved, before, absorber);
    console.log(`front: dev map seed 1 round 1, ${moved.size} entries, ${(performance.now() - t0).toFixed(0)} ms, box ${field.width} x ${field.height}`);
    let covered = 0;
    let maxima = 0;
    let wrong = 0;
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const v = frontAt(field, x, y);
        if (v >= 0 !== moved.has(index.cells[y * p.width + x]!)) wrong++;
        if (v >= 0) covered++;
        if (v === 1) maxima++;
      }
    }
    expect(wrong).toBe(0);
    expect(covered).toBeGreaterThan(0);
    expect(maxima).toBeGreaterThanOrEqual(transferredPieces(p, moved).length);
  });
});
