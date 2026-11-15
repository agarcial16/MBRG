// The phone dock (spec 013 FR-439, FR-440): which tabs exist, which one is open, and when the dock folds. Pure: the shell draws the
// state and tells this module what happened (a press, an animation that starts or ends, a prediction window that opens).
import type { DockTab } from './hud-layout';

/** The tabs of the dock: a player has all four; a spectator has no prediction and no ranking. */
export const dockTabs = (player: boolean): readonly DockTab[] => (player ? ['order', 'chronicle', 'factions', 'ranking'] : ['chronicle', 'factions']);

export interface DockState {
  readonly tab: DockTab;
  readonly folded: boolean;
  /** An animation was running at the last look. */
  readonly held: boolean;
  /** A prediction window was open at the last look. */
  readonly offer: boolean;
}

/** The dock at the start: open on the first tab. */
export const dockStart = (tabs: readonly DockTab[]): DockState => ({ tab: tabs[0] ?? 'chronicle', folded: false, held: false, offer: false });

export interface DockInput {
  readonly tabs: readonly DockTab[];
  /** A victim reveal, a finalised beat or an absorber animation is on screen. */
  readonly held: boolean;
  /** A prediction window is open. */
  readonly offer: boolean;
}

/**
 * The state after looking at the screen. An animation that starts folds the dock and one that ends opens it again (the player's
 * earlier fold does not outlive it); a prediction window that opens selects "Orden" and unfolds the dock (unless an animation
 * holds it). Between those edges the player's own presses rule, so a refresh never undoes them.
 */
export function dockStep(state: DockState, input: DockInput): DockState {
  let { tab, folded } = state;
  if (!input.tabs.includes(tab)) tab = input.tabs[0] ?? tab;
  if (input.held && !state.held) folded = true;
  if (!input.held && state.held) folded = false;
  if (input.offer && !state.offer && input.tabs.includes('order')) {
    tab = 'order';
    folded = input.held;
  }
  return { tab, folded, held: input.held, offer: input.offer };
}

/** A press on a tab: the selected one folds the dock (or unfolds it when folded); another one opens that tab. */
export const dockPress = (state: DockState, tab: DockTab): DockState =>
  tab === state.tab ? { ...state, folded: !state.folded } : { ...state, tab, folded: false };

/** A press on the handle: fold or unfold. */
export const dockHandle = (state: DockState): DockState => ({ ...state, folded: !state.folded });
