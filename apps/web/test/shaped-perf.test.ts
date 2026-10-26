import { beforeAll, describe, expect, it } from 'vitest';
import { offLandBox } from '../src/core/label-offland';
import type { Obstacle } from '../src/core/label-offland';
import { placeFactions, placeTerritories } from '../src/core/label-place';
import { LABEL_PARAMS } from '../src/core/label-params';
import { mainPieces } from '../src/core/regions';
import { SHAPE_PARAMS } from '../src/core/shape-params';
import { devRun } from './helpers/label-digest-run';
import type { DevRun } from './helpers/label-digest-run';

// NFR-38: timings are logged (Node is noisy and slower than the reference browser), counts are asserted.
// The numbers: 100 ms per step, 150 ms per round change, 2 s for the first frame (placement at load included).
const P = LABEL_PARAMS;
const SP = SHAPE_PARAMS;

describe('NFR-38 what the placement costs on the dev map, seed 1 (times logged)', { timeout: 300000 }, () => {
  let run: DevRun;
  beforeAll(async () => {
    run = await devRun();
  }, 300000);

  it('NFR-38 territory placement happens once per load (time logged)', () => {
    const t0 = performance.now();
    const again = placeTerritories(run.p, run.territoryAspects, P, SP);
    const ms = performance.now() - t0;
    console.log(`shaped-perf: territory placement at load: first ${run.territoryMs.toFixed(0)} ms, second ${ms.toFixed(0)} ms`);
    expect(again.eligible).toStrictEqual(run.territories.eligible);
  });

  it('NFR-38 a state from scratch and every step and jump with reuse (times and recomputed counts logged)', () => {
    console.log(`shaped-perf: faction placement from scratch per round: ${run.factionMs.map((m) => m.toFixed(0)).join(', ')} ms`);
    const rows: string[] = [];
    let worst = 0;
    for (let from = 0; from <= run.rounds; from++) {
      for (let to = 0; to <= run.rounds; to++) {
        if (from === to) continue;
        const t0 = performance.now();
        const next = placeFactions(run.p, run.tables[to]!, run.factionAspects, P, SP, run.factions[from]);
        const ms = performance.now() - t0;
        if (Math.abs(from - to) === 1) {
          rows.push(`${from}->${to} ${ms.toFixed(0)} ms (in-land recomputed ${next.recomputed.length})`);
          worst = Math.max(worst, ms);
          expect(next.recomputed.length).toBeLessThanOrEqual(to > from ? 1 : 2);
        } else {
          rows.push(`jump ${from}->${to} ${ms.toFixed(0)} ms (in-land recomputed ${next.recomputed.length})`);
        }
      }
    }
    console.log(`shaped-perf: per-step faction placement with reuse:\n  ${rows.join('\n  ')}\n  worst single step ${worst.toFixed(0)} ms`);
  });

  it('NFR-38 the off-land window scan of the largest faction region and of every territory (times logged)', () => {
    // largest faction region at round 0, forced off-land at the faction height with every other in-land frame as obstacle
    const f = run.factions[0]!;
    let largest = -1;
    let size = -1;
    for (const [faction, label] of f.boxes.labels) {
      const n = label.pieces.reduce((a, piece) => a + run.p.size[piece]!, 0);
      if (n > size) {
        size = n;
        largest = faction;
      }
    }
    const label = f.boxes.labels.get(largest)!;
    const obstacles: Obstacle[] = [];
    for (const [faction, frame] of f.inLand) if (faction !== largest && frame !== undefined) obstacles.push(frame);
    const t0 = performance.now();
    const box = offLandBox(run.p, label.pieces, label.aspect, SP.offLandHeight.faction, obstacles, P, SP);
    const ms = performance.now() - t0;
    console.log(`shaped-perf: off-land search of the largest faction set (${size} units): ${ms.toFixed(0)} ms, ${box === undefined ? 'none found' : `gap2 ${box.gap2}`}`);
    // every territory forced off-land at the territory height
    const main = mainPieces(run.p);
    let worst = 0;
    let total = 0;
    let n = 0;
    const territoryObstacles: Obstacle[] = [];
    for (const frame of run.territories.inLand) if (frame !== undefined) territoryObstacles.push(frame);
    for (let e = 1; e < run.p.entries; e++) {
      if (run.territories.eligible[e] !== 1) continue;
      const t1 = performance.now();
      offLandBox(run.p, [main[e]!], 3, SP.offLandHeight.territory, territoryObstacles, P, SP);
      const one = performance.now() - t1;
      total += one;
      worst = Math.max(worst, one);
      n++;
    }
    console.log(`shaped-perf: forced off-land search for ${n} territories: total ${total.toFixed(0)} ms, worst ${worst.toFixed(0)} ms`);
    expect(n).toBeGreaterThan(50);
  });

  it('NFR-38 the first-frame total: territory placement plus the first state (time logged)', () => {
    console.log(`shaped-perf: first frame placement (territories + round 0 factions) ${(run.territoryMs + run.factionMs[0]!).toFixed(0)} ms of the 2000 ms budget`);
    expect(run.factions.length).toBe(run.rounds + 1);
  });
});
