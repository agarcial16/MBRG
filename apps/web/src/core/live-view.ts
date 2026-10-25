// What the live panel shows (FR-305, NFR-56): one pure function of the model and the instant. The countdown runs from the
// reported-time estimate (the largest reported time plus the time elapsed since it arrived), never from the last reported
// value alone (FR-302). No seed, no pointer readout, no results, and nothing about any round above N.
import { estimateAt, type LiveModel } from './live-model';
import { connectionNotice, countdownText, haltText, nextAnchor, roundLine, stageText, victimLine, winnerLine } from './live-text';
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
  readonly legend: readonly LegendEntry[];
  readonly controls: ControlsState | undefined;
}

/** The panel at the instant `at` (the same clock as the `at` of the model's inputs). */
export function panelView(model: LiveModel, at: number, factions: readonly FactionName[]): LivePanelView {
  const nameOf = (faction: number): string => factions.find((f) => f.id === faction)?.name ?? String(faction);
  const displayed = model.displayed;
  const owners = displayed === undefined ? undefined : model.held.get(displayed);
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
    victim: victimLine(model.stage, model.victim?.victim, nameOf),
    winner: winnerLine(model.stage, model.winner, nameOf),
    halt: model.stage === 'halted' && model.haltReason !== undefined ? haltText(model.haltReason) : undefined,
    notice: model.wait === undefined ? undefined : connectionNotice(model.wait.until, at),
    legend,
    controls: displayed === undefined ? undefined : controlsState(displayed, model.applied),
  };
}

/** True while something on the panel changes with the clock alone: a countdown or the time of the next attempt. */
export function clockDriven(model: LiveModel): boolean {
  if (model.fatal !== undefined) return false;
  return model.wait !== undefined || (model.timing !== 'manual' && nextAnchor(model.stage, model.schedule) !== undefined);
}
