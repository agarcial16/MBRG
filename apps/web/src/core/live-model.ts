// The live match model (FR-303, FR-304, FR-289 (d) client order, FR-254 client requests). Pure: `reduce(model, input)`
// returns the next model and the effects the shell must run (network reads, hashing, drawing). Every input carries the
// monotonic instant `at` read by the shell. The model holds only what the server has sent: the rounds 0..N, the records
// 1..N, and the FR-288 fields while a victim is revealed; there is no field for an absorber or a state beyond N, and no
// request is ever built for a round above N. It does not import the engine.
import {
  readEvent,
  type HaltReason,
  type MatchEvent,
  type PublicMatch,
  type PublicSchedule,
  type PublicVictim,
  type RecordReply,
  type Stage,
  type StateReply,
  type Timing,
} from '@mbrg/protocol';
import { WATCHDOG_MS, retryDelay } from './live-retry';
import { applyRecord, canRequest, digestTextOf, livingOf, ownersOf, stepDataOf, type Owners } from './live-rounds';
import { navigate, type NavAction } from './navigation';
import type { StepData } from './step';
import { fnv1a32, keyText } from './tour-key';
import { absorberTourDecision, victimTourDecision } from './tour-plan';

/** The largest reported time received and the instant it arrived: the countdown estimate runs from it (FR-302). */
export interface Reported {
  readonly value: number;
  readonly at: number;
}

/** An event frame already numbered; `event` is absent for a type this client does not know (consumed by number). */
export interface Frame {
  readonly seq: number;
  readonly event: MatchEvent | undefined;
}

/**
 * The round the server announced as applied, whose state is being checked (`hash`) or read from the server (`read`).
 * It holds the announced record and digest only, never a state.
 */
export interface Applying {
  readonly round: number;
  readonly record: RecordReply;
  readonly digest: string;
  readonly step: 'hash' | 'read';
  /** FR-345: the absorber tour decided at the receipt of the application; it plays only if the digest matches. */
  readonly tour: AbsorberTour | undefined;
}

/** What the absorber tour needs (FR-317): the victim and the candidates of the reveal, the absorber of the record and sigma. */
export interface AbsorberTour {
  readonly victim: number;
  readonly candidates: readonly number[];
  readonly absorber: number;
  readonly sigma: number;
  /** The milliseconds available (before the view's own scaling); absent for nominal speed. */
  readonly budget?: number;
}

export type LivePhase = 'loading' | 'live' | 'resyncing' | 'closed';

/** A request the model may have to ask again after a wait (FR-307). */
export type LiveRequest =
  | { readonly type: 'public' }
  | { readonly type: 'state'; readonly round: number }
  | { readonly type: 'record'; readonly round: number }
  | { readonly type: 'stream' };

/** The event stream: asked for (`connecting`), delivering (`open`) or not wanted now (`closed`). */
export type LiveConnection = 'connecting' | 'open' | 'closed';

/** The wait before the next attempt: which consecutive failure it follows and the instant it ends (for the notice). */
export interface LiveWait {
  readonly attempt: number;
  readonly until: number;
}

/** An error that ends the scene: the match does not exist. */
export type LiveFatal = 'unknown-match';

export interface LiveModel {
  readonly matchId: string;
  readonly mapDigest: string;
  readonly totalRounds: number;
  readonly timing: Timing;
  readonly stage: Stage;
  /** N: the last applied round received (the largest round the viewer may ask about). */
  readonly applied: number;
  /** The owners of the rounds read or built so far, all at most N. */
  readonly held: ReadonlyMap<number, Owners>;
  /** The records read or received, rounds 1 to N. */
  readonly records: ReadonlyMap<number, RecordReply>;
  /** The round on display, undefined until the first drawing. */
  readonly displayed: number | undefined;
  /** A browsing target waiting for reads. */
  readonly wanted: number | undefined;
  /** The sequence number of the last event consumed. */
  readonly lastSeq: number;
  readonly reported: Reported;
  readonly schedule: PublicSchedule | undefined;
  /** The FR-288 fields of the revealed victim of round N + 1, while revealed (also kept when halted after a reveal). */
  readonly victim: PublicVictim | undefined;
  readonly winner: number | undefined;
  readonly haltReason: HaltReason | undefined;
  readonly applying: Applying | undefined;
  /** Frames received while a round is being checked, in order. */
  readonly queue: readonly Frame[];
  readonly phase: LivePhase;
  readonly connection: LiveConnection;
  /** Set while the next attempt waits (the notice shows); the last drawn round stays on display. */
  readonly wait: LiveWait | undefined;
  /** What is asked again when the wait ends. */
  readonly retry: readonly LiveRequest[];
  /** Consecutive failures since the last success. */
  readonly failures: number;
  /** The last failure was a protocol fault (a resync): only an accepted frame counts as a success. */
  readonly fault: boolean;
  readonly fatal: LiveFatal | undefined;
  /** The instant of the last byte on the open stream (the watchdog runs from it). */
  readonly lastByteAt: number;
  /** A stream has been open at least once: later openings use the header (FR-289 (d)). */
  readonly streamed: boolean;
  /** The displayed round is N (a spectator who follows the live round). */
  readonly following: boolean;
  /** A victim tour was started and nothing has completed it yet (the map view knows when it ends by itself). */
  readonly touring: boolean;
}

export type LiveInput =
  | { readonly type: 'public'; readonly at: number; readonly match: PublicMatch; readonly round?: number }
  | { readonly type: 'failed'; readonly at: number; readonly request: LiveRequest; readonly outcome: 'retry' | 'unknown-match'; readonly retryAfterMs?: number }
  | { readonly type: 'opened'; readonly at: number }
  | { readonly type: 'bytes'; readonly at: number }
  | { readonly type: 'dropped'; readonly at: number }
  | { readonly type: 'tick'; readonly at: number }
  | { readonly type: 'event'; readonly at: number; readonly data: unknown }
  | { readonly type: 'digest'; readonly at: number; readonly digest: string }
  | { readonly type: 'state'; readonly at: number; readonly reply: StateReply }
  | { readonly type: 'record'; readonly at: number; readonly reply: RecordReply }
  | { readonly type: 'navigate'; readonly at: number; readonly action: NavAction };

export type LiveEffect =
  | { readonly type: 'read-public' }
  | { readonly type: 'read-state'; readonly round: number }
  | { readonly type: 'read-record'; readonly round: number }
  | { readonly type: 'open-stream'; readonly after: number; readonly via: 'parameter' | 'header' }
  | { readonly type: 'close-stream' }
  | { readonly type: 'arm-timer'; readonly until: number }
  | { readonly type: 'hash-state'; readonly text: string }
  | { readonly type: 'draw'; readonly round: number; readonly owners: Owners }
  | { readonly type: 'play-step'; readonly from: number; readonly to: number; readonly data: StepData; readonly tour?: AbsorberTour }
  /**
   * FR-317: start the victim tour of round `round`. Only what the reveal made public: the victim, the participants, sigma
   * of `<match id>:<round>` and, with a running clock, the milliseconds available (before the view's own scaling). There
   * is no field for an absorber, a record, a state of the round or a round seed.
   */
  | { readonly type: 'victim-tour'; readonly round: number; readonly victim: number; readonly living: readonly number[]; readonly sigma: number; readonly budget?: number }
  /** FR-339: complete the running tour at once (its final state). */
  | { readonly type: 'complete-tour' };

export interface LiveResult {
  readonly model: LiveModel;
  readonly effects: readonly LiveEffect[];
}

/** The reported-time estimate at the instant `at`: never decreases while `reported` only ever rises (FR-302). */
export const estimateAt = (model: { readonly reported: Reported }, at: number): number => model.reported.value + (at - model.reported.at);

const raise = (model: LiveModel, value: number, at: number): LiveModel =>
  value > estimateAt(model, at) ? { ...model, reported: { value, at } } : model;

/** The model before the public data is read (the fields below `matchId` are placeholders until then) and its first effect. */
export function startLive(matchId: string): LiveResult {
  const model: LiveModel = {
    matchId,
    mapDigest: '',
    totalRounds: 0,
    timing: 'manual',
    stage: 'phase-1',
    applied: 0,
    held: new Map(),
    records: new Map(),
    displayed: undefined,
    wanted: undefined,
    lastSeq: 0,
    reported: { value: 0, at: 0 },
    schedule: undefined,
    victim: undefined,
    winner: undefined,
    haltReason: undefined,
    applying: undefined,
    queue: [],
    phase: 'loading',
    connection: 'closed',
    wait: undefined,
    retry: [],
    failures: 0,
    fault: false,
    fatal: undefined,
    lastByteAt: 0,
    streamed: false,
    following: true,
    touring: false,
  };
  return { model, effects: [{ type: 'read-public' }] };
}

const result = (model: LiveModel, effects: readonly LiveEffect[] = []): LiveResult => ({ model, effects });

/** The timer the shell must arm: the end of the wait or the watchdog of the open stream, whichever comes first. */
function armFor(model: LiveModel): LiveEffect[] {
  const dues = [...(model.wait === undefined ? [] : [model.wait.until]), ...(model.connection === 'open' ? [model.lastByteAt + WATCHDOG_MS] : [])];
  return dues.length === 0 ? [] : [{ type: 'arm-timer', until: Math.min(...dues) }];
}

/** A read arrived: the schedule starts over, unless the last failure was a protocol fault (only an accepted frame ends that). */
const succeeded = (model: LiveModel): LiveModel => (model.fault ? model : { ...model, failures: 0 });

/** The last sequence number received, counting the frames that wait in the queue: a reconnection continues after it. */
const receivedSeq = (model: LiveModel): number => (model.queue.length > 0 ? (model.queue[model.queue.length - 1] as Frame).seq : model.lastSeq);

const openStream = (model: LiveModel): LiveEffect => ({ type: 'open-stream', after: receivedSeq(model), via: model.streamed ? 'header' : 'parameter' });

const sameRequest = (a: LiveRequest, b: LiveRequest): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A failure that is retried by the schedule: the request is asked again when the wait ends (the larger of the schedule and `Retry-After`). */
function waitFor(model: LiveModel, at: number, request: LiveRequest, retryAfter?: number): LiveResult {
  const failures = model.failures + 1;
  const until = Math.max(model.wait?.until ?? 0, at + retryDelay(failures, retryAfter));
  const retry = model.retry.some((r) => sameRequest(r, request)) ? model.retry : [...model.retry, request];
  const next: LiveModel = { ...model, failures, wait: { attempt: failures, until }, retry };
  return result(next, armFor(next));
}

/** A gap, a refused event or a wrong round: drop what is in flight, close the stream and read the public data after a wait (21.5, 21.7). */
function resync(model: LiveModel, at: number): LiveResult {
  const failures = model.failures + 1;
  const wait: LiveWait = { attempt: failures, until: at + retryDelay(failures) };
  const next: LiveModel = {
    ...model,
    phase: 'resyncing',
    applying: undefined,
    queue: [],
    wanted: undefined,
    connection: 'closed',
    failures,
    fault: true,
    wait,
    retry: [{ type: 'public' }],
  };
  return result(next, [{ type: 'close-stream' }, ...armFor(next)]);
}

/** The match is over for the stream (finished or halted) or the scene ended: no stream is wanted any more. */
const withoutStream = (model: LiveModel): LiveModel => {
  const retry = model.retry.filter((r) => r.type !== 'stream');
  return { ...model, connection: 'closed', retry, wait: retry.length === 0 ? undefined : model.wait };
};

/** What a browsing step to `target` needs: the owners, and for a step of one round the record of the later round. */
function plan(model: LiveModel, target: number, step: boolean): { single: boolean; states: number[]; record: number | undefined } {
  const from = model.displayed;
  const single = step && from !== undefined && Math.abs(target - from) === 1;
  return { single, states: single ? [from, target] : [target], record: single ? Math.max(from, target) : undefined };
}

/** The reads a step needs: `needed` is true while something is missing; a state already being read is not asked twice. */
function missingReads(model: LiveModel, p: ReturnType<typeof plan>): { reads: LiveEffect[]; needed: boolean } {
  const reads: LiveEffect[] = [];
  let needed = false;
  for (const round of p.states) {
    if (model.held.has(round) || !canRequest(model.applied, 'state', round)) continue;
    needed = true;
    if (!(model.applying?.step === 'read' && model.applying.round === round)) reads.push({ type: 'read-state', round });
  }
  if (p.record !== undefined && !model.records.has(p.record) && canRequest(model.applied, 'record', p.record)) {
    needed = true;
    reads.push({ type: 'read-record', round: p.record });
  }
  return { reads, needed };
}

/** Shows `target` once everything it needs is held: a step of one round plays, any other change is instant. */
function show(model: LiveModel, target: number, p: ReturnType<typeof plan>): LiveResult {
  const owners = model.held.get(target);
  const from = model.displayed;
  if (owners === undefined) return result(model);
  const next = { ...model, displayed: target, wanted: undefined, following: target === model.applied };
  if (p.single && from !== undefined && p.record !== undefined) {
    const record = model.records.get(p.record);
    const other = model.held.get(from);
    if (record !== undefined && other !== undefined) {
      const data = target > from ? stepDataOf(other, owners, record) : stepDataOf(owners, other, record);
      return result(next, [{ type: 'play-step', from, to: target, data }]);
    }
  }
  return result(next, [{ type: 'draw', round: target, owners }]);
}

/** Goes to a round at most N: shown at once when held, else the reads it needs (asked once per target). */
function goto(model: LiveModel, target: number, step: boolean): LiveResult {
  if (model.displayed === target) return model.wanted === undefined ? result(model) : result({ ...model, wanted: undefined });
  const p = plan(model, target, step);
  const { reads, needed } = missingReads(model, p);
  if (!needed) return show(model, target, p);
  return model.wanted === target ? result(model) : result({ ...model, wanted: target }, reads);
}

/** After a read arrived: finishes the browsing target when everything it needs is held. */
function settle(model: LiveModel): LiveResult {
  if (model.wanted === undefined) return result(model);
  const p = plan(model, model.wanted, true);
  return missingReads(model, p).needed ? result(model) : show(model, model.wanted, p);
}

const join = (a: LiveResult, b: LiveResult): LiveResult => ({ model: b.model, effects: [...a.effects, ...b.effects] });

function fromPublic(prev: LiveModel, input: Extract<LiveInput, { type: 'public' }>): LiveResult {
  const m = input.match;
  if (m.matchId !== prev.matchId || (prev.phase !== 'loading' && prev.phase !== 'resyncing')) return result(prev);
  const owners = ownersOf(m.state.owners);
  const loading = prev.phase === 'loading';
  const finalStage = m.stage === 'finished' || m.stage === 'halted';
  const held = new Map(prev.held).set(m.appliedRounds, owners);
  const base: LiveModel = {
    ...prev,
    mapDigest: m.mapDigest,
    totalRounds: m.totalRounds,
    timing: m.timing,
    stage: m.stage,
    applied: m.appliedRounds,
    held,
    lastSeq: m.lastSeq,
    reported: loading ? { value: m.reportedTime, at: input.at } : raise(prev, m.reportedTime, input.at).reported,
    schedule: m.schedule,
    victim: m.victim,
    winner: m.winner,
    haltReason: m.haltReason,
    applying: undefined,
    queue: [],
    wanted: undefined,
    phase: finalStage ? 'closed' : 'live',
    // A resync keeps counting until a frame is accepted (a protocol fault is not a success); the first public read starts at zero.
    failures: loading ? 0 : prev.failures,
    wait: undefined,
    retry: [],
    connection: finalStage ? 'closed' : 'connecting',
  };
  const asked = loading && input.round !== undefined && input.round <= m.appliedRounds ? input.round : undefined;
  // A spectator who followed N keeps following it, also after a failed state read and a resync; one who browsed stays where they are.
  const target = asked ?? (prev.following ? m.appliedRounds : (prev.displayed as number));
  const shown = goto(base, target, false);
  return finalStage ? shown : join(shown, result(shown.model, [openStream(base)]));
}

function commit(model: LiveModel, applying: Applying, at: number): LiveResult {
  const base = model.held.get(model.applied);
  const owners = base === undefined ? 'mismatch' : applyRecord(base, applying.record);
  if (owners === 'mismatch') return readInstead(model, applying);
  const follow = model.displayed === applying.round - 1;
  const next: LiveModel = {
    ...model,
    applied: applying.round,
    held: new Map(model.held).set(applying.round, owners),
    records: new Map(model.records).set(applying.round, applying.record),
    victim: undefined,
    applying: undefined,
    displayed: follow ? applying.round : model.displayed,
  };
  const playing = follow && base !== undefined;
  const tour = playing ? applying.tour : undefined;
  const step: LiveEffect[] = playing
    ? [{ type: 'play-step', from: applying.round - 1, to: applying.round, data: stepDataOf(base, owners, applying.record), ...(tour === undefined ? {} : { tour }) }]
    : [];
  return drain(result({ ...next, touring: tour !== undefined }, step), at);
}

/**
 * The digest differs (or the record does not fit): N is the announced round and its state is read from the server. The record
 * is not kept (it did not fit what is held): a later step over this round reads it from the server.
 */
function readInstead(model: LiveModel, applying: Applying): LiveResult {
  return result(
    {
      ...model,
      applied: applying.round,
      victim: undefined,
      applying: { ...applying, step: 'read', tour: undefined },
    },
    [{ type: 'read-state', round: applying.round }],
  );
}

/** Handles queued frames in order until one starts checking a round again. */
function drain(out: LiveResult, at: number): LiveResult {
  let current = out;
  while (current.model.applying === undefined && current.model.queue.length > 0 && current.model.phase === 'live') {
    const [head, ...rest] = current.model.queue as Frame[];
    current = join(current, consume({ ...current.model, queue: rest }, head as Frame, at));
  }
  return current;
}

const completeIfTouring = (model: LiveModel): LiveEffect[] => (model.touring ? [{ type: 'complete-tour' }] : []);

/**
 * FR-316 FR-317 FR-339: the victim reveal of round k has been consumed (`model` already holds its victim and the raised
 * estimate). A fresh one with matching participants starts the tour, after completing a tour that may still run; one
 * that plays nothing still completes it. Nothing here reads the record, the absorber or any state of round k.
 */
function victimTour(model: LiveModel, e: Extract<MatchEvent, { type: 'victim-revealed' }>, at: number): LiveResult {
  const shown = model.displayed === undefined ? undefined : model.held.get(model.displayed);
  const decision = victimTourDecision({
    source: 'event',
    halted: model.stage === 'halted' || model.haltReason !== undefined,
    round: e.round,
    displayed: model.displayed,
    estimate: estimateAt(model, at),
    revealedAt: e.revealedAt,
    living: e.living,
    displayedLiving: shown === undefined ? [] : livingOf(shown),
    victim: e.victim,
    timing: model.timing,
    c2: e.c2,
  });
  const complete = completeIfTouring(model);
  if (!decision.play) return result(model.touring ? { ...model, touring: false } : model, complete);
  const start: LiveEffect = {
    type: 'victim-tour',
    round: e.round,
    victim: e.victim,
    living: e.living,
    sigma: fnv1a32(keyText(model.matchId, e.round, 'victim')),
    ...(decision.budget === undefined ? {} : { budget: decision.budget }),
  };
  return result({ ...model, touring: true }, [...complete, start]);
}

/**
 * FR-345 FR-350: the absorber tour of the round announced by `round-applied`, decided at its receipt from the candidates held
 * since the victim reveal (read here, before `commit` clears the victim). undefined when it does not play.
 */
function absorberTour(model: LiveModel, e: Extract<MatchEvent, { type: 'round-applied' }>, at: number): AbsorberTour | undefined {
  const held = model.victim !== undefined && model.victim.round === e.round ? model.victim : undefined;
  const decision = absorberTourDecision({
    halted: model.stage === 'halted' || model.haltReason !== undefined,
    round: e.round,
    totalRounds: model.totalRounds,
    displayed: model.displayed,
    estimate: estimateAt(model, at),
    appliedAt: e.appliedAt,
    candidates: held?.candidates,
    absorber: e.record.absorber,
    timing: model.timing,
  });
  if (!decision.play || held === undefined) return undefined;
  return {
    victim: held.victim,
    candidates: [...held.candidates],
    absorber: e.record.absorber,
    sigma: fnv1a32(keyText(model.matchId, e.round, 'absorber')),
    ...(decision.budget === undefined ? {} : { budget: decision.budget }),
  };
}

/** One frame whose number is the next one: updates the fields it sets; `round-applied` starts the check of its round. */
function consume(model: LiveModel, frame: Frame, at: number): LiveResult {
  // An accepted frame is a success: the schedule starts over.
  const m: LiveModel = { ...model, lastSeq: frame.seq, failures: 0, fault: false };
  const e = frame.event;
  if (e === undefined) return result(m);
  switch (e.type) {
    case 'phase-closed':
    case 'results':
      return result(m);
    case 'victim-revealed': {
      if (e.round !== m.applied + 1) return resync(model, at);
      const victim: PublicVictim = {
        round: e.round, victim: e.victim, candidates: e.candidates, living: e.living, revealedAt: e.revealedAt, c2: e.c2, a: e.a, seq: e.seq,
      };
      // The estimate of the decision includes the event's own reported time (plan 4.7).
      return victimTour(raise({ ...m, victim }, e.reportedTime, at), e, at);
    }
    case 'schedule':
      return result(raise({ ...m, stage: e.stage, schedule: e.schedule }, e.reportedTime, at));
    case 'match-finished':
      return result(raise(withoutStream({ ...m, stage: 'finished', winner: e.winner, schedule: undefined, phase: 'closed' }), e.reportedTime, at), [{ type: 'close-stream' }]);
    case 'match-halted':
      return result(raise(withoutStream({ ...m, stage: 'halted', haltReason: e.reason, schedule: undefined, phase: 'closed', touring: false }), e.reportedTime, at), [
        ...completeIfTouring(m),
        { type: 'close-stream' },
      ]);
    case 'round-applied': {
      const base = m.held.get(m.applied);
      if (e.round !== m.applied + 1 || base === undefined) return resync(model, at);
      const applying: Applying = { round: e.round, record: e.record, digest: e.stateDigest, step: 'hash', tour: absorberTour(m, e, at) };
      // The victim tour is over for the model: the map view completes it before it draws the round (FR-339).
      const idle: LiveModel = m.touring ? { ...m, touring: false } : m;
      const next = applyRecord(base, e.record);
      if (next === 'mismatch') return readInstead(idle, applying);
      return result({ ...idle, applying }, [{ type: 'hash-state', text: digestTextOf(next, e.round) }]);
    }
  }
}

function onEvent(model: LiveModel, data: unknown, at: number): LiveResult {
  if (model.phase !== 'live') return result(model);
  const read = readEvent(data);
  if (read.status === 'invalid') return resync(model, at);
  const frame: Frame = read.status === 'unknown' ? { seq: read.seq, event: undefined } : { seq: read.event.seq, event: read.event };
  const tail = receivedSeq(model);
  if (frame.seq <= tail) return result(model);
  if (frame.seq > tail + 1) return resync(model, at);
  if (model.applying !== undefined) return result({ ...model, queue: [...model.queue, frame] });
  return consume(model, frame, at);
}

function onState(model: LiveModel, reply: StateReply, at: number): LiveResult {
  const round = reply.round;
  if (round > model.applied || round < 0) return result(model);
  const a = model.applying;
  const reading = a !== undefined && a.step === 'read' && a.round === round;
  // The state the server sends for the round it announced must carry the digest it announced.
  if (reading && reply.stateDigest !== a.digest) return resync(model, at);
  const held = new Map(model.held).set(round, ownersOf(reply.owners));
  const next = { ...model, held };
  if (reading) {
    const follow = model.displayed === round - 1;
    const owners = held.get(round) as Owners;
    const done: LiveModel = { ...next, applying: undefined, displayed: follow ? round : next.displayed, wanted: follow && next.wanted === round ? undefined : next.wanted };
    return drain(follow ? result(done, [{ type: 'draw', round, owners }]) : settle(done), at);
  }
  return settle(next);
}

/** A failed request: `unknown-match` ends the scene, anything else waits by the schedule and is asked again (FR-307). */
function onFailed(model: LiveModel, input: Extract<LiveInput, { type: 'failed' }>): LiveResult {
  const { request, at } = input;
  if (input.outcome === 'unknown-match') {
    const stop: LiveEffect[] = model.connection === 'closed' ? [] : [{ type: 'close-stream' }];
    return result({ ...model, fatal: 'unknown-match', phase: 'closed', connection: 'closed', wait: undefined, retry: [], queue: [], applying: undefined, wanted: undefined }, stop);
  }
  if (request.type === 'stream') return model.phase === 'live' ? waitFor({ ...model, connection: 'closed' }, at, request, input.retryAfterMs) : result(model);
  if (request.type === 'public' && model.phase !== 'loading' && model.phase !== 'resyncing') return result(model);
  return waitFor(model, at, request, input.retryAfterMs);
}

/** The open stream ended, failed or went silent: reconnect at once with the header, or by the schedule after earlier failures. */
function onDropped(model: LiveModel, at: number): LiveResult {
  if (model.connection !== 'open') return result(model);
  const closed: LiveModel = { ...model, connection: 'closed' };
  if (model.failures > 0) {
    const waiting = waitFor(closed, at, { type: 'stream' });
    return result(waiting.model, [{ type: 'close-stream' }, ...waiting.effects]);
  }
  return result({ ...closed, connection: 'connecting' }, [{ type: 'close-stream' }, openStream(closed)]);
}

/** The effect that asks a request again; undefined when it no longer applies. */
function askAgain(model: LiveModel, request: LiveRequest): LiveEffect | undefined {
  switch (request.type) {
    case 'public':
      return { type: 'read-public' };
    case 'state':
      return canRequest(model.applied, 'state', request.round) ? { type: 'read-state', round: request.round } : undefined;
    case 'record':
      return canRequest(model.applied, 'record', request.round) ? { type: 'read-record', round: request.round } : undefined;
    case 'stream':
      return model.phase === 'live' && model.connection !== 'open' ? openStream(model) : undefined;
  }
}

/** A timer came due: the watchdog of the open stream, then the end of a wait. */
function onTick(model: LiveModel, at: number): LiveResult {
  let current = model;
  const effects: LiveEffect[] = [];
  if (current.connection === 'open' && at - current.lastByteAt >= WATCHDOG_MS) {
    const dropped = onDropped(current, at);
    current = dropped.model;
    effects.push(...dropped.effects);
  }
  if (current.wait !== undefined && at >= current.wait.until) {
    const asked = current.retry.flatMap((r) => askAgain(current, r) ?? []);
    current = { ...current, wait: undefined, retry: [], connection: asked.some((e) => e.type === 'open-stream') ? 'connecting' : current.connection };
    effects.push(...asked);
  }
  return result(current, [...effects, ...armFor(current)]);
}

/** The next model and the effects for one input. Total: an input that does not fit the model changes nothing. */
export function reduce(model: LiveModel, input: LiveInput): LiveResult {
  if (model.fatal !== undefined) return result(model);
  switch (input.type) {
    case 'public':
      return fromPublic(model, input);
    case 'failed':
      return onFailed(model, input);
    case 'opened': {
      if (model.connection !== 'connecting') return result(model);
      const next: LiveModel = { ...model, connection: 'open', lastByteAt: input.at, streamed: true };
      return result(next, armFor(next));
    }
    case 'bytes':
      return model.connection === 'open' ? result({ ...model, lastByteAt: input.at, failures: model.fault ? model.failures : 0 }) : result(model);
    case 'dropped':
      return onDropped(model, input.at);
    case 'tick':
      return onTick(model, input.at);
    case 'event':
      return onEvent(model, input.data, input.at);
    case 'digest': {
      const a = model.applying;
      if (a === undefined || a.step !== 'hash') return result(model);
      return input.digest === a.digest ? commit(model, a, input.at) : readInstead(model, a);
    }
    case 'state':
      return model.phase === 'loading' ? result(model) : onState(succeeded(model), input.reply, input.at);
    case 'record': {
      const round = input.reply.round;
      if (model.phase === 'loading' || !canRequest(model.applied, 'record', round)) return result(model);
      return settle({ ...succeeded(model), records: new Map(model.records).set(round, input.reply) });
    }
    case 'navigate': {
      if (model.phase === 'loading' || model.displayed === undefined) return result(model);
      const target = navigate(model.displayed, model.applied, input.action);
      return target === 'invalid' ? result(model) : goto(model, target, true);
    }
  }
}
