import { ERROR_ORDER, ERROR_REPLY_KEYS, listsSeveral, type ErrorReply } from './errors';
import { isLocalId, isMapId } from './ids';
import { encodePublicMatch } from './public';
import {
  ADVANCE_REPLY_KEYS,
  CREATION_REPLY_KEYS,
  EVENT_KEYS,
  HALT_REASONS,
  MATCH_SUMMARY_KEYS,
  OWN_PREDICTION_KEYS,
  PAGE_KEYS,
  PREDICTION_KINDS,
  PREDICTION_REPLY_KEYS,
  RECORD_REPLY_KEYS,
  STAGES,
  STATE_REPLY_KEYS,
  STEP_CAUSES,
  STEP_INFO_KEYS,
  STEP_KINDS,
  type AdvanceReply,
  type CreationReply,
  type MatchEvent,
  type MatchSummary,
  type OwnPrediction,
  type Page,
  type PredictionReply,
  type RecordReply,
  type StateReply,
} from './wire';

/**
 * The wire encoders (FR-257 (encoders), FR-301 (reply shapes), PD19). Each writes the keys of its reply in the order of
 * its key list whatever the order of the input object, omits an absent member (a member that is not an own property or
 * is `undefined`; never `null`), and refuses an input that carries a key outside its list, an inherited field, or a
 * value out of shape. Equal inputs give equal bytes. Messages name fields, never values.
 */

type Raw = Record<string, unknown>;

const bad = (what: string): never => {
  throw new RangeError(`invalid reply: ${what}`);
};
const own = (o: Raw, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const present = (o: Raw, k: string): boolean => own(o, k) && o[k] !== undefined;
const isInt = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const HEX64 = /^[0-9a-f]{64}$/;
const oneOf = (list: readonly string[], v: unknown): v is string => typeof v === 'string' && list.includes(v);

function objectOf(v: unknown, what: string, keys: readonly string[]): Raw {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return bad(`${what} is not an object`);
  const o = v as Raw;
  for (const k of Object.keys(o)) if (!keys.includes(k)) bad(`${what} has a field outside its key list (${k})`);
  return o;
}

/** Joins `"key":text` for the members given, in the order of `keys`; a writer returning undefined omits its member. */
function write(
  o: Raw,
  what: string,
  keys: readonly string[],
  writers: Record<string, (v: unknown) => string>,
  optional: readonly string[] = [],
  nullable: readonly string[] = [],
): string {
  const parts: string[] = [];
  for (const k of keys) {
    if (!present(o, k)) {
      if (!optional.includes(k)) bad(`${what}.${k} is required`);
      continue;
    }
    if (o[k] === null) {
      if (!nullable.includes(k)) bad(`${what}.${k} is null`);
      parts.push(`${JSON.stringify(k)}:null`);
      continue;
    }
    const writer = writers[k];
    if (writer === undefined) return bad(`${what}.${k} has no writer`);
    parts.push(`${JSON.stringify(k)}:${writer(o[k])}`);
  }
  return `{${parts.join(',')}}`;
}

const int = (what: string, min: number) => (v: unknown): string => (isInt(v, min) ? String(v) : bad(`${what} is not a whole number >= ${min}`));
const text = (what: string, test: (v: string) => boolean = (v) => v.length > 0) => (v: unknown): string =>
  typeof v === 'string' && test(v) ? JSON.stringify(v) : bad(`${what} is not a valid text`);
const member = (what: string, list: readonly string[]) => (v: unknown): string => (oneOf(list, v) ? JSON.stringify(v) : bad(`${what} is not allowed`));
const hex64 = (what: string) => (v: unknown): string => (typeof v === 'string' && HEX64.test(v) ? `"${v}"` : bad(`${what} is not 64 hex characters`));
const ids = (what: string) => (v: unknown): string =>
  Array.isArray(v) && v.every((x) => isInt(x, 1)) ? `[${(v as number[]).join(',')}]` : bad(`${what} is not a list of ids`);

/** The error reply: `kind`, then `items`, `stage`, `appliedRounds`, `retryAfter` when present (C6). */
export function encodeError(reply: ErrorReply): string {
  const o = objectOf(reply, 'error', ERROR_REPLY_KEYS);
  return write(
    o,
    'error',
    ERROR_REPLY_KEYS,
    {
      kind: member('error.kind', ERROR_ORDER),
      items: (v) => {
        if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return bad('error.items is not a list of texts');
        if (v.length > 1 && !listsSeveral(o.kind as never)) return bad('error.items lists several for a kind that lists one');
        return `[${(v as string[]).map((x) => JSON.stringify(x)).join(',')}]`;
      },
      stage: member('error.stage', STAGES),
      appliedRounds: int('error.appliedRounds', 0),
      retryAfter: int('error.retryAfter', 1),
    },
    ['items', 'stage', 'appliedRounds', 'retryAfter'],
  );
}

/** The creation reply (FR-231): match id, the public view encoding, host token. */
export function encodeCreation(reply: CreationReply): string {
  const o = objectOf(reply, 'creation', CREATION_REPLY_KEYS);
  return write(o, 'creation', CREATION_REPLY_KEYS, {
    matchId: text('creation.matchId'),
    match: (v) => encodePublicMatch(v as never),
    hostToken: text('creation.hostToken'),
  });
}

const encodeStepInfo = (v: unknown): string => {
  const o = objectOf(v, 'step', STEP_INFO_KEYS);
  return write(o, 'step', STEP_INFO_KEYS, {
    round: int('step.round', 1),
    kind: member('step.kind', STEP_KINDS),
    instant: int('step.instant', 0),
    cause: member('step.cause', STEP_CAUSES),
  });
};

/** The advance reply (FR-295 (b)): result, step, the public view encoding. */
export function encodeAdvance(reply: AdvanceReply): string {
  const o = objectOf(reply, 'advance', ADVANCE_REPLY_KEYS);
  return write(o, 'advance', ADVANCE_REPLY_KEYS, {
    result: member('advance.result', ['performed', 'already-performed']),
    step: encodeStepInfo,
    match: (v) => encodePublicMatch(v as never),
  });
}

/** Checks the round rule of a prediction: present exactly for `victim` and `absorber`. */
function predictionWriters(o: Raw, what: string): Record<string, (v: unknown) => string> {
  if (!oneOf(PREDICTION_KINDS, o.kind) || !own(o, 'kind')) bad(`${what}.kind is not a prediction kind`);
  if ((o.kind === 'winner') === present(o, 'round')) bad(`${what}.round is present exactly for victim and absorber`);
  return {
    playerId: text(`${what}.playerId`, isLocalId),
    kind: member(`${what}.kind`, PREDICTION_KINDS),
    round: int(`${what}.round`, 1),
    choice: int(`${what}.choice`, 1),
    version: int(`${what}.version`, 1),
  };
}

/** The reply of an accepted prediction (FR-267): kind, round (not for the winner), choice, version. */
export function encodePrediction(reply: PredictionReply): string {
  const o = objectOf(reply, 'prediction', PREDICTION_REPLY_KEYS);
  return write(o, 'prediction', PREDICTION_REPLY_KEYS, predictionWriters(o, 'prediction'), ['round']);
}

/** One own prediction (FR-270): local player id, kind, round (not for the winner), choice, version. */
export function encodeOwnPrediction(reply: OwnPrediction): string {
  const o = objectOf(reply, 'own prediction', OWN_PREDICTION_KEYS);
  return write(o, 'own prediction', OWN_PREDICTION_KEYS, predictionWriters(o, 'own prediction'), ['round']);
}

/** One row of the match list. */
export function encodeMatchSummary(reply: MatchSummary): string {
  const o = objectOf(reply, 'summary', MATCH_SUMMARY_KEYS);
  return write(o, 'summary', MATCH_SUMMARY_KEYS, {
    matchId: text('summary.matchId'),
    mapId: text('summary.mapId', isMapId),
    stage: member('summary.stage', STAGES),
    appliedRounds: int('summary.appliedRounds', 0),
    totalRounds: int('summary.totalRounds', 1),
    createdAt: int('summary.createdAt', 0),
  });
}

/** The state at an applied round: owners as [territory, faction] pairs in map order. */
export function encodeState(reply: StateReply): string {
  const o = objectOf(reply, 'state', STATE_REPLY_KEYS);
  return write(o, 'state', STATE_REPLY_KEYS, {
    round: int('state.round', 0),
    owners: (v) => {
      if (!Array.isArray(v)) return bad('state.owners is not a list');
      const pairs = (v as unknown[]).map((p) =>
        Array.isArray(p) && p.length === 2 && isInt(p[0], 1) && isInt(p[1], 1) ? `[${p[0]},${p[1]}]` : bad('state.owners holds a bad pair'),
      );
      return `[${pairs.join(',')}]`;
    },
    stateDigest: hex64('state.stateDigest'),
    reportedTime: int('state.reportedTime', 0),
  });
}

/** The record of an applied round. */
export function encodeRecord(reply: RecordReply): string {
  const o = objectOf(reply, 'record', RECORD_REPLY_KEYS);
  return write(o, 'record', RECORD_REPLY_KEYS, {
    round: int('record.round', 1),
    eliminated: int('record.eliminated', 1),
    absorber: int('record.absorber', 1),
    transferred: ids('record.transferred'),
  });
}

/** One page of a list (FR-279 (a)): the items through their own encoder, then `next` when the page is not the last. */
export function encodePage<T>(page: Page<T>, encodeItem: (item: T) => string): string {
  const o = objectOf(page, 'page', PAGE_KEYS);
  return write(
    o,
    'page',
    PAGE_KEYS,
    {
      items: (v) => (Array.isArray(v) ? `[${(v as T[]).map((item) => encodeItem(item)).join(',')}]` : bad('page.items is not a list')),
      next: text('page.next'),
    },
    ['next'],
  );
}

const RUNNING_STAGES = ['phase-1', 'phase-2', 'locked'] as const;
const nullOrInt = (what: string, min: number) => (v: unknown): string => (v === null ? 'null' : int(what, min)(v));
const schedule = (v: unknown): string => {
  const o = objectOf(v, 'event.schedule', ['c1', 'c2', 'a']);
  return write(o, 'event.schedule', ['c1', 'c2', 'a'], { c1: int('event.schedule.c1', 0), c2: int('event.schedule.c2', 0), a: int('event.schedule.a', 0) });
};

/** The writers of the members of each event type (the key lists are `EVENT_KEYS`). */
const EVENT_WRITERS: Record<MatchEvent['type'], Record<string, (v: unknown) => string>> = {
  'phase-closed': { seq: int('event.seq', 1), round: int('event.round', 1), phase: (v) => (v === 1 || v === 2 ? String(v) : bad('event.phase is not 1 or 2')), at: int('event.at', 0) },
  'victim-revealed': {
    seq: int('event.seq', 1),
    round: int('event.round', 1),
    victim: int('event.victim', 1),
    candidates: ids('event.candidates'),
    living: ids('event.living'),
    revealedAt: int('event.revealedAt', 0),
    c2: nullOrInt('event.c2', 0),
    a: nullOrInt('event.a', 0),
    reportedTime: int('event.reportedTime', 0),
  },
  'round-applied': {
    seq: int('event.seq', 1),
    round: int('event.round', 1),
    record: (v) => encodeRecord(v as RecordReply),
    stateDigest: hex64('event.stateDigest'),
    appliedAt: int('event.appliedAt', 0),
  },
  results: { seq: int('event.seq', 1), round: int('event.round', 1), phase: (v) => (v === 1 || v === 2 ? String(v) : bad('event.phase is not 1 or 2')) },
  schedule: { seq: int('event.seq', 1), stage: member('event.stage', RUNNING_STAGES), schedule, reportedTime: int('event.reportedTime', 0) },
  'match-finished': { seq: int('event.seq', 1), winner: int('event.winner', 1), matchSecret: hex64('event.matchSecret'), rule: text('event.rule'), reportedTime: int('event.reportedTime', 0) },
  'match-halted': { seq: int('event.seq', 1), round: int('event.round', 1), reason: member('event.reason', HALT_REASONS), reportedTime: int('event.reportedTime', 0) },
};

/**
 * One event (FR-257 (event encoders), FR-287): `type` first, then the members of its `EVENT_KEYS` list. Refuses an unknown
 * type, a member outside the list, an inherited member, a null member (only `c2` and `a` of a victim are null, both together,
 * for a match without a clock) and a value out of shape. `schedule` of a schedule event is the only optional member.
 */
export function encodeEvent(event: MatchEvent): string {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return bad('event is not an object');
  const raw = event as unknown as Raw;
  const type = own(raw, 'type') ? raw.type : undefined;
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(EVENT_KEYS, type)) return bad('event.type is not an event type');
  const kind = type as MatchEvent['type'];
  const keys = EVENT_KEYS[kind];
  const o = objectOf(raw, 'event', keys);
  for (const k of keys) if (k in o && !own(o, k)) bad(`event.${k} is inherited`);
  if (kind === 'victim-revealed' && (o.c2 === null) !== (o.a === null)) bad('event.c2 and event.a are null together or not at all');
  return write(
    o,
    'event',
    keys,
    { type: member('event.type', [kind]), ...EVENT_WRITERS[kind] },
    kind === 'schedule' ? ['schedule'] : [],
    kind === 'victim-revealed' ? ['c2', 'a'] : [],
  );
}
