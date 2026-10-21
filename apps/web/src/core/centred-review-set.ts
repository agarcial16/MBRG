// The centred label review scenes of NFR-45 (spec 007): debug-scene addresses on the committed dev map that the user
// accepts by screenshot, before (the 006 placement) and after (the 007 placement) at the same address. The 005 and 006
// sets are untouched. Pure data: the hits and lists below were found with the text aspects measured in Chrome
// (`test/helpers/measured-aspects.ts`, plan PD10) and `test/centred-review-set.test.ts` checks that the ordered searches
// still find each one, so a rebuilt map, a retuned parameter or another aspect cannot silently invalidate the set.
// Names are written without accents (this file is ASCII-only); the test compares them after removing accents.
import { LABEL_SCALES } from './label-review-set';
import type { LabelReviewScene } from './label-review-set';
import { hitScale } from './shaped-review-set';

/** A territory close-up: the entry, its centre of mass and the smaller of its 006 and 007 frame heights. */
export interface CloseUpRecord {
  entry: number;
  name: string;
  /** Exact centre of mass of the main piece, to one decimal. */
  centre: { x: number; y: number };
  /** The smaller of the 006 and the 007 drawn frame heights (one camera for before and after). */
  height: number;
}

/** The step hit: the first (seed, then round) forward step whose absorber goes from a horizontal to a straight frame. */
export interface CentredStepRecord {
  seed: number;
  /** The step goes from this round to the next. */
  round: number;
  faction: string;
  before: { x: number; y: number };
  after: { x: number; y: number };
}

/** NFR-45: the review territories of 006 and the two territories of the 007 evidence, in this order. */
export const NAMED_CLOSE_UPS: readonly CloseUpRecord[] = [
  { entry: 26, name: 'Galicia', centre: { x: 204.3, y: 1208.3 }, height: 44 },
  { entry: 22, name: 'Castilla-La Mancha', centre: { x: 504.8, y: 1537.7 }, height: 29 },
  { entry: 6, name: 'Bremen', centre: { x: 1269.2, y: 318.5 }, height: 3 },
  { entry: 7, name: 'Hamburgo', centre: { x: 1334.3, y: 275.3 }, height: 4 },
  { entry: 62, name: 'Trentino-Alto Adigio', centre: { x: 1459.9, y: 916.6 }, height: 14 },
  { entry: 53, name: 'Friuli-Venecia Julia', centre: { x: 1573.5, y: 931.6 }, height: 9 },
];

/** Every territory whose 006 frame is steeper than 45 degrees (entry order), Galicia aside (it is in the named list). */
export const STEEP_CLOSE_UPS: readonly CloseUpRecord[] = [
  { entry: 3, name: 'Baviera', centre: { x: 1448.5, y: 689 }, height: 66 },
  { entry: 8, name: 'Hesse', centre: { x: 1296.5, y: 547.4 }, height: 42 },
  { entry: 13, name: 'Sajonia-Anhalt', centre: { x: 1438.7, y: 408.6 }, height: 18 },
  { entry: 18, name: 'Aragon', centre: { x: 679.9, y: 1374.2 }, height: 57 },
  { entry: 25, name: 'Extremadura', centre: { x: 279.3, y: 1548.9 }, height: 31 },
  { entry: 29, name: 'Region de Murcia', centre: { x: 601.8, y: 1690.1 }, height: 12 },
  { entry: 38, name: 'Corcega', centre: { x: 1345.3, y: 1317.9 }, height: 16 },
  { entry: 49, name: 'Calabria', centre: { x: 1871.8, y: 1548.5 }, height: 18 },
  { entry: 51, name: 'Cerdena', centre: { x: 1350.6, y: 1506.6 }, height: 29 },
  { entry: 59, name: 'Piamonte', centre: { x: 1253.4, y: 1056.5 }, height: 28 },
  { entry: 66, name: 'Alentejo', centre: { x: 144.5, y: 1582.8 }, height: 28 },
  { entry: 69, name: 'Lisboa', centre: { x: 92.8, y: 1600.7 }, height: 11 },
];

/** Representative territories whose frame goes from horizontal to straight (3 of 25) and from an arc to straight (3 of 9). */
export const SHAPE_CHANGE_CLOSE_UPS: readonly (CloseUpRecord & { from: 'horizontal' | 'arc' })[] = [
  { entry: 23, name: 'Castilla y Leon', centre: { x: 400.8, y: 1327.5 }, height: 42, from: 'horizontal' },
  { entry: 41, name: 'Normandia', centre: { x: 770.1, y: 682.8 }, height: 33, from: 'horizontal' },
  { entry: 60, name: 'Sicilia', centre: { x: 1732.5, y: 1702.8 }, height: 49, from: 'horizontal' },
  { entry: 1, name: 'Baden-Wurtemberg', centre: { x: 1308.7, y: 735.2 }, height: 21, from: 'arc' },
  { entry: 43, name: 'Occitania', centre: { x: 877.4, y: 1183.3 }, height: 65, from: 'arc' },
  { entry: 61, name: 'Toscana', centre: { x: 1473.3, y: 1189.3 }, height: 35, from: 'arc' },
];

/** Centres of the Francia frame before and after the recorded step (seed 1, round 3 to 4). */
export const CENTRED_STEP_HIT: CentredStepRecord = {
  seed: 1,
  round: 3,
  faction: 'Francia',
  before: { x: 1089.73828125, y: 734 },
  after: { x: 956.5, y: 982.5 },
};

/** Centre of mass of Italia's main region at rounds 0 to 3 of seed 1 (rounds 0 to 2 are the same region). */
export const ITALIA_CENTRES: readonly { x: number; y: number }[] = [
  { x: 1550.1, y: 1180.8 },
  { x: 1550.1, y: 1180.8 },
  { x: 1550.1, y: 1180.8 },
  { x: 424.5, y: 1466.4 },
];

/** Francia at round 4: the centre of mass C of the whole land (shown beside reference B). */
export const FRANCIA_R4_CENTRE = { x: 932.4, y: 1056.7 } as const;

/** Scenes of plan section 12 that have no hit, with the reason. */
export const CENTRED_DROPPED_SCENES: readonly { label: string; why: string }[] = [
  { label: 'steep-straight', why: 'no straight frame can be steeper than 45 degrees (spec 007 FR-221: the limit applies to every straight frame)' },
];

/** Zoom below the fit scale of every window: the address parser raises it to the fit scale. */
const FIT_ZOOM = 0.1;
const FROZEN = ['0', '0.25', '0.5', '0.75', '1'] as const;

/** The label of a record's scene: kebab-case, no accents. */
export const slug = (name: string): string => name.toLowerCase().replace(/ /g, '-');

const closeUp = (prefix: string, r: CloseUpRecord, look: string): LabelReviewScene => ({
  label: `${prefix}-${slug(r.name)}`,
  seed: 1,
  round: 0,
  camera: { x: r.centre.x, y: r.centre.y, zoom: hitScale(r.height) },
  look,
});

export const CENTRED_REVIEW_SET: readonly LabelReviewScene[] = [
  ...[0, 1, 2, 3, 4].map((round): LabelReviewScene => ({ label: `fit-r${String(round)}`, seed: 1, round, look: `seed 1 round ${String(round)} at fit scale${round === 4 ? ' (round T)' : ''}` })),
  {
    label: 'francia-r4',
    seed: 1,
    round: 4,
    camera: { x: FRANCIA_R4_CENTRE.x, y: FRANCIA_R4_CENTRE.y, zoom: FIT_ZOOM },
    look: 'Francia alone at round 4, camera on C, beside reference B (+40 deg, h 155, centre (905, 941))',
  },
  ...ITALIA_CENTRES.map(
    (c, round): LabelReviewScene => ({
      label: `italia-r${String(round)}`,
      seed: 1,
      round,
      camera: { x: c.x, y: c.y, zoom: LABEL_SCALES.belowFade },
      look: `Italia label at round ${String(round)}, camera on the centre of mass of its main region`,
    }),
  ),
  ...FROZEN.map(
    (value): LabelReviewScene => ({
      label: `step-straight-${value.replace('.', '-')}`,
      seed: CENTRED_STEP_HIT.seed,
      round: CENTRED_STEP_HIT.round + 1,
      camera: {
        x: (CENTRED_STEP_HIT.before.x + CENTRED_STEP_HIT.after.x) / 2,
        y: (CENTRED_STEP_HIT.before.y + CENTRED_STEP_HIT.after.y) / 2,
        zoom: LABEL_SCALES.belowFade,
      },
      frozen: value,
      look: `Francia absorbs: its frame goes from horizontal to straight at forward progress ${value}`,
    }),
  ),
  ...NAMED_CLOSE_UPS.map((r) => closeUp('close', r, `territory label of ${r.name}, before and after`)),
  ...STEEP_CLOSE_UPS.map((r) => closeUp('steep', r, `territory label of ${r.name}, steeper than 45 degrees in 006`)),
  ...SHAPE_CHANGE_CLOSE_UPS.map((r) => closeUp(r.from === 'horizontal' ? 'to-straight' : 'arc-to-straight', r, `territory label of ${r.name}, ${r.from} in 006 and straight in 007`)),
];
