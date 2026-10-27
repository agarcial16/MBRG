// The live and replay marks of the match screen (spec 010 FR-363, FR-364): the band that says the view is not live, the "live"
// mark, and the track of rounds (dots up to 12 rounds, a slider above). Pure: the shell only draws what these functions return.
import { describe, expect, it } from 'vitest';
import { liveMark, replayBand, roundTrack, trackTarget } from '../src/core/live-track';
import { controlsState } from '../src/core/navigation';
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

describe('FR-364 the track of rounds', () => {
  it('FR-364 up to 12 rounds the track is one dot per round, each marked past, current, ahead or future, with the live round flagged', () => {
    const track = roundTrack(4, 2, 3);
    expect(track.mode).toBe('dots');
    if (track.mode !== 'dots') return;
    expect(track.items.map((i) => [i.round, i.state, i.live])).toStrictEqual([
      [1, 'past', false],
      [2, 'current', false],
      [3, 'ahead', true],
      [4, 'future', false],
    ]);
  });

  it('FR-364 when the displayed round is the live one the current dot is the live dot', () => {
    const track = roundTrack(4, 3, 3);
    if (track.mode !== 'dots') throw new Error('dots expected');
    expect(track.items[2]).toStrictEqual({ round: 3, state: 'current', live: true });
  });

  it('FR-364 12 rounds are dots and 13 are a slider', () => {
    expect(roundTrack(12, 1, 1).mode).toBe('dots');
    expect(roundTrack(13, 1, 1).mode).toBe('slider');
  });

  it('FR-364 the slider runs from 0 to the live round (never beyond N), with the value and the live marker', () => {
    const track = roundTrack(240, 17, 40);
    expect(track).toStrictEqual({ mode: 'slider', min: 0, max: 40, value: 17, live: 40, total: 240 });
  });

  it('FR-364 a dot is a target only up to the live round; a future round is not', () => {
    const track = roundTrack(4, 2, 3);
    if (track.mode !== 'dots') throw new Error('dots expected');
    expect(track.items.map((i) => trackTarget(i))).toStrictEqual([{ to: 1 }, { to: 2 }, { to: 3 }, undefined]);
  });

  it('FR-364 round 0 is not a dot (the "Primera" control goes there); with N = 0 every dot is in the future and none is live', () => {
    const track = roundTrack(4, 0, 0);
    if (track.mode !== 'dots') throw new Error('dots expected');
    expect(track.items.map((i) => i.state)).toStrictEqual(['future', 'future', 'future', 'future']);
    expect(track.items.some((i) => i.live)).toBe(false);
  });
});
