import { beforeAll, describe, expect, it } from 'vitest';
import { buildPieceIndex, mainPieces, mainRegions, regionsOf } from '../src/core/regions';
import { buildEntryIndex, factionIndexOf, ownerTable } from '../src/core/entries';
import type { EntryIndex } from '../src/core/entries';
import { decodeIdPng } from '../src/core/png';
import { inflateStream } from '../src/ui/load';
import { DEV_MAP, DEV_PRESENTATION, devPngBytes } from './helpers/dev-map';
import { gridFrom, naivePieces, randomGrid } from './helpers/label-grids';
import { ownersOf } from './helpers/grids';

const LAND = { 1: 'land', 2: 'land', 3: 'land', 4: 'land', 5: 'land', 6: 'sea' } as const;

describe('FR-168 pieces are 4-connected sets of one land entry', () => {
  it('FR-168 an entry split in two is two pieces numbered by their first unit, with size, first unit and box', () => {
    const grid = gridFrom(
      [
        [1, 1, 0, 2, 2],
        [1, 0, 0, 0, 2],
        [3, 3, 3, 0, 1],
      ],
      LAND,
    );
    const p = buildPieceIndex(grid);
    expect(Array.from(p.entryOf)).toStrictEqual([1, 2, 3, 1]);
    expect(Array.from(p.size)).toStrictEqual([3, 3, 3, 1]);
    expect(Array.from(p.first)).toStrictEqual([0, 3, 10, 14]);
    expect(Array.from(p.box)).toStrictEqual([0, 0, 1, 1, 3, 0, 4, 1, 0, 2, 2, 2, 4, 2, 4, 2]);
    expect(p.entries).toBe(4);
    for (let piece = 0; piece < 4; piece++) {
      const units = Array.from(p.units.slice(p.unitStart[piece], p.unitStart[piece + 1]));
      expect(units.length).toBe(p.size[piece]);
      for (const u of units) expect(p.pieceOf[u]).toBe(piece);
    }
  });

  it('FR-168 a diagonal contact does not join two units of one entry', () => {
    const grid = gridFrom(
      [
        [1, 0],
        [0, 1],
      ],
      LAND,
    );
    const p = buildPieceIndex(grid);
    expect(p.entryOf.length).toBe(2);
    expect(p.nb.length).toBe(0);
  });

  it('FR-168 sea and outside units belong to no piece', () => {
    const grid = gridFrom(
      [
        [0, 6, 1],
        [6, 6, 1],
      ],
      LAND,
    );
    const p = buildPieceIndex(grid);
    expect(Array.from(p.pieceOf)).toStrictEqual([-1, -1, 0, -1, -1, 0]);
  });

  it('FR-168 neighbours are the 4-adjacent pieces of other land entries, ascending, symmetric, without sea', () => {
    const grid = gridFrom(
      [
        [1, 1, 2, 6, 3],
        [4, 1, 2, 6, 3],
        [4, 4, 5, 5, 3],
      ],
      LAND,
    );
    const p = buildPieceIndex(grid);
    const nbOf = (piece: number): number[] => Array.from(p.nb.slice(p.nbStart[piece], p.nbStart[piece + 1]));
    // pieces by first unit: 0 = entry 1, 1 = entry 2, 2 = entry 3, 3 = entry 4, 4 = entry 5
    expect(Array.from(p.entryOf)).toStrictEqual([1, 2, 3, 4, 5]);
    expect(nbOf(0)).toStrictEqual([1, 3]);
    expect(nbOf(1)).toStrictEqual([0, 4]);
    expect(nbOf(2)).toStrictEqual([4]);
    expect(nbOf(3)).toStrictEqual([0, 4]);
    expect(nbOf(4)).toStrictEqual([1, 2, 3]);
  });

  it('FR-168 the pieces equal a naive labelling on 40 random grids', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const grid = randomGrid(17 + (seed % 5), 13 + (seed % 7), 4, seed);
      const p = buildPieceIndex(grid);
      const naive = naivePieces(grid);
      const map = new Map<number, number>();
      for (let u = 0; u < naive.length; u++) {
        if (naive[u] === -1) {
          expect(p.pieceOf[u]).toBe(-1);
          continue;
        }
        const seen = map.get(naive[u]!);
        if (seen === undefined) map.set(naive[u]!, p.pieceOf[u]!);
        else expect(p.pieceOf[u]).toBe(seen);
      }
      expect(new Set(map.values()).size).toBe(map.size);
      expect(p.entryOf.length).toBe(map.size);
      let total = 0;
      for (let piece = 0; piece < p.entryOf.length; piece++) total += p.size[piece]!;
      expect(total).toBe(p.units.length);
    }
  });
});

describe('FR-167 regions join touching pieces of one owner', () => {
  it('FR-167 a region spans several entries of one owner and a different owner starts another', () => {
    const grid = gridFrom([[1, 2, 3, 4]], LAND);
    const p = buildPieceIndex(grid);
    const regions = regionsOf(p, ownersOf({ 1: 1, 2: 1, 3: 2, 4: 2 }, 6));
    expect(regions).toStrictEqual([
      { owner: 1, pieces: [0, 1], size: 2, first: 0 },
      { owner: 2, pieces: [2, 3], size: 2, first: 2 },
    ]);
  });

  it('FR-167 two factions with the same colour are two regions (the owner is the faction index)', () => {
    const grid = gridFrom([[1, 2]], LAND);
    const regions = regionsOf(buildPieceIndex(grid), ownersOf({ 1: 1, 2: 2 }, 6));
    expect(regions.map((r) => r.owner)).toStrictEqual([1, 2]);
  });

  it('FR-167 one faction separated by a strait has two regions and the larger one is the main region', () => {
    const grid = gridFrom(
      [
        [1, 1, 6, 2],
        [1, 1, 6, 2],
        [1, 1, 6, 0],
      ],
      LAND,
    );
    const owners = ownersOf({ 1: 1, 2: 1 }, 6);
    const regions = regionsOf(buildPieceIndex(grid), owners);
    expect(regions.map((r) => [r.size, r.first])).toStrictEqual([[6, 0], [2, 3]]);
    expect(mainRegions(regions).get(1)).toStrictEqual(regions[0]);
  });

  it('FR-167 land with no owner makes no region, and entries without land make none either', () => {
    const grid = gridFrom([[1, 2, 6]], LAND);
    expect(regionsOf(buildPieceIndex(grid), ownersOf({ 1: 1 }, 6))).toStrictEqual([{ owner: 1, pieces: [0], size: 1, first: 0 }]);
  });

  it('FR-167 equal regions tie on the smallest first unit, whatever the order of the input', () => {
    const grid = gridFrom(
      [
        [1, 6, 2, 6, 3],
        [1, 6, 2, 6, 3],
      ],
      LAND,
    );
    const regions = regionsOf(buildPieceIndex(grid), ownersOf({ 1: 1, 2: 1, 3: 1 }, 6));
    expect(regions).toHaveLength(3);
    expect(mainRegions(regions).get(1)).toStrictEqual(regions[0]);
    expect(mainRegions([...regions].reverse()).get(1)).toStrictEqual(regions[0]);
  });
});

describe('FR-168 main piece of an entry', () => {
  it('FR-168 the largest piece wins and equal pieces tie on the smallest first unit', () => {
    const grid = gridFrom(
      [
        [1, 6, 1, 1, 6, 2],
        [6, 6, 1, 1, 6, 2],
        [1, 6, 6, 6, 6, 2],
      ],
      LAND,
    );
    const p = buildPieceIndex(grid);
    const main = mainPieces(p);
    expect(main.length).toBe(7);
    expect(main[1]).toBe(p.pieceOf[2]); // the 2 x 2 piece beats the two single units
    expect(main[2]).toBe(p.pieceOf[5]);
    expect(main[3]).toBe(-1);
    expect(main[6]).toBe(-1);
    const tie = buildPieceIndex(gridFrom([[1, 6, 1]], LAND));
    expect(mainPieces(tie)[1]).toBe(0);
  });
});

describe('FR-171 regions follow the state they are computed for', () => {
  it('FR-171 after an owner change the regions are recomputed and no stale region remains', () => {
    const grid = gridFrom(
      [
        [1, 2, 3],
        [1, 2, 3],
      ],
      LAND,
    );
    const p = buildPieceIndex(grid);
    const before = regionsOf(p, ownersOf({ 1: 1, 2: 2, 3: 2 }, 6));
    const after = regionsOf(p, ownersOf({ 1: 1, 2: 1, 3: 2 }, 6));
    expect(before.map((r) => [r.owner, r.size])).toStrictEqual([[1, 2], [2, 4]]);
    expect(after.map((r) => [r.owner, r.size])).toStrictEqual([[1, 4], [2, 2]]);
    expect(mainRegions(after).get(2)!.pieces).toStrictEqual([2]);
  });
});

describe('FR-189 the piece index and the regions are pure functions of their inputs', () => {
  it('FR-189 the same grid and owners give identical results, and the inputs are not modified', () => {
    const grid = randomGrid(30, 20, 5, 7);
    const cells = Array.from(grid.cells);
    const owners = ownersOf({ 1: 1, 2: 1, 3: 2, 4: 3, 5: 3 }, 6);
    const a = buildPieceIndex(grid);
    const b = buildPieceIndex(grid);
    expect(a).toStrictEqual(b);
    expect(regionsOf(a, owners)).toStrictEqual(regionsOf(b, owners));
    expect(Array.from(grid.cells)).toStrictEqual(cells);
    expect(owners).toStrictEqual(ownersOf({ 1: 1, 2: 1, 3: 2, 4: 3, 5: 3 }, 6));
  });
});

describe('FR-167 and FR-168 on the dev map', () => {
  let index: EntryIndex;
  beforeAll(async () => {
    const decoded = await decodeIdPng(devPngBytes(), inflateStream);
    if (!decoded.ok) throw new Error('png');
    index = buildEntryIndex(DEV_MAP, decoded.value.width, decoded.value.height, decoded.value.values);
  });

  const ownersAtStart = (): number[] => {
    const owners = new Map((DEV_MAP.territories as { id: number; owner?: number }[]).filter((t) => t.owner !== undefined).map((t) => [t.id, t.owner!]));
    return Array.from(ownerTable(index, owners, factionIndexOf(DEV_MAP)));
  };

  it('FR-168 the piece index of the dev map is built in Node (time logged)', () => {
    const t0 = performance.now();
    const p = buildPieceIndex(index);
    const ms = performance.now() - t0;
    console.log(`regions: dev map piece index ${ms.toFixed(0)} ms, ${p.entryOf.length} pieces`);
    // every land entry has a main piece and every sea entry has none
    const main = mainPieces(p);
    for (let e = 1; e < index.fills.length; e++) {
      expect(main[e] === -1, `entry ${e}`).toBe(index.fills[e] !== 'land');
    }
    let landUnits = 0;
    for (let u = 0; u < index.cells.length; u++) if (index.fills[index.cells[u]!] === 'land') landUnits++;
    expect(p.units.length).toBe(landUnits);
  });

  it('FR-167 Espana has the Baleares as a second region and Italia has at least two regions at round 0', () => {
    const p = buildPieceIndex(index);
    const regions = regionsOf(p, ownersAtStart());
    const factionIndex = factionIndexOf(DEV_MAP);
    const idOfName = (name: string): number => DEV_PRESENTATION.factions.find((f) => f.name.normalize('NFD').replace(/\p{M}/gu, '') === name)!.id;
    const spain = regions.filter((r) => r.owner === factionIndex.get(idOfName('Espana')));
    const italy = regions.filter((r) => r.owner === factionIndex.get(idOfName('Italia')));
    expect(spain.length).toBeGreaterThanOrEqual(2);
    expect(italy.length).toBeGreaterThanOrEqual(2);
    const baleares = index.indexOf.get(DEV_PRESENTATION.territories.find((t) => t.name === 'Islas Baleares')!.id)!;
    const small = spain.find((r) => r.pieces.some((piece) => p.entryOf[piece] === baleares))!;
    const main = mainRegions(regions).get(factionIndex.get(idOfName('Espana'))!)!;
    expect(small).not.toBe(main);
    expect(main.size).toBeGreaterThan(small.size);
    expect(main.pieces.some((piece) => p.entryOf[piece] === baleares)).toBe(false);
  });
});
