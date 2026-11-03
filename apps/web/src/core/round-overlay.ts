// The overlay between the close of the predictions and the reveal (spec 013 FR-409). Pure: it reuses the reasons of `offerOf`, so it
// is shown on exactly the moments the prediction offer is `closed` before the victim is known and `revealing`. It names nobody.
import type { LiveModel } from './live-model';
import { offerOf } from './predict-model';
import { STRINGS } from './strings';

/** "PREDICCIONES FINALIZADAS" while phase 2 has no victim yet, "REVELANDO..." while the reveal tour runs; none otherwise. */
export function overlayOf(model: LiveModel, revealing: boolean): string | undefined {
  const offer = offerOf(model, { joined: true, revealing });
  if (offer.type !== 'none') return undefined;
  if (offer.reason === 'revealing') return STRINGS.overlayRevealing;
  if (offer.reason === 'closed' && model.stage === 'phase-2' && model.victim === undefined) return STRINGS.overlayFinalised;
  return undefined;
}
