import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadResultsGolden, runResultsTimeline, snapshotOf } from './helpers/results-timelines';
import type { Mode, ResultsGolden } from './helpers/results-timelines';
import { withTempDir } from './helpers/service-harness';

// The results goldens (spec 008 NFR-48 results, FR-315 results, FR-294 results replay; M4' T5'): for the three dev secrets and
// the fixed prediction set of golden/dev-results.json (seven players in two namespaces, every kind, replaced predictions, a
// winner changed after a reveal, an all-zero player, players who skip rounds), the phase results of every round, the results
// of every player and the whole leaderboard equal the golden under every timeline. The golden is written only by the
// hand-run golden/generate-dev-results.ts (dev-secrets.json, the sim exports and its own arithmetic; nothing of src/core).

const GOLDEN = loadResultsGolden();
const NAMES = Object.keys(GOLDEN);

const expectSame = (got: ReturnType<typeof snapshotOf>, golden: ResultsGolden, where: string): void => {
  expect(got.phaseResults, `${where}: phase results`).toStrictEqual(golden.phaseResults);
  expect(got.players, `${where}: players`).toStrictEqual(golden.players);
  expect(got.leaderboard, `${where}: leaderboard`).toStrictEqual(golden.leaderboard);
};

describe('the results golden', () => {
  it('NFR-48 (results) the golden holds the three dev secrets, 8 phase results each, 8 players each and the leaderboard of 7', () => {
    expect(NAMES).toStrictEqual(['ascending-00-1f', 'ascending-20-3f', 'all-a5']);
    for (const name of NAMES) {
      const g = GOLDEN[name]!;
      expect(Object.keys(g.phaseResults)).toHaveLength(8);
      expect(Object.keys(g.players)).toHaveLength(8);
      expect(g.leaderboard).toHaveLength(7);
      expect(g.predictions.length).toBeGreaterThan(25);
      // The set has every kind, a replaced prediction (the same key twice) and a winner changed after a reveal.
      const keys = g.predictions.map((p) => `${p.playerId}|${p.kind}|${p.round ?? 0}`);
      expect(new Set(keys).size).toBeLessThan(keys.length);
      expect(new Set(g.predictions.map((p) => p.kind))).toStrictEqual(new Set(['victim', 'absorber', 'winner']));
      expect(g.predictions.filter((p) => p.kind === 'winner' && p.before > 0).map((p) => p.playerId)).toContain('web:p4');
      expect(g.leaderboard.find((r) => r.playerId === 'web:p6')).toMatchObject({ total: 0 });
    }
  });

  it('NFR-48 (results) some golden figures are literals: the totals of the first secret, from n = 5, 4, 3, 2 and d = 3, 3, 2, 1', () => {
    // Worth of a right victim at round k: 6 - k. Worth of a right absorber: the candidates of the victim (3, 3, 2, 1 for this
    // secret). The winner is worth the candidates stored at the last change: 5 before any reveal, 4 after the reveal of
    // round 1, 2 after the reveal of round 3.
    const rows = GOLDEN['ascending-00-1f']!.leaderboard.map((r) => [r.rank, r.playerId, r.total, r.correctVictims, r.correctAbsorbers, r.correctWinner]);
    expect(rows).toStrictEqual([
      [1, 'web:p1', 25, 3, 3, 1], // winner 5 + absorbers 3 + 3 + 2 + victims 5 + 4 + 3
      [2, 'discord:p1', 11, 1, 2, 0], // victim 5 + absorbers 3 + 3
      [3, 'web:p5', 10, 2, 2, 0], // victims 4 + 2, absorbers 3 + 1
      [4, 'web:p3', 5, 1, 0, 0], // victim 5 after replacing a wrong pick
      [5, 'web:p2', 4, 0, 0, 1], // winner changed after the reveal of round 1: 4
      [6, 'web:p4', 2, 0, 0, 1], // winner changed after the reveal of round 3: 2
      [7, 'web:p6', 0, 0, 0, 0],
    ]);
    // A tie of the last secret: 9 and 9 share rank 2, the next rank is 4.
    expect(GOLDEN['all-a5']!.leaderboard.map((r) => [r.rank, r.total])).toStrictEqual([[1, 22], [2, 9], [2, 9], [4, 5], [5, 4], [6, 2], [7, 0]]);
  });

  for (const name of NAMES) {
    const golden = GOLDEN[name]!;
    const modes: [string, Mode][] = [
      ['timing manual', 'manual'],
      ['clock I 120, L1 30, L2 10 (on time)', 'clock'],
      ['clock I 90, L1 20, L2 0 (the phase-2 close and the application in one decision)', 'clock-l2-zero'],
      ['a manual advance in every stage of a clock match', 'early-advance'],
      ['late steps after a forward jump and a backward jump of the clock', 'late'],
    ];
    for (const [label, mode] of modes) {
      it(`NFR-48 (results) FR-315 (results) ${name}: the reads equal the golden with ${label}, in memory`, () => {
        expectSame(runResultsTimeline(name, golden, { mode }), golden, `${name} ${mode}`);
      });
    }

    it(`FR-294 (results replay) FR-315 (results) ${name}: the reads equal the golden on a file database with a restart (new store and service, start) after every step`, () => {
      withTempDir((dir) => {
        for (const mode of ['manual', 'clock', 'clock-l2-zero'] as const) {
          expectSame(runResultsTimeline(name, golden, { mode, file: join(dir, `${mode}.sqlite`), restart: true }), golden, `${name} ${mode} restarts`);
        }
        expectSame(runResultsTimeline(name, golden, { mode: 'late', file: join(dir, 'late.sqlite') }), golden, `${name} late on a file`);
      });
    }, 60_000);
  }
});
