import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openStore } from '../src/store/sqlite';
import { request } from './helpers/http-client';
import { withTempDirAsync } from './helpers/http-reads-kit';
import { baseEnv, eventsOf, runToExit, withMain } from './helpers/main-child';
import { CHILD_OPERATOR } from './helpers/main-child';
import { creationBody } from './helpers/service-harness';

// The production entry point as a child process (`node --import tsx src/main.ts`): the listener, the closed lifecycle lines,
// the failures at start, and `start()` wired (FR-239, FR-294: a restart on the same file resumes). Every child is killed by
// its PID in a `finally` (helpers/main-child.ts) and the temporary directories are removed afterwards.

const auth = { authorization: `Bearer ${CHILD_OPERATOR}` };
const post = (port: number, path: string, body: unknown): ReturnType<typeof request> => request(port, { method: 'POST', path, headers: auth, body });

describe('the entry point as a process', () => {
  it('NFR-54 (logs) prints a start report and the listening line with the port on stdout, serves a read, and writes nothing to stderr', async () => {
    await withMain(baseEnv(), async (child, port) => {
      const reply = await request(port, { path: '/matches' });
      expect(reply.status).toBe(200);
      expect(reply.json()).toStrictEqual({ items: [] });
      const events = eventsOf(child.stdout());
      expect(events).toStrictEqual([
        { event: 'start-report', purged: 0, performed: 0, failed: 0, halted: 0, retry: false },
        { event: 'listening', port },
      ]);
      expect(child.stderr()).toBe('');
      expect(port).toBeGreaterThan(0);
    });
  }, 60_000);

  it('NFR-54 (logs) invalid settings exit with 1 naming the variables only, with nothing on stdout', async () => {
    const r = await runToExit(baseEnv({ MBRG_PORT: '70000', MBRG_ALLOWED_ORIGINS: 'https://app.example/path', MBRG_LIMIT_READS: '0' }));
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr.trim()).toBe('invalid settings: MBRG_ALLOWED_ORIGINS, MBRG_PORT, MBRG_LIMIT_READS');
    expect(r.stderr).not.toContain(CHILD_OPERATOR);
  }, 60_000);

  it('NFR-54 (logs) a busy port is a listen-failed event with its code, a closed shutdown, and exit 1', async () => {
    const blocker = createNetServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    try {
      const address = blocker.address();
      if (address === null || typeof address === 'string') throw new Error('no port');
      const r = await runToExit(baseEnv({ MBRG_PORT: String(address.port) }));
      expect(r.code).toBe(1);
      expect(eventsOf(r.stderr)).toStrictEqual([{ event: 'listen-failed', code: 'EADDRINUSE' }]);
      expect(eventsOf(r.stdout).map((e) => e.event)).toStrictEqual(['start-report', 'shutdown-start', 'shutdown-done']);
      expect(r.stderr + r.stdout).not.toContain(String(address.port) + '"');
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  }, 60_000);

  it('NFR-54 (logs) a database that cannot be opened is one fatal event with the error name, never its path, and exit 1', async () => {
    await withTempDirAsync(async (dir) => {
      const r = await runToExit(baseEnv({ MBRG_DATABASE: dir }));
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      const [event, ...rest] = eventsOf(r.stderr);
      expect(rest).toStrictEqual([]);
      expect(event).toMatchObject({ event: 'fatal', source: 'open-store' });
      expect(r.stderr).not.toContain(dir);
    });
  }, 60_000);

  it('FR-239 (wired) FR-294 (wired) a restart on the same file resumes: stored matches are kept, the overdue clock step runs at start and the timers go on', async () => {
    await withTempDirAsync(async (dir) => {
      const env = baseEnv({ MBRG_DATABASE: join(dir, 'mbrg.sqlite') });
      const ids = await withMain(env, async (_child, port) => {
        const manual = await post(port, '/matches', creationBody('m-1', { timing: 'manual' }));
        expect(manual.status).toBe(201);
        const manualId = (manual.json() as { matchId: string }).matchId;
        for (const step of ['phase-1-close', 'phase-2-close', 'application']) {
          expect((await post(port, `/matches/${manualId}/advance`, { round: 1, step })).status).toBe(200);
        }
        // A clock match whose first step falls due three seconds after its creation: the process is killed before that.
        const clock = await post(port, '/matches', creationBody('c-1', { timing: { i: 5, l1: 1, l2: 1 } }));
        expect(clock.status).toBe(201);
        return { manualId, clockId: (clock.json() as { matchId: string }).matchId, createdAt: Date.now() };
      });
      // The first child was killed (SIGKILL: no shutdown code ran). Let the clock step become overdue while no server runs.
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, ids.createdAt + 3600 - Date.now())));
      await withMain(env, async (child, port) => {
        const report = eventsOf(child.stdout()).find((e) => e.event === 'start-report');
        expect(report).toMatchObject({ performed: 1, failed: 0, halted: 0, retry: false });
        const manual = (await request(port, { path: `/matches/${ids.manualId}` })).json() as { appliedRounds: number; stage: string };
        expect([manual.appliedRounds, manual.stage]).toStrictEqual([1, 'phase-1']);
        expect((await post(port, `/matches/${ids.manualId}/advance`, { round: 2, step: 'phase-1-close' })).status).toBe(200);
        // The timers of the resumed clock match are armed: it goes on by itself (round 1 applied within a few seconds).
        const deadline = Date.now() + 25_000;
        let applied = 0;
        while (applied < 1 && Date.now() < deadline) {
          applied = ((await request(port, { path: `/matches/${ids.clockId}` })).json() as { appliedRounds: number }).appliedRounds;
          if (applied < 1) await new Promise((resolve) => setTimeout(resolve, 200));
        }
        expect(applied).toBeGreaterThanOrEqual(1);
        expect(child.stderr()).toBe('');
      });
    });
  }, 120_000);

  // Windows cannot deliver SIGTERM to a child process (it would terminate it without running the handler), so the real
  // signal is tested on POSIX only (CI runs Linux); server-shutdown.test.ts covers the shutdown and the signal wiring
  // in process on every platform.
  it.skipIf(process.platform === 'win32')('NFR-54 (logs) SIGTERM closes the listener and the store, logs the shutdown, and the process exits with 0', async () => {
    await withTempDirAsync(async (dir) => {
      const file = join(dir, 'mbrg.sqlite');
      const matchId = await withMain(baseEnv({ MBRG_DATABASE: file }), async (child, port) => {
        const made = await post(port, '/matches', creationBody('m-1', { timing: 'manual' }));
        const id = (made.json() as { matchId: string }).matchId;
        child.signal('SIGTERM');
        const exit = await child.exited;
        expect(exit).toStrictEqual({ code: 0, signal: null });
        expect(eventsOf(child.stdout()).map((e) => e.event)).toStrictEqual(['start-report', 'listening', 'shutdown-start', 'shutdown-done']);
        expect(child.stderr()).toBe('');
        return id;
      });
      const store = openStore(file);
      try {
        expect(store.getMatch(matchId)).toBeDefined();
      } finally {
        store.close();
      }
    });
  }, 60_000);
});
