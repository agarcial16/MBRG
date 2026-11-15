// The public-creation check (spec 011 FR-369): the map must be in the public list, the timing must not be `manual`, and it must pass
// the 008 rules (FR-233, letters a to d) and the public bounds. Pure: settings, map id and timing are parameters.
// Caps and rates are not here (they need the store); the first error is returned, nothing is stored or drawn by this check.

import { errorReply, timingRuleFailures } from '@mbrg/protocol';
import type { ErrorReply, Timing } from '@mbrg/protocol';
import type { PublicCreation } from './settings';

/**
 * Public bound items of `invalid-timing`, after the 008 letters: `e` I below the public minimum, `f` L1 below its minimum,
 * `g` L2 below its minimum, `h` I above the public maximum. A bound is listed only when it fails; the order is fixed.
 */
export function checkPublicCreation(settings: PublicCreation, mapId: string, timing: Timing): ErrorReply | undefined {
  // An unlisted map answers as a map that does not exist (nothing is disclosed); an empty list means public creation is off.
  if (!settings.maps.includes(mapId)) return errorReply('unknown-map');
  if (timing === 'manual') return errorReply('invalid-timing', ['manual']);
  const failed: string[] = timingRuleFailures(timing);
  if (timing.i < settings.minInterval) failed.push('e');
  if (timing.l1 < settings.minPhase1) failed.push('f');
  if (timing.l2 < settings.minPhase2) failed.push('g');
  if (timing.i > settings.maxInterval) failed.push('h');
  return failed.length === 0 ? undefined : errorReply('invalid-timing', failed);
}
