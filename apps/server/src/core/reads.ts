// Round reads of the core (spec 008 FR-258): which rounds a client may ask about, decided from N alone.

import { errorReply } from '@mbrg/protocol';
import type { ErrorReply } from '@mbrg/protocol';
import type { CoreMatch } from './view';

export type RoundRead = { readonly ok: true; readonly round: number } | { readonly ok: false; readonly error: ErrorReply };

/**
 * A round j is readable when j <= N (round 0 is the creation state). A round above N, whether or not it is at most T and
 * whatever the stage, gets the same `round-not-applied` naming only N (FR-258): nothing of the pending round, not even
 * its number, is used. A round that is not a whole number >= 0 is `invalid-request` (FR-281).
 */
export function readRound(view: CoreMatch, round: number): RoundRead {
  if (typeof round !== 'number' || !Number.isSafeInteger(round) || round < 0) return { ok: false, error: errorReply('invalid-request', ['round']) };
  if (round > view.appliedRounds) return { ok: false, error: errorReply('round-not-applied', [String(view.appliedRounds)]) };
  return { ok: true, round };
}
