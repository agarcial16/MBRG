import { beforeAll, describe, expect, it } from 'vitest';
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import type { Rgb } from '@mbrg/shared';
import { renderReference } from '../src/core/borders';
import type { IndexGrid } from '../src/core/borders';
import type { Camera, Viewport } from '../src/core/camera';
import { buildEntryIndex, factionIndexOf, ownerTable } from '../src/core/entries';
import type { EntryIndex } from '../src/core/entries';
import { frontAt, frontField } from '../src/core/front';
import type { FrontField } from '../src/core/front';
import { decodeIdPng } from '../src/core/png';
import { buildPieceIndex } from '../src/core/regions';
import { sceneAt } from '../src/core/scene';
import type { SimPort } from '../src/core/scene';
import { THEME } from '../src/core/theme';
import { TRANSITION_PRIORITY, renderTransitionReference, shadeTransition } from '../src/core/transition-shade';
import { inflateStream } from '../src/ui/load';
import { DEV_MAP, DEV_PRESENTATION, devPngBytes } from './helpers/dev-map';
import { gridFrom, gridOf } from './helpers/label-grids';

const KINDS = { 1: 'land', 2: 'land', 3: 'land', 4: 'land', 5: 'land', 6: 'sea' } as const;
const COLORS: Rgb[] = [
  [0, 0, 0],
  [200, 40, 40], // faction 1: the absorber
  [40, 40, 200], // faction 2: the eliminated faction
  [40, 200, 40], // faction 3: a third faction
];
const A: Rgb = [200, 40, 40];
const E: Rgb = [40, 40, 200];
const FACTION_LINE = THEME.border.faction; // 74, 59, 44

function frontOf(grid: IndexGrid, moved: number[], before: number[], absorber: number): FrontField {
  return frontField(buildPieceIndex(grid), new Set(moved), before, absorber);
}

function shadeAt(grid: IndexGrid, before: number[], after: number[], front: FrontField, f: number, cam: Camera, vp: Viewport, fx: number, fy: number) {
  return shadeTransition(grid, before, after, COLORS, THEME, front, f, cam, vp, fx, fy);
}

describe('FR-180 the overlap order of the interpolated line', () => {
  it('FR-180 the order is faction, absorbed, outer, coast, shore, sea-zone, territory', () => {
    expect(TRANSITION_PRIORITY).toStrictEqual(['faction', 'absorbed', 'outer', 'coast', 'shore', 'sea-zone', 'territory']);
  });
});

// A mixed grid: absorber entries 1 and 5, eliminated entries 2 and 3, a third faction entry 4, sea 6, outside 0.
const MIXED = gridOf(
  14,
  10,
  (x, y) => {
    if (y === 9 && x < 3) return 0;
    if (x >= 11) return 6;
    if (x < 4) return y >= 6 && x < 2 ? 5 : 1;
    if (x < 6) return 2;
    if (x < 8) return 3;
    return 4;
  },
  KINDS,
);
const MIXED_BEFORE = [0, 1, 2, 2, 3, 1, 0];
const MIXED_AFTER = [0, 1, 1, 1, 3, 1, 0];
const MIXED_FRONT = frontOf(MIXED, [2, 3], MIXED_BEFORE, 1);

// A T-junction: the eliminated entry 2 touches the absorber (left) and the third faction entry 4 (below).
const JUNCTION = gridFrom(
  [
    [1, 1, 2, 2],
    [1, 1, 2, 2],
    [1, 1, 4, 4],
    [1, 1, 4, 4],
  ],
  KINDS,
);
const JUNCTION_BEFORE = [0, 1, 2, 2, 3];
const JUNCTION_AFTER = [0, 1, 1, 2, 3];
const JUNCTION_FRONT = frontOf(JUNCTION, [2], JUNCTION_BEFORE, 1);

const CAMERAS: { cam: Camera; vp: Viewport; dpr: number }[] = [
  { cam: { x: 7, y: 5, scale: 2.3 }, vp: { width: 36, height: 28 }, dpr: 1 },
  { cam: { x: 6, y: 4.5, scale: 1 }, vp: { width: 20, height: 14 }, dpr: 1.5 },
  { cam: { x: 3.2, y: 6.1, scale: 6 }, vp: { width: 30, height: 24 }, dpr: 1 },
  { cam: { x: 7, y: 5, scale: 0.8 }, vp: { width: 24, height: 16 }, dpr: 2 },
  { cam: { x: 8, y: 4, scale: 3.7 }, vp: { width: 33, height: 21 }, dpr: 1.25 },
];

describe('FR-179 FR-180 the first and the last drawing are the instant drawings', () => {
  it('FR-179 at forward progress 0 every pixel equals the earlier drawing, for several cameras and pixel ratios', () => {
    for (const { cam, vp, dpr } of CAMERAS) {
      const got = renderTransitionReference(MIXED, MIXED_BEFORE, MIXED_AFTER, COLORS, THEME, MIXED_FRONT, 0, cam, vp, dpr);
      const want = renderReference(MIXED, MIXED_BEFORE, COLORS, THEME, cam, vp, dpr);
      expect(Array.from(got), JSON.stringify(cam)).toStrictEqual(Array.from(want));
    }
  });

  it('FR-179 at forward progress 1 every pixel equals the later drawing, for several cameras and pixel ratios', () => {
    for (const { cam, vp, dpr } of CAMERAS) {
      const got = renderTransitionReference(MIXED, MIXED_BEFORE, MIXED_AFTER, COLORS, THEME, MIXED_FRONT, 1, cam, vp, dpr);
      const want = renderReference(MIXED, MIXED_AFTER, COLORS, THEME, cam, vp, dpr);
      expect(Array.from(got), JSON.stringify(cam)).toStrictEqual(Array.from(want));
    }
  });

  it('FR-180 the junction grid also starts and ends on the instant drawings', () => {
    const cam = { x: 2, y: 2, scale: 8 };
    const vp = { width: 32, height: 32 };
    const zero = renderTransitionReference(JUNCTION, JUNCTION_BEFORE, JUNCTION_AFTER, COLORS, THEME, JUNCTION_FRONT, 0, cam, vp, 1);
    const one = renderTransitionReference(JUNCTION, JUNCTION_BEFORE, JUNCTION_AFTER, COLORS, THEME, JUNCTION_FRONT, 1, cam, vp, 1);
    expect(Array.from(zero)).toStrictEqual(Array.from(renderReference(JUNCTION, JUNCTION_BEFORE, COLORS, THEME, cam, vp, 1)));
    expect(Array.from(one)).toStrictEqual(Array.from(renderReference(JUNCTION, JUNCTION_AFTER, COLORS, THEME, cam, vp, 1)));
  });

  it('FR-179 a progress in between draws something different from both ends', () => {
    const { cam, vp, dpr } = CAMERAS[0]!;
    const mid = Array.from(renderTransitionReference(MIXED, MIXED_BEFORE, MIXED_AFTER, COLORS, THEME, MIXED_FRONT, 0.5, cam, vp, dpr));
    expect(mid).not.toStrictEqual(Array.from(renderReference(MIXED, MIXED_BEFORE, COLORS, THEME, cam, vp, dpr)));
    expect(mid).not.toStrictEqual(Array.from(renderReference(MIXED, MIXED_AFTER, COLORS, THEME, cam, vp, dpr)));
  });

  it('FR-179 a forward progress outside 0..1 or not a number is an error', () => {
    const { cam, vp } = CAMERAS[0]!;
    for (const f of [-0.1, 1.1, Number.NaN]) {
      expect(() => shadeAt(MIXED, MIXED_BEFORE, MIXED_AFTER, MIXED_FRONT, f, cam, vp, 5, 5), String(f)).toThrow(RangeError);
    }
  });

  it('FR-179 a moved unit that the front field does not cover is an error', () => {
    const empty = frontOf(MIXED, [], MIXED_BEFORE, 1);
    const cam = { x: 5, y: 5, scale: 8 };
    expect(() => shadeAt(MIXED, MIXED_BEFORE, MIXED_AFTER, empty, 0.5, cam, { width: 16, height: 16 }, 8, 8)).toThrow(RangeError);
  });
});

describe('FR-179 the colour front', () => {
  // two rows: absorber entry 1 (x 0..1) and the eliminated entry 2 (x 2..7), contact at x = 2, front 0, .2, .4, .6, .8, 1
  const ROW = gridFrom([[1, 1, 2, 2, 2, 2, 2, 2], [1, 1, 2, 2, 2, 2, 2, 2]], KINDS);
  const BEFORE = [0, 1, 2];
  const AFTER = [0, 1, 1];
  const FRONT = frontOf(ROW, [2], BEFORE, 1);
  const cam: Camera = { x: 4, y: 1, scale: 8 };
  const vp: Viewport = { width: 64, height: 16 };
  const centre = (x: number): [number, number] => [(x + 0.5 - 4) * 8 + 32, 4];

  const coloured = (f: number): number[] => {
    const out: number[] = [];
    for (let x = 2; x <= 7; x++) {
      const [fx, fy] = centre(x);
      const c = shadeAt(ROW, BEFORE, AFTER, FRONT, f, cam, vp, fx, fy).color;
      if (c[0] === A[0] && c[1] === A[1] && c[2] === A[2]) out.push(x);
      else expect(c, `x ${x} f ${f}`).toStrictEqual(E);
    }
    return out;
  };

  it('FR-179 a unit is in the absorber colour when its normalised distance is below the forward progress', () => {
    expect(coloured(0)).toStrictEqual([]);
    expect(coloured(0.1)).toStrictEqual([2]);
    expect(coloured(0.5)).toStrictEqual([2, 3, 4]);
    expect(coloured(0.99)).toStrictEqual([2, 3, 4, 5, 6]);
  });

  it('FR-179 a unit whose normalised distance equals the progress is still in the eliminated colour', () => {
    expect(frontAt(FRONT, 3, 0)).toBe(Math.fround(0.2));
    expect(coloured(0.2)).toStrictEqual([2]);
    expect(coloured(Math.fround(0.2) + 1e-6)).toStrictEqual([2, 3]);
    // the comparison is made in float32: a progress that rounds to the distance does not pass it
    expect(coloured(Math.fround(0.2) + 1e-10)).toStrictEqual([2]);
  });

  it('FR-179 the coloured set only grows with the forward progress and everything is coloured at 1', () => {
    let previous = 0;
    for (const f of [0, 0.05, 0.15, 0.25, 0.45, 0.65, 0.85, 0.999]) {
      const now = coloured(f).length;
      expect(now).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
    const [fx, fy] = centre(7);
    expect(shadeAt(ROW, BEFORE, AFTER, FRONT, 1, cam, vp, fx, fy).color).toStrictEqual(A);
  });

  it('FR-180 no line is drawn along the colour front: pixels of one entry are only ever the two fill colours', () => {
    for (const f of [0.1, 0.3, 0.5, 0.7]) {
      const seen = new Set<string>();
      for (let fx = 19; fx < 62; fx += 0.25) {
        const shaded = shadeAt(ROW, BEFORE, AFTER, FRONT, f, cam, vp, fx, 4);
        expect(shaded.border, `f ${f} fx ${fx}`).toBeNull();
        seen.add(shaded.color.join(','));
      }
      expect([...seen].sort()).toStrictEqual([A.join(','), E.join(',')].sort());
    }
  });

  it('FR-180 the line between the eliminated territory and the absorber goes from the faction line to the territory line', () => {
    const at = (f: number, fx: number) => shadeAt(ROW, BEFORE, AFTER, FRONT, f, cam, vp, fx, 4);
    // edge at map x = 2, fx = (2 - 4) * 8 + 32 = 16; the pixel on either side is in the band
    expect(at(0, 16.8).color).toStrictEqual(FACTION_LINE);
    expect(at(0, 16.8).border).toBe('absorbed');
    // f = 0.25: alpha 0.825, line (88, 50.75, 39.5) over the absorber fill
    expect(at(0.25, 16.8).color).toStrictEqual([108, 49, 40]);
    // f = 0.5: alpha 0.65, line (102, 42.5, 35)
    expect(at(0.5, 16.8).color).toStrictEqual([136, 42, 37]);
    expect(at(0.5, 15.2).color).toStrictEqual([136, 42, 37]);
    // f = 1 is the later drawing: the two entries now share an owner, so the edge is a territory line
    expect(at(1, 16.8).border).toBe('territory');
  });

  it('FR-180 two transferred territories get a territory line whose colour goes from the eliminated to the absorber colour', () => {
    const two = gridFrom([[1, 2, 2, 3, 3], [1, 2, 2, 3, 3]], KINDS);
    const before = [0, 1, 2, 2];
    const after = [0, 1, 1, 1];
    const front = frontOf(two, [2, 3], before, 1);
    const c: Camera = { x: 3, y: 1, scale: 8 };
    const v: Viewport = { width: 48, height: 16 };
    // edge between the two at map x = 3, fx = 24; front 0, 1/3, 2/3, 1 over x = 1..4, so at 0.5 the left side is coloured
    const left = shadeAt(two, before, after, front, 0.5, c, v, 23.2, 4);
    const right = shadeAt(two, before, after, front, 0.5, c, v, 24.8, 4);
    expect(left.border).toBe('territory');
    expect(left.color).toStrictEqual([163, 36, 51]);
    expect(right.border).toBe('territory');
    expect(right.color).toStrictEqual([51, 36, 163]);
    // at 0 it is the earlier territory line (eliminated colour darkened), at 1 the later one
    expect(shadeAt(two, before, after, front, 0, c, v, 24.8, 4).color).toStrictEqual([
      Math.round(E[0] * 0.7 + Math.floor(E[0] * 0.65) * 0.3),
      Math.round(E[1] * 0.7 + Math.floor(E[1] * 0.65) * 0.3),
      Math.round(E[2] * 0.7 + Math.floor(E[2] * 0.65) * 0.3),
    ]);
  });

  it('FR-180 a territory line between two territories that do not move is the same at every progress', () => {
    const base = shadeAt(MIXED, MIXED_BEFORE, MIXED_AFTER, MIXED_FRONT, 0, { x: 3, y: 8, scale: 8 }, { width: 32, height: 32 }, 8.4, 16);
    for (const f of [0.25, 0.5, 0.75]) {
      const now = shadeAt(MIXED, MIXED_BEFORE, MIXED_AFTER, MIXED_FRONT, f, { x: 3, y: 8, scale: 8 }, { width: 32, height: 32 }, 8.4, 16);
      expect(now.color, `f ${f}`).toStrictEqual(base.color);
    }
    expect(base.border).toBe('territory');
  });
});

describe('FR-180 lines of other pairs stay as they are', () => {
  it('FR-180 an edge between a transferred territory and a third faction keeps the faction line at every progress', () => {
    const cam = { x: 8, y: 5, scale: 8 };
    const vp = { width: 32, height: 32 };
    for (const f of [0, 0.3, 0.5, 0.9]) {
      for (const fx of [15.2, 16.8]) {
        const shaded = shadeAt(MIXED, MIXED_BEFORE, MIXED_AFTER, MIXED_FRONT, f, cam, vp, fx, 16);
        expect(shaded.border, `f ${f} fx ${fx}`).toBe('faction');
        expect(shaded.color).toStrictEqual(FACTION_LINE);
      }
    }
  });

  it('FR-180 where a faction line and the interpolated line meet on one pixel, the faction line wins', () => {
    const cam = { x: 2, y: 2, scale: 8 };
    const vp = { width: 32, height: 32 };
    // map point (2.1, 1.9): absorbed edge on the left, faction edge below
    const shaded = shadeAt(JUNCTION, JUNCTION_BEFORE, JUNCTION_AFTER, JUNCTION_FRONT, 0.5, cam, vp, 16.8, 15.2);
    expect(shaded.border).toBe('faction');
    expect(shaded.color).toStrictEqual(FACTION_LINE);
  });

  it('FR-180 where the interpolated line meets an outer line, the interpolated line wins', () => {
    const cam = { x: 2, y: 2, scale: 8 };
    const vp = { width: 32, height: 32 };
    // map point (2.1, 0.05): absorbed edge on the left (4 px), outside the image above (2 px)
    const shaded = shadeAt(JUNCTION, JUNCTION_BEFORE, JUNCTION_AFTER, JUNCTION_FRONT, 0.5, cam, vp, 16.8, 0.4);
    expect(shaded.border).toBe('absorbed');
    expect(shaded.color).toStrictEqual([136, 42, 37]);
  });
});

describe('FR-179 the backward drawing is the forward drawing in the opposite order', () => {
  it('FR-179 the frame at forward progress 1 - p is the same whichever way it is reached, and drawing is pure', () => {
    const { cam, vp, dpr } = CAMERAS[2]!;
    const steps = [0, 0.25, 0.5, 0.75, 1];
    const draw = (f: number) => Array.from(renderTransitionReference(MIXED, MIXED_BEFORE, MIXED_AFTER, COLORS, THEME, MIXED_FRONT, f, cam, vp, dpr));
    const forward = steps.map((p) => draw(p));
    const backward = steps.map((p) => draw(1 - p));
    expect(backward).toStrictEqual([...forward].reverse());
    expect(steps.map((p) => draw(p))).toStrictEqual(forward);
  });
});

describe('FR-179 FR-180 on the dev map, seed 1, step 0 to 1', () => {
  let index: EntryIndex;
  let before: Uint8Array;
  let after: Uint8Array;
  let front: FrontField;
  let colors: Rgb[];
  const REAL: SimPort = { totalRounds, getState, getRounds, ownerOf };
  const factionIndex = factionIndexOf(DEV_MAP);

  beforeAll(async () => {
    const decoded = await decodeIdPng(devPngBytes(), inflateStream);
    if (!decoded.ok) throw new Error('png');
    index = buildEntryIndex(DEV_MAP, decoded.value.width, decoded.value.height, decoded.value.values);
    const s0 = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, 0, REAL);
    const s1 = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, 1, REAL);
    if (!s0.ok || !s1.ok || s1.value.record === undefined) throw new Error('scene');
    before = ownerTable(index, s0.value.owners, factionIndex);
    after = ownerTable(index, s1.value.owners, factionIndex);
    const moved = new Set<number>();
    for (let e = 1; e < index.fills.length; e++) if (before[e] !== after[e]) moved.add(e);
    front = frontField(buildPieceIndex(index), moved, before, factionIndex.get(s1.value.record.absorber)!);
    colors = [[0, 0, 0], ...THEME.palette.slice(0, factionIndex.size)];
  });

  it('FR-179 FR-180 a window on a contact border starts on the earlier drawing and ends on the later one', () => {
    let seed = -1;
    for (let i = 0; i < front.values.length && seed < 0; i++) if (front.values[i] === 0) seed = i;
    const cam: Camera = { x: front.x0 + (seed % front.width) + 0.5, y: front.y0 + Math.floor(seed / front.width) + 0.5, scale: 4 };
    const vp: Viewport = { width: 80, height: 60 };
    const draw = (f: number) => Array.from(renderTransitionReference(index, before, after, colors, THEME, front, f, cam, vp, 1));
    const earlier = Array.from(renderReference(index, before, colors, THEME, cam, vp, 1));
    const later = Array.from(renderReference(index, after, colors, THEME, cam, vp, 1));
    expect(draw(0)).toStrictEqual(earlier);
    expect(draw(1)).toStrictEqual(later);
    const mid = draw(0.5);
    expect(mid).not.toStrictEqual(earlier);
    expect(mid).not.toStrictEqual(later);
  });
});
