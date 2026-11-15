// Scoring, ranking and the scored-phase rules of a match (spec 008 FR-271 to FR-274, FR-279 (d), FR-258; plan 20.2, 20.3).
// Pure: the answer and its worth come from what a step makes public (plan 20.2), the predictions are parameters, and no
// module here reads a store, a clock or a secret. A read decides from N, the revealed victim and the stage only.

import { errorReply, roundNotApplied } from '@mbrg/protocol';
import type { ErrorReply, PredictionKind } from '@mbrg/protocol';
import type { CoreMatch } from './view';

/**
 * One phase to score, built from public data only. Victim: `worth` is n, the factions living at N (victim included).
 * Absorber: `worth` is d, the absorption candidates (d >= 2: a forced absorber, d = 1, is never predicted and never built,
 * so its phase has no rows; `isScored` and `scoredPhaseCount` still count it as scored and empty). Winner: no `worth` (each prediction carries its own count, FR-267)
 * and no round (stored with round 0).
 */
export type ScoredPhase =
  | { readonly kind: 'victim' | 'absorber'; readonly round: number; readonly answer: number; readonly worth: number }
  | { readonly kind: 'winner'; readonly answer: number };

/** One stored prediction as the scorer reads it; `winnerCandidates` is present on every winner prediction (FR-267). */
export interface ScorablePrediction {
  readonly playerId: string;
  readonly choice: number;
  readonly winnerCandidates?: number;
}

/** One row of the `results` table: the winner has round 0; `points` is 0 for a wrong choice and never negative. */
export interface ResultRow {
  readonly playerId: string;
  readonly kind: PredictionKind;
  readonly round: number;
  readonly choice: number;
  readonly correct: boolean;
  readonly points: number;
}

/** Player ids are ASCII: the code-unit order is the SQLite BINARY order. */
const byPlayerId = (a: { readonly playerId: string }, b: { readonly playerId: string }): number =>
  a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;

/**
 * Scores one phase: one row per prediction, correct or not (FR-275, FR-277 need the all-zero players), ordered by player
 * id. A correct choice is worth the phase's `worth` (the prediction's own stored count for the winner), a wrong one 0; there
 * is no streak bonus and no negative score (FR-274). A winner prediction with no stored count is inconsistent data.
 */
export function scorePhase(phase: ScoredPhase, predictions: readonly ScorablePrediction[]): ResultRow[] {
  return [...predictions].sort(byPlayerId).map((p) => {
    const correct = p.choice === phase.answer;
    let worth: number;
    if (phase.kind === 'winner') {
      if (p.winnerCandidates === undefined) throw new RangeError('inconsistent stored data: a winner prediction without its candidate count');
      worth = p.winnerCandidates;
    } else {
      worth = phase.worth;
    }
    return {
      playerId: p.playerId,
      kind: phase.kind,
      round: phase.kind === 'winner' ? 0 : phase.round,
      choice: p.choice,
      correct,
      points: correct ? worth : 0,
    };
  });
}

/** The sums of one player over every scored item (input of the ranking). `correctWinner` is 0 or 1. */
export interface PlayerTotals {
  readonly playerId: string;
  readonly total: number;
  readonly correctVictims: number;
  readonly correctAbsorbers: number;
  readonly correctWinner: 0 | 1;
}

export interface LeaderboardEntry extends PlayerTotals {
  readonly rank: number;
}

/**
 * Ranks by total, highest first; equal totals share a rank and are listed by player id in code-unit order; the rank after a
 * tie skips the size of the run (1, 1, 3). A player whose scored predictions are all 0 is ranked like any other (D23).
 */
export function rankLeaderboard(totals: readonly PlayerTotals[]): LeaderboardEntry[] {
  const sorted = [...totals].sort((a, b) => b.total - a.total || byPlayerId(a, b));
  const out: LeaderboardEntry[] = [];
  sorted.forEach((t, i) => {
    const rank = i > 0 && t.total === sorted[i - 1]!.total ? out[i - 1]!.rank : i + 1;
    out.push({
      rank,
      playerId: t.playerId,
      total: t.total,
      correctVictims: t.correctVictims,
      correctAbsorbers: t.correctAbsorbers,
      correctWinner: t.correctWinner,
    });
  });
  return out;
}

/** The part of the core view a scored-phase decision may use (NFR-47 (b) spirit): N, the revealed victim and the stage. */
type ScoredView = Pick<CoreMatch, 'appliedRounds' | 'victim'>;

/**
 * The leaderboard generation (FR-279 (d)): the number of scored phases, 2N, plus 1 while the victim of round N + 1 is
 * revealed (phase 2, locked, or halted after the reveal). A finished match has 2T.
 */
export function scoredPhaseCount(view: ScoredView): number {
  return 2 * view.appliedRounds + (view.victim?.round === view.appliedRounds + 1 ? 1 : 0);
}

/**
 * Whether the phase `phase` of round `k` has its results: phase 1 once the round is applied or its victim is revealed (the
 * results of phase 1 are announced at the reveal), phase 2 only once the round is applied. Round 0 never; a round that is
 * not a whole number never.
 */
export function isScored(view: ScoredView, k: number, phase: 1 | 2): boolean {
  if (typeof k !== 'number' || !Number.isSafeInteger(k) || k < 1) return false;
  if (k <= view.appliedRounds) return true;
  return phase === 1 && view.victim?.round === k;
}

export type ResultsRoundRead =
  | { readonly ok: true; readonly round: number; readonly phase: 1 | 2 }
  | { readonly ok: false; readonly error: ErrorReply };

/**
 * Which results a client may ask about (FR-258). A round that is not a whole number or is below 1, or a phase other than 1
 * or 2, is `invalid-request`. Any other (k, phase) that is not scored yet, whatever the stage, gets the same
 * `round-not-applied` naming only N, so nothing of the pending round (not even whether its victim exists) is told.
 */
export function readResultsRound(view: ScoredView, round: number, phase: 1 | 2): ResultsRoundRead {
  if (typeof round !== 'number' || !Number.isInteger(round) || round < 1) return { ok: false, error: errorReply('invalid-request', ['round']) };
  if (phase !== 1 && phase !== 2) return { ok: false, error: errorReply('invalid-request', ['phase']) };
  if (!isScored(view, round, phase)) return { ok: false, error: roundNotApplied(view.appliedRounds) };
  return { ok: true, round, phase };
}
