import { createHash } from 'node:crypto';
import { encodePublicMatch } from '@mbrg/protocol';
import type { StepKind, Timing } from '@mbrg/protocol';
import { effectiveInstant, reportedTime } from '../../src/core/time';
import { publicOf } from '../../src/core/view';
import type { StepCause } from '../../src/core/view';
import { roundSeed } from '../../src/secret';
import { coreDriver } from './core-driver';
import type { Driver } from './core-driver';

// Scripted dev-map matches for the core timeline goldens (spec 008 NFR-48 core timelines, NFR-50, FR-315 core part).
// Each action sets the fake clock to T0 + `at` and then either ticks (runs the one due step, if any) or performs a manual
// advance of the named step. The EXPECTATIONS (`expect`) are derived by hand from the spec formulas (FR-239, FR-244,
// FR-248, FR-249: C1 = t0 + I - L1 - L2, C2 = C1 + L1, A = C2 + L2; manual and late shifts), written as offsets from T0;
// the code under test never produces them. The golden file adds what is not derived by hand (digests, event order).

export const T0 = 1_700_000_000_000;

export type Rows = readonly (readonly [round: number, kind: StepKind, offset: number, cause: StepCause])[];
export interface Expect {
  readonly rows: Rows;
  /** [c1, c2, a] offsets after the action, or null (timing `manual` or the match is over). */
  readonly anchors: readonly [number, number, number] | null;
  readonly stage: string;
}
export interface Action {
  readonly at: number;
  readonly act: 'tick' | StepKind;
  /** null: nothing is due, no outcome. */
  readonly expect: Expect | null;
}
export interface Scenario {
  readonly name: string;
  readonly timing: Timing;
  /** The golden secret of golden/dev-secrets.json. */
  readonly secret: 'ascending-00-1f' | 'ascending-20-3f' | 'all-a5';
  readonly actions: readonly Action[];
}

export const SECRETS = {
  'ascending-00-1f': Uint8Array.from({ length: 32 }, (_, i) => i),
  'ascending-20-3f': Uint8Array.from({ length: 32 }, (_, i) => 32 + i),
  'all-a5': new Uint8Array(32).fill(0xa5),
} as const;
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

const ROUNDS = 4;
const S = 1000;
type Kinds = readonly [StepKind, StepKind, StepKind];
const KINDS: Kinds = ['phase-1-close', 'phase-2-close', 'application'];

/** The phase-2 span F of a forced round in these scenarios (spec 011 FR-388; the driver and the service harness use 5 s). */
const F = 5;
/**
 * The rounds whose absorber is forced (one candidate, spec 011 FR-387), by secret: counted by hand from the d of each round
 * of golden/dev-secrets.json (the candidates of the victim in the state before the round). The last round of every match is forced.
 */
const FORCED_ROUNDS: Record<Scenario['secret'], readonly number[]> = { 'ascending-00-1f': [4], 'ascending-20-3f': [4], 'all-a5': [3, 4] };

/**
 * Hand model of an on-time match: round k starts at the application instant of round k - 1 (the first at 0). After a forced reveal
 * phase 2 lasts min(L1, F) and A moves earlier by the time saved (FR-388); the next round is anchored at the application as in 008.
 */
function onTime(timing: { i: number; l1: number; l2: number }, forced: readonly number[]): Action[] {
  const out: Action[] = [];
  let t0 = 0;
  for (let k = 1; k <= ROUNDS; k++) {
    const c1 = t0 + (timing.i - timing.l1 - timing.l2) * S;
    const c2 = c1 + (forced.includes(k) ? Math.min(timing.l1, F) : timing.l1) * S;
    const a = c2 + timing.l2 * S;
    t0 = a;
    const next = a + (timing.i - timing.l1 - timing.l2) * S;
    const nextAnchors = k < ROUNDS ? ([next, next + timing.l1 * S, next + (timing.l1 + timing.l2) * S] as const) : null;
    const here = [c1, c2, a] as const;
    out.push({ at: c1 - 1, act: 'tick', expect: null });
    out.push({ at: c1, act: 'tick', expect: { rows: [[k, 'phase-1-close', c1, 'clock']], anchors: here, stage: 'phase-2' } });
    if (timing.l2 === 0) {
      // C2 = A: the phase-2 close and the application are one decision, two rows, same instant.
      out.push({ at: c2 - 1, act: 'tick', expect: null });
      out.push({
        at: c2,
        act: 'tick',
        expect: { rows: [[k, 'phase-2-close', c2, 'clock'], [k, 'application', c2, 'clock']], anchors: nextAnchors, stage: k < ROUNDS ? 'phase-1' : 'finished' },
      });
    } else {
      out.push({ at: c2 - 1, act: 'tick', expect: null });
      out.push({ at: c2, act: 'tick', expect: { rows: [[k, 'phase-2-close', c2, 'clock']], anchors: here, stage: 'locked' } });
      out.push({ at: a - 1, act: 'tick', expect: null });
      out.push({ at: a, act: 'tick', expect: { rows: [[k, 'application', a, 'clock']], anchors: nextAnchors, stage: k < ROUNDS ? 'phase-1' : 'finished' } });
    }
  }
  return out;
}

const clock = (at: number, round: number, kind: StepKind, anchors: Expect['anchors'], stage: string, instant = at, cause: StepCause = 'clock'): Action => ({
  at,
  act: 'tick',
  expect: { rows: [[round, kind, instant, cause]], anchors, stage },
});
const manual = (at: number, round: number, kind: StepKind, anchors: Expect['anchors'], stage: string, instant = at): Action => ({
  at,
  act: kind,
  expect: { rows: [[round, kind, instant, 'manual']], anchors, stage },
});
const none = (at: number): Action => ({ at, act: 'tick', expect: null });

const I120 = { i: 120, l1: 30, l2: 10 };

export const SCENARIOS: readonly Scenario[] = [
  // (1) I = 120, L1 = 30, L2 = 10, every step on time.
  // Round 4 is forced: phase 2 lasts 5 s instead of 30 s.
  { name: 'on-time', timing: I120, secret: 'ascending-00-1f', actions: onTime(I120, FORCED_ROUNDS['ascending-00-1f']) },

  // (2) L2 = 0 (I = 60, L1 = 20): C2 = A. Rounds 3 and 4 are forced: phase 2 (and the round) lasts 5 s.
  { name: 'l2-zero', timing: { i: 60, l1: 20, l2: 0 }, secret: 'all-a5', actions: onTime({ i: 60, l1: 20, l2: 0 }, FORCED_ROUNDS['all-a5']) },

  // (3) timing manual: three advances per round at 7 s steps; the instants are the clock readings, no anchors.
  {
    name: 'manual',
    timing: 'manual',
    secret: 'ascending-00-1f',
    actions: Array.from({ length: ROUNDS * 3 }, (_, n): Action => {
      const round = Math.floor(n / 3) + 1;
      const kind = KINDS[n % 3] as StepKind;
      const at = (n + 1) * 7 * S;
      const last = n === ROUNDS * 3 - 1;
      const stage = kind === 'phase-1-close' ? 'phase-2' : kind === 'phase-2-close' ? 'locked' : last ? 'finished' : 'phase-1';
      return manual(at, round, kind, null, stage);
    }),
  },

  // (4) manual closes in the middle of rounds (FR-244): the anchors are shifted from the instant of the manual step.
  {
    name: 'mid-round-advances',
    timing: I120,
    secret: 'all-a5',
    actions: [
      // Round 1 (t0 = 0, C1 = 80 s): phase-1 close by hand at 10 s: C2 = 40 s, A = 50 s (c1 is kept).
      manual(10 * S, 1, 'phase-1-close', [80 * S, 40 * S, 50 * S], 'phase-2'),
      // Phase-2 close by hand at 20 s: A = 30 s. Then the clock applies the round at 30 s: round 2 starts there.
      manual(20 * S, 1, 'phase-2-close', [80 * S, 40 * S, 30 * S], 'locked'),
      none(30 * S - 1),
      clock(30 * S, 1, 'application', [110 * S, 140 * S, 150 * S], 'phase-1'),
      // Round 2 (t0 = 30 s, C1 = 110 s): the clock closes phase 1; by hand phase 2 at 120 s (A = 130 s), the round at 125 s.
      clock(110 * S, 2, 'phase-1-close', [110 * S, 140 * S, 150 * S], 'phase-2'),
      manual(120 * S, 2, 'phase-2-close', [110 * S, 140 * S, 130 * S], 'locked'),
      manual(125 * S, 2, 'application', [205 * S, 235 * S, 245 * S], 'phase-1'),
      // Round 3 (t0 = 125 s, forced): all on the clock: C1 = 205 s; phase 2 lasts 5 s: C2 = 210 s, A = 220 s (008: 235 s, 245 s).
      clock(205 * S, 3, 'phase-1-close', [205 * S, 210 * S, 220 * S], 'phase-2'),
      clock(210 * S, 3, 'phase-2-close', [205 * S, 210 * S, 220 * S], 'locked'),
      clock(220 * S, 3, 'application', [300 * S, 330 * S, 340 * S], 'phase-1'),
      // Round 4 (t0 = 220 s, forced): C1 = 300 s, C2 = 305 s, A = 315 s.
      clock(300 * S, 4, 'phase-1-close', [300 * S, 305 * S, 315 * S], 'phase-2'),
      clock(305 * S, 4, 'phase-2-close', [300 * S, 305 * S, 315 * S], 'locked'),
      clock(315 * S, 4, 'application', null, 'finished'),
    ],
  },

  // (5) downtime across C2 and C1 and forward jumps (FR-248): an overdue step runs once at the effective instant,
  // cause `late`, and shifts the anchors from it; exactly 1000 ms after the schedule is still on time, 1001 ms is late.
  {
    name: 'downtime-forward-jump',
    timing: I120,
    secret: 'ascending-00-1f',
    actions: [
      clock(80 * S, 1, 'phase-1-close', [80 * S, 110 * S, 120 * S], 'phase-2'),
      // The server was down from 80 s to 500 s: C2 (110 s) and A (120 s) are long past. One step only: phase-2 close, late.
      clock(500 * S, 1, 'phase-2-close', [80 * S, 110 * S, 510 * S], 'locked', 500 * S, 'late'),
      none(500 * S),
      clock(510 * S, 1, 'application', [590 * S, 620 * S, 630 * S], 'phase-1'),
      // Round 2 (t0 = 510 s, C1 = 590 s): down until 1210 s: phase-1 close late, C2 = 1240 s, A = 1250 s.
      clock(1210 * S, 2, 'phase-1-close', [590 * S, 1240 * S, 1250 * S], 'phase-2', 1210 * S, 'late'),
      none(1210 * S),
      clock(1240 * S, 2, 'phase-2-close', [590 * S, 1240 * S, 1250 * S], 'locked'),
      clock(1250 * S, 2, 'application', [1330 * S, 1360 * S, 1370 * S], 'phase-1'),
      // Round 3 (t0 = 1250 s, C1 = 1330 s): 1000 ms late is on time (stored at the schedule); C2 + 1001 ms is late.
      clock(1331 * S, 3, 'phase-1-close', [1330 * S, 1360 * S, 1370 * S], 'phase-2', 1330 * S),
      clock(1361 * S + 1, 3, 'phase-2-close', [1330 * S, 1360 * S, 1371 * S + 1], 'locked', 1361 * S + 1, 'late'),
      none(1371 * S),
      clock(1371 * S + 1, 3, 'application', [1451 * S + 1, 1481 * S + 1, 1491 * S + 1], 'phase-1'),
      // Round 4 (t0 = 1371.001 s, forced): on time again; phase 2 lasts 5 s: C2 = 1456.001 s, A = 1466.001 s (008: 1481.001, 1491.001).
      clock(1451 * S + 1, 4, 'phase-1-close', [1451 * S + 1, 1456 * S + 1, 1466 * S + 1], 'phase-2'),
      clock(1456 * S + 1, 4, 'phase-2-close', [1451 * S + 1, 1456 * S + 1, 1466 * S + 1], 'locked'),
      clock(1466 * S + 1, 4, 'application', null, 'finished'),
    ],
  },

  // (6) the clock goes back one hour (FR-249): the effective instant is max(clock, last step instant), nothing is due,
  // and a step by hand takes the last step instant (instants never go down).
  {
    name: 'backward-jump',
    timing: I120,
    secret: 'all-a5',
    actions: [
      clock(80 * S, 1, 'phase-1-close', [80 * S, 110 * S, 120 * S], 'phase-2'),
      none(80 * S - 3_600 * S),
      manual(80 * S - 3_590 * S, 1, 'phase-2-close', [80 * S, 110 * S, 90 * S], 'locked', 80 * S),
      none(80 * S - 3_580 * S),
      none(90 * S - 1),
      clock(90 * S, 1, 'application', [170 * S, 200 * S, 210 * S], 'phase-1'),
      // Round 2 (t0 = 90 s): on time.
      clock(170 * S, 2, 'phase-1-close', [170 * S, 200 * S, 210 * S], 'phase-2'),
      clock(200 * S, 2, 'phase-2-close', [170 * S, 200 * S, 210 * S], 'locked'),
      clock(210 * S, 2, 'application', [290 * S, 320 * S, 330 * S], 'phase-1'),
      // Round 3 (t0 = 210 s, forced): a second backward jump of one hour in phase 2; phase 2 lasts 5 s: C2 = 295 s, A = 305 s.
      clock(290 * S, 3, 'phase-1-close', [290 * S, 295 * S, 305 * S], 'phase-2'),
      none(290 * S - 3_600 * S),
      clock(295 * S, 3, 'phase-2-close', [290 * S, 295 * S, 305 * S], 'locked'),
      clock(305 * S, 3, 'application', [385 * S, 415 * S, 425 * S], 'phase-1'),
      // Round 4 (t0 = 305 s, forced): C1 = 385 s, C2 = 390 s, A = 400 s.
      clock(385 * S, 4, 'phase-1-close', [385 * S, 390 * S, 400 * S], 'phase-2'),
      clock(390 * S, 4, 'phase-2-close', [385 * S, 390 * S, 400 * S], 'locked'),
      clock(400 * S, 4, 'application', null, 'finished'),
    ],
  },
];

/**
 * The event types of one decision, derived by hand from plan 20.4 (never from the code under test): the step kinds it
 * performs and whether the match is over after it. The pure core ends the last decision with the `results` event; the
 * shell then adds `match-finished` (`shellFinish`).
 */
export function handEventTypes(kinds: readonly StepKind[], finished: boolean, shellFinish = false): string[] {
  const end = finished ? (shellFinish ? ['match-finished'] : []) : ['schedule'];
  const key = kinds.join('+');
  if (key === 'phase-1-close') return ['phase-closed', 'victim-revealed', 'results', 'schedule'];
  if (key === 'phase-2-close') return ['phase-closed', 'schedule'];
  if (key === 'application') return ['round-applied', 'results', ...end];
  if (key === 'phase-2-close+application') return ['phase-closed', 'round-applied', 'results', ...end];
  throw new Error(`no hand-derived events for ${key}`);
}

export interface ActionSummary {
  at: number;
  act: string;
  effective: number;
  reported: number;
  rows: [number, string, number, string][];
  events: string[];
  stage: string;
  appliedRounds: number;
  anchors: [number, number, number] | null;
  victim: number | null;
  recordDigest: string | null;
  /** The public view digest after the action: since the creation event (seq 1, FR-289 (c)) the view always has an event. */
  publicDigest: string;
}

/** The match right after creation: the creation event (FR-289 (c)) and the public view digest with lastSeq 1. */
export interface CreationSummary {
  events: string[];
  lastSeq: number;
  publicDigest: string;
}

const sha = (text: string): string => createHash('sha256').update(text, 'ascii').digest('hex');

export interface Run {
  driver: Driver;
  creation: CreationSummary;
  summaries: ActionSummary[];
  /** The outcome of each action (null: nothing was due), parallel to `summaries`. */
  performed: boolean[];
}

/** Runs a scenario through the pure core with the fake clock; also checks nothing itself. */
export function runScenario(s: Scenario): Run {
  const secret = SECRETS[s.secret];
  const driver = coreDriver({ timing: s.timing, start: T0, seedOf: (k) => roundSeed(secret, k) });
  const summaries: ActionSummary[] = [];
  const performed: boolean[] = [];
  const creation: CreationSummary = {
    events: driver.events.map((e) => e.type),
    lastSeq: driver.view.lastSeq,
    publicDigest: sha(encodePublicMatch(publicOf(driver.view, T0, hex(secret)))),
  };
  let sentMax = 0;
  for (const a of s.actions) {
    driver.clock.set(T0 + a.at);
    const effective = effectiveInstant(driver.clock.now(), driver.view.lastStepMs);
    const rowsBefore = driver.steps.length;
    const eventsBefore = driver.events.length;
    const appliedBefore = driver.applied.length;
    const out = a.act === 'tick' ? driver.tick() : driver.run(a.act);
    const reported = reportedTime(effective, sentMax);
    sentMax = reported;
    performed.push(out !== null);
    const view = driver.view;
    const record = driver.applied.length > appliedBefore ? driver.applied[driver.applied.length - 1]!.record : null;
    summaries.push({
      at: a.at,
      act: a.act,
      effective,
      reported,
      rows: driver.steps.slice(rowsBefore).map((r) => [r.round, r.kind, r.instant, r.cause]),
      events: driver.events.slice(eventsBefore).map((e) => e.type),
      stage: view.stage,
      appliedRounds: view.appliedRounds,
      anchors: view.anchors === null ? null : [view.anchors.c1, view.anchors.c2, view.anchors.a],
      victim: view.victim === undefined ? null : view.victim.victim,
      recordDigest: record === null ? null : sha(`${record.round}:${record.eliminated}:${record.absorber}:${record.transferred.join(',')}`),
      publicDigest: sha(encodePublicMatch(publicOf(view, reported, hex(secret)))),
    });
  }
  return { driver, creation, summaries, performed };
}
