import { stateText, type PublicMatch, encodeError } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import type { LiveModel } from '../src/core/live-model';
import { errorText } from '../src/core/live-text';
import { panelView } from '../src/core/live-view';
import { createLiveNet, type FetchLike, type LiveNet, type StreamEnd, type StreamHandlers } from '../src/ui/live-net';
import { startRunner, type LivePort, type LiveRunner } from '../src/ui/live-runner';
import type { After } from '../src/ui/live-timer';
import { sha256Hex } from '../src/ui/web-crypto';
import { DEV_PRESENTATION } from './helpers/dev-map';
import { createFakeServer, frameText, type FakeServer } from './helpers/fake-server';
import { MATCH_ID, eventsOfRound, lastSeqAt, scripted, type Scripted } from './helpers/scripted-match';

const BASE = 'http://server.test';
const factions = DEV_PRESENTATION.factions.map((f) => ({ id: f.id, name: f.name }));

/** A manual clock and scheduler: timers fire only when the test advances time. */
class Clock {
  time = 10_000;
  private timers: { at: number; fn: () => void; live: boolean }[] = [];
  armed = 0;
  cancelled = 0;
  readonly now = (): number => this.time;
  readonly after: After = (ms, fn) => {
    const timer = { at: this.time + ms, fn, live: true };
    this.timers.push(timer);
    this.armed++;
    return () => {
      if (timer.live) this.cancelled++;
      timer.live = false;
    };
  };
  active(): number {
    return this.timers.filter((t) => t.live).length;
  }
  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.live && t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      due.live = false;
      this.time = Math.max(this.time, due.at);
      due.fn();
      await settle();
    }
    this.time = target;
  }
}

/** Lets pending promises and the fake server's streams run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A scene that records what the runner tells it. */
class RecordingPort implements LivePort {
  opens: { match: PublicMatch; bytes: number }[] = [];
  draws: number[] = [];
  steps: { from: number; to: number; eliminated: number; absorber: number }[] = [];
  shows: { model: LiveModel; at: number }[] = [];
  failures: string[] = [];
  /** The round the address asks for, by default N (like an address without a round). */
  roundAsked: ((applied: number) => number) | undefined;
  async open(match: PublicMatch, files: { [name: string]: Uint8Array }): Promise<{ ok: true; round: number }> {
    this.opens.push({ match, bytes: Object.values(files).reduce((sum, f) => sum + f.byteLength, 0) });
    return { ok: true, round: this.roundAsked === undefined ? match.appliedRounds : this.roundAsked(match.appliedRounds) };
  }
  draw(round: number): void {
    this.draws.push(round);
  }
  playStep(from: number, to: number, data: { eliminated: number; absorber: number }): void {
    this.steps.push({ from, to, eliminated: data.eliminated, absorber: data.absorber });
  }
  show(model: LiveModel, at: number): void {
    this.shows.push({ model, at });
  }
  fail(message: string): void {
    this.failures.push(message);
  }
}

interface Harness {
  s: Scripted;
  server: FakeServer;
  clock: Clock;
  port: RecordingPort;
  runner: LiveRunner;
}

interface Options {
  n?: number;
  matchId?: string;
  fetch?: (server: FakeServer) => FetchLike;
  net?: (base: LiveNet) => LiveNet;
  digest?: (bytes: Uint8Array) => Promise<string>;
  server?: (server: FakeServer) => void;
  port?: (port: RecordingPort) => void;
  netDigest?: { available(): boolean; sha256Hex(bytes: Uint8Array): Promise<string> };
}

async function launch(options: Options = {}): Promise<Harness> {
  const s = await scripted();
  const server = await createFakeServer(s, options.n ?? 0);
  options.server?.(server);
  const clock = new Clock();
  const port = new RecordingPort();
  options.port?.(port);
  const fetchLike = options.fetch === undefined ? server.fetch : options.fetch(server);
  const base = createLiveNet({ base: BASE, fetch: fetchLike, ...(options.netDigest === undefined ? {} : { digest: options.netDigest }) });
  const runner = startRunner({
    matchId: options.matchId ?? MATCH_ID,
    net: options.net === undefined ? base : options.net(base),
    port,
    now: clock.now,
    after: clock.after,
    ...(options.digest === undefined ? {} : { digest: options.digest }),
  });
  await settle();
  return { s, server, clock, port, runner };
}

/** Pushes the events of rounds `from` to `to` one round at a time, as the server publishes them. */
async function playRounds(h: Harness, from: number, to: number): Promise<void> {
  for (let k = from; k <= to; k++) {
    h.server.n = k;
    for (const event of eventsOfRound(h.s, k)) h.server.push(frameText(event));
    await settle();
  }
}

const mapRequests = (h: Harness): string[] => h.server.requests.filter((r) => r.path.startsWith('/maps/')).map((r) => r.path);

describe('FR-303 (shell) the runner shows a whole match', () => {
  it('FR-303 (shell) a match from round 0 to T: N drawn at load, one step per applied round, the stream closed at the finish', async () => {
    const h = await launch();
    expect(h.port.opens).toHaveLength(1);
    expect(h.port.draws).toStrictEqual([0]);
    expect(h.server.streams()).toBe(1);
    const open = h.server.requests.filter((r) => r.path.endsWith('/events'));
    expect(open.map((r) => r.query)).toStrictEqual([`?lastEventId=${lastSeqAt(0)}`]);
    await playRounds(h, 1, h.s.total);
    expect(h.port.steps.map((x) => [x.from, x.to])).toStrictEqual(Array.from({ length: h.s.total }, (_, i) => [i, i + 1]));
    h.s.records.forEach((record, i) => {
      expect(h.port.steps[i]?.eliminated).toBe(record.eliminated);
      expect(h.port.steps[i]?.absorber).toBe(record.absorber);
    });
    expect(h.port.draws).toStrictEqual([0]);
    const model = h.runner.model();
    expect(model.stage).toBe('finished');
    expect(model.applied).toBe(h.s.total);
    expect(model.displayed).toBe(h.s.total);
    expect(h.port.failures).toStrictEqual([]);
    // Finished: the stream is closed, not reopened, and no timer is left.
    const streams = h.server.streams();
    await h.clock.advance(120_000);
    expect(h.server.streams()).toBe(streams);
    expect(h.clock.active()).toBe(0);
    expect(panelView(model, h.clock.now(), factions).winner).toContain('Ganadora');
    // The client half of "future rounds never reach the client": no state or record request names a round above the N of its time.
    for (const r of h.server.requests) if (r.round !== undefined) expect(r.round).toBeLessThanOrEqual(h.s.total);
  });

  it('FR-303 (shell) a state is hashed with the canonical text through the injected digest, and a failing digest falls back to the server state', async () => {
    const seen: string[] = [];
    const h = await launch({
      digest: async (bytes) => {
        seen.push(new TextDecoder().decode(bytes));
        return sha256Hex(bytes);
      },
    });
    await playRounds(h, 1, 2);
    expect(seen).toStrictEqual([1, 2].map((k) => stateText({ mode: 'classic', round: k, owners: h.s.states[k] as never })));
    expect(h.port.steps).toHaveLength(2);

    const broken = await launch({
      digest: async () => {
        throw new Error('no digest');
      },
    });
    broken.server.n = 1;
    for (const event of eventsOfRound(broken.s, 1)) broken.server.push(frameText(event));
    await settle();
    // The announced round is read from the server and drawn at once (no step on an unverified state).
    expect(broken.server.requests.some((r) => r.path.endsWith('/states/1'))).toBe(true);
    expect(broken.port.steps).toStrictEqual([]);
    expect(broken.port.draws).toStrictEqual([0, 1]);
  });

  it('FR-304 (shell) the address round is read and drawn (D31); an applied round while browsing an earlier one updates N and plays no step (D32)', async () => {
    const h = await launch({ n: 3, port: (p) => (p.roundAsked = () => 1) });
    expect(h.port.draws).toStrictEqual([1]);
    expect(h.server.requests.filter((r) => r.round !== undefined).map((r) => [r.path.split('/')[3], r.round])).toStrictEqual([['states', 1]]);
    await playRounds(h, 4, 4);
    expect(h.port.steps).toStrictEqual([]);
    expect(h.port.draws).toStrictEqual([1]);
    const model = h.runner.model();
    expect(model.applied).toBe(4);
    expect(model.displayed).toBe(1);
    expect(panelView(model, h.clock.now(), factions).controls?.nextDisabled).toBe(false);
    for (const r of h.server.requests) if (r.round !== undefined) expect(r.round).toBeLessThanOrEqual(3);
  });

  it('FR-304 (shell) stepping back over an applied round reads that round and its record, then plays the step backwards', async () => {
    const h = await launch({ n: 2 });
    h.runner.navigate('previous');
    await settle();
    expect(h.port.steps.map((x) => [x.from, x.to])).toStrictEqual([[2, 1]]);
    expect(h.server.requests.filter((r) => r.round !== undefined).map((r) => [r.path.split('/')[3], r.round]).sort()).toStrictEqual([['records', 2], ['states', 1]]);
    expect(h.runner.model().displayed).toBe(1);
  });
});

describe('FR-308 (shell) the map files are verified once, before the first public input', () => {
  it('FR-308 (shell) the three files are read once, after the public data and before anything is drawn, also after a resync', async () => {
    const h = await launch({ n: 1 });
    const order = h.server.requests.map((r) => r.path.replace(MATCH_ID, 'ID'));
    expect(order.slice(0, 4)).toStrictEqual(['/matches/ID', '/maps/dev/map.json', '/maps/dev/ids.png', '/maps/dev/presentation.json']);
    expect(h.port.opens).toHaveLength(1);
    expect(h.port.draws).toStrictEqual([1]);
    // A frame with a gap makes the model resync: the public data is read again, the map files are not.
    h.server.push(frameText({ ...(eventsOfRound(h.s, 2)[0] as object), seq: lastSeqAt(1) + 5 }));
    await settle();
    await h.clock.advance(1000);
    expect(h.server.requests.filter((r) => r.path === `/matches/${MATCH_ID}`)).toHaveLength(2);
    expect(mapRequests(h)).toHaveLength(3);
    expect(h.port.opens).toHaveLength(1);
    expect(h.server.streams()).toBe(2);
    expect(h.port.failures).toStrictEqual([]);
  });

  it('FR-308 (shell) a served file changed by one byte: nothing is drawn, no public input is fed and digest-mismatch is shown', async () => {
    const h = await launch({ n: 1, server: (server) => (server.files['ids.png'] = Uint8Array.from(server.files['ids.png'], (b, i) => (i === 40 ? b ^ 1 : b))) });
    expect(h.port.failures).toStrictEqual([errorText('digest-mismatch')]);
    expect(h.port.opens).toStrictEqual([]);
    expect(h.port.draws).toStrictEqual([]);
    expect(h.port.shows).toStrictEqual([]);
    expect(h.runner.model().phase).toBe('loading');
    expect(h.runner.model().mapDigest).toBe('');
    expect(h.server.streams()).toBe(0);
    expect(h.server.requests.some((r) => r.path.endsWith('/events') || r.round !== undefined)).toBe(false);
    expect(h.clock.active()).toBe(0);
  });

  it('FR-308 (shell) no digest function: insecure-origin is shown before any request and nothing is drawn', async () => {
    const h = await launch({ n: 1, netDigest: { available: () => false, sha256Hex } });
    expect(h.port.failures).toStrictEqual([errorText('insecure-origin')]);
    expect(h.server.requests).toStrictEqual([]);
    expect(h.port.draws).toStrictEqual([]);
    expect(h.runner.model().phase).toBe('loading');
  });

  it('FR-308 (shell) a failed map file read is retried by the schedule; until it succeeds nothing is drawn and no public input is fed', async () => {
    let failuresLeft = 2;
    const h = await launch({
      n: 1,
      fetch: (server) => (url, init) => (url.includes('/maps/') && failuresLeft-- > 0 ? Promise.reject(new TypeError('network')) : server.fetch(url, init)),
    });
    expect(h.port.draws).toStrictEqual([]);
    expect(h.port.opens).toStrictEqual([]);
    expect(h.runner.model().phase).toBe('loading');
    expect(h.runner.model().mapDigest).toBe('');
    expect(h.runner.model().wait).not.toBeUndefined();
    expect(h.clock.active()).toBeGreaterThan(0);
    await h.clock.advance(1000);
    expect(h.port.draws).toStrictEqual([]);
    await h.clock.advance(2000);
    expect(h.port.opens).toHaveLength(1);
    expect(h.port.draws).toStrictEqual([1]);
    expect(h.port.failures).toStrictEqual([]);
  });

  it('FR-308 (shell) a map file of an unknown match ends the scene, and a public read that announces another digest later is refused', async () => {
    const gone = await launch({
      n: 1,
      fetch: (server) => (url, init) =>
        url.includes('/maps/') ? Promise.resolve(new Response(encodeError({ kind: 'unknown-match' }), { status: 404 })) : server.fetch(url, init),
    });
    expect(gone.port.failures).toStrictEqual([errorText('unknown-match')]);
    expect(gone.port.draws).toStrictEqual([]);

    const h = await launch({ n: 1 });
    h.server.publicExtra = { mapDigest: 'b'.repeat(64) };
    h.server.push(frameText({ ...(eventsOfRound(h.s, 2)[0] as object), seq: lastSeqAt(1) + 5 }));
    await settle();
    await h.clock.advance(1000);
    expect(h.port.failures).toStrictEqual([errorText('digest-mismatch')]);
    expect(h.port.opens).toHaveLength(1);
  });

  it('FR-303 (shell) a scene port that throws while opening ends the scene with the failure notice instead of stalling', async () => {
    const h = await launch({
      n: 1,
      port: (port) => {
        port.open = () => Promise.reject(new Error('webgl'));
      },
    });
    expect(h.port.failures).toStrictEqual([errorText('failure')]);
    expect(h.port.draws).toStrictEqual([]);
    expect(h.server.streams()).toBe(0);
    expect(h.clock.active()).toBe(0);
  });

  it('FR-303 (shell) a digest function that throws while the map files are checked ends the scene with the failure notice', async () => {
    const h = await launch({
      n: 1,
      netDigest: { available: () => true, sha256Hex: () => Promise.reject(new Error('subtle')) },
    });
    expect(h.port.failures).toStrictEqual([errorText('failure')]);
    expect(h.port.opens).toStrictEqual([]);
    expect(h.clock.active()).toBe(0);
  });

  it('FR-303 (shell) a stream that cannot be opened ends the scene with the failure notice, once', async () => {
    const h = await launch({
      n: 1,
      net: (base) => ({ ...base, openStream: () => Promise.reject(new Error('stream')) }),
    });
    expect(h.port.opens).toHaveLength(1);
    expect(h.port.failures).toStrictEqual([errorText('failure')]);
    expect(h.clock.active()).toBe(0);
  });

  it('FR-303 (shell) a state read that throws ends the scene with the failure notice', async () => {
    const h = await launch({ n: 2, net: (base) => ({ ...base, readState: () => Promise.reject(new Error('state')) }) });
    expect(h.port.failures).toStrictEqual([]);
    h.runner.navigate('previous');
    await settle();
    expect(h.port.failures).toStrictEqual([errorText('failure')]);
    expect(h.clock.active()).toBe(0);
  });

  it('FR-303 (shell) a record read that throws ends the scene with the failure notice', async () => {
    const h = await launch({ n: 2, net: (base) => ({ ...base, readRecord: () => Promise.reject(new Error('record')) }) });
    h.runner.navigate('previous');
    await settle();
    expect(h.port.failures).toStrictEqual([errorText('failure')]);
    expect(h.clock.active()).toBe(0);
  });

  it('FR-307 (shell) an unknown match shows its message and starts nothing', async () => {
    const h = await launch({ matchId: 'ZzZzZzZzZzZzZzZz' });
    expect(h.port.failures).toStrictEqual([errorText('unknown-match')]);
    expect(h.port.opens).toStrictEqual([]);
    expect(h.port.draws).toStrictEqual([]);
    expect(h.server.streams()).toBe(0);
    expect(h.clock.active()).toBe(0);
  });
});

describe('FR-307 (shell) timers, reconnection and stream ownership', () => {
  it('FR-307 (shell) one retry timer with replace semantics: a new arm cancels the pending one', async () => {
    const h = await launch({ n: 1 });
    // Manual timing: no refresh timer, so the only timer is the watchdog armed when the stream opened.
    expect(h.clock.active()).toBe(1);
    expect(h.clock.armed).toBe(1);
    h.server.fail();
    await settle();
    // The stream dropped, the reconnection opened a new one at once, and its `opened` armed a new watchdog in place of the old.
    expect(h.server.streams()).toBe(2);
    expect(h.clock.armed).toBe(2);
    expect(h.clock.cancelled).toBe(1);
    expect(h.clock.active()).toBe(1);
  });

  it('FR-307 (shell) the server down: the notice shows, the last round stays, the reconnection sends the header, no gap and no duplicate', async () => {
    let down = 0;
    const h = await launch({
      n: 1,
      fetch: (server) => (url, init) => (url.endsWith('/events') && down > 0 ? (down--, Promise.reject(new TypeError('network'))) : server.fetch(url, init)),
    });
    await playRounds(h, 2, 2);
    expect(h.port.steps.map((x) => x.to)).toStrictEqual([2]);
    down = 2;
    h.server.fail();
    await settle();
    const waiting = h.runner.model();
    expect(waiting.wait).not.toBeUndefined();
    expect(panelView(waiting, h.clock.now(), factions).notice).toContain('Sin conexión');
    expect(h.port.draws).toStrictEqual([1]);
    await h.clock.advance(1000);
    await h.clock.advance(2000);
    const events = h.server.requests.filter((r) => r.path.endsWith('/events'));
    const last = events[events.length - 1];
    expect(last?.headers['last-event-id']).toBe(String(lastSeqAt(2)));
    expect(last?.query).toBe('');
    expect(events.slice(1).every((r) => r.query === '' && r.headers['last-event-id'] === String(lastSeqAt(2)))).toBe(true);
    expect(h.runner.model().wait).toBeUndefined();
    // The replay after the header continues without a gap: the next round arrives once.
    h.server.n = 3;
    for (const event of eventsOfRound(h.s, 2)) h.server.push(frameText(event));
    for (const event of eventsOfRound(h.s, 3)) h.server.push(frameText(event));
    await settle();
    expect(h.port.steps.map((x) => x.to)).toStrictEqual([2, 3]);
    expect(panelView(h.runner.model(), h.clock.now(), factions).notice).toBeUndefined();
  });

  it('FR-307 (shell) the callbacks of a stale stream are ignored and the old stream is aborted', async () => {
    const opened: { handlers: StreamHandlers; signal: AbortSignal; finish(end: StreamEnd): void }[] = [];
    const h = await launch({
      n: 1,
      net: (base) => ({
        ...base,
        openStream: (_id, _start, handlers, signal) =>
          new Promise<StreamEnd>((resolve) => void opened.push({ handlers, signal, finish: resolve })),
      }),
    });
    expect(opened).toHaveLength(1);
    opened[0]?.handlers.opened();
    const first = eventsOfRound(h.s, 2)[0];
    // The first stream ends: the runner reconnects at once, with a new stream.
    opened[0]?.finish({ type: 'dropped' });
    await settle();
    expect(opened).toHaveLength(2);
    expect(opened[0]?.signal.aborted).toBe(true);
    // A late frame of the old stream changes nothing.
    opened[0]?.handlers.frame(first);
    opened[0]?.handlers.bytes();
    const lastSeq = h.runner.model().lastSeq;
    expect(lastSeq).toBe(lastSeqAt(1));
    opened[1]?.handlers.opened();
    opened[1]?.handlers.frame(first);
    expect(h.runner.model().lastSeq).toBe(lastSeqAt(1) + 1);
    expect(opened).toHaveLength(2);
  });

  it('FR-307 (shell) a failed stream waits by the schedule and honours Retry-After', async () => {
    const opened: { finish(end: StreamEnd): void }[] = [];
    const h = await launch({
      n: 1,
      net: (base) => ({ ...base, openStream: () => new Promise<StreamEnd>((resolve) => void opened.push({ finish: resolve })) }),
    });
    const at = h.clock.now();
    opened[0]?.finish({ type: 'failed', failure: { ok: false, outcome: 'retry', retryAfterMs: 7000 } });
    await settle();
    expect(h.runner.model().wait?.until).toBe(at + 7000);
    await h.clock.advance(6999);
    expect(opened).toHaveLength(1);
    await h.clock.advance(1);
    expect(opened).toHaveLength(2);
  });

  it('FR-305 (shell) the panel refreshes once per second from the reported-time estimate, not from the last reported value alone', async () => {
    const h = await launch({
      n: 1,
      server: (server) => (server.publicExtra = { timing: { i: 120, l1: 30, l2: 10 }, schedule: { c1: 65_000, c2: 125_000, a: 305_000 } }),
    });
    const start = h.clock.now();
    const countdown = (): string | undefined => panelView(h.runner.model(), h.clock.now(), factions).countdown;
    expect(countdown()).toBe('Próximo paso en 1:00');
    const before = h.port.shows.length;
    await h.clock.advance(3500);
    const refreshed = h.port.shows.slice(before);
    expect(refreshed.map((x) => x.at)).toStrictEqual([start + 1000, start + 2000, start + 3000]);
    expect(panelView(refreshed[2]!.model, refreshed[2]!.at, factions).countdown).toBe('Próximo paso en 0:57');
    expect(countdown()).toBe('Próximo paso en 0:57');
    // A manual match has no countdown and no refresh timer.
    const manual = await launch({ n: 1 });
    const shows = manual.port.shows.length;
    await manual.clock.advance(5000);
    expect(manual.port.shows.length).toBe(shows);
  });
});
