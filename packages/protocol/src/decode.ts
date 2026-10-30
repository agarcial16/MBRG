import { ERROR_ORDER, ERROR_REPLY_KEYS, type ErrorReply } from './errors';
import { isLocalId, isMapId, isPlayerId } from './ids';
import {
  EVENT_KEYS,
  HALT_REASONS,
  LEADERBOARD_ROW_KEYS,
  OWN_PREDICTION_KEYS,
  PAGE_KEYS,
  PLAYER_RESULTS_PAGE_KEYS,
  PLAYER_RESULT_KEYS,
  PREDICTION_KINDS,
  PREDICTION_REPLY_KEYS,
  PUBLIC_MATCH_KEYS,
  PUBLIC_VICTIM_KEYS,
  RECORD_REPLY_KEYS,
  STAGES,
  STATE_REPLY_KEYS,
  type LeaderboardRow,
  type MatchEvent,
  type OwnPrediction,
  type Page,
  type PlayerResult,
  type PlayerResultsPage,
  type PredictionReply,
  type PublicMatch,
  type PublicSchedule,
  type PublicState,
  type PublicVictim,
  type RecordReply,
  type StateReply,
  type Timing,
} from './wire';

/**
 * Readers of what the server sends (PD36): untrusted JSON in, a typed value or the first failing field out. Every shape is
 * read with the exact key set of its encoder (a missing, extra, inherited or ill-typed member is refused), the own-property
 * rule (a member exists only as an own property) and whole non-negative numbers. The input is never changed and the value
 * is a fresh copy. A refusal names a field (a dotted path), never a value.
 */

/** The result of a reader: the value, or the first failing field in the key order of the shape. */
export type Decoded<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly field: string };

/** The result of `readEvent`: a known event, an event of a type this client does not know (only its number), or a refusal. */
export type EventRead =
  | { readonly status: 'known'; readonly event: MatchEvent }
  | { readonly status: 'unknown'; readonly seq: number }
  | { readonly status: 'invalid'; readonly field: string };

type Raw = Record<string, unknown>;
type Reader<T> = (v: unknown, field: string) => T;

class Refusal extends Error {
  constructor(readonly field: string) {
    super('refused');
  }
}
const refuse = (field: string): never => {
  throw new Refusal(field);
};
const run = <T>(read: () => T): Decoded<T> => {
  try {
    return { ok: true, value: read() };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, field: e.field };
    throw e;
  }
};

const own = (o: Raw, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const HEX64 = /^[0-9a-f]{64}$/;

const int =
  (min: number): Reader<number> =>
  (v, f) =>
    isInt(v, min) ? v : refuse(f);
const oneOf =
  <T extends string>(list: readonly T[]): Reader<T> =>
  (v, f) =>
    typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : refuse(f);
const textWhere =
  (test: (v: string) => boolean): Reader<string> =>
  (v, f) =>
    typeof v === 'string' && test(v) ? v : refuse(f);
const text = textWhere((v) => v.length > 0);
const hex = textWhere((v) => HEX64.test(v));
const bool: Reader<boolean> = (v, f) => (typeof v === 'boolean' ? v : refuse(f));
const list =
  <T>(item: Reader<T>): Reader<T[]> =>
  (v, f) =>
    Array.isArray(v) ? v.map((x, i) => item(x, `${f}[${i}]`)) : refuse(f);
const nullOr =
  <T>(item: Reader<T>): Reader<T | null> =>
  (v, f) =>
    v === null ? null : item(v, f);
const ids = list(int(1));
const pair: Reader<readonly [number, number]> = (v, f) => {
  if (!Array.isArray(v) || v.length !== 2) return refuse(f);
  return [int(1)(v[0], `${f}[0]`), int(1)(v[1], `${f}[1]`)];
};
const pairs = list(pair);
const phase: Reader<1 | 2> = (v, f) => (v === 1 || v === 2 ? v : refuse(f));

/** The members of one object, read in key order; `done` refuses the first member outside the key set (sorted). */
interface Members {
  get<T>(key: string, read: Reader<T>): T;
  has(key: string): boolean;
  path(key: string): string;
}

function object<T>(v: unknown, field: string, keys: readonly string[], body: (m: Members) => T): T {
  if (!isObject(v)) return refuse(field === '' ? 'body' : field);
  const path = (key: string): string => (field === '' ? key : `${field}.${key}`);
  const members: Members = {
    get: (key, read) => (own(v, key) ? read(v[key], path(key)) : refuse(path(key))),
    has: (key) => own(v, key),
    path,
  };
  const out = body(members);
  const extra = Object.keys(v)
    .filter((k) => !keys.includes(k))
    .sort()[0];
  if (extra !== undefined) refuse(path(extra));
  return out;
}

/** An optional member: read when present, and refused when its presence disagrees with `expected`. */
function optional<T>(m: Members, key: string, expected: boolean, read: Reader<T>): T | undefined {
  if (m.has(key) !== expected) return refuse(m.path(key));
  return expected ? m.get(key, read) : undefined;
}

const timing: Reader<Timing> = (v, f) => {
  if (v === 'manual') return v;
  return object(v, f, ['i', 'l1', 'l2'], (m) => ({ i: m.get('i', int(0)), l1: m.get('l1', int(0)), l2: m.get('l2', int(0)) }));
};

const schedule: Reader<PublicSchedule> = (v, f) =>
  object(v, f, ['c1', 'c2', 'a'], (m) => ({ c1: m.get('c1', int(0)), c2: m.get('c2', int(0)), a: m.get('a', int(0)) }));

const stateOf =
  (applied: number): Reader<PublicState> =>
  (v, f) =>
    object(v, f, ['mode', 'round', 'owners'], (m) => {
      m.get('mode', oneOf(['classic']));
      const round = m.get('round', int(0));
      if (round !== applied) refuse(m.path('round'));
      return { mode: 'classic', round, owners: m.get('owners', pairs) };
    });

/** `c2` and `a` are null together (a match without a clock) or both whole; `manual` fixes which when it is known. */
function anchors(m: Members, manual: boolean | undefined): { c2: number | null; a: number | null } {
  const c2 = m.get('c2', nullOr(int(0)));
  const a = m.get('a', nullOr(int(0)));
  if (manual !== undefined && (c2 === null) !== manual) refuse(m.path('c2'));
  if ((c2 === null) !== (a === null)) refuse(m.path('a'));
  return { c2, a };
}

/** The forced mark exists only when true (a single candidate): absent gives `undefined`, `false` or anything else is refused. */
function forcedMark(m: Members): true | undefined {
  return m.has('forced') ? m.get('forced', (v, f) => (v === true ? true : refuse(f))) : undefined;
}

/** The victim is among the living and every candidate is too (the neighbours it can be absorbed by are alive). */
function withinLiving(m: Members, victim: number, candidates: readonly number[], living: readonly number[]): void {
  if (!living.includes(victim)) refuse(m.path('victim'));
  if (candidates.some((c) => !living.includes(c))) refuse(m.path('candidates'));
}

/** `round` is the round being decided, which must be the one after the applied rounds. */
const victimOf =
  (manual: boolean, applied: number): Reader<PublicVictim> =>
  (v, f) =>
    object(v, f, PUBLIC_VICTIM_KEYS, (m) => {
      const round = m.get('round', int(1));
      if (round !== applied + 1) refuse(m.path('round'));
      const victim = m.get('victim', int(1));
      const candidates = m.get('candidates', ids);
      const living = m.get('living', ids);
      withinLiving(m, victim, candidates, living);
      const revealedAt = m.get('revealedAt', int(0));
      const { c2, a } = anchors(m, manual);
      const forced = forcedMark(m);
      const seq = m.get('seq', int(1));
      return forced ? { round, victim, candidates, living, revealedAt, c2, a, forced, seq } : { round, victim, candidates, living, revealedAt, c2, a, seq };
    });

const RUNNING = ['phase-1', 'phase-2', 'locked'] as const;
const isRunning = (stage: string): boolean => (RUNNING as readonly string[]).includes(stage);

/** The public view of a match (the `GET /matches/{id}` reply and the `match` of a creation or advance reply). */
export function readPublicMatch(input: unknown): Decoded<PublicMatch> {
  return run(() =>
    object(input, '', PUBLIC_MATCH_KEYS, (m) => {
      const matchId = m.get('matchId', text);
      const mapId = m.get('mapId', textWhere(isMapId));
      const mapDigest = m.get('mapDigest', hex);
      const totalRounds = m.get('totalRounds', int(1));
      const clock = m.get('timing', timing);
      const commitment = m.get('commitment', hex);
      const stage = m.get('stage', oneOf(STAGES));
      const appliedRounds = m.get('appliedRounds', int(0));
      // The applied rounds fit the stage: all of them when finished, fewer than the total while the match runs.
      const allApplied = appliedRounds === totalRounds;
      if (appliedRounds > totalRounds || (stage !== 'halted' && (stage === 'finished') !== allApplied)) refuse(m.path('appliedRounds'));
      const state = m.get('state', stateOf(appliedRounds));
      const stateDigest = m.get('stateDigest', hex);
      const lastSeq = m.get('lastSeq', int(1));
      const reportedTime = m.get('reportedTime', int(0));
      const view: { -readonly [K in keyof PublicMatch]: PublicMatch[K] } = {
        matchId, mapId, mapDigest, totalRounds, timing: clock, commitment, stage, appliedRounds, state, stateDigest, lastSeq, reportedTime,
      };
      const sched = optional(m, 'schedule', isRunning(stage) && clock !== 'manual', schedule);
      if (sched !== undefined) view.schedule = sched;
      // The victim fields: required in phase-2 and locked, optional after a reveal in halted, never elsewhere.
      const victimStage = stage === 'phase-2' || stage === 'locked';
      if (m.has('victim') || victimStage) {
        if (!victimStage && stage !== 'halted') refuse(m.path('victim'));
        view.victim = m.get('victim', victimOf(clock === 'manual', appliedRounds));
      }
      const winner = optional(m, 'winner', stage === 'finished', int(1));
      if (winner !== undefined) view.winner = winner;
      const secret = optional(m, 'matchSecret', stage === 'finished', hex);
      if (secret !== undefined) view.matchSecret = secret;
      const halt = optional(m, 'haltReason', stage === 'halted', oneOf(HALT_REASONS));
      if (halt !== undefined) view.haltReason = halt;
      return view;
    }),
  );
}

const recordOf: Reader<RecordReply> = (v, f) =>
  object(v, f, RECORD_REPLY_KEYS, (m) => ({
    round: m.get('round', int(1)),
    eliminated: m.get('eliminated', int(1)),
    absorber: m.get('absorber', int(1)),
    transferred: m.get('transferred', ids),
  }));

/** The reply of `GET /matches/{id}/states/{round}`. */
export function readStateReply(input: unknown): Decoded<StateReply> {
  return run(() =>
    object(input, '', STATE_REPLY_KEYS, (m) => ({
      round: m.get('round', int(0)),
      owners: m.get('owners', pairs),
      stateDigest: m.get('stateDigest', hex),
      reportedTime: m.get('reportedTime', int(0)),
    })),
  );
}

/** The reply of `GET /matches/{id}/records/{round}`. */
export function readRecordReply(input: unknown): Decoded<RecordReply> {
  return run(() => recordOf(input, ''));
}

/** An error reply (FR-301): `kind`, then `items`, `stage`, `appliedRounds`, `retryAfter` when present. */
export function readErrorReply(input: unknown): Decoded<ErrorReply> {
  return run(() =>
    object(input, '', ERROR_REPLY_KEYS, (m) => {
      const out: { -readonly [K in keyof ErrorReply]: ErrorReply[K] } = { kind: m.get('kind', oneOf(ERROR_ORDER)) };
      if (m.has('items')) out.items = m.get('items', list(textWhere(() => true)));
      if (m.has('stage')) out.stage = m.get('stage', oneOf(STAGES));
      if (m.has('appliedRounds')) out.appliedRounds = m.get('appliedRounds', int(0));
      if (m.has('retryAfter')) out.retryAfter = m.get('retryAfter', int(1));
      return out;
    }),
  );
}

/** The kind of a prediction and its `round`, present exactly for `victim` and `absorber`. */
function kindAndRound(m: Members): { kind: PredictionReply['kind']; round?: number } {
  const kind = m.get('kind', oneOf(PREDICTION_KINDS));
  const round = optional(m, 'round', kind !== 'winner', int(1));
  return round === undefined ? { kind } : { kind, round };
}

/** The reply of an accepted prediction (FR-267). */
export function readPredictionReply(input: unknown): Decoded<PredictionReply> {
  return run(() =>
    object(input, '', PREDICTION_REPLY_KEYS, (m) => {
      const head = kindAndRound(m);
      return { ...head, choice: m.get('choice', int(1)), version: m.get('version', int(1)) };
    }),
  );
}

const ownPrediction: Reader<OwnPrediction> = (v, f) =>
  object(v, f, OWN_PREDICTION_KEYS, (m) => {
    const playerId = m.get('playerId', textWhere(isLocalId));
    const head = kindAndRound(m);
    return { playerId, ...head, choice: m.get('choice', int(1)), version: m.get('version', int(1)) };
  });

const pageOf = <T>(item: Reader<T>): Reader<Page<T>> => (v, f) =>
  object(v, f, PAGE_KEYS, (m) => {
    const items = m.get('items', list(item));
    return m.has('next') ? { items, next: m.get('next', text) } : { items };
  });

/** A page of the caller's own predictions (FR-270). */
export function readOwnPredictionsPage(input: unknown): Decoded<Page<OwnPrediction>> {
  return run(() => pageOf(ownPrediction)(input, ''));
}

const playerResult: Reader<PlayerResult> = (v, f) =>
  object(v, f, PLAYER_RESULT_KEYS, (m) => {
    const head = kindAndRound(m);
    const choice = m.get('choice', int(1));
    const correct = m.get('correct', bool);
    const points = m.get('points', int(0));
    if (!correct && points !== 0) refuse(m.path('points'));
    return { ...head, choice, correct, points };
  });

/** A page of a player's scored predictions. */
export function readPlayerResultsPage(input: unknown): Decoded<PlayerResultsPage> {
  return run(() =>
    object(input, '', PLAYER_RESULTS_PAGE_KEYS, (m) => {
      const playerId = m.get('playerId', textWhere(isPlayerId));
      const total = m.get('total', int(0));
      const items = m.get('items', list(playerResult));
      return m.has('next') ? { playerId, total, items, next: m.get('next', text) } : { playerId, total, items };
    }),
  );
}

const leaderboardRow: Reader<LeaderboardRow> = (v, f) =>
  object(v, f, LEADERBOARD_ROW_KEYS, (m) => ({
    rank: m.get('rank', int(1)),
    playerId: m.get('playerId', textWhere(isPlayerId)),
    total: m.get('total', int(0)),
    correctVictims: m.get('correctVictims', int(0)),
    correctAbsorbers: m.get('correctAbsorbers', int(0)),
    correctWinner: m.get('correctWinner', (x, ff) => (x === 0 || x === 1 ? x : refuse(ff))),
  }));

/** A page of the leaderboard. */
export function readLeaderboardPage(input: unknown): Decoded<Page<LeaderboardRow>> {
  return run(() => pageOf(leaderboardRow)(input, ''));
}

const knownEvent = (type: MatchEvent['type'], input: unknown): MatchEvent =>
  object(input, '', EVENT_KEYS[type], (m): MatchEvent => {
    m.get('type', oneOf([type]));
    const seq = m.get('seq', int(1));
    switch (type) {
      case 'phase-closed':
        return { type, seq, round: m.get('round', int(1)), phase: m.get('phase', phase), at: m.get('at', int(0)) };
      case 'victim-revealed': {
        const round = m.get('round', int(1));
        const victim = m.get('victim', int(1));
        const candidates = m.get('candidates', ids);
        const living = m.get('living', ids);
        withinLiving(m, victim, candidates, living);
        const revealedAt = m.get('revealedAt', int(0));
        const { c2, a } = anchors(m, undefined);
        const forced = forcedMark(m);
        const reportedTime = m.get('reportedTime', int(0));
        return forced
          ? { type, seq, round, victim, candidates, living, revealedAt, c2, a, forced, reportedTime }
          : { type, seq, round, victim, candidates, living, revealedAt, c2, a, reportedTime };
      }
      case 'round-applied': {
        const round = m.get('round', int(1));
        const record = m.get('record', recordOf);
        if (record.round !== round) refuse(m.path('record.round'));
        return { type, seq, round, record, stateDigest: m.get('stateDigest', hex), appliedAt: m.get('appliedAt', int(0)) };
      }
      case 'results':
        return { type, seq, round: m.get('round', int(1)), phase: m.get('phase', phase) };
      case 'schedule': {
        const stage = m.get('stage', oneOf(RUNNING));
        const sched = m.has('schedule') ? m.get('schedule', schedule) : undefined;
        const reportedTime = m.get('reportedTime', int(0));
        return sched === undefined ? { type, seq, stage, reportedTime } : { type, seq, stage, schedule: sched, reportedTime };
      }
      case 'match-finished':
        return {
          type,
          seq,
          winner: m.get('winner', int(1)),
          matchSecret: m.get('matchSecret', hex),
          rule: m.get('rule', text),
          reportedTime: m.get('reportedTime', int(0)),
        };
      case 'match-halted':
        return { type, seq, round: m.get('round', int(1)), reason: m.get('reason', oneOf(HALT_REASONS)), reportedTime: m.get('reportedTime', int(0)) };
    }
  });

/**
 * One event frame payload. A type this client does not know with a whole `seq` is `unknown` (the model consumes it by
 * number: forward compatibility); a known type with a refused payload, or an unknown type without a whole `seq`, is `invalid`.
 */
export function readEvent(input: unknown): EventRead {
  if (!isObject(input)) return { status: 'invalid', field: 'body' };
  const type = own(input, 'type') ? input.type : undefined;
  if (typeof type !== 'string') return { status: 'invalid', field: 'type' };
  if (!Object.prototype.hasOwnProperty.call(EVENT_KEYS, type)) {
    const seq = own(input, 'seq') ? input.seq : undefined;
    return isInt(seq, 1) ? { status: 'unknown', seq } : { status: 'invalid', field: 'seq' };
  }
  const read = run(() => knownEvent(type as MatchEvent['type'], input));
  return read.ok ? { status: 'known', event: read.value } : { status: 'invalid', field: read.field };
}
