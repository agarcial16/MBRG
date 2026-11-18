// The join policy decisions of a match (spec 018 FR-491 to FR-493, FR-496, FR-497). Pure: the requested policy, the owning
// namespace and the caller class are parameters; nothing here reads a credential, a body, the store, a clock or a random
// source. The shell classifies the caller (a client credential gives its namespace; everything else is `other`) and stores
// the policy and the namespace with the match.

import { errorReply } from '@mbrg/protocol';
import type { ErrorReply, JoinPolicy } from '@mbrg/protocol';

/** A client credential with its namespace (008 FR-284), or any other caller: anonymous, host, player, unknown token, operator. */
export type PolicyCaller = { readonly role: 'client'; readonly namespace: string } | { readonly role: 'other' };

export type CreationPolicyDecision =
  | { readonly ok: true; readonly policy: 'open' }
  | { readonly ok: true; readonly policy: 'client'; readonly namespace: string; readonly community?: string }
  | { readonly ok: false; readonly error: ErrorReply };

export type PolicyDecision = { readonly ok: true } | { readonly ok: false; readonly error: ErrorReply };

/**
 * The policy of a new match. On the operator path (008) any `joinPolicy` is `invalid-request` naming it (FR-493); elsewhere
 * `client` needs a client credential, whose namespace becomes the owner (FR-491), and any other caller gets `forbidden`
 * (FR-492). Absent or `open` is the open policy for everybody (FR-490).
 *
 * Spec 024 FR-545: a community key (already shape-checked, FR-546) is accepted only from a client credential with
 * `joinPolicy: 'client'` and is then carried by the decision; in any other case (a missing or open policy, a non-client caller,
 * the operator path) it is `invalid-request` naming `community`, whatever its value, and the reply never holds the key. The
 * `joinPolicy` of the operator path is named first (field order); a body without a key gets exactly the 018 answers.
 */
export function creationPolicy(requested: JoinPolicy | undefined, caller: PolicyCaller, operatorPath: boolean, community?: string): CreationPolicyDecision {
  if (operatorPath && requested !== undefined) return { ok: false, error: errorReply('invalid-request', ['joinPolicy']) };
  if (community !== undefined && (requested !== 'client' || caller.role !== 'client')) return { ok: false, error: errorReply('invalid-request', ['community']) };
  if (requested !== 'client') return { ok: true, policy: 'open' };
  if (caller.role !== 'client') return { ok: false, error: errorReply('forbidden') };
  return { ok: true, policy: 'client', namespace: caller.namespace, ...(community !== undefined ? { community } : {}) };
}

/** A join (FR-496): refused with `joins-closed` for every caller whenever the match has an owning namespace. */
export function joinPolicy(owner: string | undefined): PolicyDecision {
  return owner === undefined ? { ok: true } : { ok: false, error: errorReply('joins-closed') };
}

/** A submission (FR-497): on a client-only match only a client credential of the owning namespace passes; else `forbidden`. */
export function submitPolicy(owner: string | undefined, caller: PolicyCaller): PolicyDecision {
  if (owner === undefined) return { ok: true };
  return caller.role === 'client' && caller.namespace === owner ? { ok: true } : { ok: false, error: errorReply('forbidden') };
}
