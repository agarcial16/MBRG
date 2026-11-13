// The forms of the player interface (spec 013 FR-393 to FR-396, FR-398): what the create screen offers from the public config, the
// creation body, the strict read of the creation reply, the name rule before a join and one plain Spanish sentence per refusal.
// Pure: the config, the ids and the replies come in as parameters.
import { CREATION_REPLY_KEYS, isCredentialText, readName, readPublicMatch } from '@mbrg/protocol';
import type { CreationBody, CreationReply, PublicConfig } from '@mbrg/protocol';
import { STRINGS, fillTemplate } from './strings';

export type Pace = 'fast' | 'normal' | 'slow';

export const PACES: readonly { readonly id: Pace; readonly label: string }[] = [
  { id: 'fast', label: STRINGS.createPaceFast },
  { id: 'normal', label: STRINGS.createPaceNormal },
  { id: 'slow', label: STRINGS.createPaceSlow },
];

export interface PaceTiming {
  readonly i: number;
  readonly l1: number;
  readonly l2: number;
}

/** What each pace asks for before the public bounds apply, in seconds: the round interval and the two prediction phases. */
const TARGETS: Readonly<Record<Exclude<Pace, 'fast'>, PaceTiming>> = {
  normal: { i: 60, l1: 30, l2: 15 },
  slow: { i: 300, l1: 150, l2: 60 },
};

/**
 * The timing of a pace inside the public bounds. `fast` is the shortest timing the server allows; the others are their target
 * lifted to the bounds (never below a minimum, the interval never above the maximum and always longer than the two phases).
 * Where the bounds leave no room for a target, the pace falls back to the shortest timing, which the settings keep valid.
 */
export function paceTiming(pace: Pace, config: PublicConfig): PaceTiming {
  const shortest: PaceTiming = { i: config.minInterval, l1: config.minPhase1, l2: config.minPhase2 };
  if (pace === 'fast') return shortest;
  const target = TARGETS[pace];
  const l1 = Math.max(target.l1, config.minPhase1);
  const l2 = Math.max(target.l2, config.minPhase2);
  const i = Math.min(config.maxInterval, Math.max(target.i, config.minInterval, l1 + l2 + 1));
  return i > l1 + l2 ? { i, l1, l2 } : shortest;
}

/** What the create button can offer: the public maps in the server's order, or that creation is off. */
export const createOptions = (config: PublicConfig): { readonly enabled: boolean; readonly maps: readonly string[] } => ({
  enabled: config.enabled && config.maps.length > 0,
  maps: config.maps,
});

/** The body of a creation: map, timing and request id; never an operator credential (that is a header the page never sets). */
export const createBody = (input: { mapId: string; pace: Pace; config: PublicConfig; requestId: string }): CreationBody => ({
  mapId: input.mapId,
  timing: paceTiming(input.pace, input.config),
  requestId: input.requestId,
});

/** A length of time in seconds as "30 s", "5 min", "1 h 30 min". */
export function durationText(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} h`);
  if (m > 0) parts.push(`${m} min`);
  // Seconds are dropped from an hour on: "1 h 30 min", not "1 h 30 min 5 s".
  if (s > 0 && h === 0) parts.push(`${s} s`);
  return parts.join(' ');
}

const MATCH_ID = /^[A-Za-z0-9_-]{16}$/;
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** The creation reply, read strictly: exactly its three members, a well-formed match, an id that agrees and a host token. */
export function readCreation(input: unknown): { readonly ok: true; readonly value: CreationReply } | { readonly ok: false } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false };
  const keys = Object.keys(input);
  if (keys.length !== CREATION_REPLY_KEYS.length || !CREATION_REPLY_KEYS.every((k) => hasOwn(input, k))) return { ok: false };
  const { matchId, match, hostToken } = input as Record<string, unknown>;
  if (typeof matchId !== 'string' || !MATCH_ID.test(matchId) || !isCredentialText(hostToken)) return { ok: false };
  const read = readPublicMatch(match);
  if (!read.ok || read.value.matchId !== matchId) return { ok: false };
  return { ok: true, value: { matchId, match: read.value, hostToken } };
}

/** The sentence of a refused creation (FR-395); `retryAfter` is the whole seconds a `rate-limited` reply carried. */
export function createFailure(outcome: string, retryAfter?: number): string {
  switch (outcome) {
    case 'too-many-matches':
      return STRINGS.createTooMany;
    case 'rate-limited':
      return retryAfter === undefined ? STRINGS.createRateLimited : fillTemplate(STRINGS.createRateLimitedWait, { value: retryAfter });
    case 'invalid-timing':
      return STRINGS.createInvalidTiming;
    case 'unknown-map':
      return STRINGS.createUnknownMap;
    case 'unavailable':
      return STRINGS.createUnavailable;
    case 'network':
      return STRINGS.createNetwork;
    default:
      return STRINGS.createFailed;
  }
}

/** The sentence of a refused join (FR-396). */
export function joinFailure(outcome: string, retryAfter?: number): string {
  switch (outcome) {
    case 'name-taken':
      return STRINGS.joinNameTaken;
    case 'match-full':
      return STRINGS.joinFull;
    case 'match-expired':
      return STRINGS.joinExpired;
    case 'match-finished':
      return STRINGS.joinFinished;
    case 'match-halted':
      return STRINGS.joinHalted;
    case 'invalid-request':
      return STRINGS.joinNameRule;
    case 'rate-limited':
      return retryAfter === undefined ? STRINGS.createRateLimited : fillTemplate(STRINGS.createRateLimitedWait, { value: retryAfter });
    case 'unknown-match':
      return STRINGS.joinUnknown;
    case 'network':
      return STRINGS.createNetwork;
    default:
      return STRINGS.joinFailed;
  }
}

/** The sentence of a refused start (FR-398, FR-399). */
export function startFailure(outcome: string): string {
  switch (outcome) {
    case 'forbidden':
      return STRINGS.lobbyStartForbidden;
    case 'match-started':
      return STRINGS.lobbyStartStarted;
    case 'match-expired':
      return STRINGS.joinExpired;
    default:
      return STRINGS.lobbyStartFailed;
  }
}

export type NameCheck = { readonly ok: true; readonly name: string } | { readonly ok: false; readonly sentence: string };

/** The name rule of FR-377 applied before sending: the same reader the server uses, so a name that passes here is not refused for its form. */
export function checkName(text: string): NameCheck {
  const read = readName(text);
  return read.ok ? { ok: true, name: read.name } : { ok: false, sentence: STRINGS.joinNameRule };
}
