// The live and replay marks of the match screen (spec 010 FR-363, FR-364): the band that says the view is not live, the "live"
// mark, and the selector of rounds (played rounds and the round in play). Pure: the shell only draws what these functions return.
import { describe, expect, it } from 'vitest';
import type { Stage } from '@mbrg/protocol';
import { inPlayStage } from '../src/core/live-hud';
import {
  TRACK_METRICS,
  liveMark,
  parseJumpRound,
  replayBand,
  roundTrack,
  roundWindow,
  shiftWindow,
  stripScroll,
  swipeShift,
  trackTarget,
  windowCapacity,
  windowPageStep,
} from '../src/core/live-track';
import { controlsState, navigate } from '../src/core/navigation';
import { STRINGS } from '../src/core/strings';
import { Driver, eventsOfRound, scripted, type Scripted } from './helpers/scripted-match';

async function at(s: Scripted, n: number, displayed?: number) {
  const d = new Driver(s);
  await d.load(0);
  for (let k = 1; k <= n; k++) await d.events(eventsOfRound(s, k));
  return displayed === undefined ? d.model : { ...d.model, displayed };
}

describe('FR-363 live and replay', () => {
  it('FR-363 on the live round there is an "en directo" mark, no band, and "Siguiente" is disabled', async () => {
    const s = await scripted();
    const model = await at(s, 2);
    expect(liveMark(model)).toBe(STRINGS.hudLive);
    expect(replayBand(model)).toBeUndefined();
    expect(controlsState(model.displayed as number, model.applied).nextDisabled).toBe(true);
  });

  it('FR-363 on an earlier round the band names both rounds, offers the way back, and the mark is gone; "Siguiente" is enabled', async () => {
    const s = await scripted();
    const model = await at(s, 3, 1);
    expect(liveMark(model)).toBeUndefined();
    const band = replayBand(model);
    expect(band?.text).toBe('Repasando la ronda 1. El directo va por la ronda 3.');
    expect(band?.action).toBe(STRINGS.hudBackToLive);
    expect(controlsState(1, model.applied).nextDisabled).toBe(false);
  });

  it('FR-363 the way back is the jump to the live round', async () => {
    const s = await scripted();
    const model = await at(s, 3, 1);
    expect(replayBand(model)?.target).toBe('last');
  });

  it('FR-363 no band and no mark before the first drawing, while reconnecting, or when the match is over', async () => {
    const s = await scripted();
    const model = await at(s, 3, 1);
    expect(replayBand({ ...model, wait: { until: 5 } as never })).toBeUndefined();
    expect(liveMark({ ...model, displayed: undefined })).toBeUndefined();
    expect(replayBand({ ...model, stage: 'finished', winner: 1 })).toBeUndefined();
    expect(liveMark({ ...(await at(s, 3)), stage: 'finished', winner: 1 })).toBeUndefined();
  });
});

describe('FR-364 FR-442 the selector of rounds', () => {
  // Round 0 (Inicio, FR-444) always leads the list; the ids below are the rounds after it.
  const ids = (track: ReturnType<typeof roundTrack>): number[] => track.items.map((i) => i.round).filter((r) => r > 0);

  it('FR-442 it lists the rounds played and the round in play, each marked past, current, ahead or future, with the live round flagged', () => {
    const track = roundTrack(8, 2, 3, true);
    expect(track.items.map((i) => [i.round, i.state, i.live])).toStrictEqual([
      [0, 'past', false],
      [1, 'past', false],
      [2, 'current', false],
      [3, 'ahead', true],
      [4, 'future', false],
    ]);
  });

  it('FR-364 when the displayed round is the live one the current dot is the live dot', () => {
    const track = roundTrack(8, 3, 3, false);
    expect(track.items[3]).toStrictEqual({ round: 3, state: 'current', live: true });
  });

  it('FR-442 the round in play is listed only while a round is in play and never beyond the total', () => {
    expect(ids(roundTrack(8, 3, 3, true))).toStrictEqual([1, 2, 3, 4]);
    expect(ids(roundTrack(8, 3, 3, false))).toStrictEqual([1, 2, 3]);
    expect(ids(roundTrack(4, 4, 4, true))).toStrictEqual([1, 2, 3, 4]);
  });

  it('FR-442 the total is not revealed: rounds that are neither played nor in play are not listed, with 4 rounds or with 240', () => {
    expect(ids(roundTrack(4, 1, 1, true))).toStrictEqual([1, 2]);
    expect(ids(roundTrack(240, 17, 40, true))).toHaveLength(41);
    expect(ids(roundTrack(240, 0, 0, true))).toStrictEqual([1]);
  });

  it('FR-442 there is always one list of items, however many rounds: no slider', () => {
    const track = roundTrack(240, 17, 200, true);
    expect(Object.keys(track).sort()).toStrictEqual(['items', 'label']);
    expect(track.items).toHaveLength(202);
  });

  it('FR-442 the label names the displayed round without a total, and none at Inicio (the Inicio chip says it)', () => {
    expect(roundTrack(8, 3, 5, true).label).toBe('Ronda 3');
    expect(roundTrack(8, 0, 5, true).label).toBe('');
    expect(roundTrack(8, 3, 5, true).label).not.toMatch(/ de /);
  });

  it('FR-364 a dot is a target only up to the live round; the round in play is not', () => {
    const track = roundTrack(8, 2, 3, true);
    expect(track.items.map((i) => trackTarget(i))).toStrictEqual([{ to: 0 }, { to: 1 }, { to: 2 }, { to: 3 }, undefined]);
  });

  it('FR-444 the selector leads with an Inicio entry (round 0), always present, that is a target; the first button goes to it', () => {
    for (const [displayed, applied, inPlay] of [[0, 0, true], [2, 3, true], [3, 3, false], [0, 5, false]] as const) {
      const track = roundTrack(8, displayed, applied, inPlay);
      expect(track.items[0]).toMatchObject({ round: 0 });
      expect(trackTarget(track.items[0]!)).toStrictEqual({ to: 0 });
    }
    expect(roundTrack(8, 0, 3, true).items[0]!.state).toBe('current');
    expect(navigate(3, 3, 'first')).toBe(0);
  });

  it('FR-444 with N = 0 the list is Inicio (current and live) and the round in play, which is not a target', () => {
    const track = roundTrack(4, 0, 0, true);
    expect(track.items.map((i) => [i.round, i.state])).toStrictEqual([[0, 'current'], [1, 'future']]);
    expect(track.items[0]!.live).toBe(true);
  });

  it('FR-442 the in-play stages are the three that run a window', () => {
    expect(['phase-1', 'phase-2', 'locked', 'finished', 'halted', 'lobby'].map((s) => inPlayStage(s as Stage))).toStrictEqual([true, true, true, false, false, false]);
  });
});

describe('FR-442 the strip keeps the current round in view', () => {
  it('FR-442 the current item is centred when it fits, and the scroll stays inside the content', () => {
    expect(stripScroll({ left: 500, width: 44, view: 200, content: 1000 })).toBe(422);
    expect(stripScroll({ left: 10, width: 44, view: 200, content: 1000 })).toBe(0);
    expect(stripScroll({ left: 980, width: 44, view: 200, content: 1024 })).toBe(824);
    expect(stripScroll({ left: 10, width: 44, view: 300, content: 200 })).toBe(0);
  });
});

describe('spec 034 FR-660..FR-666 NFR-170 windowed round timeline and jump-to-round', () => {
  it('FR-660 NFR-170 windowCapacity computes dynamic N for desktop, phone, 3-digit rounds and degenerate widths', () => {
    expect(windowCapacity(310, TRACK_METRICS.desk, 51)).toBeGreaterThanOrEqual(8);
    expect(windowCapacity(310, TRACK_METRICS.desk, 51)).toBeLessThanOrEqual(11);
    expect(windowCapacity(200, TRACK_METRICS.phone, 51)).toBeGreaterThanOrEqual(4);
    expect(windowCapacity(200, TRACK_METRICS.phone, 51)).toBeLessThanOrEqual(6);
    expect(windowCapacity(310, TRACK_METRICS.desk, 250)).toBeLessThanOrEqual(windowCapacity(310, TRACK_METRICS.desk, 51));
    expect(windowCapacity(0, TRACK_METRICS.desk, 10)).toBe(1);
    expect(windowCapacity(-40, TRACK_METRICS.phone, 10)).toBe(1);
    expect(windowCapacity(Number.NaN, TRACK_METRICS.desk, 10)).toBe(1);
  });

  it('FR-660 FR-661 pins Inicio separately and slices at most capacity numbered rounds across 0, 1, 10, 52 and 250 rounds', () => {
    const atZero = roundWindow(51, 0, 0, false, 9);
    expect(atZero.start).toStrictEqual({ round: 0, state: 'current', live: true });
    expect(atZero.items).toStrictEqual([]);
    expect(atZero.canShiftLeft).toBe(false);
    expect(atZero.canShiftRight).toBe(false);
    expect(atZero.canJump).toBe(false);
    expect(atZero.label).toBe('');

    const atOne = roundWindow(51, 1, 1, true, 9);
    expect(atOne.start).toStrictEqual({ round: 0, state: 'past', live: false });
    expect(atOne.items.map((d) => [d.round, d.state])).toStrictEqual([[1, 'current'], [2, 'future']]);
    expect(atOne.canShiftLeft).toBe(false);
    expect(atOne.canShiftRight).toBe(false);

    const atTen = roundWindow(51, 10, 10, false, 9);
    expect(atTen.items.map((d) => d.round)).toStrictEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(atTen.canShiftLeft).toBe(true);
    expect(atTen.canShiftRight).toBe(false);

    const at52 = roundWindow(52, 51, 51, false, 9);
    expect(at52.start.round).toBe(0);
    expect(at52.items.map((d) => d.round)).toStrictEqual([43, 44, 45, 46, 47, 48, 49, 50, 51]);
    expect(at52.items[at52.items.length - 1]).toStrictEqual({ round: 51, state: 'current', live: true });
    expect(at52.canShiftLeft).toBe(true);
    expect(at52.canShiftRight).toBe(false);

    const at250 = roundWindow(260, 250, 250, true, 8);
    expect(at250.items).toHaveLength(8);
    expect(at250.items.map((d) => d.round)).toStrictEqual([244, 245, 246, 247, 248, 249, 250, 251]);
    expect(at250.items[7]!.state).toBe('future');
    expect(trackTarget(at250.items[7]!)).toBeUndefined();
  });

  it('FR-660 slides automatically when displayed moves outside the window, and keeps offset while replaying when live advances', () => {
    // Window showing 43..51; user jumps to round 12 -> slides so 12 is visible.
    const jumped = roundWindow(51, 12, 51, false, 9, 43, true);
    expect(jumped.items.some((d) => d.round === 12)).toBe(true);
    expect(jumped.offset).toBe(12);

    // User is replaying round 12 with window at 12..20; live advances from 51 to 52 without focus change -> window stays at 12..20.
    const replayAdvance = roundWindow(60, 12, 52, true, 9, 12, false);
    expect(replayAdvance.offset).toBe(12);
    expect(replayAdvance.canShiftRight).toBe(true);

    // User is viewing Inicio (0) with applied >= 1 -> label stays reachable ("Ronda 0") without repeating "Inicio".
    const atInicio = roundWindow(51, 0, 51, false, 9, 1, true);
    expect(atInicio.label).toBe('Ronda 0');
    expect(atInicio.label).not.toContain(STRINGS.hudTrackStart);
    expect(atInicio.canJump).toBe(true);
  });

  it('FR-662 shiftWindow, windowPageStep and swipeShift clamp to [1, maxStart] without changing displayed round', () => {
    expect(windowPageStep(9)).toBeGreaterThanOrEqual(4);
    expect(windowPageStep(5)).toBeGreaterThanOrEqual(2);
    expect(windowPageStep(1)).toBe(1);

    expect(shiftWindow(43, 51, 9, -8)).toBe(35);
    expect(shiftWindow(3, 51, 9, -8)).toBe(1);
    expect(shiftWindow(40, 51, 9, 8)).toBe(43);
    expect(shiftWindow(1, 5, 9, 4)).toBe(1);

    // Horizontal swipe left (negative dx) shifts window right (positive delta); small jitter ignored.
    expect(swipeShift(-80, 40)).toBe(2);
    expect(swipeShift(80, 40)).toBe(-2);
    expect(swipeShift(-10, 40)).toBe(0);
  });

  it('FR-663 FR-666 parseJumpRound validates [0, applied] and never reveals total rounds', () => {
    expect(parseJumpRound('0', 51)).toStrictEqual({ outcome: 'ok', round: 0 });
    expect(parseJumpRound(' 27 ', 51)).toStrictEqual({ outcome: 'ok', round: 27 });
    expect(parseJumpRound('51', 51)).toStrictEqual({ outcome: 'ok', round: 51 });

    for (const bad of ['', '   ', 'abc', '-1', '+5', '3.5', '52', '193']) {
      const res = parseJumpRound(bad, 51);
      expect(res.outcome, bad).toBe('invalid');
      if (res.outcome === 'invalid') {
        expect(res.message).toContain('0');
        expect(res.message).toContain('51');
        expect(res.message).not.toContain('193');
      }
    }
  });

  it('FR-666 anti-spoiler: window never lists beyond applied+1 or exposes totalRounds', () => {
    const w = roundWindow(240, 17, 40, true, 9);
    expect(w.maxJump).toBe(40);
    expect(w.count).toBe(41);
    expect(w.label).toBe('Ronda 17');
    expect(w.label).not.toContain('240');
    expect(w.label).not.toMatch(/ de /);
    const atLive = roundWindow(240, 40, 40, true, 9);
    expect(Math.max(...atLive.items.map((d) => d.round))).toBe(41);
  });
});
