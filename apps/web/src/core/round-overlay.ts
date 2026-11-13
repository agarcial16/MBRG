// The overlay between the close of the predictions and the reveal (spec 013 FR-409). Pure: the beat of the model, then the `revealing`
// reason of `offerOf`. It names nobody.
import type { LiveModel } from './live-model';
import { offerOf } from './predict-model';
import { STRINGS } from './strings';

/**
 * "PREDICCIONES FINALIZADAS" during the beat that follows the close of a window (FR-409; the same text for a viewer who did not join),
 * "REVELANDO..." while the reveal tour runs; none otherwise. The beat is a field of the model, so this names nobody.
 */
export function overlayOf(model: LiveModel, revealing: boolean): string | undefined {
  if (model.beat !== undefined) return model.displayed === model.applied ? STRINGS.overlayFinalised : undefined;
  const offer = offerOf(model, { joined: true, revealing });
  if (offer.type === 'none' && offer.reason === 'revealing') return STRINGS.overlayRevealing;
  return undefined;
}
