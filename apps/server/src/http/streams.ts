// The event stream hub (spec 008 FR-289 (d), (e), (f), FR-290; plan 19.3, 19.5, PD22 to PD26). Platform file: it writes to
// responses and arms the heartbeat through the Scheduler interface (the only timer module stays `scheduler.ts`).
// - `open` runs in ONE synchronous turn: read the stored events after n, write the headers and the replay as one write,
//   register the stream. The service publishes right after a commit, synchronously, so no decision can fall between the read
//   and the registration (nothing missed, nothing sent twice). Each stream also keeps the number of the last event it was
//   sent and writes only a later one (a defensive filter, and the rule for a number above the latest, E5).
// - One service subscriber for all streams: a decision's events are framed once and the same bytes go to every stream of
//   the match, as one write per stream (PD23). Only stored events are framed (they are built from the public view, FR-290).
// - One heartbeat wake-up for all streams, armed while a stream is open (PD25). A stream with more than the buffer limit
//   waiting is destroyed before a write (PD26); the client reconnects with its last number and the replay fills the gap.
// - A stream's lease (the open-stream gauge place) is released exactly once, when its response closes or the hub drops it.

import { encodeEvent, errorReply } from '@mbrg/protocol';
import type { ErrorReply, MatchEvent } from '@mbrg/protocol';
import type { Clock } from '../clock';
import type { MatchService } from '../service/matches';
import type { Scheduler, SchedulerHandle } from '../service/scheduler';
import type { StreamLease } from './limits';
import { HEARTBEAT_FRAME, HEARTBEAT_MS, STREAM_BUFFER_LIMIT, frameOf } from './sse';

/** The part of a `ServerResponse` the hub uses (a fake response in the tests). */
export interface StreamTarget {
  writeHead(status: number, headers: Record<string, string>): unknown;
  flushHeaders(): unknown;
  write(chunk: string): unknown;
  end(): unknown;
  destroy(): unknown;
  readonly writableLength: number;
  on(event: 'close' | 'error', listener: () => void): unknown;
}

/** The part of the service the hub uses. */
export type StreamService = Pick<MatchService, 'eventsAfter' | 'subscribe'>;

export interface StreamHubOptions {
  readonly service: StreamService;
  readonly scheduler: Scheduler;
  readonly clock: Clock;
  /** Tests only: a smaller buffer limit (default 1 MiB). */
  readonly bufferLimit?: number;
  /** Tests only: another heartbeat interval (default 14,000 ms). */
  readonly heartbeatMs?: number;
}

export interface StreamOpen {
  readonly matchId: string;
  /** The last number the client has (events above it are sent); undefined: only events committed after the open. */
  readonly after: number | undefined;
  readonly response: StreamTarget;
  /** The 200 headers (content type, caching and CORS), decided by the caller. */
  readonly headers: Readonly<Record<string, string>>;
  /** The gauge place of this stream: the hub releases it once when the stream ends; on a refusal it stays with the caller. */
  readonly lease: StreamLease;
}

export type StreamOpened = { readonly ok: true } | { readonly ok: false; readonly error: ErrorReply };

export interface StreamHub {
  /**
   * Opens a stream. On `ok: false` (`unknown-match`, `unavailable` for a storage failure or after `closeAll`) nothing was
   * written and the lease is still the caller's. On `ok: true` the hub owns the response and the lease.
   */
  open(request: StreamOpen): StreamOpened;
  /** The streams open now. */
  openCount(): number;
  /** Shutdown: ends every stream, cancels the heartbeat, unsubscribes; later opens answer `unavailable`. */
  closeAll(): void;
}

interface Stream {
  readonly response: StreamTarget;
  readonly lease: StreamLease;
  readonly matchId: string;
  /** The number of the last event sent (or the starting number). */
  last: number;
  done: boolean;
}

export function createStreamHub(options: StreamHubOptions): StreamHub {
  const { service, scheduler, clock } = options;
  const bufferLimit = options.bufferLimit ?? STREAM_BUFFER_LIMIT;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const byMatch = new Map<string, Set<Stream>>();
  let count = 0;
  let closed = false;
  let heartbeat: { handle: SchedulerHandle; due: number } | undefined;

  const armHeartbeat = (due: number): void => {
    heartbeat = { handle: scheduler.at(due, beat), due };
  };

  /** Removes a stream and gives its place back, once; ends the heartbeat with the last stream. */
  const finish = (stream: Stream): boolean => {
    if (stream.done) return false;
    stream.done = true;
    const set = byMatch.get(stream.matchId);
    if (set !== undefined) {
      set.delete(stream);
      if (set.size === 0) byMatch.delete(stream.matchId);
    }
    count -= 1;
    stream.lease.release();
    if (count === 0 && heartbeat !== undefined) {
      scheduler.cancel(heartbeat.handle);
      heartbeat = undefined;
    }
    return true;
  };

  /** Drops a stream whose response failed or is too slow: destroyed, never written again. */
  const drop = (stream: Stream): void => {
    if (!finish(stream)) return;
    try {
      stream.response.destroy();
    } catch {
      // A response that cannot be destroyed is already gone.
    }
  };

  /** One write to a stream: a stream over the buffer limit is dropped first, a write that throws drops only that stream. */
  const send = (stream: Stream, text: string): void => {
    if (stream.done) return;
    if (stream.response.writableLength > bufferLimit) return drop(stream);
    try {
      stream.response.write(text);
    } catch {
      drop(stream);
    }
  };

  function beat(): void {
    const due = heartbeat?.due ?? clock.now();
    heartbeat = undefined;
    for (const set of [...byMatch.values()]) for (const stream of [...set]) send(stream, HEARTBEAT_FRAME);
    if (count > 0 && !closed) armHeartbeat(Math.max(due + heartbeatMs, clock.now() + 1));
  }

  /** The subscriber: the events of one committed decision, framed once for every stream of the match. */
  const publish = (matchId: string, events: readonly MatchEvent[]): void => {
    const set = byMatch.get(matchId);
    if (set === undefined || events.length === 0) return;
    const framed = events.map((event) => ({ seq: event.seq, frame: frameOf(event.seq, encodeEvent(event)) }));
    const everything = framed.map((f) => f.frame).join('');
    for (const stream of [...set]) {
      const fresh = framed.filter((f) => f.seq > stream.last);
      if (fresh.length === 0) continue;
      const last = (fresh[fresh.length - 1] as { seq: number }).seq;
      const text = fresh.length === framed.length ? everything : fresh.map((f) => f.frame).join('');
      stream.last = last;
      send(stream, text);
    }
  };

  const unsubscribe = service.subscribe(publish);

  return {
    open(request) {
      if (closed) return { ok: false, error: errorReply('unavailable') };
      const read = service.eventsAfter(request.matchId, request.after);
      if (!read.ok) return read;
      const { events, lastSeq } = read.reply;
      const { response, lease } = request;
      const last = events.length > 0 ? (events[events.length - 1] as MatchEvent).seq : (request.after ?? lastSeq);
      const stream: Stream = { response, lease, matchId: request.matchId, last, done: false };
      const set = byMatch.get(request.matchId) ?? new Set<Stream>();
      set.add(stream);
      byMatch.set(request.matchId, set);
      count += 1;
      response.on('close', () => void finish(stream));
      response.on('error', () => drop(stream));
      try {
        response.writeHead(200, { ...request.headers });
        response.flushHeaders();
        if (events.length > 0) response.write(events.map((event) => frameOf(event.seq, encodeEvent(event))).join(''));
      } catch {
        drop(stream);
        return { ok: true };
      }
      if (heartbeat === undefined && count > 0) armHeartbeat(clock.now() + heartbeatMs);
      return { ok: true };
    },

    openCount: () => count,

    closeAll() {
      if (closed) return;
      closed = true;
      unsubscribe();
      if (heartbeat !== undefined) {
        scheduler.cancel(heartbeat.handle);
        heartbeat = undefined;
      }
      for (const set of [...byMatch.values()]) {
        for (const stream of [...set]) {
          if (!finish(stream)) continue;
          try {
            stream.response.end();
          } catch {
            // Already ended or destroyed.
          }
        }
      }
    },
  };
}
