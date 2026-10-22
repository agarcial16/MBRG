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
  'step-mismatch',
  'round-not-applied',
  'stale-cursor',
  'prediction-closed',
  'invalid-choice',
  'unavailable',
] as const;

export type ErrorKind = (typeof ERROR_ORDER)[number];

/** The only keys of an error reply: none can carry a secret, credential, token or round seed. */
export const ERROR_REPLY_KEYS = ['kind', 'items'] as const;

export interface ErrorReply {
  readonly kind: ErrorKind;
  /** Present only when items were given; more than one only for `map-validation` and `invalid-timing`. */
  readonly items?: readonly string[];
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
