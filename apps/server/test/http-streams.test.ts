import { encodeEvent, errorReply } from '@mbrg/protocol';
import type { MatchEvent, StepKind } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { createGauge } from '../src/http/limits';
import type { StreamLease } from '../src/http/limits';
import { HEARTBEAT_FRAME, HEARTBEAT_MS, STREAM_BUFFER_LIMIT, frameOf } from '../src/http/sse';
import { createStreamHub } from '../src/http/streams';
import type { StreamHub } from '../src/http/streams';
import type { MatchListener } from '../src/service/matches';
import { SECRETS } from './helpers/core-timelines';
import { fakeScheduler } from './helpers/fake-scheduler';
import type { FakeScheduler } from './helpers/fake-scheduler';
import { FakeResponse } from './helpers/fake-response';
import { OPERATOR, START_MS, creationBody, serviceHarness } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// The event stream hub (M3b T4; FR-289 (d), (e), (f), FR-290): replay and live events without a gap or a duplicate, one
// write per decision, the heartbeat through the scheduler, the slow-client drop, closeAll. Fake responses, the fake clock and
// the fake scheduler; the service is the real one over an in-memory store.

const SECRET = SECRETS['ascending-00-1f'];
const HEADERS = { 'content-type': 'text/event-stream' };
const frames = (events: readonly MatchEvent[]): string => events.map((e) => frameOf(e.seq, encodeEvent(e))).join('');

interface Rig {
  readonly h: Harness;
  readonly hub: StreamHub;
  readonly scheduler: FakeScheduler;
  /** The listeners the hub registered with the service and how many are still registered. */
  readonly subscriptions: { active: number; listener: MatchListener | undefined };
  /** The number of releases of each lease handed out. */
  readonly released: number[];
}

function rig(options: { bufferLimit?: number } = {}): Rig {
  const h = serviceHarness({ secret: SECRET });
  const scheduler = fakeScheduler(h.clock);
  const subscriptions: { active: number; listener: MatchListener | undefined } = { active: 0, listener: undefined };
  const service = {
    eventsAfter: (matchId: string, after: number | undefined) => h.service.eventsAfter(matchId, after),
    subscribe: (listener: MatchListener) => {
      subscriptions.active += 1;
      subscriptions.listener = listener;
      const off = h.service.subscribe(listener);
      let on = true;
      return () => {
        if (on) subscriptions.active -= 1;
        on = false;
        off();
      };
    },
  };
  const hub = createStreamHub({ service, scheduler, clock: h.clock, ...(options.bufferLimit === undefined ? {} : { bufferLimit: options.bufferLimit }) });
  return { h, hub, scheduler, subscriptions, released: [] };
}

const create = (r: Rig, requestId: string, timing: unknown = 'manual'): string => {
  const out = r.h.service.create({ credential: OPERATOR, body: creationBody(requestId, { timing }) });
  if (!out.ok) throw new Error('creation failed');
  return out.reply.matchId;
};
const step = (r: Rig, id: string, round: number, kind: StepKind): void => {
  const out = r.h.service.advance({ credential: OPERATOR, matchId: id, body: { round, step: kind } });
  if (!out.ok) throw new Error(`advance refused: ${JSON.stringify(out.error)}`);
};
const stored = (r: Rig, id: string, after = 0): MatchEvent[] => r.h.store.eventsAfter(id, after);

/** Opens a stream; the lease counts its releases in `r.released`. */
function open(r: Rig, matchId: string, after: number | undefined, response = new FakeResponse(r.h.clock)): FakeResponse {
  const index = r.released.length;
  r.released.push(0);
  const lease: StreamLease = { release: () => void (r.released[index] = (r.released[index] as number) + 1) };
  const out = r.hub.open({ matchId, after, response, headers: HEADERS, lease });
  if (!out.ok) throw new Error(`open refused: ${JSON.stringify(out.error)}`);
  return response;
}

describe('stream hub: opening and replay', () => {
  it('FR-289 (d) a stream with a number gets 200, the headers flushed, then the events after it as ONE write', () => {
    const r = rig();
    const id = create(r, 'c-1');
    step(r, id, 1, 'phase-1-close');
    const all = stored(r, id);
    const res = open(r, id, 1);
    expect(res.head).toStrictEqual({ status: 200, headers: HEADERS });
    expect(res.flushed).toBe(1);
    expect(res.chunks).toStrictEqual([frames(all.slice(1))]);
    expect(r.hub.openCount()).toBe(1);
  });

  it('FR-289 (d) from 0 the replay starts at the creation event', () => {
    const r = rig();
    const id = create(r, 'c-1');
    const res = open(r, id, 0);
    expect(res.chunks).toStrictEqual([frames(stored(r, id))]);
    expect(res.text.startsWith('id: 1\n')).toBe(true);
  });

  it('FR-289 (e) without a number nothing is replayed, only the events committed after the open', () => {
    const r = rig();
    const id = create(r, 'c-1');
    step(r, id, 1, 'phase-1-close');
    const before = stored(r, id).length;
    const res = open(r, id, undefined);
    expect(res.head?.status).toBe(200);
    expect(res.writes).toStrictEqual([]);
    step(r, id, 1, 'phase-2-close');
    expect(res.chunks).toStrictEqual([frames(stored(r, id, before))]);
  });

  it('FR-289 (d) a number at the latest or above gives an empty replay and the stream stays open', () => {
    const r = rig();
    const id = create(r, 'c-1');
    const last = stored(r, id).length;
    for (const n of [last, last + 5, Number.MAX_SAFE_INTEGER]) {
      const res = open(r, id, n);
      expect(res.writes, String(n)).toStrictEqual([]);
      expect(res.head?.status).toBe(200);
      expect(res.ended + res.destroyed).toBe(0);
    }
  });

  it('FR-290 (stream, hub) a number above the latest keeps filtering: later events with a number at or below it are never sent', () => {
    const r = rig();
    const id = create(r, 'c-1');
    const last = stored(r, id).length;
    const res = open(r, id, last + 2);
    step(r, id, 1, 'phase-1-close');
    const added = stored(r, id, last);
    expect(added.map((e) => e.seq)).toStrictEqual([last + 1, last + 2, last + 3, last + 4]);
    expect(res.chunks).toStrictEqual([frames(added.slice(2))]);
  });

  it('FR-290 (stream, hub) an advance made synchronously right after open reaches the stream exactly once (no gap)', () => {
    const r = rig();
    const id = create(r, 'c-1');
    const res = open(r, id, undefined);
    step(r, id, 1, 'phase-1-close');
    const added = stored(r, id, 1);
    expect(added.length).toBeGreaterThan(0);
    expect(res.text).toBe(frames(added));
    const withReplay = open(r, id, 0);
    step(r, id, 1, 'phase-2-close');
    expect(withReplay.text).toBe(frames(stored(r, id)));
    expect(new Set(withReplay.text.match(/^id: \d+$/gm)).size).toBe(stored(r, id).length);
  });

  it('FR-290 (stream, hub) the subscriber fed an old event writes nothing', () => {
    const r = rig();
    const id = create(r, 'c-1');
    step(r, id, 1, 'phase-1-close');
    const all = stored(r, id);
    const res = open(r, id, undefined);
    const listener = r.subscriptions.listener as MatchListener;
    listener(id, all);
    listener(id, [all[all.length - 1] as MatchEvent]);
    expect(res.writes).toStrictEqual([]);
    // A list that mixes old events with a newer one writes only the newer one.
    const newer: MatchEvent = { type: 'results', seq: all.length + 1, round: 1, phase: 1 };
    listener(id, [...all, newer]);
    expect(res.chunks).toStrictEqual([frames([newer])]);
    listener(id, [newer]);
    expect(res.chunks).toStrictEqual([frames([newer])]);
  });

  it('FR-290 (stream, hub) a failed open (unknown match) answers the error, writes nothing and keeps the lease with the caller', () => {
    const r = rig();
    const res = new FakeResponse(r.h.clock);
    const lease: StreamLease = { release: () => void r.released.push(1) };
    expect(r.hub.open({ matchId: 'nope', after: 0, response: res, headers: HEADERS, lease })).toStrictEqual({ ok: false, error: errorReply('unknown-match') });
    expect(res.head).toBeUndefined();
    expect(res.writes).toStrictEqual([]);
    expect(r.released).toStrictEqual([]);
    expect(r.hub.openCount()).toBe(0);
    expect(r.scheduler.pending()).toStrictEqual([]);
  });
});

describe('stream hub: live events', () => {
  it('FR-290 (stream, hub) two matches never see each other\'s events', () => {
    const r = rig();
    const a = create(r, 'c-a');
    const b = create(r, 'c-b');
    const ra = open(r, a, undefined);
    const rb = open(r, b, undefined);
    step(r, a, 1, 'phase-1-close');
    expect(ra.text).toBe(frames(stored(r, a, 1)));
    expect(rb.writes).toStrictEqual([]);
    step(r, b, 1, 'phase-1-close');
    expect(rb.text).toBe(frames(stored(r, b, 1)));
    expect(ra.text).toBe(frames(stored(r, a, 1)));
  });

  it('FR-290 (stream, hub) one decision is one write per stream, the same bytes for every stream of the match', () => {
    const r = rig();
    const id = create(r, 'c-1', { i: 120, l1: 30, l2: 0 });
    const streams = [open(r, id, undefined), open(r, id, undefined), open(r, id, 0)];
    streams[2]!.writes.length = 0;
    step(r, id, 1, 'phase-1-close');
    step(r, id, 1, 'phase-2-close');
    const events = stored(r, id, 1);
    // phase-1 close: three events, one write; phase-2 close with L2 = 0: close, application, schedule, one write.
    expect(streams.map((s) => s.writes.length)).toStrictEqual([2, 2, 2]);
    const [first, second, third] = streams as [FakeResponse, FakeResponse, FakeResponse];
    expect(first.chunks).toStrictEqual(second.chunks);
    expect(first.chunks).toStrictEqual(third.chunks);
    expect(first.text).toBe(frames(events));
  });

  it('FR-289 (stream framing) every byte written is the frame of the stored event', () => {
    const r = rig();
    const id = create(r, 'c-1');
    const res = open(r, id, 0);
    step(r, id, 1, 'phase-1-close');
    step(r, id, 1, 'phase-2-close');
    step(r, id, 1, 'application');
    expect(res.text).toBe(frames(stored(r, id)));
  });
});

describe('stream hub: heartbeat', () => {
  it('FR-289 (f) (heartbeat) no stream, no wake-up armed', () => {
    const r = rig();
    create(r, 'c-1');
    expect(r.scheduler.pending()).toStrictEqual([]);
  });

  it('FR-289 (f) (heartbeat) the comment frame at +14,000 and every 14,000 after, never more than 15,000 apart', () => {
    const r = rig();
    const id = create(r, 'c-1');
    const res = open(r, id, undefined);
    expect(HEARTBEAT_MS).toBe(14_000);
    expect(r.scheduler.pending()).toStrictEqual([START_MS + 14_000]);
    r.scheduler.runTo(START_MS + 13_999);
    expect(res.writes).toStrictEqual([]);
    r.scheduler.runTo(START_MS + 14_000);
    expect(res.chunks).toStrictEqual([HEARTBEAT_FRAME]);
    expect(HEARTBEAT_FRAME).toBe(':\n\n');
    r.scheduler.runTo(START_MS + 100_000);
    const times = res.writes.map((w) => w.at - START_MS);
    expect(times).toStrictEqual([14_000, 28_000, 42_000, 56_000, 70_000, 84_000, 98_000]);
    for (let i = 1; i < times.length; i += 1) expect((times[i] as number) - (times[i - 1] as number)).toBeLessThanOrEqual(15_000);
    expect(res.chunks.every((c) => c === HEARTBEAT_FRAME)).toBe(true);
  });

  it('FR-289 (f) (heartbeat) the heartbeat reaches every open stream, of every match, and carries no id', () => {
    const r = rig();
    const a = create(r, 'c-a');
    const b = create(r, 'c-b');
    const streams = [open(r, a, undefined), open(r, b, undefined), open(r, a, 0)];
    streams[2]!.writes.length = 0;
    r.scheduler.runTo(START_MS + 14_000);
    for (const s of streams) expect(s.chunks).toStrictEqual([':\n\n']);
    expect(r.scheduler.pending()).toStrictEqual([START_MS + 28_000]);
  });

  it('FR-289 (f) (heartbeat) none after the last stream closes, and the wake-up is cancelled', () => {
    const r = rig();
    const id = create(r, 'c-1');
    const one = open(r, id, undefined);
    const two = open(r, id, undefined);
    one.emit('close');
    expect(r.scheduler.pending()).toStrictEqual([START_MS + 14_000]);
    r.scheduler.runTo(START_MS + 14_000);
    expect(one.writes).toStrictEqual([]);
    expect(two.chunks).toStrictEqual([':\n\n']);
    two.emit('close');
    expect(r.scheduler.pending()).toStrictEqual([]);
    r.scheduler.runTo(START_MS + 200_000);
    expect(two.writes).toHaveLength(1);
    expect(r.hub.openCount()).toBe(0);
  });

  it('FR-289 (f) (heartbeat) a stream opened later does not move the wake-up', () => {
    const r = rig();
    const id = create(r, 'c-1');
    const first = open(r, id, undefined);
    r.h.clock.set(START_MS + 5_000);
    open(r, id, undefined);
    expect(r.scheduler.pending()).toStrictEqual([START_MS + 14_000]);
    first.emit('close');
    expect(r.scheduler.pending()).toStrictEqual([START_MS + 14_000]);
  });
});

describe('stream hub: slow clients, failures and closing', () => {
  it('FR-290 (stream, hub) a stream above 1 MiB buffered is destroyed before the next live write, and its lease is released once', () => {
    const r = rig();
    const id = create(r, 'c-1');
    expect(STREAM_BUFFER_LIMIT).toBe(1_048_576);
    const slow = open(r, id, undefined);
    const fine = open(r, id, undefined);
    slow.writableLength = STREAM_BUFFER_LIMIT + 1;
    step(r, id, 1, 'phase-1-close');
    expect(slow.writes).toStrictEqual([]);
    expect(slow.destroyed).toBe(1);
    expect(r.released).toStrictEqual([1, 0]);
    expect(fine.writes).toHaveLength(1);
    expect(r.hub.openCount()).toBe(1);
    slow.emit('close');
    expect(r.released).toStrictEqual([1, 0]);
    step(r, id, 1, 'phase-2-close');
    expect(slow.writes).toStrictEqual([]);
  });

  it('FR-290 (stream, hub) exactly 1 MiB buffered is still sent; the check also guards the heartbeat', () => {
    const r = rig({ bufferLimit: 100 });
    const id = create(r, 'c-1');
    const edge = open(r, id, undefined);
    const over = open(r, id, undefined);
    edge.writableLength = 100;
    over.writableLength = 101;
    r.scheduler.runTo(START_MS + 14_000);
    expect(edge.chunks).toStrictEqual([':\n\n']);
    expect(over.writes).toStrictEqual([]);
    expect(over.destroyed).toBe(1);
    expect(r.released).toStrictEqual([0, 1]);
  });

  it('FR-290 (stream, hub) a write that throws closes only that stream, releases its lease once and does not stop the others', () => {
    const r = rig();
    const id = create(r, 'c-1');
    const broken = open(r, id, undefined);
    const fine = open(r, id, undefined);
    broken.throwOnWrite = new Error('write failed');
    step(r, id, 1, 'phase-1-close');
    expect(broken.destroyed).toBe(1);
    expect(r.released).toStrictEqual([1, 0]);
    expect(fine.writes).toHaveLength(1);
    expect(r.hub.openCount()).toBe(1);
    broken.emit('close');
    expect(r.released).toStrictEqual([1, 0]);
    // The same through the heartbeat.
    fine.throwOnWrite = new Error('write failed');
    r.scheduler.runTo(START_MS + 14_000);
    expect(fine.destroyed).toBe(1);
    expect(r.released).toStrictEqual([1, 1]);
    expect(r.hub.openCount()).toBe(0);
  });

  it('FR-290 (stream, hub) the lease is released once per stream when its response closes, however often it reports it', () => {
    const r = rig();
    const id = create(r, 'c-1');
    const a = open(r, id, undefined);
    const b = open(r, id, undefined);
    expect(r.released).toStrictEqual([0, 0]);
    a.emit('close');
    a.emit('close');
    a.emit('error');
    expect(r.released).toStrictEqual([1, 0]);
    b.emit('error');
    b.emit('close');
    expect(r.released).toStrictEqual([1, 1]);
    expect(r.hub.openCount()).toBe(0);
  });

  it('FR-290 (stream, hub) the lease of a gauge returns its place when the stream closes', () => {
    const r = rig();
    const id = create(r, 'c-1');
    const gauge = createGauge();
    const opened = gauge.open([{ key: 'streams-address:x', limit: 1 }]);
    if (!opened.ok) throw new Error('gauge refused');
    const res = new FakeResponse(r.h.clock);
    expect(r.hub.open({ matchId: id, after: undefined, response: res, headers: HEADERS, lease: opened.lease }).ok).toBe(true);
    expect(gauge.open([{ key: 'streams-address:x', limit: 1 }])).toStrictEqual({ ok: false });
    res.emit('close');
    expect(gauge.count('streams-address:x')).toBe(0);
  });

  it('FR-290 (stream, hub) closeAll ends every stream once, releases the leases, cancels the heartbeat and unsubscribes', () => {
    const r = rig();
    const a = create(r, 'c-a');
    const b = create(r, 'c-b');
    const streams = [open(r, a, undefined), open(r, b, undefined), open(r, a, undefined)];
    expect(r.subscriptions.active).toBe(1);
    expect(r.scheduler.pending()).toHaveLength(1);
    r.hub.closeAll();
    expect(streams.map((s) => s.ended)).toStrictEqual([1, 1, 1]);
    expect(r.released).toStrictEqual([1, 1, 1]);
    expect(r.hub.openCount()).toBe(0);
    expect(r.scheduler.pending()).toStrictEqual([]);
    expect(r.subscriptions.active).toBe(0);
    step(r, a, 1, 'phase-1-close');
    expect(streams.every((s) => s.writes.length === 0)).toBe(true);
    // The responses report their close afterwards: nothing is released twice.
    for (const s of streams) s.emit('close');
    expect(r.released).toStrictEqual([1, 1, 1]);
    r.hub.closeAll();
    expect(streams.map((s) => s.ended)).toStrictEqual([1, 1, 1]);
  });

  it('FR-290 (stream, hub) after closeAll an open answers unavailable, writes nothing and keeps the lease with the caller', () => {
    const r = rig();
    const id = create(r, 'c-1');
    r.hub.closeAll();
    const res = new FakeResponse(r.h.clock);
    const lease: StreamLease = { release: () => void r.released.push(1) };
    expect(r.hub.open({ matchId: id, after: 0, response: res, headers: HEADERS, lease })).toStrictEqual({ ok: false, error: errorReply('unavailable') });
    expect(res.head).toBeUndefined();
    expect(res.writes).toStrictEqual([]);
    expect(r.released).toStrictEqual([]);
    expect(r.scheduler.pending()).toStrictEqual([]);
    expect(r.hub.openCount()).toBe(0);
  });

  it('FR-290 (stream, hub) a response whose replay write fails is closed at once and its lease released', () => {
    const r = rig();
    const id = create(r, 'c-1');
    const res = new FakeResponse(r.h.clock);
    res.throwOnWrite = new Error('socket gone');
    const out = open(r, id, 0, res);
    expect(out).toBe(res);
    expect(res.destroyed).toBe(1);
    expect(r.released).toStrictEqual([1]);
    expect(r.hub.openCount()).toBe(0);
    expect(r.scheduler.pending()).toStrictEqual([]);
  });
});
