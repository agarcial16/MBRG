import { beforeAll, describe, expect, it } from 'vitest';
import { instantLabels, labelsAt } from '../src/core/label-frame';
import type { AnyLabelDraw, RoundLabels, ShapedDraw, StepLabels } from '../src/core/label-frame';
import { roundLabels } from '../src/core/label-input';
import { straightMatrix } from '../src/core/glyph-layout';
import type { CentredDevRun } from './helpers/centred-digest-run';
import { centredMeasuredRun, centreOf, heightOf } from './helpers/centred-hits';
import { drawnOf } from './helpers/shaped-hits';

// FR-226 FR-227: the 006 step rules applied to the 007 layouts of seed 1 (aspects measured in Chrome), and the natural
// proportions of the straight frames. `labelsAt` and the layer are the 006 ones; these tests pin that they hold on 007 data.
const FS = [0, 0.25, 0.5, 0.75, 1];

let run: CentredDevRun;
const roundOf = (r: number): RoundLabels => {
  const layout = run.centredFactions[r]!;
  return roundLabels(run.texts, run.tables[r]!, layout.boxes, run.centredTerritories.boxes, { factions: layout.placed, territories: run.centredTerritories.placed });
};

/** The step r -> r + 1 as the viewer builds it: the eliminated faction, the absorber (the one that gains land) and the transferred entries. */
function stepOf(r: number): StepLabels & { aspects: ReadonlyMap<number, number> } {
  const a = run.tables[r]!;
  const b = run.tables[r + 1]!;
  const count = (t: Uint8Array): Map<number, number> => {
    const m = new Map<number, number>();
    for (const v of t) if (v > 0) m.set(v, (m.get(v) ?? 0) + 1);
    return m;
  };
  const ca = count(a);
  const cb = count(b);
  const eliminated = [...ca.keys()].find((f) => !cb.has(f))!;
  const absorber = [...cb.keys()].find((f) => cb.get(f)! > ca.get(f)!)!;
  const transferred = new Set<number>();
  for (let e = 0; e < a.length; e++) if (a[e] !== b[e] && a[e]! > 0) transferred.add(e);
  return { earlier: roundOf(r), later: roundOf(r + 1), eliminated, absorber, transferred, aspects: run.factionAspects };
}

beforeAll(async () => {
  run = await centredMeasuredRun();
}, 240000);

const shaped = (l: AnyLabelDraw): ShapedDraw => {
  if ('box' in l) throw new Error('not shaped');
  return l;
};

describe('FR-226 the 006 step rules on the 007 layouts of seed 1', () => {
  it('FR-226 at f = 0 and f = 1 the drawing equals the instant drawing of the earlier and the later round, for every step', () => {
    for (let r = 0; r < run.rounds; r++) {
      const s = stepOf(r);
      expect(labelsAt(s, 0), `step ${String(r)}`).toStrictEqual(instantLabels(s.earlier));
      expect(labelsAt(s, 1), `step ${String(r)}`).toStrictEqual(instantLabels(s.later));
    }
  });

  it('FR-226 every label of every step at f = 0, 0.25, 0.5, 0.75, 1 has an opacity factor in (0, 1]', () => {
    for (let r = 0; r < run.rounds; r++) {
      const s = stepOf(r);
      for (const f of FS) {
        const draws = labelsAt(s, f);
        expect(draws.length).toBeGreaterThan(0);
        for (const d of draws) {
          expect(d.factor).toBeGreaterThan(0);
          expect(d.factor).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('FR-226 Francia 3 -> 4 (horizontal to straight): one straight draw, centre, height and angle interpolated, w = h x aspect, factor 1', () => {
    const s = stepOf(3);
    const francia = [...run.texts.factions].find(([, n]) => n === 'Francia')![0];
    expect(s.absorber).toBe(francia);
    const before = drawnOf(run.centredFactions[3]!.placed.get(francia), run.centredFactions[3]!.inLand.get(francia))!;
    const after = drawnOf(run.centredFactions[4]!.placed.get(francia), run.centredFactions[4]!.inLand.get(francia))!;
    expect(before.shape).toBe('horizontal');
    expect(after.shape).toBe('straight');
    if (after.shape !== 'straight') throw new Error('straight');
    const aspect = run.factionAspects.get(francia)!;
    const [cb, ca] = [centreOf(before), centreOf(after)];
    const lerp = (x: number, y: number, f: number): number => x + (y - x) * f;
    for (const f of [0.25, 0.5, 0.75]) {
      const mine = labelsAt(s, f).filter((d) => d.text === 'Francia');
      expect(mine, `f ${String(f)}`).toHaveLength(1);
      const frame = shaped(mine[0]!).frame;
      const h = lerp(heightOf(before), heightOf(after), f);
      expect(frame).toStrictEqual({ shape: 'straight', cx: lerp(cb.x, ca.x, f), cy: lerp(cb.y, ca.y, f), angle: lerp(0, after.angle, f), h, w: h * aspect });
      expect(mine[0]!.factor).toBe(1);
    }
    expect(labelsAt(s, 0).filter((d) => d.text === 'Francia').map((d) => 'box' in d)).toStrictEqual([true]);
    expect(labelsAt(s, 1).filter((d) => d.text === 'Francia').map((d) => 'frame' in d)).toStrictEqual([true]);
  });

  it('FR-226 Italia 2 -> 3 (the absorber, straight to horizontal): one interpolated straight draw at f = 0.25, 0.5, 0.75 and one draw at the ends', () => {
    const s = stepOf(2);
    const italia = [...run.texts.factions].find(([, n]) => n === 'Italia')![0];
    const before = drawnOf(run.centredFactions[2]!.placed.get(italia), run.centredFactions[2]!.inLand.get(italia))!;
    const after = drawnOf(run.centredFactions[3]!.placed.get(italia), run.centredFactions[3]!.inLand.get(italia))!;
    expect([before.shape, after.shape]).toStrictEqual(['straight', 'horizontal']);
    const draws = (f: number): AnyLabelDraw[] => labelsAt(s, f).filter((d) => d.text === 'Italia');
    // Italia absorbs: straight to horizontal interpolates through one straight frame (006 FR-210 b), not a crossfade
    expect(s.absorber).toBe(italia);
    for (const f of [0.25, 0.5, 0.75]) {
      expect(draws(f)).toHaveLength(1);
      expect(shaped(draws(f)[0]!).factor).toBe(1);
    }
    expect(draws(0)).toHaveLength(1);
    expect(draws(1)).toHaveLength(1);
    // Italia at rounds 0 to 2 is one unchanged region: its label is the same draw before and after step 0 -> 1
    for (const f of FS) expect(labelsAt(stepOf(0), f).filter((d) => d.text === 'Italia')).toHaveLength(1);
  });

  it('FR-226 FR-209 the territory labels are the same at every f of a step (frame fixed by the 007 layout, 007 FR-224)', () => {
    for (let r = 0; r < run.rounds; r++) {
      const s = stepOf(r);
      const territories = (d: AnyLabelDraw[]): AnyLabelDraw[] => d.filter((x) => x.role === 'territory');
      for (const f of FS) {
        const instant = territories(instantLabels(f < 0.5 ? s.earlier : s.later));
        expect(territories(labelsAt(s, f)), `step ${String(r)} f ${String(f)}`).toStrictEqual(instant);
      }
    }
  });
});

describe('FR-227 straight frames are drawn at their natural proportions', () => {
  it('FR-227 every 007 straight frame has w = h x aspect, so the text length at that height equals the frame length and the stretch is 1', () => {
    let checked = 0;
    const frames: { frame: { cx: number; cy: number; angle: number; h: number; w: number }; aspect: number }[] = [];
    for (let entry = 1; entry < run.p.entries; entry++) {
      const f = run.centredTerritories.placed[entry] ?? run.centredTerritories.inLand[entry];
      if (f !== undefined && f.shape === 'straight') frames.push({ frame: f, aspect: run.territoryAspects[entry]! });
    }
    for (const layout of run.centredFactions) {
      for (const faction of layout.boxes.labels.keys()) {
        const f = layout.placed.get(faction) ?? layout.inLand.get(faction);
        if (f !== undefined && f.shape === 'straight') frames.push({ frame: f, aspect: run.factionAspects.get(faction)! });
      }
    }
    expect(frames.length).toBeGreaterThan(60);
    for (const { frame, aspect } of frames) {
      expect(Math.abs(frame.w - frame.h * aspect), 'w = h x aspect').toBeLessThan(1e-9 * frame.w);
      // the text drawn at the frame height has length h x aspect: the stretch is w / measured = 1
      const m = straightMatrix(frame, frame.w, frame.h * aspect);
      const k = m.a * m.d - m.c * m.b;
      expect(k).toBeCloseTo(1, 12);
      // the across axis (c, d) is a unit vector perpendicular to the reading direction (a, b) / k
      expect(Math.hypot(m.c, m.d)).toBeCloseTo(1, 12);
      expect(m.a * m.c + m.b * m.d).toBeCloseTo(0, 12);
      expect(Math.hypot(m.a, m.b)).toBeCloseTo(k, 12);
      checked++;
    }
    expect(Math.max(...frames.map((x) => Math.abs(x.frame.angle)))).toBeLessThanOrEqual(45);
    expect(Math.max(...frames.map((x) => x.frame.h))).toBeGreaterThan(120);
    expect(checked).toBe(frames.length);
  });

  it('FR-227 a frame taller than 120 (up to the faction cap) at 45 degrees stretches only along the reading direction when the measured length differs', () => {
    for (const angle of [-45, -30, -15, 15, 30, 45]) {
      const m = straightMatrix({ cx: 0, cy: 0, angle }, 600, 300);
      expect(Math.hypot(m.a, m.b)).toBeCloseTo(2, 12);
      expect(Math.hypot(m.c, m.d)).toBeCloseTo(1, 12);
      expect(m.a * m.c + m.b * m.d).toBeCloseTo(0, 12);
    }
  });
});
