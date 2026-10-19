import { beforeAll, describe, expect, it, vi } from 'vitest';
import { layoutDigest } from '../src/core/label-digest';
import { territoryBoxes } from '../src/core/label-layout';
import type { LabelBox } from '../src/core/label-layout';
import { placeFactions, placeTerritories } from '../src/core/label-place';
import type { FactionLayout, Placed, TerritoryLayout } from '../src/core/label-place';
import { inLandFrame, inArc, inStraight } from '../src/core/label-shape';
import type { InLandFrame } from '../src/core/label-shape';
import { LABEL_PARAMS } from '../src/core/label-params';
import { mainPieces } from '../src/core/regions';
import type { PieceIndex } from '../src/core/regions';
import { buildPieceIndex } from '../src/core/regions';
import { SHAPE_PARAMS } from '../src/core/shape-params';
import { ownersOf, gridOf } from './helpers/grids';
import { DEV_FACTION_ASPECT, devRun } from './helpers/label-digest-run';
import type { DevRun } from './helpers/label-digest-run';

const P = LABEL_PARAMS;
const M = P.margin;
const SP = SHAPE_PARAMS;
const KINDS = { 1: 'land', 2: 'land', 3: 'land', 4: 'land' } as const;

/** What is drawn for a label: its placed frame, else its horizontal in-land frame, else nothing. */
const drawnOf = (placed: Placed | undefined, inLand: InLandFrame | undefined): InLandFrame | Placed | undefined =>
  placed ?? (inLand !== undefined && inLand.shape === 'horizontal' ? inLand : undefined);

/** True when the unit centre (px, py) lies in the grown footprint of the frame (spec formulas, as the code uses). */
function covers(frame: InLandFrame | Placed, px: number, py: number): boolean {
  if (frame.shape === 'straight') return inStraight(frame, M, px, py);
  if (frame.shape === 'arc') return inArc(frame, M, px, py);
  const b = frame.box;
  return px >= b.x0 - M && px <= b.x0 + b.w + M && py >= b.y0 - M && py <= b.y0 + b.h + M;
}

/** Lattice bounds (inclusive) that contain every unit centre of the grown footprint. */
function boundsOf(frame: InLandFrame | Placed): [number, number, number, number] {
  if (frame.shape === 'horizontal' || frame.shape === 'off-land') {
    const b = frame.box;
    return [Math.floor(b.x0 - M) - 1, Math.floor(b.y0 - M) - 1, Math.ceil(b.x0 + b.w + M) + 1, Math.ceil(b.y0 + b.h + M) + 1];
  }
  const r = Math.ceil(frame.w / 2 + frame.h / 2 + 2 * M) + 2;
  return [Math.floor(frame.cx) - r, Math.floor(frame.cy) - r, Math.floor(frame.cx) + r, Math.floor(frame.cy) + r];
}

/** Every pair of drawn frames of one role that share a unit centre of their grown footprints. */
function conflicts(frames: readonly (InLandFrame | Placed | undefined)[]): [number, number][] {
  const found: [number, number][] = [];
  for (let i = 0; i < frames.length; i++) {
    const a = frames[i];
    if (a === undefined) continue;
    const ba = boundsOf(a);
    for (let j = i + 1; j < frames.length; j++) {
      const b = frames[j];
      if (b === undefined) continue;
      const bb = boundsOf(b);
      const xa = Math.max(ba[0], bb[0]);
      const ya = Math.max(ba[1], bb[1]);
      const xb = Math.min(ba[2], bb[2]);
      const yb = Math.min(ba[3], bb[3]);
      let hit = false;
      for (let y = ya; y <= yb && !hit; y++) {
        for (let x = xa; x <= xb && !hit; x++) if (covers(a, x + 0.5, y + 0.5) && covers(b, x + 0.5, y + 0.5)) hit = true;
      }
      if (hit) found.push([i, j]);
    }
  }
  return found;
}

describe('FR-215 the conflict check used below sees a real overlap', () => {
  it('FR-215 two horizontal frames that share a unit are flagged and far ones are not', () => {
    const near: InLandFrame = { shape: 'horizontal', box: { x0: 10, y0: 10, h: 6, w: 12 } };
    const over: InLandFrame = { shape: 'horizontal', box: { x0: 20, y0: 10, h: 6, w: 12 } };
    const far: InLandFrame = { shape: 'horizontal', box: { x0: 60, y0: 10, h: 6, w: 12 } };
    expect(conflicts([near, over, far])).toStrictEqual([[0, 1]]);
    const straight: InLandFrame = { shape: 'straight', cx: 16.5, cy: 12.5, angle: 90, h: 4, w: 10 };
    expect(conflicts([near, straight])).toStrictEqual([[0, 1]]);
  });
});

describe('FR-206 FR-209 FR-213 the territory placement on small grids', () => {
  // entry 1: a large block; entry 2: a 4 x 4 island next to it; entry 3: sea-like land of no aspect
  const grid = gridOf(120, 80, (x, y) => (x < 70 ? 1 : x >= 80 && x < 84 && y >= 30 && y < 34 ? 2 : x >= 100 ? 3 : 0), KINDS);
  const p = buildPieceIndex(grid);
  const aspects = [0, 3, 3, 0];

  it('FR-209 eligible entries are those with a main piece and a valid aspect; the others have nothing', () => {
    const t = placeTerritories(p, aspects, P, SP);
    expect(p.entries).toBe(4);
    expect(Array.from(t.eligible)).toStrictEqual([0, 1, 1, 0]);
    expect(t.boxes).toStrictEqual(territoryBoxes(p, aspects, P));
    expect(t.inLand[3]).toBeUndefined();
    expect(t.placed[3]).toBeUndefined();
    expect(t.placed[0]).toBeUndefined();
    expect(Array.from(placeTerritories(p, [0, 3, Number.NaN, 3], P, SP).eligible)).toStrictEqual([0, 1, 0, 1]);
    expect(Array.from(placeTerritories(p, [0, 3, -1, 0], P, SP).eligible)).toStrictEqual([0, 1, 0, 0]);
  });

  it('FR-198 FR-203 the in-land frame of each eligible entry is the one of its main piece', () => {
    const t = placeTerritories(p, aspects, P, SP);
    const main = mainPieces(p);
    for (const entry of [1, 2]) {
      expect(t.inLand[entry]).toStrictEqual(inLandFrame(p, [main[entry]!], 3, t.boxes[entry], P, SP));
    }
    // the large block keeps its horizontal 005 box object and is not placed
    expect(t.inLand[1]!.shape).toBe('horizontal');
    expect((t.inLand[1] as { shape: 'horizontal'; box: LabelBox }).box).toBe(t.boxes[1]);
    expect(t.placed[1]).toBeUndefined();
  });

  it('FR-203 FR-205 FR-215 the small island goes off-land at the territory height, clear of the block frame', () => {
    const t = placeTerritories(p, aspects, P, SP);
    const placed = t.placed[2];
    if (placed === undefined || placed.shape !== 'off-land') throw new Error('the island must be placed off-land');
    expect(placed.box.h).toBe(SP.offLandHeight.territory);
    expect(placed.box.w).toBe(SP.offLandHeight.territory * 3);
    expect(conflicts([drawnOf(t.placed[1], t.inLand[1]), drawnOf(t.placed[2], t.inLand[2])])).toStrictEqual([]);
  });

  it('FR-206 an entry that cannot get an off-land box keeps its in-land shaped frame, else has no placed frame', () => {
    // a tall thin entry 2 (width 5) in the middle of a sea of "no aspect" cells: shaped fits, off-land cannot be refused
    const thin = placeTerritories(buildPieceIndex(gridOf(60, 100, (x, y) => (x >= 20 && x < 30 && y >= 5 && y < 95 ? 1 : 0), KINDS)), [0, 3], P, SP);
    const frame = thin.inLand[1];
    expect(frame).not.toBeUndefined();
    if (frame!.shape !== 'horizontal') expect(thin.placed[1]).toBe(frame);
  });
});

describe('FR-216 FR-215 faction placement on small grids', () => {
  // A (entry 1) is a tiny island; B (entry 2) and C (entry 3) are large neighbours; D (entry 4) is a spare block
  const grid = gridOf(130, 70, (x, y) => (x >= 4 && x < 10 && y >= 30 && y < 36 ? 1 : x >= 12 && x < 60 ? 2 : x >= 60 ? 3 : 0), KINDS);
  const p = buildPieceIndex(grid);
  const aspects = new Map([[1, 2], [2, 2], [3, 2]]);
  const before = ownersOf({ 1: 1, 2: 2, 3: 3 }, 4);
  const after = ownersOf({ 1: 1, 2: 2, 3: 2 }, 4);

  it('FR-203 FR-215 the tiny faction goes off-land and its box avoids the frame of the neighbour', () => {
    const f = placeFactions(p, before, aspects, P, SP);
    const placed = f.placed.get(1);
    expect(placed?.shape).toBe('off-land');
    const drawn = [1, 2, 3].map((faction) => drawnOf(f.placed.get(faction), f.inLand.get(faction)));
    expect(conflicts(drawn)).toStrictEqual([]);
  });

  it('FR-216 an off-land box is searched again after a step even when the faction itself did not change', () => {
    const first = placeFactions(p, before, aspects, P, SP);
    const stepped = placeFactions(p, after, aspects, P, SP, first);
    const fresh = placeFactions(p, after, aspects, P, SP);
    expect(stepped.recomputed).toStrictEqual([2]);
    expect(stepped.placed).toStrictEqual(fresh.placed);
    expect(stepped.inLand).toStrictEqual(fresh.inLand);
    // the obstacle set changed, so the unchanged faction's off-land box moved: reuse would have been wrong
    expect(fresh.placed.get(1)).not.toStrictEqual(first.placed.get(1));
    // the in-land frame of the unchanged faction is the same object
    expect(stepped.inLand.get(1)).toBe(first.inLand.get(1));
  });

  it('FR-216 a previous layout made with other shape parameters or another piece index is not reused', () => {
    const first = placeFactions(p, before, aspects, P, SP);
    const other = { ...SP, shapeGain: 2 };
    expect(placeFactions(p, before, aspects, P, other, first).recomputed).toStrictEqual([1, 2, 3]);
    expect(placeFactions(p, before, aspects, P, { ...SP, arcBends: [30] }, first).recomputed).toStrictEqual([1, 2, 3]);
    expect(placeFactions(p, before, aspects, P, { ...SP, angleStep: 30 }, first).recomputed).toStrictEqual([1, 2, 3]);
    expect(placeFactions(p, before, aspects, P, { ...SP, offLandReach: 30 }, first).recomputed).toStrictEqual([1, 2, 3]);
    expect(placeFactions(p, before, aspects, P, { ...SP, leaderGap: 8 }, first).recomputed).toStrictEqual([1, 2, 3]);
    expect(placeFactions(p, before, aspects, P, { ...SP, offLandHeight: { faction: 20, territory: 5 } }, first).recomputed).toStrictEqual([1, 2, 3]);
    expect(placeFactions(p, before, aspects, P, { ...SP, offLandHeight: { faction: 18, territory: 6 } }, first).recomputed).toStrictEqual([1, 2, 3]);
    expect(placeFactions(buildPieceIndex(grid), before, aspects, P, SP, first).recomputed).toStrictEqual([1, 2, 3]);
    expect(placeFactions(p, before, aspects, P, SP, first).recomputed).toStrictEqual([]);
  });

  it('FR-216 a faction whose main region changed gets its in-land frame again, even with the same label index', () => {
    const first = placeFactions(p, before, aspects, P, SP);
    const stepped = placeFactions(p, after, aspects, P, SP, first);
    expect(stepped.inLand.get(2)).not.toStrictEqual(first.inLand.get(2));
    expect(stepped.inLand.get(2)).toStrictEqual(placeFactions(p, after, aspects, P, SP).inLand.get(2));
  });
});

describe('NFR-39 FR-213 layout and placement read no clock and no random source', () => {
  it('NFR-39 the same results come back while Math.random, Date.now and performance.now throw', () => {
    const grid = gridOf(130, 70, (x, y) => (x >= 4 && x < 10 && y >= 30 && y < 36 ? 1 : x >= 12 && x < 60 ? 2 : x >= 60 ? 3 : 0), KINDS);
    const p = buildPieceIndex(grid);
    const owners = ownersOf({ 1: 1, 2: 2, 3: 3 }, 4);
    const aspects = new Map([[1, 2], [2, 2], [3, 2]]);
    const normal = [placeTerritories(p, [0, 2, 2, 2], P, SP), placeFactions(p, owners, aspects, P, SP)] as const;
    const boom = (): never => {
      throw new Error('forbidden');
    };
    const spies = [vi.spyOn(Math, 'random').mockImplementation(boom), vi.spyOn(Date, 'now').mockImplementation(boom), vi.spyOn(performance, 'now').mockImplementation(boom)];
    try {
      const guarded = [placeTerritories(p, [0, 2, 2, 2], P, SP), placeFactions(p, owners, aspects, P, SP)] as const;
      expect(guarded[0]).toStrictEqual(normal[0]);
      expect(guarded[1]).toStrictEqual(normal[1]);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('NFR-39 the layout digest covers every field of every frame', () => {
  const horizontalBox: LabelBox = { x0: 3, y0: 4, h: 5, w: 15 };
  const base = (): { t: TerritoryLayout; f: FactionLayout } => ({
    t: {
      boxes: [undefined, horizontalBox, undefined, undefined],
      inLand: [undefined, { shape: 'horizontal', box: horizontalBox }, { shape: 'straight', cx: 10.5, cy: 11.5, angle: 45, h: 7, w: 21 }, undefined],
      placed: [undefined, undefined, { shape: 'straight', cx: 10.5, cy: 11.5, angle: 45, h: 7, w: 21 }, { shape: 'off-land', box: horizontalBox, gap2: 49, anchor: 77, leader: { x1: 1, y1: 2, x2: 3, y2: 4 } }],
      eligible: Uint8Array.from([0, 1, 1, 1]),
    },
    f: {
      boxes: { index: undefined as unknown as PieceIndex, params: P, labels: new Map([[2, { pieces: [0], aspect: 2, box: horizontalBox }], [5, { pieces: [1], aspect: 2, box: undefined }]]), recomputed: [] },
      inLand: new Map<number, InLandFrame | undefined>([
        [2, { shape: 'arc', cx: 1.5, cy: 2.5, angle: -30, h: 6, w: 18, bend: -60, radius: 40 }],
        [5, undefined],
      ]),
      placed: new Map<number, Placed>([[2, { shape: 'arc', cx: 1.5, cy: 2.5, angle: -30, h: 6, w: 18, bend: -60, radius: 40 }]]),
      recomputed: [],
      shapeParams: SP,
    },
  });
  const digestOf = (m: { t: TerritoryLayout; f: FactionLayout }): string => layoutDigest(m.t, [m.f]);

  it('NFR-39 equal layouts have equal digests and a change of any field changes it', () => {
    const reference = digestOf(base());
    expect(digestOf(base())).toBe(reference);
    const changes: ((m: ReturnType<typeof base>) => void)[] = [
      (m) => ((m.t.boxes as (LabelBox | undefined)[])[1] = { ...horizontalBox, x0: 4 }),
      (m) => ((m.t.boxes as (LabelBox | undefined)[])[1] = { ...horizontalBox, y0: 5 }),
      (m) => ((m.t.boxes as (LabelBox | undefined)[])[1] = { ...horizontalBox, h: 6 }),
      (m) => ((m.t.boxes as (LabelBox | undefined)[])[1] = { ...horizontalBox, w: 16 }),
      (m) => ((m.t.boxes as (LabelBox | undefined)[])[1] = undefined),
      (m) => ((m.t.inLand as (InLandFrame | undefined)[])[1] = { shape: 'horizontal', box: { ...horizontalBox, x0: 9 } }),
      (m) => ((m.t.inLand as (InLandFrame | undefined)[])[2] = { shape: 'straight', cx: 11.5, cy: 11.5, angle: 45, h: 7, w: 21 }),
      (m) => ((m.t.inLand as (InLandFrame | undefined)[])[2] = { shape: 'straight', cx: 10.5, cy: 12.5, angle: 45, h: 7, w: 21 }),
      (m) => ((m.t.inLand as (InLandFrame | undefined)[])[2] = { shape: 'straight', cx: 10.5, cy: 11.5, angle: 60, h: 7, w: 21 }),
      (m) => ((m.t.inLand as (InLandFrame | undefined)[])[2] = { shape: 'straight', cx: 10.5, cy: 11.5, angle: 45, h: 8, w: 21 }),
      (m) => ((m.t.inLand as (InLandFrame | undefined)[])[2] = { shape: 'straight', cx: 10.5, cy: 11.5, angle: 45, h: 7, w: 22 }),
      (m) => ((m.t.inLand as (InLandFrame | undefined)[])[2] = undefined),
      (m) => ((m.t.placed as (Placed | undefined)[])[3] = { shape: 'off-land', box: { ...horizontalBox, x0: 4 }, gap2: 49, anchor: 77, leader: { x1: 1, y1: 2, x2: 3, y2: 4 } }),
      (m) => ((m.t.placed as (Placed | undefined)[])[3] = { shape: 'off-land', box: horizontalBox, gap2: 50, anchor: 77, leader: { x1: 1, y1: 2, x2: 3, y2: 4 } }),
      (m) => ((m.t.placed as (Placed | undefined)[])[3] = { shape: 'off-land', box: horizontalBox, gap2: 49, anchor: 78, leader: { x1: 1, y1: 2, x2: 3, y2: 4 } }),
      (m) => ((m.t.placed as (Placed | undefined)[])[3] = { shape: 'off-land', box: horizontalBox, gap2: 49, anchor: 77, leader: { x1: 9, y1: 2, x2: 3, y2: 4 } }),
      (m) => ((m.t.placed as (Placed | undefined)[])[3] = { shape: 'off-land', box: horizontalBox, gap2: 49, anchor: 77, leader: { x1: 1, y1: 9, x2: 3, y2: 4 } }),
      (m) => ((m.t.placed as (Placed | undefined)[])[3] = { shape: 'off-land', box: horizontalBox, gap2: 49, anchor: 77, leader: { x1: 1, y1: 2, x2: 9, y2: 4 } }),
      (m) => ((m.t.placed as (Placed | undefined)[])[3] = { shape: 'off-land', box: horizontalBox, gap2: 49, anchor: 77, leader: { x1: 1, y1: 2, x2: 3, y2: 9 } }),
      (m) => ((m.t.placed as (Placed | undefined)[])[3] = { shape: 'off-land', box: horizontalBox, gap2: 49, anchor: 77 }),
      (m) => (m.t.eligible[0] = 1),
      (m) => (m.f.inLand = new Map([[2, { shape: 'arc', cx: 2.5, cy: 2.5, angle: -30, h: 6, w: 18, bend: -60, radius: 40 }], [5, undefined]])),
      (m) => (m.f.inLand = new Map([[2, { shape: 'arc', cx: 1.5, cy: 3.5, angle: -30, h: 6, w: 18, bend: -60, radius: 40 }], [5, undefined]])),
      (m) => (m.f.inLand = new Map([[2, { shape: 'arc', cx: 1.5, cy: 2.5, angle: -45, h: 6, w: 18, bend: -60, radius: 40 }], [5, undefined]])),
      (m) => (m.f.inLand = new Map([[2, { shape: 'arc', cx: 1.5, cy: 2.5, angle: -30, h: 7, w: 18, bend: -60, radius: 40 }], [5, undefined]])),
      (m) => (m.f.inLand = new Map([[2, { shape: 'arc', cx: 1.5, cy: 2.5, angle: -30, h: 6, w: 19, bend: -60, radius: 40 }], [5, undefined]])),
      (m) => (m.f.inLand = new Map([[2, { shape: 'arc', cx: 1.5, cy: 2.5, angle: -30, h: 6, w: 18, bend: 60, radius: 40 }], [5, undefined]])),
      (m) => (m.f.inLand = new Map([[2, { shape: 'arc', cx: 1.5, cy: 2.5, angle: -30, h: 6, w: 18, bend: -60, radius: 41 }], [5, undefined]])),
      (m) => (m.f.placed = new Map()),
      (m) => (m.f.boxes = { ...m.f.boxes, labels: new Map([[2, { pieces: [0], aspect: 2, box: { ...horizontalBox, h: 6 } }], [5, { pieces: [1], aspect: 2, box: undefined }]]) }),
      (m) => (m.f.boxes = { ...m.f.boxes, labels: new Map([[3, { pieces: [0], aspect: 2, box: horizontalBox }], [5, { pieces: [1], aspect: 2, box: undefined }]]) }),
    ];
    const seen = new Set<string>([reference]);
    for (const [i, change] of changes.entries()) {
      const m = base();
      change(m);
      const d = digestOf(m);
      expect(d, `change ${i}`).not.toBe(reference);
      seen.add(d);
    }
    expect(seen.size).toBe(changes.length + 1);
    // the number of states and their order matter
    const m = base();
    expect(layoutDigest(m.t, [m.f, m.f])).not.toBe(layoutDigest(m.t, [m.f]));
    expect(layoutDigest(m.t, [])).not.toBe(layoutDigest(m.t, [m.f]));
  });
});

describe('FR-206 FR-209 FR-213 FR-215 FR-216 NFR-41 the dev map, seed 1, rounds 0..T', { timeout: 120000 }, () => {
  let run: DevRun;
  beforeAll(async () => {
    run = await devRun();
  }, 120000);

  it('FR-209 the territory layout is the same at rounds 0..T and takes no owner table', () => {
    expect(placeTerritories.length).toBe(4);
    expect(run.rounds).toBe(4);
    const again = placeTerritories(run.p, run.territoryAspects, P, SP);
    expect(again).toStrictEqual(run.territories);
    for (let round = 0; round <= run.rounds; round++) placeFactions(run.p, run.tables[round]!, run.factionAspects, P, SP);
    expect(placeTerritories(run.p, run.territoryAspects, P, SP)).toStrictEqual(run.territories);
    const main = mainPieces(run.p);
    let eligible = 0;
    for (let e = 1; e < run.p.entries; e++) {
      if (run.territoryAspects[e]! > 0 && main[e]! >= 0) eligible++;
    }
    expect(Array.from(run.territories.eligible).reduce((a, b) => a + b, 0)).toBe(eligible);
    expect(eligible).toBeGreaterThan(50);
  });

  it('FR-206 FR-215 no two drawn labels of one role conflict: territories once, factions at every round (fallbacks included)', () => {
    const territory = run.territories.eligible.length;
    const drawn: (InLandFrame | Placed | undefined)[] = [];
    for (let e = 0; e < territory; e++) drawn.push(run.territories.eligible[e] === 1 ? drawnOf(run.territories.placed[e], run.territories.inLand[e]) : undefined);
    expect(conflicts(drawn)).toStrictEqual([]);
    const kinds = { shaped: 0, offLand: 0, horizontal: 0, none: 0 };
    for (const frame of drawn) {
      if (frame === undefined) kinds.none++;
      else if (frame.shape === 'off-land') kinds.offLand++;
      else if (frame.shape === 'horizontal') kinds.horizontal++;
      else kinds.shaped++;
    }
    console.log(`label-place: territories ${JSON.stringify(kinds)}`);
    for (let round = 0; round <= run.rounds; round++) {
      const f = run.factions[round]!;
      const frames = [...f.boxes.labels.keys()].map((faction) => drawnOf(f.placed.get(faction), f.inLand.get(faction)));
      expect(conflicts(frames), `round ${round}`).toStrictEqual([]);
      const fk = frames.map((x) => (x === undefined ? 'none' : x.shape));
      console.log(`label-place: round ${round} factions ${fk.join(' ')}`);
    }
  });

  it('FR-198 FR-203 FR-206 each placed frame is an off-land box or the shaped in-land frame of its label', () => {
    for (let e = 0; e < run.territories.eligible.length; e++) {
      const placed = run.territories.placed[e];
      if (placed === undefined) continue;
      expect(run.territories.eligible[e], `entry ${e}`).toBe(1);
      if (placed.shape !== 'off-land') expect(placed, `entry ${e}`).toBe(run.territories.inLand[e]);
    }
    for (let round = 0; round <= run.rounds; round++) {
      const f = run.factions[round]!;
      expect([...f.inLand.keys()]).toStrictEqual([...f.boxes.labels.keys()]);
      for (const [faction, placed] of f.placed) {
        if (placed.shape !== 'off-land') expect(placed, `round ${round} faction ${faction}`).toBe(f.inLand.get(faction));
      }
      for (const [faction, label] of f.boxes.labels) {
        expect(f.inLand.get(faction), `round ${round} faction ${faction}`).toStrictEqual(inLandFrame(run.p, label.pieces, label.aspect, label.box, P, SP));
      }
    }
  });

  it('NFR-41 every label drawn as an in-land horizontal frame has exactly its 005 box, at every round', () => {
    const boxes = territoryBoxes(run.p, run.territoryAspects, P);
    let horizontal = 0;
    for (let e = 0; e < run.territories.eligible.length; e++) {
      const inLand = run.territories.inLand[e];
      if (inLand?.shape === 'horizontal') {
        expect(inLand.box, `entry ${e}`).toBe(run.territories.boxes[e]);
        expect(inLand.box, `entry ${e}`).toStrictEqual(boxes[e]);
        if (run.territories.placed[e] === undefined) horizontal++;
      }
    }
    expect(horizontal).toBeGreaterThan(30);
    for (let round = 0; round <= run.rounds; round++) {
      const f = run.factions[round]!;
      for (const [faction, label] of f.boxes.labels) {
        const inLand = f.inLand.get(faction);
        if (inLand?.shape === 'horizontal') expect(inLand.box, `round ${round} faction ${faction}`).toBe(label.box);
      }
    }
  });

  it('FR-216 for every step and jump the reuse of the state being left equals a computation from that state alone', () => {
    const fresh = run.factions;
    let steps = 0;
    for (let from = 0; from <= run.rounds; from++) {
      for (let to = 0; to <= run.rounds; to++) {
        const reused = placeFactions(run.p, run.tables[to]!, run.factionAspects, P, SP, fresh[from]);
        const want = fresh[to]!;
        expect(reused.boxes.labels, `from ${from} to ${to}`).toStrictEqual(want.boxes.labels);
        expect(reused.inLand, `from ${from} to ${to}`).toStrictEqual(want.inLand);
        expect(reused.placed, `from ${from} to ${to}`).toStrictEqual(want.placed);
        // only the factions whose label was laid out again have their in-land frame computed again
        expect(reused.recomputed, `from ${from} to ${to}`).toStrictEqual(reused.boxes.recomputed);
        if (from === to) expect(reused.recomputed).toStrictEqual([]);
        if (Math.abs(from - to) === 1) {
          steps++;
          expect(reused.recomputed.length, `step ${from} -> ${to}`).toBeLessThanOrEqual(to > from ? 1 : 2);
          // an unchanged faction keeps the very same in-land frame object
          for (const [faction, frame] of reused.inLand) {
            if (!reused.recomputed.includes(faction) && frame !== undefined) expect(frame, `step ${from} -> ${to} faction ${faction}`).toBe(fresh[from]!.inLand.get(faction));
          }
        }
      }
    }
    expect(steps).toBe(8);
  });

  it('FR-216 a step recomputes the changed region only (counts logged)', () => {
    for (let round = 0; round < run.rounds; round++) {
      const step = placeFactions(run.p, run.tables[round + 1]!, run.factionAspects, P, SP, run.factions[round]);
      console.log(`label-place: step ${round} -> ${round + 1} recomputed in-land frames ${JSON.stringify(step.recomputed)} of ${step.boxes.labels.size}`);
      expect(step.recomputed.length).toBe(1);
    }
    expect(DEV_FACTION_ASPECT).toBe(4);
  });

  it('NFR-39 the D11 digest of the dev-map placement is pinned and does not depend on the run', async () => {
    const digest = layoutDigest(run.territories, run.factions);
    const second = await devRun();
    expect(layoutDigest(second.territories, second.factions)).toBe(digest);
    console.log(`label-place: D11 layout digest ${digest}`);
    expect(digest).toBe('c3ecf3e435ce3f29');
  });
});
