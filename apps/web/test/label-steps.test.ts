import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import { buildEntryIndex, factionIndexOf, ownerTable } from '../src/core/entries';
import { drawable, frameOf, instantLabels, labelAlpha, labelsAt, screenFrame } from '../src/core/label-frame';
import type { AnyLabelDraw, FactionLabelInput, FrameData, LabelDraw, RoundLabels, ShapedDraw, StepLabels, TerritoryLabelInput } from '../src/core/label-frame';
import { labelTexts, roundLabels } from '../src/core/label-input';
import { factionBoxes, territoryBoxes } from '../src/core/label-layout';
import type { LabelBox } from '../src/core/label-layout';
import { LABEL_PARAMS } from '../src/core/label-params';
import type { LeaderLine, OffLand } from '../src/core/label-offland';
import { decodeIdPng } from '../src/core/png';
import { buildPieceIndex } from '../src/core/regions';
import { sceneAt } from '../src/core/scene';
import type { SimPort } from '../src/core/scene';
import type { ArcFrame, ShapedFrame, StraightFrame } from '../src/core/label-shape';
import { inflateStream } from '../src/ui/load';
import { DEV_MAP, DEV_PRESENTATION, devPngBytes } from './helpers/dev-map';

const P = LABEL_PARAMS;
const sim: SimPort = { totalRounds, getState, getRounds, ownerOf };
const FS = [0, 0.25, 0.5, 0.75, 1];

// ---- drawn-frame fixtures (binary-exact numbers, so interpolated values compare with toStrictEqual) ----
const box = (x0: number, y0: number, h: number, w: number): LabelBox => ({ x0, y0, h, w });
const straight = (cx: number, cy: number, angle: number, h: number, w: number): StraightFrame => ({ shape: 'straight', cx, cy, angle, h, w });
const arc = (cx: number, cy: number, bend: number): ArcFrame => ({ shape: 'arc', cx, cy, angle: 0, h: 8, w: 40, bend, radius: 200 });
const off = (b: LabelBox, leader?: LeaderLine): OffLand => ({ shape: 'off-land', box: b, gap2: 100, anchor: 7, ...(leader !== undefined ? { leader } : {}) });
const LEADER: LeaderLine = { x1: 1, y1: 2, x2: 3, y2: 4 };

type Spec = LabelBox | ShapedFrame | OffLand | undefined;
function factionOf(faction: number, text: string, aspect: number, spec: Spec): FactionLabelInput {
  if (spec === undefined) return { faction, text, box: undefined, aspect };
  if ('shape' in spec && (spec.shape === 'straight' || spec.shape === 'arc')) return { faction, text, box: undefined, aspect, frame: spec };
  if ('shape' in spec) return { faction, text, box: spec.box, aspect, offLand: true, ...(spec.leader !== undefined ? { leader: spec.leader } : {}) };
  return { faction, text, box: spec, aspect };
}
function territoryOf(entry: number, spec: Spec): TerritoryLabelInput {
  const text = `T${String(entry)}`;
  if (spec === undefined) return { entry, text, box: undefined };
  if ('shape' in spec && (spec.shape === 'straight' || spec.shape === 'arc')) return { entry, text, box: undefined, frame: spec };
  if ('shape' in spec) return { entry, text, box: spec.box, offLand: true, ...(spec.leader !== undefined ? { leader: spec.leader } : {}) };
  return { entry, text, box: spec };
}

const HZ = box(300, 300, 8, 20); // aspect 2.5, centre (310, 304)
const ST = straight(200, 224, 90, 40, 100); // aspect 2.5

/** Factions: 1 eliminated, 2 absorber (aspect 2.5), 3 bystander. */
function stepOf(a0: Spec, a1: Spec, over: { e?: Spec; c0?: Spec; c1?: Spec; t0?: Spec; t1?: Spec } = {}): StepLabels {
  const e = 'e' in over ? over.e : box(100, 100, 20, 60);
  const c0 = 'c0' in over ? over.c0 : box(500, 500, 30, 120);
  const c1 = 'c1' in over ? over.c1 : c0;
  const t0 = 't0' in over ? over.t0 : box(10, 5, 8, 24);
  const t1 = 't1' in over ? over.t1 : t0;
  return {
    earlier: { factions: [factionOf(1, 'Uno', 3, e), factionOf(2, 'Dos', 2.5, a0), factionOf(3, 'Tres', 4, c0)], territories: [territoryOf(1, t0)] },
    later: { factions: [factionOf(2, 'Dos', 2.5, a1), factionOf(3, 'Tres', 4, c1)], territories: [territoryOf(1, t1)] },
    eliminated: 1,
    absorber: 2,
    transferred: new Set([1]),
  };
}
const of = (labels: readonly AnyLabelDraw[], text: string): AnyLabelDraw[] => labels.filter((l) => l.text === text);
const one = (labels: readonly AnyLabelDraw[], text: string): AnyLabelDraw => {
  const found = of(labels, text);
  if (found.length !== 1) throw new Error(`expected one label ${text}, got ${String(found.length)}`);
  return found[0]!;
};
const shapedOf = (l: AnyLabelDraw): ShapedDraw => {
  if ('box' in l) throw new Error('not a shaped draw');
  return l;
};
const boxOf = (l: AnyLabelDraw): LabelDraw => {
  if (!('box' in l)) throw new Error('not a box draw');
  return l;
};

describe('FR-210 case (a): both horizontal in-land frames', () => {
  it('FR-210 the absorber interpolates x0, y0 and h linearly and w = h x aspect, as 005 FR-181', () => {
    const input = stepOf(box(300, 300, 10, 25), box(200, 220, 50, 125));
    expect(boxOf(one(labelsAt(input, 0), 'Dos')).box).toStrictEqual(box(300, 300, 10, 25));
    expect(boxOf(one(labelsAt(input, 0.25), 'Dos')).box).toStrictEqual(box(275, 280, 20, 50));
    expect(boxOf(one(labelsAt(input, 0.5), 'Dos')).box).toStrictEqual(box(250, 260, 30, 75));
    expect(boxOf(one(labelsAt(input, 0.75), 'Dos')).box).toStrictEqual(box(225, 240, 40, 100));
    expect(boxOf(one(labelsAt(input, 1), 'Dos')).box).toStrictEqual(box(200, 220, 50, 125));
    for (const f of FS) expect(one(labelsAt(input, f), 'Dos').factor).toBe(1);
  });
});

describe('FR-210 case (b): horizontal and straight frames', () => {
  it('FR-210 a horizontal frame to a straight frame: centre, h and angle interpolate, w = h x aspect, factor 1', () => {
    const input = stepOf(HZ, ST);
    const at = (f: number): ShapedDraw => shapedOf(one(labelsAt(input, f), 'Dos'));
    expect(at(0.25).frame).toStrictEqual(straight(282.5, 284, 22.5, 16, 40));
    expect(at(0.5).frame).toStrictEqual(straight(255, 264, 45, 24, 60));
    expect(at(0.75).frame).toStrictEqual(straight(227.5, 244, 67.5, 32, 80));
    for (const f of [0.25, 0.5, 0.75]) {
      expect(at(f).factor).toBe(1);
      expect(at(f).role).toBe('faction');
      expect(at(f).ink).toStrictEqual([255, 255, 255]);
      expect(at(f).halo).toStrictEqual([0, 0, 0]);
    }
  });

  it('FR-210 a straight frame to a horizontal frame is the same interpolation the other way', () => {
    const input = stepOf(ST, HZ);
    const at = (f: number): ShapedDraw => shapedOf(one(labelsAt(input, f), 'Dos'));
    expect(at(0.25).frame).toStrictEqual(straight(227.5, 244, 67.5, 32, 80));
    expect(at(0.5).frame).toStrictEqual(straight(255, 264, 45, 24, 60));
    expect(at(0.75).frame).toStrictEqual(straight(282.5, 284, 22.5, 16, 40));
  });

  it('FR-210 at f = 0 and f = 1 case (b) draws the endpoint frame itself: a horizontal endpoint is a box label', () => {
    const forward = stepOf(HZ, ST);
    expect(labelsAt(forward, 0)).toStrictEqual(instantLabels(forward.earlier));
    expect(labelsAt(forward, 1)).toStrictEqual(instantLabels(forward.later));
    expect(boxOf(one(labelsAt(forward, 0), 'Dos')).box).toStrictEqual(HZ);
    expect(shapedOf(one(labelsAt(forward, 1), 'Dos')).frame).toStrictEqual(ST);
    const reverse = stepOf(ST, HZ);
    expect(boxOf(one(labelsAt(reverse, 1), 'Dos')).box).toStrictEqual(HZ);
    expect(shapedOf(one(labelsAt(reverse, 0), 'Dos')).frame).toStrictEqual(ST);
  });

  it('FR-210 the angle goes from +90 to -75 through 0 without wrapping', () => {
    const input = stepOf(straight(100, 100, 90, 8, 20), straight(100, 100, -75, 8, 20));
    const angle = (f: number): number => shapedOf(one(labelsAt(input, f), 'Dos')).frame.angle;
    expect(angle(0.25)).toBe(48.75);
    expect(angle(0.5)).toBe(7.5);
    expect(angle(0.75)).toBe(-33.75);
    expect(angle(0)).toBe(90);
    expect(angle(1)).toBe(-75);
    const back = stepOf(straight(100, 100, -75, 8, 20), straight(100, 100, 90, 8, 20));
    expect(shapedOf(one(labelsAt(back, 0.5), 'Dos')).frame.angle).toBe(7.5);
  });

  it('FR-210 two straight frames keep the shape straight and w = h x the later aspect', () => {
    const input = stepOf(straight(100, 100, 0, 8, 20), straight(120, 80, 60, 16, 40));
    const frame = shapedOf(one(labelsAt(input, 0.5), 'Dos')).frame;
    expect(frame).toStrictEqual(straight(110, 90, 30, 12, 30));
  });
});

describe('FR-210 case (c): arcs, off-land boxes and one-sided frames crossfade', () => {
  it('FR-210 an arc pair draws the earlier frame at 1 - f and the later one at f, factor 0 omitted', () => {
    const e = arc(100, 100, 30);
    const l = arc(160, 120, -30);
    const input = stepOf(e, l);
    expect(of(labelsAt(input, 0), 'Dos')).toHaveLength(1);
    expect(of(labelsAt(input, 1), 'Dos')).toHaveLength(1);
    for (const f of [0.25, 0.5, 0.75]) {
      const pair = of(labelsAt(input, f), 'Dos').map(shapedOf);
      expect(pair.map((d) => [d.frame, d.factor])).toStrictEqual([[e, 1 - f], [l, f]]);
    }
    expect(shapedOf(one(labelsAt(input, 0), 'Dos')).factor).toBe(1);
    expect(shapedOf(one(labelsAt(input, 1), 'Dos')).factor).toBe(1);
  });

  it('FR-210 a horizontal frame next to an arc frame crossfades (an arc never interpolates)', () => {
    const input = stepOf(HZ, arc(160, 120, 30));
    const pair = of(labelsAt(input, 0.5), 'Dos');
    expect(pair).toHaveLength(2);
    expect(boxOf(pair[0]!).box).toStrictEqual(HZ);
    expect(pair[0]!.factor).toBe(0.5);
    expect(shapedOf(pair[1]!).frame.shape).toBe('arc');
  });

  it('FR-210 in-land to off-land: each side with its own leader line, off-land box drawn as a box label', () => {
    const o = off(box(400, 100, 18, 45), LEADER);
    const input = stepOf(HZ, o);
    const pair = of(labelsAt(input, 0.25), 'Dos').map(boxOf);
    expect(pair).toHaveLength(2);
    expect(pair[0]!.box).toStrictEqual(HZ);
    expect('leader' in pair[0]!).toBe(false);
    expect(pair[0]!.factor).toBe(0.75);
    expect(pair[1]!.box).toStrictEqual(o.box);
    expect(pair[1]!.leader).toStrictEqual(LEADER);
    expect(pair[1]!.factor).toBe(0.25);
    const reverse = of(labelsAt(stepOf(o, HZ), 0.25), 'Dos').map(boxOf);
    expect(reverse[0]!.leader).toStrictEqual(LEADER);
    expect(reverse[0]!.factor).toBe(0.75);
    expect('leader' in reverse[1]!).toBe(false);
  });

  it('FR-210 a shaped frame next to an off-land box crossfades too', () => {
    const input = stepOf(ST, off(box(400, 100, 18, 45)));
    const pair = of(labelsAt(input, 0.5), 'Dos');
    expect(pair).toHaveLength(2);
    expect(shapedOf(pair[0]!).frame).toStrictEqual(ST);
    expect(boxOf(pair[1]!).box).toStrictEqual(box(400, 100, 18, 45));
  });

  it('FR-210 FR-206 a frame at one round only fades in or out, whichever the shape', () => {
    for (const spec of [HZ, ST, arc(100, 100, 30), off(box(400, 100, 18, 45), LEADER)] as const) {
      const fadeIn = stepOf(undefined, spec);
      expect(of(labelsAt(fadeIn, 0), 'Dos')).toHaveLength(0);
      for (const f of [0.25, 0.5, 1]) expect(one(labelsAt(fadeIn, f), 'Dos').factor).toBe(f);
      const fadeOut = stepOf(spec, undefined);
      expect(of(labelsAt(fadeOut, 1), 'Dos')).toHaveLength(0);
      for (const f of [0, 0.25, 0.5]) expect(one(labelsAt(fadeOut, f), 'Dos').factor).toBe(1 - f);
    }
    for (const f of FS) expect(of(labelsAt(stepOf(undefined, undefined), f), 'Dos')).toHaveLength(0);
  });
});

describe('FR-211 the other labels of a step', () => {
  it('FR-211 the eliminated faction keeps its earlier drawn frame and leader at 1 - f, whatever the shape', () => {
    const o = off(box(400, 100, 18, 45), LEADER);
    for (const spec of [box(100, 100, 20, 60), ST, arc(100, 100, 30), o] as const) {
      const input = stepOf(undefined, undefined, { e: spec });
      for (const f of [0, 0.25, 0.5, 0.75]) {
        const l = one(labelsAt(input, f), 'Uno');
        expect(l.factor).toBe(1 - f);
        expect(l).toStrictEqual({ ...one(instantLabels(input.earlier), 'Uno'), factor: 1 - f });
      }
      expect(of(labelsAt(input, 1), 'Uno')).toHaveLength(0);
    }
    const input = stepOf(undefined, undefined, { e: o });
    expect(boxOf(one(labelsAt(input, 0.25), 'Uno')).leader).toStrictEqual(LEADER);
    expect(boxOf(one(labelsAt(input, 0.25), 'Uno')).box).toStrictEqual(o.box);
    expect(of(labelsAt(stepOf(undefined, undefined, { e: undefined }), 0.25), 'Uno')).toHaveLength(0);
  });

  it('FR-211 a third faction whose drawn frame and leader are the same at both rounds is one draw at factor 1', () => {
    const moved = (): Spec => off(box(600, 40, 18, 72), LEADER);
    const input = stepOf(HZ, HZ, { c0: moved(), c1: moved() }); // equal values, different objects
    for (const f of [0, 0.25, 0.49, 0.5, 0.75, 1]) {
      const l = one(labelsAt(input, f), 'Tres');
      expect(l.factor).toBe(1);
      expect(boxOf(l).leader).toStrictEqual(LEADER);
    }
    const shaped = stepOf(HZ, HZ, { c0: straight(1, 2, 15, 10, 40), c1: straight(1, 2, 15, 10, 40) });
    for (const f of FS) expect(shapedOf(one(labelsAt(shaped, f), 'Tres')).factor).toBe(1);
  });

  it('FR-211 a third faction whose off-land box moved is crossfaded as in FR-210 (c)', () => {
    const before = off(box(600, 40, 18, 72), LEADER);
    const after = off(box(640, 40, 18, 72), LEADER);
    const input = stepOf(HZ, HZ, { c0: before, c1: after });
    expect(of(labelsAt(input, 0), 'Tres')).toHaveLength(1);
    expect(of(labelsAt(input, 1), 'Tres')).toHaveLength(1);
    const pair = of(labelsAt(input, 0.25), 'Tres').map(boxOf);
    expect(pair.map((l) => [l.box, l.factor])).toStrictEqual([[before.box, 0.75], [after.box, 0.25]]);
  });

  it('FR-211 a difference of the leader line alone, or of the shape alone, is a difference', () => {
    const base = box(600, 40, 18, 72);
    const leaderOnly = stepOf(HZ, HZ, { c0: off(base), c1: off(base, LEADER) });
    expect(of(labelsAt(leaderOnly, 0.5), 'Tres')).toHaveLength(2);
    const moved = stepOf(HZ, HZ, { c0: off(base, LEADER), c1: off(base, { ...LEADER, x2: 9 }) });
    expect(of(labelsAt(moved, 0.5), 'Tres')).toHaveLength(2);
    const shapeOnly = stepOf(HZ, HZ, { c0: base, c1: off(base) });
    expect(of(labelsAt(shapeOnly, 0.5), 'Tres')).toHaveLength(2);
    const frameOnly = stepOf(HZ, HZ, { c0: straight(1, 2, 15, 10, 40), c1: straight(1, 2, 30, 10, 40) });
    expect(of(labelsAt(frameOnly, 0.5), 'Tres')).toHaveLength(2);
    const arcOnly = stepOf(HZ, HZ, { c0: arc(1, 2, 30), c1: arc(1, 2, 60) });
    expect(of(labelsAt(arcOnly, 0.5), 'Tres')).toHaveLength(2);
  });

  it('FR-211 a third faction with a drawn frame at one round only fades with the crossfade', () => {
    const input = stepOf(HZ, HZ, { c0: undefined, c1: box(500, 500, 30, 120) });
    expect(of(labelsAt(input, 0), 'Tres')).toHaveLength(0);
    expect(one(labelsAt(input, 0.25), 'Tres').factor).toBe(0.25);
  });

  it('FR-209 FR-211 a territory label is the same at every f: a shaped frame, an off-land box with its leader', () => {
    const o = off(box(400, 100, 6, 18), LEADER);
    for (const spec of [box(10, 5, 8, 24), straight(50, 60, -75, 6, 20), arc(50, 60, -30), o] as const) {
      const input = stepOf(HZ, HZ, { t0: spec, t1: spec });
      const first = one(labelsAt(input, 0), 'T1');
      for (const f of [0.25, 0.49, 0.5, 0.75, 1]) expect(one(labelsAt(input, f), 'T1')).toStrictEqual(first);
      expect(first.factor).toBe(1);
      expect(first.role).toBe('territory');
    }
    const draw = boxOf(one(labelsAt(stepOf(HZ, HZ, { t0: o, t1: o }), 0.3), 'T1'));
    expect(draw.leader).toStrictEqual(LEADER);
    expect(draw.box).toStrictEqual(o.box);
  });

  it('FR-211 the order is factions by index (earlier draw before later), then territories by entry', () => {
    const input = stepOf(arc(100, 100, 30), arc(160, 120, -30), { c0: box(1, 1, 2, 3), c1: box(1, 1, 2, 3) });
    expect(labelsAt(input, 0.25).map((l) => l.text)).toStrictEqual(['Uno', 'Dos', 'Dos', 'Tres', 'T1']);
  });
});

describe('FR-210 FR-211 the whole drawing at the ends and backward', () => {
  const kinds: Spec[] = [undefined, HZ, ST, arc(100, 100, 30), off(box(400, 100, 18, 45), LEADER), straight(10, 20, -75, 8, 20)];

  it('FR-211 f = 0 gives the instant labels of the earlier round and f = 1 those of the later round, for every pair of drawn frames', () => {
    let pairs = 0;
    for (const a0 of kinds) {
      for (const a1 of kinds) {
        for (const c of [undefined, box(5, 5, 9, 36), off(box(600, 40, 18, 72), LEADER)] as const) {
          const input = stepOf(a0, a1, { c0: c, c1: c, e: ST });
          expect(labelsAt(input, 0)).toStrictEqual(instantLabels(input.earlier));
          expect(labelsAt(input, 1)).toStrictEqual(instantLabels(input.later));
          pairs++;
        }
      }
    }
    expect(pairs).toBe(108);
  });

  it('FR-181 a backward step is the forward step with f mirrored', () => {
    for (const input of [stepOf(HZ, ST), stepOf(arc(100, 100, 30), off(box(400, 100, 18, 45), LEADER)), stepOf(box(300, 300, 10, 25), box(200, 220, 50, 125))]) {
      const ps = [0, 0.125, 0.25, 0.75, 0.875, 1];
      const forward = ps.map((p) => labelsAt(input, p));
      const backward = ps.map((p) => labelsAt(input, 1 - p));
      expect(backward).toStrictEqual([...forward].reverse());
    }
  });

  it('FR-189 the inputs are not changed and the same inputs give the same draws', () => {
    const input = stepOf(arc(100, 100, 30), off(box(400, 100, 18, 45), LEADER));
    const snapshot = JSON.stringify([input.earlier, input.later]);
    expect(labelsAt(input, 0.37)).toStrictEqual(labelsAt(input, 0.37));
    expect(JSON.stringify([input.earlier, input.later])).toBe(snapshot);
  });
});

describe('FR-213 NFR-39 steps are pure functions of their inputs', () => {
  it('FR-213 NFR-39 labelsAt, instantLabels, frameOf and screenFrame give equal results while Math.random, Date.now and performance.now throw', () => {
    const input = stepOf(arc(100, 100, 30), off(box(400, 100, 18, 45), LEADER), { c0: straight(1, 2, 15, 10, 40), c1: straight(1, 2, 30, 10, 40) });
    const run = (): unknown[] => [...FS.map((f) => labelsAt(input, f)), instantLabels(input.later), labelsAt(stepOf(HZ, ST), 0.5).map(frameOf), screenFrame(frameOf(boxOf(one(instantLabels(input.later), 'Dos'))), { x: 1, y: 2, scale: 3 }, { width: 8, height: 6 })];
    const normal = run();
    const boom = (): never => {
      throw new Error('forbidden');
    };
    const spies = [vi.spyOn(Math, 'random').mockImplementation(boom), vi.spyOn(Date, 'now').mockImplementation(boom), vi.spyOn(performance, 'now').mockImplementation(boom)];
    try {
      expect(run()).toStrictEqual(normal);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('FR-189 instant labels with shaped frames', () => {
  it('FR-212 an instant label is a box label for a horizontal or off-land input and a shaped draw otherwise; none is left out', () => {
    const round: RoundLabels = {
      factions: [factionOf(1, 'A', 3, box(1, 2, 3, 9)), factionOf(2, 'B', 3, ST), factionOf(3, 'C', 3, off(box(7, 8, 9, 27), LEADER)), factionOf(4, 'D', 3, undefined), factionOf(5, 'E', 3, arc(1, 1, -30))],
      territories: [territoryOf(2, ST), territoryOf(1, box(1, 1, 2, 6)), territoryOf(3, undefined)],
    };
    const labels = instantLabels(round);
    expect(labels.map((l) => l.text)).toStrictEqual(['A', 'B', 'C', 'E', 'T1', 'T2']);
    expect(labels.every((l) => l.factor === 1)).toBe(true);
    expect(Object.keys(boxOf(labels[0]!)).sort()).toStrictEqual(['box', 'factor', 'halo', 'ink', 'role', 'text']);
    expect(Object.keys(boxOf(labels[2]!)).sort()).toStrictEqual(['box', 'factor', 'halo', 'ink', 'leader', 'role', 'text']);
    expect(Object.keys(shapedOf(labels[1]!)).sort()).toStrictEqual(['factor', 'frame', 'halo', 'ink', 'role', 'text']);
    expect(shapedOf(labels[3]!).frame.shape).toBe('arc');
    expect(shapedOf(labels[5]!).role).toBe('territory');
  });
});

describe('FR-212 frame data for the rendering part', () => {
  it('FR-212 a box label gives horizontal, its centre, angle 0, curvature 0, h and w; an off-land box the same', () => {
    const draw: LabelDraw = { text: 't', role: 'faction', box: box(10, 20, 4, 12), factor: 1, ink: [255, 255, 255], halo: [0, 0, 0] };
    const expected: FrameData = { shape: 'horizontal', cx: 16, cy: 22, angle: 0, curvature: 0, h: 4, w: 12 };
    expect(frameOf(draw)).toStrictEqual(expected);
    expect(frameOf({ ...draw, leader: LEADER })).toStrictEqual(expected);
  });

  it('FR-212 a straight frame gives its centre, angle and size, curvature 0', () => {
    const d: ShapedDraw = { text: 't', role: 'territory', frame: straight(5, 6, -75, 7, 21), factor: 1, ink: [255, 255, 255], halo: [0, 0, 0] };
    expect(frameOf(d)).toStrictEqual({ shape: 'straight', cx: 5, cy: 6, angle: -75, curvature: 0, h: 7, w: 21 });
  });

  it('FR-212 an arc frame gives the curvature 1 / R with the sign of the bend', () => {
    const mk = (bend: number): ShapedDraw => ({ text: 't', role: 'faction', frame: arc(5, 6, bend), factor: 1, ink: [255, 255, 255], halo: [0, 0, 0] });
    expect(frameOf(mk(30))).toStrictEqual({ shape: 'arc', cx: 5, cy: 6, angle: 0, curvature: 1 / 200, h: 8, w: 40 });
    expect(frameOf(mk(-60))).toStrictEqual({ shape: 'arc', cx: 5, cy: 6, angle: 0, curvature: -1 / 200, h: 8, w: 40 });
  });

  it('FR-212 the screen frame has the centre on screen, h and w times the scale and the curvature over the scale', () => {
    const vp = { width: 800, height: 600 };
    const cam = { x: 100, y: 50, scale: 4 };
    const f: FrameData = { shape: 'arc', cx: 110, cy: 60, angle: 30, curvature: -1 / 200, h: 5, w: 15 };
    expect(screenFrame(f, cam, vp)).toStrictEqual({ shape: 'arc', cx: (110 - 100) * 4 + 400, cy: (60 - 50) * 4 + 300, angle: 30, curvature: -1 / 200 / 4, h: 20, w: 60 });
    const centred = screenFrame({ shape: 'horizontal', cx: 100, cy: 50, angle: 0, curvature: 0, h: 1, w: 2 }, cam, vp);
    expect([centred.cx, centred.cy]).toStrictEqual([400, 300]);
  });

  it('FR-212 draw data holds no seed, no round, no round count and no record (type level)', () => {
    expectTypeOf<keyof ShapedDraw>().toEqualTypeOf<'text' | 'role' | 'frame' | 'factor' | 'ink' | 'halo'>();
    expectTypeOf<keyof LabelDraw>().toEqualTypeOf<'text' | 'role' | 'box' | 'factor' | 'ink' | 'halo' | 'leader'>();
    expectTypeOf<keyof FrameData>().toEqualTypeOf<'shape' | 'cx' | 'cy' | 'angle' | 'curvature' | 'h' | 'w'>();
    expectTypeOf<AnyLabelDraw>().toEqualTypeOf<LabelDraw | ShapedDraw>();
  });
});

describe('FR-208 off-land and shaped labels follow the 005 opacity, factor and minimum height rules', () => {
  const draw = (frame: ShapedFrame, factor = 1): ShapedDraw => ({ text: 't', role: 'territory', frame, factor, ink: [255, 255, 255], halo: [0, 0, 0] });

  it('FR-208 a shaped label is drawable at P screen pixels of frame height and not below it', () => {
    const s = 2;
    expect(drawable(draw(straight(0, 0, 90, P.minPx / s, 40)), s, P)).toBe(true);
    expect(drawable(draw(straight(0, 0, 90, P.minPx / s - 0.01, 40)), s, P)).toBe(false);
    expect(drawable(draw(arc(0, 0, 30), 1), 100, P)).toBe(true);
  });

  it('FR-208 the alpha of any draw is the role opacity times the factor, and factor 0 is not drawable', () => {
    const s = (P.fadeStart + P.fadeFull) / 2;
    expect(labelAlpha(draw(straight(0, 0, 0, 10, 40), 0.4), s, P)).toBeCloseTo(0.2, 12);
    expect(drawable(draw(straight(0, 0, 0, 100, 40), 0), P.fadeFull + 1, P)).toBe(false);
    const offDraw: LabelDraw = { text: 't', role: 'faction', box: box(0, 0, 18, 45), factor: 0.5, ink: [255, 255, 255], halo: [0, 0, 0], leader: LEADER };
    expect(labelAlpha(offDraw, P.fadeStart, P)).toBe(0.5);
    expect(drawable(offDraw, P.fadeStart, P)).toBe(true);
    expect(drawable(offDraw, P.fadeFull + 1, P)).toBe(false);
  });
});

describe('FR-209 FR-212 roundLabels with the placement', () => {
  async function setup() {
    const png = await decodeIdPng(devPngBytes(), inflateStream);
    if (!png.ok) throw new Error('png');
    const index = buildEntryIndex(DEV_MAP, png.value.width, png.value.height, png.value.values);
    const factionIndex = factionIndexOf(DEV_MAP);
    const pieces = buildPieceIndex(index);
    const texts = labelTexts(DEV_MAP, DEV_PRESENTATION, factionIndex);
    const aspects = new Map([...texts.factions.keys()].map((f) => [f, 4] as [number, number]));
    const tBoxes = territoryBoxes(pieces, texts.territories.map((t) => (t === undefined ? undefined : 3)), P);
    const scene = sceneAt(DEV_MAP, DEV_PRESENTATION, 1, 1, sim);
    if (!scene.ok) throw new Error('scene');
    const table = ownerTable(index, scene.value.owners, factionIndex);
    const boxes = factionBoxes(pieces, table, aspects, P);
    return { texts, table, boxes, tBoxes };
  }

  it('FR-209 without placement, and with an empty placement, the output is the 005 output', async () => {
    const { texts, table, boxes, tBoxes } = await setup();
    const plain = roundLabels(texts, table, boxes, tBoxes);
    expect(roundLabels(texts, table, boxes, tBoxes, { factions: new Map(), territories: [] })).toStrictEqual(plain);
    expect(roundLabels(texts, table, boxes, tBoxes, { factions: new Map(), territories: new Array<undefined>(tBoxes.length).fill(undefined) })).toStrictEqual(plain);
    for (const l of plain.factions) expect(Object.keys(l).sort()).toStrictEqual(['aspect', 'box', 'faction', 'text']);
    for (const l of plain.territories) expect(Object.keys(l).sort()).toStrictEqual(['box', 'entry', 'text']);
  });

  it('FR-212 a placed faction label has a frame and no box, an off-land one the off-land box, offLand and its leader; the rest keep the 005 keys', async () => {
    const { texts, table, boxes, tBoxes } = await setup();
    const [fa, fb, fc, ...rest] = [...boxes.labels.keys()];
    const shaped = straight(100, 100, 75, 20, 80);
    const withLeader = off(box(50, 60, 18, 72), LEADER);
    const noLeader = off(box(80, 90, 18, 72));
    const placed = new Map<number, ShapedFrame | OffLand>([[fa!, shaped], [fb!, withLeader], [fc!, noLeader]]);
    const labels = roundLabels(texts, table, boxes, tBoxes, { factions: placed, territories: [] });
    const by = (f: number) => labels.factions.find((l) => l.faction === f)!;
    expect(Object.keys(by(fa!)).sort()).toStrictEqual(['aspect', 'box', 'faction', 'frame', 'text']);
    expect(by(fa!).box).toBeUndefined();
    expect(by(fa!).frame).toBe(shaped);
    expect(Object.keys(by(fb!)).sort()).toStrictEqual(['aspect', 'box', 'faction', 'leader', 'offLand', 'text']);
    expect(by(fb!).box).toBe(withLeader.box);
    expect(by(fb!).offLand).toBe(true);
    expect(by(fb!).leader).toBe(LEADER);
    expect(Object.keys(by(fc!)).sort()).toStrictEqual(['aspect', 'box', 'faction', 'offLand', 'text']);
    expect(by(fc!).box).toBe(noLeader.box);
    for (const f of rest) {
      expect(Object.keys(by(f)).sort()).toStrictEqual(['aspect', 'box', 'faction', 'text']);
      expect(by(f).box).toBe(boxes.labels.get(f)!.box);
    }
    expect(labels.factions).toHaveLength(boxes.labels.size);
  });

  it('FR-209 a territory label: placed shaped has a frame and no box, placed off-land the box and the leader; a placed label without a 005 box is listed', async () => {
    const { texts, table, boxes, tBoxes } = await setup();
    const owned: number[] = [];
    for (let e = 1; e < table.length; e++) if (texts.territories[e] !== undefined && table[e]! > 0 && tBoxes[e] !== undefined) owned.push(e);
    const [a, b, c, d] = owned as [number, number, number, number];
    const noBox = tBoxes.map((x, i) => (i === c || i === d ? undefined : x));
    const territories: (ShapedFrame | OffLand | undefined)[] = new Array<ShapedFrame | OffLand | undefined>(tBoxes.length).fill(undefined);
    const shaped = arc(1, 2, 30);
    const withLeader = off(box(70, 80, 5, 15), LEADER);
    territories[a] = shaped;
    territories[b] = withLeader;
    territories[c] = off(box(90, 95, 5, 15));
    const labels = roundLabels(texts, table, boxes, noBox, { factions: new Map(), territories });
    const by = (e: number) => labels.territories.find((l) => l.entry === e);
    expect(Object.keys(by(a)!).sort()).toStrictEqual(['box', 'entry', 'frame', 'text']);
    expect(by(a)!.box).toBeUndefined();
    expect(by(a)!.frame).toBe(shaped);
    expect(Object.keys(by(b)!).sort()).toStrictEqual(['box', 'entry', 'leader', 'offLand', 'text']);
    expect(by(b)!.box).toBe(withLeader.box);
    expect(by(b)!.leader).toBe(LEADER);
    expect(Object.keys(by(c)!).sort()).toStrictEqual(['box', 'entry', 'offLand', 'text']);
    expect(by(d)).toBeUndefined();
    expect(by(owned[4]!)!.box).toBe(tBoxes[owned[4]!]);
    expect(labels.territories.map((l) => l.entry)).toStrictEqual(owned.filter((e) => e !== d));
  });

  it('FR-168 a placed territory without an owner, or without a text, has no label', async () => {
    const { texts, table, boxes, tBoxes } = await setup();
    const unowned: number[] = [];
    for (let e = 1; e < table.length; e++) if (texts.territories[e] !== undefined && table[e]! <= 0) unowned.push(e);
    const territories: (ShapedFrame | OffLand | undefined)[] = new Array<ShapedFrame | OffLand | undefined>(tBoxes.length).fill(undefined);
    for (const e of unowned) territories[e] = arc(1, 2, 30);
    const withSea = roundLabels(texts, table, boxes, tBoxes, { factions: new Map(), territories });
    expect(withSea).toStrictEqual(roundLabels(texts, table, boxes, tBoxes));
    const seaEntry = texts.territories.findIndex((t, i) => i > 0 && t === undefined);
    territories[seaEntry] = arc(1, 2, 30);
    expect(roundLabels(texts, table, boxes, tBoxes, { factions: new Map(), territories }).territories.some((l) => l.entry === seaEntry)).toBe(false);
  });
});
