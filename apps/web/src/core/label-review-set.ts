// The label and step review scenes of NFR-34: debug-scene addresses on the committed dev map (seed 1) that
// the user accepts by screenshot, together with the label parameter values. The 004 set (`review-set.ts`)
// is untouched. Pure data: `test/label-review-set.test.ts` checks that every scene holds what its label
// says, so a rebuilt map or a retuned parameter cannot silently invalidate the set.
import { formatAddress } from './address';
import { LABEL_PARAMS } from './label-params';
import { REVIEW_POINTS } from './review-set';

export interface LabelReviewScene {
  /** Unique, kebab-case. */
  label: string;
  seed: number;
  round: number;
  /** Absent: the whole map at fit scale. */
  camera?: { x: number; y: number; zoom: number };
  /** A frozen forward progress, as written in the address (FR-191). Needs a round of at least 1. */
  frozen?: string;
  /** What the reviewer looks at. */
  look: string;
}

/** Scales of the label scenes, derived from the label parameters so a retuned fade keeps the scenes right. */
export const LABEL_SCALES = {
  /** Below the fade start L0: faction labels only. */
  belowFade: LABEL_PARAMS.fadeStart - 0.25,
  /** Between L0 and L1: both kinds drawn. */
  midFade: (LABEL_PARAMS.fadeStart + LABEL_PARAMS.fadeFull) / 2,
  /** Above the fade end L1: territory labels only. */
  aboveFade: LABEL_PARAMS.fadeFull + 1,
  /** The dense-area and island scenes: well above L1. */
  territories: LABEL_PARAMS.fadeFull + 2,
} as const;

/** The forward progress values of the frozen step scenes (NFR-34), as written in the address. */
export const FROZEN_VALUES: readonly string[] = ['0', '0.25', '0.5', '0.75', '1'];

/** Seeds searched for a transferred piece with an empty contact set (plan section 12). */
export const EMPTY_CONTACT_SEEDS = 1000;

/**
 * The first (seed, then round) of the search over seeds 1..EMPTY_CONTACT_SEEDS whose step transfers a piece that
 * does not touch the absorber's earlier land, found by `label-review-set.test.ts` (which pins it) and recorded
 * in plan section 12. The point lies in the largest such piece (the island of Rugen, transferred with
 * Mecklemburgo-Pomerania Occidental to the faction that does not reach it by land).
 */
export const EMPTY_CONTACT = { seed: 1, round: 1, point: { x: 1509.5, y: 178.5 }, zoom: 12 } as const;

/** Zoom below the fit scale of every window: the address parser raises it to the fit scale. */
const FIT_ZOOM = 0.1;
const MAP_CENTRE = { x: 1024, y: 1024 };

const at = (point: { x: number; y: number }, zoom: number): { x: number; y: number; zoom: number } => ({
  x: point.x,
  y: point.y,
  zoom,
});

const frozenScenes = (prefix: string, seed: number, round: number, camera: { x: number; y: number; zoom: number }, look: string): LabelReviewScene[] =>
  FROZEN_VALUES.map((value) => ({ label: `${prefix}-${value.replace('.', '-')}`, seed, round, camera, frozen: value, look: `${look} at forward progress ${value}` }));

export const LABEL_REVIEW_SET: readonly LabelReviewScene[] = [
  { label: 'faction-fit-0', seed: 1, round: 0, look: 'faction labels, five factions; Espana label on the peninsula, Italia on its main region' },
  { label: 'faction-fit-1', seed: 1, round: 1, look: 'Alemania gone; Francia label re-fitted to its larger territory' },
  { label: 'faction-fit-4', seed: 1, round: 4, look: 'last round: one faction label over the whole land' },
  { label: 'crossfade-below', seed: 1, round: 0, camera: at(REVIEW_POINTS.formerBorder, LABEL_SCALES.belowFade), look: 'below L0: faction labels only' },
  { label: 'crossfade-mid', seed: 1, round: 0, camera: at(REVIEW_POINTS.formerBorder, LABEL_SCALES.midFade), look: 'between L0 and L1: both kinds, half-faded' },
  { label: 'crossfade-above', seed: 1, round: 0, camera: at(REVIEW_POINTS.formerBorder, LABEL_SCALES.aboveFade), look: 'above L1: territory labels only' },
  { label: 'dense-territories', seed: 1, round: 0, camera: at(REVIEW_POINTS.smallTerritory, LABEL_SCALES.territories), look: 'dense area around the smallest territory: territory labels and small text on light fills' },
  { label: 'island-baleares', seed: 1, round: 0, camera: at(REVIEW_POINTS.baleares, LABEL_SCALES.territories), look: 'small island: territory label of Islas Baleares' },
  { label: 'strait-italia', seed: 1, round: 0, camera: at(REVIEW_POINTS.messina, LABEL_SCALES.belowFade), look: 'Italia in two regions over the Messina strait: its label stays on the main region' },
  ...frozenScenes('step', 1, 1, at(MAP_CENTRE, FIT_ZOOM), 'round 0 to 1 at fit'),
  ...frozenScenes('step-island', EMPTY_CONTACT.seed, EMPTY_CONTACT.round, at(EMPTY_CONTACT.point, EMPTY_CONTACT.zoom), 'transferred island that does not touch the absorber'),
];

/** The address text of a scene (the query string the page reads). */
export function labelReviewAddress(scene: LabelReviewScene): string {
  if (scene.camera === undefined) return `?seed=${scene.seed}&round=${scene.round}`;
  return formatAddress(scene.seed, scene.round, { x: scene.camera.x, y: scene.camera.y, scale: scene.camera.zoom }, scene.frozen);
}
