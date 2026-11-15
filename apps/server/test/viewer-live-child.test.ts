import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import type { RecordReply, StateReply } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { request } from './helpers/http-client';
import { withTempDirAsync } from './helpers/http-reads-kit';
import { CHILD_OPERATOR, baseEnv, listeningPort, spawnMain, waitFor } from './helpers/main-child';
import type { MainChild } from './helpers/main-child';
import { creationBody } from './helpers/service-harness';
import { startViewer, until } from './helpers/viewer-kit';

// FR-307 (real server), FR-303 (real server): the production entry point (`node --import tsx src/main.ts`) with a file
// database on a fixed port, killed by its PID in the middle of a match and restarted on the same port and file. The viewer
// loses its stream, waits by its schedule, reconnects with `Last-Event-ID` and ends equal to what the restarted server holds.

const auth = { authorization: `Bearer ${CHILD_OPERATOR}` };
const STEPS = ['phase-1-close', 'phase-2-close', 'application'];

/** A free port: the OS gives one to a listener that is closed at once (the child takes it next). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

describe('the viewer core against the production entry point, killed and restarted', () => {
  it('FR-307 (real server) FR-303 (real server) a kill by PID in the middle of a match and a restart on the same port: the viewer reconnects with the header and ends equal to the server', async () => {
    await withTempDirAsync(async (dir) => {
      const port = await freePort();
      const env = baseEnv({ MBRG_DATABASE: join(dir, 'mbrg.sqlite'), MBRG_PORT: String(port) });
      const children: MainChild[] = [];
      const start = async (): Promise<MainChild> => {
        const child = spawnMain(env);
        children.push(child);
        await waitFor(child, () => listeningPort(child), 'the listening event', 60_000);
        return child;
      };
      const json = async <T>(path: string): Promise<T> => (await request(port, { path })).json() as T;
      const step = async (id: string, round: number, kind: string): Promise<void> => {
        const done = await request(port, { method: 'POST', path: `/matches/${id}/advance`, headers: auth, body: { round, step: kind } });
        expect(done.status).toBe(200);
      };
      try {
        let child = await start();
        const made = await request(port, { method: 'POST', path: '/matches', headers: auth, body: creationBody('child-1', { timing: 'manual' }) });
        expect(made.status).toBe(201);
        const id = (made.json() as { matchId: string }).matchId;
        const v = startViewer({ port, matchId: id });
        await until(() => v.scene.draws.length === 1, 'the first drawing');
        const catchUp = async (): Promise<void> => {
          const last = (await json<{ lastSeq: number }>(`/matches/${id}`)).lastSeq;
          await until(() => v.model().lastSeq === last, `the viewer to reach event ${last}`, 30_000);
        };
        for (const kind of STEPS) {
          await step(id, 1, kind);
          await catchUp();
        }
        await step(id, 2, 'phase-1-close');
        await catchUp();
        expect(v.model().applied).toBe(1);

        // The kill: no shutdown code runs. The viewer's stream drops and its first reconnection is refused.
        await child.kill();
        await until(() => v.model().wait !== undefined, 'the viewer to start waiting');
        expect(v.scene.draws).toStrictEqual([0]);

        // The restart on the same port and file; the viewer's timer then comes due and it reconnects.
        child = await start();
        for (let i = 0; i < 40 && v.model().connection !== 'open'; i += 1) {
          await v.clock.advance(5000);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await until(() => v.model().connection === 'open', 'the viewer to reconnect', 30_000);
        await catchUp();
        const streams = v.requests.filter((r) => r.url.includes('/events'));
        expect(streams[0]?.url).toContain('?lastEventId=');
        const reconnects = streams.slice(1);
        expect(reconnects.length).toBeGreaterThanOrEqual(1);
        for (const r of reconnects) {
          expect(r.url).not.toContain('lastEventId');
          expect(Number(r.headers['last-event-id'])).toBeGreaterThan(1);
        }

        // The match goes on to its end on the restarted server.
        await step(id, 2, 'phase-2-close');
        await step(id, 2, 'application');
        for (const round of [3, 4]) for (const kind of STEPS) await step(id, round, kind);
        await until(() => v.model().stage === 'finished', 'the finish', 60_000);
        await catchUp();

        // Equal to the restarted server at every applied round; each step played once.
        const shown = await json<{ appliedRounds: number; winner: number }>(`/matches/${id}`);
        expect(v.model().applied).toBe(shown.appliedRounds);
        expect(v.model().winner).toBe(shown.winner);
        expect(v.scene.steps.map((s) => [s.from, s.to])).toStrictEqual(Array.from({ length: shown.appliedRounds }, (_, i) => [i, i + 1]));
        const sorted = (pairs: readonly (readonly [number, number])[]): string => JSON.stringify([...pairs].sort((a, b) => a[0] - b[0]));
        for (let n = 0; n <= shown.appliedRounds; n += 1) {
          const state = await json<StateReply>(`/matches/${id}/states/${n}`);
          expect(sorted([...(v.model().held.get(n) ?? [])]), `round ${n}`).toBe(sorted(state.owners));
          if (n >= 1) expect(v.model().records.get(n)).toStrictEqual(await json<RecordReply>(`/matches/${id}/records/${n}`));
        }
        expect(v.scene.failures).toStrictEqual([]);
        expect(child.stderr()).toBe('');
      } finally {
        for (const c of children) await c.kill();
      }
    });
  }, 240_000);
});
