import { describe, expect, it } from 'vitest';
import type { Timing } from '@mbrg/protocol';
import { absorptionCandidatesOf, livingFactions, playRoundWithSeed } from '@mbrg/sim';
import type { MatchState } from '@mbrg/sim';
import { decideSubmission, winnerCandidates } from '../src/core/predictions';
import type { StoredPrediction, Submission, SubmissionDecision } from '../src/core/predictions';
import { effectiveInstant } from '../src/core/time';
import { haltMatch } from '../src/core/steps';
import { publicOf } from '../src/core/view';
import { coreDriver } from './helpers/core-driver';
import type { Driver } from './helpers/core-driver';

const CLOCK: Timing = { i: 100, l1: 30, l2: 20 };
const T0 = 1_700_000_000_000;
const C1 = T0 + 50_000;
const C2_ON_TIME = T0 + 80_000;

const stateOf = (d: Driver): MatchState => JSON.parse(JSON.stringify(d.view.state)) as MatchState;
const living = (d: Driver): number[] => {
  const r = livingFactions(d.map, stateOf(d));
  if (!r.ok) throw new Error('living');
  return [...r.value];
};
const submit = (d: Driver, submission: Submission, at: number, stored?: StoredPrediction): SubmissionDecision =>
  decideSubmission(d.view, { submission, effective: at, ...(stored === undefined ? {} : { stored }) });
const accepted = (r: SubmissionDecision) => {
  if (!r.ok) throw new Error(`rejected: ${JSON.stringify(r.error)}`);
  return r;
};
/** Performs the next `n` manual steps (manual timing: three per round). */
const steps = (d: Driver, n: number): void => {
  const order = ['phase-1-close', 'phase-2-close', 'application'] as const;
  for (let i = 0; i < n; i++) {
    const kind = d.view.stage === 'phase-1' ? order[0] : d.view.stage === 'phase-2' ? order[1] : order[2];
    d.clock.advance(1);
    d.run(kind);
  }
};

describe('prediction kinds and stages (FR-261)', () => {
  it('FR-261 a victim prediction is accepted in phase-1 for the pending round with version 1', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    const choice = living(d)[0]!;
    const r = accepted(submit(d, { kind: 'victim', round: 1, choice }, T0 + 1_000));
    expect(r.change).toBe('created');
    expect(r.reply).toStrictEqual({ kind: 'victim', round: 1, choice, version: 1 });
    expect(r.store).toStrictEqual({ kind: 'victim', round: 1, choice, version: 1, storedMs: T0 + 1_000 });
  });

  it('FR-261 an absorber prediction is accepted only in phase-2, for a candidate of the revealed victim', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    const early = submit(d, { kind: 'absorber', round: 1, choice: 1 }, T0 + 1_000);
    expect(early).toStrictEqual({ ok: false, error: { kind: 'prediction-closed' } });
    d.clock.advance(1_000);
    d.run('phase-1-close');
    expect(d.view.stage).toBe('phase-2');
    const choice = d.view.victim!.candidates[0]!;
    const r = accepted(submit(d, { kind: 'absorber', round: 1, choice }, d.clock.now()));
    expect(r.reply).toStrictEqual({ kind: 'absorber', round: 1, choice, version: 1 });
    d.run('phase-2-close');
    expect(d.view.stage).toBe('locked');
    expect(submit(d, { kind: 'absorber', round: 1, choice }, d.clock.now() + 1)).toStrictEqual({ ok: false, error: { kind: 'prediction-closed' } });
  });

  it('FR-261 a victim prediction is closed in phase-2 and locked', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    const choice = living(d)[0]!;
    steps(d, 1);
    expect(submit(d, { kind: 'victim', round: 1, choice }, d.clock.now())).toStrictEqual({ ok: false, error: { kind: 'prediction-closed' } });
    steps(d, 1);
    expect(d.view.stage).toBe('locked');
    expect(submit(d, { kind: 'victim', round: 1, choice }, d.clock.now())).toStrictEqual({ ok: false, error: { kind: 'prediction-closed' } });
  });

  it('FR-261 FR-266 a winner prediction stays open until the phase-1 close of round T and then closes', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    expect(d.view.totalRounds).toBe(4);
    steps(d, 9); // rounds 1 to 3 applied
    expect(d.view.appliedRounds).toBe(3);
    expect(d.view.stage).toBe('phase-1');
    const choice = winnerCandidates(d.view)[0]!;
    accepted(submit(d, { kind: 'winner', choice }, d.clock.now()));
    steps(d, 1);
    expect(d.view.stage).toBe('phase-2');
    expect(submit(d, { kind: 'winner', choice }, d.clock.now())).toStrictEqual({ ok: false, error: { kind: 'prediction-closed' } });
    steps(d, 1);
    expect(submit(d, { kind: 'winner', choice }, d.clock.now())).toStrictEqual({ ok: false, error: { kind: 'prediction-closed' } });
  });
});

describe('cutoffs are exclusive and the stage decides (FR-266)', () => {
  it('FR-266 a victim prediction at the cutoff instant is prediction-closed and one millisecond before is accepted', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    const choice = living(d)[0]!;
    accepted(submit(d, { kind: 'victim', round: 1, choice }, C1 - 1));
    expect(submit(d, { kind: 'victim', round: 1, choice }, C1)).toStrictEqual({ ok: false, error: { kind: 'prediction-closed' } });
    expect(submit(d, { kind: 'victim', round: 1, choice }, C1 + 7_000)).toStrictEqual({ ok: false, error: { kind: 'prediction-closed' } });
  });

  it('FR-266 an absorber prediction at the phase-2 cutoff is prediction-closed and one millisecond before is accepted', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    d.clock.set(C1);
    d.take(d.tick()!); // on time: C2 stays at t0 + 80 s
    expect(d.view.stage).toBe('phase-2');
    expect(d.view.anchors!.c2).toBe(C2_ON_TIME);
    const choice = d.view.victim!.candidates[0]!;
    accepted(submit(d, { kind: 'absorber', round: 1, choice }, C2_ON_TIME - 1));
    expect(submit(d, { kind: 'absorber', round: 1, choice }, C2_ON_TIME)).toStrictEqual({ ok: false, error: { kind: 'prediction-closed' } });
  });

  it('FR-266 the winner prediction of round T is closed at the phase-1 cutoff of round T and open one millisecond before', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    // Fast-forward by manual-like late steps is not needed: build round T with the manual driver, then compare cutoffs.
    const m = coreDriver({ timing: CLOCK, start: T0 });
    for (let i = 0; i < 9; i++) {
      const kind = m.view.stage === 'phase-1' ? 'phase-1-close' : m.view.stage === 'phase-2' ? 'phase-2-close' : 'application';
      m.clock.advance(1);
      m.run(kind);
    }
    expect(m.view.appliedRounds).toBe(3);
    const c1 = m.view.anchors!.c1;
    const choice = winnerCandidates(m.view)[0]!;
    accepted(submit(m, { kind: 'winner', choice }, c1 - 1));
    expect(submit(m, { kind: 'winner', choice }, c1)).toStrictEqual({ ok: false, error: { kind: 'prediction-closed' } });
    // Before round T the winner has no cutoff of its own, even after C1 of that round.
    const earlyChoice = winnerCandidates(d.view)[0]!;
    accepted(submit(d, { kind: 'winner', choice: earlyChoice }, C1 + 1_000));
  });

  it('FR-266 a per-round prediction naming a round other than the pending one is prediction-closed', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    const choice = living(d)[0]!;
    for (const round of [0, 2, 5, -1, 1.5]) {
      expect(submit(d, { kind: 'victim', round, choice }, T0 + 1_000), `round ${round}`).toStrictEqual({ ok: false, error: { kind: 'prediction-closed' } });
    }
  });

  it('FR-266 a finished match answers match-finished and a halted match match-halted, before any closed cutoff', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    steps(d, 12);
    expect(d.view.stage).toBe('finished');
    const winner = d.view.winner!;
    expect(submit(d, { kind: 'winner', choice: winner }, d.clock.now())).toStrictEqual({ ok: false, error: { kind: 'match-finished' } });
    expect(submit(d, { kind: 'victim', round: 99, choice: 1 }, d.clock.now())).toStrictEqual({ ok: false, error: { kind: 'match-finished' } });
    const h = coreDriver({ timing: CLOCK, start: T0 });
    const halted = { ...h.view, ...haltMatch(h.view, 'map-changed', T0).view };
    expect(decideSubmission(halted, { submission: { kind: 'victim', round: 7, choice: 0 }, effective: C1 + 1 })).toStrictEqual({ ok: false, error: { kind: 'match-halted' } });
  });

  it('FR-266 FR-301 (order) prediction-closed comes before invalid-choice', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    expect(submit(d, { kind: 'victim', round: 1, choice: 987_654 }, C1)).toStrictEqual({ ok: false, error: { kind: 'prediction-closed' } });
    expect(submit(d, { kind: 'victim', round: 1, choice: 987_654 }, C1 - 1)).toStrictEqual({ ok: false, error: { kind: 'invalid-choice' } });
  });

  it('FR-266 a manual-timing match has no time cutoff: only the stage closes a submission', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    const choice = living(d)[0]!;
    accepted(submit(d, { kind: 'victim', round: 1, choice }, T0 + 10 * 24 * 3_600_000));
  });
});

describe('choices are checked against public data (FR-262, FR-263, FR-264, FR-265)', () => {
  it('FR-262 a victim prediction must name a faction living at N', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    const alive = living(d);
    for (const bad of [0, -1, 1.5, 987_654, Number.NaN]) {
      expect(submit(d, { kind: 'victim', round: 1, choice: bad }, T0), `choice ${bad}`).toStrictEqual({ ok: false, error: { kind: 'invalid-choice' } });
    }
    const victim = d.take(d.run('phase-1-close')).view.victim!.victim;
    steps(d, 2); // phase 2 close and application
    expect(living(d)).not.toContain(victim);
    expect(alive).toContain(victim);
    expect(submit(d, { kind: 'victim', round: 2, choice: victim }, d.clock.now())).toStrictEqual({ ok: false, error: { kind: 'invalid-choice' } });
    accepted(submit(d, { kind: 'victim', round: 2, choice: living(d)[0]! }, d.clock.now()));
  });

  it('FR-263 an absorber prediction must name an absorption candidate of the revealed victim as the engine computes it', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    const state = stateOf(d);
    d.run('phase-1-close');
    const victim = d.view.victim!.victim;
    const r = absorptionCandidatesOf(d.map, state, victim);
    if (!r.ok) throw new Error('candidates');
    const candidates = [...r.value];
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) accepted(submit(d, { kind: 'absorber', round: 1, choice: c }, d.clock.now()));
    const others = living(d).filter((f) => !candidates.includes(f));
    expect(others).toContain(victim);
    for (const bad of others) {
      expect(submit(d, { kind: 'absorber', round: 1, choice: bad }, d.clock.now()), `choice ${bad}`).toStrictEqual({ ok: false, error: { kind: 'invalid-choice' } });
    }
    expect(submit(d, { kind: 'absorber', round: 1, choice: 987_654 }, d.clock.now())).toStrictEqual({ ok: false, error: { kind: 'invalid-choice' } });
  });

  it('FR-264 a winner prediction must name a winner candidate: the revealed victim is excluded in phase-2', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    const before = living(d);
    expect(winnerCandidates(d.view)).toStrictEqual(before);
    for (const f of before) accepted(submit(d, { kind: 'winner', choice: f }, d.clock.now()));
    d.run('phase-1-close');
    const victim = d.view.victim!.victim;
    expect(submit(d, { kind: 'winner', choice: victim }, d.clock.now())).toStrictEqual({ ok: false, error: { kind: 'invalid-choice' } });
    expect(winnerCandidates(d.view)).toStrictEqual(before.filter((f) => f !== victim));
    for (const f of before.filter((x) => x !== victim)) accepted(submit(d, { kind: 'winner', choice: f }, d.clock.now()));
    expect(submit(d, { kind: 'winner', choice: 987_654 }, d.clock.now())).toStrictEqual({ ok: false, error: { kind: 'invalid-choice' } });
  });

  it('FR-264 an eliminated faction is not a winner candidate after its round is applied', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    d.run('phase-1-close');
    const victim = d.view.victim!.victim;
    steps(d, 2);
    expect(submit(d, { kind: 'winner', choice: victim }, d.clock.now())).toStrictEqual({ ok: false, error: { kind: 'invalid-choice' } });
  });

  it('FR-265 twin matches with the same public data and different futures get equal validation and replies', () => {
    // Different seeds, therefore different victims, before the phase-1 close.
    const a = coreDriver({ timing: CLOCK, start: T0, seedOf: () => 1 });
    const b = coreDriver({ timing: CLOCK, start: T0, seedOf: () => 2 });
    const eliminatedOf = (seed: number): number => {
      const p = playRoundWithSeed(a.map, stateOf(a), seed);
      if (!p.ok) throw new Error('play');
      return p.value.record.eliminated;
    };
    const victimOf = (seed: number): number => eliminatedOf(seed);
    let seedB = 2;
    while (victimOf(seedB) === victimOf(1)) seedB++;
    const c = coreDriver({ timing: CLOCK, start: T0, seedOf: () => seedB });
    expect(publicOf(a.view, 0)).toStrictEqual(publicOf(c.view, 0));
    expect(b.view).toStrictEqual(a.view);
    const probes: Submission[] = [
      { kind: 'victim', round: 1, choice: living(a)[0]! },
      { kind: 'victim', round: 1, choice: living(a)[1]! },
      { kind: 'victim', round: 1, choice: 987_654 },
      { kind: 'absorber', round: 1, choice: 1 },
      { kind: 'winner', choice: living(a)[0]! },
    ];
    for (const probe of probes) for (const at of [T0 + 1, C1 - 1, C1]) expect(submit(c, probe, at)).toStrictEqual(submit(a, probe, at));
  });

  it('FR-265 twin matches with the same victim and different absorbers get equal validation and replies in phase-2', () => {
    const base = coreDriver({ timing: CLOCK, start: T0 });
    const outcomeOf = (seed: number) => {
      const p = playRoundWithSeed(base.map, stateOf(base), seed);
      if (!p.ok) throw new Error('play');
      return p.value.record;
    };
    const seen = new Map<number, { seed: number; absorber: number }>();
    let pair: [number, number] | undefined;
    for (let seed = 1; seed < 5_000 && pair === undefined; seed++) {
      const rec = outcomeOf(seed);
      const prior = seen.get(rec.eliminated);
      if (prior === undefined) seen.set(rec.eliminated, { seed, absorber: rec.absorber });
      else if (prior.absorber !== rec.absorber) pair = [prior.seed, seed];
    }
    if (pair === undefined) throw new Error('no twin seeds');
    const [seedX, seed] = pair;
    const x = coreDriver({ timing: CLOCK, start: T0, seedOf: () => seedX });
    const y = coreDriver({ timing: CLOCK, start: T0, seedOf: () => seed });
    for (const d of [x, y]) {
      d.clock.set(C1);
      d.take(d.tick()!);
    }
    expect(x.view).toStrictEqual(y.view);
    for (const f of living(x)) {
      const probe: Submission = { kind: 'absorber', round: 1, choice: f };
      expect(submit(y, probe, C1 + 1_000)).toStrictEqual(submit(x, probe, C1 + 1_000));
    }
  });
});

describe('replacement and versions (FR-267)', () => {
  const key = (d: Driver) => ({ kind: 'victim' as const, round: 1, choice: living(d)[0]! });

  it('FR-267 a different valid choice replaces the stored one and increases the version by one', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    const [f0, f1, f2] = living(d) as [number, number, number];
    const first = accepted(submit(d, { kind: 'victim', round: 1, choice: f0 }, T0 + 1_000));
    const second = accepted(submit(d, { kind: 'victim', round: 1, choice: f1 }, T0 + 2_000, first.store));
    expect(second.change).toBe('replaced');
    expect(second.reply).toStrictEqual({ kind: 'victim', round: 1, choice: f1, version: 2 });
    expect(second.store).toStrictEqual({ kind: 'victim', round: 1, choice: f1, version: 2, storedMs: T0 + 2_000 });
    const third = accepted(submit(d, { kind: 'victim', round: 1, choice: f2 }, T0 + 3_000, second.store));
    expect(third.reply.version).toBe(3);
  });

  it('FR-267 the same choice again changes nothing, stores no row and keeps the version', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    const first = accepted(submit(d, key(d), T0 + 1_000));
    const [, f1] = living(d) as [number, number];
    const second = accepted(submit(d, { kind: 'victim', round: 1, choice: f1 }, T0 + 2_000, first.store));
    const again = accepted(submit(d, { kind: 'victim', round: 1, choice: f1 }, T0 + 3_000, second.store));
    expect(again.change).toBe('unchanged');
    expect(again.store).toBeUndefined();
    expect(again.reply).toStrictEqual({ kind: 'victim', round: 1, choice: f1, version: 2 });
  });

  it('FR-267 a delayed older resubmission without a request id overwrites a newer one (P37, documented)', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    const [f0, f1] = living(d) as [number, number];
    const v1 = accepted(submit(d, { kind: 'victim', round: 1, choice: f0 }, T0 + 1_000));
    const v2 = accepted(submit(d, { kind: 'victim', round: 1, choice: f1 }, T0 + 2_000, v1.store));
    // The older choice f0 arrives last: no expected-version check, so it wins and the version still grows.
    const late = accepted(submit(d, { kind: 'victim', round: 1, choice: f0 }, T0 + 3_000, v2.store));
    expect(late.reply).toStrictEqual({ kind: 'victim', round: 1, choice: f0, version: 3 });
  });

  it('FR-267 a replacement after the cutoff is prediction-closed and the stored prediction stays', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    const [f0, f1] = living(d) as [number, number];
    const v1 = accepted(submit(d, { kind: 'victim', round: 1, choice: f0 }, C1 - 1));
    expect(submit(d, { kind: 'victim', round: 1, choice: f1 }, C1, v1.store)).toStrictEqual({ ok: false, error: { kind: 'prediction-closed' } });
  });

  it('FR-267 a winner change stores the number of winner candidates at that instant, an equal one keeps it', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    const alive = living(d);
    const n0 = alive.length;
    const first = accepted(submit(d, { kind: 'winner', choice: alive[0]! }, T0 + 1));
    expect(first.store).toStrictEqual({ kind: 'winner', round: 0, choice: alive[0], version: 1, storedMs: T0 + 1, winnerCandidates: n0 });
    expect(first.reply).toStrictEqual({ kind: 'winner', choice: alive[0], version: 1 });
    const same = accepted(submit(d, { kind: 'winner', choice: alive[0]! }, T0 + 2, first.store));
    expect(same.change).toBe('unchanged');
    expect(same.store).toBeUndefined();
    d.run('phase-1-close'); // the victim leaves the candidates
    const victim = d.view.victim!.victim;
    const other = winnerCandidates(d.view).find((f) => f !== alive[0])!;
    const changed = accepted(submit(d, { kind: 'winner', choice: other }, T0 + 3, first.store));
    expect(changed.store!.winnerCandidates).toBe(n0 - 1);
    expect(changed.store!.version).toBe(2);
    expect(victim).toBeGreaterThan(0);
  });

  it('FR-267 a stored prediction of another key is rejected as inconsistent data', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    const stored: StoredPrediction = { kind: 'victim', round: 2, choice: 1, version: 1, storedMs: T0 };
    expect(() => submit(d, key(d), T0 + 1, stored)).toThrow(RangeError);
  });
});

describe('kinds are independent and a missed cutoff costs nothing (FR-268)', () => {
  it('FR-268 a player may predict both phases and the winner, each with its own version', () => {
    const d = coreDriver({ timing: 'manual', start: T0 });
    const alive = living(d);
    const winner = accepted(submit(d, { kind: 'winner', choice: alive[0]! }, T0));
    const victim = accepted(submit(d, { kind: 'victim', round: 1, choice: alive[1]! }, T0));
    expect(winner.reply.version).toBe(1);
    expect(victim.reply.version).toBe(1);
    d.run('phase-1-close');
    const absorber = accepted(submit(d, { kind: 'absorber', round: 1, choice: d.view.victim!.candidates[0]! }, d.clock.now()));
    expect(absorber.reply.version).toBe(1);
  });

  it('FR-268 a player who predicts only one phase, or none, is not blocked or penalised: a late submission is only closed', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    const closedOne = submit(d, { kind: 'victim', round: 1, choice: living(d)[0]! }, C1 + 5);
    expect(closedOne).toStrictEqual({ ok: false, error: { kind: 'prediction-closed' } });
    expect(Object.keys(closedOne).sort()).toStrictEqual(['error', 'ok']);
    d.clock.set(C1 + 5);
    d.take(d.tick()!);
    accepted(submit(d, { kind: 'absorber', round: 1, choice: d.view.victim!.candidates[0]! }, C1 + 6));
  });
});

describe('predictions count only before the cutoff and the closing step (FR-295 (a), FR-248)', () => {
  it('FR-295 (a) a prediction counts if and only if it was stored before the cutoff and before the closing step began', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    const choice = living(d)[0]!;
    d.clock.advance(10_000);
    const t = d.clock.now();
    accepted(submit(d, { kind: 'victim', round: 1, choice }, t)); // before the cutoff and before the step
    d.run('phase-1-close'); // a manual close at t, well before C1
    expect(t).toBeLessThan(C1);
    // Stored after the closing step began: closed, although the old cutoff has not passed.
    expect(submit(d, { kind: 'victim', round: 1, choice }, effectiveInstant(d.clock.now(), d.view.lastStepMs) + 1)).toStrictEqual({ ok: false, error: { kind: 'prediction-closed' } });
  });

  it('FR-248 only predictions stored before its cutoff count: an overdue close does not reopen the phase', () => {
    const d = coreDriver({ timing: CLOCK, start: T0 });
    const choice = living(d)[0]!;
    // The server was down across C1: at the start instant the close is overdue but not yet performed.
    const late = C1 + 3_600_000;
    expect(submit(d, { kind: 'victim', round: 1, choice }, late)).toStrictEqual({ ok: false, error: { kind: 'prediction-closed' } });
    accepted(submit(d, { kind: 'victim', round: 1, choice }, C1 - 1));
    d.clock.set(late);
    d.take(d.tick()!);
    expect(d.steps[0]).toMatchObject({ kind: 'phase-1-close', cause: 'late', instant: late });
    // Phase 2 gets its full L1 from the late instant: an absorber prediction is open until then.
    const cand = d.view.victim!.candidates[0]!;
    accepted(submit(d, { kind: 'absorber', round: 1, choice: cand }, late + 29_999));
    expect(submit(d, { kind: 'absorber', round: 1, choice: cand }, late + 30_000)).toStrictEqual({ ok: false, error: { kind: 'prediction-closed' } });
  });
});
