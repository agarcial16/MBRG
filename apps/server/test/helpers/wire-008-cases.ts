import type * as Protocol from '@mbrg/protocol';

// The 008 wire forms of the pins (spec 011 FR-392): a fixed 008 match written as plain literals (nothing is drawn, nothing is
// read from the server), encoded by the protocol module it is given. `golden/generate-wire-008.ts` runs the cases with the
// ENCODERS OF THE COMMIT BEFORE SPEC 011 (extracted into a scratch folder) and pins the SHA-256 of each text in
// `golden/wire-008.json`; `wire-compat-008.test.ts` runs the same cases with the current encoders. The inputs use only members
// that existed in 008: no `forced`, no `name`, no `playerCount`, no lobby stage, no player id of a joined player.

export type Encoders = Pick<
  typeof Protocol,
  | 'encodeAdvance'
  | 'encodeCreation'
  | 'encodeCursor'
  | 'encodeError'
  | 'encodeEvent'
  | 'encodeLeaderboardRow'
  | 'encodeMatchSummary'
  | 'encodeOwnPrediction'
  | 'encodePage'
  | 'encodePhaseResults'
  | 'encodePlayerResults'
  | 'encodePrediction'
  | 'encodePublicMatch'
  | 'encodeRecord'
  | 'encodeState'
  | 'errorReply'
  | 'rateLimited'
  | 'roundNotApplied'
  | 'stepMismatch'
>;

/** The 22 error kinds of 008, in their fixed order (a literal: it must not follow the module under test). */
export const OLD_ERROR_KINDS = [
  'rate-limited',
  'unknown-path',
  'method-not-allowed',
  'too-large',
  'invalid-request',
  'invalid-player-id',
  'forbidden',
  'request-id-reused',
  'unknown-match',
  'unknown-map',
  'map-validation',
  'too-few-factions',
  'invalid-timing',
  'too-many-matches',
  'match-halted',
  'match-finished',
  'step-mismatch',
  'round-not-applied',
  'stale-cursor',
  'prediction-closed',
  'invalid-choice',
  'unavailable',
] as const;

const hex = (digit: string): string => digit.repeat(64);
const OWNERS: [number, number][] = [[1, 1], [2, 1], [3, 2], [4, 2], [5, 3], [6, 3], [7, 4], [8, 5]];
const AFTER_TWO: [number, number][] = [[1, 1], [2, 1], [3, 1], [4, 1], [5, 3], [6, 3], [7, 5], [8, 5]];
const CLOCK = { i: 120, l1: 30, l2: 10 } as const;
const T0 = 1_700_000_000_000;

const view = (over: Record<string, unknown>): never =>
  ({
    matchId: 'fixed-008-match',
    mapId: 'dev',
    mapDigest: hex('a'),
    totalRounds: 4,
    timing: CLOCK,
    commitment: hex('b'),
    stage: 'phase-1',
    appliedRounds: 0,
    state: { mode: 'classic', round: 0, owners: OWNERS },
    stateDigest: hex('c'),
    lastSeq: 1,
    reportedTime: T0,
    ...over,
  }) as never;

const victim = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ round: 1, victim: 2, candidates: [1, 3], living: [1, 2, 3, 4, 5], revealedAt: T0 + 80_000, c2: T0 + 110_000, a: T0 + 120_000, seq: 4, ...over });
const manual = { timing: 'manual' as const };
const later = { appliedRounds: 2, state: { mode: 'classic', round: 2, owners: AFTER_TWO }, lastSeq: 20 };

const record = { round: 3, eliminated: 4, absorber: 2, transferred: [10, 11] };

/** The views, one per stage and timing (and per halt reason). */
export function viewCases(p: Pick<Encoders, 'encodePublicMatch'>): Record<string, string> {
  const e = p.encodePublicMatch;
  return {
    'view phase-1 clock': e(view({ schedule: { c1: T0 + 80_000, c2: T0 + 110_000, a: T0 + 120_000 } })),
    'view phase-1 manual': e(view({ ...manual })),
    'view phase-1 clock after two rounds': e(view({ ...later, schedule: { c1: T0 + 400_000, c2: T0 + 430_000, a: T0 + 440_000 } })),
    'view phase-2 clock': e(view({ stage: 'phase-2', victim: victim(), schedule: { c1: T0 + 200_000, c2: T0 + 110_000, a: T0 + 120_000 }, lastSeq: 5 })),
    'view phase-2 manual': e(view({ ...manual, stage: 'phase-2', victim: victim({ c2: null, a: null }), lastSeq: 5 })),
    'view locked clock': e(view({ stage: 'locked', victim: victim(), schedule: { c1: T0 + 200_000, c2: T0 + 110_000, a: T0 + 120_000 }, lastSeq: 8 })),
    'view locked manual': e(view({ ...manual, stage: 'locked', victim: victim({ c2: null, a: null }), lastSeq: 8 })),
    'view finished': e(view({ ...manual, stage: 'finished', appliedRounds: 4, state: { mode: 'classic', round: 4, owners: [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5]] }, lastSeq: 39, winner: 5, matchSecret: hex('d') }))
    ,
    'view halted before a reveal': e(view({ ...later, stage: 'halted', haltReason: 'map-changed' })),
    'view halted after a reveal': e(view({ ...later, stage: 'halted', haltReason: 'isolated-faction', victim: victim({ round: 3, candidates: [1, 5], living: [1, 3, 5], victim: 3 }) })),
    'view halted victim mismatch': e(view({ ...manual, stage: 'halted', haltReason: 'victim-mismatch' })),
  };
}

/** Every 008 event type, with the variants that change the bytes. */
export function eventCases(p: Pick<Encoders, 'encodeEvent'>): Record<string, string> {
  const e = (event: Record<string, unknown>): string => p.encodeEvent(event as never);
  const sched = { c1: T0 + 80_000, c2: T0 + 110_000, a: T0 + 120_000 };
  return {
    'event schedule phase-1 clock': e({ type: 'schedule', seq: 1, stage: 'phase-1', schedule: sched, reportedTime: T0 }),
    'event schedule phase-1 manual': e({ type: 'schedule', seq: 1, stage: 'phase-1', reportedTime: T0 }),
    'event schedule locked': e({ type: 'schedule', seq: 8, stage: 'locked', schedule: { c1: T0 + 200_000, c2: T0 + 110_000, a: T0 + 120_000 }, reportedTime: T0 + 1 }),
    'event phase-closed 1': e({ type: 'phase-closed', seq: 3, round: 1, phase: 1, at: T0 + 80_000 }),
    'event phase-closed 2': e({ type: 'phase-closed', seq: 7, round: 1, phase: 2, at: T0 + 110_000 }),
    'event victim-revealed clock': e({ type: 'victim-revealed', ...victim({ seq: 4 }), reportedTime: T0 + 80_000 }),
    'event victim-revealed manual': e({ type: 'victim-revealed', ...victim({ seq: 4, c2: null, a: null }), reportedTime: T0 + 80_000 }),
    'event round-applied': e({ type: 'round-applied', seq: 9, round: 3, record, stateDigest: hex('e'), appliedAt: T0 + 120_000 }),
    'event results 1': e({ type: 'results', seq: 6, round: 1, phase: 1 }),
    'event results 2': e({ type: 'results', seq: 10, round: 1, phase: 2 }),
    'event match-finished': e({ type: 'match-finished', seq: 39, winner: 5, matchSecret: hex('d'), rule: 'mbrg/round-seed/v1: commitment = SHA-256(secret bytes)', reportedTime: T0 + 1_000_000 }),
    'event match-halted map-changed': e({ type: 'match-halted', seq: 12, round: 2, reason: 'map-changed', reportedTime: T0 + 5 }),
    'event match-halted isolated-faction': e({ type: 'match-halted', seq: 12, round: 2, reason: 'isolated-faction', reportedTime: T0 + 5 }),
    'event match-halted victim-mismatch': e({ type: 'match-halted', seq: 12, round: 2, reason: 'victim-mismatch', reportedTime: T0 + 5 }),
  };
}

/** The three results shapes (phase results of both phases, a player's results, the leaderboard) and the other 008 replies. */
export function replyCases(p: Encoders): Record<string, string> {
  const row = { rank: 1, playerId: 'web:p1', total: 12, correctVictims: 2, correctAbsorbers: 1, correctWinner: 1 };
  const shown = JSON.parse(viewCases(p)['view phase-1 clock']!) as never;
  return {
    'results phase 1 page': p.encodePhaseResults({ round: 3, phase: 1, victim: 4, items: [{ playerId: 'web:p1', choice: 4, correct: true, points: 5 }, { playerId: 'discord:p2', choice: 2, correct: false, points: 0 }], next: 'abc' }),
    'results phase 1 empty': p.encodePhaseResults({ round: 1, phase: 1, victim: 2, items: [] }),
    'results phase 2 page': p.encodePhaseResults({ round: 3, phase: 2, record, items: [{ playerId: 'web:p1', choice: 2, correct: true, points: 3 }] }),
    'results player page': p.encodePlayerResults({ playerId: 'web:p1', total: 8, items: [{ kind: 'absorber', round: 2, choice: 3, correct: true, points: 3 }, { kind: 'winner', choice: 4, correct: true, points: 5 }], next: 'zz' }),
    'results player empty': p.encodePlayerResults({ playerId: 'web:nobody', total: 0, items: [] }),
    'results leaderboard page': p.encodePage({ items: [row, { ...row, rank: 2, playerId: 'web:p2', total: 7 }], next: 'c' }, p.encodeLeaderboardRow),
    'results leaderboard last page': p.encodePage({ items: [{ ...row, rank: 3, playerId: 'web:p3', total: 0, correctVictims: 0, correctAbsorbers: 0, correctWinner: 0 }] }, p.encodeLeaderboardRow),
    'creation reply': p.encodeCreation({ matchId: 'fixed-008-match', match: shown, hostToken: 'host-token-fixed-0123456789abcdef' }),
    'advance performed': p.encodeAdvance({ result: 'performed', step: { round: 1, kind: 'phase-1-close', instant: T0 + 80_000, cause: 'clock' }, match: shown }),
    'advance already performed': p.encodeAdvance({ result: 'already-performed', step: { round: 1, kind: 'application', instant: T0 + 120_000, cause: 'manual' }, match: shown }),
    'prediction reply victim': p.encodePrediction({ kind: 'victim', round: 2, choice: 3, version: 1 }),
    'prediction reply winner': p.encodePrediction({ kind: 'winner', choice: 3, version: 2 }),
    'own prediction': p.encodeOwnPrediction({ playerId: 'p1', kind: 'absorber', round: 2, choice: 4, version: 3 }),
    'own prediction winner': p.encodeOwnPrediction({ playerId: 'p1', kind: 'winner', choice: 4, version: 1 }),
    'match summary': p.encodeMatchSummary({ matchId: 'fixed-008-match', mapId: 'dev', stage: 'phase-2', appliedRounds: 1, totalRounds: 4, createdAt: T0 }),
    'matches page': p.encodePage({ items: [{ matchId: 'fixed-008-match', mapId: 'dev', stage: 'finished', appliedRounds: 4, totalRounds: 4, createdAt: T0 }], next: 'n' }, p.encodeMatchSummary),
    'state reply': p.encodeState({ round: 2, owners: AFTER_TWO, stateDigest: hex('c'), reportedTime: T0 }),
    'record reply': p.encodeRecord(record),
    'records page': p.encodePage({ items: [record, { round: 4, eliminated: 5, absorber: 1, transferred: [20] }], next: 'r' }, p.encodeRecord),
    'cursor matches': p.encodeCursor('matches', [T0, 'fixed-008-match']),
    'cursor records': p.encodeCursor('records', [2]),
    'cursor predictions': p.encodeCursor('predictions', ['p1', 2, 'absorber']),
    'cursor phase-results': p.encodeCursor('phase-results', ['web:p1']),
    'cursor player-results': p.encodeCursor('player-results', [2, 'victim']),
    'cursor leaderboard': p.encodeCursor('leaderboard', [7, 3, 'web:p3']),
  };
}

/** The error replies of the 22 kinds of 008, and the three kinds with extra members. */
export function errorCases(p: Pick<Encoders, 'encodeError' | 'errorReply' | 'rateLimited' | 'roundNotApplied' | 'stepMismatch'>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kind of OLD_ERROR_KINDS) if (kind !== 'step-mismatch' && kind !== 'round-not-applied' && kind !== 'rate-limited') out[`error ${kind}`] = p.encodeError(p.errorReply(kind));
  out['error rate-limited'] = p.encodeError(p.rateLimited(17));
  out['error step-mismatch phase-2'] = p.encodeError(p.stepMismatch('phase-2', 3));
  out['error step-mismatch locked'] = p.encodeError(p.stepMismatch('locked', 0));
  out['error round-not-applied'] = p.encodeError(p.roundNotApplied(2));
  out['error invalid-request with an item'] = p.encodeError(p.errorReply('invalid-request', ['timing']));
  out['error invalid-timing with several items'] = p.encodeError(p.errorReply('invalid-timing', ['i', 'l1']));
  out['error map-validation with several items'] = p.encodeError(p.errorReply('map-validation', ['duplicate-id', 'no-sea']));
  return out;
}

/** All the cases of the pins, in a fixed order. */
export function allCases(p: Encoders): Record<string, string> {
  return { ...viewCases(p), ...eventCases(p), ...replyCases(p), ...errorCases(p) };
}
