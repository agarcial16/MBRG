import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeEvent } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { RETRY_MS } from '../src/service/matches';
import { DEV_DIR } from './helpers/digests';
import { advanceSteps, makeMatch, publicOf, startReads, withTempDirAsync } from './helpers/http-reads-kit';
import { closeAllServers } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { OPERATOR, START_MS } from './helpers/service-harness';
import { openFromStart, playAndCheck } from './helpers/stream-run';
import type { SseReader } from './helpers/sse-reader';

// FR-287 (order and content on the wire), FR-288 (stream), FR-290 (stream), FR-302 (events): one stream from `lastEventId=0`
// over full dev-map matches through the real listener. For every decision the stream carries exactly the stored events, with
// the stored numbers, in the type order of plan 19.8, byte-equal to `encodeEvent`. The results event of FR-287 (d) is M4.

const readers: SseReader[] = [];
afterEach(async () => {
  for (const r of readers.splice(0, readers.length)) r.close();
  await closeAllServers();
});

const S = 1000;
const REVEAL_KEYS = ['type', 'seq', 'round', 'victim', 'candidates', 'living', 'revealedAt', 'c2', 'a', 'reportedTime'];
const TIMED = ['schedule', 'victim-revealed', 'match-finished', 'match-halted'];

/** The reported times of the events that carry one, in stream order. */
const reportedOf = (events: readonly Record<string, unknown>[]): number[] => events.filter((e) => TIMED.includes(e.type as string)).map((e) => e.reportedTime as number);
const nondecreasing = (times: readonly number[]): boolean => times.every((t, i) => i === 0 || t >= (times[i - 1] as number));

/** The next armed instant of the service's own scheduler: running to it performs the next clock decision. */
const nextClockStep = (h: ServerHarness): void => {
  const next = h.base.scheduler!.pending()[0];
  if (next === undefined) throw new Error('no armed step');
  h.base.scheduler!.runTo(next);
};

async function matchWith(timing: unknown): Promise<{ h: ServerHarness; id: string; reader: SseReader }> {
  const h = await startReads({ service: { scheduler: true } });
  const { id } = makeMatch(h, 'c-1', { timing });
  return { h, id, reader: await openFromStart(h, id, readers) };
}

describe('the event stream over full matches: order and content', () => {
  it('FR-287 (order) FR-288 (stream) manual timing: three advances per round, the type sequence of every decision and the victim fields', async () => {
    const { h, id, reader } = await matchWith('manual');
    const played = await playAndCheck(h, id, reader, 1, () => advanceSteps(h, id, 1));
    expect(played.decisions).toHaveLength(12);
    expect(played.stored.map((e) => e.type)).toStrictEqual([
      'schedule',
      ...[1, 2, 3, 4].flatMap((k) => ['phase-closed', 'victim-revealed', 'results', 'schedule', 'phase-closed', 'schedule', 'round-applied', 'results', k < 4 ? 'schedule' : 'match-finished']),
    ]);
    expect(played.events[played.events.length - 1]?.type).toBe('match-finished');
    for (const e of played.events.filter((x) => x.type === 'victim-revealed')) expect(Object.keys(e)).toStrictEqual(REVEAL_KEYS);
    // Timing manual: no schedule member in any schedule event, and c2 and a are null.
    for (const e of played.events.filter((x) => x.type === 'schedule')) expect('schedule' in e).toBe(false);
    for (const e of played.events.filter((x) => x.type === 'victim-revealed')) expect([e.c2, e.a]).toStrictEqual([null, null]);
    expect(nondecreasing(reportedOf(played.events))).toBe(true);
  }, 60_000);

  it('FR-287 (order) FR-302 (events) clock timing with L2 above 0: every decision on its schedule, reported times never decrease', async () => {
    const { h, id, reader } = await matchWith({ i: 120, l1: 30, l2: 10 });
    const played = await playAndCheck(h, id, reader, 10, () => nextClockStep(h));
    expect(played.decisions).toHaveLength(12);
    for (const e of played.events.filter((x) => x.type === 'victim-revealed')) {
      expect(Object.keys(e)).toStrictEqual(REVEAL_KEYS);
      expect(typeof e.c2).toBe('number');
      expect(typeof e.a).toBe('number');
    }
    // The creation schedule carries the anchors C1 = +80 s, C2 = +110 s, A = +120 s.
    expect(JSON.stringify(played.events[0])).toContain(`"c1":${START_MS + 80 * S},"c2":${START_MS + 110 * S},"a":${START_MS + 120 * S}`);
    const times = reportedOf(played.events);
    expect(times).toHaveLength(17);
    expect(nondecreasing(times)).toBe(true);
    expect(times[times.length - 1]).toBe(START_MS + 480 * S);
  }, 60_000);

  it('FR-287 (order) clock timing with L2 equal to 0: the phase-2 close and the application are one decision, no schedule between', async () => {
    const { h, id, reader } = await matchWith({ i: 60, l1: 20, l2: 0 });
    const played = await playAndCheck(h, id, reader, 0, () => nextClockStep(h));
    expect(played.decisions).toHaveLength(8);
    expect(played.stored.map((e) => e.type)).toStrictEqual([
      'schedule',
      ...[1, 2, 3, 4].flatMap((k) => ['phase-closed', 'victim-revealed', 'results', 'schedule', 'phase-closed', 'round-applied', 'results', k < 4 ? 'schedule' : 'match-finished']),
    ]);
    expect(nondecreasing(reportedOf(played.events))).toBe(true);
  }, 60_000);

  it('FR-287 (order) a manual advance in every stage of round 1 of a clock match, then the clock for the rest', async () => {
    const { h, id, reader } = await matchWith({ i: 120, l1: 30, l2: 10 });
    const played = await playAndCheck(h, id, reader, 10, (n) => (n < 3 ? advanceSteps(h, id, 1) : nextClockStep(h)));
    expect(played.decisions).toHaveLength(12);
    expect(nondecreasing(reportedOf(played.events))).toBe(true);
    expect(played.events[played.events.length - 1]?.type).toBe('match-finished');
  }, 60_000);

  it('FR-287 (order) a late step after a forward jump of the clock keeps the order of its decision', async () => {
    const { h, id, reader } = await matchWith({ i: 120, l1: 30, l2: 10 });
    const played = await playAndCheck(h, id, reader, 10, (n) => {
      if (n === 1) {
        // The server "was down" from C1 until 500 s: the overdue phase-2 close runs once, late.
        h.clock.set(START_MS + 500 * S);
        expect(h.base.scheduler!.fireDue()).toBe(1);
      } else nextClockStep(h);
    });
    expect(played.decisions).toHaveLength(12);
    expect(reportedOf(played.events).some((t) => t >= START_MS + 500 * S)).toBe(true);
    expect(nondecreasing(reportedOf(played.events))).toBe(true);
  }, 60_000);

  it('FR-287 (order) FR-302 (events) a map change halts the match: the stream gets match-halted only, with a reported time', async () => {
    await withTempDirAsync(async (dir) => {
      const folder = join(dir, 'pkg');
      mkdirSync(folder);
      for (const file of ['map.json', 'ids.png', 'presentation.json']) copyFileSync(join(DEV_DIR, file), join(folder, file));
      const h = await startReads({ service: { folders: { dev: folder } } });
      const { id } = makeMatch(h);
      const reader = await openFromStart(h, id, readers);
      const created = await reader.takeEvents(1);
      writeFileSync(join(folder, 'map.json'), `${readFileSync(join(DEV_DIR, 'map.json'), 'utf8')} `);
      h.clock.set(START_MS + 7 * S);
      const out = h.service.advance({ credential: OPERATOR, matchId: id, body: { round: 1, step: 'phase-1-close' } });
      expect(out.ok).toBe(false);
      const stored = h.base.store.eventsAfter(id, 1);
      expect(stored.map((e) => e.type)).toStrictEqual(['match-halted']);
      const halted = await reader.takeEvents(1);
      expect(halted[0]?.id).toBe(2);
      expect(halted[0]?.data).toBe(encodeEvent(stored[0]!));
      expect(reader.raw()).toBe(`${created[0]?.raw}${halted[0]?.raw}`);
      const times = reportedOf([JSON.parse(created[0]!.data), JSON.parse(halted[0]!.data)] as Record<string, unknown>[]);
      expect(times).toHaveLength(2);
      expect(times[1]).toBeGreaterThanOrEqual(times[0] as number);
      expect(publicOf(h, id).stage).toBe('halted');
    });
  }, 30_000);
});

describe('the event stream when a decision cannot be stored', () => {
  // Transaction 1 is the creation, transaction 2 the phase-1 close at C1: refused before it begins, or failing at its third write.
  it.each([
    ['refused', { failTransaction: 2 }],
    ['failing inside, after the match and step writes', { failWrite: { transaction: 2, afterWrites: 2 } }],
  ])('FR-290 (stream) a phase-1 close whose transaction is %s sends nothing but heartbeats; the retry 3 s later sends the events with the stored numbers', async (_name, plan) => {
    const h = await startReads({ faults: plan, service: { scheduler: true } });
    const { id } = makeMatch(h);
    const reader = await openFromStart(h, id, readers);
    const created = await reader.takeEvents(1);
    const C1 = START_MS + 80 * S;
    h.base.scheduler!.runTo(C1);
    expect(h.base.store.eventsAfter(id, 0)).toHaveLength(1);
    expect(h.scheduler.fireAll()).toBe(1);
    expect(await reader.next()).toMatchObject({ kind: 'comment' });
    expect(reader.raw()).toBe(`${created[0]?.raw}:\n\n`);
    // The retry performs the step (late, by the rule of FR-248) and the events reach the stream with their stored numbers.
    h.base.scheduler!.runTo(C1 + RETRY_MS);
    const stored = h.base.store.eventsAfter(id, 1);
    expect(stored.map((e) => [e.seq, e.type])).toStrictEqual([[2, 'phase-closed'], [3, 'victim-revealed'], [4, 'results'], [5, 'schedule']]);
    const got = await reader.takeEvents(4);
    expect(got.map((f) => f.id)).toStrictEqual([2, 3, 4, 5]);
    expect(got.map((f) => f.data)).toStrictEqual(stored.map((e) => encodeEvent(e)));
    expect(reader.raw()).toBe(`${created[0]?.raw}:\n\n${got.map((f) => f.raw).join('')}`);
  }, 30_000);
});
