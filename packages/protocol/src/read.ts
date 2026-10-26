import { errorReply, type ErrorReply } from './errors';
import { isLocalId, isMapId } from './ids';
import { readTimingShape, timingRuleFailures } from './timing';
import {
  ADVANCE_FIELDS,
  CREATION_FIELDS,
  PREDICTION_KINDS,
  STEP_KINDS,
  SUBMISSION_FIELDS,
  type AdvanceBody,
  type CreationBody,
  type PredictionKind,
  type StepKind,
  type SubmissionBody,
} from './wire';

export type ReadResult<T> = { ok: true; value: T } | { ok: false; error: ErrorReply };

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

/** Creation body `{ mapId, timing, requestId }` (FR-231, FR-233, FR-296). */
export function readCreation(input: unknown): ReadResult<CreationBody> {
  const o = bodyOf(input);
  if (o === undefined) return fail('invalid-request', 'body');
  if (!own(o, 'mapId') || !isMapId(o.mapId)) return fail('invalid-request', 'mapId');
  if (!own(o, 'timing')) return fail('invalid-request', 'timing');
  const timing = readTimingShape(o.timing);
  if (!timing.ok) return fail('invalid-request', timing.field);
  if (requestIdProblem(o, true)) return fail('invalid-request', 'requestId');
  const extra = firstUnknown(o, CREATION_FIELDS);
  if (extra !== undefined) return fail('invalid-request', extra);
  const failed = timingRuleFailures(timing.value);
  if (failed.length > 0) return { ok: false, error: errorReply('invalid-timing', failed) };
  return { ok: true, value: { mapId: o.mapId, timing: timing.value, requestId: o.requestId as string } };
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
    },
  };
}
