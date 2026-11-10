// The finalised beat (spec 013 FR-409): when a prediction window closes the viewer holds the rest of the stream for about two seconds
// and shows PREDICCIONES FINALIZADAS before anything of the reveal. The decision is pure; the hold is a field of the live model.
import { describe, expect, it } from 'vitest';
import type { LiveEffect, LiveModel } from '../src/core/live-model';
import { BEAT_MS, beatOf, type BeatInput } from '../src/core/finalised-beat';
import { offerOf } from '../src/core/predict-model';
import { overlayOf } from '../src/core/round-overlay';
import { TOUR_PARAMS } from '../src/core/tour-params';
import { STRINGS } from '../src/core/strings';
import { Driver, MATCH_ID, eventsOfRound, publicAt, scripted, wire, matchEventsOfRound, type Scripted } from './helpers/scripted-match';

const fresh: BeatInput = { halted: false, round: 3, displayed: 2, applied: 2, estimate: 9000, closedAt: 8990, at: 10_000 };

describe('FR-409 the beat is a named constant of about two seconds', () => {
  it('FR-409 BEAT_MS is 2,000 and shorter than the oldest reveal that still plays', () => {
    expect(BEAT_MS).toBe(2000);
    expect(BEAT_MS).toBeLessThan(TOUR_PARAMS.lateMs);
  });
});

describe('FR-409 beatOf: when a close starts the beat', () => {
  it('FR-409 a fresh close of the round in play, seen at the live edge, holds until at + BEAT_MS', () => {
    expect(beatOf(fresh)).toStrictEqual({ round: 3, until: 10_000 + BEAT_MS });
  });

  it('FR-409 no beat for a halted match, a replay, a round not next, or a late close', () => {
    expect(beatOf({ ...fresh, halted: true })).toBeUndefined();
    expect(beatOf({ ...fresh, displayed: 1 })).toBeUndefined();
    expect(beatOf({ ...fresh, displayed: undefined })).toBeUndefined();
    expect(beatOf({ ...fresh, round: 2 })).toBeUndefined();
    expect(beatOf({ ...fresh, round: 5 })).toBeUndefined();
    expect(beatOf({ ...fresh, closedAt: fresh.estimate - TOUR_PARAMS.lateMs - 1 })).toBeUndefined();
  });

  it('FR-409 a close exactly lateMs old still has its beat; a close ahead of the estimate too', () => {
    expect(beatOf({ ...fresh, closedAt: fresh.estimate - TOUR_PARAMS.lateMs })).toBeDefined();
    expect(beatOf({ ...fresh, closedAt: fresh.estimate + 500 })).toBeDefined();
  });
});

/** A driver loaded at N = 0 with the beats left to the test (`beats` on). */
async function live(): Promise<{ d: Driver; s: Scripted }> {
  const s = await scripted();
  const d = new Driver(s, MATCH_ID);
  d.beats = true;
  await d.feed({ type: 'public', at: d.at, match: publicAt(s, 0) });
  return { d, s };
}
const types = (effects: readonly LiveEffect[]): string[] => effects.map((e) => e.type);

describe('FR-409 FR-322 the live model holds the reveal for the beat', () => {
  it('FR-409 the phase-1 close starts the beat and the reveal waits: no victim, no tour, no schedule', async () => {
    const { d, s } = await live();
    const [closed, revealed, schedule] = eventsOfRound(s, 1) as unknown[];
    const before = d.log.length;
    d.at = 10_100;
    await d.feed({ type: 'event', at: d.at, data: closed });
    expect(d.model.beat?.round).toBe(1);
    expect(d.model.beat?.until).toBe(10_100 + BEAT_MS);
    expect(d.armed).toBe(10_100 + BEAT_MS);
    await d.feed({ type: 'event', at: 10_110, data: revealed });
    await d.feed({ type: 'event', at: 10_120, data: schedule });
    expect(d.model.victim).toBeUndefined();
    expect(d.model.stage).toBe('phase-1');
    expect(d.model.queue).toHaveLength(2);
    expect(types(d.log.slice(before).map((x) => x.effect))).not.toContain('victim-tour');
  });

  it('FR-409 the beat ends at its instant: the victim, the tour and the schedule come together, in order', async () => {
    const { d, s } = await live();
    const [closed, revealed, schedule] = eventsOfRound(s, 1) as unknown[];
    d.at = 10_100;
    await d.feed({ type: 'event', at: d.at, data: closed });
    await d.feed({ type: 'event', at: 10_110, data: revealed });
    await d.feed({ type: 'event', at: 10_120, data: schedule });
    const before = d.log.length;
    await d.tick(10_100 + BEAT_MS - 1);
    expect(d.model.beat).toBeDefined();
    expect(d.model.victim).toBeUndefined();
    await d.tick(10_100 + BEAT_MS);
    expect(d.model.beat).toBeUndefined();
    expect(d.model.victim?.round).toBe(1);
    expect(d.model.stage).toBe('phase-2');
    expect(d.model.queue).toHaveLength(0);
    expect(types(d.log.slice(before).map((x) => x.effect))).toContain('victim-tour');
  });

  it('FR-409 the phase-2 close holds the absorber: round-applied waits for the beat', async () => {
    const { d, s } = await live();
    await d.events(eventsOfRound(s, 1).slice(0, 3));
    expect(d.model.beat).toBeDefined();
    await d.tick(d.model.beat?.until);
    const rest = eventsOfRound(s, 1).slice(3);
    d.at = 12_100;
    await d.feed({ type: 'event', at: d.at, data: rest[0] });
    expect(d.model.beat?.until).toBe(12_100 + BEAT_MS);
    for (const [i, data] of rest.slice(1, 4).entries()) await d.feed({ type: 'event', at: 12_110 + i, data });
    expect(d.model.applied).toBe(0);
    expect(d.model.applying).toBeUndefined();
    await d.tick(12_100 + BEAT_MS);
    expect(d.model.beat).toBeUndefined();
    expect(d.model.applied).toBe(1);
  });

  it('FR-409 no beat when the close is old (a reconnection that replays): the reveal flows at once', async () => {
    const { d, s } = await live();
    const [closed, revealed] = eventsOfRound(s, 1) as unknown[];
    await d.feed({ type: 'event', at: 10_000 + 60_000, data: closed });
    expect(d.model.beat).toBeUndefined();
    await d.feed({ type: 'event', at: 10_000 + 60_010, data: revealed });
    expect(d.model.victim?.round).toBe(1);
  });

  it('FR-409 a resync drops the beat with the frames it held', async () => {
    const { d, s } = await live();
    const [closed, revealed] = eventsOfRound(s, 1) as unknown[];
    await d.feed({ type: 'event', at: 10_100, data: closed });
    await d.feed({ type: 'event', at: 10_110, data: revealed });
    // A gap in the numbers is a protocol fault.
    await d.feed({ type: 'event', at: 10_120, data: wire([{ ...matchEventsOfRound(s, 1)[3]!, seq: 99 } as never])[0] });
    expect(d.model.phase).toBe('resyncing');
    expect(d.model.beat).toBeUndefined();
    expect(d.model.queue).toHaveLength(0);
  });
});

describe('FR-409 the offer and the overlay during the beat', () => {
  it('FR-409 during the beat nothing can be predicted (the player), also in phase 2', async () => {
    const { d, s } = await live();
    const [closed] = eventsOfRound(s, 1) as unknown[];
    await d.feed({ type: 'event', at: 10_100, data: closed });
    expect(offerOf(d.model, { joined: true, revealing: false })).toStrictEqual({ type: 'none', reason: 'finalised' });
    expect(offerOf(d.model, { joined: false, revealing: false })).toStrictEqual({ type: 'none', reason: 'not-joined' });
  });

  it('FR-409 the overlay is PREDICCIONES FINALIZADAS for everybody during the beat and names nobody', async () => {
    const { d, s } = await live();
    expect(overlayOf(d.model, false)).toBeUndefined();
    const [closed] = eventsOfRound(s, 1) as unknown[];
    await d.feed({ type: 'event', at: 10_100, data: closed });
    expect(overlayOf(d.model, false)).toBe(STRINGS.overlayFinalised);
    expect(overlayOf({ ...d.model, displayed: 0, applied: 2 }, false)).toBeUndefined();
    await d.tick(10_100 + BEAT_MS);
    expect(overlayOf(d.model, false)).toBeUndefined();
  });
});

describe('FR-322 nothing of the reveal is on the model during the beat', () => {
  it('FR-322 the held model carries no victim, no candidates and no absorber in any field', async () => {
    const { d, s } = await live();
    await d.feed({ type: 'event', at: 10_100, data: (eventsOfRound(s, 1) as unknown[])[0] });
    await d.feed({ type: 'event', at: 10_110, data: (eventsOfRound(s, 1) as unknown[])[1] });
    const m: LiveModel = d.model;
    expect(m.victim).toBeUndefined();
    expect(m.touring).toBe(false);
    expect(m.skipped).toBe(false);
  });
});

// The wiring is read as text: the shell passes the beat to the session and the panel, and the strings live in one module.
import liveMain from '../src/ui/live-main.ts?raw';
import runner from '../src/ui/live-runner.ts?raw';
import { codeOnly } from './helpers/scan';
import beatSource from '../src/core/finalised-beat.ts?raw';
import modelSource from '../src/core/live-model.ts?raw';

describe('FR-409 the wiring of the beat', () => {
  it('FR-409 the scene tells the session about the beat and draws the overlay from the model', () => {
    expect(liveMain).toContain('finalised: model.beat !== undefined');
    expect(liveMain).toContain('overlayOf(model, shown.revealing)');
  });

  it('FR-409 the runner arms the timer the model asks for and feeds its tick; it knows nothing of the beat', () => {
    expect(runner).toContain("case 'arm-timer'");
    expect(runner).not.toMatch(/beat/i);
  });

  it('FR-409 the model holds frames and ends the hold on a tick; the decision is the pure beatOf', () => {
    expect(modelSource).toContain('beatOf(');
    expect(modelSource).toContain('model.beat !== undefined) return result({ ...model, queue: [...model.queue, frame] }');
    expect(modelSource).toContain('current.beat !== undefined && at >= current.beat.until');
  });

  it('FR-409 the pure module has no clock, no timer and no random source, and the texts are in the strings module', () => {
    expect(codeOnly(beatSource)).not.toMatch(/Date\.now|performance\.now|setTimeout|Math\.random|document|window/);
    expect(STRINGS.predictNoneFinalised).toBe('Predicciones finalizadas.');
  });
});

import { PANEL_CSS } from '../src/ui/live-panel-style';
describe('FR-409 the overlay on the phone keeps clear of the minimap', () => {
  it('FR-409 on the phone the overlay sits at the left of the parchment and is narrower than the space left of the minimap', () => {
    const rule = /\.hud\[data-layout="phone"\] \.hud-overlay \{([^}]*)\}/.exec(PANEL_CSS)?.[1] ?? '';
    expect(rule).toContain('left: 8px');
    expect(rule).toContain('transform: none');
    expect(rule).toContain('box-sizing: border-box');
    expect(rule).toContain('max-width: calc(100vw - 130px)');
  });
});
