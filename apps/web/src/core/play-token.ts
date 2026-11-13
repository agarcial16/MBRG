// The personal tokens of the player interface (spec 013 FR-394, FR-397, NFR-78). Pure: the storage is a parameter. A token is kept
// per match in the browser storage and travels only as `Authorization: Bearer` to the same server; the personal link carries it
// in the URL fragment, which the browser never sends. Nothing here logs, sends or puts a token in a query.
import { isCredentialText, isJoinedPlayerId } from '@mbrg/protocol';

/** The part of the browser storage this module uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A joined player: its namespaced id and the secret token the server issued once. */
export interface PlayerCredentials {
  readonly playerId: string;
  readonly token: string;
}

const playerKey = (matchId: string): string => `mbrg:player:${matchId}`;
const hostKey = (matchId: string): string => `mbrg:host:${matchId}`;

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** The credentials a stored text holds, or undefined when it is anything but exactly a valid player id and token. */
function readPlayer(text: string | null): PlayerCredentials | undefined {
  if (text === null) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const keys = Object.keys(value);
    if (keys.length !== 2 || !hasOwn(value, 'playerId') || !hasOwn(value, 'token')) return undefined;
    const { playerId, token } = value as Record<string, unknown>;
    return isJoinedPlayerId(playerId) && isCredentialText(token) ? { playerId, token } : undefined;
  } catch {
    return undefined;
  }
}

function read(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: StorageLike, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export const loadPlayer = (storage: StorageLike, matchId: string): PlayerCredentials | undefined => readPlayer(read(storage, playerKey(matchId)));

/** False when the storage refused the write (the player then plays this page only). */
export const savePlayer = (storage: StorageLike, matchId: string, player: PlayerCredentials): boolean =>
  write(storage, playerKey(matchId), JSON.stringify({ playerId: player.playerId, token: player.token }));

export function clearPlayer(storage: StorageLike, matchId: string): void {
  try {
    storage.removeItem(playerKey(matchId));
  } catch {
    // Nothing to clear when the storage is not available.
  }
}

export function loadHost(storage: StorageLike, matchId: string): string | undefined {
  const text = read(storage, hostKey(matchId));
  return isCredentialText(text) ? text : undefined;
}

export const saveHost = (storage: StorageLike, matchId: string, hostToken: string): boolean => write(storage, hostKey(matchId), hostToken);

/** The link of a match: what anyone may share. It holds no credential. `base` is the page address without query or fragment. */
export const matchLink = (base: string, matchId: string): string => `${base}?match=${matchId}`;

/** The personal link (FR-397): the match link plus the credentials in the fragment. Whoever holds it is the player. */
export const personalLink = (base: string, matchId: string, player: PlayerCredentials): string =>
  `${matchLink(base, matchId)}#p=${encodeURIComponent(player.playerId)}&t=${encodeURIComponent(player.token)}`;

/** The player a fragment (`#p=...&t=...`) names, or undefined when it is not exactly that. */
export function readFragment(hash: string): PlayerCredentials | undefined {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  if (text === '') return undefined;
  try {
    const params = new URLSearchParams(text);
    const names = [...params.keys()];
    if (names.length !== 2 || params.getAll('p').length !== 1 || params.getAll('t').length !== 1) return undefined;
    const playerId = params.get('p');
    const token = params.get('t');
    return isJoinedPlayerId(playerId) && isCredentialText(token) ? { playerId, token } : undefined;
  } catch {
    return undefined;
  }
}

/** A personal link opened here: its player is stored for the match. False (nothing stored) when the fragment is not one. */
export function adoptFragment(storage: StorageLike, matchId: string, hash: string): boolean {
  const player = readFragment(hash);
  return player !== undefined && savePlayer(storage, matchId, player);
}
