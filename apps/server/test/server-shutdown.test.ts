import { EventEmitter } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { connect } from 'node:net';
import type { Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { LogEvent } from '../src/http/log';
import type { Route } from '../src/http/router';
import { createShutdown, wireProcess } from '../src/http/shutdown';
import type { Shutdown } from '../src/http/shutdown';
import { SHUTDOWN_GRACE_MS } from '../src/service/settings';
import { openStore } from '../src/store/sqlite';
import { fakeScheduler } from './helpers/fake-scheduler';
import { request } from './helpers/http-client';
import { closeAllServers, startServer } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { makeMatch, withTempDirAsync } from './helpers/http-reads-kit';
import { OPERATOR, creationBody } from './helpers/service-harness';
import { openStream } from './helpers/sse-reader';
import type { SseReader } from './helpers/sse-reader';
import { productionRoutes } from '../src/http/server';

// NFR-54 (logs) and FR-239 (wired): the graceful shutdown, in process, with a real listener and fakes for the scheduler, the
// clock, `exit` and the process emitter. The real-signal test (a child process) is in server-main.test.ts, POSIX only.

afterEach(closeAllServers);

const PLANTED = 'planted-secret-value-7f3a9c';

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

interface Rig {
  readonly h: ServerHarness;
  readonly scheduler: ReturnType<typeof fakeScheduler>;
  readonly shutdown: Shutdown;
  readonly exits: number[];
  readonly events: LogEvent[];
  readonly closeCalls: { count: number };
  readonly entered: Promise<void>;
  readonly release: () => void;
}

/** A listener with a fast route and a slow one (held until `release`), and a shutdown over fakes. */
async function rig(options: { store?: ReturnType<typeof openStore> } = {}): Promise<Rig> {
  const gate = deferred();
  const entered = deferred();
  const ok = { kind: 'success' as const, status: 200 as const, body: '{"ok":true}' };
  const routes = (): Route[] => [
    { method: 'GET', path: '/ping', body: 'none', decide: () => ok },
    {
      method: 'GET',
      path: '/slow',
      body: 'none',
      decide: async () => {
        entered.resolve();
        await gate.promise;
        return ok;
      },
    },
  ];
  const h = await startServer({
    routes,
    service: { scheduler: true },
    ...(options.store === undefined ? {} : { wrapStore: (inner) => (inner.close(), options.store!) }),
  });
  const scheduler = h.base.scheduler!;
  const exits: number[] = [];
  const events: LogEvent[] = [];
  const closeCalls = { count: 0 };
  const service = {
    close: () => {
      closeCalls.count += 1;
      h.service.close();
    },
  };
  const shutdown = createShutdown({ server: h.server, service, scheduler, clock: h.clock, log: (e) => void events.push(e), exit: (code) => void exits.push(code), graceMs: SHUTDOWN_GRACE_MS });
  return { h, scheduler, shutdown, exits, events, closeCalls, entered: entered.promise, release: gate.resolve };
}

/** A keep-alive HTTP/1.1 exchange on a raw socket; `closed` resolves when the server closes the connection. */
function keepAlive(port: number, path: string): { socket: Socket; replied: Promise<string>; closed: Promise<void> } {
  const socket = connect({ host: '127.0.0.1', port });
  let text = '';
  let done: (value: string) => void = () => undefined;
  const replied = new Promise<string>((resolve) => (done = resolve));
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  socket.on('error', () => undefined);
  socket.on('data', (chunk: Buffer) => {
    text += chunk.toString('latin1');
    const split = text.indexOf('\r\n\r\n');
    const length = Number(/content-length: (\d+)/i.exec(text)?.[1]);
    if (split >= 0 && Number.isFinite(length) && text.length - split - 4 >= length) done(text);
  });
  socket.on('connect', () => socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n`));
  return { socket, replied, closed };
}

const refused = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

describe('graceful shutdown', () => {
  it('NFR-54 (logs) stops accepting, logs the start and the end, closes the service once and exits with 0', async () => {
    const r = await rig();
    expect((await request(r.h.port, { path: '/ping' })).status).toBe(200);
    r.shutdown.begin('SIGTERM', 0);
    await flush();
    expect(r.events).toStrictEqual([{ event: 'shutdown-start', reason: 'SIGTERM' }, { event: 'shutdown-done', forced: false }]);
    expect(r.exits).toStrictEqual([0]);
    expect(r.closeCalls.count).toBe(1);
    expect(r.shutdown.phase()).toBe('done');
    expect(await refused(r.h.port)).toBe(true);
    // The store is closed: a read through it fails.
    expect(() => r.h.base.store.runningCount()).toThrow();
  });

  it('FR-239 (wired) service.close() cancels every wake-up and releases the file, which can then be opened again', async () => {
    await withTempDirAsync(async (dir) => {
      const file = `${dir}/shutdown.sqlite`;
      const r = await rig({ store: openStore(file) });
      const made = r.h.service.create({ credential: OPERATOR, body: creationBody('c-1') });
      expect(made.ok).toBe(true);
      expect(r.scheduler.pending().length).toBeGreaterThan(0);
      r.shutdown.begin('SIGINT', 0);
      await flush();
      expect(r.scheduler.pending()).toStrictEqual([]);
      expect(r.exits).toStrictEqual([0]);
      const again = openStore(file);
      try {
        expect(again.runningMatchIds()).toHaveLength(1);
      } finally {
        again.close();
      }
    });
  });

  it('NFR-54 (logs) closes an idle keep-alive connection at once, not at its timeout', async () => {
    const r = await rig();
    const idle = keepAlive(r.h.port, '/ping');
    expect(await idle.replied).toContain('200');
    r.shutdown.begin('SIGTERM', 0);
    await idle.closed;
    await flush();
    expect(r.exits).toStrictEqual([0]);
    expect(r.events.at(-1)).toStrictEqual({ event: 'shutdown-done', forced: false });
  });

  it('NFR-54 (logs) waits for a request in flight, lets it finish, then closes its connection and exits without forcing', async () => {
    const r = await rig();
    const slow = keepAlive(r.h.port, '/slow');
    await r.entered;
    r.shutdown.begin('SIGTERM', 0);
    await flush();
    expect(r.exits).toStrictEqual([]);
    expect(r.shutdown.phase()).toBe('closing');
    expect(r.closeCalls.count).toBe(0);
    expect(r.scheduler.pending()).toStrictEqual([r.h.clock.now() + SHUTDOWN_GRACE_MS]);
    r.release();
    expect(await slow.replied).toContain('200 OK');
    await slow.closed;
    await flush();
    expect(r.exits).toStrictEqual([0]);
    expect(r.events.at(-1)).toStrictEqual({ event: 'shutdown-done', forced: false });
    expect(r.scheduler.pending()).toStrictEqual([]);
  });

  it('NFR-54 (logs) a request still running when the grace period ends is cut, and the shutdown ends forced', async () => {
    const r = await rig();
    const slow = keepAlive(r.h.port, '/slow');
    await r.entered;
    r.shutdown.begin('SIGTERM', 0);
    r.scheduler.runTo(r.h.clock.now() + SHUTDOWN_GRACE_MS - 1);
    await flush();
    expect(r.exits).toStrictEqual([]);
    r.scheduler.runTo(r.h.clock.now() + 1);
    await slow.closed;
    expect(r.exits).toStrictEqual([0]);
    expect(r.events.at(-1)).toStrictEqual({ event: 'shutdown-done', forced: true });
    expect(r.closeCalls.count).toBe(1);
    r.release();
  });

  it('NFR-54 (logs) a second signal forces the exit at once with 1, and the service is still closed exactly once', async () => {
    const r = await rig();
    const slow = keepAlive(r.h.port, '/slow');
    await r.entered;
    r.shutdown.begin('SIGINT', 0);
    r.shutdown.begin('SIGINT', 0);
    await slow.closed;
    expect(r.exits).toStrictEqual([1]);
    expect(r.events.map((e) => e.event)).toStrictEqual(['shutdown-start', 'shutdown-forced']);
    expect(r.closeCalls.count).toBe(1);
    // Later triggers change nothing (idempotent).
    r.shutdown.begin('SIGTERM', 0);
    r.scheduler.fireAll();
    expect(r.exits).toStrictEqual([1]);
    expect(r.closeCalls.count).toBe(1);
    r.release();
  });

  it('NFR-54 (logs) a shutdown before the listener ever listened (a listen failure) closes the service and exits with its code', () => {
    const server = createHttpServer();
    const exits: number[] = [];
    const events: LogEvent[] = [];
    let closed = 0;
    const fake = fakeScheduler({ now: () => 0 } as never);
    const shutdown = createShutdown({ server, service: { close: () => void (closed += 1) }, scheduler: fake, clock: { now: () => 0 }, log: (e) => void events.push(e), exit: (c) => void exits.push(c), graceMs: 5000 });
    shutdown.begin('listen-failed', 1);
    expect(exits).toStrictEqual([1]);
    expect(closed).toBe(1);
    expect(events).toStrictEqual([{ event: 'shutdown-start', reason: 'listen-failed' }, { event: 'shutdown-done', forced: false }]);
    expect(fake.pending()).toStrictEqual([]);
  });

  it('NFR-54 (logs) a service that fails to close is logged as fatal (name only) and the exit code is 1', () => {
    const server = createHttpServer();
    const exits: number[] = [];
    const events: LogEvent[] = [];
    const fake = fakeScheduler({ now: () => 0 } as never);
    const shutdown = createShutdown({
      server,
      service: {
        close: () => {
          throw new RangeError(`cannot close ${PLANTED}`);
        },
      },
      scheduler: fake,
      clock: { now: () => 0 },
      log: (e) => void events.push(e),
      exit: (c) => void exits.push(c),
      graceMs: 5000,
    });
    shutdown.begin('SIGTERM', 0);
    expect(exits).toStrictEqual([1]);
    expect(events).toContainEqual({ event: 'fatal', source: 'shutdown', error: { name: 'RangeError' } });
    expect(JSON.stringify(events)).not.toContain(PLANTED);
  });
});

describe('process wiring', () => {
  const fakeShutdown = (): { shutdown: Shutdown; calls: [string, number][] } => {
    const calls: [string, number][] = [];
    return { calls, shutdown: { begin: (reason, code) => void calls.push([reason, code]), phase: () => 'running' } };
  };

  it('NFR-54 (logs) SIGINT and SIGTERM start a shutdown that exits with 0', () => {
    const proc = new EventEmitter();
    const { shutdown, calls } = fakeShutdown();
    wireProcess(proc, shutdown, () => undefined);
    proc.emit('SIGINT');
    proc.emit('SIGTERM');
    expect(calls).toStrictEqual([['SIGINT', 0], ['SIGTERM', 0]]);
  });

  it('NFR-54 (logs) an uncaught exception and an unhandled rejection log fatal with the closed description and shut down with 1', () => {
    const proc = new EventEmitter();
    const { shutdown, calls } = fakeShutdown();
    const events: LogEvent[] = [];
    wireProcess(proc, shutdown, (e) => void events.push(e));
    proc.emit('uncaughtException', new TypeError(`bad ${PLANTED}`));
    proc.emit('unhandledRejection', PLANTED);
    expect(events).toStrictEqual([
      { event: 'fatal', source: 'uncaughtException', error: { name: 'TypeError' } },
      { event: 'fatal', source: 'unhandledRejection', error: { name: 'NonError' } },
    ]);
    expect(calls).toStrictEqual([['fatal', 1], ['fatal', 1]]);
    expect(JSON.stringify(events)).not.toContain(PLANTED);
  });

  it('NFR-54 (logs) through the real shutdown, SIGTERM then SIGTERM forces and a fatal error during a shutdown forces too', async () => {
    const r = await rig();
    const proc = new EventEmitter();
    wireProcess(proc, r.shutdown, (e) => void r.events.push(e));
    const slow = keepAlive(r.h.port, '/slow');
    await r.entered;
    proc.emit('SIGTERM');
    expect(r.exits).toStrictEqual([]);
    proc.emit('uncaughtException', new Error(PLANTED));
    await slow.closed;
    expect(r.exits).toStrictEqual([1]);
    expect(r.events.map((e) => e.event)).toStrictEqual(['shutdown-start', 'fatal', 'shutdown-forced']);
    expect(r.closeCalls.count).toBe(1);
    r.release();
  });
});

describe('graceful shutdown with open event streams', () => {
  const readers: SseReader[] = [];
  afterEach(() => {
    for (const reader of readers.splice(0, readers.length)) reader.close();
  });

  /** A listener with the production routes plus a slow route (held until `release`), and a shutdown wired to the stream hub. */
  async function streamRig(): Promise<Rig & { id: string }> {
    const gate = deferred();
    const entered = deferred();
    const slow: Route = {
      method: 'GET',
      path: '/slow',
      body: 'none',
      decide: async () => {
        entered.resolve();
        await gate.promise;
        return { kind: 'success', status: 200, body: '{"ok":true}' };
      },
    };
    const h = await startServer({ routes: (service, settings) => [...productionRoutes(service, settings), slow], service: { scheduler: true }, limits: { anonymous: 100_000, reads: 100_000 } });
    const scheduler = h.base.scheduler!;
    const exits: number[] = [];
    const events: LogEvent[] = [];
    const closeCalls = { count: 0 };
    const service = { close: () => (closeCalls.count += 1, h.service.close()) };
    const shutdown = createShutdown({ server: h.server, service, scheduler, clock: h.clock, log: (e) => void events.push(e), exit: (code) => void exits.push(code), graceMs: SHUTDOWN_GRACE_MS, streams: h.streams });
    return { h, scheduler, shutdown, exits, events, closeCalls, entered: entered.promise, release: gate.resolve, id: makeMatch(h).id };
  }

  const openThree = async (r: Rig & { id: string }): Promise<SseReader[]> => {
    const three: SseReader[] = [];
    for (let i = 0; i < 3; i += 1) {
      const reader = await openStream({ port: r.h.port, path: `/matches/${r.id}/events?lastEventId=0` });
      readers.push(reader);
      three.push(reader);
      expect(reader.status).toBe(200);
    }
    return three;
  };

  /** Rejects when the promise does not settle within `ms` of real time (a shutdown that waits for the grace). */
  const within = <T>(promise: Promise<T>, ms: number, what: string): Promise<T> =>
    Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out: ${what}`)), ms))]);

  it('FR-289 (stream, shutdown and restart) NFR-52 (network) three open streams and no request in flight: the shutdown ends them, finishes before the grace without forcing, and cancels the heartbeat', async () => {
    const r = await streamRig();
    const three = await openThree(r);
    expect(r.h.streams.openCount()).toBe(3);
    expect(r.h.scheduler.pending()).toHaveLength(1);
    r.shutdown.begin('SIGTERM', 0);
    await within(Promise.all(three.map((reader) => reader.ended)), 3000, 'the streams to end');
    await within(new Promise<void>((resolve) => { const t = setInterval(() => { if (r.exits.length > 0) { clearInterval(t); resolve(); } }, 10); }), 3000, 'the exit');
    expect(r.events).toStrictEqual([{ event: 'shutdown-start', reason: 'SIGTERM' }, { event: 'shutdown-done', forced: false }]);
    expect(r.exits).toStrictEqual([0]);
    expect(r.closeCalls.count).toBe(1);
    expect(r.h.scheduler.pending()).toStrictEqual([]);
    expect(r.h.streams.openCount()).toBe(0);
    // The grace period was never reached and the readers saw a clean end: the frame they got is the creation event only.
    for (const reader of three) {
      expect(reader.raw().startsWith('id: 1\ndata: {"type":"schedule"')).toBe(true);
      expect(reader.raw().match(/\n\n/g)).toHaveLength(1);
    }
    expect(await refused(r.h.port)).toBe(true);
  }, 30_000);

  it('FR-289 (stream, shutdown and restart) a stream opened on a kept-alive connection while the shutdown runs is a 503 unavailable, and a request in flight still gets its grace', async () => {
    const r = await streamRig();
    const one = await openStream({ port: r.h.port, path: `/matches/${r.id}/events` });
    readers.push(one);
    // A slow request in flight on a raw connection, then the shutdown, then a stream request on the SAME connection.
    const socket = connect({ host: '127.0.0.1', port: r.h.port });
    let text = '';
    socket.on('error', () => undefined);
    socket.on('data', (chunk: Buffer) => (text += chunk.toString('latin1')));
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
    socket.write('GET /slow HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n');
    await r.entered;
    r.shutdown.begin('SIGTERM', 0);
    await within(one.ended, 3000, 'the open stream to end');
    socket.write(`GET /matches/${r.id}/events HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n`);
    await flush();
    // The slow request keeps the shutdown waiting (grace armed through the scheduler), nothing exits yet.
    expect(r.exits).toStrictEqual([]);
    expect(r.shutdown.phase()).toBe('closing');
    expect(r.scheduler.pending()).toContain(r.h.clock.now() + SHUTDOWN_GRACE_MS);
    r.release();
    await within(closed, 3000, 'the connection to close');
    await flush();
    const statuses = [...text.matchAll(/HTTP\/1\.1 (\d+)/g)].map((m) => Number(m[1]));
    expect(statuses).toStrictEqual([200, 503]);
    expect(text).toContain('{"kind":"unavailable"}');
    expect(text).not.toContain('text/event-stream');
    expect(r.h.streams.openCount()).toBe(0);
    expect(r.exits).toStrictEqual([0]);
    expect(r.events.at(-1)).toStrictEqual({ event: 'shutdown-done', forced: false });
  }, 30_000);
});
