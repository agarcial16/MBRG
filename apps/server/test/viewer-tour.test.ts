import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MatchEvent } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { panelView } from '../../web/src/core/live-view';
import { scaleFor } from '../../web/src/core/tour-plan';
import { nominalEnd } from '../../web/src/core/tour';
import { DEV_PRESENTATION } from '../../web/test/helpers/dev-map';
import { DEV_DIR } from './helpers/digests';
import { advanceSteps, makeMatch, publicOf, startReads, withTempDirAsync } from './helpers/http-reads-kit';
import { closeAllServers } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { OPERATOR } from './helpers/service-harness';
import { startViewer, until } from './helpers/viewer-kit';
import type { Viewer } from './helpers/viewer-kit';

// FR-316, FR-319, FR-336, FR-345, FR-349 (real server): the reveal tours the viewer core asks for, against the real server in
// process (the harness of 008 H6: fake clock, in-memory store, port 0, Node's `fetch`). The viewer is headless: a recording
// scene receives the tour requests (the effect or tour exactly as the model made it) and the manual clock of the viewer never
// moves, so the estimate of the match time is the last reported time and every reveal is fresh.

afterEach(closeAllServers);

const timeoutOf = 120_000;
const factions = DEV_PRESENTATION.factions.map((f) => ({ id: f.id, name: f.name }));

const nextClockStep = (h: ServerHarness): void => {
  const next = h.base.scheduler!.pending()[0];
  if (next === undefined) throw new Error('no armed step');
  h.base.scheduler!.runTo(next);
};

const caughtUp = (h: ServerHarness, id: string, v: Viewer): Promise<void> =>
  until(() => v.model().lastSeq === publicOf(h, id).lastSeq, `the viewer to catch up to event ${publicOf(h, id).lastSeq}`);

/** One decision of the match, then the viewer's event number caught up with the server's. */
async function step(h: ServerHarness, id: string, v: Viewer, drive: () => void): Promise<void> {
  drive();
  await caughtUp(h, id, v);
}

/** Plays the match to its end with `drive`, one decision at a time. */
async function playToEnd(h: ServerHarness, id: string, v: Viewer, drive: () => void): Promise<void> {
  await until(() => v.scene.draws.length === 1, 'the first drawing');
  while (publicOf(h, id).stage !== 'finished') await step(h, id, v, drive);
  await until(() => v.model().stage === 'finished', 'the finish');
}

/** The victim reveals the server published, with the candidates of each round (the truth the viewer's requests are checked against). */
function revealsOf(h: ServerHarness, id: string): Extract<MatchEvent, { type: 'victim-revealed' }>[] {
  const read = h.service.eventsAfter(id, 0);
  if (!read.ok) throw new Error('events read failed');
  return read.reply.events.filter((e): e is Extract<MatchEvent, { type: 'victim-revealed' }> => e.type === 'victim-revealed');
}

/** No state or record request named a round above the N the model had when it was sent. */
function expectNoRequestAboveN(v: Viewer): void {
  for (const r of v.requests) {
    const named = /\/(?:states|records)\/(\d+)/.exec(r.url);
    if (named !== null) expect(Number(named[1]), r.url).toBeLessThanOrEqual(r.applied);
  }
}

describe('the reveal tours against the real server: the victim tour', () => {
  it('FR-316 (real server) FR-336 (real server) a viewer subscribed before C1 gets one victim tour of the reveal with the nominal budget, and none for the rest of the round', async () => {
    const h = await startReads({ service: { scheduler: true } });
    const { id } = makeMatch(h, 't-1');
    const v = startViewer({ port: h.port, matchId: id });
    await until(() => v.scene.draws.length === 1, 'the first drawing');
    await step(h, id, v, () => nextClockStep(h));
    await until(() => v.scene.victimTours.length === 1, 'the victim tour');
    const { effect, at } = v.scene.victimTours[0]!;
    const reveal = revealsOf(h, id)[0]!;
    expect(effect).toMatchObject({ type: 'victim-tour', round: 1, victim: reveal.victim });
    expect([...effect.living].sort((a, b) => a - b)).toStrictEqual([...reveal.living].sort((a, b) => a - b));
    // L1 = 30 s: the time left to C2 less the 1,000 ms margin holds the whole tour, so the budget is nominal.
    const end = nominalEnd('victim', effect.living.length);
    expect(effect.budget).toBeGreaterThanOrEqual(end);
    expect(effect.budget).toBeLessThanOrEqual(29_000);
    expect(scaleFor(end, effect.budget)).toStrictEqual({ play: true });
    expect(at).toBe(v.clock.now());
    // The rest of the round (phase-2 close and the application) starts no second victim tour.
    await step(h, id, v, () => nextClockStep(h));
    await step(h, id, v, () => nextClockStep(h));
    expect(publicOf(h, id).appliedRounds).toBe(1);
    expect(v.scene.victimTours).toHaveLength(1);
    expect(v.model().records.get(1)?.eliminated).toBe(effect.victim);
  }, timeoutOf);

  it('FR-319 (real server) a viewer that reads the public data in phase 2 gets no tour and shows the victim name at once', async () => {
    const h = await startReads({ service: { scheduler: true } });
    const { id } = makeMatch(h, 't-1');
    nextClockStep(h);
    expect(publicOf(h, id).stage).toBe('phase-2');
    const v = startViewer({ port: h.port, matchId: id });
    await until(() => v.scene.draws.length === 1, 'the first drawing');
    await caughtUp(h, id, v);
    expect(v.scene.victimTours).toStrictEqual([]);
    const victim = v.model().victim?.victim;
    expect(victim).toBeDefined();
    const name = factions.find((f) => f.id === victim)?.name as string;
    // No tour ran, so the panel is shown without the "revelando…" state and carries the name.
    expect(panelView(v.model(), v.clock.now(), factions).victim).toContain(name);
    await step(h, id, v, () => nextClockStep(h));
    await step(h, id, v, () => nextClockStep(h));
    expect(v.scene.victimTours).toStrictEqual([]);
    expect(v.scene.failures).toStrictEqual([]);
  }, timeoutOf);

  it('FR-349 (real server) the budget follows L1: L1 = 5 s leaves a compressed tour and L1 = 3 s one that is skipped', async () => {
    const outcomes: Record<number, unknown> = {};
    for (const l1 of [5, 3]) {
      const h = await startReads({ service: { scheduler: true } });
      const { id } = makeMatch(h, `t-l${l1}`, { timing: { i: 60, l1, l2: 2 } });
      const v = startViewer({ port: h.port, matchId: id });
      await until(() => v.scene.draws.length === 1, 'the first drawing');
      await step(h, id, v, () => nextClockStep(h));
      await until(() => v.scene.victimTours.length === 1, 'the victim tour effect');
      const { effect } = v.scene.victimTours[0]!;
      expect(effect.budget).toBeLessThanOrEqual(l1 * 1000 - 1000);
      outcomes[l1] = scaleFor(nominalEnd('victim', effect.living.length), effect.budget);
    }
    expect(outcomes[5]).toMatchObject({ play: true });
    expect(outcomes[5]).toHaveProperty('budget');
    expect(outcomes[3]).toStrictEqual({ play: false });
  }, timeoutOf);
});

describe('the reveal tours against the real server: the absorber tour and the halt', () => {
  it('FR-345 (real server) a clock match with L2 = 2 s and one with L2 = 0 give an absorber tour with the application of each round with two candidates, after the C2 close', async () => {
    for (const l2 of [2, 0]) {
      const h = await startReads({ service: { scheduler: true } });
      const { id } = makeMatch(h, `t-a${l2}`, { timing: { i: 60, l1: 20, l2 } });
      const v = startViewer({ port: h.port, matchId: id });
      await playToEnd(h, id, v, () => nextClockStep(h));
      const reveals = revealsOf(h, id);
      const wanted = reveals.filter((e) => e.candidates.length >= 2).map((e) => e.round);
      // The dev match has rounds with two or more candidates (otherwise this test would prove nothing).
      expect(wanted.length).toBeGreaterThan(0);
      expect(v.scene.absorberTours.map((x) => x.to)).toStrictEqual(wanted);
      for (const { to, tour, at } of v.scene.absorberTours) {
        const reveal = reveals.find((e) => e.round === to)!;
        const record = v.model().records.get(to)!;
        expect(tour.victim).toBe(reveal.victim);
        expect([...tour.candidates].sort((a, b) => a - b)).toStrictEqual([...reveal.candidates].sort((a, b) => a - b));
        expect(tour.absorber).toBe(record.absorber);
        expect(at).toBe(v.clock.now());
        // The budget is the time to the next C1 (I - L1 - L2) less the margin and the label step, from the application instant; none for the last round.
        const gap = (60 - 20 - l2) * 1000;
        if (to < v.model().totalRounds) {
          // The viewer's clock is frozen, so its estimate lags the application instant: the budget is at least the gap less the margins.
          expect(tour.budget).toBeGreaterThan(gap - 3000);
          expect(scaleFor(nominalEnd('absorber', tour.candidates.length), tour.budget)).toStrictEqual({ play: true });
        }
        else expect(tour.budget).toBeUndefined();
      }
      // The victim tours: one per round, none above the rounds played.
      expect(v.scene.victimTours.map((x) => x.effect.round)).toStrictEqual(reveals.map((e) => e.round));
      expectNoRequestAboveN(v);
      expect(v.scene.failures).toStrictEqual([]);
    }
  }, timeoutOf);

  it('FR-349 (real server) manual timing gives nominal tours: no budget on any victim or absorber tour, and one victim tour per round', async () => {
    const h = await startReads({ service: { scheduler: true } });
    const { id } = makeMatch(h, 't-m', { timing: 'manual' });
    const v = startViewer({ port: h.port, matchId: id });
    await playToEnd(h, id, v, () => advanceSteps(h, id, 1));
    const reveals = revealsOf(h, id);
    expect(v.scene.victimTours.map((x) => x.effect.round)).toStrictEqual(reveals.map((e) => e.round));
    for (const { effect } of v.scene.victimTours) expect(effect.budget).toBeUndefined();
    expect(v.scene.absorberTours.map((x) => x.to)).toStrictEqual(reveals.filter((e) => e.candidates.length >= 2).map((e) => e.round));
    for (const { tour } of v.scene.absorberTours) expect(tour.budget).toBeUndefined();
    expectNoRequestAboveN(v);
  }, timeoutOf);

  it('FR-316 (real server) a halt during a tour completes it at once', async () => {
    await withTempDirAsync(async (dir) => {
      const folder = join(dir, 'pkg');
      mkdirSync(folder);
      for (const file of ['map.json', 'ids.png', 'presentation.json']) copyFileSync(join(DEV_DIR, file), join(folder, file));
      const h = await startReads({ service: { folders: { dev: folder } } });
      const { id } = makeMatch(h, 't-h', { timing: 'manual' });
      const v = startViewer({ port: h.port, matchId: id });
      await until(() => v.scene.draws.length === 1, 'the first drawing');
      await until(() => v.requests.some((r) => r.url.includes('/events')), 'the stream');
      await step(h, id, v, () => advanceSteps(h, id, 1));
      await until(() => v.scene.victimTours.length === 1, 'the victim tour');
      expect(v.scene.completes).toStrictEqual([]);
      writeFileSync(join(folder, 'map.json'), `${readFileSync(join(DEV_DIR, 'map.json'), 'utf8')} `);
      expect(h.service.advance({ credential: OPERATOR, matchId: id, body: { round: 1, step: 'phase-2-close' } }).ok).toBe(false);
      await until(() => v.model().stage === 'halted', 'the halt');
      await until(() => v.scene.completes.length === 1, 'the tour to be completed');
      expect(v.model().touring).toBe(false);
      expect(v.scene.victimTours).toHaveLength(1);
      expect(v.scene.failures).toStrictEqual([]);
    });
  }, timeoutOf);
});
