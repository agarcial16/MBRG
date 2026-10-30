import { describe, expect, it } from 'vitest';
import { errorReply, stepMismatch } from '@mbrg/protocol';
import type { Stage, Timing } from '@mbrg/protocol';
import { decideAdvance } from '../src/core/advance';
import { createLobby, lobbyEvents } from '../src/core/create';
import { expireDecision, startDecision } from '../src/core/lobby';
import { decideSubmission } from '../src/core/predictions';
import { nextStep } from '../src/core/steps';
import type { StepDeps } from '../src/core/steps';
import type { CoreMatch } from '../src/core/view';
import { sha256 } from './helpers/core-driver';
import { devMap } from './helpers/digests';

// The pure lobby rules: start (stage phase-1, clock anchored at the start instant), expiry, and the refusals of the other
// decisions while the match is a lobby or expired. Time is a parameter everywhere; nothing here reads a clock.

const T0 = 1_700_000_000_000;
const CLOCK: Timing = { i: 97, l1: 31, l2: 13 };

function lobbyOf(timing: Timing): CoreMatch {
  const r = createLobby({ matchId: 'm', mapId: 'dev', mapDigest: 'd'.repeat(64), timing, commitment: 'c'.repeat(64), now: T0 }, { map: devMap(), sha256 });
  if (!r.ok) throw new Error('lobby creation failed');
  return lobbyEvents(r.view, T0).view;
}

const OTHER_STAGES: Stage[] = ['phase-1', 'phase-2', 'locked', 'finished', 'halted'];

describe('start decision', () => {
  it('a lobby with a clock starts in phase 1 with the anchors taken from the start instant, not from the creation instant', () => {
    const now = T0 + 7_654_321;
    const d = startDecision(lobbyOf(CLOCK), now, now + 3);
    if (!d.ok) throw new Error('start refused');
    expect(d.view.stage).toBe('phase-1');
    expect(d.view.lastStepMs).toBe(now);
    expect(d.view.anchors).toStrictEqual({ t0: now, c1: now + 53_000, c2: now + 84_000, a: now + 97_000 });
    expect(d.view.lastSeq).toBe(2);
    expect(d.events).toStrictEqual([
      { type: 'schedule', seq: 2, stage: 'phase-1', schedule: { c1: now + 53_000, c2: now + 84_000, a: now + 97_000 }, reportedTime: now + 3 },
    ]);
    expect(Object.keys(d.events[0]!)).toStrictEqual(['type', 'seq', 'stage', 'schedule', 'reportedTime']);
  });

  it('the start instant is floored to whole milliseconds', () => {
    const d = startDecision(lobbyOf(CLOCK), T0 + 5_000.75, T0 + 5_001);
    if (!d.ok) throw new Error('start refused');
    expect(d.view.lastStepMs).toBe(T0 + 5_000);
    expect(d.view.anchors?.t0).toBe(T0 + 5_000);
  });

  it('a manual match starts in phase 1 with no anchors and a schedule event without anchors', () => {
    const now = T0 + 12_345;
    const d = startDecision(lobbyOf('manual'), now, now);
    if (!d.ok) throw new Error('start refused');
    expect(d.view.stage).toBe('phase-1');
    expect(d.view.anchors).toBeNull();
    expect(d.view.lastStepMs).toBe(now);
    expect(d.events).toStrictEqual([{ type: 'schedule', seq: 2, stage: 'phase-1', reportedTime: now }]);
    expect(Object.keys(d.events[0]!)).toStrictEqual(['type', 'seq', 'stage', 'reportedTime']);
  });

  it('a clock reading below the last step instant starts at the last step instant (a backward clock never lowers it)', () => {
    const d = startDecision(lobbyOf(CLOCK), T0 - 9_000, T0);
    if (!d.ok) throw new Error('start refused');
    expect(d.view.lastStepMs).toBe(T0);
    expect(d.view.anchors?.t0).toBe(T0);
  });

  it('only the stage, the clock data and the sequence change; the round state, the commitment and the rest stay', () => {
    const before = lobbyOf(CLOCK);
    const snapshot = JSON.stringify(before);
    const d = startDecision(before, T0 + 1_000, T0 + 1_000);
    if (!d.ok) throw new Error('start refused');
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(d.view).toStrictEqual({ ...before, stage: 'phase-1', lastStepMs: T0 + 1_000, anchors: d.view.anchors, lastSeq: before.lastSeq + 1 });
    expect(d.view.appliedRounds).toBe(0);
    expect(d.view.victim).toBeUndefined();
  });

  it.each(OTHER_STAGES)('a match in stage %s refuses a start with match-started', (stage) => {
    const d = startDecision({ ...lobbyOf(CLOCK), stage }, T0 + 1, T0 + 1);
    expect(d).toStrictEqual({ ok: false, error: errorReply('match-started') });
  });

  it('an expired lobby refuses a start with match-expired', () => {
    const d = startDecision({ ...lobbyOf(CLOCK), stage: 'expired' }, T0 + 1, T0 + 1);
    expect(d).toStrictEqual({ ok: false, error: errorReply('match-expired') });
  });
});

describe('expiry decision', () => {
  it('a lobby becomes expired with a schedule event of stage expired, no anchors, the next sequence number and the reported time', () => {
    const before = lobbyOf(CLOCK);
    const d = expireDecision(before, T0 + 86_400_007);
    if (!d.ok) throw new Error('expiry refused');
    expect(d.view).toStrictEqual({ ...before, stage: 'expired', lastSeq: before.lastSeq + 1 });
    expect(d.events).toStrictEqual([{ type: 'schedule', seq: 2, stage: 'expired', reportedTime: T0 + 86_400_007 }]);
    expect(Object.keys(d.events[0]!)).toStrictEqual(['type', 'seq', 'stage', 'reportedTime']);
  });

  it.each(OTHER_STAGES)('a match in stage %s is never expired (match-started)', (stage) => {
    expect(expireDecision({ ...lobbyOf(CLOCK), stage }, T0 + 1)).toStrictEqual({ ok: false, error: errorReply('match-started') });
  });

  it('an expired lobby is not expired twice (match-expired)', () => {
    expect(expireDecision({ ...lobbyOf(CLOCK), stage: 'expired' }, T0 + 1)).toStrictEqual({ ok: false, error: errorReply('match-expired') });
  });
});

describe('other decisions in a lobby', () => {
  it('a lobby and an expired lobby have no next step', () => {
    expect(nextStep(lobbyOf(CLOCK))).toBeNull();
    expect(nextStep({ ...lobbyOf(CLOCK), stage: 'expired' })).toBeNull();
    expect(nextStep({ ...lobbyOf(CLOCK), stage: 'phase-1' })).toBe('phase-1-close');
  });

  const noDeps = {} as StepDeps;
  it('an advance in a lobby is a step mismatch naming stage lobby and 0 applied rounds', () => {
    const d = decideAdvance(lobbyOf(CLOCK), { round: 1, step: 'phase-1-close', effective: T0, reportedTime: T0 }, noDeps);
    expect(d).toStrictEqual({ ok: false, error: stepMismatch('lobby', 0) });
  });

  it('an advance in an expired lobby is a step mismatch naming stage expired', () => {
    const d = decideAdvance({ ...lobbyOf(CLOCK), stage: 'expired' }, { round: 1, step: 'phase-1-close', effective: T0, reportedTime: T0 }, noDeps);
    expect(d).toStrictEqual({ ok: false, error: stepMismatch('expired', 0) });
  });

  it.each(['lobby', 'expired'] as const)('a prediction of any kind in stage %s is closed, even a winner prediction that is open in a running match', (stage) => {
    const view = { ...lobbyOf(CLOCK), stage };
    const first = view.state.owners[0]![1];
    for (const submission of [
      { kind: 'winner', choice: first },
      { kind: 'victim', round: 1, choice: first },
      { kind: 'absorber', round: 1, choice: first },
    ] as const) {
      expect(decideSubmission(view, { submission, effective: T0 }), submission.kind).toStrictEqual({ ok: false, error: errorReply('prediction-closed') });
    }
  });

  it('a winner prediction in a running match with the same map is open (the guard is the stage)', () => {
    const view = { ...lobbyOf(CLOCK), stage: 'phase-1' as const };
    const first = view.state.owners[0]![1];
    expect(decideSubmission(view, { submission: { kind: 'winner', choice: first }, effective: T0 }).ok).toBe(true);
  });
});
