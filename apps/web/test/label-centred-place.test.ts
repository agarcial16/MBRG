import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CENTRE_PARAMS } from '../src/core/centre-params';
import { centredInLand } from '../src/core/label-centred';
import { placeCentredFactions, placeCentredTerritories } from '../src/core/label-centred-place';
import type { CentredFactionLayout } from '../src/core/label-centred-place';
import { centredLayoutDigest, layoutDigest } from '../src/core/label-digest';
import { labelCounts } from '../src/core/label-counts';
import type { Counts } from '../src/core/label-counts';
import type { Placed } from '../src/core/label-offland';
import { LABEL_PARAMS } from '../src/core/label-params';
import { inArc, inStraight } from '../src/core/label-shape';
import type { InLandFrame } from '../src/core/label-shape';
import { mainPieces } from '../src/core/regions';
import { SHAPE_PARAMS } from '../src/core/shape-params';
import { changeCounts, changedLabels, devCentredDigest, devCentredRun, withCentred } from './helpers/centred-digest-run';
import { measuredRun } from './helpers/shaped-hits';
import type { CentredDevRun } from './helpers/centred-digest-run';

// Role placements of the centred labels (spec 007 FR-217, FR-223, FR-224, FR-225, FR-229, NFR-44; plan 007 PD2, PD9,
// sections 7, 10 and 13). The dev map of seed 1 with the injected aspects of 005 / 006 (3 for territories, 4 for
// factions), so the digest can be compared bit for bit with a browser run.
const P = LABEL_PARAMS;
const M = P.margin;
const SP = SHAPE_PARAMS;
const CP = CENTRE_PARAMS;

/** The pinned 007 digest of the dev-map placement (territories once, factions of seed 1 rounds 0..4), taken in T5. */
const PINNED_007_DIGEST = '0b3472aa148ea55e'; // re-pinned in T8b (spec D19); the T5 value was 767ff73c98c1fa4d
const PINNED_006_DIGEST = '23c90b67d52cbcfa';

type Drawn = InLandFrame | Placed | undefined;

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
function conflicts(frames: readonly Drawn[]): [number, number][] {
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

describe('FR-225 the conflict check used below sees a real overlap', () => {
  it('FR-225 two horizontal frames that share a unit are flagged and far ones are not', () => {
    const near: InLandFrame = { shape: 'horizontal', box: { x0: 10, y0: 10, h: 6, w: 12 } };
    const over: InLandFrame = { shape: 'horizontal', box: { x0: 20, y0: 10, h: 6, w: 12 } };
    const far: InLandFrame = { shape: 'horizontal', box: { x0: 60, y0: 10, h: 6, w: 12 } };
    expect(conflicts([near, over, far])).toStrictEqual([[0, 1]]);
  });
});

/** Compare two faction layouts of the same state ignoring what only describes the work done (`recomputed`). */
const sameLayout = (a: CentredFactionLayout, b: CentredFactionLayout): void => {
  expect(a.boxes.index).toBe(b.boxes.index);
  expect(a.boxes.params).toStrictEqual(b.boxes.params);
  expect([...a.boxes.labels]).toStrictEqual([...b.boxes.labels]);
  expect([...a.inLand]).toStrictEqual([...b.inLand]);
  expect([...a.placed]).toStrictEqual([...b.placed]);
  expect([...a.steps]).toStrictEqual([...b.steps]);
};

describe('FR-217 FR-223 FR-224 FR-225 FR-229 NFR-44 the 007 placement of the dev map (seed 1)', () => {
  let run: CentredDevRun;
  beforeAll(async () => {
    run = await devCentredRun();
  }, 240000);

  it('FR-224 the territory layout takes no owners and equals the origin-free in-land search of each main piece', () => {
    expect(placeCentredTerritories.length).toBe(5);
    const main = mainPieces(run.p);
    let eligible = 0;
    for (let entry = 1; entry < run.p.entries; entry++) {
      if (run.centredTerritories.eligible[entry] !== 1) continue;
      eligible++;
      const found = centredInLand(run.p, [main[entry]!], run.territoryAspects[entry]!, 'territory', P, SP, CP);
      expect(run.centredTerritories.inLand[entry], `entry ${String(entry)}`).toStrictEqual(found.frame);
      expect(run.centredTerritories.steps[entry]).toBe(found.k);
    }
    expect(eligible).toBe(70);
    // a second computation gives the same layout (no ambient state)
    const again = placeCentredTerritories(run.p, run.territoryAspects, P, SP, CP);
    expect(again).toStrictEqual(run.centredTerritories);
  });

  it('FR-223 the same land and aspect give the same frame for any faction index', () => {
    const last = run.tables[run.rounds]!;
    const [francia] = [...run.centredFactions[run.rounds]!.inLand.keys()];
    const expected = run.centredFactions[run.rounds]!.inLand.get(francia!);
    expect(expected).toBeDefined();
    for (const faction of [1, 2, 3, 4, 5, 6]) {
      const remapped = Uint8Array.from(last, (v) => (v > 0 ? faction : 0));
      const aspects = new Map<number, number>([[faction, run.factionAspects.get(francia!)!]]);
      const layout = placeCentredFactions(run.p, remapped, aspects, P, SP, CP);
      expect(layout.inLand.get(faction), `faction ${String(faction)}`).toStrictEqual(expected);
    }
  });

  it('FR-223 one territory owned alone is a faction label with the same frame as the faction rule on its main piece (and as the territory rule when the area cap does not bind)', () => {
    const main = mainPieces(run.p);
    // the two roles differ only by the area cap and by `offLandHeight` (the widening stop): give them the same stop
    const same = { ...SP, offLandHeight: { faction: SP.offLandHeight.territory, territory: SP.offLandHeight.territory } };
    let checked = 0;
    let sameAsTerritory = 0;
    for (let entry = 1; entry < run.p.entries; entry++) {
      if (run.centredTerritories.eligible[entry] !== 1) continue;
      const owners = new Uint8Array(run.p.entries);
      owners[entry] = 1;
      const layout = placeCentredFactions(run.p, owners, new Map([[1, run.territoryAspects[entry]!]]), P, same, CP);
      const label = layout.boxes.labels.get(1)!;
      expect(label.pieces, `entry ${String(entry)}`).toStrictEqual([main[entry]!]);
      const asFaction = centredInLand(run.p, label.pieces, label.aspect, 'faction', P, same, CP).frame;
      expect(layout.inLand.get(1)).toStrictEqual(asFaction);
      const asTerritory = centredInLand(run.p, label.pieces, label.aspect, 'territory', P, same, CP).frame;
      const hf = asFaction === undefined ? 0 : asFaction.shape === 'horizontal' ? asFaction.box.h : asFaction.h;
      const ht = asTerritory === undefined ? 0 : asTerritory.shape === 'horizontal' ? asTerritory.box.h : asTerritory.h;
      if (hf >= ht) {
        expect(asFaction).toStrictEqual(asTerritory);
        sameAsTerritory++;
      }
      checked++;
    }
    console.log(`label-centred-place: ${String(checked)} single-territory faction labels, ${String(sameAsTerritory)} not limited by the area cap`);
    expect(checked).toBe(70);
  });

  it('FR-225 no two drawn labels of one role conflict: territories once, factions at every round (fallbacks included)', () => {
    const t = run.centredTerritories;
    const drawn: Drawn[] = [];
    for (let entry = 1; entry < run.p.entries; entry++) if (t.eligible[entry] === 1) drawn.push(t.placed[entry] ?? t.inLand[entry]);
    expect(drawn).toHaveLength(70);
    expect(conflicts(drawn)).toStrictEqual([]);
    for (let round = 0; round <= run.rounds; round++) {
      const f = run.centredFactions[round]!;
      const frames = [...f.boxes.labels.keys()].map((id) => f.placed.get(id) ?? f.inLand.get(id));
      expect(conflicts(frames), `round ${String(round)}`).toStrictEqual([]);
    }
  });

  it('PD9 FR-216 a step or jump with reuse equals a computation from the state alone (all 25 pairs of rounds 0..T)', () => {
    let reused = 0;
    let recomputed = 0;
    for (let from = 0; from <= run.rounds; from++) {
      for (let to = 0; to <= run.rounds; to++) {
        const step = placeCentredFactions(run.p, run.tables[to]!, run.factionAspects, P, SP, CP, run.centredFactions[from]);
        sameLayout(step, run.centredFactions[to]!);
        recomputed += step.recomputed.length;
        reused += step.boxes.labels.size - step.recomputed.length;
        if (from === to) expect(step.recomputed).toStrictEqual([]);
      }
    }
    console.log(`label-centred-place: reuse over 25 state pairs: ${String(reused)} labels reused, ${String(recomputed)} recomputed`);
    expect(reused).toBeGreaterThan(0);
    expect(recomputed).toBeGreaterThan(0);
  });

  it('PD9 reuse is refused for other parameters: a changed centre or shape parameter recomputes every label', () => {
    const from = run.centredFactions[1]!;
    const other = { ...CP, angleLimit: 44 };
    const step = placeCentredFactions(run.p, run.tables[1]!, run.factionAspects, P, SP, other, from);
    expect(step.recomputed).toStrictEqual([...from.boxes.labels.keys()]);
    // D19 parameters: the arc gain and each role's tangent limit take part in the reuse check
    for (const d19 of [{ ...CP, arcGain: { num: 5, den: 4 } }, { ...CP, arcTangentLimit: { ...CP.arcTangentLimit, faction: 46 } }, { ...CP, arcTangentLimit: { ...CP.arcTangentLimit, territory: 74 } }]) {
      expect(placeCentredFactions(run.p, run.tables[1]!, run.factionAspects, P, SP, d19, from).recomputed).toStrictEqual([...from.boxes.labels.keys()]);
    }
    const sp2 = { ...SP, leaderGap: SP.leaderGap + 1 };
    expect(placeCentredFactions(run.p, run.tables[1]!, run.factionAspects, P, sp2, CP, from).recomputed).toStrictEqual([...from.boxes.labels.keys()]);
    expect(placeCentredFactions(run.p, run.tables[1]!, run.factionAspects, P, SP, CP, from).recomputed).toStrictEqual([]);
  });

  it('PD2 FR-217 `boxes` hold only 007 horizontal frames: a label with no 007 horizontal frame has no box', () => {
    const t = run.centredTerritories;
    let horizontal = 0;
    for (let entry = 1; entry < run.p.entries; entry++) {
      if (t.eligible[entry] !== 1) continue;
      const frame = t.inLand[entry];
      if (frame !== undefined && frame.shape === 'horizontal') {
        expect(t.boxes[entry]).toBe(frame.box);
        horizontal++;
      } else {
        expect(t.boxes[entry], `entry ${String(entry)}`).toBeUndefined();
      }
    }
    expect(horizontal).toBeGreaterThan(0);
    for (const f of run.centredFactions) {
      for (const [faction, label] of f.boxes.labels) {
        const frame = f.inLand.get(faction);
        if (frame !== undefined && frame.shape === 'horizontal') expect(label.box).toBe(frame.box);
        else expect(label.box, `faction ${String(faction)}`).toBeUndefined();
      }
    }
    // never the 005 box: no 007 horizontal box that differs from the in-land search appears anywhere else
    const five = run.territories.boxes;
    let differs = 0;
    for (let entry = 1; entry < run.p.entries; entry++) {
      const a = five[entry];
      const b = t.boxes[entry];
      if (b !== undefined && JSON.stringify(a) !== JSON.stringify(b)) differs++;
    }
    expect(differs).toBeGreaterThan(0);
  });

  it('FR-229 the counts of the 007 layouts equal the frames drawn, and a territory layout sums to the eligible labels', () => {
    for (let round = 0; round <= run.rounds; round++) {
      const f = run.centredFactions[round]!;
      const counts = labelCounts(run.texts, run.tables[round]!, f, run.centredTerritories);
      const expected: Counts = { horizontal: 0, straight: 0, arc: 0, offLand: 0, none: 0 };
      for (const id of f.boxes.labels.keys()) {
        const d = f.placed.get(id) ?? f.inLand.get(id);
        if (d === undefined) expected.none++;
        else if (d.shape === 'off-land') expected.offLand++;
        else expected[d.shape]++;
      }
      expect(counts.faction).toStrictEqual(expected);
      const sum = counts.territory.horizontal + counts.territory.straight + counts.territory.arc + counts.territory.offLand + counts.territory.none;
      expect(sum).toBe(70);
      console.log(`label-centred-place: round ${String(round)} counts faction ${JSON.stringify(counts.faction)} territory ${JSON.stringify(counts.territory)}`);
    }
  });

  it('NFR-44 the 007 digest of the dev-map placement is pinned and does not depend on the run', async () => {
    const digest = centredLayoutDigest(run.centredTerritories, run.centredFactions);
    expect(await devCentredDigest()).toBe(digest);
    console.log(`label-centred-place: 007 layout digest ${digest}`);
    expect(digest).toBe(PINNED_007_DIGEST);
  }, 60000); // the second placement of the dev map takes about 5 s on a loaded machine

  it('NFR-44 the 006 D11 digest of the retained placement is unchanged', () => {
    expect(layoutDigest(run.territories, run.factions)).toBe(PINNED_006_DIGEST);
  });

  it('NFR-44 the digest sees a changed frame, a changed step and a missing box (planted differences)', () => {
    const base = centredLayoutDigest(run.centredTerritories, run.centredFactions);
    const entry = run.centredTerritories.boxes.findIndex((b) => b !== undefined);
    expect(entry).toBeGreaterThan(0);
    const steps = run.centredTerritories.steps.map((s, i) => (i === entry ? 99 : s));
    expect(centredLayoutDigest({ ...run.centredTerritories, steps }, run.centredFactions)).not.toBe(base);
    const boxes = run.centredTerritories.boxes.map((b, i) => (i === entry ? undefined : b));
    expect(centredLayoutDigest({ ...run.centredTerritories, boxes }, run.centredFactions)).not.toBe(base);
  });

  it('NFR-44 the changed-label list versus 006 (injected aspects): counts by kind are recorded', () => {
    const { changed, total } = changedLabels(run);
    const counts = changeCounts(changed);
    const lines = [...counts].map(([kind, n]) => `${kind}: ${String(n)}`);
    console.log(`label-centred-place: ${String(changed.length)} of ${String(total)} labels changed versus 006\n  ${lines.join('\n  ')}`);
    console.log(`label-centred-place: changed labels\n  ${changed.map((c) => `${c.role}${c.round >= 0 ? ` r${String(c.round)}` : ''} ${c.name}: ${c.before} -> ${c.after} [${c.kind}]`).join('\n  ')}`);
    expect(total).toBe(70 + [...run.factions].reduce((s, f) => s + f.boxes.labels.size, 0));
    expect(changed.length).toBe(83);
    expect(Object.fromEntries(counts)).toStrictEqual({
      'territory: arc -> straight': 3,
      'territory: horizontal, moved or resized': 5,
      'territory: straight -> arc': 4,
      'territory: horizontal -> arc': 25,
      'territory: horizontal -> straight': 18,
      'territory: straight, angle changed': 6,
      'territory: straight, same angle (moved or resized)': 2,
      'territory: arc, moved or resized': 4,
      'territory: straight -> horizontal': 1,
      'faction: horizontal, moved or resized': 7,
      'faction: arc -> straight': 3,
      'faction: straight, angle changed': 2,
      'faction: horizontal -> arc': 2,
      'faction: horizontal -> straight': 1,
    });
  });

  it('FR-217 the placement reads no ambient state', () => {
    const spies = [vi.spyOn(Math, 'random'), vi.spyOn(Date, 'now'), vi.spyOn(performance, 'now')];
    for (const s of spies) s.mockImplementation(() => { throw new Error('ambient'); });
    try {
      const f = placeCentredFactions(run.p, run.tables[2]!, run.factionAspects, P, SP, CP);
      sameLayout(f, run.centredFactions[2]!);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});

describe('NFR-44 the changed-label list versus 006 with the aspects measured in Chrome (PD10)', () => {
  it('NFR-44 the kinds of change are recorded for the measured aspects', async () => {
    const run = withCentred(await measuredRun());
    const { changed, total } = changedLabels(run);
    const counts = changeCounts(changed);
    const shapes = { horizontal: 0, straight: 0, arc: 0, offLand: 0, none: 0 };
    for (let e = 1; e < run.p.entries; e++) {
      if (run.centredTerritories.eligible[e] !== 1) continue;
      const d = run.centredTerritories.placed[e] ?? run.centredTerritories.inLand[e];
      if (d === undefined) shapes.none++;
      else if (d.shape === 'off-land') shapes.offLand++;
      else shapes[d.shape]++;
    }
    const before = { horizontal: 0, straight: 0, arc: 0, offLand: 0, none: 0 };
    for (let e = 1; e < run.p.entries; e++) {
      if (run.territories.eligible[e] !== 1) continue;
      const d = run.territories.placed[e] ?? run.territories.inLand[e];
      if (d === undefined) before.none++;
      else if (d.shape === 'off-land') before.offLand++;
      else before[d.shape]++;
    }
    console.log(`label-centred-place: measured aspects: 006 territory shapes ${JSON.stringify(before)}`);
    expect(before).toStrictEqual({ horizontal: 39, straight: 22, arc: 9, offLand: 0, none: 0 });
    const lines = [...counts].map(([k, n]) => `${k}: ${String(n)}`);
    console.log(
      `label-centred-place: measured aspects: ${String(changed.length)} of ${String(total)} labels changed versus 006; 007 territory shapes ${JSON.stringify(shapes)}\n  ${lines.join('\n  ')}`,
    );
    const rows = changed.map((c) => `${c.role}${c.round >= 0 ? ` r${String(c.round)}` : ''} ${c.name}: ${c.before} -> ${c.after} [${c.kind}]`);
    console.log(`label-centred-place: measured changed labels\n  ${rows.join('\n  ')}`);
    expect(total).toBe(70 + run.factions.reduce((s, f) => s + f.boxes.labels.size, 0));
    expect(changed.length).toBe(82);
    expect(shapes).toStrictEqual({ horizontal: 7, straight: 22, arc: 41, offLand: 0, none: 0 });
    expect(Object.fromEntries(counts)).toStrictEqual({
      'territory: arc, moved or resized': 5,
      'territory: horizontal -> straight': 10,
      'territory: straight -> arc': 11,
      'territory: horizontal -> arc': 23,
      'territory: horizontal, moved or resized': 5,
      'territory: straight, angle changed': 9,
      'territory: straight -> horizontal': 1,
      'territory: arc -> straight': 2,
      'territory: straight, same angle (moved or resized)': 1,
      'faction: horizontal, moved or resized': 7,
      'faction: horizontal -> straight': 4,
      'faction: arc -> straight': 2,
      'faction: horizontal -> arc': 2,
    });
  }, 240000);
});
