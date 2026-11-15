import { describe, expect, it } from 'vitest';
import { errorReply, roundNotApplied } from '@mbrg/protocol';
import { isScored, rankLeaderboard, readResultsRound, scorePhase, scoredPhaseCount } from '../src/core/scoring';
import type { PlayerTotals, ResultRow, ScoredPhase } from '../src/core/scoring';
import { coreDriver } from './helpers/core-driver';
import { SECRETS } from './helpers/core-timelines';
import { roundSeed } from '../src/secret';
import type { Driver } from './helpers/core-driver';

const victimPhase = (round: number, answer: number, worth: number): ScoredPhase => ({ kind: 'victim', round, answer, worth });
const absorberPhase = (round: number, answer: number, worth: number): ScoredPhase => ({ kind: 'absorber', round, answer, worth });
const winnerPhase = (answer: number): ScoredPhase => ({ kind: 'winner', answer });
const row = (playerId: string, kind: ResultRow['kind'], round: number, choice: number, correct: boolean, points: number): ResultRow => ({
  playerId,
  kind,
  round,
  choice,
  correct,
  points,
});

describe('pure scoring of one phase', () => {
  it('FR-241 (scoring, pure) FR-274 NFR-51 (scoring and ranking) a correct victim prediction is worth the factions living at N: 5, 4, 3, 2 and a non-round 7', () => {
    for (const n of [5, 4, 3, 2, 7]) {
      const rows = scorePhase(victimPhase(1, 40, n), [{ playerId: 'web:a', choice: 40 }]);
      expect(rows).toStrictEqual([row('web:a', 'victim', 1, 40, true, n)]);
    }
  });

  it('FR-241 (scoring, pure) NFR-51 (scoring and ranking) the dev map lists n = 5, 4, 3, 2 factions living at the four victim phases', () => {
    const d = coreDriver();
    const living: number[] = [];
    for (let r = 0; r < 4; r++) {
      d.run('phase-1-close');
      living.push(d.view.victim!.living.length);
      d.run('phase-2-close');
      d.run('application');
    }
    expect(living).toStrictEqual([5, 4, 3, 2]);
  });

  it('FR-243 (scoring, pure) FR-274 NFR-51 (scoring and ranking) a correct absorber prediction is worth the candidates d; d = 1 gives 1; a wrong one is 0', () => {
    const rows = scorePhase(absorberPhase(2, 7, 3), [
      { playerId: 'web:a', choice: 7 },
      { playerId: 'web:b', choice: 8 },
    ]);
    expect(rows).toStrictEqual([row('web:a', 'absorber', 2, 7, true, 3), row('web:b', 'absorber', 2, 8, false, 0)]);
    expect(scorePhase(absorberPhase(3, 9, 1), [{ playerId: 'web:a', choice: 9 }])[0]!.points).toBe(1);
    expect(scorePhase(absorberPhase(3, 9, 6), [{ playerId: 'web:a', choice: 9 }])[0]!.points).toBe(6);
  });

  it('FR-246 (scoring, pure) FR-274 NFR-51 (scoring and ranking) each winner prediction is worth its own stored candidate count, with round 0', () => {
    const rows = scorePhase(winnerPhase(12), [
      { playerId: 'web:a', choice: 12, winnerCandidates: 5 },
      { playerId: 'web:b', choice: 12, winnerCandidates: 3 },
      { playerId: 'web:c', choice: 13, winnerCandidates: 4 },
    ]);
    expect(rows).toStrictEqual([
      row('web:a', 'winner', 0, 12, true, 5),
      row('web:b', 'winner', 0, 12, true, 3),
      row('web:c', 'winner', 0, 13, false, 0),
    ]);
  });

  it('FR-274 NFR-51 (scoring and ranking) a winner prediction stored without its candidate count is a data error, not a guess', () => {
    expect(() => scorePhase(winnerPhase(12), [{ playerId: 'web:a', choice: 12 }])).toThrow(RangeError);
    // Also for a wrong choice: FR-267 stores the count with every winner prediction.
    expect(() => scorePhase(winnerPhase(12), [{ playerId: 'web:a', choice: 13 }])).toThrow(RangeError);
  });

  it('FR-274 NFR-51 (scoring and ranking) one row per prediction, correct or not, ordered by player id in code-unit order', () => {
    const rows = scorePhase(victimPhase(1, 4, 5), [
      { playerId: 'web:a', choice: 4 },
      { playerId: 'discord:z', choice: 9 },
      { playerId: 'web:B', choice: 4 },
    ]);
    expect(rows.map((r) => r.playerId)).toStrictEqual(['discord:z', 'web:B', 'web:a']);
    expect(rows.map((r) => r.points)).toStrictEqual([0, 5, 5]);
    expect(scorePhase(victimPhase(1, 4, 5), [])).toStrictEqual([]);
  });

  it('FR-274 NFR-51 (scoring and ranking) a wrong choice is 0 points, never negative', () => {
    const rows = scorePhase(victimPhase(3, 4, 3), [{ playerId: 'web:a', choice: 5 }]);
    expect(rows[0]!.points).toBe(0);
    expect(rows[0]!.correct).toBe(false);
  });

  it('FR-274 NFR-51 (scoring and ranking) a player correct in every round gets the plain sum, with no streak bonus', () => {
    let total = 0;
    for (const [round, n] of [[1, 5], [2, 4], [3, 3], [4, 2]] as const) {
      total += scorePhase(victimPhase(round, 40 + round, n), [{ playerId: 'web:a', choice: 40 + round }])[0]!.points;
    }
    expect(total).toBe(14);
    let absorbers = 0;
    for (const [round, d] of [[1, 2], [2, 2], [3, 1], [4, 1]] as const) {
      absorbers += scorePhase(absorberPhase(round, 70 + round, d), [{ playerId: 'web:a', choice: 70 + round }])[0]!.points;
    }
    expect(absorbers).toBe(6);
  });
});

const totals = (playerId: string, total: number, correctVictims = 0, correctAbsorbers = 0, correctWinner: 0 | 1 = 0): PlayerTotals => ({
  playerId,
  total,
  correctVictims,
  correctAbsorbers,
  correctWinner,
});

describe('pure ranking', () => {
  it('FR-274 NFR-51 (scoring and ranking) totals 9, 9, 4 give ranks 1, 1, 3 (competition ranking, not 1, 2, 3 and not 1, 1, 2)', () => {
    const ranked = rankLeaderboard([totals('web:c', 4), totals('web:a', 9), totals('web:b', 9)]);
    expect(ranked.map((r) => [r.playerId, r.rank])).toStrictEqual([
      ['web:a', 1],
      ['web:b', 1],
      ['web:c', 3],
    ]);
  });

  it('FR-274 NFR-51 (scoring and ranking) equal totals are listed by player id in code-unit order: web:B before web:a', () => {
    const ranked = rankLeaderboard([totals('web:a', 6), totals('web:B', 6), totals('discord:x', 6)]);
    expect(ranked.map((r) => r.playerId)).toStrictEqual(['discord:x', 'web:B', 'web:a']);
    expect(ranked.map((r) => r.rank)).toStrictEqual([1, 1, 1]);
  });

  it('FR-274 NFR-51 (scoring and ranking) a player whose scored predictions are all 0 is ranked, last, with the shared rank of the zeros', () => {
    const ranked = rankLeaderboard([totals('web:z', 0), totals('web:y', 0), totals('web:a', 2), totals('web:b', 1)]);
    expect(ranked.map((r) => [r.playerId, r.rank, r.total])).toStrictEqual([
      ['web:a', 1, 2],
      ['web:b', 2, 1],
      ['web:y', 3, 0],
      ['web:z', 3, 0],
    ]);
  });

  it('FR-274 NFR-51 (scoring and ranking) a row carries the totals and correct counts per kind unchanged, in the fixed key order', () => {
    const [one] = rankLeaderboard([totals('web:a', 17, 3, 2, 1)]);
    expect(one).toStrictEqual({ rank: 1, playerId: 'web:a', total: 17, correctVictims: 3, correctAbsorbers: 2, correctWinner: 1 });
    expect(Object.keys(one!)).toStrictEqual(['rank', 'playerId', 'total', 'correctVictims', 'correctAbsorbers', 'correctWinner']);
  });

  it('FR-274 NFR-51 (scoring and ranking) the ranking leaves the input untouched and an empty list gives an empty list', () => {
    const input = [totals('web:b', 1), totals('web:a', 3)];
    const copy = JSON.stringify(input);
    rankLeaderboard(input);
    expect(JSON.stringify(input)).toBe(copy);
    expect(rankLeaderboard([])).toStrictEqual([]);
  });

  it('FR-274 NFR-51 (scoring and ranking) a long run of ties keeps the rank of the first of the run and skips the run length', () => {
    const ranked = rankLeaderboard([totals('p:1', 10), totals('p:2', 8), totals('p:3', 8), totals('p:4', 8), totals('p:5', 5), totals('p:6', 5), totals('p:7', 1)]);
    expect(ranked.map((r) => r.rank)).toStrictEqual([1, 2, 2, 2, 5, 5, 7]);
  });
});

/** Walks the dev-map match one decision at a time, handing back the driver after each. */
function walk(visit: (d: Driver, label: string) => void): void {
  const d = coreDriver();
  visit(d, 'created');
  for (let r = 1; r <= 4; r++) {
    for (const kind of ['phase-1-close', 'phase-2-close', 'application'] as const) {
      d.run(kind);
      visit(d, `${kind} ${r}`);
    }
  }
}

describe('the scored phases of a view', () => {
  it('FR-279 (d) (generation, pure) NFR-51 (scoring and ranking) the generation is 2N, plus 1 while the victim of round N + 1 is revealed, and 2T when finished', () => {
    const seen: [string, number][] = [];
    walk((d, label) => seen.push([`${label}:${d.view.stage}`, scoredPhaseCount(d.view)]));
    expect(seen).toStrictEqual([
      ['created:phase-1', 0],
      ['phase-1-close 1:phase-2', 1],
      ['phase-2-close 1:locked', 1],
      ['application 1:phase-1', 2],
      ['phase-1-close 2:phase-2', 3],
      ['phase-2-close 2:locked', 3],
      ['application 2:phase-1', 4],
      ['phase-1-close 3:phase-2', 5],
      ['phase-2-close 3:locked', 5],
      ['application 3:phase-1', 6],
      ['phase-1-close 4:phase-2', 7],
      ['phase-2-close 4:locked', 7],
      ['application 4:finished', 8],
    ]);
  });

  it('FR-279 (d) (generation, pure) NFR-51 (scoring and ranking) the generation counts the revealed victim of a match halted after the reveal', () => {
    const d = coreDriver();
    d.run('phase-1-close');
    const halted = { ...d.view, stage: 'halted' as const, haltReason: 'victim-mismatch' as const };
    expect(scoredPhaseCount(halted)).toBe(1);
    expect(scoredPhaseCount({ ...halted, victim: undefined })).toBe(0);
  });

  it('FR-258 (results rounds, pure) NFR-51 (scoring and ranking) phase 1 of round N + 1 is scored only once revealed, phase 2 only for k <= N, round 0 never', () => {
    walk((d, label) => {
      const n = d.view.appliedRounds;
      const revealed = d.view.victim !== undefined;
      const got: string[] = [];
      for (let k = 0; k <= 6; k++) {
        for (const phase of [1, 2] as const) {
          const expected = k >= 1 && (phase === 1 ? k <= n || (k === n + 1 && revealed) : k <= n);
          expect(isScored(d.view, k, phase), `${label} k=${k} phase=${phase}`).toBe(expected);
          if (expected) got.push(`${k}.${phase}`);
        }
      }
      expect(got.length, label).toBe(scoredPhaseCount(d.view));
    });
  });

  it('FR-258 (results rounds, pure) NFR-51 (scoring and ranking) isScored is false for a round that is not a whole number', () => {
    const d = coreDriver();
    d.run('phase-1-close');
    for (const bad of [-1, 1.5, Number.NaN, Infinity, 2 ** 53]) {
      expect(isScored(d.view, bad, 1)).toBe(false);
      expect(isScored(d.view, bad, 2)).toBe(false);
    }
  });
});

describe('the results read of the core', () => {
  it('FR-258 (results rounds, pure) NFR-51 (scoring and ranking) a scored (k, phase) is readable and echoes the round and phase', () => {
    const d = coreDriver();
    expect(readResultsRound(d.view, 1, 1)).toStrictEqual({ ok: false, error: roundNotApplied(0) });
    d.run('phase-1-close');
    expect(readResultsRound(d.view, 1, 1)).toStrictEqual({ ok: true, round: 1, phase: 1 });
    expect(readResultsRound(d.view, 1, 2)).toStrictEqual({ ok: false, error: roundNotApplied(0) });
    d.run('phase-2-close');
    d.run('application');
    expect(readResultsRound(d.view, 1, 2)).toStrictEqual({ ok: true, round: 1, phase: 2 });
    expect(readResultsRound(d.view, 1, 1)).toStrictEqual({ ok: true, round: 1, phase: 1 });
  });

  it('FR-258 (results rounds, pure) NFR-51 (scoring and ranking) every unscored (k, phase), k above T and k = N + 1 phase 2 included, gets round-not-applied naming only N, in the same bytes', () => {
    const stages = new Set<string>();
    walk((d, label) => {
      const n = d.view.appliedRounds;
      stages.add(d.view.stage);
      const expected = JSON.stringify({ ok: false, error: roundNotApplied(n) });
      let checked = 0;
      for (const k of [1, 2, 3, 4, 5, 9, 1000]) {
        for (const phase of [1, 2] as const) {
          if (isScored(d.view, k, phase)) continue;
          expect(JSON.stringify(readResultsRound(d.view, k, phase)), `${label} k=${k} phase=${phase}`).toBe(expected);
          checked++;
        }
      }
      expect(checked, label).toBeGreaterThan(0);
      expect(expected).toBe(`{"ok":false,"error":{"kind":"round-not-applied","appliedRounds":${n}}}`);
    });
    expect(stages).toStrictEqual(new Set(['phase-1', 'phase-2', 'locked', 'finished']));
  });

  it('FR-258 (results rounds, pure) NFR-51 (scoring and ranking) the unscored reply during phase 1 of round N + 1 does not change when its victim is revealed for the other phase', () => {
    const d = coreDriver();
    const before = JSON.stringify(readResultsRound(d.view, 1, 2));
    d.run('phase-1-close');
    expect(JSON.stringify(readResultsRound(d.view, 1, 2))).toBe(before);
    expect(JSON.stringify(readResultsRound(d.view, 2, 1))).toBe(before);
  });

  it('FR-258 (results rounds, pure) NFR-51 (scoring and ranking) round 0 or a round that is not a whole number is invalid-request naming round, before anything else', () => {
    const d = coreDriver();
    d.run('phase-1-close');
    for (const bad of [0, -1, 1.5, Number.NaN, Infinity, -Infinity, '1' as unknown as number]) {
      for (const phase of [1, 2] as const) {
        expect(readResultsRound(d.view, bad, phase)).toStrictEqual({ ok: false, error: errorReply('invalid-request', ['round']) });
      }
    }
  });

  it('FR-258 (results rounds, pure) NFR-51 (scoring and ranking) a whole round past 2^53 - 1 is a round no match reaches: round-not-applied, not invalid-request', () => {
    const d = coreDriver();
    for (const big of [2 ** 53, 2 ** 60]) {
      expect(readResultsRound(d.view, big, 1)).toStrictEqual({ ok: false, error: roundNotApplied(0) });
      expect(readResultsRound(d.view, big, 2)).toStrictEqual({ ok: false, error: roundNotApplied(0) });
    }
  });

  it('FR-258 (results rounds, pure) NFR-51 (scoring and ranking) a phase other than 1 or 2 is invalid-request naming phase', () => {
    const d = coreDriver();
    for (const bad of [0, 3, -1, 1.5, '1' as unknown as 1]) {
      expect(readResultsRound(d.view, 1, bad as 1)).toStrictEqual({ ok: false, error: errorReply('invalid-request', ['phase']) });
    }
  });

  it('FR-258 (results rounds, pure) NFR-51 (scoring and ranking) the read decides from N, the revealed victim and the stage only', () => {
    const d = coreDriver();
    d.run('phase-1-close');
    const bare = {
      appliedRounds: d.view.appliedRounds,
      victim: d.view.victim,
      stage: d.view.stage,
    } as unknown as typeof d.view;
    for (const k of [0, 1, 2, 5]) {
      for (const phase of [1, 2] as const) {
        expect(isScored(bare, k, phase)).toBe(isScored(d.view, k, phase));
        expect(readResultsRound(bare, k, phase)).toStrictEqual(readResultsRound(d.view, k, phase));
      }
    }
    expect(scoredPhaseCount(bare)).toBe(scoredPhaseCount(d.view));
  });
});

describe('a forced absorber phase is scored and empty', () => {
  it('FR-387 d = 1 never scores: over the whole match of the secret all-a5 no application of a one-candidate round returns an absorber phase, and the generation arithmetic is unchanged', () => {
    const d = coreDriver({ seedOf: (k) => roundSeed(SECRETS['all-a5'], k) });
    const worths: Record<number, number | null> = {};
    const generations: number[] = [];
    for (let k = 1; k <= 4; k++) {
      d.run('phase-1-close');
      const d1 = d.view.victim!.candidates.length;
      d.run('phase-2-close');
      const out = d.run('application');
      const absorbers = (out.scored ?? []).filter((x) => x.kind === 'absorber');
      worths[k] = absorbers.length === 0 ? null : (absorbers[0] as { worth: number }).worth;
      expect(d1 === 1, `round ${k}`).toBe(absorbers.length === 0);
      generations.push(scoredPhaseCount(d.view));
      // The phase 2 of the round has results (empty) for every round, forced or not.
      expect(isScored(d.view, k, 2), `round ${k}`).toBe(true);
    }
    expect(worths).toStrictEqual({ 1: 2, 2: 2, 3: null, 4: null });
    expect(generations).toStrictEqual([2, 4, 6, 8]);
  });
});
