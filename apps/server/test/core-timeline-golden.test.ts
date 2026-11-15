import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCENARIOS, T0, handEventTypes, runScenario } from './helpers/core-timelines';
import type { ActionSummary, CreationSummary, Scenario } from './helpers/core-timelines';

// NFR-48 (core timelines) and NFR-50 (fake clock, logic part): six scripted dev-map matches driven through the pure core
// with the fake clock. Each action has hand-derived expectations (helpers/core-timelines.ts: instants, causes, anchors,
// stage, from the spec formulas); the digests and the event order are pinned by golden/core-timelines.json, which this
// test never writes (golden/generate-core-timelines.ts, run by hand and reviewed). Victims and records equal
// golden/dev-secrets.json (FR-315 core part: timing never changes the outcomes; traced in M2b).

interface Golden {
  t0: number;
  scenarios: Record<string, { timing: unknown; secret: string; creation: CreationSummary; actions: ActionSummary[] }>;
}
interface DevSecrets {
  matches: Record<string, { rounds: { round: number; victim: number; absorber: number; transferred: number[]; stateDigest: string }[] }>;
}
const golden = JSON.parse(readFileSync(new URL('./golden/core-timelines.json', import.meta.url), 'utf8')) as Golden;
const secrets = JSON.parse(readFileSync(new URL('./golden/dev-secrets.json', import.meta.url), 'utf8')) as DevSecrets;

const runs = new Map(SCENARIOS.map((s) => [s.name, runScenario(s)]));
const run = (s: Scenario) => runs.get(s.name)!;

describe('core timeline goldens (NFR-48 core timelines)', () => {
  it('NFR-48 (core timelines) the six scenarios of the plan are scripted, with the timings and secrets they name', () => {
    expect(SCENARIOS.map((s) => s.name)).toStrictEqual(['on-time', 'l2-zero', 'manual', 'mid-round-advances', 'downtime-forward-jump', 'backward-jump']);
    expect(SCENARIOS.map((s) => s.timing)).toStrictEqual([
      { i: 120, l1: 30, l2: 10 },
      { i: 60, l1: 20, l2: 0 },
      'manual',
      { i: 120, l1: 30, l2: 10 },
      { i: 120, l1: 30, l2: 10 },
      { i: 120, l1: 30, l2: 10 },
    ]);
    expect(new Set(SCENARIOS.map((s) => s.secret))).toStrictEqual(new Set(['ascending-00-1f', 'all-a5']));
    expect(Object.keys(golden.scenarios)).toStrictEqual(SCENARIOS.map((s) => s.name));
    expect(golden.t0).toBe(T0);
  });

  for (const s of SCENARIOS) {
    describe(`scenario ${s.name}`, () => {
      it(`NFR-48 (core timelines) ${s.name}: every action gives the hand-derived rows, anchors and stage (instants and causes from the spec formulas)`, () => {
        const r = run(s);
        s.actions.forEach((a, n) => {
          const got = r.summaries[n]!;
          const label = `action ${n} (at ${a.at}, ${a.act})`;
          if (a.expect === null) {
            expect(r.performed[n], label).toBe(false);
            expect(got.rows, label).toStrictEqual([]);
            return;
          }
          expect(r.performed[n], label).toBe(true);
          expect(got.rows, label).toStrictEqual(a.expect.rows.map(([round, kind, offset, cause]) => [round, kind, T0 + offset, cause]));
          expect(got.anchors, label).toStrictEqual(a.expect.anchors === null ? null : a.expect.anchors.map((o) => T0 + o));
          expect(got.stage, label).toBe(a.expect.stage);
          // FR-287 (d): the event types of the decision, derived by hand from plan 20.4 (one `results` event per scored phase).
          expect(got.events, label).toStrictEqual(handEventTypes(a.expect.rows.map((r) => r[1]), a.expect.stage === 'finished'));
        });
      });

      it(`FR-289 (c) NFR-48 (core timelines) ${s.name}: the first event is the creation schedule event, seq 1, with the hand-derived anchors, and it equals the pinned golden`, () => {
        const first = run(s).driver.events[0]!;
        const t = s.timing;
        const anchors = t === 'manual' ? {} : { schedule: { c1: T0 + (t.i - t.l1 - t.l2) * 1000, c2: T0 + (t.i - t.l2) * 1000, a: T0 + t.i * 1000 } };
        expect(first).toStrictEqual({ type: 'schedule', seq: 1, stage: 'phase-1', ...anchors, reportedTime: T0 });
        expect(run(s).driver.events.map((e) => e.seq)).toStrictEqual(run(s).driver.events.map((_, i) => i + 1));
        expect(golden.scenarios[s.name]!.creation).toStrictEqual(run(s).creation);
        expect(run(s).creation).toMatchObject({ events: ['schedule'], lastSeq: 1 });
      });

      it(`NFR-48 (core timelines) ${s.name}: the run equals the pinned golden, action by action`, () => {
        const pinned = golden.scenarios[s.name]!;
        expect(pinned.timing).toStrictEqual(s.timing);
        expect(pinned.secret).toBe(s.secret);
        expect(run(s).summaries).toStrictEqual(pinned.actions);
      });

      it(`NFR-48 (core timelines) ${s.name}: victims, records and state digests equal golden/dev-secrets.json whatever the timing`, () => {
        const r = run(s);
        const rounds = secrets.matches[s.secret]!.rounds;
        expect(r.driver.view.stage).toBe('finished');
        expect(r.driver.applied).toHaveLength(rounds.length);
        r.driver.applied.forEach((a, i) => {
          const g = rounds[i]!;
          expect(a.record, `round ${g.round}`).toStrictEqual({ round: g.round, eliminated: g.victim, absorber: g.absorber, transferred: g.transferred });
          expect(a.stateDigest, `round ${g.round}`).toBe(g.stateDigest);
        });
        const revealed = r.driver.events.filter((e) => e.type === 'victim-revealed');
        expect(revealed.map((e) => (e as unknown as { victim: number }).victim)).toStrictEqual(rounds.map((g) => g.victim));
      });

      it(`NFR-50 ${s.name}: stored instants never go down, the reported time never goes down, and a step is never before its schedule`, () => {
        const r = run(s);
        const rows = r.driver.steps;
        for (let i = 1; i < rows.length; i++) expect(rows[i]!.instant, `row ${i}`).toBeGreaterThanOrEqual(rows[i - 1]!.instant);
        for (let i = 1; i < r.summaries.length; i++) expect(r.summaries[i]!.reported, `action ${i}`).toBeGreaterThanOrEqual(r.summaries[i - 1]!.reported);
        // Three rows per round, in the order of the stages, T rounds.
        expect(rows).toHaveLength(12);
        rows.forEach((row, i) => {
          expect(row.round).toBe(Math.floor(i / 3) + 1);
          expect(row.kind).toBe((['phase-1-close', 'phase-2-close', 'application'] as const)[i % 3]);
        });
        // Clock steps are stored at their scheduled instant, within the 1000 ms tolerance of the performing reading.
        s.actions.forEach((a, n) => {
          const sum = r.summaries[n]!;
          for (const row of sum.rows) if (row[3] === 'clock') expect(sum.effective - row[2], `action ${n}`).toBeGreaterThanOrEqual(0);
          for (const row of sum.rows) if (row[3] === 'clock') expect(sum.effective - row[2], `action ${n}`).toBeLessThanOrEqual(1000);
        });
      });
    });
  }

  it('NFR-50 the L2 = 0 scenario stores the phase-2 close and the application with the same instant in one decision, events in order (FR-240 decision)', () => {
    const r = run(SCENARIOS[1]!);
    const chains = r.summaries.filter((a) => a.rows.length === 2);
    expect(chains).toHaveLength(4);
    for (const c of chains) {
      expect(c.rows[0]![1]).toBe('phase-2-close');
      expect(c.rows[1]![1]).toBe('application');
      expect(c.rows[0]![2]).toBe(c.rows[1]![2]);
      expect(c.rows[0]![3]).toBe('clock');
      expect(c.rows[1]![3]).toBe('clock');
      // phase-closed (2), round-applied, then the schedule event of the next round (none after the last round).
      expect(c.events.slice(0, 3)).toStrictEqual(['phase-closed', 'round-applied', 'results']);
    }
  });

  it('NFR-50 the backward jump leaves the effective instant at the last step instant and a step by hand is stored there', () => {
    const r = run(SCENARIOS[5]!);
    expect(r.summaries[1]!.at).toBe(80_000 - 3_600_000);
    const handStep = r.summaries[2]!;
    expect(handStep.act).toBe('phase-2-close');
    expect(handStep.effective).toBe(T0 + 80_000);
    expect(handStep.rows).toStrictEqual([[1, 'phase-2-close', T0 + 80_000, 'manual']]);
    expect(r.summaries[1]!.effective).toBe(T0 + 80_000);
    expect(r.summaries[1]!.reported).toBe(T0 + 80_000);
  });


  it('FR-244 FR-254 NFR-48 (core timelines) the public view and the schedule event of an early manual phase-1 close and phase-2 close can be encoded (regression: ordering by stage)', () => {
    const r = run(SCENARIOS[3]!);
    const afterP1 = r.summaries[0]!; // manual phase-1 close at 10 s: c1 = 80 s is later than c2 = 40 s
    const afterP2 = r.summaries[1]!; // manual phase-2 close at 20 s: c2 = 40 s is later than a = 30 s
    expect(afterP1.anchors).toStrictEqual([T0 + 80_000, T0 + 40_000, T0 + 50_000]);
    expect(afterP2.anchors).toStrictEqual([T0 + 80_000, T0 + 40_000, T0 + 30_000]);
    expect(afterP1.publicDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(afterP2.publicDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(afterP1.events).toStrictEqual(['phase-closed', 'victim-revealed', 'results', 'schedule']);
  });
});
