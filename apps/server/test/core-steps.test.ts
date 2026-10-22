import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stateText } from '@mbrg/protocol';
import type { MatchEvent, Timing } from '@mbrg/protocol';
import { absorptionCandidatesOf, getState, livingFactions, playRoundWithSeed } from '@mbrg/sim';
import type { MatchState } from '@mbrg/sim';
import { mapFrom, pairMap } from '../../../packages/sim/test/helpers/maps';
import { createMatch } from '../src/core/create';
import { haltReasonOf, nextStep, performStep } from '../src/core/steps';
import { CORE_MATCH_KEYS, publicOf } from '../src/core/view';
import { seedOfSecret } from '../src/seeds';
import { roundSeed } from '../src/secret';
import { SECRET_00_1F, coreDriver, sha256 } from './helpers/core-driver';
import { devMap } from './helpers/digests';

const MAP = devMap();
const T0 = 1_700_000_000_000;
const CLOCK: Timing = { i: 100, l1: 30, l2: 20 };

function ok<T>(r: { ok: true; value: T } | { ok: false; errors: unknown[] }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
}
const state0 = (): MatchState => ok(getState(MAP, 0, 0));
/** The engine's whole answer for round 1 of the dev map (test-side only: the core drops all but the victim). */
const engineRound1 = (seed: number) => ok(playRoundWithSeed(MAP, state0(), seed));
const constantSeed = (seed: number) => () => seed;

/** Every key name of a JSON value, at any depth. */
function keysOf(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, into));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.push(k);
      keysOf(v, into);
    }
  }
  return into;
}
const FORBIDDEN_KEY = /absorb|pending|seed|secret|transferred|record/i;

/** Finds two seeds with the same round-1 victim and different absorbers (so the public data are equal). */
function sameVictimDifferentAbsorber(): [number, number] {
  const byVictim = new Map<number, { seed: number; absorber: number }>();
  for (let seed = 1; seed < 5000; seed++) {
    const r = engineRound1(seed).record;
    const first = byVictim.get(r.eliminated);
    if (first === undefined) byVictim.set(r.eliminated, { seed, absorber: r.absorber });
    else if (first.absorber !== r.absorber) return [first.seed, seed];
  }
  throw new Error('no seed pair found');
}
/** Two seeds with different round-1 victims. */
function differentVictims(): [number, number] {
  const a = engineRound1(1).record.eliminated;
  for (let seed = 2; seed < 5000; seed++) if (engineRound1(seed).record.eliminated !== a) return [1, seed];
  throw new Error('no seed pair found');
}

describe('creation check', () => {
  const deps = { map: MAP, sha256 };
  const input = { matchId: 'm', mapId: 'dev', mapDigest: 'd'.repeat(64), timing: CLOCK, commitment: 'c'.repeat(64), now: T0 };

  it('FR-237 the dev map is accepted with T = 4, round 0, stage phase-1 and anchors from the creation instant', () => {
    const r = createMatch(input, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.totalRounds).toBe(4);
    expect(r.view.stage).toBe('phase-1');
    expect(r.view.appliedRounds).toBe(0);
    expect(r.view.state).toStrictEqual(state0());
    expect(r.view.stateDigest).toBe(sha256(stateText(state0())));
    expect(r.view.anchors).toStrictEqual({ t0: T0, c1: T0 + 50_000, c2: T0 + 80_000, a: T0 + 100_000 });
    expect(r.view.createdAt).toBe(T0);
    expect(r.view.lastStepMs).toBe(T0);
    expect(r.view.lastSeq).toBe(0);
    expect(Object.keys(r.view).sort()).toStrictEqual(Object.keys(r.view).filter((k) => (CORE_MATCH_KEYS as readonly string[]).includes(k)).sort());
  });

  it('FR-237 a map with fewer than 2 factions is rejected with too-few-factions and no match', () => {
    const one = mapFrom([7, 7], [[1, 2]]);
    const r = createMatch(input, { map: one, sha256 });
    expect(r).toStrictEqual({ ok: false, errors: [{ kind: 'too-few-factions', count: 1 }] });
  });

  it('FR-237 a map that does not validate is rejected with its validation errors, never a match', () => {
    const r = createMatch(input, { map: null, sha256 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
  });

  it('FR-237 timing manual has no anchors', () => {
    const r = createMatch({ ...input, timing: 'manual' }, deps);
    expect(r.ok && r.view.anchors).toBeNull();
  });

  it('FR-237 a two-faction map gives T = 1 and the single round runs to a finished match with the survivor as winner', () => {
    const d = coreDriver({ map: pairMap(), timing: 'manual' });
    expect(d.view.totalRounds).toBe(1);
    d.run('phase-1-close');
    expect(d.view.stage).toBe('phase-2');
    const victim = d.view.victim!.victim;
    d.run('phase-2-close');
    d.run('application');
    expect(d.view.stage).toBe('finished');
    expect(d.view.appliedRounds).toBe(1);
    expect(d.view.winner).toBe(victim === 10 ? 20 : 10);
    expect(d.view.anchors).toBeNull();
    // Event 1 is the creation event (FR-289 (c)); no later event announces a next round.
    expect(d.events.slice(1).some((e) => e.type === 'schedule' && e.stage === 'phase-1')).toBe(false);
  });
});

describe('phase-1 close', () => {
  it('FR-255 the phase-1 close calls seedOf(k) exactly once and returns the victim, reveal instant, candidates and living factions', () => {
    const d = coreDriver({ timing: CLOCK });
    d.clock.set(T0 + 50_000);
    expect(d.seedCalls).toStrictEqual([]);
    const out = d.tick()!;
    expect(d.seedCalls).toStrictEqual([1]);
    const expected = engineRound1(roundSeed(SECRET_00_1F, 1)).record;
    const v = out.view.victim!;
    expect(v.victim).toBe(expected.eliminated);
    expect(v.round).toBe(1);
    expect(v.revealedAt).toBe(T0 + 50_000);
    expect(v.candidates).toStrictEqual(ok(absorptionCandidatesOf(MAP, state0(), expected.eliminated)));
    expect(v.living).toStrictEqual(ok(livingFactions(MAP, state0())));
    expect(v.living).toContain(v.victim);
    expect(out.view.stage).toBe('phase-2');
    expect(out.steps).toStrictEqual([{ round: 1, kind: 'phase-1-close', instant: T0 + 50_000, cause: 'clock' }]);
    expect(out.applied).toBeUndefined();
  });

  it('FR-255 FR-256 the phase-1 close returns no absorber and no pending state anywhere in its JSON (key and value scan)', () => {
    const seed = roundSeed(SECRET_00_1F, 1);
    const engine = engineRound1(seed);
    const d = coreDriver({ timing: CLOCK });
    d.clock.set(T0 + 50_000);
    const out = d.tick()!;
    const json = JSON.stringify(out);
    expect(keysOf(out).filter((k) => FORBIDDEN_KEY.test(k))).toStrictEqual([]);
    expect(Object.keys(out.view).filter((k) => !(CORE_MATCH_KEYS as readonly string[]).includes(k))).toStrictEqual([]);
    // The state of the view is the state at N = 0, never the state after the pending round.
    expect(out.view.state).toStrictEqual(state0());
    expect(out.view.stateDigest).not.toBe(sha256(stateText(engine.state)));
    expect(json).not.toContain(sha256(stateText(engine.state)));
    expect(json).not.toContain(String(seed));
    expect(json).not.toContain(seed.toString(16).padStart(8, '0'));
    for (const t of engine.record.transferred) expect(out.view.state.owners.find(([id]) => id === t)![1]).toBe(state0().owners.find(([id]) => id === t)![1]);
    // What a client sees (public view and events) is just as clean.
    const pub = JSON.stringify([publicOf(out.view, T0 + 50_000), out.events]);
    expect(pub).not.toContain(sha256(stateText(engine.state)));
    expect(keysOf([publicOf(out.view, 0), out.events]).filter((k) => FORBIDDEN_KEY.test(k))).toStrictEqual([]);
  });

  it('FR-256 the core view keeps exactly the pinned keys at every stage of a whole match, none of them an absorber or a pending state', () => {
    const d = coreDriver();
    const seen: string[][] = [Object.keys(d.view)];
    for (let r = 0; r < 4; r++) {
      for (const kind of ['phase-1-close', 'phase-2-close', 'application'] as const) {
        d.run(kind);
        seen.push(Object.keys(d.view));
        expect(keysOf(d.view).filter((k) => FORBIDDEN_KEY.test(k))).toStrictEqual([]);
      }
    }
    for (const keys of seen) for (const k of keys) expect(CORE_MATCH_KEYS as readonly string[]).toContain(k);
  });

  it('FR-255 the phase-2 close calls no seed and computes no round', () => {
    const d = coreDriver();
    d.run('phase-1-close');
    d.seedCalls.length = 0;
    const out = d.run('phase-2-close');
    expect(d.seedCalls).toStrictEqual([]);
    expect(out.view.stage).toBe('locked');
    expect(out.view.victim).toStrictEqual(d.view.victim);
    expect(out.steps.map((s) => s.kind)).toStrictEqual(['phase-2-close']);
  });

  it('FR-255 no seed is requested at creation, by a read, or for a round whose phase 1 has not closed (not even k + 1 after the application)', () => {
    const d = coreDriver();
    publicOf(d.view, 0);
    expect(d.seedCalls).toStrictEqual([]);
    d.run('phase-1-close');
    d.run('phase-2-close');
    d.run('application');
    expect(d.seedCalls).toStrictEqual([1, 1]);
    expect(d.view.stage).toBe('phase-1');
    expect(d.view.victim).toBeUndefined();
  });

  it('FR-255 the application recomputes round k from the state at k - 1 and returns the record, the new state and the anchors of k + 1', () => {
    const d = coreDriver({ timing: CLOCK });
    d.clock.set(T0 + 50_000);
    d.tick();
    d.clock.set(T0 + 80_000);
    d.tick();
    d.clock.set(T0 + 100_000);
    const out = d.tick()!;
    const engine = engineRound1(roundSeed(SECRET_00_1F, 1));
    expect(d.seedCalls).toStrictEqual([1, 1]);
    expect(out.applied!.record).toStrictEqual(engine.record);
    expect(out.applied!.state).toStrictEqual(engine.state);
    expect(out.applied!.stateDigest).toBe(sha256(stateText(engine.state)));
    expect(out.view.state).toStrictEqual(engine.state);
    expect(out.view.appliedRounds).toBe(1);
    expect(out.view.stage).toBe('phase-1');
    expect(out.view.victim).toBeUndefined();
    expect(out.view.anchors).toStrictEqual({ t0: T0 + 100_000, c1: T0 + 150_000, c2: T0 + 180_000, a: T0 + 200_000 });
    expect(out.steps).toStrictEqual([{ round: 1, kind: 'application', instant: T0 + 100_000, cause: 'clock' }]);
    const applied = out.events.find((e) => e.type === 'round-applied')!;
    expect(applied).toMatchObject({ round: 1, record: engine.record, stateDigest: sha256(stateText(engine.state)), appliedAt: T0 + 100_000 });
  });

  it('FR-256 a victim that differs at the application halts the match with victim-mismatch and applies nothing', () => {
    const [s1, s2] = differentVictims();
    let calls = 0;
    const d = coreDriver({ seedOf: () => (calls++ === 0 ? s1 : s2) });
    d.run('phase-1-close');
    const revealed = d.view.victim;
    d.run('phase-2-close');
    const before = d.view;
    const out = d.run('application');
    expect(out.view.stage).toBe('halted');
    expect(out.view.haltReason).toBe('victim-mismatch');
    expect(out.steps).toStrictEqual([]);
    expect(out.applied).toBeUndefined();
    expect(out.view.appliedRounds).toBe(0);
    expect(out.view.state).toStrictEqual(before.state);
    expect(out.view.lastStepMs).toBe(before.lastStepMs);
    expect(out.view.victim).toStrictEqual(revealed);
    expect(out.events.map((e) => e.type)).toStrictEqual(['match-halted']);
    expect(out.events[0]).toMatchObject({ round: 1, reason: 'victim-mismatch' });
    expect(JSON.stringify(out)).not.toContain('"absorber"');
  });

  it('FR-256 the halt reasons of the engine answers: map errors halt as map-changed, isolated-faction as isolated-faction, anything else is not a halt', () => {
    expect(haltReasonOf([{ kind: 'isolated-faction', faction: 3, round: 1 }])).toBe('isolated-faction');
    expect(haltReasonOf([{ kind: 'disconnected-map', groups: [] } as never])).toBe('map-changed');
    expect(haltReasonOf([{ kind: 'too-few-factions' } as never])).toBe('map-changed');
    expect(haltReasonOf([{ kind: 'invalid-state' }])).toBeUndefined();
    expect(haltReasonOf([{ kind: 'invalid-seed' }])).toBeUndefined();
    expect(haltReasonOf([{ kind: 'round-out-of-range', round: 5, total: 4 }])).toBeUndefined();
  });

  it('FR-256 a map that no longer validates halts before any step, before any seed is requested, in every stage', () => {
    for (const upTo of [0, 1, 2]) {
      const d = coreDriver();
      const kinds = ['phase-1-close', 'phase-2-close'] as const;
      for (let i = 0; i < upTo; i++) d.run(kinds[i]!);
      d.deps = { ...d.deps, map: null };
      d.seedCalls.length = 0;
      const before = d.view;
      const out = d.run(nextStep(d.view)!);
      expect(d.seedCalls).toStrictEqual([]);
      expect(out.view.stage).toBe('halted');
      expect(out.view.haltReason).toBe('map-changed');
      expect(out.steps).toStrictEqual([]);
      expect(out.view.appliedRounds).toBe(before.appliedRounds);
      expect(out.view.victim).toStrictEqual(before.victim);
      expect(out.events.map((e) => e.type)).toStrictEqual(['match-halted']);
      expect(out.view.anchors).toBeNull();
    }
  });
});

describe('step order', () => {
  it('FR-247 each step is performed exactly once and in order: one round gives three rows, repeated steps are refused', () => {
    const d = coreDriver();
    expect(nextStep(d.view)).toBe('phase-1-close');
    d.run('phase-1-close');
    expect(nextStep(d.view)).toBe('phase-2-close');
    const snapshot = JSON.stringify(d.view);
    d.seedCalls.length = 0;
    for (const again of ['phase-1-close', 'application'] as const) {
      expect(() => performStep(d.view, { kind: again, instant: T0, cause: 'manual', reportedTime: T0 }, d.deps)).toThrow(RangeError);
    }
    expect(d.seedCalls).toStrictEqual([]);
    expect(JSON.stringify(d.view)).toBe(snapshot);
    d.run('phase-2-close');
    expect(nextStep(d.view)).toBe('application');
    expect(() => d.run('phase-2-close')).toThrow(RangeError);
    d.run('application');
    expect(d.steps.map((s) => `${s.round}:${s.kind}`)).toStrictEqual(['1:phase-1-close', '1:phase-2-close', '1:application']);
  });

  it('FR-247 a whole match performs 12 steps once each, rounds 1..4 in order, and nothing after it is over', () => {
    const d = coreDriver();
    for (let r = 1; r <= 4; r++) for (const kind of ['phase-1-close', 'phase-2-close', 'application'] as const) d.run(kind);
    expect(d.steps).toHaveLength(12);
    expect(new Set(d.steps.map((s) => `${s.round}:${s.kind}`)).size).toBe(12);
    expect(d.view.stage).toBe('finished');
    expect(nextStep(d.view)).toBeNull();
    for (const kind of ['phase-1-close', 'phase-2-close', 'application'] as const) {
      expect(() => d.run(kind)).toThrow(RangeError);
    }
    const halted = coreDriver();
    halted.deps = { ...halted.deps, map: null };
    halted.run('phase-1-close');
    expect(nextStep(halted.view)).toBeNull();
    expect(() => halted.run('phase-1-close')).toThrow(RangeError);
  });

  it('FR-247 a step instant below the last step instant is refused (instants never decrease)', () => {
    const d = coreDriver();
    d.clock.set(T0 + 5000);
    d.run('phase-1-close');
    expect(() => performStep(d.view, { kind: 'phase-2-close', instant: T0 + 4999, cause: 'manual', reportedTime: T0 + 5000 }, d.deps)).toThrow(RangeError);
  });

  it('FR-269 a match with no prediction at all proceeds exactly as scheduled: C1, C2 and A of every round, 12 clock rows, then finished', () => {
    const d = coreDriver({ timing: CLOCK });
    const rows: [number, string, number][] = [];
    for (let r = 1; r <= 4; r++) {
      const base = T0 + 100_000 * (r - 1);
      for (const [offset, kind] of [[50_000, 'phase-1-close'], [80_000, 'phase-2-close'], [100_000, 'application']] as const) {
        d.clock.set(base + offset - 1);
        expect(d.tick()).toBeNull();
        d.clock.set(base + offset);
        const out = d.tick();
        expect(out!.steps).toStrictEqual([{ round: r, kind, instant: base + offset, cause: 'clock' }]);
        rows.push([r, kind, base + offset]);
      }
    }
    expect(d.steps).toHaveLength(12);
    expect(d.view.stage).toBe('finished');
    d.clock.set(T0 + 10_000_000);
    expect(d.tick()).toBeNull();
    expect(d.view.anchors).toBeNull();
    expect(d.events.at(-1)!.type).toBe('round-applied');
  });

  it('FR-269 a phase that has nothing to close still closes: the stage sequence is phase-1, phase-2, locked, phase-1 with no input but time', () => {
    const d = coreDriver({ timing: CLOCK });
    const stages: string[] = [d.view.stage];
    for (const at of [50_000, 80_000, 100_000]) {
      d.clock.set(T0 + at);
      d.tick();
      stages.push(d.view.stage);
    }
    expect(stages).toStrictEqual(['phase-1', 'phase-2', 'locked', 'phase-1']);
  });
});

describe('L2 = 0', () => {
  const SHORT: Timing = { i: 3, l1: 1, l2: 0 };

  it('FR-240 with L2 = 0 the phase-2 close and the application are one decision: two rows with the same instant, phase-2 close first', () => {
    const d = coreDriver({ timing: SHORT });
    d.clock.set(T0 + 2000);
    d.tick();
    d.clock.set(T0 + 3000);
    const out = d.tick()!;
    expect(out.steps).toStrictEqual([
      { round: 1, kind: 'phase-2-close', instant: T0 + 3000, cause: 'clock' },
      { round: 1, kind: 'application', instant: T0 + 3000, cause: 'clock' },
    ]);
    expect(out.view.stage).toBe('phase-1');
    expect(out.view.appliedRounds).toBe(1);
    expect(out.view.anchors).toStrictEqual({ t0: T0 + 3000, c1: T0 + 5000, c2: T0 + 6000, a: T0 + 6000 });
    expect(out.view.lastStepMs).toBe(T0 + 3000);
    // Events in the same order: phase-closed (2), then round-applied; no intermediate `locked` schedule.
    expect(out.events.map((e) => e.type)).toStrictEqual(['phase-closed', 'round-applied', 'schedule']);
    expect(out.events[0]).toMatchObject({ phase: 2, round: 1, at: T0 + 3000 });
    const seqs = out.events.map((e) => e.seq);
    expect(seqs).toStrictEqual([seqs[0]!, seqs[0]! + 1, seqs[0]! + 2]);
    expect(d.seedCalls).toStrictEqual([1, 1]);
  });

  it('FR-240 the last round with L2 = 0 finishes in the same decision and publishes no schedule after it', () => {
    const d = coreDriver({ timing: SHORT, map: pairMap() });
    d.clock.set(T0 + 2000);
    d.tick();
    d.clock.set(T0 + 3000);
    const out = d.tick()!;
    expect(out.steps.map((s) => s.kind)).toStrictEqual(['phase-2-close', 'application']);
    expect(out.view.stage).toBe('finished');
    expect(out.events.map((e) => e.type)).toStrictEqual(['phase-closed', 'round-applied']);
  });

  it('FR-240 a manual phase-2 close with L2 = 0 also stores both rows at its instant, the second one due by its own anchor', () => {
    const d = coreDriver({ timing: SHORT });
    d.clock.set(T0 + 100);
    d.run('phase-1-close');
    d.clock.set(T0 + 777);
    const out = d.run('phase-2-close');
    expect(out.steps).toStrictEqual([
      { round: 1, kind: 'phase-2-close', instant: T0 + 777, cause: 'manual' },
      { round: 1, kind: 'application', instant: T0 + 777, cause: 'clock' },
    ]);
  });

  it('FR-240 with L2 > 0 the phase-2 close alone is stored and the stage is locked', () => {
    const d = coreDriver({ timing: CLOCK });
    d.clock.set(T0 + 50_000);
    d.tick();
    d.clock.set(T0 + 80_000);
    const out = d.tick()!;
    expect(out.steps.map((s) => s.kind)).toStrictEqual(['phase-2-close']);
    expect(out.view.stage).toBe('locked');
    expect(out.events.map((e) => e.type)).toStrictEqual(['phase-closed', 'schedule']);
  });
});

describe('secrecy of the core outputs (FR-257 core part)', () => {
  it('FR-257 (core part) two matches with the same public data and different absorbers get byte-identical views and events at the phase-1 close and the phase-2 close', () => {
    const [s1, s2] = sameVictimDifferentAbsorber();
    expect(engineRound1(s1).record.eliminated).toBe(engineRound1(s2).record.eliminated);
    expect(engineRound1(s1).record.absorber).not.toBe(engineRound1(s2).record.absorber);
    const a = coreDriver({ timing: CLOCK, seedOf: constantSeed(s1) });
    const b = coreDriver({ timing: CLOCK, seedOf: constantSeed(s2) });
    for (const at of [50_000, 80_000]) {
      a.clock.set(T0 + at);
      b.clock.set(T0 + at);
      const x = a.tick()!;
      const y = b.tick()!;
      expect(JSON.stringify(x)).toBe(JSON.stringify(y));
      expect(JSON.stringify(publicOf(x.view, T0 + at))).toBe(JSON.stringify(publicOf(y.view, T0 + at)));
    }
  });

  it('FR-257 (core part) before the phase-1 close the view and the public data are byte-identical whatever the victim will be', () => {
    const [s1, s2] = differentVictims();
    const a = coreDriver({ timing: CLOCK, seedOf: constantSeed(s1) });
    const b = coreDriver({ timing: CLOCK, seedOf: constantSeed(s2) });
    expect(JSON.stringify(a.view)).toBe(JSON.stringify(b.view));
    expect(JSON.stringify(publicOf(a.view, T0))).toBe(JSON.stringify(publicOf(b.view, T0)));
    expect(a.tick()).toBeNull();
    a.clock.set(T0 + 49_999);
    b.clock.set(T0 + 49_999);
    expect(a.tick()).toBeNull();
    expect(b.tick()).toBeNull();
    expect(JSON.stringify(a.view)).toBe(JSON.stringify(b.view));
    expect(a.seedCalls).toStrictEqual([]);
    expect(b.seedCalls).toStrictEqual([]);
  });

  it('FR-257 (core part) the output of a step does not depend on later rounds: seeds that agree on round 1 and differ afterwards give identical outputs up to the round-1 application except its absorber', () => {
    const [s1, s2] = sameVictimDifferentAbsorber();
    const a = coreDriver({ seedOf: constantSeed(s1) });
    const b = coreDriver({ seedOf: constantSeed(s2) });
    for (const kind of ['phase-1-close', 'phase-2-close'] as const) {
      expect(JSON.stringify(a.run(kind))).toBe(JSON.stringify(b.run(kind)));
    }
    const x = a.run('application');
    const y = b.run('application');
    expect(JSON.stringify(x)).not.toBe(JSON.stringify(y));
  });
});

describe('seed adapter and the real secret', () => {
  type Golden = { matches: Record<string, { secret: string; rounds: { round: number; seed: number; victim: number; absorber: number; transferred: number[]; stateDigest: string }[] }> };
  const golden = JSON.parse(readFileSync(new URL('./golden/dev-secrets.json', import.meta.url), 'utf8')) as Golden;

  it('NFR-48 (core timeline) seedOfSecret equals the round seeds of the dev-secrets golden for all three secrets', () => {
    for (const m of Object.values(golden.matches)) {
      const seedOf = seedOfSecret(Uint8Array.from(Buffer.from(m.secret, 'hex')));
      for (const r of m.rounds) expect(seedOf(r.round)).toBe(r.seed);
    }
  });

  it('NFR-48 (core timeline) driving the core through 4 rounds reproduces the golden victims, absorbers, transfers and state digests', () => {
    for (const m of Object.values(golden.matches)) {
      const d = coreDriver({ seedOf: seedOfSecret(Uint8Array.from(Buffer.from(m.secret, 'hex'))) });
      for (const g of m.rounds) {
        d.run('phase-1-close');
        expect(d.view.victim!.victim).toBe(g.victim);
        d.run('phase-2-close');
        const out = d.run('application');
        expect(out.applied!.record).toStrictEqual({ round: g.round, eliminated: g.victim, absorber: g.absorber, transferred: g.transferred });
        expect(out.view.stateDigest).toBe(g.stateDigest);
      }
      expect(d.view.stage).toBe('finished');
      expect(d.view.winner).toBe(livingFactionsOfView(d.view.state));
    }
  });

  it('FR-255 the events of a whole match carry consecutive sequence numbers from 1 and the victim fields name their own event', () => {
    const d = coreDriver({ timing: CLOCK });
    for (const at of [50_000, 80_000, 100_000]) {
      d.clock.set(T0 + at);
      d.tick();
    }
    const events: MatchEvent[] = d.events;
    expect(events.map((e) => e.seq)).toStrictEqual(events.map((_, i) => i + 1));
    const revealed = events.find((e) => e.type === 'victim-revealed')!;
    expect(revealed.seq).toBe(3); // 1 is the creation event (FR-289 (c)), 2 the phase-1 close
    expect(d.view.lastSeq).toBe(events.length);
  });
});

function livingFactionsOfView(state: { owners: readonly (readonly [number, number])[] }): number {
  const owners = new Set(state.owners.map(([, f]) => f));
  expect(owners.size).toBe(1);
  return [...owners][0]!;
}
