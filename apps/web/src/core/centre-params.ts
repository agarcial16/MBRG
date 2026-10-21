// Centred label parameters (spec 007 definitions, plan 007 section 4).
// Pure data: no DOM, no clock. Kept apart from LABEL_PARAMS and SHAPE_PARAMS, which specs 005 and 006 pin.

export interface Ratio {
  /** Numerator, a positive whole number. */
  num: number;
  /** Denominator, a whole number above the numerator. */
  den: number;
}

export interface CentreParams {
  /** q: the label centre must lie within k q sqrt(n) of the centre of mass at widening step k. Fixed. */
  centreFraction: Ratio;
  /** Largest absolute tangent angle of an arc frame, in degrees. Fixed. */
  angleLimit: number;
  /** Straight angles tried, in degrees, in the FR-220 tie order (positive before negative). Fixed. */
  straightAngles: readonly number[];
  /** A faction label covers at most this share of the area of its main region. Fixed. */
  factionAreaShare: Ratio;
}

export const CENTRE_PARAMS: CentreParams = {
  centreFraction: { num: 7, den: 50 },
  angleLimit: 45,
  straightAngles: [15, -15, 30, -30, 45, -45],
  factionAreaShare: { num: 1, den: 10 },
};
