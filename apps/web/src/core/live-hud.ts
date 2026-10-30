// The pure side of the match screen HUD (spec 010 FR-358, FR-363, FR-365): what the top bar says and which state card shows, from the
// live model and the existing panel view. No DOM; every sentence comes from the strings module.
import type { Stage } from '@mbrg/protocol';
import { estimateAt, type LiveModel } from './live-model';
import { countdownTime, errorText, formatCountdown, haltText, type LiveErrorKind } from './live-text';
import type { FactionName, LivePanelView } from './live-view';
import { STRINGS, fillTemplate } from './strings';

/** What the screen shows as a whole: the map with its HUD (`live`, `replay`) or a state that explains itself. */
export type HudState = 'loading' | 'live' | 'replay' | 'reconnecting' | 'halted' | 'finished';

/**
 * The state of the screen. Loading until the first drawing; then the connection notice wins over everything else, then the end
 * of the match (finished, halted), then a replay (an earlier round than N is on the map) or the live round.
 */
export function hudState(model: LiveModel): HudState {
  if (model.displayed === undefined) return 'loading';
  if (model.wait !== undefined) return 'reconnecting';
  if (model.stage === 'finished') return 'finished';
  if (model.stage === 'halted') return 'halted';
  return model.displayed < model.applied ? 'replay' : 'live';
}

export interface TopBar {
  readonly round: string | undefined;
  readonly phase: string;
  readonly alive: number | undefined;
  readonly countdown: string | undefined;
  /** The player chip: an empty slot until spec 011 fills it. */
  readonly chip: undefined;
}

const PHASES: Readonly<Record<Stage, string>> = {
  'phase-1': STRINGS.hudPhase1,
  'phase-2': STRINGS.hudPhase2,
  locked: STRINGS.hudPhaseLocked,
  finished: STRINGS.hudPhaseFinished,
  halted: STRINGS.hudPhaseHalted,
  lobby: STRINGS.hudPhaseLobby,
  expired: STRINGS.hudPhaseExpired,
};

/** The factions with territories in the displayed state; undefined before the first drawing. */
export const aliveCount = (panel: LivePanelView): number | undefined =>
  panel.round === undefined ? undefined : panel.legend.filter((l) => l.alive).length;

/** The top bar: round, phase, factions alive, countdown. It never names the victim or the winner (the command panel does). */
export const topBar = (model: LiveModel, panel: LivePanelView, at: number): TopBar => ({
  round: panel.round,
  phase: PHASES[model.stage],
  alive: aliveCount(panel),
  countdown: countdownTime(model.stage, model.timing, model.schedule, estimateAt(model, at)),
  chip: undefined,
});

export interface StateCard {
  readonly title: string;
  readonly text: string;
}

/** The card of a state that has one (loading, reconnecting, finished, halted); the live and replay screens have none. */
export function stateCard(state: HudState, model: LiveModel, at: number, factions: readonly FactionName[]): StateCard | undefined {
  const nameOf = (faction: number): string => factions.find((f) => f.id === faction)?.name ?? String(faction);
  switch (state) {
    case 'loading':
      return { title: STRINGS.hudLoadingTitle, text: STRINGS.hudLoadingText };
    case 'reconnecting':
      return {
        title: STRINGS.hudReconnectingTitle,
        text: fillTemplate(STRINGS.hudReconnectingText, { time: formatCountdown((model.wait?.until ?? at) - at) }),
      };
    case 'finished':
      return {
        title: fillTemplate(STRINGS.hudFinishedTitle, { name: model.winner === undefined ? '' : nameOf(model.winner) }),
        text: fillTemplate(STRINGS.hudFinishedText, { total: model.totalRounds }),
      };
    case 'halted':
      return { title: STRINGS.hudHaltedTitle, text: model.haltReason === undefined ? STRINGS.liveStageHalted : haltText(model.haltReason) };
    default:
      return undefined;
  }
}

/** The card of an error that ends the scene: one title, the sentence of the existing message. */
export const errorCard = (kind: LiveErrorKind): StateCard => ({ title: STRINGS.hudErrorTitle, text: errorText(kind) });
