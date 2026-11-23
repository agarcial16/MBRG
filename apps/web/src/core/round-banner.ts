// The round banner (spec 013 FR-408): a centred card with the round number, the victim, the absorber and the territories taken, shown for
// 6 s when a round is applied at the live edge. Pure state over the displayed round; the shell draws it and arms one timer to hide it.
import type { LiveModel } from './live-model';
import type { FactionName } from './live-view';
import { STRINGS, fillTemplate } from './strings';

export const BANNER_MS = 6000;

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

export interface BannerDuel {
  readonly eyebrow: string;
  readonly victimId: number;
  readonly victimName: string;
  readonly absorberId: number;
  readonly absorberName: string;
  readonly taken: number;
  /** Whole percentage of map territories controlled by the absorber after this round, when held. */
  readonly controlPct: number | undefined;
  readonly detail: string;
}

export interface BannerView {
  readonly title: string;
  readonly line: string;
  /** False with reduced motion: shown without fade. */
  readonly fade: boolean;
  /** Spec 031: structured duel callout (victim -> absorber and map-control share). */
  readonly duel: BannerDuel;
}

/** The banner on screen at `at`, or none (expired, dismissed, another round on display, no record). */
export function bannerView(state: BannerState, model: LiveModel, factions: readonly FactionName[], at: number, reduced: boolean): BannerView | undefined {
  if (state.round === undefined || state.dismissed || at - state.since >= BANNER_MS || at < state.since) return undefined;
  if (model.displayed !== state.round) return undefined;
  const record = model.records.get(state.round);
  if (record === undefined) return undefined;
  const nameOf = (id: number): string => factions.find((f) => f.id === id)?.name ?? String(id);
  const victimName = nameOf(record.eliminated);
  const absorberName = nameOf(record.absorber);
  const taken = record.transferred.length;
  const line = fillTemplate(STRINGS.hudChronicleApplied, { victim: victimName, absorber: absorberName, count: taken });
  const owners = model.held?.get(state.round);
  let controlPct: number | undefined;
  if (owners !== undefined && owners.size > 0) {
    let owned = 0;
    for (const owner of owners.values()) if (owner === record.absorber) owned++;
    controlPct = Math.round((owned / owners.size) * 100);
  }
  const detail = controlPct === undefined ? line : fillTemplate(STRINGS.bannerDuelDetail, { absorber: absorberName, count: taken, value: controlPct });
  return {
    title: fillTemplate(STRINGS.bannerRound, { round: state.round }),
    line,
    fade: !reduced,
    duel: {
      eyebrow: fillTemplate(STRINGS.bannerDuelEyebrow, { round: state.round }),
      victimId: record.eliminated,
      victimName,
      absorberId: record.absorber,
      absorberName,
      taken,
      controlPct,
      detail,
    },
  };
}

/** The milliseconds until the running banner ends (for the one timer that shows the screen again), or none. */
export function bannerExpiresIn(state: BannerState, at: number): number | undefined {
  if (state.round === undefined || state.dismissed) return undefined;
  const left = state.since + BANNER_MS - at;
  return left > 0 ? left : undefined;
}
