// The phone dock (spec 013 FR-439, FR-440): which tabs exist, when the dock folds by itself and reopens, and the manual fold. Pure.
import { describe, expect, it } from 'vitest';
import { dockHandle, dockPress, dockStart, dockStep, dockTabs, type DockState } from '../src/core/dock';
import { DOCK_TABS } from '../src/core/hud-layout';
import { STRINGS } from '../src/core/strings';

const idle = { held: false, offer: false };

describe('FR-440 the tabs of the dock', () => {
  it('FR-440 a player has Orden, Crónica, Facciones and Ranking, in this order, named by the strings module', () => {
    expect(dockTabs(true)).toStrictEqual(['order', 'chronicle', 'factions', 'ranking']);
    expect(DOCK_TABS.map((t) => t.id)).toStrictEqual(['order', 'chronicle', 'factions', 'ranking']);
    expect(DOCK_TABS.map((t) => t.label)).toStrictEqual([STRINGS.hudTabOrder, STRINGS.hudChronicle, STRINGS.legendTitle, STRINGS.hudTabRanking]);
  });

  it('FR-440 a spectator has no prediction and no ranking: only the chronicle and the factions', () => {
    expect(dockTabs(false)).toStrictEqual(['chronicle', 'factions']);
  });

  it('FR-440 the dock starts open on the first tab', () => {
    expect(dockStart(dockTabs(true))).toStrictEqual({ tab: 'order', folded: false, held: false, offer: false });
    expect(dockStart(dockTabs(false)).tab).toBe('chronicle');
  });

  it('FR-440 pressing a tab selects it and opens the dock', () => {
    const state = dockPress({ ...dockStart(dockTabs(true)), folded: true }, 'factions');
    expect(state).toMatchObject({ tab: 'factions', folded: false });
  });

  it('FR-440 the Orden tab opens by itself when a prediction window opens, once per window', () => {
    const tabs = dockTabs(true);
    let state = dockPress(dockStart(tabs), 'ranking');
    state = dockStep(state, { tabs, ...idle });
    expect(state.tab).toBe('ranking');
    state = dockStep(state, { tabs, held: false, offer: true });
    expect(state).toMatchObject({ tab: 'order', folded: false, offer: true });
    // The player moves to the chronicle while the window stays open: it is not pulled back every refresh.
    state = dockPress(state, 'chronicle');
    state = dockStep(state, { tabs, held: false, offer: true });
    expect(state.tab).toBe('chronicle');
    // The window closes and the next one opens: Orden again.
    state = dockStep(state, { tabs, ...idle });
    state = dockStep(state, { tabs, held: false, offer: true });
    expect(state.tab).toBe('order');
  });

  it('FR-440 a window that opens unfolds a dock the player had folded by hand', () => {
    const tabs = dockTabs(true);
    const folded = dockHandle(dockStart(tabs));
    expect(folded.folded).toBe(true);
    expect(dockStep(folded, { tabs, held: false, offer: true })).toMatchObject({ tab: 'order', folded: false });
  });

  it('FR-440 a tab that the page does not have falls back to the first one', () => {
    const state = dockStep({ ...dockStart(dockTabs(true)), tab: 'ranking' }, { tabs: dockTabs(false), ...idle });
    expect(state.tab).toBe('chronicle');
  });
});

describe('FR-439 the dock folds during an animation and reopens after it', () => {
  const tabs = dockTabs(true);

  it('FR-439 it folds when a victim reveal, a finalised beat or an absorber animation starts, and reopens when it ends', () => {
    let state = dockStart(tabs);
    expect(state.folded).toBe(false);
    state = dockStep(state, { tabs, held: true, offer: false });
    expect(state.folded).toBe(true);
    // Still the same animation: nothing changes on the next refresh.
    expect(dockStep(state, { tabs, held: true, offer: false })).toStrictEqual(state);
    state = dockStep(state, { tabs, ...idle });
    expect(state.folded).toBe(false);
  });

  it('FR-439 the player can unfold it during the animation and it stays so; it is open after the animation anyway', () => {
    let state = dockStep(dockStart(tabs), { tabs, held: true, offer: false });
    state = dockHandle(state);
    expect(state.folded).toBe(false);
    state = dockStep(state, { tabs, held: true, offer: false });
    expect(state.folded).toBe(false);
    state = dockStep(state, { tabs, ...idle });
    expect(state.folded).toBe(false);
  });

  it('FR-439 the player can fold it by hand outside an animation and it stays folded', () => {
    let state: DockState = dockStart(tabs);
    state = dockHandle(state);
    expect(state.folded).toBe(true);
    for (let k = 0; k < 3; k++) state = dockStep(state, { tabs, ...idle });
    expect(state.folded).toBe(true);
    state = dockHandle(state);
    expect(state.folded).toBe(false);
  });

  it('FR-439 pressing the selected tab folds the dock; pressing it again unfolds it; another tab opens that tab', () => {
    let state = dockStart(tabs);
    state = dockPress(state, 'order');
    expect(state.folded).toBe(true);
    state = dockPress(state, 'order');
    expect(state).toMatchObject({ tab: 'order', folded: false });
    state = dockPress(state, 'ranking');
    expect(state).toMatchObject({ tab: 'ranking', folded: false });
  });

  it('FR-439 a manual fold before an animation does not survive it: the dock reopens when the animation ends', () => {
    let state = dockHandle(dockStart(tabs));
    state = dockStep(state, { tabs, held: true, offer: false });
    expect(state.folded).toBe(true);
    state = dockStep(state, { tabs, ...idle });
    expect(state.folded).toBe(false);
  });
});
