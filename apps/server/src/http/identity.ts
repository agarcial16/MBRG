// Who sent a request (spec 008 FR-283 Bearer reading, FR-284, FR-300 transport part; plan 18.2 stage 1). Pure: the
// digests come from `service/ids.ts` (a hash, no clock, no random draw), the configured credentials from the settings.
// - Only `Authorization: Bearer <token>` carries a credential: exactly one header value, the scheme in any case, one
//   space, a token of the credential set and length. Anything else is anonymous (never an error of its own).
// - The token is compared by digest with the operator credential and EVERY client credential; all comparisons run,
//   whatever matched, through `sameDigest` (constant time), so the timing does not tell which one matched.
// - A well-formed token that matches no configured credential is a host-token candidate; only the pipeline, for an
//   advance request, asks the match (`hostTokenMatches`) and promotes it with `hostIdentity`; otherwise it is anonymous.
// - An identity holds a role and a digest (and a client's namespace), never the credential text.

import { errorReply, isLocalId, playerIdOf } from '@mbrg/protocol';
import type { ErrorReply } from '@mbrg/protocol';
import { credentialDigest, sameDigest } from '../service/ids';
import type { ServerSettings } from '../service/settings';

/** The longest token read (the credential length of FR-283). */
export const MAX_TOKEN_LENGTH = 256;
/** `Bearer` in any case, one space, 22 to 256 characters of the credential set. */
const BEARER = /^[Bb][Ee][Aa][Rr][Ee][Rr] ([A-Za-z0-9_-]{22,256})$/;

export type Identity =
  | { readonly role: 'operator'; readonly digest: string }
  | { readonly role: 'client'; readonly digest: string; readonly namespace: string }
  | { readonly role: 'host'; readonly digest: string }
  | { readonly role: 'candidate'; readonly digest: string }
  | { readonly role: 'anonymous' };

export type ClientIdentity = Extract<Identity, { role: 'client' }>;

/** The digests of the configured credentials, computed once at start (the settings keep the texts). */
export interface CredentialTable {
  readonly operator: string;
  readonly clients: readonly { readonly namespace: string; readonly digest: string }[];
}

export function credentialTable(settings: Pick<ServerSettings, 'operatorCredential' | 'clients'>): CredentialTable {
  return {
    operator: credentialDigest(settings.operatorCredential),
    clients: settings.clients.map((client) => ({ namespace: client.namespace, digest: credentialDigest(client.credential) })),
  };
}

/**
 * The token of the `Authorization` header values (the platform's list of every value received, or one text), or
 * undefined: no header, several headers, another scheme, extra spaces, or a token outside the credential set and length.
 */
export function readBearer(values: readonly string[] | string | undefined): string | undefined {
  const list = typeof values === 'string' ? [values] : values;
  if (list === undefined || list.length !== 1) return undefined;
  const match = BEARER.exec(list[0] as string);
  return match === null ? undefined : match[1];
}

/** The role of a token (undefined: none was presented), comparing its digest with every configured digest. */
export function identify(token: string | undefined, table: CredentialTable, compare: (a: string, b: string) => boolean = sameDigest): Identity {
  if (token === undefined) return { role: 'anonymous' };
  const digest = credentialDigest(token);
  // Every comparison runs (no early exit); the results are combined afterwards.
  const operator = compare(digest, table.operator);
  let namespace: string | undefined;
  for (const client of table.clients) {
    const same = compare(digest, client.digest);
    if (same && namespace === undefined) namespace = client.namespace;
  }
  // The settings refuse a client credential equal to the operator's or to another client's, so at most one holds.
  if (operator) return { role: 'operator', digest };
  if (namespace !== undefined) return { role: 'client', digest, namespace };
  return { role: 'candidate', digest };
}

/** A candidate whose token the match confirmed is the host; an unconfirmed one is anonymous; other roles are kept. */
export function hostIdentity(identity: Identity, matches: boolean): Identity {
  if (identity.role !== 'candidate') return identity;
  return matches ? { role: 'host', digest: identity.digest } : { role: 'anonymous' };
}

/** Submissions and own-prediction reads need a client credential (FR-284): anything else is `forbidden`. */
export function requireClient(identity: Identity): { readonly ok: true; readonly client: ClientIdentity } | { readonly ok: false; readonly error: ErrorReply } {
  return identity.role === 'client' ? { ok: true, client: identity } : { ok: false, error: errorReply('forbidden') };
}

/**
 * The player id of a submission: `<namespace of the client credential>:<local id>` (FR-284). The namespace comes only from
 * the credential; a local id that carries a separator or any character outside FR-297 is `invalid-player-id` (P31).
 * The local id is checked first: `invalid-player-id` comes before `forbidden` in the FR-301 order (plan 18.2 stages 4, 5).
 */
export function playerIdFor(identity: Identity, localId: string): { readonly ok: true; readonly playerId: string } | { readonly ok: false; readonly error: ErrorReply } {
  if (!isLocalId(localId)) return { ok: false, error: errorReply('invalid-player-id') };
  const client = requireClient(identity);
  if (!client.ok) return client;
  return { ok: true, playerId: playerIdOf(client.client.namespace, localId) };
}
