import { describe, expect, it } from 'vitest';
import type { LiveModel } from '../src/core/live-model';
import { overlayOf } from '../src/core/round-overlay';
import { STRINGS } from '../src/core/strings';
import { Driver, MATCH_ID, eventsOfRound, scripted } from './helpers/scripted-match';

async function phase1(): Promise<{ model: LiveModel; d: Driver }> {
  const s = await scripted();
  const d = new Driver(s, MATCH_ID);
  await d.load(0);
  return { model: d.model, d };
}

describe('FR-409 the overlays between the close of the predictions and the reveal', () => {
  it('FR-409 no overlay while phase 1 is open', async () => {
    const { model } = await phase1();
    expect(overlayOf(model, false)).toBeUndefined();
  });

  it('FR-409 phase 1 closed and the victim not revealed yet: PREDICCIONES FINALIZADAS', async () => {
    const { d } = await phase1();
    await d.events(eventsOfRound(d.s, 1).slice(0, 3));
    const closed: LiveModel = { ...d.model, victim: undefined };
    expect(overlayOf(closed, false)).toBe(STRINGS.overlayFinalised);
    expect(STRINGS.overlayFinalised).toBe('PREDICCIONES FINALIZADAS');
  });

  it('FR-409 while the reveal tour runs: REVELANDO...', async () => {
    const { d } = await phase1();
    await d.events(eventsOfRound(d.s, 1).slice(0, 3));
    expect(overlayOf(d.model, true)).toBe(STRINGS.overlayRevealing);
    expect(STRINGS.overlayRevealing).toBe('REVELANDO\u2026');
  });

  it('FR-409 once the victim is shown (tour over, phase 2 open) there is no overlay, and a replay never has one', async () => {
    const { d } = await phase1();
    await d.events(eventsOfRound(d.s, 1).slice(0, 3));
    expect(overlayOf(d.model, false)).toBeUndefined();
    expect(overlayOf({ ...d.model, victim: undefined, displayed: 0, applied: 2 }, false)).toBeUndefined();
  });

  it('FR-409 a locked or finished match with no victim on hand gets no overlay', async () => {
    const { d } = await phase1();
    await d.events(eventsOfRound(d.s, 1).slice(0, 3));
    expect(overlayOf({ ...d.model, stage: 'locked', victim: undefined }, false)).toBeUndefined();
    expect(overlayOf({ ...d.model, stage: 'finished', victim: undefined }, false)).toBeUndefined();
  });

  it('FR-409 the overlay text holds no victim, absorber or faction name', () => {
    expect(STRINGS.overlayFinalised).not.toMatch(/\{/);
    expect(STRINGS.overlayRevealing).not.toMatch(/\{/);
  });
});
