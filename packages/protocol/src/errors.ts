import { STAGES, type Stage } from './wire';

/**
 * Error kinds of the server protocol (FR-301). `map-validation` stands for the map validation errors of
 * spec 001 (listed in their own order); every other entry is one kind. The array order IS the fixed order.
 */
export const ERROR_ORDER = [
  'rate-limited',
  'unknown-path',
  'method-not-allowed',
  'too-large',
  'invalid-request',
  'invalid-player-id',
  'forbidden',
  'request-id-reused',
  'unknown-match',
  'unknown-map',
  'map-validation',
  'too-few-factions',
  'invalid-timing',
  'too-many-matches',
  'match-halted',
  'match-finished',
  'name-taken',
  'match-full',
  'match-started',
  'match-expired',
  'step-mismatch',
  'round-not-applied',
  'stale-cursor',
  'prediction-closed',
  'forced-absorber',
  'invalid-choice',
  'unavailable',
] as const;

export type ErrorKind = (typeof ERROR_ORDER)[number];

/**
 * The only keys of an error reply, in their wire order (C6): none can carry a secret, credential, token or round seed.
 * `stage` and `appliedRounds` belong to `step-mismatch` (FR-295 (b)); `appliedRounds` alone to `round-not-applied`
 * (FR-258: only N is named); `retryAfter` to `rate-limited` (whole seconds, at least 1).
 */
export const ERROR_REPLY_KEYS = ['kind', 'items', 'stage', 'appliedRounds', 'retryAfter'] as const;

export interface ErrorReply {
  readonly kind: ErrorKind;
  /** Present only when items were given; more than one only for `map-validation` and `invalid-timing`. */
  readonly items?: readonly string[];
  /** The current stage, in `step-mismatch` only. */
  readonly stage?: Stage;
  /** N, the number of applied rounds, in `step-mismatch` and `round-not-applied` only. */
  readonly appliedRounds?: number;
  /** Whole seconds to wait before retrying, at least 1, in `rate-limited` only. */
  readonly retryAfter?: number;
}

const isCount = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;

/** `step-mismatch` naming the current stage and N (FR-295 (b)); the shape M2b stored, so older memo entries decode unchanged. */
export function stepMismatch(stage: Stage, appliedRounds: number): ErrorReply {
  if (!(STAGES as readonly string[]).includes(stage)) throw new RangeError('stage is not a stage');
  if (!isCount(appliedRounds)) throw new RangeError('appliedRounds is not a whole number >= 0');
  return { kind: 'step-mismatch', stage, appliedRounds };
}

/** `round-not-applied` naming only N (FR-258): the same reply for every round above N, with no items. */
export function roundNotApplied(appliedRounds: number): ErrorReply {
  if (!isCount(appliedRounds)) throw new RangeError('appliedRounds is not a whole number >= 0');
  return { kind: 'round-not-applied', appliedRounds };
}

/** `rate-limited` with the wait in whole seconds, rounded up, at least 1 (FR-299, `Retry-After`). */
export function rateLimited(seconds: number): ErrorReply {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('the wait is not a finite number >= 0');
  return { kind: 'rate-limited', retryAfter: Math.max(1, Math.ceil(seconds)) };
}

/** Whether an error may list several items (FR-301: the map validation errors and each failed timing rule). */
export function listsSeveral(kind: ErrorKind): boolean {
  return kind === 'map-validation' || kind === 'invalid-timing';
}

/** The first applicable kind in the fixed order, or undefined when the list is empty. */
export function firstError(kinds: readonly ErrorKind[]): ErrorKind | undefined {
  for (const kind of ERROR_ORDER) if (kinds.includes(kind)) return kind;
  return undefined;
}

/** Builds an error reply; several items are refused for a kind that lists only one. */
export function errorReply(kind: ErrorKind, items?: readonly string[]): ErrorReply {
  if (items === undefined) return { kind };
  if (items.length > 1 && !listsSeveral(kind)) throw new RangeError(`${kind} lists at most one item`);
  return { kind, items: [...items] };
}
