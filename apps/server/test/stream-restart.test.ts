import { join } from 'node:path';
import { encodeEvent } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { openStore } from '../src/store/sqlite';
import { advanceSteps, makeMatch, startReads, withTempDirAsync } from './helpers/http-reads-kit';
import { CHILD_OPERATOR, baseEnv, eventsOf, killFixtureAt, withMain } from './helpers/main-child';
import { closeAllServers } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { START_MS, creationBody } from './helpers/service-harness';
import { openStream } from './helpers/sse-reader';
import type { SseReader } from './helpers/sse-reader';
import { request } from './helpers/http-client';

// FR-294 (stream replay), NFR-57 (replay), FR-289 (stream, shutdown and restart): events are durable, so a client that
// reconnects after a restart with its `Last-Event-ID` gets the rest with the ORIGINAL numbers, no gap and no duplicate. The
// kill tests run the real fixture (fixtures/kill-child.ts) in a child process that is killed by its PID after the COMMIT of a
// decision and before its publication (a blocking listener registered before any stream hub); they use `process.execPath`
// only, so they run on Windows and on Linux CI.

const readers: SseReader[] = [];
afterEach(async () => {
  for (const r of readers.splice(0, readers.length)) r.close();
  await closeAllServers();
});

const S = 1000;
const C1 = START_MS + 80 * S;

/** A server (the production routes, the hub, a fake clock at `at`) over the database FILE, as a restarted process has it. */
const serverOn = (file: string, at: number = START_MS): Promise<ServerHarness> =>
  startReads({ wrapStore: (inner) => (inner.close(), openStore(file)), service: { start: at, scheduler: true }, limits: { anonymousStreams: 100 } });

const streamOf = async (h: ServerHarness, id: string, query = '', headers: Record<string, string> = {}): Promise<SseReader> => {
  const reader = await openStream({ port: h.port, path: `/matches/${id}/events${query}`, headers });
  readers.push(reader);
  return reader;
};

/** A temporary folder whose database files are released (readers and servers closed) before it is removed. */
const inDir = (body: (dir: string) => Promise<void>): Promise<void> =>
  withTempDirAsync(async (dir) => {
    try {
      await body(dir);
    } finally {
      for (const r of readers.splice(0, readers.length)) r.close();
      await closeAllServers();
    }
  });

describe('the event stream across restarts', () => {
  it('FR-294 (stream replay) events committed while no stream was open are replayed after a restart with their original numbers, none twice', async () => {
    await inDir(async (dir) => {
      const file = join(dir, 'restart.sqlite');
      const first = await serverOn(file);
      const { id } = makeMatch(first, 'c-1', { timing: 'manual' });
      advanceSteps(first, id, 1);
      // A client reads up to event 3 and is cut off (the connection dies before it sees event 4).
      const early = await streamOf(first, id, '?lastEventId=0');
      expect((await early.takeEvents(3)).map((f) => f.id)).toStrictEqual([1, 2, 3]);
      early.close();
      advanceSteps(first, id, 2);
      const all = first.base.store.eventsAfter(id, 0);
      expect(all.map((e) => e.seq)).toStrictEqual(Array.from({ length: all.length }, (_, i) => i + 1));
      expect(all.map((e) => e.type)).toStrictEqual(['schedule', 'phase-closed', 'victim-revealed', 'schedule', 'phase-closed', 'schedule', 'round-applied', 'schedule']);
      await first.close();

      const second = await serverOn(file);
      expect(second.service.start().performed).toStrictEqual([]);
      const reconnected = await streamOf(second, id, '', { 'last-event-id': '3' });
      const want = all.slice(3);
      const got = await reconnected.takeEvents(want.length);
      expect(got.map((f) => f.id)).toStrictEqual(want.map((e) => e.seq));
      expect(got.map((f) => f.data)).toStrictEqual(want.map((e) => encodeEvent(e)));
      expect(reconnected.raw()).toBe(got.map((f) => f.raw).join(''));
      // A client that had everything gets nothing replayed, and the next decision continues the numbering.
      const upToDate = await streamOf(second, id, `?lastEventId=${all.length}`);
      expect(upToDate.raw()).toBe('');
      advanceSteps(second, id, 1);
      const next = await upToDate.takeEvents(3);
      expect(next.map((f) => f.id)).toStrictEqual([all.length + 1, all.length + 2, all.length + 3]);
    });
  }, 60_000);

  /** Runs the fixture, kills it at its publication and restarts a server on the file at clock reading `at`. */
  async function killedThenRestarted(dir: string, mode: 'after-commit' | 'late-start', at: number): Promise<{ id: string; second: ServerHarness }> {
    const file = join(dir, `${mode}.sqlite`);
    const killed = await killFixtureAt([file, mode], 'published');
    expect(killed.reached, `${killed.stdout} ${killed.stderr}`).toBe(true);
    expect(killed.signal === 'SIGKILL' || killed.code !== 0).toBe(true);
    expect(killed.stdout).not.toContain('not held');
    const id = /created (\S+)/.exec(killed.stdout)?.[1];
    expect(id).toBeDefined();
    const second = await serverOn(file, at);
    return { id: id as string, second };
  }

  it('NFR-57 (replay) FR-294 (stream replay) a kill after the COMMIT of a phase-1 close and before its publication: the replay holds its events once and the step is not performed again', async () => {
    await inDir(async (dir) => {
      const { id, second } = await killedThenRestarted(dir, 'after-commit', C1);
      const store = second.base.store;
      // The decision was committed and never sent: the database holds it, whole.
      expect(store.eventsAfter(id, 0).map((e) => [e.seq, e.type])).toStrictEqual([[1, 'schedule'], [2, 'phase-closed'], [3, 'victim-revealed'], [4, 'schedule']]);
      expect(store.steps(id).map((s) => [s.round, s.kind, s.instant, s.cause])).toStrictEqual([[1, 'phase-1-close', C1, 'clock']]);
      expect(second.service.start().performed).toStrictEqual([]);
      const reader = await streamOf(second, id, '', { 'last-event-id': '1' });
      const got = await reader.takeEvents(3);
      expect(got.map((f) => f.id)).toStrictEqual([2, 3, 4]);
      expect(got.map((f) => JSON.parse(f.data).type)).toStrictEqual(['phase-closed', 'victim-revealed', 'schedule']);
      expect(got.map((f) => f.data)).toStrictEqual(store.eventsAfter(id, 1).map((e) => encodeEvent(e)));
      // The clock goes on past the old instant: the step is done, nothing is performed twice and nothing new is sent.
      second.base.scheduler!.runTo(C1 + 5 * S);
      expect(store.eventsAfter(id, 0)).toHaveLength(4);
      expect(store.steps(id)).toHaveLength(1);
      expect(reader.raw()).toBe(got.map((f) => f.raw).join(''));
    });
  }, 120_000);

  it('NFR-57 (replay) FR-294 (stream replay) a kill during the late step of start(), at its publication: the next start performs nothing again and the replay is complete', async () => {
    await inDir(async (dir) => {
      const late = START_MS + 500 * S;
      const { id, second } = await killedThenRestarted(dir, 'late-start', late);
      const store = second.base.store;
      expect(store.steps(id).map((s) => [s.round, s.kind, s.instant, s.cause])).toStrictEqual([[1, 'phase-1-close', late, 'late']]);
      expect(second.service.start().performed).toStrictEqual([]);
      const reader = await streamOf(second, id, '?lastEventId=0');
      const got = await reader.takeEvents(4);
      expect(got.map((f) => f.id)).toStrictEqual([1, 2, 3, 4]);
      expect(got.map((f) => JSON.parse(f.data).type)).toStrictEqual(['schedule', 'phase-closed', 'victim-revealed', 'schedule']);
      expect(got.map((f) => f.data)).toStrictEqual(store.eventsAfter(id, 0).map((e) => encodeEvent(e)));
      expect(store.eventsAfter(id, 0)).toHaveLength(4);
      expect(reader.raw()).toBe(got.map((f) => f.raw).join(''));
    });
  }, 120_000);
});

describe('the entry point with an open stream', () => {
  // Windows cannot deliver SIGTERM to a child process (it would terminate it without running the handler), so the real
  // signal is tested on POSIX only (CI runs Linux); server-shutdown.test.ts covers the same shutdown in process everywhere.
  it.skipIf(process.platform === 'win32')('FR-289 (stream, shutdown and restart) SIGTERM with an open stream ends the stream and exits with 0 before the grace period', async () => {
    await withMain(baseEnv(), async (child, port) => {
      const made = await request(port, { method: 'POST', path: '/matches', headers: { authorization: `Bearer ${CHILD_OPERATOR}` }, body: creationBody('m-1', { timing: 'manual' }) });
      const id = (made.json() as { matchId: string }).matchId;
      const reader = await openStream({ port, path: `/matches/${id}/events?lastEventId=0` });
      readers.push(reader);
      expect(reader.status).toBe(200);
      const started = Date.now();
      child.signal('SIGTERM');
      const exit = await child.exited;
      expect(exit).toStrictEqual({ code: 0, signal: null });
      expect(Date.now() - started).toBeLessThan(4000);
      await reader.ended;
      expect(eventsOf(child.stdout()).map((e) => e.event)).toStrictEqual(['start-report', 'listening', 'shutdown-start', 'shutdown-done']);
      expect(eventsOf(child.stdout()).at(-1)).toStrictEqual({ event: 'shutdown-done', forced: false });
    });
  }, 60_000);
});
