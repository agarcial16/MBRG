// Territory line mathematics (FR-138, FR-140). Pure.
import type { Rgb } from '@mbrg/shared';
import type { TerritoryLineParams } from './theme';

/** Spec Definitions: 0 for s <= a, 1 for s >= b, 3t^2 - 2t^3 with t = (s - a) / (b - a) between. */
export function smoothstep(a: number, b: number, s: number): number {
  if (s <= a) return 0;
  if (s >= b) return 1;
  const t = (s - a) / (b - a);
  return 3 * t * t - 2 * t * t * t;
}

/** Opacity of `territory` lines at a scale: Amax x smoothstep(S0, S1, s). Depends on the scale only (FR-140). */
export function territoryOpacity(scale: number, params: TerritoryLineParams): number {
  return params.maxOpacity * smoothstep(params.fadeStart, params.fadeFull, scale);
}

/** Colour of a `territory` line: each 8-bit channel c of the owner colour becomes floor(c x D). */
export function territoryLineColor(owner: Rgb, darken: number): Rgb {
  return [Math.floor(owner[0] * darken), Math.floor(owner[1] * darken), Math.floor(owner[2] * darken)];
}
