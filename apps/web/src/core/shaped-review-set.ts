// The shaped and off-land label review scenes of NFR-40 (spec 006): debug-scene addresses on the committed dev map
// that the user accepts by screenshot. The 005 set (`label-review-set.ts`) is untouched. Pure data: the hits below
// were found with the text aspects measured in Chrome (`test/helpers/measured-aspects.ts`, plan D10) and
// `test/shaped-review-set.test.ts` checks that the ordered search still finds each one first, so a rebuilt map, a
// retuned parameter or another aspect cannot silently invalidate the set. The hits depend on the territory
// off-land height: they are recorded for the value in SHAPE_PARAMS and re-pinned when the user chooses it.
import { LABEL_PARAMS } from './label-params';
import { LABEL_SCALES } from './label-review-set';
import type { LabelReviewScene } from './label-review-set';

/** The first territory (entry order) whose drawn frame is of the scene's kind. */
export interface TerritoryHitRecord {
  entry: number;
  name: string;
  shape: 'horizontal' | 'straight' | 'arc' | 'off-land';
  /** Centre of the drawn frame, in map units. */
  centre: { x: number; y: number };
  /** Height of the drawn frame, in map units. */
  height: number;
}

/** The first step (seed ascending, then round) whose absorber changes between two frames of the scene's kind. */
export interface StepHitRecord {
  seed: number;
  /** The step goes from this round to the next. */
  round: number;
  faction: string;
  /** Centres of the absorber's frame before and after the step. */
  before: { x: number; y: number };
  after: { x: number; y: number };
}

/** Recorded territory hits (plan section 12 items 1 to 5 and 7), found over territory labels in entry order. */
export const TERRITORY_HITS = {
  'steep-straight': { entry: 3, name: 'Baviera', shape: 'straight', centre: { x: 1433.5, y: 693.5 }, height: 73 },
  'diagonal-straight': { entry: 10, name: 'Renania-Palatinado', shape: 'straight', centre: { x: 1202.5, y: 635.5 }, height: 17 },
  'arc-cup': { entry: 33, name: 'Alta Francia', shape: 'arc', centre: { x: 914.5, y: 612.5 }, height: 34 },
  'arc-cap': { entry: 1, name: 'Baden-Wurtemberg', shape: 'arc', centre: { x: 1269.5, y: 718.5 }, height: 24 },
  'kept-horizontal': { entry: 2, name: 'Baja Sajonia', shape: 'horizontal', centre: { x: 1279.82275390625, y: 349.5 }, height: 35 },
  'off-land-inland': { entry: 6, name: 'Bremen', shape: 'off-land', centre: { x: 1250.74267578125, y: 320.5 }, height: 5 },
} as const satisfies Record<string, TerritoryHitRecord>;

/** Recorded step hits (plan section 12 item 11), found over seeds 1..1000. */
export const STEP_HITS = {
  'step-arc': { seed: 12, round: 3, faction: 'Portugal', before: { x: 156.5, y: 1447.5 }, after: { x: 590.646484375, y: 1271 } },
} as const satisfies Record<string, StepHitRecord>;

/** Scenes of plan section 12 that have no hit on the dev map, with the reason (proofs in the PR, D12). */
export const DROPPED_SCENES: readonly { label: string; why: string }[] = [
  { label: 'off-land-island', why: 'no territory drawn off-land has a main piece without a land neighbour' },
  { label: 'off-land-leader', why: 'no territory off-land box lies more than the leader gap from its land' },
  { label: 'off-land-faction-fit', why: 'no faction label of seed 1 rounds 0..T is drawn off-land' },
  { label: 'step-straight', why: 'no absorber of seeds 1..1000 changes between a horizontal and a straight frame' },
  { label: 'step-off-land', why: 'no absorber of seeds 1..1000 changes between an in-land and an off-land frame' },
];

/** Scale at which a territory hit is shown: above L1 and large enough for the minimum text size (plan section 12). */
export function hitScale(height: number): number {
  return Math.max(LABEL_PARAMS.fadeFull + 1, LABEL_PARAMS.minPx / height + 0.5);
}

const territoryScene = (label: string, hit: TerritoryHitRecord, look: string): LabelReviewScene => ({
  label,
  seed: 1,
  round: 0,
  camera: { x: hit.centre.x, y: hit.centre.y, zoom: hitScale(hit.height) },
  look,
});

const crossfadeScenes = (prefix: string, hit: TerritoryHitRecord, look: string): LabelReviewScene[] =>
  [
    ['below', LABEL_PARAMS.fadeStart],
    ['mid', (LABEL_PARAMS.fadeStart + LABEL_PARAMS.fadeFull) / 2],
    ['above', LABEL_PARAMS.fadeFull],
  ].map(([name, zoom]) => ({
    label: `${prefix}-${name as string}`,
    seed: 1,
    round: 0,
    camera: { x: hit.centre.x, y: hit.centre.y, zoom: zoom as number },
    look: `${look} at scale ${zoom as number}`,
  }));

const FROZEN = ['0', '0.25', '0.5', '0.75', '1'] as const;

const stepScenes = (prefix: string, hit: StepHitRecord, look: string): LabelReviewScene[] =>
  FROZEN.map((value) => ({
    label: `${prefix}-${value.replace('.', '-')}`,
    seed: hit.seed,
    round: hit.round + 1,
    camera: { x: (hit.before.x + hit.after.x) / 2, y: (hit.before.y + hit.after.y) / 2, zoom: LABEL_SCALES.belowFade },
    frozen: value,
    look: `${look} at forward progress ${value}`,
  }));

export const SHAPED_REVIEW_SET: readonly LabelReviewScene[] = [
  territoryScene('steep-straight', TERRITORY_HITS['steep-straight'], 'territory label of Baviera, a steep straight frame'),
  territoryScene('diagonal-straight', TERRITORY_HITS['diagonal-straight'], 'territory label of Renania-Palatinado, a diagonal straight frame'),
  territoryScene('arc-cup', TERRITORY_HITS['arc-cup'], 'territory label of Alta Francia, a cup arc (bend > 0)'),
  territoryScene('arc-cap', TERRITORY_HITS['arc-cap'], 'territory label of Baden-Wurtemberg, a cap arc (bend < 0)'),
  territoryScene('kept-horizontal', TERRITORY_HITS['kept-horizontal'], 'territory label of Baja Sajonia, horizontal although a shaped frame fits'),
  territoryScene('off-land-inland', TERRITORY_HITS['off-land-inland'], 'territory label of Bremen, off-land beside land neighbours'),
  ...crossfadeScenes('crossfade-shaped', TERRITORY_HITS['steep-straight'], 'Baviera crossfade between faction and territory labels'),
  ...crossfadeScenes('crossfade-off-land', TERRITORY_HITS['off-land-inland'], 'Bremen crossfade, off-land territory label appearing'),
  ...stepScenes('step-arc', STEP_HITS['step-arc'], 'Portugal absorbs a territory: its frame changes from an arc to a horizontal box'),
];

/**
 * The scenes the user looks at to choose the territory off-land height (FR-203): small territories near the
 * threshold, shot once per candidate value. Not part of the pinned hits.
 */
export const OFF_LAND_TUNING_SET: readonly LabelReviewScene[] = [
  { label: 'tuning-bremen-hamburgo', seed: 1, round: 0, camera: { x: 1286.5, y: 289, zoom: 10 }, look: 'Bremen and Hamburgo: off-land, shaped or in-land, with or without a leader line' },
  { label: 'tuning-trentino-friuli', seed: 1, round: 0, camera: { x: 1521, y: 928.5, zoom: 8 }, look: 'Trentino-Alto Adigio and Friuli-Venecia Julia diagonal frames' },
  { label: 'tuning-castilla-la-mancha', seed: 1, round: 0, camera: { x: 497.72436523, y: 1586.5, zoom: 3 }, look: 'Castilla-La Mancha: horizontal or diagonal' },
];
