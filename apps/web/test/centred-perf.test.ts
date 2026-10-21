import { beforeAll, describe, expect, it } from 'vitest';
import { CENTRE_PARAMS } from '../src/core/centre-params';
import { centreSums, factionHeightCap } from '../src/core/label-centre';
import { centredCache, centredCandidate, centredInLand } from '../src/core/label-centred';
import type { CentredFrame } from '../src/core/label-centred';
import { LABEL_PARAMS } from '../src/core/label-params';
import type { InLandFrame } from '../src/core/label-shape';
import { mainPieces } from '../src/core/regions';
import { SHAPE_PARAMS } from '../src/core/shape-params';
import { measuredRun } from './helpers/shaped-hits';
import type { MeasuredRun } from './helpers/shaped-hits';

// NFR-43 (Node figures, logged and not asserted; plan 007 section 12 and T3 to T5). Run this file alone:
//   npx vitest run apps/web/test/centred-perf.test.ts --silent=false --reporter=verbose
// The timings are only a first check before the browser figures of T9. T3 times the centred candidate at step 1.
const M = LABEL_PARAMS.margin;
const now = (): number => performance.now();
const ms = (v: number): string => v.toFixed(1);

function describeFrame(f: CentredFrame | undefined): string {
  if (f === undefined) return 'none';
  if (f.shape === 'horizontal') return `horizontal h${String(f.box.h)} @(${(f.box.x0 + f.box.w / 2).toFixed(1)},${(f.box.y0 + f.box.h / 2).toFixed(1)})`;
  return `straight ${String(f.angle)} h${String(f.h)} @(${f.cx.toFixed(1)},${f.cy.toFixed(1)})`;
}

describe('NFR-43 Node timings of the centred candidate (logged, not asserted)', () => {
  let run: MeasuredRun;
  beforeAll(async () => {
    run = await measuredRun();
  }, 120000);

  it('NFR-43 territory labels at load: the centred candidate at step 1 for every label', () => {
    const main = mainPieces(run.p);
    const t0 = now();
    let cache = 0;
    let found = 0;
    let labels = 0;
    for (let e = 1; e < run.p.entries; e++) {
      if (run.territories.eligible[e] !== 1) continue;
      const a = run.territoryAspects[e]!;
      const t1 = now();
      const c = centredCache(run.p, [main[e]!], a, M);
      cache += now() - t1;
      if (centredCandidate(run.p, [main[e]!], a, M, CENTRE_PARAMS, 1, c, undefined) !== undefined) found++;
      labels++;
    }
    console.log(`centred-perf: territories ${String(labels)} labels, ${String(found)} with a frame at step 1: total ${ms(now() - t0)} ms (caches ${ms(cache)} ms)`);
    expect(labels).toBe(70);
  }, 120000);

  it('NFR-43 faction labels: every label of rounds 0..T from scratch at step 1, with the faction cap', () => {
    let total = 0;
    for (let round = 0; round <= run.rounds; round++) {
      let roundMs = 0;
      const parts: string[] = [];
      for (const [faction, label] of run.factions[round]!.boxes.labels) {
        const s = centreSums(run.p, label.pieces);
        const cap = factionHeightCap(s.n, label.aspect, CENTRE_PARAMS.factionAreaShare);
        const t0 = now();
        const c = centredCache(run.p, label.pieces, label.aspect, M);
        const report = { hStraight: 0, angleStraight: 0, hHorizontal: 0, horizontalBound: 0 };
        const f = centredCandidate(run.p, label.pieces, label.aspect, M, CENTRE_PARAMS, 1, c, cap, { report });
        const dt = now() - t0;
        roundMs += dt;
        parts.push(`${run.texts.factions.get(faction)!} n${String(s.n)} cap${String(cap)} ${describeFrame(f)} ${ms(dt)} ms`);
      }
      total += roundMs;
      console.log(`centred-perf: round ${String(round)} from scratch ${ms(roundMs)} ms\n  ${parts.join('\n  ')}`);
    }
    expect(total).toBeGreaterThan(0);
  }, 240000);

  it('NFR-43 NFR-46 Francia at round 4: frame, offset from C and timing for the measured aspect and for aspect 4, with and without the distance map', () => {
    let francia: { pieces: readonly number[]; aspect: number } | undefined;
    for (const [faction, label] of run.factions[run.rounds]!.boxes.labels) {
      if (run.texts.factions.get(faction) === 'Francia') francia = { pieces: label.pieces, aspect: label.aspect };
    }
    expect(francia).toBeDefined();
    const s = centreSums(run.p, francia!.pieces);
    const mx = Number(s.sx) / Number(s.n) + 0.5;
    const my = Number(s.sy) / Number(s.n) + 0.5;
    const rho = 0.14 * Math.sqrt(Number(s.n));
    for (const aspect of [francia!.aspect, 4]) {
      const cap = factionHeightCap(s.n, aspect, CENTRE_PARAMS.factionAreaShare);
      for (const distance of [false, true]) {
        const t0 = now();
        const c = centredCache(run.p, francia!.pieces, aspect, M, distance);
        const t1 = now();
        const report = { hStraight: 0, angleStraight: 0, hHorizontal: 0, horizontalBound: 0 };
        const f = centredCandidate(run.p, francia!.pieces, aspect, M, CENTRE_PARAMS, 1, c, cap, { report });
        const t2 = now();
        const fx = f === undefined ? 0 : f.shape === 'horizontal' ? f.box.x0 + f.box.w / 2 : f.cx;
        const fy = f === undefined ? 0 : f.shape === 'horizontal' ? f.box.y0 + f.box.h / 2 : f.cy;
        const d = Math.sqrt((fx - mx) * (fx - mx) + (fy - my) * (fy - my));
        console.log(
          `centred-perf: Francia r4 aspect ${String(aspect)} cap ${String(cap)} distance-map ${String(distance)}: ${describeFrame(f)}, ` +
            `${d.toFixed(1)} from C (rho ${rho.toFixed(1)}), cache ${ms(t1 - t0)} ms, candidate ${ms(t2 - t1)} ms, ` +
            `hS ${String(report.hStraight)} (angle ${String(report.angleStraight)}) hH ${String(report.hHorizontal)} bound ${String(report.horizontalBound)}`,
        );
        expect(f).toBeDefined();
      }
    }
  }, 240000);
});

// T4: the full in-land search (arcs, the FR-221 choice, the FR-222 widening and the faction cap).
describe('NFR-43 FR-221 FR-222 FR-230 Node timings of the in-land search with arcs and widening (logged, not asserted)', () => {
  let run: MeasuredRun;
  beforeAll(async () => {
    run = await measuredRun();
  }, 120000);

  const shapeName = (f: InLandFrame | undefined): string => {
    if (f === undefined) return 'none';
    if (f.shape === 'horizontal') return `horizontal h${String(f.box.h)}`;
    if (f.shape === 'straight') return `straight ${String(f.angle)} h${String(f.h)}`;
    return `arc ${String(f.bend)} h${String(f.h)}`;
  };

  it('NFR-43 FR-222 territory labels at load: centredInLand for every label, and the labels that need the widening', () => {
    const main = mainPieces(run.p);
    const t0 = now();
    const counts = { horizontal: 0, straight: 0, arc: 0, none: 0 };
    const widened: string[] = [];
    const noStepOne: string[] = [];
    let slowest = { name: '', ms: 0 };
    let labels = 0;
    for (let e = 1; e < run.p.entries; e++) {
      if (run.territories.eligible[e] !== 1) continue;
      const a = run.territoryAspects[e]!;
      const name = run.texts.territories[e]!;
      const t1 = now();
      const r = centredInLand(run.p, [main[e]!], a, 'territory', LABEL_PARAMS, SHAPE_PARAMS, CENTRE_PARAMS);
      const dt = now() - t1;
      if (dt > slowest.ms) slowest = { name, ms: dt };
      counts[r.frame === undefined ? 'none' : r.frame.shape]++;
      if (r.k > 1) widened.push(`${name} (k ${String(r.k)}/${String(r.kEnd)}, ${shapeName(r.frame)})`);
      const c = centredCache(run.p, [main[e]!], a, M);
      if (centredCandidate(run.p, [main[e]!], a, M, CENTRE_PARAMS, 1, c, undefined) === undefined) noStepOne.push(`${name} (${shapeName(r.frame)} at k ${String(r.k)})`);
      labels++;
    }
    console.log(
      `centred-perf: territories ${String(labels)} labels with arcs and widening: total ${ms(now() - t0)} ms, slowest ${slowest.name} ${ms(slowest.ms)} ms; ` +
        `horizontal ${String(counts.horizontal)} straight ${String(counts.straight)} arc ${String(counts.arc)} none ${String(counts.none)}\n` +
        `  no centred frame at step 1: ${noStepOne.join('; ') || '-'}\n  widened (k > 1): ${widened.join('; ') || '-'}`,
    );
    expect(labels).toBe(70);
  }, 240000);

  it('NFR-43 FR-222 FR-230 faction labels: centredInLand for every label of rounds 0..T from scratch', () => {
    let total = 0;
    for (let round = 0; round <= run.rounds; round++) {
      let roundMs = 0;
      const parts: string[] = [];
      for (const [faction, label] of run.factions[round]!.boxes.labels) {
        const t0 = now();
        const r = centredInLand(run.p, label.pieces, label.aspect, 'faction', LABEL_PARAMS, SHAPE_PARAMS, CENTRE_PARAMS);
        const dt = now() - t0;
        roundMs += dt;
        parts.push(`${run.texts.factions.get(faction)!} ${shapeName(r.frame)} k${String(r.k)}/${String(r.kEnd)} ${ms(dt)} ms`);
      }
      total += roundMs;
      console.log(`centred-perf: round ${String(round)} in-land search from scratch ${ms(roundMs)} ms\n  ${parts.join('\n  ')}`);
    }
    expect(total).toBeGreaterThan(0);
  }, 240000);
});
