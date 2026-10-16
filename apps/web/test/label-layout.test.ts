import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import { buildEntryIndex, factionIndexOf, ownerTable } from '../src/core/entries';
import type { EntryIndex } from '../src/core/entries';
import { LABEL_PARAMS } from '../src/core/label-params';
import type { LabelParams } from '../src/core/label-params';
import { factionBoxes, fitLabel, territoryBoxes } from '../src/core/label-layout';
import type { LabelBox } from '../src/core/label-layout';
import { decodeIdPng } from '../src/core/png';
import { buildPieceIndex, mainPieces, mainRegions, regionsOf } from '../src/core/regions';
import type { PieceIndex } from '../src/core/regions';
import { sceneAt } from '../src/core/scene';
import type { SimPort } from '../src/core/scene';
import { inflateStream } from '../src/ui/load';
import { DEV_MAP, DEV_PRESENTATION, devPngBytes } from './helpers/dev-map';
import { ownersOf } from './helpers/grids';
import { gridFrom, randomGrid, rng } from './helpers/label-grids';

const KINDS = { 1: 'land', 2: 'land', 3: 'land', 4: 'land', 5: 'land', 6: 'sea' } as const;
const params = (margin: number, maxHeight: number): LabelParams => ({ ...LABEL_PARAMS, margin, maxHeight });
const allPieces = (p: PieceIndex): number[] => Array.from({ length: p.entryOf.length }, (_, i) => i);

/** An all-land grid of one entry. */
const block = (width: number, height: number) => gridFrom(Array.from({ length: height }, () => new Array<number>(width).fill(1)), KINDS);

describe('FR-169 the largest fitting box, then the tie rule', () => {
  it('FR-169 on a 12 x 8 rectangle the box is the tallest one that fits with the margin, centred', () => {
    const p = buildPieceIndex(block(12, 8));
    // margin 2, aspect 2: height 4 gives width 8, grown to 12 x 8, which is the whole rectangle
    expect(fitLabel(p, [0], 2, params(2, 120))).toStrictEqual({ x0: 2, y0: 2, h: 4, w: 8 });
  });

  it('FR-169 Hmax caps the height and the four equally central boxes tie on the smallest y0, then x0', () => {
    const p = buildPieceIndex(block(40, 40));
    // x0 and y0 run 2..35, mean 18.5: the boxes (18,18) (19,18) (18,19) (19,19) are equally central
    expect(fitLabel(p, [0], 1, params(2, 3))).toStrictEqual({ x0: 18, y0: 18, h: 3, w: 3 });
  });

  it('FR-169 two equally central boxes: the smaller y0 wins even when its x0 is larger', () => {
    const grid = gridFrom(
      [
        [0, 1, 1, 1],
        [1, 1, 1, 1],
        [1, 1, 1, 1],
        [1, 1, 1, 0],
      ],
      KINDS,
    );
    const p = buildPieceIndex(grid);
    // only the 3 x 3 blocks at columns 1-3 / rows 0-2 and columns 0-2 / rows 1-3 fit: boxes (2,1) and (1,2)
    expect(fitLabel(p, [0], 1, params(1, 10))).toStrictEqual({ x0: 2, y0: 1, h: 1, w: 1 });
  });

  it('FR-169 the mean is taken over all the fitting boxes of the largest height, not over the extremes', () => {
    // an L-shaped corridor of boxes: three fitting boxes in a row plus one far away row
    const grid = gridFrom(
      [
        [1, 1, 1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1, 1, 1],
        [0, 0, 0, 0, 0, 0, 0],
        [1, 1, 1, 0, 0, 0, 0],
        [1, 1, 1, 0, 0, 0, 0],
        [1, 1, 1, 0, 0, 0, 0],
      ],
      KINDS,
    );
    const p = buildPieceIndex(grid);
    // fitting boxes (1,1) (2,1) (3,1) (4,1) (5,1) and (1,5): mean x0 = 16/6, y0 = 10/6; the box (3,1) is nearest
    expect(fitLabel(p, [0, 1], 1, params(1, 10))).toStrictEqual({ x0: 3, y0: 1, h: 1, w: 1 });
  });

  it('FR-169 a width below half a unit still needs the margin columns (w < 0.5)', () => {
    const grid = gridFrom(
      [
        [0, 1, 1, 0],
        [0, 1, 1, 0],
        [0, 1, 1, 0],
      ],
      KINDS,
    );
    const p = buildPieceIndex(grid);
    expect(fitLabel(p, [0], 0.25, params(1, 10))).toStrictEqual({ x0: 2, y0: 1, h: 1, w: 0.25 });
  });
});

describe('FR-170 no box of height 1 means no label', () => {
  it('FR-170 a region too small for height 1 plus the margin has no box', () => {
    const p = buildPieceIndex(block(2, 2));
    expect(fitLabel(p, [0], 1, params(1, 10))).toBeUndefined();
    expect(fitLabel(buildPieceIndex(block(5, 2)), [0], 1, params(1, 10))).toBeUndefined();
  });

  it('FR-170 an empty set of pieces has no box', () => {
    expect(fitLabel(buildPieceIndex(block(9, 9)), [], 1, params(1, 10))).toBeUndefined();
  });

  it('FR-170 a box that fits at height 1 but whose width needs more than the region is absent too', () => {
    // 3 rows, 8 columns: height 1 needs aspect 3 -> cols = 2 + 3 + ... more than 8? 2*1 + floor(2.5) + 1 = 5 fits; aspect 9 does not
    const p = buildPieceIndex(block(8, 3));
    expect(fitLabel(p, [0], 3, params(1, 10))).not.toBeUndefined();
    expect(fitLabel(p, [0], 9, params(1, 10))).toBeUndefined();
  });
});

describe('FR-169 the grown box must stay inside the image (D12)', () => {
  it('FR-169 on a fully land image no box touches the edge: the grown rectangle would leave the image', () => {
    const p = buildPieceIndex(block(5, 5));
    const box = fitLabel(p, [0], 1, params(1, 1))!;
    expect(box).toStrictEqual({ x0: 2, y0: 2, h: 1, w: 1 });
    // a 3 x 3 land patch in the corner of a larger land image does not have a box centred outside it either
    const corner = buildPieceIndex(block(3, 3));
    expect(fitLabel(corner, [0], 1, params(1, 1))).toStrictEqual({ x0: 1, y0: 1, h: 1, w: 1 });
  });

  it('FR-169 a region touching the image edge never gets a box with x0 or y0 below the margin', () => {
    const p = buildPieceIndex(block(9, 8));
    const box = fitLabel(p, [0], 2, params(2, 10))!;
    expect(box.x0).toBeGreaterThanOrEqual(2);
    expect(box.y0).toBeGreaterThanOrEqual(2);
    expect(box.y0 + box.h + 2).toBeLessThanOrEqual(8);
  });
});

/** The rule of the spec written the long way: every height, every position, every unit, exact tie arithmetic. */
function bruteFit(p: PieceIndex, pieces: readonly number[], aspect8: number, margin: number, maxHeight: number): LabelBox | undefined {
  const set = new Set(pieces);
  const inSet = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < p.width && y < p.height && set.has(p.pieceOf[y * p.width + x]!);
  for (let h = maxHeight; h >= 1; h--) {
    const w = (h * aspect8) / 8;
    const boxes: { x0: number; y0: number }[] = [];
    for (let y0 = 0; y0 <= p.height; y0++) {
      for (let x0 = 0; x0 <= p.width; x0++) {
        let ok = true;
        for (let y = y0 - margin - 1; ok && y <= y0 + h + margin + 1; y++) {
          if (!(y + 0.5 >= y0 - margin && y + 0.5 <= y0 + h + margin)) continue;
          for (let x = x0 - margin - 1; x <= Math.ceil(x0 + w + margin) + 1; x++) {
            if (!(x + 0.5 >= x0 - margin && x + 0.5 <= x0 + w + margin)) continue;
            if (!inSet(x, y)) {
              ok = false;
              break;
            }
          }
        }
        if (ok) boxes.push({ x0, y0 });
      }
    }
    if (boxes.length === 0) continue;
    // centres times 16 are whole numbers because the aspect is a multiple of 1/8
    const cx = (b: { x0: number }): bigint => BigInt(16 * b.x0 + h * aspect8);
    const cy = (b: { y0: number }): bigint => BigInt(16 * b.y0 + 8 * h);
    const n = BigInt(boxes.length);
    const sx = boxes.reduce((s, b) => s + cx(b), 0n);
    const sy = boxes.reduce((s, b) => s + cy(b), 0n);
    const dist = (b: { x0: number; y0: number }): bigint => (n * cx(b) - sx) ** 2n + (n * cy(b) - sy) ** 2n;
    let best = boxes[0]!;
    for (const b of boxes) {
      const d = dist(b);
      const db = dist(best);
      if (d < db || (d === db && (b.y0 < best.y0 || (b.y0 === best.y0 && b.x0 < best.x0)))) best = b;
    }
    return { x0: best.x0, y0: best.y0, h, w };
  }
  return undefined;
}

describe('FR-169 the fast search equals the rule written the long way', () => {
  it('FR-169 and FR-170 fitLabel equals the brute-force rule on 200 fixed-seed random grids', () => {
    const next = rng(2024);
    let found = 0;
    let missing = 0;
    let tied = 0;
    for (let i = 0; i < 200; i++) {
      const width = 8 + Math.floor(next() * 12);
      const height = 8 + Math.floor(next() * 12);
      const grid = randomGrid(width, height, 3, 1000 + i);
      const p = buildPieceIndex(grid);
      const main = mainPieces(p);
      const margin = 1 + Math.floor(next() * 2);
      const maxHeight = [3, 6, 40][Math.floor(next() * 3)]!;
      const aspect8 = [2, 8, 20, 31][Math.floor(next() * 4)]!;
      const sets: number[][] = [
        [main[1]!].filter((piece) => piece >= 0),
        Array.from({ length: p.entryOf.length }, (_, piece) => piece).filter((piece) => p.entryOf[piece]! <= 2),
        allPieces(p),
      ];
      for (const pieces of sets) {
        const fast = fitLabel(p, pieces, aspect8 / 8, params(margin, maxHeight));
        const slow = bruteFit(p, pieces, aspect8, margin, maxHeight);
        expect(fast, `grid ${i} margin ${margin} Hmax ${maxHeight} aspect ${aspect8 / 8}`).toStrictEqual(slow);
        if (slow === undefined) missing++;
        else found++;
        if (slow !== undefined && slow.h === 1) tied++;
      }
    }
    expect(found).toBeGreaterThan(150);
    expect(missing).toBeGreaterThan(5);
    expect(tied).toBeGreaterThan(5);
  });

  it('FR-169 the brute-force rule itself reproduces the hand grids', () => {
    const p = buildPieceIndex(block(40, 40));
    expect(bruteFit(p, [0], 8, 2, 3)).toStrictEqual({ x0: 18, y0: 18, h: 3, w: 3 });
    const q = buildPieceIndex(block(12, 8));
    expect(bruteFit(q, [0], 16, 2, 120)).toStrictEqual({ x0: 2, y0: 2, h: 4, w: 8 });
  });
});

describe('FR-169 the faster search keeps the result of the rule on shapes that stress it', () => {
  it('FR-169 a long thin strip (more than 128 successive nearer boxes in one row) equals the brute-force rule', () => {
    for (const [width, height] of [[400, 5], [5, 400], [300, 7]] as const) {
      const p = buildPieceIndex(block(width, height));
      for (const [aspect8, margin, maxHeight] of [[8, 1, 1], [8, 1, 3], [16, 2, 2]] as const) {
        expect(fitLabel(p, [0], aspect8 / 8, params(margin, maxHeight)), `${width} x ${height} aspect ${aspect8 / 8} M ${margin}`).toStrictEqual(
          bruteFit(p, [0], aspect8, margin, maxHeight),
        );
      }
    }
  });

  it('FR-169 a plus-shaped region (long runs in different rows and columns) equals the brute-force rule', () => {
    const rows = Array.from({ length: 30 }, (_, y) => Array.from({ length: 30 }, (_, x) => (x >= 12 && x < 18) || (y >= 12 && y < 18) ? 1 : 6));
    const p = buildPieceIndex(gridFrom(rows, KINDS));
    for (const [aspect8, margin, maxHeight] of [[8, 1, 120], [24, 1, 120], [4, 2, 120], [8, 1, 3]] as const) {
      expect(fitLabel(p, [0], aspect8 / 8, params(margin, maxHeight)), `aspect ${aspect8 / 8} M ${margin} Hmax ${maxHeight}`).toStrictEqual(
        bruteFit(p, [0], aspect8, margin, maxHeight),
      );
    }
  });

  it('FR-169 a region more than 65,535 units tall gets the analytic box (wide-counter path)', () => {
    // 3 x 70,000, M 1, aspect 0.1: heights up to 14 need 3 columns; the 69,985 positions of y0 are symmetric.
    const p = buildPieceIndex(block(3, 70000));
    expect(fitLabel(p, [0], 0.1, params(1, 120))).toStrictEqual({ x0: 1, y0: 34993, h: 14, w: 1.4000000000000001 });
  });
});

describe('FR-189 and NFR-33 the layout is a pure, deterministic function', () => {
  it('NFR-33 and FR-189 same inputs give the same boxes, the inputs are untouched and no clock or random source is read', () => {
    const grid = randomGrid(30, 24, 4, 9);
    const p = buildPieceIndex(grid);
    const owners = ownersOf({ 1: 1, 2: 1, 3: 2, 4: 2 }, 6);
    const aspects = new Map([[1, 3.5], [2, 1.25]]);
    const territory = [0, 2, 3, 1.5, 4, 2];
    const spies = [
      vi.spyOn(Math, 'random').mockImplementation(() => {
        throw new Error('Math.random');
      }),
      vi.spyOn(Date, 'now').mockImplementation(() => {
        throw new Error('Date.now');
      }),
      vi.spyOn(performance, 'now').mockImplementation(() => {
        throw new Error('performance.now');
      }),
    ];
    try {
      const a = factionBoxes(p, owners, aspects, params(1, 20));
      const b = factionBoxes(p, owners, aspects, params(1, 20));
      expect(a).toStrictEqual(b);
      expect(territoryBoxes(p, territory, params(1, 20))).toStrictEqual(territoryBoxes(p, territory, params(1, 20)));
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(owners).toStrictEqual(ownersOf({ 1: 1, 2: 1, 3: 2, 4: 2 }, 6));
    expect(territory).toStrictEqual([0, 2, 3, 1.5, 4, 2]);
  });

  it('FR-189 invalid parameters are refused instead of guessed', () => {
    const p = buildPieceIndex(block(9, 9));
    expect(() => fitLabel(p, [0], 0, params(1, 10))).toThrow(RangeError);
    expect(() => fitLabel(p, [0], Number.NaN, params(1, 10))).toThrow(RangeError);
    expect(() => fitLabel(p, [0], 1, params(0, 10))).toThrow(RangeError);
    expect(() => fitLabel(p, [0], 1, params(1.5, 10))).toThrow(RangeError);
    expect(() => fitLabel(p, [0], 1, params(1, 0))).toThrow(RangeError);
  });
});

describe('FR-171 faction boxes follow the state, territory boxes do not', () => {
  const grid = gridFrom(
    [
      [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2],
      [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2],
      [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2],
      [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2],
      [3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2],
      [3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2],
    ],
    KINDS,
  );
  const p = buildPieceIndex(grid);
  const aspects = new Map([[1, 2], [2, 2]]);

  it('FR-171 a faction box lies in its main region and a faction without land has no label', () => {
    const boxes = factionBoxes(p, ownersOf({ 1: 1, 2: 2, 3: 1 }, 6), aspects, params(1, 20));
    expect([...boxes.labels.keys()]).toStrictEqual([1, 2]);
    expect(boxes.labels.get(1)!.pieces).toStrictEqual([0, 2]);
    const afterAbsorb = factionBoxes(p, ownersOf({ 1: 1, 2: 1, 3: 1 }, 6), aspects, params(1, 20));
    expect([...afterAbsorb.labels.keys()]).toStrictEqual([1]);
  });

  it('FR-171 a faction that absorbed another gets the box of its new main region', () => {
    const before = factionBoxes(p, ownersOf({ 1: 1, 2: 2, 3: 2 }, 6), aspects, params(1, 20));
    const after = factionBoxes(p, ownersOf({ 1: 1, 2: 1, 3: 1 }, 6), aspects, params(1, 20), before);
    expect(after.labels.get(1)!.box).toStrictEqual(fitLabel(p, [0, 1, 2], 2, params(1, 20)));
    expect(after.labels.get(1)!.box).not.toStrictEqual(before.labels.get(1)!.box);
    expect(after.recomputed).toStrictEqual([1]);
  });

  it('FR-171 a faction whose main region did not change keeps its box without being laid out again', () => {
    const before = factionBoxes(p, ownersOf({ 1: 1, 2: 2, 3: 3 }, 6), new Map([[1, 2], [2, 2], [3, 2]]), params(1, 20));
    const after = factionBoxes(p, ownersOf({ 1: 1, 2: 2, 3: 2 }, 6), new Map([[1, 2], [2, 2], [3, 2]]), params(1, 20), before);
    expect(after.recomputed).toStrictEqual([2]);
    expect(after.labels.get(1)).toBe(before.labels.get(1));
  });

  it('FR-171 a previous result of another piece index, other parameters or another aspect is not reused', () => {
    const owners = ownersOf({ 1: 1, 2: 2, 3: 1 }, 6);
    const before = factionBoxes(p, owners, aspects, params(1, 20));
    expect(factionBoxes(p, owners, aspects, params(2, 20), before).recomputed).toStrictEqual([1, 2]);
    expect(factionBoxes(p, owners, new Map([[1, 3], [2, 2]]), params(1, 20), before).recomputed).toStrictEqual([1]);
    expect(factionBoxes(buildPieceIndex(grid), owners, aspects, params(1, 20), before).recomputed).toStrictEqual([1, 2]);
  });

  it('FR-170 a faction whose main region has no box keeps a label entry without a box', () => {
    const boxes = factionBoxes(p, ownersOf({ 1: 1, 2: 2, 3: 2 }, 6), new Map([[1, 40], [2, 2]]), params(1, 20));
    expect(boxes.labels.get(1)!.box).toBeUndefined();
    expect(boxes.labels.get(2)!.box).not.toBeUndefined();
  });

  it('FR-171 a faction with no aspect given gets no label entry', () => {
    const boxes = factionBoxes(p, ownersOf({ 1: 1, 2: 2 }, 6), new Map([[2, 2]]), params(1, 20));
    expect([...boxes.labels.keys()]).toStrictEqual([2]);
  });

  it('FR-171 territory boxes use only the main piece of each entry and ignore owners', () => {
    const boxes = territoryBoxes(p, [0, 2, 2, 2, 0, 0, 0], params(1, 20));
    expect(boxes).toHaveLength(p.entries);
    expect(boxes[0]).toBeUndefined();
    expect(boxes[1]).toStrictEqual(fitLabel(p, [0], 2, params(1, 20)));
    expect(boxes[4]).toBeUndefined();
    expect(boxes[6]).toBeUndefined();
  });

  it('FR-168 and FR-170 an entry without aspect, without land or too small for height 1 has no territory box', () => {
    const small = buildPieceIndex(gridFrom([[1, 1, 1, 1, 1], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1], [2, 6, 6, 6, 6]], KINDS));
    const boxes = territoryBoxes(small, [0, 1, 1, 0, 0, 0, 1], params(1, 20));
    expect(boxes[1]).not.toBeUndefined();
    expect(boxes[2]).toBeUndefined();
    expect(boxes[6]).toBeUndefined();
  });
});

describe('FR-169 FR-171 FR-189 and NFR-33 on the dev map with injected aspects', () => {
  let index: EntryIndex;
  let p: PieceIndex;
  const REAL: SimPort = { totalRounds, getState, getRounds, ownerOf };
  const factionIndex = factionIndexOf(DEV_MAP);
  const ownersAt = (round: number): Uint8Array => {
    const scene = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, round, REAL);
    if (!scene.ok) throw new Error('scene');
    return ownerTable(index, scene.value.owners, factionIndex);
  };
  const FACTION_ASPECTS = new Map<number, number>([...factionIndex.values()].map((f) => [f, 4]));
  const TERRITORY_ASPECTS: number[] = [];
  const P = LABEL_PARAMS;

  beforeAll(async () => {
    const decoded = await decodeIdPng(devPngBytes(), inflateStream);
    if (!decoded.ok) throw new Error('png');
    index = buildEntryIndex(DEV_MAP, decoded.value.width, decoded.value.height, decoded.value.values);
    p = buildPieceIndex(index);
    for (let e = 0; e < index.fills.length; e++) TERRITORY_ASPECTS.push(index.fills[e] === 'land' ? 3 : 0);
  });

  const insideWithMargin = (box: LabelBox, pieces: readonly number[]): boolean => {
    const set = new Set(pieces);
    const fw = Math.floor(box.w - 0.5);
    for (let y = box.y0 - P.margin; y <= box.y0 + box.h + P.margin - 1; y++) {
      for (let x = box.x0 - P.margin; x <= box.x0 + P.margin + fw; x++) {
        if (x < 0 || y < 0 || x >= p.width || y >= p.height) return false;
        if (!set.has(p.pieceOf[y * p.width + x]!)) return false;
      }
    }
    return true;
  };

  it('FR-169 and NFR-33 every faction box of rounds 0..4 lies inside its main region with the margin (time logged)', () => {
    for (let round = 0; round <= 4; round++) {
      const owners = ownersAt(round);
      const t0 = performance.now();
      const boxes = factionBoxes(p, owners, FACTION_ASPECTS, P);
      const ms = performance.now() - t0;
      console.log(`label-layout: round ${round} faction layout ${ms.toFixed(0)} ms for ${boxes.labels.size} factions`);
      const main = mainRegions(regionsOf(p, owners));
      expect([...boxes.labels.keys()].sort()).toStrictEqual([...main.keys()].sort());
      for (const [faction, label] of boxes.labels) {
        expect(label.box, `round ${round} faction ${faction}`).not.toBeUndefined();
        expect(label.pieces).toStrictEqual(main.get(faction)!.pieces);
        expect(insideWithMargin(label.box!, label.pieces), `round ${round} faction ${faction}`).toBe(true);
        expect(label.box!.w).toBeCloseTo(label.box!.h * 4, 9);
        expect(label.box!.h).toBeLessThanOrEqual(P.maxHeight);
      }
    }
  });

  it('FR-169 FR-171 territory boxes lie in their main piece and are equal at rounds 0..4 (time logged)', () => {
    const t0 = performance.now();
    const boxes = territoryBoxes(p, TERRITORY_ASPECTS, P);
    console.log(`label-layout: territory layout ${(performance.now() - t0).toFixed(0)} ms`);
    const main = mainPieces(p);
    let withBox = 0;
    for (let e = 1; e < index.fills.length; e++) {
      const box = boxes[e];
      if (index.fills[e] !== 'land') {
        expect(box, `entry ${e}`).toBeUndefined();
        continue;
      }
      if (box === undefined) continue;
      withBox++;
      expect(insideWithMargin(box, [main[e]!]), `entry ${e}`).toBe(true);
    }
    expect(withBox).toBeGreaterThan(50);
    for (let round = 0; round <= 4; round++) {
      factionBoxes(p, ownersAt(round), FACTION_ASPECTS, P);
      expect(territoryBoxes(p, TERRITORY_ASPECTS, P)).toStrictEqual(boxes);
    }
  });

  it('FR-171 and FR-189 the reuse of the round being left equals a full recomputation for every step and jump of seed 1', () => {
    const tables = [0, 1, 2, 3, 4].map(ownersAt);
    const fresh = tables.map((owners) => factionBoxes(p, owners, FACTION_ASPECTS, P));
    let steps = 0;
    for (let from = 0; from <= 4; from++) {
      for (let to = 0; to <= 4; to++) {
        const reused = factionBoxes(p, tables[to]!, FACTION_ASPECTS, P, fresh[from]);
        expect(reused.labels, `from ${from} to ${to}`).toStrictEqual(fresh[to]!.labels);
        if (Math.abs(from - to) === 1) {
          steps++;
          // a step lays out again only the absorber (and, going back, the faction that comes back)
          expect(reused.recomputed.length, `step ${from} -> ${to}`).toBeLessThanOrEqual(to > from ? 1 : 2);
        }
      }
    }
    expect(steps).toBe(8);
  });
});
