// The round banner (spec 013 FR-408): a centred card with the round number, the victim, the absorber and the territories taken, shown for
// 3 s when a round is applied at the live edge. Pure state over the displayed round; the shell draws it and arms one timer to hide it.
import type { LiveModel } from './live-model';
import type { FactionName } from './live-view';
import { STRINGS, fillTemplate } from './strings';

export const BANNER_MS = 3000;

export interface BannerState {
  /** The round on display the last time the state looked (none before the first sight). */
  readonly seen: number | undefined;
  /** The round whose banner is running or ran. */
  readonly round: number | undefined;
  readonly since: number;
  readonly dismissed: boolean;
}

export const bannerStart: BannerState = { seen: undefined, round: undefined, since: 0, dismissed: false };

export interface BannerInput {
  readonly displayed: number | undefined;
  readonly applied: number;
  /** The absorber tour or the victim reveal is on screen: the round has not visibly ended. */
  readonly absorbing: boolean;
  readonly revealing: boolean;
}

/**
 * The state after looking at the screen at `at`. A banner starts only when the displayed round advanced by exactly one and is the
 * latest applied round (a live application); the first sight, a jump, a replay or a step back start none.
 */
export function bannerNext(state: BannerState, input: BannerInput, at: number): BannerState {
  const { displayed } = input;
  if (displayed === undefined || input.absorbing || input.revealing) return state;
  if (state.seen === displayed) return state;
  const live = state.seen !== undefined && displayed === state.seen + 1 && displayed === input.applied && displayed >= 1;
  return live ? { seen: displayed, round: displayed, since: at, dismissed: false } : { ...state, seen: displayed };
}

/** A tap or a key: the banner goes and does not come back for the same round. */
export const bannerDismiss = (state: BannerState): BannerState => ({ ...state, dismissed: true });

export interface BannerView {
  readonly title: string;
  readonly line: string;
  /** False with reduced motion: shown without fade. */
  readonly fade: boolean;
}

/** The banner on screen at `at`, or none (expired, dismissed, another round on display, no record). */
export function bannerView(state: BannerState, model: LiveModel, factions: readonly FactionName[], at: number, reduced: boolean): BannerView | undefined {
  if (state.round === undefined || state.dismissed || at - state.since >= BANNER_MS || at < state.since) return undefined;
  if (model.displayed !== state.round) return undefined;
  const record = model.records.get(state.round);
  if (record === undefined) return undefined;
  const nameOf = (id: number): string => factions.find((f) => f.id === id)?.name ?? String(id);
  return {
    title: fillTemplate(STRINGS.bannerRound, { round: state.round }),
    line: fillTemplate(STRINGS.hudChronicleApplied, { victim: nameOf(record.eliminated), absorber: nameOf(record.absorber), count: record.transferred.length }),
    fade: !reduced,
  };
}

/** The milliseconds until the running banner ends (for the one timer that shows the screen again), or none. */
export function bannerExpiresIn(state: BannerState, at: number): number | undefined {
  if (state.round === undefined || state.dismissed) return undefined;
  const left = state.since + BANNER_MS - at;
  return left > 0 ? left : undefined;
}
