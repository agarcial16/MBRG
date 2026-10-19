// Shaped and off-land label parameters (spec 006 definitions, plan 006 section 4).
// Pure data and constants: no DOM, no clock. Kept apart from LABEL_PARAMS, which spec 005 pins.

export interface ShapeParams {
  /** Multiple of the tried axis angles, in degrees. Fixed: the cs table is built for it. */
  angleStep: number;
  /** G: a shaped frame must be at least G times taller than the horizontal one to win. Fixed. */
  shapeGain: number;
  /** Absolute arc bends, in degrees; both signs are tried. Fixed. */
  arcBends: readonly number[];
  /** Per role, in map units: tunable (territory 3..12, faction 10..40). */
  offLandHeight: { faction: number; territory: number };
  /** Dr: the largest gap of an off-land box, in map units. Fixed. */
  offLandReach: number;
  /** Gl: the gap above which a leader line is drawn, in map units. Fixed. */
  leaderGap: number;
}

export const SHAPE_PARAMS: ShapeParams = {
  angleStep: 15,
  shapeGain: 1.5,
  arcBends: [30, 60],
  offLandHeight: { faction: 18, territory: 5 },
  offLandReach: 24,
  leaderGap: 6,
};

/** Allowed range of the tunable off-land heights (spec 006). */
export const OFF_LAND_HEIGHT_RANGE = {
  faction: { min: 10, max: 40 },
  territory: { min: 3, max: 12 },
} as const;

/** Cosine and sine of a whole multiple of 15 degrees from -75 to 90 (spec table; for -t use (C, -S)). */
export function cs(theta: number): { c: number; s: number } {
  const a = Math.abs(theta);
  let c: number;
  let s: number;
  switch (a) {
    case 0:
      c = 1;
      s = 0;
      break;
    case 15:
      c = (Math.sqrt(6) + Math.sqrt(2)) / 4;
      s = (Math.sqrt(6) - Math.sqrt(2)) / 4;
      break;
    case 30:
      c = Math.sqrt(3) / 2;
      s = 1 / 2;
      break;
    case 45:
      c = Math.sqrt(2) / 2;
      s = Math.sqrt(2) / 2;
      break;
    case 60:
      c = 1 / 2;
      s = Math.sqrt(3) / 2;
      break;
    case 75:
      c = (Math.sqrt(6) - Math.sqrt(2)) / 4;
      s = (Math.sqrt(6) + Math.sqrt(2)) / 4;
      break;
    case 90:
      c = 0;
      s = 1;
      break;
    default:
      throw new RangeError('cs: the angle must be a multiple of 15 degrees from -90 to 90');
  }
  if (theta === -90) throw new RangeError('cs: -90 is wrapped to 90');
  return { c, s: theta < 0 ? -s : s };
}
