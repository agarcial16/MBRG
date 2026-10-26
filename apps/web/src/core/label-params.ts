// Label parameters (spec 005 definitions, plan section 9). Values approved by the user in T9 (2026-10-16).
// Pure data: no DOM, no clock.

export interface LabelFont {
  weight: number;
  /** Font families in order of preference; the last one is a generic family. */
  families: readonly string[];
}

export interface LabelParams {
  font: LabelFont;
  /** M: free space around a label box, in whole map units (spec range 1..4). */
  margin: number;
  /** Hmax: the largest label box height, in map units (spec range 20..200). */
  maxHeight: number;
  /** P: the smallest drawn font size, in screen pixels (spec range 6..14). */
  minPx: number;
  /** L0: scale where the faction labels start to give way to the territory labels. */
  fadeStart: number;
  /** L1: scale where the territory labels are fully shown. */
  fadeFull: number;
  /** Dt: duration of a round-step animation, in milliseconds (spec range 800..3000). */
  durationMs: number;
}

export const LABEL_PARAMS: LabelParams = {
  font: { weight: 600, families: ['"Segoe UI"', '"Helvetica Neue"', 'Arial', 'sans-serif'] },
  margin: 2,
  maxHeight: 120,
  minPx: 9,
  fadeStart: 1.5,
  fadeFull: 2,
  durationMs: 1500,
};

/** The CSS font shorthand for a font size in pixels. */
export function fontString(px: number, font: LabelFont = LABEL_PARAMS.font): string {
  return `${String(font.weight)} ${String(px)}px ${font.families.join(', ')}`;
}
