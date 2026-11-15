// The easing of the camera margins (spec 013 FR-443): when the phone dock folds or unfolds the visible map area changes, and the
// margins glide to their new values instead of jumping. Pure: the elapsed time comes in, the margins at that time go out.
import type { Inset } from './camera';
import { smoothstep } from './lines';

/** How long the margins glide, in ms. */
export const INSET_MS = 240;

/** The margins `elapsedMs` after a change from `from` to `to`: exactly `from` at 0 and exactly `to` from INSET_MS on. */
export function insetAt(from: Inset, to: Inset, elapsedMs: number): Inset {
  if (elapsedMs <= 0) return from;
  if (elapsedMs >= INSET_MS) return to;
  const p = smoothstep(0, INSET_MS, elapsedMs);
  return { top: from.top + (to.top - from.top) * p, bottom: from.bottom + (to.bottom - from.bottom) * p };
}
