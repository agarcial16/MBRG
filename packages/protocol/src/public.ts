import { isMapId } from './ids';
import {
  HALT_REASONS,
  PUBLIC_MATCH_KEYS,
  PUBLIC_VICTIM_KEYS,
  STAGES,
  type HaltReason,
  type PublicMatch,
  type PublicSchedule,
  type PublicState,
  type PublicVictim,
  type Stage,
  type Timing,
} from './wire';

/**
 * The public view encoder (FR-253, FR-254, FR-257, NFR-47 (b)). It takes only a `PublicMatch`, which has no field for
 * an absorber, a pending state or a round seed, writes the fields in the fixed order of `PUBLIC_MATCH_KEYS` whatever
 * the order of the input, and rejects an input that carries a field its stage must not carry or any field outside the
 * public key list. Messages name fields, never values.
 */

type Raw = Record<string, unknown>;

const bad = (what: string): never => {
  throw new RangeError(`invalid public view: ${what}`);
};
const own = (o: Raw, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const has = (o: Raw, k: string): boolean => own(o, k) && o[k] !== undefined;
const isInt = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const HEX64 = /^[0-9a-f]{64}$/;

function objectOf(v: unknown, what: string, keys: readonly string[]): Raw {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return bad(`${what} is not an object`);
  const o = v as Raw;
  for (const k of Object.keys(o)) if (!keys.includes(k)) bad(`${what} has a field outside the public list (${k})`);
  return o;
}
function intField(o: Raw, k: string, min: number, what: string): number {
  const v = has(o, k) ? o[k] : undefined;
  return isInt(v, min) ? v : bad(`${what}.${k} is not an integer of at least ${min}`);
}
function hexField(o: Raw, k: string): string {
  const v = has(o, k) ? o[k] : undefined;
  return typeof v === 'string' && HEX64.test(v) ? v : bad(`${k} is not 64 lowercase hexadecimal characters`);
}

function readTiming(v: unknown): Timing {
  if (v === 'manual') return v;
  const o = objectOf(v, 'timing', ['i', 'l1', 'l2']);
  return { i: intField(o, 'i', 0, 'timing'), l1: intField(o, 'l1', 0, 'timing'), l2: intField(o, 'l2', 0, 'timing') };
}

function readState(v: unknown, applied: number): PublicState {
  const o = objectOf(v, 'state', ['mode', 'round', 'owners']);
  if (o.mode !== 'classic') bad('state.mode is not classic');
  if (intField(o, 'round', 0, 'state') !== applied) bad('state.round differs from appliedRounds');
  if (!Array.isArray(o.owners)) return bad('state.owners is not an array');
  const owners = (o.owners as unknown[]).map((p): readonly [number, number] => {
    if (!Array.isArray(p) || p.length !== 2 || !isInt(p[0], 1) || !isInt(p[1], 1)) return bad('state.owners holds a bad pair');
    return [p[0], p[1]];
  });
  return { mode: 'classic', round: applied, owners };
}

/**
 * The anchors are those of the pending round as currently shifted (FR-244). An early manual close leaves earlier anchors
 * behind the later ones, so the order is checked only for what is still pending: all three in `phase-1`, C2 and A in
 * `phase-2`, nothing in `locked` (only A is pending).
 */
function readSchedule(v: unknown, stage: Stage): PublicSchedule {
  const o = objectOf(v, 'schedule', ['c1', 'c2', 'a']);
  const s = { c1: intField(o, 'c1', 0, 'schedule'), c2: intField(o, 'c2', 0, 'schedule'), a: intField(o, 'a', 0, 'schedule') };
  if (stage === 'phase-1' && !(s.c1 <= s.c2 && s.c2 <= s.a)) bad('schedule instants are not in order');
  if (stage === 'phase-2' && !(s.c2 <= s.a)) bad('schedule instants are not in order');
  return s;
}

function intList(o: Raw, k: string): number[] {
  const v = has(o, k) ? o[k] : undefined;
  if (!Array.isArray(v) || !v.every((x) => isInt(x, 1))) return bad(`victim.${k} is not a list of faction ids`);
  return [...(v as number[])];
}

function readVictim(v: unknown, applied: number, timing: Timing): PublicVictim {
  const o = objectOf(v, 'victim', PUBLIC_VICTIM_KEYS);
  const round = intField(o, 'round', 1, 'victim');
  if (round !== applied + 1) bad('victim.round is not the pending round');
  const victim = intField(o, 'victim', 1, 'victim');
  const living = intList(o, 'living');
  const candidates = intList(o, 'candidates');
  if (new Set(living).size !== living.length || !living.includes(victim)) bad('victim.living is not a set holding the victim');
  let at = -1;
  for (const c of candidates) {
    const index = living.indexOf(c);
    if (c === victim || index <= at) bad('victim.candidates is not a subset of living, victim excluded, in living order');
    at = index;
  }
  const revealedAt = intField(o, 'revealedAt', 0, 'victim');
  const seq = intField(o, 'seq', 1, 'victim');
  let c2: number | null = null;
  let a: number | null = null;
  if (timing === 'manual') {
    if (o.c2 !== null || o.a !== null) bad('victim.c2 and victim.a are not null for timing manual');
  } else {
    c2 = intField(o, 'c2', 0, 'victim');
    a = intField(o, 'a', 0, 'victim');
  }
  // `forced` exists only when true (a single candidate); `false`, or any other value, is refused.
  if (has(o, 'forced') && o.forced !== true) bad('victim.forced is present but not true');
  return has(o, 'forced') ? { round, victim, candidates, living, revealedAt, c2, a, forced: true, seq } : { round, victim, candidates, living, revealedAt, c2, a, seq };
}

interface Checked {
  matchId: string;
  mapId: string;
  mapDigest: string;
  totalRounds: number;
  timing: Timing;
  commitment: string;
  stage: Stage;
  appliedRounds: number;
  state: PublicState;
  stateDigest: string;
  lastSeq: number;
  reportedTime: number;
  schedule?: PublicSchedule;
  victim?: PublicVictim;
  winner?: number;
  matchSecret?: string;
  haltReason?: HaltReason;
}

/** Validates the public view against the rules of its stage and returns a clean copy (only the public fields). */
function check(input: unknown): Checked {
  const o = objectOf(input, 'view', PUBLIC_MATCH_KEYS);
  const matchId = has(o, 'matchId') ? o.matchId : undefined;
  if (typeof matchId !== 'string' || matchId.length === 0) bad('matchId is not a non-empty text');
  const mapId = has(o, 'mapId') ? o.mapId : undefined;
  if (!isMapId(mapId)) bad('mapId is not a map id');
  const stage = has(o, 'stage') ? o.stage : undefined;
  if (typeof stage !== 'string' || !(STAGES as readonly string[]).includes(stage)) bad('stage is not a stage');
  const totalRounds = intField(o, 'totalRounds', 1, 'view');
  const appliedRounds = intField(o, 'appliedRounds', 0, 'view');
  const timing = readTiming(has(o, 'timing') ? o.timing : undefined);
  const out: Checked = {
    matchId: matchId as string,
    mapId: mapId as string,
    mapDigest: hexField(o, 'mapDigest'),
    totalRounds,
    timing,
    commitment: hexField(o, 'commitment'),
    stage: stage as Stage,
    appliedRounds,
    state: readState(has(o, 'state') ? o.state : undefined, appliedRounds),
    stateDigest: hexField(o, 'stateDigest'),
    lastSeq: intField(o, 'lastSeq', 1, 'view'),
    reportedTime: intField(o, 'reportedTime', 0, 'view'),
  };
  const running = out.stage === 'phase-1' || out.stage === 'phase-2' || out.stage === 'locked';
  if (out.stage === 'finished' ? appliedRounds !== totalRounds : appliedRounds >= totalRounds) bad('appliedRounds does not fit the stage');

  // FR-288 and FR-254: the victim fields only after the phase-1 close of the pending round (never in finished).
  const revealStage = out.stage === 'phase-2' || out.stage === 'locked';
  if (has(o, 'victim')) {
    if (!revealStage && out.stage !== 'halted') bad('victim is not allowed in this stage');
    out.victim = readVictim(o.victim, appliedRounds, timing);
  } else if (revealStage) bad('victim is required in this stage');

  // Anchors of the pending round, only while the clock runs.
  if (has(o, 'schedule')) {
    if (!running || timing === 'manual') bad('schedule is not allowed here');
    out.schedule = readSchedule(o.schedule, out.stage);
  } else if (running && timing !== 'manual') bad('schedule is required while the clock runs');

  // FR-253, FR-259: the winner and the match secret only for a finished match, together.
  if (out.stage === 'finished') {
    out.winner = intField(o, 'winner', 1, 'view');
    out.matchSecret = hexField(o, 'matchSecret');
  } else if (has(o, 'winner') || has(o, 'matchSecret')) bad('winner and matchSecret are allowed only when finished');

  if (out.stage === 'halted') {
    const reason = has(o, 'haltReason') ? o.haltReason : undefined;
    if (typeof reason !== 'string' || !(HALT_REASONS as readonly string[]).includes(reason)) bad('haltReason is required when halted');
    out.haltReason = reason as HaltReason;
  } else if (has(o, 'haltReason')) bad('haltReason is allowed only when halted');
  return out;
}

const list = (xs: readonly number[]): string => `[${xs.join(',')}]`;

/** The text of a public view: JSON with the fields in the fixed order of `PUBLIC_MATCH_KEYS`. Throws RangeError. */
export function encodePublicMatch(view: PublicMatch): string {
  const m = check(view);
  const timing = m.timing === 'manual' ? '"manual"' : `{"i":${m.timing.i},"l1":${m.timing.l1},"l2":${m.timing.l2}}`;
  const owners = `[${m.state.owners.map((p) => `[${p[0]},${p[1]}]`).join(',')}]`;
  const parts = [
    `"matchId":${JSON.stringify(m.matchId)}`,
    `"mapId":${JSON.stringify(m.mapId)}`,
    `"mapDigest":"${m.mapDigest}"`,
    `"totalRounds":${m.totalRounds}`,
    `"timing":${timing}`,
    `"commitment":"${m.commitment}"`,
    `"stage":"${m.stage}"`,
    `"appliedRounds":${m.appliedRounds}`,
    `"state":{"mode":"classic","round":${m.state.round},"owners":${owners}}`,
    `"stateDigest":"${m.stateDigest}"`,
    `"lastSeq":${m.lastSeq}`,
    `"reportedTime":${m.reportedTime}`,
  ];
  if (m.schedule !== undefined) parts.push(`"schedule":{"c1":${m.schedule.c1},"c2":${m.schedule.c2},"a":${m.schedule.a}}`);
  if (m.victim !== undefined) {
    const v = m.victim;
    parts.push(
      `"victim":{"round":${v.round},"victim":${v.victim},"candidates":${list(v.candidates)},"living":${list(v.living)},"revealedAt":${v.revealedAt},"c2":${v.c2},"a":${v.a},${v.forced === true ? '"forced":true,' : ''}"seq":${v.seq}}`,
    );
  }
  if (m.winner !== undefined) parts.push(`"winner":${m.winner}`);
  if (m.matchSecret !== undefined) parts.push(`"matchSecret":"${m.matchSecret}"`);
  if (m.haltReason !== undefined) parts.push(`"haltReason":"${m.haltReason}"`);
  return `{${parts.join(',')}}`;
}
