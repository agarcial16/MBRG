// Text rules of identifiers (FR-297, FR-283, FR-284). Anchored on both ends; `$` never matches before a final newline in JS.
const LOCAL_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const MAP_ID = /^[a-z0-9-]{1,64}$/;
const NAMESPACE = /^[a-z0-9]{1,16}$/;

/** Separator between the namespace and the local id of a player id; never allowed inside either. */
export const NAMESPACE_SEPARATOR = ':';

/** A local player id or a client request id: 1 to 64 characters of `A-Z a-z 0-9 _ - .` (FR-297). */
export function isLocalId(value: unknown): value is string {
  return typeof value === 'string' && LOCAL_ID.test(value);
}

/** A map id: 1 to 64 characters of `a-z 0-9 -`. */
export function isMapId(value: unknown): value is string {
  return typeof value === 'string' && MAP_ID.test(value);
}

/** A credential namespace: 1 to 16 characters of `a-z 0-9` (FR-283). */
export function isNamespace(value: unknown): value is string {
  return typeof value === 'string' && NAMESPACE.test(value);
}

/** The player id of a credential's namespace and an already checked local id (FR-284). */
export function playerIdOf(namespace: string, localId: string): string {
  if (!isNamespace(namespace)) throw new RangeError('invalid namespace');
  if (!isLocalId(localId)) throw new RangeError('invalid local player id');
  return `${namespace}${NAMESPACE_SEPARATOR}${localId}`;
}
