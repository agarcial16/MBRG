// The bot's own reads of two replies the protocol package has no reader for (spec 012 FR-456, FR-451). The page of phase
// results is read down to the players who guessed right: the choice, the points and every wrong guess are dropped at once, so
// nothing later can carry them (008 P12). Pure; untrusted JSON in, a value or undefined out.
import { isCredentialText, readPublicMatch } from '@mbrg/protocol';
import type { PublicMatch } from '@mbrg/protocol';

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface CorrectPage {
  /** The ids of the players who guessed right on this page, in the server's order. */
  readonly correct: readonly string[];
  /** The cursor of the next page, when there is one. */
  readonly next: string | undefined;
}

export function readCorrectPage(input: unknown): CorrectPage | undefined {
  if (!isObject(input) || !hasOwn(input, 'items') || !Array.isArray(input.items)) return undefined;
  const correct: string[] = [];
  for (const item of input.items as unknown[]) {
    if (!isObject(item) || !hasOwn(item, 'playerId') || !hasOwn(item, 'correct')) return undefined;
    if (typeof item.playerId !== 'string' || typeof item.correct !== 'boolean') return undefined;
    if (item.correct) correct.push(item.playerId);
  }
  const next = hasOwn(input, 'next') ? input.next : undefined;
  if (next !== undefined && typeof next !== 'string') return undefined;
  return { correct, next };
}

export interface Created {
  readonly matchId: string;
  readonly hostToken: string;
  readonly match: PublicMatch;
}

/** The reply of a creation: the match id, its public data and the host token. */
export function readCreated(input: unknown): Created | undefined {
  if (!isObject(input) || !hasOwn(input, 'matchId') || !hasOwn(input, 'match') || !hasOwn(input, 'hostToken')) return undefined;
  if (typeof input.matchId !== 'string' || !isCredentialText(input.hostToken)) return undefined;
  const match = readPublicMatch(input.match);
  if (!match.ok || match.value.matchId !== input.matchId) return undefined;
  return { matchId: input.matchId, hostToken: input.hostToken, match: match.value };
}

/** How many factions live in a public state: the distinct owners (the rule of the server's own count). */
export const livingCount = (owners: readonly (readonly [number, number])[]): number => new Set(owners.map(([, faction]) => faction)).size;
