import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCENARIOS, T0, runScenario } from './helpers/core-timelines';
import type { ActionSummary, CreationSummary } from './helpers/core-timelines';
import { runServiceScenario } from './helpers/service-timelines';
import type { Restarts, ServiceActionSummary, ServiceCreationSummary, ServiceRun } from './helpers/service-timelines';
import { withTempDir } from './helpers/service-harness';

// NFR-48 (lifecycle goldens): the six scripted dev-map matches of the core goldens driven through the lifecycle SERVICE
// (store, fake clock, fake random source). Three independent references:
// - the hand-derived rows, anchors and stage of every action (helpers/core-timelines.ts, from the spec formulas);
// - golden/core-timelines.json (the pure core, pinned in M2a and re-pinned in M2b T2): the service stores the same rows,
//   event types, anchors, stages, victims and records, with the same effective and reported times;
// - golden/service-timelines.json: the generated parts (match id, public data digests, event numbers, every stored event)
//   as regression pins; written only by golden/generate-service-timelines.ts, run by hand and reviewed (never by a test).
// With a database file, the run stays equal with a restart after every action and with every tick performed by start()
// of a restarted service (FR-315 restart after every step; the recovery checks themselves are in service-restart.test.ts).

interface CoreGolden {
  t0: number;
  scenarios: Record<string, { creation: CreationSummary; actions: ActionSummary[] }>;
}
interface ServiceGolden {
  t0: number;
  scenarios: Record<string, { timing: unknown; secret: string; matchId: string; creation: ServiceCreationSummary; actions: ServiceActionSummary[]; eventsDigest: string }>;
}
interface DevSecrets {
  matches: Record<string, { rounds: { round: number; victim: number; absorber: number; transferred: number[]; stateDigest: string }[] }>;
}
const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./golden/${name}`, import.meta.url), 'utf8')) as T;
const GOLDEN_FILE = new URL('./golden/service-timelines.json', import.meta.url);
const golden: ServiceGolden = existsSync(GOLDEN_FILE) ? read<ServiceGolden>('service-timelines.json') : { t0: 0, scenarios: {} };
const core = read<CoreGolden>('core-timelines.json');
const secrets = read<DevSecrets>('dev-secrets.json');
const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const memory = new Map(SCENARIOS.map((s) => [s.name, runServiceScenario(s)]));

/** The fields of a service summary that the pure core also produces (the public digest differs: the core uses a test id). */
const coreFields = ({ at, act, effective, reported, rows, events, stage, appliedRounds, anchors, victim, recordDigest }: ActionSummary) => ({
  at, act, effective, reported, rows, events, stage, appliedRounds, anchors, victim, recordDigest,
});

describe('service timeline goldens (NFR-48 lifecycle)', () => {
  it('NFR-48 (lifecycle) the golden holds the six scenarios of the core goldens, with the same timings and secrets', () => {
    expect(Object.keys(golden.scenarios)).toStrictEqual(SCENARIOS.map((s) => s.name));
    expect(Object.keys(core.scenarios)).toStrictEqual(SCENARIOS.map((s) => s.name));
    expect(golden.t0).toBe(T0);
    for (const s of SCENARIOS) {
      expect(golden.scenarios[s.name]!.timing, s.name).toStrictEqual(s.timing);
      expect(golden.scenarios[s.name]!.secret, s.name).toBe(s.secret);
    }
  });

  for (const s of SCENARIOS) {
    describe(`scenario ${s.name}`, () => {
      const run = (): ServiceRun => memory.get(s.name)!;

      it(`NFR-48 (lifecycle) ${s.name}: through the service every action gives the hand-derived rows, anchors and stage`, () => {
        s.actions.forEach((a, n) => {
          const got = run().summaries[n]!;
          const label = `action ${n} (at ${a.at}, ${a.act})`;
          if (a.expect === null) {
            expect(run().performed[n], label).toBe(false);
            expect(got.rows, label).toStrictEqual([]);
            return;
          }
          expect(run().performed[n], label).toBe(true);
          expect(got.rows, label).toStrictEqual(a.expect.rows.map(([round, kind, offset, cause]) => [round, kind, T0 + offset, cause]));
          expect(got.anchors, label).toStrictEqual(a.expect.anchors === null ? null : a.expect.anchors.map((o) => T0 + o));
          expect(got.stage, label).toBe(a.expect.stage);
        });
      });

      it(`NFR-48 (lifecycle) ${s.name}: rows, event types, anchors, stages, victims, records, effective and reported times equal the core golden, and the events are numbered like the core's`, () => {
        const pinned = core.scenarios[s.name]!;
        // The one known difference: the shell adds `match-finished` after the application of round T (FR-246); the
        // pure core has no such event (M2a hand-off), so the expectation is the core golden with that event appended.
        const expected = pinned.actions.map(coreFields).map((a) => (a.stage === 'finished' && a.rows.length > 0 ? { ...a, events: [...a.events, 'match-finished'] } : a));
        expect(expected.filter((a) => a.events.includes('match-finished'))).toHaveLength(1);
        expect(run().summaries.map(coreFields)).toStrictEqual(expected);
        expect(run().creation.events).toStrictEqual(pinned.creation.events);
        expect(run().creation.lastSeq).toBe(pinned.creation.lastSeq);
        // The pure core run of the same scenario numbers the same events with the same numbers, from 1 without a gap.
        const coreRun = runScenario(s);
        const coreEvents = coreRun.driver.events.map((e) => [e.seq, e.type]);
        expect(run().final.events.map((e) => [e.seq, e.type])).toStrictEqual([...coreEvents, [coreEvents.length + 1, 'match-finished']]);
        expect(run().final.events.map((e) => e.seq)).toStrictEqual(run().final.events.map((_, i) => i + 1));
        expect(run().summaries.flatMap((x) => x.seqs)).toStrictEqual(run().final.events.slice(1).map((e) => e.seq));
      });

      it(`NFR-48 (lifecycle) ${s.name}: the run equals the pinned service golden (match id, public data digests, event numbers, stored events)`, () => {
        const pinned = golden.scenarios[s.name];
        expect(pinned, 'golden/service-timelines.json has this scenario').toBeDefined();
        expect(run().matchId).toBe(pinned!.matchId);
        expect(run().creation).toStrictEqual(pinned!.creation);
        expect(run().summaries).toStrictEqual(pinned!.actions);
        expect(sha(JSON.stringify(run().final.events))).toBe(pinned!.eventsDigest);
      });

      it(`NFR-48 (lifecycle) ${s.name}: victims, records and state digests equal golden/dev-secrets.json`, () => {
        const rounds = secrets.matches[s.secret]!.rounds;
        expect(run().final.publicMatch.stage).toBe('finished');
        expect(run().final.records.map((r) => [r.round, r.eliminated, r.absorber, [...r.transferred]])).toStrictEqual(rounds.map((g) => [g.round, g.victim, g.absorber, g.transferred]));
        expect(run().final.stateDigests.slice(1)).toStrictEqual(rounds.map((g) => g.stateDigest));
      });

      it(`NFR-48 (lifecycle) FR-315 (restart after every step) ${s.name}: with a database file, uninterrupted, restarted after every action, and with every tick performed by start() of a restarted server, the run equals the pinned golden`, () => {
        const pinned = golden.scenarios[s.name];
        expect(pinned).toBeDefined();
        for (const restarts of ['none', 'after-every-action', 'ticks-by-start'] as Restarts[]) {
          const got = withTempDir((dir) => runServiceScenario(s, { file: join(dir, 'matches.sqlite'), restarts }));
          expect(got.matchId, restarts).toBe(pinned!.matchId);
          expect(got.creation, restarts).toStrictEqual(pinned!.creation);
          expect(got.summaries, restarts).toStrictEqual(pinned!.actions);
          expect(sha(JSON.stringify(got.final.events)), restarts).toBe(pinned!.eventsDigest);
          expect(got.final, restarts).toStrictEqual(run().final);
        }
      });
    });
  }
});
