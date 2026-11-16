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
  | { readonly ok: true; readonly policy: 'client'; readonly namespace: string }
  | { readonly ok: false; readonly error: ErrorReply };

export type PolicyDecision = { readonly ok: true } | { readonly ok: false; readonly error: ErrorReply };

/**
 * The policy of a new match. On the operator path (008) any `joinPolicy` is `invalid-request` naming it (FR-493); elsewhere
 * `client` needs a client credential, whose namespace becomes the owner (FR-491), and any other caller gets `forbidden`
 * (FR-492). Absent or `open` is the open policy for everybody (FR-490).
 */
export function creationPolicy(requested: JoinPolicy | undefined, caller: PolicyCaller, operatorPath: boolean): CreationPolicyDecision {
  if (operatorPath && requested !== undefined) return { ok: false, error: errorReply('invalid-request', ['joinPolicy']) };
  if (requested !== 'client') return { ok: true, policy: 'open' };
  if (caller.role !== 'client') return { ok: false, error: errorReply('forbidden') };
  return { ok: true, policy: 'client', namespace: caller.namespace };
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
