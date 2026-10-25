import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAP_FILE_NAMES, mapDigestBytes } from '@mbrg/protocol';
import type { PublicMatch, RecordReply, StateReply } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { errorText } from '../../web/src/core/live-text';
import { sha256Hex } from '../../web/src/ui/web-crypto';
import { DEV_DIR } from './helpers/digests';
import { advanceSteps, get, makeMatch, publicOf, startReads, withTempDirAsync } from './helpers/http-reads-kit';
import { closeAllServers } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { OPERATOR, START_MS } from './helpers/service-harness';
import { RecordingScene, startViewer, until } from './helpers/viewer-kit';
import type { Viewer } from './helpers/viewer-kit';

// FR-303 (real server), FR-307 (real server), FR-308 (real server), NFR-52 (viewer over the network): the viewer's pure core,
// transport and runner (imported by relative path, plan H6) against the real server in process: the harness, the fake clock, an
// in-memory store, port 0 and Node's `fetch`. The viewer is headless: a recording scene stands for the map.

afterEach(closeAllServers);

const timeoutOf = 120_000;

/** The viewer's held state and record at round `n` equal what the server serves at `n`. */
async function expectEqualToServer(h: ServerHarness, id: string, v: Viewer, n: number): Promise<void> {
  const served = (await get(h, `/matches/${id}/states/${n}`)).json() as StateReply;
  const held = v.model().held.get(n);
  expect(held, `held ${n}`).toBeDefined();
  const sorted = (pairs: readonly (readonly [number, number])[]): string => JSON.stringify([...pairs].sort((a, b) => a[0] - b[0]));
  expect(sorted([...(held ?? [])])).toBe(sorted(served.owners));
  if (n >= 1 && v.model().records.has(n)) {
    const record = (await get(h, `/matches/${id}/records/${n}`)).json() as RecordReply;
    expect(v.model().records.get(n)).toStrictEqual(record);
  }
}

/** No state or record request named a round above the N the model had when it was sent. */
function expectNoRequestAboveN(v: Viewer): void {
  for (const r of v.requests) {
    const named = /\/(?:states|records)\/(\d+)/.exec(r.url);
    if (named !== null) expect(Number(named[1]), r.url).toBeLessThanOrEqual(r.applied);
  }
}

/** The step the match needs next, made through the service API, then the viewer's number caught up with the server's. */
async function stepAndCatchUp(h: ServerHarness, id: string, v: Viewer, drive: () => void): Promise<void> {
  drive();
  await until(() => v.model().lastSeq === publicOf(h, id).lastSeq, `the viewer to catch up to event ${publicOf(h, id).lastSeq}`);
}

/** Plays a whole match with `drive` (one decision per call), checking the viewer against the server after every applied round. */
async function playWhole(h: ServerHarness, id: string, v: Viewer, drive: () => void): Promise<void> {
  await until(() => v.scene.draws.length === 1, 'the first drawing');
  await expectEqualToServer(h, id, v, 0);
  let applied = 0;
  while (publicOf(h, id).stage !== 'finished') {
    await stepAndCatchUp(h, id, v, drive);
    const now = publicOf(h, id).appliedRounds;
    if (now > applied) {
      applied = now;
      expect(v.model().applied).toBe(applied);
      await expectEqualToServer(h, id, v, applied);
    }
  }
  await until(() => v.model().stage === 'finished', 'the finish');
  expect(v.model().winner).toBe(publicOf(h, id).winner);
  expect(v.scene.steps.map((s) => [s.from, s.to])).toStrictEqual(Array.from({ length: applied }, (_, i) => [i, i + 1]));
  expect(v.scene.draws).toStrictEqual([0]);
  expect(v.scene.opens).toBe(1);
  expect(v.scene.failures).toStrictEqual([]);
  expect(v.model().records.size).toBe(applied);
  expectNoRequestAboveN(v);
}

const nextClockStep = (h: ServerHarness): void => {
  const next = h.base.scheduler!.pending()[0];
  if (next === undefined) throw new Error('no armed step');
  h.base.scheduler!.runTo(next);
};

describe('the viewer core against the real server: whole matches', () => {
  it('FR-303 (real server) NFR-52 (viewer over the network) a manual match from round 0 to T: the viewer equals the server at every N, one step per applied round, no request above N', async () => {
    const h = await startReads({ service: { scheduler: true } });
    const { id } = makeMatch(h, 'c-1', { timing: 'manual' });
    const v = startViewer({ port: h.port, matchId: id });
    await playWhole(h, id, v, () => advanceSteps(h, id, 1));
    expect(v.requests.filter((r) => /\/(?:states|records)\//.test(r.url))).toStrictEqual([]);
    // The map files were verified once: three file reads, all before the stream.
    const files = v.requests.filter((r) => r.url.includes('/maps/'));
    expect(files).toHaveLength(3);
    const firstStream = v.requests.findIndex((r) => r.url.includes('/events'));
    const lastFile = v.requests.map((r) => r.url.includes('/maps/')).lastIndexOf(true);
    expect(lastFile).toBeLessThan(firstStream);
  }, timeoutOf);

  it('FR-303 (real server) FR-307 (real server) a clock match with L2 above 0 and one with L2 equal to 0 play to the end and equal the server', async () => {
    for (const timing of [{ i: 120, l1: 30, l2: 10 }, { i: 60, l1: 20, l2: 0 }]) {
      const h = await startReads({ service: { scheduler: true } });
      const { id } = makeMatch(h, `c-${timing.l2}`, { timing });
      const v = startViewer({ port: h.port, matchId: id });
      await playWhole(h, id, v, () => nextClockStep(h));
      expect(h.clock.now()).toBeGreaterThan(START_MS);
    }
  }, timeoutOf);

  it('FR-304 (real server) a viewer that browses an earlier round reads only rounds up to N and plays no step when a round is applied (D32)', async () => {
    const h = await startReads({ service: { scheduler: true } });
    const { id } = makeMatch(h, 'c-1', { timing: 'manual' });
    advanceSteps(h, id, 6);
    const scene = new RecordingScene();
    scene.roundAsked = () => 1;
    const v = startViewer({ port: h.port, matchId: id, scene });
    await until(() => scene.draws.length === 1, 'the address round');
    expect(scene.draws).toStrictEqual([1]);
    advanceSteps(h, id, 3);
    await until(() => v.model().applied === 3, 'round 3 applied');
    expect(scene.steps).toStrictEqual([]);
    expect(v.model().displayed).toBe(1);
    v.runner.navigate('last');
    await until(() => scene.draws.length === 2, 'the jump to the last round');
    expect(scene.draws).toStrictEqual([1, 3]);
    await expectEqualToServer(h, id, v, 3);
    await expectEqualToServer(h, id, v, 1);
    expectNoRequestAboveN(v);
  }, timeoutOf);

  it('FR-308 (real server) the digest of the served files equals the announced one, and the viewer opened its scene once', async () => {
    const h = await startReads({ service: { scheduler: true } });
    const { id } = makeMatch(h, 'c-1', { timing: 'manual' });
    const bytes = Object.fromEntries(await Promise.all(MAP_FILE_NAMES.map(async (name) => [name, new Uint8Array(await (await fetch(`http://127.0.0.1:${h.port}/maps/dev/${name}`)).arrayBuffer())]))) as Record<(typeof MAP_FILE_NAMES)[number], Uint8Array>;
    const announced: PublicMatch = publicOf(h, id);
    expect(await sha256Hex(mapDigestBytes(bytes))).toBe(announced.mapDigest);
    const v = startViewer({ port: h.port, matchId: id });
    await until(() => v.scene.draws.length === 1, 'the first drawing');
    expect(v.scene.opens).toBe(1);
  }, timeoutOf);
});

describe('the viewer core against the real server: reconnection and halting', () => {
  it('FR-307 (real server) a stream dropped by the server reopens with Last-Event-ID and the events missed meanwhile arrive once, in order', async () => {
    const h = await startReads({ service: { scheduler: true } });
    const { id } = makeMatch(h, 'c-1', { timing: 'manual' });
    // A gate holds the reconnection until the test has let the match move on without the viewer.
    const gate = { closed: false, release: (): void => undefined, waiting: false };
    const v = startViewer({
      port: h.port,
      matchId: id,
      wrap: (inner) => async (url, init) => {
        if (gate.closed && url.includes('/events')) {
          gate.waiting = true;
          await new Promise<void>((resolve) => (gate.release = resolve));
          gate.waiting = false;
        }
        return inner(url, init);
      },
    });
    await until(() => v.scene.draws.length === 1, 'the first drawing');
    await stepAndCatchUp(h, id, v, () => advanceSteps(h, id, 1));
    gate.closed = true;
    h.server.closeAllConnections();
    await until(() => gate.waiting, 'the reconnection to be asked for');
    // Four decisions pass while the viewer is cut off: round 1 is applied and round 2 starts.
    advanceSteps(h, id, 4);
    gate.closed = false;
    gate.release();
    await until(() => v.model().lastSeq === publicOf(h, id).lastSeq, 'the replay to arrive');
    expect(v.model().applied).toBe(publicOf(h, id).appliedRounds);
    expect(v.scene.steps.map((s) => [s.from, s.to])).toStrictEqual([[0, 1]]);
    await expectEqualToServer(h, id, v, v.model().applied);
    const streams = v.requests.filter((r) => r.url.includes('/events'));
    expect(streams).toHaveLength(2);
    expect(streams[0]?.url).toContain('?lastEventId=');
    expect(streams[0]?.headers['last-event-id']).toBeUndefined();
    expect(streams[1]?.url).not.toContain('lastEventId');
    expect(Number(streams[1]?.headers['last-event-id'])).toBeGreaterThan(1);
    // The match goes on to the end through the new stream.
    while (publicOf(h, id).stage !== 'finished') await stepAndCatchUp(h, id, v, () => advanceSteps(h, id, 1));
    await until(() => v.model().stage === 'finished', 'the finish');
    expect(v.scene.steps.map((s) => s.to)).toStrictEqual([1, 2, 3, 4]);
    expect(v.scene.failures).toStrictEqual([]);
  }, timeoutOf);

  it('FR-307 (real server) a halted match (map-changed) shows the halt, closes the stream and is not reopened', async () => {
    await withTempDirAsync(async (dir) => {
      const folder = join(dir, 'pkg');
      mkdirSync(folder);
      for (const file of ['map.json', 'ids.png', 'presentation.json']) copyFileSync(join(DEV_DIR, file), join(folder, file));
      const h = await startReads({ service: { folders: { dev: folder } } });
      const { id } = makeMatch(h, 'c-1', { timing: 'manual' });
      const v = startViewer({ port: h.port, matchId: id });
      await until(() => v.scene.draws.length === 1, 'the first drawing');
      await until(() => v.requests.some((r) => r.url.includes('/events')), 'the stream');
      writeFileSync(join(folder, 'map.json'), `${readFileSync(join(DEV_DIR, 'map.json'), 'utf8')} `);
      h.clock.set(START_MS + 7000);
      expect(h.service.advance({ credential: OPERATOR, matchId: id, body: { round: 1, step: 'phase-1-close' } }).ok).toBe(false);
      await until(() => v.model().stage === 'halted', 'the halt');
      expect(v.model().haltReason).toBe('map-changed');
      const streams = v.requests.filter((r) => r.url.includes('/events')).length;
      await v.clock.advance(120_000);
      expect(v.requests.filter((r) => r.url.includes('/events'))).toHaveLength(streams);
      expect(v.scene.failures).toStrictEqual([]);
    });
  }, timeoutOf);

  it('FR-308 (real server) a served file changed by one byte: nothing is drawn, no stream opens and digest-mismatch is shown', async () => {
    await withTempDirAsync(async (dir) => {
      const folder = join(dir, 'pkg');
      mkdirSync(folder);
      for (const file of ['map.json', 'ids.png', 'presentation.json']) copyFileSync(join(DEV_DIR, file), join(folder, file));
      const h = await startReads({ service: { folders: { dev: folder } } });
      const { id } = makeMatch(h, 'c-1', { timing: 'manual' });
      writeFileSync(join(folder, 'presentation.json'), `${readFileSync(join(DEV_DIR, 'presentation.json'), 'utf8')} `);
      const v = startViewer({ port: h.port, matchId: id });
      await until(() => v.scene.failures.length === 1, 'the digest-mismatch message');
      expect(v.scene.failures).toStrictEqual([errorText('digest-mismatch')]);
      expect(v.scene.opens).toBe(0);
      expect(v.scene.draws).toStrictEqual([]);
      expect(v.requests.some((r) => r.url.includes('/events') || /\/(?:states|records)\//.test(r.url))).toBe(false);
    });
  }, timeoutOf);
});
