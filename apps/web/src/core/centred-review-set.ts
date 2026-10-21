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

/** A step hit: the first (seed, then round) forward step of a kind (horizontal to straight; an arc at either end, spec D19). */
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
  { entry: 3, name: 'Baviera', centre: { x: 1448.5, y: 689 }, height: 71 },
  { entry: 8, name: 'Hesse', centre: { x: 1296.5, y: 547.4 }, height: 42 },
  { entry: 13, name: 'Sajonia-Anhalt', centre: { x: 1438.7, y: 408.6 }, height: 18 },
  { entry: 18, name: 'Aragon', centre: { x: 679.9, y: 1374.2 }, height: 66 },
  { entry: 25, name: 'Extremadura', centre: { x: 279.3, y: 1548.9 }, height: 31 },
  { entry: 29, name: 'Region de Murcia', centre: { x: 601.8, y: 1690.1 }, height: 14 },
  { entry: 38, name: 'Corcega', centre: { x: 1345.3, y: 1317.9 }, height: 16 },
  { entry: 49, name: 'Calabria', centre: { x: 1871.8, y: 1548.5 }, height: 18 },
  { entry: 51, name: 'Cerdena', centre: { x: 1350.6, y: 1506.6 }, height: 29 },
  { entry: 59, name: 'Piamonte', centre: { x: 1253.4, y: 1056.5 }, height: 28 },
  { entry: 66, name: 'Alentejo', centre: { x: 144.5, y: 1582.8 }, height: 28 },
  { entry: 69, name: 'Lisboa', centre: { x: 92.8, y: 1600.7 }, height: 11 },
];

/** Representative territories whose frame goes from horizontal to straight (3 of the 10 left after D19). */
export const SHAPE_CHANGE_CLOSE_UPS: readonly (CloseUpRecord & { from: 'horizontal' })[] = [
  { entry: 2, name: 'Baja Sajonia', centre: { x: 1291.8, y: 349.9 }, height: 35, from: 'horizontal' },
  { entry: 34, name: 'Auvernia-Rodano-Alpes', centre: { x: 1035.7, y: 1019.3 }, height: 26, from: 'horizontal' },
  { entry: 56, name: 'Lombardia', centre: { x: 1370.2, y: 998.7 }, height: 24, from: 'horizontal' },
];

/** Every territory whose frame is an arc in 006 or in the D19 layout, beyond the ones already in the lists above (spec D19). */
export const ARC_CLOSE_UPS: readonly (CloseUpRecord & { from: string; to: string })[] = [
  { entry: 1, name: 'Baden-Wurtemberg', centre: { x: 1308.7, y: 735.2 }, height: 22, from: 'arc', to: 'arc' },
  { entry: 4, name: 'Berlin', centre: { x: 1528.7, y: 353.1 }, height: 8, from: 'horizontal', to: 'arc' },
  { entry: 9, name: 'Mecklemburgo-Pomerania Occidental', centre: { x: 1465.2, y: 248.2 }, height: 10, from: 'horizontal', to: 'arc' },
  { entry: 10, name: 'Renania-Palatinado', centre: { x: 1207, y: 615.1 }, height: 16, from: 'straight', to: 'arc' },
  { entry: 11, name: 'Renania del Norte-Westfalia', centre: { x: 1207.1, y: 471.8 }, height: 14, from: 'horizontal', to: 'arc' },
  { entry: 12, name: 'Sajonia', centre: { x: 1541, y: 485.6 }, height: 29, from: 'horizontal', to: 'arc' },
  { entry: 14, name: 'Sarre', centre: { x: 1178.9, y: 664.3 }, height: 15, from: 'horizontal', to: 'arc' },
  { entry: 15, name: 'Schleswig-Holstein', centre: { x: 1320.2, y: 219.5 }, height: 17, from: 'straight', to: 'arc' },
  { entry: 16, name: 'Turingia', centre: { x: 1409.7, y: 512.1 }, height: 30, from: 'horizontal', to: 'arc' },
  { entry: 17, name: 'Andalucia', centre: { x: 374.9, y: 1718.3 }, height: 68, from: 'horizontal', to: 'arc' },
  { entry: 19, name: 'Asturias', centre: { x: 337.8, y: 1177 }, height: 29, from: 'horizontal', to: 'arc' },
  { entry: 20, name: 'Islas Baleares', centre: { x: 924.8, y: 1557.1 }, height: 9, from: 'horizontal', to: 'arc' },
  { entry: 21, name: 'Cantabria', centre: { x: 465.7, y: 1201.1 }, height: 15, from: 'horizontal', to: 'arc' },
  { entry: 23, name: 'Castilla y Leon', centre: { x: 400.8, y: 1327.5 }, height: 42, from: 'horizontal', to: 'arc' },
  { entry: 24, name: 'Cataluna', centre: { x: 830.7, y: 1355.8 }, height: 39, from: 'horizontal', to: 'arc' },
  { entry: 27, name: 'La Rioja', centre: { x: 560.9, y: 1294.7 }, height: 18, from: 'horizontal', to: 'arc' },
  { entry: 32, name: 'Comunidad Valenciana', centre: { x: 676.8, y: 1568.5 }, height: 11, from: 'arc', to: 'straight' },
  { entry: 33, name: 'Alta Francia', centre: { x: 931.5, y: 611.9 }, height: 33, from: 'arc', to: 'arc' },
  { entry: 35, name: 'Borgona-Franco Condado', centre: { x: 1052.3, y: 862.1 }, height: 20, from: 'horizontal', to: 'arc' },
  { entry: 36, name: 'Bretana', centre: { x: 586.9, y: 754.4 }, height: 43, from: 'horizontal', to: 'arc' },
  { entry: 40, name: 'Isla de Francia', centre: { x: 912.5, y: 726 }, height: 16, from: 'horizontal', to: 'arc' },
  { entry: 41, name: 'Normandia', centre: { x: 770.1, y: 682.8 }, height: 33, from: 'horizontal', to: 'arc' },
  { entry: 42, name: 'Nueva Aquitania', centre: { x: 756.4, y: 1042.5 }, height: 43, from: 'arc', to: 'straight' },
  { entry: 43, name: 'Occitania', centre: { x: 877.4, y: 1183.3 }, height: 70, from: 'arc', to: 'arc' },
  { entry: 44, name: 'Paises del Loira', centre: { x: 705.7, y: 828.6 }, height: 29, from: 'straight', to: 'arc' },
  { entry: 46, name: 'Abruzos', centre: { x: 1664.7, y: 1283.6 }, height: 22, from: 'horizontal', to: 'arc' },
  { entry: 50, name: 'Campania', centre: { x: 1746.5, y: 1399.8 }, height: 29, from: 'arc', to: 'arc' },
  { entry: 52, name: 'Emilia-Romana', centre: { x: 1459, y: 1092.3 }, height: 27, from: 'horizontal', to: 'arc' },
  { entry: 54, name: 'Lacio', centre: { x: 1594, y: 1314.2 }, height: 40, from: 'arc', to: 'arc' },
  { entry: 57, name: 'Marcas', centre: { x: 1606.3, y: 1186.7 }, height: 32, from: 'arc', to: 'arc' },
  { entry: 58, name: 'Molise', centre: { x: 1720.7, y: 1326.9 }, height: 17, from: 'horizontal', to: 'arc' },
  { entry: 60, name: 'Sicilia', centre: { x: 1732.5, y: 1702.8 }, height: 49, from: 'horizontal', to: 'arc' },
  { entry: 61, name: 'Toscana', centre: { x: 1473.3, y: 1189.3 }, height: 38, from: 'arc', to: 'arc' },
  { entry: 63, name: 'Umbria', centre: { x: 1566.9, y: 1226.4 }, height: 20, from: 'horizontal', to: 'arc' },
  { entry: 65, name: 'Veneto', centre: { x: 1502.3, y: 984.8 }, height: 34, from: 'straight', to: 'arc' },
  { entry: 68, name: 'Centro', centre: { x: 172.4, y: 1427.2 }, height: 41, from: 'horizontal', to: 'arc' },
];

/** Centres of the Francia frame before and after the recorded step (seed 1, round 3 to 4). */
export const CENTRED_STEP_HIT: CentredStepRecord = {
  seed: 1,
  round: 3,
  faction: 'Francia',
  before: { x: 1089.73828125, y: 734 },
  after: { x: 956.5, y: 982.5 },
};

/** Centres of the Espana frame before and after the first step with an arc at an end (seed 1, round 1 to 2: horizontal to arc). */
export const CENTRED_ARC_STEP_HIT: CentredStepRecord = {
  seed: 1,
  round: 1,
  faction: 'Espana',
  before: { x: 471.5166015625, y: 1462 },
  after: { x: 424.5, y: 1466.5 },
};

/** Centre of mass of Espana's main region at round 2 of seed 1 (a faction arc under D19, the same region as Italia at round 3). */
export const ESPANA_R2_CENTRE = { x: 424.5, y: 1466.4 } as const;

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
  {
    label: 'espana-r2',
    seed: 1,
    round: 2,
    camera: { x: ESPANA_R2_CENTRE.x, y: ESPANA_R2_CENTRE.y, zoom: LABEL_SCALES.belowFade },
    look: 'Espana label at round 2 (an arc under D19), camera on the centre of mass of its main region',
  },
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
  ...FROZEN.map(
    (value): LabelReviewScene => ({
      label: `step-curve-${value.replace('.', '-')}`,
      seed: CENTRED_ARC_STEP_HIT.seed,
      round: CENTRED_ARC_STEP_HIT.round + 1,
      camera: {
        x: (CENTRED_ARC_STEP_HIT.before.x + CENTRED_ARC_STEP_HIT.after.x) / 2,
        y: (CENTRED_ARC_STEP_HIT.before.y + CENTRED_ARC_STEP_HIT.after.y) / 2,
        zoom: LABEL_SCALES.belowFade,
      },
      frozen: value,
      look: `Espana absorbs: its frame crossfades from horizontal to an arc at forward progress ${value}`,
    }),
  ),
  ...NAMED_CLOSE_UPS.map((r) => closeUp('close', r, `territory label of ${r.name}, before and after`)),
  ...STEEP_CLOSE_UPS.map((r) => closeUp('steep', r, `territory label of ${r.name}, steeper than 45 degrees in 006`)),
  ...SHAPE_CHANGE_CLOSE_UPS.map((r) => closeUp('to-straight', r, `territory label of ${r.name}, ${r.from} in 006 and straight in 007`)),
  ...ARC_CLOSE_UPS.map((r) => closeUp('arc', r, `territory label of ${r.name}, ${r.from} in 006 and ${r.to} in 007 (an arc at one end)`)),
];
