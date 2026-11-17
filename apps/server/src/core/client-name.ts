// The display name of a client player (spec 022 FR-531, FR-533). Pure: the caller class and the already-read name are
// parameters; nothing here reads a body, a credential, the store, a clock or a random source.

import { errorReply } from '@mbrg/protocol';
import type { ErrorReply } from '@mbrg/protocol';
import type { PolicyCaller } from './policy';

export type SubmissionNameDecision =
  | { readonly action: 'none' }
  | { readonly action: 'store'; readonly name: string }
  | { readonly action: 'refuse'; readonly error: ErrorReply };

/**
 * What a submission's `name` does. A client credential stores it for its player (the latest accepted name wins); a player token
 * already has its join name, so a `name` from it is `invalid-request` naming `name` and nothing is stored (plan PD1).
 */
export function submissionName(caller: PolicyCaller, name: string | undefined): SubmissionNameDecision {
  if (name === undefined) return { action: 'none' };
  if (caller.role !== 'client') return { action: 'refuse', error: errorReply('invalid-request', ['name']) };
  return { action: 'store', name };
}

/** The names of one read: those of players who joined by name first, then client names for the ids not present. A new map. */
export function withClientNames(playerNames: ReadonlyMap<string, string>, clientNames: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  const merged = new Map(playerNames);
  for (const [id, name] of clientNames) if (!merged.has(id)) merged.set(id, name);
  return merged;
}
