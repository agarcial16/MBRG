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
import { applyRecord, canRequest, digestTextOf, ownersOf, stepDataOf, type Owners } from './live-rounds';
import { navigate, type NavAction } from './navigation';
import type { StepData } from './step';

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
}

export type LivePhase = 'loading' | 'live' | 'resyncing' | 'closed';

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
}

export type LiveInput =
  | { readonly type: 'public'; readonly at: number; readonly match: PublicMatch; readonly round?: number }
  | { readonly type: 'event'; readonly at: number; readonly data: unknown }
  | { readonly type: 'digest'; readonly at: number; readonly digest: string }
  | { readonly type: 'state'; readonly at: number; readonly reply: StateReply }
  | { readonly type: 'record'; readonly at: number; readonly reply: RecordReply }
  | { readonly type: 'navigate'; readonly at: number; readonly action: NavAction };

export type LiveEffect =
  | { readonly type: 'read-public' }
  | { readonly type: 'read-state'; readonly round: number }
  | { readonly type: 'read-record'; readonly round: number }
  | { readonly type: 'open-stream'; readonly after: number }
  | { readonly type: 'close-stream' }
  | { readonly type: 'hash-state'; readonly text: string }
  | { readonly type: 'draw'; readonly round: number; readonly owners: Owners }
  | { readonly type: 'play-step'; readonly from: number; readonly to: number; readonly data: StepData };

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
  };
  return { model, effects: [{ type: 'read-public' }] };
}

const result = (model: LiveModel, effects: readonly LiveEffect[] = []): LiveResult => ({ model, effects });

/** A gap or a refused event: drop what is in flight, close the stream and read the public data again (21.5). */
const resync = (model: LiveModel): LiveResult =>
  result({ ...model, phase: 'resyncing', applying: undefined, queue: [], wanted: undefined }, [{ type: 'close-stream' }, { type: 'read-public' }]);

/** What a browsing step to `target` needs: the owners, and for a step of one round the record of the later round. */
function plan(model: LiveModel, target: number, step: boolean): { single: boolean; states: number[]; record: number | undefined } {
  const from = model.displayed;
  const single = step && from !== undefined && Math.abs(target - from) === 1;
  return { single, states: single ? [from, target] : [target], record: single ? Math.max(from, target) : undefined };
}

function missingReads(model: LiveModel, p: ReturnType<typeof plan>): LiveEffect[] {
  const reads: LiveEffect[] = [];
  for (const round of p.states) {
    if (!model.held.has(round) && canRequest(model.applied, 'state', round)) reads.push({ type: 'read-state', round });
  }
  if (p.record !== undefined && !model.records.has(p.record) && canRequest(model.applied, 'record', p.record)) {
    reads.push({ type: 'read-record', round: p.record });
  }
  return reads;
}

/** Shows `target` once everything it needs is held: a step of one round plays, any other change is instant. */
function show(model: LiveModel, target: number, p: ReturnType<typeof plan>): LiveResult {
  const owners = model.held.get(target);
  const from = model.displayed;
  if (owners === undefined) return result(model);
  const next = { ...model, displayed: target, wanted: undefined };
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
  const reads = missingReads(model, p);
  if (reads.length === 0) return show(model, target, p);
  return model.wanted === target ? result(model) : result({ ...model, wanted: target }, reads);
}

/** After a read arrived: finishes the browsing target when everything it needs is held. */
function settle(model: LiveModel): LiveResult {
  if (model.wanted === undefined) return result(model);
  const p = plan(model, model.wanted, true);
  return missingReads(model, p).length === 0 ? show(model, model.wanted, p) : result(model);
}

const join = (a: LiveResult, b: LiveResult): LiveResult => ({ model: b.model, effects: [...a.effects, ...b.effects] });

function fromPublic(prev: LiveModel, input: Extract<LiveInput, { type: 'public' }>): LiveResult {
  const m = input.match;
  if (m.matchId !== prev.matchId || (prev.phase !== 'loading' && prev.phase !== 'resyncing')) return result(prev);
  const owners = ownersOf(m.state.owners);
  const loading = prev.phase === 'loading';
  const finalStage = m.stage === 'finished' || m.stage === 'halted';
  const following = prev.displayed === undefined || prev.displayed === prev.applied;
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
  };
  const asked = loading && input.round !== undefined && input.round <= m.appliedRounds ? input.round : undefined;
  const target = asked ?? (following ? m.appliedRounds : (prev.displayed as number));
  const shown = goto(base, target, false);
  return finalStage ? shown : join(shown, result(shown.model, [{ type: 'open-stream', after: m.lastSeq }]));
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
  const step: LiveEffect[] = follow && base !== undefined ? [{ type: 'play-step', from: applying.round - 1, to: applying.round, data: stepDataOf(base, owners, applying.record) }] : [];
  return drain(result(next, step), at);
}

/** The digest differs (or the record does not fit): N is the announced round and its state is read from the server. */
function readInstead(model: LiveModel, applying: Applying): LiveResult {
  return result(
    {
      ...model,
      applied: applying.round,
      records: new Map(model.records).set(applying.round, applying.record),
      victim: undefined,
      applying: { ...applying, step: 'read' },
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

/** One frame whose number is the next one: updates the fields it sets; `round-applied` starts the check of its round. */
function consume(model: LiveModel, frame: Frame, at: number): LiveResult {
  const m: LiveModel = { ...model, lastSeq: frame.seq };
  const e = frame.event;
  if (e === undefined) return result(m);
  switch (e.type) {
    case 'phase-closed':
    case 'results':
      return result(m);
    case 'victim-revealed': {
      if (e.round !== m.applied + 1) return resync(model);
      const victim: PublicVictim = {
        round: e.round, victim: e.victim, candidates: e.candidates, living: e.living, revealedAt: e.revealedAt, c2: e.c2, a: e.a, seq: e.seq,
      };
      return result(raise({ ...m, victim }, e.reportedTime, at));
    }
    case 'schedule':
      return result(raise({ ...m, stage: e.stage, schedule: e.schedule }, e.reportedTime, at));
    case 'match-finished':
      return result(raise({ ...m, stage: 'finished', winner: e.winner, schedule: undefined, phase: 'closed' }, e.reportedTime, at), [{ type: 'close-stream' }]);
    case 'match-halted':
      return result(raise({ ...m, stage: 'halted', haltReason: e.reason, schedule: undefined, phase: 'closed' }, e.reportedTime, at), [{ type: 'close-stream' }]);
    case 'round-applied': {
      const base = m.held.get(m.applied);
      if (e.round !== m.applied + 1 || base === undefined) return resync(model);
      const applying: Applying = { round: e.round, record: e.record, digest: e.stateDigest, step: 'hash' };
      const next = applyRecord(base, e.record);
      if (next === 'mismatch') return readInstead(m, applying);
      return result({ ...m, applying }, [{ type: 'hash-state', text: digestTextOf(next, e.round) }]);
    }
  }
}

function onEvent(model: LiveModel, data: unknown, at: number): LiveResult {
  if (model.phase !== 'live') return result(model);
  const read = readEvent(data);
  if (read.status === 'invalid') return resync(model);
  const frame: Frame = read.status === 'unknown' ? { seq: read.seq, event: undefined } : { seq: read.event.seq, event: read.event };
  const tail = model.queue.length > 0 ? (model.queue[model.queue.length - 1] as Frame).seq : model.lastSeq;
  if (frame.seq <= tail) return result(model);
  if (frame.seq > tail + 1) return resync(model);
  if (model.applying !== undefined) return result({ ...model, queue: [...model.queue, frame] });
  return consume(model, frame, at);
}

function onState(model: LiveModel, reply: StateReply, at: number): LiveResult {
  const round = reply.round;
  if (round > model.applied || round < 0) return result(model);
  const held = new Map(model.held).set(round, ownersOf(reply.owners));
  const next = { ...model, held };
  const a = model.applying;
  if (a !== undefined && a.step === 'read' && a.round === round) {
    const follow = model.displayed === round - 1;
    const owners = held.get(round) as Owners;
    const done: LiveModel = { ...next, applying: undefined, displayed: follow ? round : next.displayed };
    return drain(result(done, follow ? [{ type: 'draw', round, owners }] : []), at);
  }
  return settle(next);
}

/** The next model and the effects for one input. Total: an input that does not fit the model changes nothing. */
export function reduce(model: LiveModel, input: LiveInput): LiveResult {
  switch (input.type) {
    case 'public':
      return fromPublic(model, input);
    case 'event':
      return onEvent(model, input.data, input.at);
    case 'digest': {
      const a = model.applying;
      if (a === undefined || a.step !== 'hash') return result(model);
      return input.digest === a.digest ? commit(model, a, input.at) : readInstead(model, a);
    }
    case 'state':
      return model.phase === 'loading' ? result(model) : onState(model, input.reply, input.at);
    case 'record': {
      const round = input.reply.round;
      if (model.phase === 'loading' || !canRequest(model.applied, 'record', round)) return result(model);
      return settle({ ...model, records: new Map(model.records).set(round, input.reply) });
    }
    case 'navigate': {
      if (model.phase === 'loading' || model.displayed === undefined) return result(model);
      const target = navigate(model.displayed, model.applied, input.action);
      return target === 'invalid' ? result(model) : goto(model, target, true);
    }
  }
}
