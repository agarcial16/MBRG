/**
 * A scripted dev-map match for the live-viewer tests: the states and records come from the engine (tests may import it;
 * the viewer sources may not), the replies and events are built with the protocol encoders and read back as JSON, so the
 * model sees exactly what the wire carries. Timing is `manual` (no schedule). Event numbering: the first event is the
 * initial `schedule` (seq 1); round k then owns the 8 events seq 2 + 8 (k - 1) to 9 + 8 (k - 1):
 * phase-closed 1, victim-revealed, schedule phase-2, phase-closed 2, schedule locked, round-applied, results, then the
 * schedule of the next round (or match-finished after the last round).
 */
import {
  encodeEvent,
  encodePublicMatch,
  encodeRecord,
  encodeState,
  stateText,
  type MatchEvent,
  type PublicMatch,
  type RecordReply,
  type StateReply,
} from '@mbrg/protocol';
import { getRounds, getState, totalRounds } from '@mbrg/sim';
import { reduce, startLive, type LiveEffect, type LiveInput, type LiveModel } from '../../src/core/live-model';
import { DEV_MAP } from './dev-map';

export const MATCH_ID = 'AbCdEfGh01234567';
export const SEED = 7;
const hex = (c: string): string => c.repeat(64);

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Scripted {
  total: number;
  /** states[n] = the owners pairs at round n, digests[n] = their state digest. */
  states: (readonly (readonly [number, number])[])[];
  digests: string[];
  records: RecordReply[]; // records[k - 1] is the record of round k
  living: number[][]; // living[n] = the factions alive at round n
}

let cached: Promise<Scripted> | undefined;

/** The scripted match of seed `SEED` on the dev map, computed once. */
export function scripted(): Promise<Scripted> {
  cached ??= (async () => {
    const t = totalRounds(DEV_MAP);
    if (!t.ok) throw new Error('total');
    const states: Scripted['states'] = [];
    const digests: string[] = [];
    const living: number[][] = [];
    for (let n = 0; n <= t.value; n++) {
      const s = getState(DEV_MAP, SEED, n);
      if (!s.ok) throw new Error('state');
      states.push(s.value.owners.map((p) => [p[0], p[1]] as const));
      digests.push(await sha256Hex(stateText({ mode: 'classic', round: n, owners: s.value.owners })));
      living.push([...new Set(s.value.owners.map((p) => p[1]))].sort((a, b) => a - b));
    }
    const r = getRounds(DEV_MAP, SEED, t.value);
    if (!r.ok) throw new Error('rounds');
    return { total: t.value, states, digests, records: r.value.map((x) => ({ round: x.round, eliminated: x.eliminated, absorber: x.absorber, transferred: [...x.transferred] })), living };
  })();
  return cached;
}

export const seqOfRound = (k: number): number => 2 + 8 * (k - 1);
export const lastSeqAt = (n: number): number => 1 + 8 * n;

/** The state reply of round n as the server sends it, read back from JSON. */
export const stateReply = (s: Scripted, n: number): StateReply =>
  JSON.parse(encodeState({ round: n, owners: s.states[n] as never, stateDigest: s.digests[n] as string, reportedTime: 1000 + n })) as StateReply;

export const recordReply = (s: Scripted, k: number): RecordReply => JSON.parse(encodeRecord(s.records[k - 1] as RecordReply)) as RecordReply;

/** The public data of the match after n applied rounds (phase-1, or finished at the last round), manual timing. */
export function publicAt(s: Scripted, n: number, extra: Partial<PublicMatch> = {}): PublicMatch {
  const finished = n === s.total;
  const base: PublicMatch = {
    matchId: MATCH_ID,
    mapId: 'dev',
    mapDigest: hex('a'),
    totalRounds: s.total,
    timing: 'manual',
    commitment: hex('c'),
    stage: finished ? 'finished' : 'phase-1',
    appliedRounds: n,
    state: { mode: 'classic', round: n, owners: s.states[n] as never },
    stateDigest: s.digests[n] as string,
    lastSeq: lastSeqAt(n),
    reportedTime: 5000 + n * 100,
    ...(finished ? { winner: (s.records[n - 1] as RecordReply).absorber, matchSecret: hex('5') } : {}),
  };
  return JSON.parse(encodePublicMatch({ ...base, ...extra })) as PublicMatch;
}

/** Events as the JSON the stream carries (built with the protocol encoder and read back). */
export const wire = (list: readonly MatchEvent[]): unknown[] => list.map((e) => JSON.parse(encodeEvent(e)) as unknown);

/** The 8 events of round k as typed values (the last one is match-finished after the last round). */
export function matchEventsOfRound(s: Scripted, k: number): MatchEvent[] {
  const a = seqOfRound(k);
  const record = s.records[k - 1] as RecordReply;
  const rt = 5000 + k * 100;
  return [
    { type: 'phase-closed', seq: a, round: k, phase: 1, at: rt },
    { type: 'victim-revealed', seq: a + 1, round: k, victim: record.eliminated, candidates: [record.absorber], living: s.living[k - 1] as number[], revealedAt: rt, c2: null, a: null, reportedTime: rt + 1 },
    { type: 'schedule', seq: a + 2, stage: 'phase-2', reportedTime: rt + 2 },
    { type: 'phase-closed', seq: a + 3, round: k, phase: 2, at: rt + 3 },
    { type: 'schedule', seq: a + 4, stage: 'locked', reportedTime: rt + 4 },
    { type: 'round-applied', seq: a + 5, round: k, record, stateDigest: s.digests[k] as string, appliedAt: rt + 5 },
    { type: 'results', seq: a + 6, round: k, phase: 2 },
    k === s.total
      ? { type: 'match-finished', seq: a + 7, winner: record.absorber, matchSecret: hex('5'), rule: 'rule text', reportedTime: rt + 7 }
      : { type: 'schedule', seq: a + 7, stage: 'phase-1', reportedTime: rt + 7 },
  ];
}

/** The 8 events of round k (the last one is match-finished after the last round), as the JSON the stream carries. */
export const eventsOfRound = (s: Scripted, k: number): unknown[] => wire(matchEventsOfRound(s, k));

/** Every event from round `from` to round `to`, in order. */
export const eventsFrom = (s: Scripted, from: number, to: number): unknown[] =>
  Array.from({ length: to - from + 1 }, (_, i) => eventsOfRound(s, from + i)).flat();

/** The requests a run named: read-state and read-record rounds. */
export const requestRounds = (effects: readonly LiveEffect[]): number[] =>
  effects.flatMap((e) => (e.type === 'read-state' || e.type === 'read-record' ? [e.round] : []));

/** The request an effect makes, as the `failed` input names it (undefined for an effect that asks nothing). */
export function requestOf(effect: LiveEffect): Extract<LiveInput, { type: 'failed' }>['request'] | undefined {
  switch (effect.type) {
    case 'read-public':
      return { type: 'public' };
    case 'read-state':
      return { type: 'state', round: effect.round };
    case 'read-record':
      return { type: 'record', round: effect.round };
    case 'open-stream':
      return { type: 'stream' };
    default:
      return undefined;
  }
}

/**
 * Runs a model like the shell does: effects of reads are answered from the scripted match, `hash-state` is answered with the
 * real digest of its text (or a wrong one with `corrupt`; held back until `resolve()` with `defer`). Every effect is logged
 * with the N of the model after the input that produced it.
 */
export class Driver {
  model: LiveModel;
  at = 10_000;
  readonly log: { effect: LiveEffect; applied: number }[] = [];
  corrupt = false;
  defer = false;
  /** When set, `read-public` is answered with the public data at this many applied rounds (a retry after a wait). */
  publicN: number | undefined;
  /** Scripted failures: each read or stream opening takes the next one (first in, first out) instead of succeeding. */
  readonly failures: { outcome: 'retry' | 'unknown-match'; retryAfterMs?: number }[] = [];
  /** The `until` of the last `arm-timer` effect. */
  armed: number | undefined;
  /** When true, `read-state` and `read-record` are held back until `release()` (a read still in flight). */
  holdReads = false;
  private held: LiveEffect[] = [];
  private waiting: string[] = [];

  constructor(
    readonly s: Scripted,
    matchId: string = MATCH_ID,
  ) {
    this.model = startLive(matchId).model;
  }

  get effects(): LiveEffect[] {
    return this.log.map((x) => x.effect);
  }

  async feed(input: LiveInput): Promise<void> {
    const out = reduce(this.model, input);
    this.model = out.model;
    for (const effect of out.effects) {
      this.log.push({ effect, applied: out.model.applied });
      await this.answer(effect);
    }
  }

  private async answer(effect: LiveEffect): Promise<void> {
    this.at += 5;
    if (effect.type === 'arm-timer') {
      this.armed = effect.until;
      return;
    }
    if (this.holdReads && (effect.type === 'read-state' || effect.type === 'read-record')) {
      this.held.push(effect);
      return;
    }
    const request = requestOf(effect);
    const failure = request !== undefined && (effect.type !== 'read-public' || this.publicN !== undefined) ? this.failures.shift() : undefined;
    if (request !== undefined && failure !== undefined) {
      await this.feed({ type: 'failed', at: this.at, request, ...failure });
    } else if (effect.type === 'read-public' && this.publicN !== undefined) {
      await this.feed({ type: 'public', at: this.at, match: publicAt(this.s, this.publicN) });
    } else if (effect.type === 'hash-state' && this.defer) {
      this.waiting.push(effect.text);
    } else if (effect.type === 'hash-state') {
      await this.feed({ type: 'digest', at: this.at, digest: this.corrupt ? hex('0') : await sha256Hex(effect.text) });
    } else if (effect.type === 'read-state') {
      await this.feed({ type: 'state', at: this.at, reply: stateReply(this.s, effect.round) });
    } else if (effect.type === 'read-record') {
      await this.feed({ type: 'record', at: this.at, reply: recordReply(this.s, effect.round) });
    }
  }

  /** Answers the reads held back by `holdReads`, in order. */
  async release(): Promise<void> {
    this.holdReads = false;
    for (const effect of this.held.splice(0)) await this.answer(effect);
  }

  /** The retry or watchdog timer comes due: a `tick` at the armed instant (or at `at`). */
  async tick(at?: number): Promise<void> {
    const due = at ?? this.armed;
    if (due === undefined) throw new Error('no timer armed');
    this.at = Math.max(this.at, due);
    this.armed = undefined;
    await this.feed({ type: 'tick', at: due });
  }

  /** Answers the oldest held-back `hash-state`. */
  async resolve(): Promise<void> {
    const text = this.waiting.shift();
    if (text === undefined) throw new Error('nothing to resolve');
    this.at += 5;
    await this.feed({ type: 'digest', at: this.at, digest: this.corrupt ? hex('0') : await sha256Hex(text) });
  }

  /** The public data at n applied rounds, the way a start does, then the answers to its effects. */
  async load(n: number, round?: number): Promise<void> {
    await this.feed({ type: 'public', at: this.at, match: publicAt(this.s, n), ...(round === undefined ? {} : { round }) });
  }

  async events(list: readonly unknown[]): Promise<void> {
    for (const data of list) {
      this.at += 7;
      await this.feed({ type: 'event', at: this.at, data });
    }
  }
}
