// Screen-dependent detail (spec 013 FR-438): the zoom where province lines and names start to show scales with the
// screen, so a phone shows them at the same relative magnification as a desk. Pure.
import { fitScale } from './camera';
import type { ImageSize, Viewport } from './camera';

/** The desk reference viewport: with it (and anything larger) the fade thresholds are exactly the base values. */
export const DETAIL_REFERENCE: Viewport = { width: 1280, height: 720 };

/**
 * min(1, fit / fit_ref): fit is the zoom where the whole image fits `vp`, fit_ref the same for the reference
 * viewport. 1 when either is not a positive finite number.
 */
export function detailFactor(image: ImageSize, vp: Viewport): number {
  const fit = fitScale(image, vp);
  const ref = fitScale(image, DETAIL_REFERENCE);
  if (!(fit > 0) || !(ref > 0) || !Number.isFinite(fit) || !Number.isFinite(ref)) return 1;
  return Math.min(1, fit / ref);
}

/** The same parameters with both fade thresholds multiplied by the detail factor (1 returns equal values). */
export function scaledFade<T extends { fadeStart: number; fadeFull: number }>(params: T, factor: number): T {
  if (factor === 1) return params;
  return { ...params, fadeStart: params.fadeStart * factor, fadeFull: params.fadeFull * factor };
}
