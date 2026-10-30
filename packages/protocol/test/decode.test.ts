import { describe, expect, it } from 'vitest';
import {
  EVENT_KEYS,
  encodeError,
  encodeEvent,
  encodeLeaderboardRow,
  encodeOwnPrediction,
  encodePage,
  encodePlayerResults,
  encodePrediction,
  encodePublicMatch,
  encodeRecord,
  encodeState,
  readErrorReply,
  readEvent,
  readLeaderboardPage,
  readOwnPredictionsPage,
  readPlayerResultsPage,
  readPredictionReply,
  readPublicMatch,
  readRecordReply,
  readStateReply,
  type ErrorReply,
  type LeaderboardRow,
  type MatchEvent,
  type OwnPrediction,
  type PlayerResultsPage,
  type PredictionReply,
  type PublicMatch,
  type PublicVictim,
  type RecordReply,
  type StateReply,
} from '../src/index';

// The readers of the server's replies and events (PD36): `read(JSON.parse(encode(x)))` gives x back for every shape, and a
// refusal names the first failing field in the key order.

const hex = (c: string): string => c.repeat(64);
const clock = { i: 120, l1: 30, l2: 10 } as const;
const schedule = { c1: 1_120_000, c2: 1_150_000, a: 1_160_000 };
const victim: PublicVictim = { round: 1, victim: 2, candidates: [1, 3], living: [1, 2, 3], revealedAt: 1_120_000, c2: 1_150_000, a: 1_160_000, seq: 4 };
const manualVictim: PublicVictim = { ...victim, c2: null, a: null };
const base: PublicMatch = {
  matchId: 'm-1',
  mapId: 'dev',
  mapDigest: hex('a'),
  totalRounds: 2,
  timing: clock,
  commitment: hex('c'),
  stage: 'phase-1',
  appliedRounds: 0,
  state: { mode: 'classic', round: 0, owners: [[1, 1], [2, 2], [3, 3]] },
  stateDigest: hex('d'),
  lastSeq: 1,
  reportedTime: 1_000_000,
  schedule,
};
const manual: PublicMatch = { ...base, timing: 'manual' };
delete (manual as { schedule?: unknown }).schedule;
const phase2: PublicMatch = { ...base, stage: 'phase-2', lastSeq: 5, victim };
const forcedVictim: PublicVictim = { ...victim, candidates: [1], forced: true };
const forcedPhase2: PublicMatch = { ...phase2, victim: forcedVictim };
const locked: PublicMatch = { ...phase2, stage: 'locked' };
const manualPhase2: PublicMatch = { ...manual, stage: 'phase-2', lastSeq: 5, victim: manualVictim };
const finished: PublicMatch = {
  ...manual,
  stage: 'finished',
  appliedRounds: 2,
  state: { mode: 'classic', round: 2, owners: [[1, 1], [2, 1], [3, 1]] },
  winner: 1,
  matchSecret: hex('5'),
};
const halted: PublicMatch = { ...manual, stage: 'halted', haltReason: 'map-changed' };
const haltedAfterReveal: PublicMatch = { ...manual, stage: 'halted', victim: manualVictim, haltReason: 'victim-mismatch' };
const clockHalted: PublicMatch = { ...base, stage: 'halted', victim, haltReason: 'isolated-faction' };
delete (clockHalted as { schedule?: unknown }).schedule;

const lobby: PublicMatch = { ...base, stage: 'lobby', playerCount: 0 };
delete (lobby as { schedule?: unknown }).schedule;
const expired: PublicMatch = { ...lobby, stage: 'expired', lastSeq: 2, playerCount: 5 };
const manualLobby: PublicMatch = { ...manual, stage: 'lobby', playerCount: 3 };
const countedPhase1: PublicMatch = { ...base, playerCount: 4 };

const views: Record<string, PublicMatch> = { base, manual, phase2, forcedPhase2, locked, manualPhase2, finished, halted, haltedAfterReveal, clockHalted, lobby, expired, manualLobby, countedPhase1 };

const record: RecordReply = { round: 1, eliminated: 2, absorber: 3, transferred: [11, 13] };
const events: Record<string, MatchEvent> = {
  'phase-closed': { type: 'phase-closed', seq: 2, round: 1, phase: 1, at: 1_012_000 },
  'victim-revealed': { type: 'victim-revealed', seq: 3, round: 1, victim: 4, candidates: [2, 7], living: [1, 2, 4, 7], revealedAt: 1_012_000, c2: 1_018_000, a: 1_020_000, reportedTime: 1_012_003 },
  'victim-revealed forced': { type: 'victim-revealed', seq: 3, round: 1, victim: 4, candidates: [2], living: [1, 2, 4, 7], revealedAt: 1_012_000, c2: 1_018_000, a: 1_020_000, forced: true, reportedTime: 1_012_003 },
  'victim-revealed manual': { type: 'victim-revealed', seq: 3, round: 1, victim: 4, candidates: [2, 7], living: [1, 2, 4, 7], revealedAt: 1_012_000, c2: null, a: null, reportedTime: 1_012_003 },
  'round-applied': { type: 'round-applied', seq: 6, round: 1, record, stateDigest: hex('d'), appliedAt: 1_020_000 },
  results: { type: 'results', seq: 8, round: 1, phase: 2 },
  schedule: { type: 'schedule', seq: 7, stage: 'phase-1', schedule: { c1: 1_032_000, c2: 1_038_000, a: 1_040_000 }, reportedTime: 1_020_002 },
  'schedule manual': { type: 'schedule', seq: 7, stage: 'phase-2', reportedTime: 1_020_002 },
  'schedule lobby': { type: 'schedule', seq: 1, stage: 'lobby', reportedTime: 1_000_000 },
  'schedule expired': { type: 'schedule', seq: 2, stage: 'expired', reportedTime: 1_900_000 },
  'match-finished': { type: 'match-finished', seq: 30, winner: 2, matchSecret: hex('b'), rule: 'hmac-sha256 rule text', reportedTime: 1_100_000 },
  'match-halted': { type: 'match-halted', seq: 9, round: 2, reason: 'map-changed', reportedTime: 1_050_000 },
};

const roundTrip = (text: string): unknown => JSON.parse(text) as unknown;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** A copy of `v` changed by `change` (a plain JSON object). */
function changed<T>(v: T, change: (o: Record<string, any>) => void): unknown {
  const o = clone(v) as Record<string, any>;
  change(o);
  return o;
}
const deepFreeze = <T>(v: T): T => {
  if (typeof v === 'object' && v !== null) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
};
const field = (r: { ok: boolean; field?: string }): string | undefined => (r.ok ? undefined : r.field);

describe('FR-287 (readers) the events read back what the encoder wrote', () => {
  it.each(Object.keys(events))('NFR-51 (protocol readers) %s round trip', (name) => {
    const event = events[name] as MatchEvent;
    expect(readEvent(roundTrip(encodeEvent(event)))).toStrictEqual({ status: 'known', event });
  });

  it('FR-287 (readers) the seven event types are all covered by a round trip', () => {
    const covered = new Set(Object.values(events).map((e) => e.type));
    expect([...covered].sort()).toStrictEqual(Object.keys(EVENT_KEYS).sort());
  });

  it('FR-287 (readers) an unknown type with a whole seq is unknown, with its number', () => {
    expect(readEvent({ type: 'novelty', seq: 12, anything: [1, 2] })).toStrictEqual({ status: 'unknown', seq: 12 });
    expect(readEvent({ type: 'constructor', seq: 5 })).toStrictEqual({ status: 'unknown', seq: 5 });
    expect(readEvent({ type: '__proto__', seq: 5 })).toStrictEqual({ status: 'unknown', seq: 5 });
  });

  it.each([
    ['no seq', { type: 'novelty' }],
    ['seq 0', { type: 'novelty', seq: 0 }],
    ['fractional seq', { type: 'novelty', seq: 1.5 }],
    ['text seq', { type: 'novelty', seq: '3' }],
    ['negative seq', { type: 'novelty', seq: -1 }],
  ])('FR-287 (readers) an unknown type with %s is invalid, naming seq', (_n, input) => {
    expect(readEvent(input)).toStrictEqual({ status: 'invalid', field: 'seq' });
  });

  it('FR-287 (readers) a missing or ill-typed type and a non-object are invalid', () => {
    expect(readEvent({ seq: 1 })).toStrictEqual({ status: 'invalid', field: 'type' });
    expect(readEvent({ type: 4, seq: 1 })).toStrictEqual({ status: 'invalid', field: 'type' });
    for (const v of [null, 'x', 4, [], undefined]) expect(readEvent(v)).toStrictEqual({ status: 'invalid', field: 'body' });
  });

  const bad: [string, MatchEvent['type'], (o: Record<string, any>) => void, string][] = [
    ['missing seq', 'phase-closed', (o) => delete o.seq, 'seq'],
    ['seq 0', 'phase-closed', (o) => (o.seq = 0), 'seq'],
    ['an extra member', 'phase-closed', (o) => (o.extra = 1), 'extra'],
    ['a fractional round', 'phase-closed', (o) => (o.round = 1.5), 'round'],
    ['a negative at', 'phase-closed', (o) => (o.at = -1), 'at'],
    ['phase 3', 'phase-closed', (o) => (o.phase = 3), 'phase'],
    ['a first failing field before a later one', 'phase-closed', (o) => ((o.round = 0), (o.at = -1)), 'round'],
    ['a text victim', 'victim-revealed', (o) => (o.victim = '4'), 'victim'],
    ['a candidate of 0', 'victim-revealed', (o) => (o.candidates = [2, 0]), 'candidates[1]'],
    ['c2 without a', 'victim-revealed', (o) => (o.a = null), 'a'],
    ['a without c2', 'victim-revealed', (o) => (o.c2 = null), 'a'],
    ['a missing c2', 'victim-revealed', (o) => delete o.c2, 'c2'],
    ['a victim who is not among the living', 'victim-revealed', (o) => (o.living = [1, 2, 7]), 'victim'],
    ['a candidate who is not among the living', 'victim-revealed', (o) => (o.candidates = [2, 9]), 'candidates'],
    ['a forced mark of false', 'victim-revealed', (o) => (o.forced = false), 'forced'],
    ['a forced mark that is not a boolean', 'victim-revealed', (o) => (o.forced = 1), 'forced'],
    ['a forced mark read before reportedTime', 'victim-revealed', (o) => ((o.forced = false), (o.reportedTime = -1)), 'forced'],
    ['a record of another round', 'round-applied', (o) => (o.record.round = 2), 'record.round'],
    ['a record with an extra member', 'round-applied', (o) => (o.record.seed = 5), 'record.seed'],
    ['a record without an absorber', 'round-applied', (o) => delete o.record.absorber, 'record.absorber'],
    ['a short digest', 'round-applied', (o) => (o.stateDigest = 'ab'), 'stateDigest'],
    ['an uppercase digest', 'round-applied', (o) => (o.stateDigest = 'D'.repeat(64)), 'stateDigest'],
    ['a stage outside the running ones', 'schedule', (o) => (o.stage = 'finished'), 'stage'],
    ['a lobby schedule event with anchors', 'schedule', (o) => (o.stage = 'lobby'), 'schedule'],
    ['an expired schedule event with anchors', 'schedule', (o) => (o.stage = 'expired'), 'schedule'],
    ['a schedule with an extra member', 'schedule', (o) => (o.schedule.z = 1), 'schedule.z'],
    ['an empty rule', 'match-finished', (o) => (o.rule = ''), 'rule'],
    ['a halt reason outside the list', 'match-halted', (o) => (o.reason = 'meteor'), 'reason'],
  ];
  it.each(bad)('FR-287 (readers) refused: %s', (_n, type, change, expected) => {
    const sample = Object.values(events).find((e) => e.type === type) as MatchEvent;
    expect(readEvent(changed(sample, change))).toStrictEqual({ status: 'invalid', field: expected });
  });

  it('FR-287 (readers) a member of the key list that is only inherited is missing', () => {
    const event = events['phase-closed'] as MatchEvent;
    const inheriting = Object.assign(Object.create({ round: 1 }) as object, { type: 'phase-closed', seq: 2, phase: 1, at: 5 });
    expect(readEvent(inheriting)).toStrictEqual({ status: 'invalid', field: 'round' });
    expect(readEvent(Object.assign(Object.create(event) as object, {}))).toStrictEqual({ status: 'invalid', field: 'type' });
  });

  it('FR-287 (readers) a member named __proto__ in the text is an extra member, never read', () => {
    const text = `{"type":"results","seq":3,"round":1,"phase":2,"__proto__":{"phase":1}}`;
    expect(readEvent(JSON.parse(text))).toStrictEqual({ status: 'invalid', field: '__proto__' });
  });
});

describe('FR-288 (readers) the public data reads back what the encoder wrote', () => {
  it.each(Object.keys(views))('NFR-51 (protocol readers) %s round trip', (name) => {
    const view = views[name] as PublicMatch;
    expect(readPublicMatch(roundTrip(encodePublicMatch(view)))).toStrictEqual({ ok: true, value: view });
  });

  it('FR-288 (readers) the victim fields come back with c2 and a null for a match without a clock', () => {
    const r = readPublicMatch(roundTrip(encodePublicMatch(manualPhase2)));
    expect(r.ok && r.value.victim).toStrictEqual(manualVictim);
  });

  const cases: [string, PublicMatch, (o: Record<string, any>) => void, string][] = [
    ['a missing matchId', base, (o) => delete o.matchId, 'matchId'],
    ['an extra member', base, (o) => (o.absorber = 4), 'absorber'],
    ['an empty matchId', base, (o) => (o.matchId = ''), 'matchId'],
    ['an uppercase map id', base, (o) => (o.mapId = 'Dev'), 'mapId'],
    ['a long digest', base, (o) => (o.mapDigest = hex('a') + 'a'), 'mapDigest'],
    ['0 total rounds', base, (o) => (o.totalRounds = 0), 'totalRounds'],
    ['a fractional total', base, (o) => (o.totalRounds = 2.5), 'totalRounds'],
    ['a negative l1', base, (o) => (o.timing.l1 = -1), 'timing.l1'],
    ['a timing with an extra member', base, (o) => (o.timing.x = 1), 'timing.x'],
    ['a timing that is text other than manual', base, (o) => (o.timing = 'auto'), 'timing'],
    ['a stage outside STAGES', base, (o) => (o.stage = 'paused'), 'stage'],
    ['a lobby without playerCount', lobby, (o) => delete o.playerCount, 'playerCount'],
    ['an expired without playerCount', expired, (o) => delete o.playerCount, 'playerCount'],
    ['a lobby with a negative playerCount', lobby, (o) => (o.playerCount = -1), 'playerCount'],
    ['a lobby with a fractional playerCount', lobby, (o) => (o.playerCount = 1.5), 'playerCount'],
    ['a running view with a text playerCount', countedPhase1, (o) => (o.playerCount = '4'), 'playerCount'],
    ['a lobby with a schedule', lobby, (o) => (o.schedule = { c1: 1, c2: 2, a: 3 }), 'schedule'],
    ['an expired with a schedule', expired, (o) => (o.schedule = { c1: 1, c2: 2, a: 3 }), 'schedule'],
    ['a lobby with a victim', lobby, (o) => (o.victim = clone(manualVictim)), 'victim'],
    ['a lobby with a winner', lobby, (o) => (o.winner = 1), 'winner'],
    ['an expired with a match secret', expired, (o) => (o.matchSecret = hex('5')), 'matchSecret'],
    ['an expired with a halt reason', expired, (o) => (o.haltReason = 'map-changed'), 'haltReason'],
    ['a negative applied count', base, (o) => (o.appliedRounds = -1), 'appliedRounds'],
    ['a state of another round', base, (o) => (o.state.round = 1), 'state.round'],
    ['a state with a mode other than classic', base, (o) => (o.state.mode = 'risk'), 'state.mode'],
    ['a bad owner pair', base, (o) => (o.state.owners[1] = [2]), 'state.owners[1]'],
    ['a zero faction in a pair', base, (o) => (o.state.owners[2][1] = 0), 'state.owners[2][1]'],
    ['lastSeq 0', base, (o) => (o.lastSeq = 0), 'lastSeq'],
    ['a schedule missing while the clock runs', base, (o) => delete o.schedule, 'schedule'],
    ['a schedule with a manual match', manual, (o) => (o.schedule = { c1: 1, c2: 2, a: 3 }), 'schedule'],
    ['a schedule in finished', finished, (o) => (o.schedule = { c1: 1, c2: 2, a: 3 }), 'schedule'],
    ['a winner outside finished (phase-1)', base, (o) => (o.winner = 1), 'winner'],
    ['a secret outside finished (phase-1)', base, (o) => (o.matchSecret = hex('5')), 'matchSecret'],
    ['a winner outside finished (halted)', halted, (o) => (o.winner = 1), 'winner'],
    ['a missing winner in finished', finished, (o) => delete o.winner, 'winner'],
    ['a missing secret in finished', finished, (o) => delete o.matchSecret, 'matchSecret'],
    ['a halt reason outside the list', halted, (o) => (o.haltReason = 'meteor'), 'haltReason'],
    ['a halt reason outside halted', base, (o) => (o.haltReason = 'map-changed'), 'haltReason'],
    ['a missing halt reason in halted', halted, (o) => delete o.haltReason, 'haltReason'],
    ['a victim in phase-1', base, (o) => (o.victim = clone(victim)), 'victim'],
    ['a victim in finished', finished, (o) => (o.victim = clone(manualVictim)), 'victim'],
    ['a missing victim in phase-2', phase2, (o) => delete o.victim, 'victim'],
    ['a missing victim in locked', locked, (o) => delete o.victim, 'victim'],
    ['a victim with c2 but no a', phase2, (o) => (o.victim.a = null), 'victim.a'],
    ['a victim with a but no c2', phase2, (o) => (o.victim.c2 = null), 'victim.c2'],
    ['a manual victim with a c2', manualPhase2, (o) => (o.victim.c2 = 5), 'victim.c2'],
    ['a clock victim with both null', phase2, (o) => ((o.victim.c2 = null), (o.victim.a = null)), 'victim.c2'],
    ['a victim with a forced mark of false', forcedPhase2, (o) => (o.victim.forced = false), 'victim.forced'],
    ['a victim with a forced mark that is text', forcedPhase2, (o) => (o.victim.forced = 'true'), 'victim.forced'],
    ['a victim with a forced mark of false and a bad seq', forcedPhase2, (o) => ((o.victim.forced = false), (o.victim.seq = 0)), 'victim.forced'],
    ['a victim with an extra member', phase2, (o) => (o.victim.absorber = 3), 'victim.absorber'],
    ['a fractional revealedAt', phase2, (o) => (o.victim.revealedAt = 0.5), 'victim.revealedAt'],
    ['a victim candidate of 0', phase2, (o) => (o.victim.candidates = [0]), 'victim.candidates[0]'],
    ['a first failing field before a later one', base, (o) => ((o.mapId = 'A'), (o.lastSeq = 0)), 'mapId'],
    // Cross-field rules (tightened with the connection policy): the applied rounds fit the stage and the total.
    ['more applied rounds than the total', halted, (o) => ((o.appliedRounds = 3), (o.state.round = 3)), 'appliedRounds'],
    ['every round applied while the match runs', base, (o) => ((o.appliedRounds = 2), (o.state.round = 2)), 'appliedRounds'],
    ['finished with rounds left', finished, (o) => ((o.appliedRounds = 1), (o.state.round = 1)), 'appliedRounds'],
    ['a victim of a round that is not the next one', phase2, (o) => (o.victim.round = 2), 'victim.round'],
    ['a victim of round 0', phase2, (o) => (o.victim.round = 0), 'victim.round'],
    ['a victim who is not among the living', phase2, (o) => (o.victim.living = [1, 3]), 'victim.victim'],
    ['a candidate who is not among the living', phase2, (o) => (o.victim.candidates = [1, 4]), 'victim.candidates'],
  ];
  it.each(cases)('FR-288 (readers) refused: %s', (_n, view, change, expected) => {
    const r = readPublicMatch(changed(JSON.parse(encodePublicMatch(view)), change));
    expect(field(r)).toBe(expected);
  });

  it('FR-288 (readers) a non-object is refused as body', () => {
    for (const v of [null, 'x', 1, [], [base]]) expect(readPublicMatch(v)).toStrictEqual({ ok: false, field: 'body' });
  });

  it('FR-288 (readers) the own-property rule: inherited members are missing, a __proto__ text is an extra member', () => {
    const inherited = Object.create(clone(base)) as object;
    expect(readPublicMatch(inherited)).toStrictEqual({ ok: false, field: 'matchId' });
    const plain = JSON.parse(encodePublicMatch(base)) as Record<string, unknown>;
    const withProto = JSON.parse(JSON.stringify(plain).replace('{', '{"__proto__":{"stage":"finished"},')) as unknown;
    expect(readPublicMatch(withProto)).toStrictEqual({ ok: false, field: '__proto__' });
  });

  it('FR-288 (readers) the value is a copy: changing it leaves the input untouched', () => {
    const input = roundTrip(encodePublicMatch(phase2));
    const before = JSON.stringify(input);
    const r = readPublicMatch(input);
    expect(r.ok).toBe(true);
    if (r.ok) (r.value.state.owners as unknown as number[][])[0] = [9, 9];
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('NFR-51 (protocol readers) the readers of the other replies', () => {
  const state: StateReply = { round: 2, owners: [[1, 1], [2, 3]], stateDigest: hex('e'), reportedTime: 99 };
  const errors: ErrorReply[] = [
    { kind: 'unknown-match' },
    { kind: 'invalid-timing', items: ['i', 'l1'] },
    { kind: 'step-mismatch', stage: 'locked', appliedRounds: 3 },
    { kind: 'round-not-applied', appliedRounds: 0 },
    { kind: 'rate-limited', retryAfter: 7 },
  ];
  const prediction: PredictionReply = { kind: 'victim', round: 2, choice: 4, version: 1 };
  const winnerPrediction: PredictionReply = { kind: 'winner', choice: 4, version: 3 };
  const own: OwnPrediction[] = [
    { playerId: 'p1', kind: 'victim', round: 1, choice: 2, version: 1 },
    { playerId: 'p1', kind: 'winner', choice: 3, version: 2 },
  ];
  const results: PlayerResultsPage = {
    playerId: 'web:p1',
    total: 7,
    items: [
      { kind: 'winner', choice: 3, correct: false, points: 0 },
      { kind: 'victim', round: 1, choice: 2, correct: true, points: 3 },
    ],
    next: 'cursor-1',
  };
  const rows: LeaderboardRow[] = [
    { rank: 1, playerId: 'web:a', total: 9, correctVictims: 2, correctAbsorbers: 1, correctWinner: 1 },
    { rank: 2, playerId: 'discord:b', total: 4, correctVictims: 1, correctAbsorbers: 0, correctWinner: 0 },
  ];
  const page = <T>(items: T[], encodeItem: (i: T) => string, next?: string): string => encodePage(next === undefined ? { items } : { items, next }, encodeItem);

  it('NFR-51 (protocol readers) the state and record replies round trip', () => {
    expect(readStateReply(roundTrip(encodeState(state)))).toStrictEqual({ ok: true, value: state });
    expect(readRecordReply(roundTrip(encodeRecord(record)))).toStrictEqual({ ok: true, value: record });
    const empty: RecordReply = { ...record, transferred: [] };
    expect(readRecordReply(roundTrip(encodeRecord(empty)))).toStrictEqual({ ok: true, value: empty });
  });

  it.each(errors.map((e, i) => [i, e] as const))('NFR-51 (protocol readers) the error reply %i round trips', (_i, e) => {
    expect(readErrorReply(roundTrip(encodeError(e)))).toStrictEqual({ ok: true, value: e });
  });

  it('NFR-51 (protocol readers) the forced-absorber error is read back, and a made-up kind is still refused', () => {
    const forced: ErrorReply = { kind: 'forced-absorber' };
    expect(encodeError(forced)).toBe('{"kind":"forced-absorber"}');
    expect(readErrorReply(roundTrip(encodeError(forced)))).toStrictEqual({ ok: true, value: forced });
    expect(readErrorReply({ kind: 'forced-absorbers' })).toStrictEqual({ ok: false, field: 'kind' });
  });

  it('NFR-51 (protocol readers) the prediction replies and a page of own predictions round trip', () => {
    for (const p of [prediction, winnerPrediction]) expect(readPredictionReply(roundTrip(encodePrediction(p)))).toStrictEqual({ ok: true, value: p });
    expect(readOwnPredictionsPage(roundTrip(page(own, encodeOwnPrediction)))).toStrictEqual({ ok: true, value: { items: own } });
    expect(readOwnPredictionsPage(roundTrip(page(own, encodeOwnPrediction, 'c')))).toStrictEqual({ ok: true, value: { items: own, next: 'c' } });
  });

  it('NFR-51 (protocol readers) the player results and leaderboard pages round trip', () => {
    expect(readPlayerResultsPage(roundTrip(encodePlayerResults(results)))).toStrictEqual({ ok: true, value: results });
    const last: PlayerResultsPage = { playerId: 'web:p1', total: 0, items: [] };
    expect(readPlayerResultsPage(roundTrip(encodePlayerResults(last)))).toStrictEqual({ ok: true, value: last });
    expect(readLeaderboardPage(roundTrip(page(rows, encodeLeaderboardRow)))).toStrictEqual({ ok: true, value: { items: rows } });
    expect(readLeaderboardPage(roundTrip(page(rows, encodeLeaderboardRow, 'n')))).toStrictEqual({ ok: true, value: { items: rows, next: 'n' } });
  });

  const stateText = JSON.parse(encodeState(state)) as unknown;
  const refusals: [string, () => unknown, string][] = [
    ['a state with a missing digest', () => readStateReply(changed(stateText, (o) => delete o.stateDigest)), 'stateDigest'],
    ['a state with an extra member', () => readStateReply(changed(stateText, (o) => (o.absorber = 1))), 'absorber'],
    ['a state with a negative reported time', () => readStateReply(changed(stateText, (o) => (o.reportedTime = -1))), 'reportedTime'],
    ['a state with a bad pair', () => readStateReply(changed(stateText, (o) => (o.owners[0] = [1, 2, 3]))), 'owners[0]'],
    ['a record with a text round', () => readRecordReply(changed(record, (o) => (o.round = '1'))), 'round'],
    ['a record with a zero in transferred', () => readRecordReply(changed(record, (o) => (o.transferred = [4, 0]))), 'transferred[1]'],
    ['a record with an extra seed', () => readRecordReply(changed(record, (o) => (o.seed = 1))), 'seed'],
    ['an error with a kind outside the list', () => readErrorReply({ kind: 'oops' }), 'kind'],
    ['an error with an extra member', () => readErrorReply({ kind: 'unknown-match', message: 'x' }), 'message'],
    ['an error with a stage outside STAGES', () => readErrorReply({ kind: 'step-mismatch', stage: 'x', appliedRounds: 1 }), 'stage'],
    ['an error with retryAfter 0', () => readErrorReply({ kind: 'rate-limited', retryAfter: 0 }), 'retryAfter'],
    ['an error with items that are not texts', () => readErrorReply({ kind: 'invalid-timing', items: [1] }), 'items[0]'],
    ['a winner prediction with a round', () => readPredictionReply({ kind: 'winner', round: 1, choice: 1, version: 1 }), 'round'],
    ['a victim prediction without a round', () => readPredictionReply({ kind: 'victim', choice: 1, version: 1 }), 'round'],
    ['a prediction with kind outside the list', () => readPredictionReply({ kind: 'draw', choice: 1, version: 1 }), 'kind'],
    ['a prediction with version 0', () => readPredictionReply({ kind: 'winner', choice: 1, version: 0 }), 'version'],
    ['an own prediction with a namespaced player id', () => readOwnPredictionsPage({ items: [{ ...own[0], playerId: 'web:p1' }] }), 'items[0].playerId'],
    ['a page without items', () => readOwnPredictionsPage({ next: 'x' }), 'items'],
    ['a page with an empty next', () => readLeaderboardPage({ items: [], next: '' }), 'next'],
    ['a page with an extra member', () => readLeaderboardPage({ items: [], total: 4 }), 'total'],
    ['a player result wrong but worth points', () => readPlayerResultsPage(changed(results, (o) => (o.items[0].points = 2))), 'items[0].points'],
    ['a player results page with a local player id', () => readPlayerResultsPage(changed(results, (o) => (o.playerId = 'p1'))), 'playerId'],
    ['a leaderboard row with correctWinner 2', () => readLeaderboardPage({ items: [{ ...rows[0], correctWinner: 2 }] }), 'items[0].correctWinner'],
    ['a leaderboard row with rank 0', () => readLeaderboardPage({ items: [{ ...rows[0], rank: 0 }] }), 'items[0].rank'],
    ['a leaderboard row with a fractional total', () => readLeaderboardPage({ items: [rows[0], { ...rows[1], total: 1.5 }] }), 'items[1].total'],
  ];
  it.each(refusals)('NFR-51 (protocol readers) refused: %s', (_n, read, expected) => {
    expect(field(read() as { ok: boolean; field?: string })).toBe(expected);
  });

  it('NFR-51 (protocol readers) every reader refuses a non-object as body', () => {
    const readers = [readStateReply, readRecordReply, readErrorReply, readPredictionReply, readOwnPredictionsPage, readPlayerResultsPage, readLeaderboardPage];
    for (const read of readers) for (const v of [null, undefined, 3, 'x', []]) expect(read(v)).toStrictEqual({ ok: false, field: 'body' });
  });

  it('NFR-51 (protocol readers) no reader changes its input (frozen inputs are read without error)', () => {
    const inputs: [unknown, (v: unknown) => { ok: boolean }][] = [
      [roundTrip(encodePublicMatch(phase2)), readPublicMatch],
      [roundTrip(encodeState(state)), readStateReply],
      [roundTrip(encodeRecord(record)), readRecordReply],
      [roundTrip(encodeError(errors[1] as ErrorReply)), readErrorReply],
      [roundTrip(encodePrediction(prediction)), readPredictionReply],
      [roundTrip(page(own, encodeOwnPrediction, 'c')), readOwnPredictionsPage],
      [roundTrip(encodePlayerResults(results)), readPlayerResultsPage],
      [roundTrip(page(rows, encodeLeaderboardRow)), readLeaderboardPage],
    ];
    for (const [input, read] of inputs) {
      const before = JSON.stringify(input);
      expect(read(deepFreeze(input)).ok).toBe(true);
      expect(JSON.stringify(input)).toBe(before);
    }
    for (const e of Object.values(events)) {
      const frozen = deepFreeze(roundTrip(encodeEvent(e)));
      expect(readEvent(frozen).status).toBe('known');
    }
  });
});
