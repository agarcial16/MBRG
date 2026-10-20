// Texts of the debug panel (FR-156, FR-157, FR-158). Pure: every text is built from the UI strings and a
// scene, so a panel can only show what the scene at round N holds (nothing about later rounds).
import type { PresentationData } from '@mbrg/shared';
import type { Counts } from './label-counts';
import type { FrameStats } from './perf';
import { roundSummary } from './scene';
import type { LegendRow, PointerInfo, Scene } from './scene';
import { fillTemplate, STRINGS } from './strings';

export const seedLine = (scene: Scene): string => fillTemplate(STRINGS.seedLine, { seed: scene.seed });

export const roundStatus = (scene: Scene): string =>
  fillTemplate(STRINGS.roundStatus, { round: scene.round, total: scene.total });

export const livingLine = (scene: Scene): string => fillTemplate(STRINGS.livingLine, { living: scene.living });

/** The record of round N, or the "no record" text at round 0. */
export function recordLine(scene: Scene, presentation: PresentationData): string {
  const summary = roundSummary(scene, presentation);
  if (summary === undefined) return STRINGS.noRecord;
  return fillTemplate(STRINGS.recordLine, {
    eliminated: summary.eliminated,
    absorber: summary.absorber,
    count: summary.transferred,
  });
}

export const legendLine = (row: LegendRow): string =>
  fillTemplate(STRINGS.legendLine, {
    id: row.faction,
    name: row.name,
    count: row.territories,
    state: row.alive ? STRINGS.stateAlive : STRINGS.stateEliminated,
  });

/** The pointer readout; one idle line while the pointer is not over the drawing area. */
export function pointerLines(info: PointerInfo | undefined): string[] {
  if (info === undefined) return [STRINGS.pointerIdle];
  const fill = info.fill === 'land' ? STRINGS.fillLand : info.fill === 'sea' ? STRINGS.fillSea : (info.text ?? STRINGS.outsideMap);
  const lines = [
    fillTemplate(STRINGS.pointerPosition, { x: info.x.toFixed(1), y: info.y.toFixed(1), value: info.value, fill }),
  ];
  if (info.name !== undefined) lines.push(fillTemplate(STRINGS.pointerName, { name: info.name }));
  if (info.owner !== undefined) lines.push(fillTemplate(STRINGS.pointerOwner, { owner: info.owner }));
  return lines;
}

const countsText = (c: Counts): string =>
  [
    fillTemplate(STRINGS.labelCountHorizontal, { count: c.horizontal }),
    fillTemplate(STRINGS.labelCountStraight, { count: c.straight }),
    fillTemplate(STRINGS.labelCountArc, { count: c.arc }),
    fillTemplate(STRINGS.labelCountOffLand, { count: c.offLand }),
    fillTemplate(STRINGS.labelCountNone, { count: c.none }),
  ].join(', ');

/** The label counts of the displayed state, faction labels then territory labels, on one line (FR-214). */
export const labelCountsLine = (c: { faction: Counts; territory: Counts }): string =>
  [
    fillTemplate(STRINGS.labelCountsFaction, { value: countsText(c.faction) }),
    fillTemplate(STRINGS.labelCountsTerritory, { value: countsText(c.territory) }),
  ].join(' | ');

export interface Timings {
  /** Page start to the first drawn frame, ms. */
  load?: number;
  /** Request to drawn frame of the last round change, ms. */
  roundChange?: number;
  /** Time to compute the faction labels and front distances of the last round change, ms (FR-190). */
  labels?: number;
  frames: FrameStats;
}

const ms = (value: number | undefined): string =>
  value === undefined ? STRINGS.perfNone : fillTemplate(STRINGS.perfUnit, { ms: value.toFixed(1) });

/**
 * Load time, last round change and frame statistics, in milliseconds (FR-158), then, once a round change has
 * been measured, the labels and front time (FR-190).
 */
export function perfLines(t: Timings): string[] {
  const hasFrames = t.frames.count > 0;
  const lines = [
    fillTemplate(STRINGS.perfLoad, { ms: ms(t.load) }),
    fillTemplate(STRINGS.perfRound, { ms: ms(t.roundChange) }),
    fillTemplate(STRINGS.perfFrames, {
      count: t.frames.count,
      median: ms(hasFrames ? t.frames.median : undefined),
      p95: ms(hasFrames ? t.frames.p95 : undefined),
    }),
  ];
  if (t.labels !== undefined) lines.push(fillTemplate(STRINGS.perfLabels, { ms: ms(t.labels) }));
  return lines;
}
