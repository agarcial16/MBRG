import { errorReply, type ErrorReply } from './errors';
import { isCommunityKey, isLocalId, isMapId } from './ids';
import { readName } from './names';
import { PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX, decodeCursor, type CursorKey } from './page';
import { readTimingShape, timingRuleFailures } from './timing';
import {
  ADVANCE_FIELDS,
  CREATION_FIELDS,
  HISTORY_FIELDS,
  JOIN_FIELDS,
  JOIN_POLICIES,
  PREDICTION_KINDS,
  RANKING_FIELDS,
  RANKING_ORDERS,
  START_FIELDS,
  STEP_KINDS,
  SUBMISSION_FIELDS,
  type AdvanceBody,
  type CreationBody,
  type JoinBody,
  type JoinPolicy,
  type PredictionKind,
  type RankingOrder,
  type StartBody,
  type StepKind,
  type SubmissionBody,
} from './wire';

export type ReadResult<T> = { ok: true; value: T } | { ok: false; error: ErrorReply };

/** A read history request (spec 024 FR-573): `limit` already holds the default and `after` is the decoded cursor key. */
export interface HistoryRequest {
  readonly community: string;
  readonly playerId?: string;
  readonly limit: number;
  readonly after?: CursorKey<'history'>;
}

const MAX_ID = 16_777_215; // faction ids are 24-bit (shared map format)
const fail = (kind: 'invalid-request' | 'invalid-player-id', field: string): { ok: false; error: ErrorReply } => ({
  ok: false,
  error: errorReply(kind, [field]),
});

type Body = Record<string, unknown>;
const bodyOf = (input: unknown): Body | undefined =>
  typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Body) : undefined;
/** Own-property rule (FR-296): a field exists only if it is an own property; the prototype chain never supplies one. */
const own = (o: Body, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const firstUnknown = (o: Body, known: readonly string[]): string | undefined => Object.keys(o).filter((k) => !known.includes(k)).sort()[0];
const isRound = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
const isFaction = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_ID;
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
/** True when the request id is missing (and required) or present and outside the FR-297 set. */
const requestIdProblem = (o: Body, required: boolean): boolean => (own(o, 'requestId') ? !isLocalId(o.requestId) : required);

/** Creation body `{ mapId, timing, requestId, joinPolicy?, community? }` (FR-231, FR-233, FR-296, spec 018 FR-490, spec 024 FR-546). */
export function readCreation(input: unknown): ReadResult<CreationBody> {
  const o = bodyOf(input);
  if (o === undefined) return fail('invalid-request', 'body');
  if (!own(o, 'mapId') || !isMapId(o.mapId)) return fail('invalid-request', 'mapId');
  if (!own(o, 'timing')) return fail('invalid-request', 'timing');
  const timing = readTimingShape(o.timing);
  if (!timing.ok) return fail('invalid-request', timing.field);
  if (requestIdProblem(o, true)) return fail('invalid-request', 'requestId');
  if (own(o, 'joinPolicy') && !isOneOf<JoinPolicy>(JOIN_POLICIES, o.joinPolicy)) return fail('invalid-request', 'joinPolicy');
  if (own(o, 'community') && !isCommunityKey(o.community)) return fail('invalid-request', 'community');
  const extra = firstUnknown(o, CREATION_FIELDS);
  if (extra !== undefined) return fail('invalid-request', extra);
  const failed = timingRuleFailures(timing.value);
  if (failed.length > 0) return { ok: false, error: errorReply('invalid-timing', failed) };
  return {
    ok: true,
    value: {
      mapId: o.mapId,
      timing: timing.value,
      requestId: o.requestId as string,
      ...(own(o, 'joinPolicy') ? { joinPolicy: o.joinPolicy as JoinPolicy } : {}),
      ...(own(o, 'community') ? { community: o.community as string } : {}),
    },
  };
}

/**
 * History request body `{ community, playerId?, limit?, cursor? }` (spec 024 FR-573). The community key, the local player id of
 * the asker, the page size (a whole number 1 to 500, default 100) and the cursor travel only in the body. The first failing member
 * in that order is named; an unknown member is named last (the first in sorted order). A player id that is a text but not a local
 * id is `invalid-player-id`, after every structural check (the FR-301 order). The cursor comes back decoded as `after`.
 */
export function readHistoryRequest(input: unknown): ReadResult<HistoryRequest> {
  const o = bodyOf(input);
  if (o === undefined) return fail('invalid-request', 'body');
  if (!own(o, 'community') || !isCommunityKey(o.community)) return fail('invalid-request', 'community');
  if (own(o, 'playerId') && typeof o.playerId !== 'string') return fail('invalid-request', 'playerId');
  let limit = PAGE_LIMIT_DEFAULT;
  if (own(o, 'limit')) {
    if (typeof o.limit !== 'number' || !Number.isSafeInteger(o.limit) || o.limit < 1 || o.limit > PAGE_LIMIT_MAX) return fail('invalid-request', 'limit');
    limit = o.limit;
  }
  let after: CursorKey<'history'> | undefined;
  if (own(o, 'cursor')) {
    if (typeof o.cursor !== 'string') return fail('invalid-request', 'cursor');
    const decoded = decodeCursor('history', o.cursor);
    if (!decoded.ok) return decoded;
    after = decoded.value;
  }
  const extra = firstUnknown(o, HISTORY_FIELDS);
  if (extra !== undefined) return fail('invalid-request', extra);
  if (own(o, 'playerId') && !isLocalId(o.playerId)) return fail('invalid-player-id', 'playerId');
  return {
    ok: true,
    value: {
      community: o.community,
      ...(own(o, 'playerId') ? { playerId: o.playerId as string } : {}),
      limit,
      ...(after === undefined ? {} : { after }),
    },
  };
}

/** A read ranking request (spec 025 FR-568 of 024 FR-573): `order` already holds the default and `after` is the decoded cursor key. */
export interface RankingRequest {
  readonly community: string;
  readonly order: RankingOrder;
  readonly playerId?: string;
  readonly limit: number;
  readonly after?: CursorKey<'ranking'>;
}

/**
 * Ranking request body `{ community, order?, playerId?, limit?, cursor? }` (spec 025, by FR-568 of 024 FR-573). The community
 * key, the order (one of the four words, `points` by default), the asker's local player id, the page size (a whole number
 * 1 to 500, default 100) and the cursor travel only in the body. The first failing member in that order is named; an unknown
 * member is named last (the first in sorted order). A player id that is a text but not a local id is `invalid-player-id`,
 * after every structural check (the FR-301 order). The cursor comes back decoded as `after`.
 */
export function readRankingRequest(input: unknown): ReadResult<RankingRequest> {
  const o = bodyOf(input);
  if (o === undefined) return fail('invalid-request', 'body');
  if (!own(o, 'community') || !isCommunityKey(o.community)) return fail('invalid-request', 'community');
  let order: RankingOrder = 'points';
  if (own(o, 'order')) {
    if (!isOneOf<RankingOrder>(RANKING_ORDERS, o.order)) return fail('invalid-request', 'order');
    order = o.order;
  }
  if (own(o, 'playerId') && typeof o.playerId !== 'string') return fail('invalid-request', 'playerId');
  let limit = PAGE_LIMIT_DEFAULT;
  if (own(o, 'limit')) {
    if (typeof o.limit !== 'number' || !Number.isSafeInteger(o.limit) || o.limit < 1 || o.limit > PAGE_LIMIT_MAX) return fail('invalid-request', 'limit');
    limit = o.limit;
  }
  let after: CursorKey<'ranking'> | undefined;
  if (own(o, 'cursor')) {
    if (typeof o.cursor !== 'string') return fail('invalid-request', 'cursor');
    const decoded = decodeCursor('ranking', o.cursor);
    if (!decoded.ok) return decoded;
    after = decoded.value;
  }
  const extra = firstUnknown(o, RANKING_FIELDS);
  if (extra !== undefined) return fail('invalid-request', extra);
  if (own(o, 'playerId') && !isLocalId(o.playerId)) return fail('invalid-player-id', 'playerId');
  return {
    ok: true,
    value: {
      community: o.community,
      order,
      ...(own(o, 'playerId') ? { playerId: o.playerId as string } : {}),
      limit,
      ...(after === undefined ? {} : { after }),
    },
  };
}

/** Advance body `{ round, step, requestId? }` (FR-244, FR-295). */
export function readAdvance(input: unknown): ReadResult<AdvanceBody> {
  const o = bodyOf(input);
  if (o === undefined) return fail('invalid-request', 'body');
  if (!own(o, 'round') || !isRound(o.round)) return fail('invalid-request', 'round');
  if (!own(o, 'step') || !isOneOf<StepKind>(STEP_KINDS, o.step)) return fail('invalid-request', 'step');
  if (requestIdProblem(o, false)) return fail('invalid-request', 'requestId');
  const extra = firstUnknown(o, ADVANCE_FIELDS);
  if (extra !== undefined) return fail('invalid-request', extra);
  return { ok: true, value: { round: o.round, step: o.step, ...(own(o, 'requestId') ? { requestId: o.requestId as string } : {}) } };
}

/** Start body `{ requestId? }` (an empty object is accepted); the first failing field is named. */
export function readStart(input: unknown): ReadResult<StartBody> {
  const o = bodyOf(input);
  if (o === undefined) return fail('invalid-request', 'body');
  if (requestIdProblem(o, false)) return fail('invalid-request', 'requestId');
  const extra = firstUnknown(o, START_FIELDS);
  if (extra !== undefined) return fail('invalid-request', extra);
  return { ok: true, value: own(o, 'requestId') ? { requestId: o.requestId as string } : {} };
}

/**
 * Join body `{ name, requestId }` (FR-377, FR-296): the first failing field in this order is named. The name comes back
 * trimmed and NFC-normalised; a name failure carries no detail of the rule (FR-384).
 */
export function readJoin(input: unknown): ReadResult<JoinBody> {
  const o = bodyOf(input);
  if (o === undefined) return fail('invalid-request', 'body');
  const name = own(o, 'name') ? readName(o.name) : undefined;
  if (name === undefined || !name.ok) return fail('invalid-request', 'name');
  if (requestIdProblem(o, true)) return fail('invalid-request', 'requestId');
  const extra = firstUnknown(o, JOIN_FIELDS);
  if (extra !== undefined) return fail('invalid-request', extra);
  return { ok: true, value: { name: name.name, requestId: o.requestId as string } };
}

/**
 * Submission body `{ kind, round?, faction, playerId, requestId? }` (FR-261, FR-284). `round` is present exactly for
 * `victim` and `absorber`. Structural problems (`invalid-request`) come before the player id charset
 * (`invalid-player-id`), the FR-301 order; a namespaced or otherwise invalid local player id is rejected (FR-284, FR-297).
 */
export function readSubmission(input: unknown): ReadResult<SubmissionBody> {
  const o = bodyOf(input);
  if (o === undefined) return fail('invalid-request', 'body');
  if (!own(o, 'kind') || !isOneOf<PredictionKind>(PREDICTION_KINDS, o.kind)) return fail('invalid-request', 'kind');
  const perRound = o.kind !== 'winner';
  if (perRound ? !own(o, 'round') || !isRound(o.round) : own(o, 'round')) return fail('invalid-request', 'round');
  if (!own(o, 'faction') || !isFaction(o.faction)) return fail('invalid-request', 'faction');
  if (!own(o, 'playerId') || typeof o.playerId !== 'string') return fail('invalid-request', 'playerId');
  if (requestIdProblem(o, false)) return fail('invalid-request', 'requestId');
  const name = own(o, 'name') ? readName(o.name) : undefined;
  if (name !== undefined && !name.ok) return fail('invalid-request', 'name');
  const extra = firstUnknown(o, SUBMISSION_FIELDS);
  if (extra !== undefined) return fail('invalid-request', extra);
  if (!isLocalId(o.playerId)) return fail('invalid-player-id', 'playerId');
  return {
    ok: true,
    value: {
      kind: o.kind,
      ...(perRound ? { round: o.round as number } : {}),
      faction: o.faction,
      playerId: o.playerId,
      ...(own(o, 'requestId') ? { requestId: o.requestId as string } : {}),
      ...(name !== undefined && name.ok ? { name: name.name } : {}),
    },
  };
}
