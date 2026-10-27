// The pure side of the match screen HUD (spec 010 FR-358, FR-363 classification, FR-365): what the top bar says and which state
// card shows, from the live model and the existing panel view. No DOM here.
import { describe, expect, it } from 'vitest';
import { startLive, type LiveModel } from '../src/core/live-model';
import { aliveCount, errorCard, hudState, stateCard, topBar, type HudState } from '../src/core/live-hud';
import { errorText, type LiveErrorKind } from '../src/core/live-text';
import { panelView } from '../src/core/live-view';
import { STRINGS } from '../src/core/strings';
import { DEV_PRESENTATION } from './helpers/dev-map';
import { Driver, MATCH_ID, publicAt, scripted, type Scripted } from './helpers/scripted-match';

const factions = DEV_PRESENTATION.factions.map((f) => ({ id: f.id, name: f.name }));

/** A model loaded at N = n rounds, displaying N. */
async function loaded(s: Scripted, n: number): Promise<LiveModel> {
  const d = new Driver(s);
  await d.load(n);
  return d.model;
}

describe('FR-358 the top bar', () => {
  it('FR-358 it shows the round, the phase, the factions alive and the countdown, and no player chip', async () => {
    const s = await scripted();
    const model = await loaded(s, 1);
    const panel = panelView(model, 10_000, factions);
    const bar = topBar(model, panel, 10_000);
    expect(bar.round).toBe(panel.round);
    expect(bar.round).toContain('1');
    expect(bar.alive).toBe(aliveCount(panel));
    expect(bar.alive).toBe(factions.length - 1);
    expect(bar.countdown).toBeUndefined();
    expect(bar.chip).toBeUndefined();
  });

  it('FR-358 with a running clock the countdown is the time alone, from the estimate (not the sentence of the panel)', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.feed({ type: 'public', at: d.at, match: publicAt(s, 1, { timing: { i: 120, l1: 30, l2: 10 }, schedule: { c1: 65_000, c2: 125_000, a: 305_000 } }) });
    const panel = panelView(d.model, 10_000, factions);
    expect(panel.countdown).toBe('Próximo paso en 1:00');
    expect(topBar(d.model, panel, 10_000).countdown).toBe('1:00');
    expect(topBar(d.model, panel, 12_500).countdown).toBe('0:58');
  });

  it('FR-358 the phase text follows the stage: one short text per stage, all different', async () => {
    const s = await scripted();
    const model = await loaded(s, 1);
    const texts = (['phase-1', 'phase-2', 'locked', 'finished', 'halted'] as const).map((stage) => topBar({ ...model, stage }, panelView({ ...model, stage }, 10_000, factions), 10_000).phase);
    expect(new Set(texts).size).toBe(5);
    expect(texts[0]).toBe(STRINGS.hudPhase1);
    expect(texts[1]).toBe(STRINGS.hudPhase2);
    for (const text of texts) expect(text.length).toBeGreaterThan(0);
  });

  it('FR-358 the top bar never names the victim or the winner (the command panel does, under the reveal rule)', async () => {
    const s = await scripted();
    const model = await loaded(s, 1);
    const bar = topBar({ ...model, stage: 'phase-2' }, panelView({ ...model, stage: 'phase-2' }, 10_000, factions), 10_000);
    expect(Object.keys(bar).sort()).toStrictEqual(['alive', 'chip', 'countdown', 'phase', 'round']);
  });

  it('FR-358 the alive count is the number of factions with territories in the legend, and undefined before the first drawing', async () => {
    const s = await scripted();
    const panel = panelView(await loaded(s, 2), 10_000, factions);
    expect(aliveCount(panel)).toBe(panel.legend.filter((l) => l.alive).length);
    expect(aliveCount(panelView(startLive(MATCH_ID).model, 10_000, factions))).toBeUndefined();
  });
});

describe('FR-365 the states of the HUD', () => {
  it('FR-365 the state follows the model: loading, live, reconnecting, finished, halted', async () => {
    const s = await scripted();
    const live = await loaded(s, 1);
    const states: [string, HudState][] = [
      ['fresh', hudState(startLive(MATCH_ID).model)],
      ['live', hudState(live)],
      ['reconnecting', hudState({ ...live, wait: { until: 20_000 } as never })],
      ['finished', hudState({ ...live, stage: 'finished', winner: 1 })],
      ['halted', hudState({ ...live, stage: 'halted', haltReason: 'map-changed' })],
    ];
    expect(states.map(([, v]) => v)).toStrictEqual(['loading', 'live', 'reconnecting', 'finished', 'halted']);
  });

  it('FR-365 an earlier round than N is a replay, and N is live', async () => {
    const s = await scripted();
    const live = await loaded(s, 3);
    expect(hudState(live)).toBe('live');
    expect(hudState({ ...live, displayed: 1 })).toBe('replay');
    expect(hudState({ ...live, displayed: 3, applied: 3 })).toBe('live');
  });

  it('FR-365 the finished and halted states win over a replay and a live round; reconnecting wins over all but loading', async () => {
    const s = await scripted();
    const live = await loaded(s, 3);
    expect(hudState({ ...live, displayed: 1, stage: 'finished', winner: 2 })).toBe('finished');
    expect(hudState({ ...live, displayed: 1, wait: { until: 1 } as never })).toBe('reconnecting');
    expect(hudState({ ...startLive(MATCH_ID).model, wait: { until: 1 } as never })).toBe('loading');
  });

  it('FR-365 each state has a card with a title and one plain sentence, from the strings module', async () => {
    const s = await scripted();
    const live = await loaded(s, 1);
    expect(stateCard('loading', live, 10_000, factions)).toStrictEqual({ title: STRINGS.hudLoadingTitle, text: STRINGS.hudLoadingText });
    expect(stateCard('live', live, 10_000, factions)).toBeUndefined();
    expect(stateCard('replay', live, 10_000, factions)).toBeUndefined();
    const waiting = { ...live, wait: { until: 70_000 } as never };
    const reconnecting = stateCard('reconnecting', waiting, 10_000, factions);
    expect(reconnecting?.title).toBe(STRINGS.hudReconnectingTitle);
    expect(reconnecting?.text).toContain('1:00');
    const winnerId = factions[1]!.id;
    const finished = stateCard('finished', { ...live, stage: 'finished', winner: winnerId }, 10_000, factions);
    expect(finished?.title).toContain(factions[1]!.name);
    expect(finished?.text).toContain(String(live.totalRounds));
    const halted = stateCard('halted', { ...live, stage: 'halted', haltReason: 'map-changed' }, 10_000, factions);
    expect(halted?.text).toBe(STRINGS.liveHaltMapChanged);
  });

  it('FR-365 every error kind has a card: one title, and the sentence of the existing message', () => {
    const kinds: LiveErrorKind[] = ['unknown-match', 'digest-mismatch', 'insecure-origin', 'both', 'need-match', 'bad-match', 'failure'];
    for (const kind of kinds) {
      const card = errorCard(kind);
      expect(card.title, kind).toBe(STRINGS.hudErrorTitle);
      expect(card.text, kind).toBe(errorText(kind));
    }
  });

  it('FR-365 the cards have no exclamation marks, no "please" and no trailing ellipsis on titles (the content rules)', async () => {
    const s = await scripted();
    const live = await loaded(s, 1);
    const cards = [
      stateCard('loading', live, 0, factions),
      stateCard('reconnecting', { ...live, wait: { until: 5000 } as never }, 0, factions),
      stateCard('finished', { ...live, stage: 'finished', winner: factions[0]!.id }, 0, factions),
      errorCard('unknown-match'),
    ];
    for (const card of cards) {
      expect(card?.title).not.toMatch(/[!]|\.\.\.|…$/);
      expect(card?.text).not.toMatch(/[!]|\bpor favor\b/i);
    }
  });
});
