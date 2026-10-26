// What the live panel shows (FR-305, NFR-56): one pure function of the model and the instant. The countdown runs from the
// reported-time estimate (the largest reported time plus the time elapsed since it arrived), never from the last reported
// value alone (FR-302). No seed, no pointer readout, no results, and nothing about any round above N.
import { estimateAt, type LiveModel } from './live-model';
import { connectionNotice, countdownText, haltText, nextAnchor, revealMismatchLine, roundLine, stageText, victimLine, winnerLine } from './live-text';
import { controlsState, type ControlsState } from './navigation';
import { legendLine } from './panel-text';

/** A faction of the presentation data: its id and name. */
export interface FactionName {
  readonly id: number;
  readonly name: string;
}

export interface LegendEntry {
  readonly faction: number;
  readonly text: string;
  readonly alive: boolean;
}

export interface LivePanelView {
  /** "Ronda N de T" for the displayed round; none before the first drawing. */
  readonly round: string | undefined;
  readonly stage: string;
  readonly countdown: string | undefined;
  readonly victim: string | undefined;
  readonly winner: string | undefined;
  readonly halt: string | undefined;
  /** The connection notice, while the next attempt waits. */
  readonly notice: string | undefined;
  /** The development-only report of a skipped victim tour (FR-320, D13). */
  readonly mismatch: string | undefined;
  readonly legend: readonly LegendEntry[];
  readonly controls: ControlsState | undefined;
}

/**
 * What the running tour asks of the panel (D12, D19): `revealing` = a victim tour that has not stopped on the victim (the
 * name shows as "revelando..."); `absorbing` = an absorber tour (the legend keeps the counts of the drawn state k - 1);
 * `mismatch` = report a skipped victim tour (development builds only, the shell decides).
 */
export interface TourPanel {
  readonly revealing?: boolean;
  readonly absorbing?: boolean;
  readonly mismatch?: boolean;
}

/** The map view's report of the running tour, as far as the panel needs it. */
export interface TourReport {
  readonly tour: 'victim' | 'absorber';
  readonly still: boolean;
  readonly resultShown: boolean;
  readonly ended: boolean;
}

/**
 * FR-330 FR-343: the panel state of a tour. A full victim tour is `revealing` until its result shows or it ends; a still
 * tour (reduced motion) never is (the name shows at once); an absorber tour keeps the old legend until it ends.
 */
export function panelTourState(run: TourReport | undefined): { readonly revealing: boolean; readonly absorbing: boolean } {
  if (run === undefined) return { revealing: false, absorbing: false };
  if (run.tour === 'absorber') return { revealing: false, absorbing: !run.ended };
  return { revealing: !run.still && !run.resultShown && !run.ended, absorbing: false };
}

/** The panel at the instant `at` (the same clock as the `at` of the model's inputs). */
export function panelView(model: LiveModel, at: number, factions: readonly FactionName[], tour: TourPanel = {}): LivePanelView {
  const nameOf = (faction: number): string => factions.find((f) => f.id === faction)?.name ?? String(faction);
  const displayed = model.displayed;
  // D12: during the absorber tour the legend counts the drawn state k - 1; if it is not held the legend stays empty (never the new counts).
  const legendRound = displayed === undefined ? undefined : tour.absorbing === true ? displayed - 1 : displayed;
  const owners = legendRound === undefined ? undefined : model.held.get(legendRound);
  const counts = new Map<number, number>();
  for (const faction of owners?.values() ?? []) counts.set(faction, (counts.get(faction) ?? 0) + 1);
  const legend: LegendEntry[] =
    owners === undefined
      ? []
      : factions.map((f) => {
          const territories = counts.get(f.id) ?? 0;
          const alive = territories > 0;
          return { faction: f.id, text: legendLine({ faction: f.id, name: f.name, territories, alive }), alive };
        });
  return {
    round: displayed === undefined ? undefined : roundLine(displayed, model.totalRounds),
    stage: stageText(model.stage),
    countdown: countdownText(model.stage, model.timing, model.schedule, estimateAt(model, at)),
    victim: victimLine(model.stage, model.victim?.victim, nameOf, tour.revealing === true),
    winner: winnerLine(model.stage, model.winner, nameOf),
    halt: model.stage === 'halted' && model.haltReason !== undefined ? haltText(model.haltReason) : undefined,
    notice: model.wait === undefined ? undefined : connectionNotice(model.wait.until, at),
    mismatch: tour.mismatch === true ? revealMismatchLine() : undefined,
    legend,
    controls: displayed === undefined ? undefined : controlsState(displayed, model.applied),
  };
}

/** True while something on the panel changes with the clock alone: a countdown or the time of the next attempt. */
export function clockDriven(model: LiveModel): boolean {
  if (model.fatal !== undefined) return false;
  return model.wait !== undefined || (model.timing !== 'manual' && nextAnchor(model.stage, model.schedule) !== undefined);
}
