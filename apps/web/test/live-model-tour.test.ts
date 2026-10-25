// The live model and the victim tour (spec 009 FR-317, FR-339, FR-340, NFR-61). The model decides from the match
// timeline only: it never sees an absorber before `round-applied`, and a reveal that is not fresh plays nothing.
import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '@mbrg/protocol';
import type { LiveEffect, LiveModel } from '../src/core/live-model';
import { fnv1a32 } from '../src/core/tour-key';
import {
  Driver,
  eventsFrom,
  matchEventsOfRound,
  publicAt,
  requestRounds,
  scripted,
  seqOfRound,
  wire,
  type Scripted,
} from './helpers/scripted-match';

type VictimTour = Extract<LiveEffect, { type: 'victim-tour' }>;
type Revealed = Extract<MatchEvent, { type: 'victim-revealed' }>;
const victimTours = (effects: readonly LiveEffect[]): VictimTour[] => effects.filter((e): e is VictimTour => e.type === 'victim-tour');
const types = (effects: readonly LiveEffect[]): string[] => effects.map((e) => e.type);
/** A model as text: maps become entry lists, so two models compare byte for byte. */
const plain = (m: LiveModel): string => JSON.stringify(m, (_key, v: unknown) => (v instanceof Map ? { map: [...v] } : v));

/** The victim-revealed event of round k with some fields replaced, as the wire carries it. */
const reveal = (s: Scripted, k: number, over: Partial<Revealed> = {}): unknown =>
  wire([{ ...(matchEventsOfRound(s, k)[1] as Revealed), ...over }])[0];

/** A driver loaded at `n` rounds that has consumed the phase-1 close of round n + 1 (the next event is the reveal). */
async function ready(s: Scripted, n = 0, publicExtra: Parameters<typeof publicAt>[2] = {}): Promise<Driver> {
  const d = new Driver(s);
  await d.feed({ type: 'public', at: d.at, match: publicAt(s, n, publicExtra) });
  await d.feed({ type: 'event', at: 10_020, data: wire([matchEventsOfRound(s, n + 1)[0] as MatchEvent])[0] });
  return d;
}

/** Feeds one event at the instant `at` and answers the effects that follow; returns the effects of that input only. */
async function feedAt(d: Driver, data: unknown, at: number): Promise<LiveEffect[]> {
  const before = d.log.length;
  d.at = at;
  await d.feed({ type: 'event', at, data });
  return d.log.slice(before).map((x) => x.effect);
}

// The model loaded at N = 0 has reported time 5,000 read at 10,000: the estimate at `at` is 5,000 + at - 10,000 until
// an event raises it.
describe('FR-317 a fresh victim reveal starts the victim tour', () => {
  it('FR-317 one victim-tour effect with the round, the victim, the participants and sigma of the match id and the round', async () => {
    const s = await scripted();
    for (const k of [1, 2]) {
      const d = await ready(s, k - 1);
      const out = await feedAt(d, reveal(s, k), 10_100);
      const tours = victimTours(out);
      expect(tours).toHaveLength(1);
      expect(tours[0]).toStrictEqual({
        type: 'victim-tour',
        round: k,
        victim: s.records[k - 1]?.eliminated,
        living: s.living[k - 1],
        sigma: fnv1a32(`AbCdEfGh01234567:${String(k)}`),
      });
      expect('budget' in (tours[0] as VictimTour)).toBe(false);
      expect(types(out)).toStrictEqual(['victim-tour']);
    }
  });

  it('FR-317 the tour takes the time left to C2 minus 1,000 ms from the estimate raised with the reveal\'s own reported time', async () => {
    const s = await scripted();
    const d = await ready(s, 0, { timing: { i: 60, l1: 20, l2: 10 }, schedule: { c1: 15_000, c2: 40_000, a: 50_000 } });
    // Before the event the estimate at 10,107 is 5,107; the event reports 5,400, which raises it.
    const out = await feedAt(d, reveal(s, 1, { revealedAt: 5395, reportedTime: 5400, c2: 9721, a: 12_000 }), 10_107);
    expect(victimTours(out)[0]?.budget).toBe(9721 - 5400 - 1000);
  });

  it('FR-317 a reveal of age 5,000 plays and one of 5,001 does not, with the age taken from the raised estimate', async () => {
    const s = await scripted();
    // The event reports 9,000 against an estimate of 5,107: the raised estimate is 9,000.
    const plays = await feedAt(await ready(s), reveal(s, 1, { revealedAt: 4000, reportedTime: 9000 }), 10_107);
    expect(victimTours(plays)).toHaveLength(1);
    const stale = await feedAt(await ready(s), reveal(s, 1, { revealedAt: 3999, reportedTime: 9000 }), 10_107);
    expect(victimTours(stale)).toStrictEqual([]);
    expect(types(stale)).toStrictEqual([]);
  });

  it('FR-317 a replayed reveal after a reconnection is stale: no tour, the model still holds the victim', async () => {
    const s = await scripted();
    const d = await ready(s);
    const out = await feedAt(d, reveal(s, 1, { revealedAt: 100, reportedTime: 9_000 }), 10_107);
    expect(out).toStrictEqual([]);
    expect(d.model.victim?.victim).toBe(s.records[0]?.eliminated);
  });

  it('FR-317 a victim read from the public data (load or reload) plays no tour', async () => {
    const s = await scripted();
    const e = matchEventsOfRound(s, 2)[1] as Revealed;
    const victim = { round: 2, victim: e.victim, candidates: e.candidates, living: e.living, revealedAt: e.revealedAt, c2: null, a: null, seq: e.seq };
    const d = new Driver(s);
    await d.feed({ type: 'public', at: d.at, match: publicAt(s, 1, { stage: 'phase-2', victim }) });
    expect(d.model.victim?.victim).toBe(e.victim);
    expect(types(d.effects)).toStrictEqual(['draw', 'open-stream']);
    // A reload after a resync reads the public data again: still no tour.
    const again = new Driver(s);
    await again.feed({ type: 'public', at: again.at, match: publicAt(s, 1) });
    again.model = { ...again.model, phase: 'resyncing' };
    await again.feed({ type: 'public', at: again.at + 50, match: publicAt(s, 1, { stage: 'phase-2', victim }) });
    expect(again.effects.filter((x) => x.type === 'victim-tour' || x.type === 'complete-tour')).toStrictEqual([]);
  });

  it('FR-317 a halted match keeps its victim from the public data and plays no tour', async () => {
    const s = await scripted();
    const e = matchEventsOfRound(s, 2)[1] as Revealed;
    const victim = { round: 2, victim: e.victim, candidates: e.candidates, living: e.living, revealedAt: e.revealedAt, c2: null, a: null, seq: e.seq };
    const d = new Driver(s);
    await d.feed({ type: 'public', at: d.at, match: publicAt(s, 1, { stage: 'halted', haltReason: 'victim-mismatch', victim }) });
    expect(d.model.stage).toBe('halted');
    expect(d.effects.filter((x) => x.type === 'victim-tour')).toStrictEqual([]);
    // Events after the halt are not read at all.
    await feedAt(d, reveal(s, 2), 10_100);
    expect(d.effects.filter((x) => x.type === 'victim-tour')).toStrictEqual([]);
  });

  it('FR-317 a spectator who browses an earlier round gets no tour for a reveal of round N + 1', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(1);
    await d.feed({ type: 'navigate', at: d.at, action: 'previous' });
    expect(d.model.displayed).toBe(0);
    await feedAt(d, wire([matchEventsOfRound(s, 2)[0] as MatchEvent])[0], 10_100);
    const out = await feedAt(d, reveal(s, 2), 10_120);
    expect(out).toStrictEqual([]);
  });

  it('FR-320 (model) participants that differ from the displayed living, or a victim outside them, play no tour', async () => {
    const s = await scripted();
    const living = s.living[0] as number[];
    const victim = s.records[0]?.eliminated as number;
    const other = living.find((f) => f !== victim) as number;
    expect(victimTours(await feedAt(await ready(s), reveal(s, 1, { living: living.filter((f) => f !== other) }), 10_100))).toStrictEqual([]);
    expect(victimTours(await feedAt(await ready(s), reveal(s, 1, { living: living.filter((f) => f !== victim) }), 10_100))).toStrictEqual([]);
    expect(victimTours(await feedAt(await ready(s), reveal(s, 1, { living: [...living, 4_000_001] }), 10_100))).toStrictEqual([]);
  });

  it('FR-317 the effect has exactly its keys: no absorber, record, state or round seed (type-level key list)', async () => {
    const KEYS: Record<keyof VictimTour, true> = { type: true, round: true, victim: true, living: true, sigma: true, budget: true };
    const s = await scripted();
    const manual = victimTours(await feedAt(await ready(s), reveal(s, 1), 10_100))[0] as VictimTour;
    expect(Object.keys(manual).sort()).toStrictEqual(['living', 'round', 'sigma', 'type', 'victim']);
    const d = await ready(s, 0, { timing: { i: 60, l1: 20, l2: 10 }, schedule: { c1: 15_000, c2: 40_000, a: 50_000 } });
    const clock = victimTours(await feedAt(d, reveal(s, 1, { c2: 20_000, a: 30_000 }), 10_100))[0] as VictimTour;
    expect(Object.keys(clock).sort()).toStrictEqual(Object.keys(KEYS).sort());
    for (const key of Object.keys(KEYS)) expect(key, key).not.toMatch(/absorber|record|state|seed|secret|candidate|next|future/i);
  });
});

describe('FR-339 a running victim tour is completed by the events that need it', () => {
  it('FR-339 a second victim reveal emits complete-tour before its own tour (also when the second one plays nothing)', async () => {
    const s = await scripted();
    const d = await ready(s);
    const first = await feedAt(d, reveal(s, 1), 10_100);
    expect(types(first)).toStrictEqual(['victim-tour']);
    const second = await feedAt(d, reveal(s, 1, { seq: seqOfRound(1) + 2 }), 10_110);
    expect(types(second)).toStrictEqual(['complete-tour', 'victim-tour']);
    const stale = await feedAt(d, reveal(s, 1, { seq: seqOfRound(1) + 3, revealedAt: 10, reportedTime: 9_900 }), 10_120);
    expect(types(stale)).toStrictEqual(['complete-tour']);
  });

  it('FR-339 match-halted emits complete-tour first, once, and only while a tour may be running', async () => {
    const s = await scripted();
    const halt = (seq: number): unknown => wire([{ type: 'match-halted', seq, round: 1, reason: 'victim-mismatch', reportedTime: 9999 }])[0];
    const running = await ready(s);
    await feedAt(running, reveal(s, 1), 10_100);
    const out = await feedAt(running, halt(seqOfRound(1) + 2), 10_110);
    expect(types(out)).toStrictEqual(['complete-tour', 'close-stream']);
    // No tour has been started: nothing to complete.
    const idle = await ready(s);
    expect(types(await feedAt(idle, halt(seqOfRound(1) + 1), 10_110))).toStrictEqual(['close-stream']);
    // The round was applied: the victim tour is over for the model (the map view completes it with the round step).
    const applied = await ready(s);
    await applied.events(wire(matchEventsOfRound(s, 1).slice(1)));
    expect(applied.model.applied).toBe(1);
    const late = await feedAt(applied, halt(seqOfRound(2)), 10_900);
    expect(types(late)).toStrictEqual(['close-stream']);
  });

  it('FR-340 a fresh reveal that follows a round step at once still starts its tour (the map view completes the step)', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(0);
    await d.events(eventsFrom(s, 1, 1));
    expect(types(d.effects)).toContain('play-step');
    expect(await feedAt(d, wire([matchEventsOfRound(s, 2)[0] as MatchEvent])[0], d.at + 3)).toStrictEqual([]);
    const next = await feedAt(d, reveal(s, 2), d.at + 3);
    expect(types(next)).toStrictEqual(['victim-tour']);
    expect(victimTours(next)[0]?.round).toBe(2);
    expect(victimTours(next)[0]?.sigma).toBe(fnv1a32('AbCdEfGh01234567:2'));
  });
});

describe('NFR-61 the victim tour never depends on the absorber or on round k', () => {
  /** A twin of the scripted match whose round-1 record names another absorber (the transferred territories are the same). */
  function twin(s: Scripted): { other: Scripted; a: number; b: number } {
    const record = s.records[0] as Scripted['records'][number];
    const b = (s.living[0] as number[]).find((f) => f !== record.eliminated && f !== record.absorber) as number;
    const records = [{ ...record, absorber: b }, ...s.records.slice(1)];
    return { other: { ...s, records }, a: record.absorber, b };
  }

  it('NFR-61 two matches equal up to the absorber give byte-equal effects and models until round-applied, which then differ', async () => {
    const s = await scripted();
    const { other, a, b } = twin(s);
    const both = [a, b].sort((x, y) => x - y);
    const run = async (m: Scripted): Promise<{ d: Driver; list: MatchEvent[] }> => {
      const d = new Driver(m);
      d.defer = true;
      await d.load(0);
      const list = matchEventsOfRound(m, 1).map((e) => (e.type === 'victim-revealed' ? { ...e, candidates: both } : e));
      return { d, list };
    };
    const x = await run(s);
    const y = await run(other);
    let at = 10_100;
    for (const i of [0, 1, 2, 3, 4]) {
      const ox = await feedAt(x.d, wire([x.list[i] as MatchEvent])[0], at);
      const oy = await feedAt(y.d, wire([y.list[i] as MatchEvent])[0], at);
      expect(JSON.stringify(ox), `event ${String(i)}`).toBe(JSON.stringify(oy));
      expect(plain(x.d.model), `model after event ${String(i)}`).toBe(plain(y.d.model));
      at += 10;
    }
    expect(victimTours(x.d.effects)).toHaveLength(1);
    expect(x.d.model.records.size).toBe(0);
    expect(x.d.model.applying).toBeUndefined();
    // The sensitivity check: the frame that announces the absorber is the first that tells the models apart.
    await feedAt(x.d, wire([x.list[5] as MatchEvent])[0], at);
    await feedAt(y.d, wire([y.list[5] as MatchEvent])[0], at);
    expect(plain(x.d.model)).not.toBe(plain(y.d.model));
    expect(JSON.stringify(x.d.effects)).toContain(String(a));
  });

  it('NFR-61 no effect before round-applied names the absorber, and no request is made for a round above N during a tour', async () => {
    const s = await scripted();
    const d = new Driver(s);
    d.defer = true;
    await d.load(0);
    let applyAt = -1;
    const list = eventsFrom(s, 1, 1);
    for (const [i, data] of list.entries()) {
      await feedAt(d, data, d.at + 7);
      if ((data as { type: string }).type === 'round-applied') applyAt = d.log.length;
      if (applyAt === -1) {
        const record = s.records[0] as Scripted['records'][number];
        // The absorber id may occur as a participant or a candidate; no effect carries the record or an `absorber` key.
        for (const { effect } of d.log) expect(JSON.stringify(effect), `effect before the frame ${String(i)}`).not.toMatch(/absorber|transferred/);
        expect(record.absorber).toBeGreaterThan(0);
      }
    }
    // Requests: none at all during a tour in manual flow, and every read asks for a round at most N.
    const tourAt = d.log.findIndex((x) => x.effect.type === 'victim-tour');
    const hashAt = d.log.findIndex((x) => x.effect.type === 'hash-state');
    expect(tourAt).toBeGreaterThanOrEqual(0);
    expect(requestRounds(d.log.slice(tourAt, hashAt).map((x) => x.effect))).toStrictEqual([]);
    for (const { effect, applied } of d.log) {
      for (const round of requestRounds([effect])) expect(round).toBeLessThanOrEqual(applied);
    }
  });

  it('NFR-61 over a whole match every round with a fresh reveal gets one tour and the requests never pass N', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(0);
    await d.events(eventsFrom(s, 1, s.total));
    const tours = victimTours(d.effects);
    expect(tours.map((t) => t.round)).toStrictEqual(Array.from({ length: s.total }, (_, i) => i + 1));
    expect(tours.map((t) => t.victim)).toStrictEqual(s.records.map((r) => r.eliminated));
    for (const { effect, applied } of d.log) {
      for (const round of requestRounds([effect])) expect(round).toBeLessThanOrEqual(applied);
    }
  });
});

type PlayStep = Extract<LiveEffect, { type: 'play-step' }>;
const playSteps = (effects: readonly LiveEffect[]): PlayStep[] => effects.filter((e): e is PlayStep => e.type === 'play-step');

/**
 * The events of round k with `candidates` (default: the absorber and one other faction, so d = 2) in the reveal. `noLocked`
 * drops the `locked` schedule (L2 = 0: one instant closes phase 2 and applies) and renumbers; `appliedAt` replaces the
 * application instant.
 */
function roundOf(s: Scripted, k: number, opts: { candidates?: readonly number[]; noLocked?: boolean; appliedAt?: number } = {}): MatchEvent[] {
  const record = s.records[k - 1] as Scripted['records'][number];
  const other = (s.living[k - 1] as number[]).find((f) => f !== record.eliminated && f !== record.absorber) ?? record.eliminated;
  const candidates = opts.candidates ?? [record.absorber, other].sort((a, b) => a - b);
  const list = matchEventsOfRound(s, k)
    .map((e) => (e.type === 'victim-revealed' ? { ...e, candidates } : e))
    .map((e) => (e.type === 'round-applied' && opts.appliedAt !== undefined ? { ...e, appliedAt: opts.appliedAt } : e))
    .filter((_, i) => !(opts.noLocked === true && i === 4));
  return list.map((e, i) => ({ ...e, seq: seqOfRound(k) + i }) as MatchEvent);
}

/** Feeds the events one by one, each at its own instant, and returns every effect in order. */
async function feedList(d: Driver, list: readonly MatchEvent[], ats: readonly number[]): Promise<LiveEffect[]> {
  const out: LiveEffect[] = [];
  for (const [i, e] of list.entries()) out.push(...(await feedAt(d, wire([e])[0], ats[i] as number)));
  return out;
}

const CLOCK = { i: 60, l1: 20, l2: 10 } as const;
const clockPublic = { timing: CLOCK, schedule: { c1: 15_000, c2: 40_000, a: 50_000 } } as const;
const sequence = (from: number, n: number): number[] => Array.from({ length: n }, (_, i) => from + i);

describe('FR-345 the absorber tour starts with the round step', () => {
  it('FR-345 a fresh application with d >= 2 sets N and the records at commit as before and plays the step with the tour', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(0);
    const record = s.records[0] as Scripted['records'][number];
    const list = roundOf(s, 1);
    const candidates = (list[1] as Revealed).candidates;
    expect(candidates).toHaveLength(2);
    const out = await feedList(d, list, sequence(10_100, 8));
    const steps = playSteps(out);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.from).toBe(0);
    expect(steps[0]?.to).toBe(1);
    expect(steps[0]?.data.absorber).toBe(record.absorber);
    expect(steps[0]?.tour).toStrictEqual({ victim: record.eliminated, candidates, absorber: record.absorber, sigma: fnv1a32('AbCdEfGh01234567:1:absorber') });
    expect(Object.keys(steps[0]?.tour as object).sort()).toStrictEqual(['absorber', 'candidates', 'sigma', 'victim']);
    expect(d.model.applied).toBe(1);
    expect(d.model.displayed).toBe(1);
    expect(d.model.records.get(1)).toStrictEqual(record);
    expect(d.model.victim).toBeUndefined();
    expect(d.model.touring).toBe(true);
  });

  it('FR-345 the budget with L2 > 0 and with L2 = 0 follows the application instant, I - L1 - L2, the estimate, 1,000 ms and Dt', async () => {
    const s = await scripted();
    // The victim reveal reports 5,101 at 10,100, so the estimate at the application (10,105) is 5,106; applied at 5,105; Dt = 1,500.
    const withL2 = await ready(s, 0, clockPublic);
    const out = await feedList(withL2, roundOf(s, 1).slice(1), [10_100, 10_102, 10_103, 10_104, 10_105, 10_106, 10_107]);
    expect(playSteps(out)[0]?.tour?.budget).toBe(5105 + 30_000 - 5106 - 1000 - 1500);
    const noL2 = await ready(s, 0, { timing: { i: 60, l1: 20, l2: 0 }, schedule: clockPublic.schedule });
    const out0 = await feedList(noL2, roundOf(s, 1, { noLocked: true }).slice(1), [10_100, 10_102, 10_103, 10_105, 10_106, 10_107]);
    expect(playSteps(out0)[0]?.tour?.budget).toBe(5105 + 40_000 - 5106 - 1000 - 1500);
  });

  it('FR-345 a reveal of age 5,000 plays the tour and one of 5,001 plays the step alone; the last round is nominal', async () => {
    const s = await scripted();
    for (const [appliedAt, plays] of [[106, true], [105, false]] as const) {
      const d = await ready(s, 0, clockPublic);
      const out = await feedList(d, roundOf(s, 1, { appliedAt }).slice(1), [10_100, 10_102, 10_103, 10_104, 10_105, 10_106, 10_107]);
      expect(playSteps(out)[0]?.tour !== undefined, `appliedAt ${String(appliedAt)}`).toBe(plays);
    }
    // k = T: no next phase 1, so the tour plays at nominal speed even with a running clock (FR-349).
    const d = new Driver(s);
    const lastRecord = s.records[s.total - 1] as Scripted['records'][number];
    await d.feed({ type: 'public', at: d.at, match: publicAt(s, s.total - 1, clockPublic) });
    const last = roundOf(s, s.total, { candidates: [lastRecord.absorber, lastRecord.eliminated].sort((a, b) => a - b) });
    const out = await feedList(d, last.slice(0, 6), sequence(10_100, 6));
    const tour = playSteps(out)[0]?.tour;
    expect(tour).toBeDefined();
    expect('budget' in (tour as object)).toBe(false);
    // The round before it has a budget.
    const early = await ready(s, 0, clockPublic);
    const first = await feedList(early, roundOf(s, 1).slice(1), [10_100, 10_102, 10_103, 10_104, 10_105, 10_106, 10_107]);
    expect(playSteps(first)[0]?.tour?.budget).toBeTypeOf('number');
  });

  it('FR-350 d = 1, an absorber outside the candidates and candidates that are not held play the step without a tour', async () => {
    const s = await scripted();
    const record = s.records[0] as Scripted['records'][number];
    const others = (s.living[0] as number[]).filter((f) => f !== record.eliminated && f !== record.absorber).slice(0, 2);
    expect(others).toHaveLength(2);
    const cases: [string, MatchEvent[]][] = [
      ['d = 1', roundOf(s, 1, { candidates: [record.absorber] })],
      ['absorber outside', roundOf(s, 1, { candidates: others })],
    ];
    for (const [name, list] of cases) {
      const d = new Driver(s);
      await d.load(0);
      const steps = playSteps(await feedList(d, list, sequence(10_100, 8)));
      expect(steps, name).toHaveLength(1);
      expect(steps[0] !== undefined && 'tour' in steps[0], name).toBe(false);
      expect(d.model.touring, name).toBe(false);
    }
    // Not held: the model joined after the reveal and read no victim (the application arrives alone).
    const d = new Driver(s);
    await d.load(0);
    const applied = roundOf(s, 1).slice(5, 6).map((e) => ({ ...e, seq: 2 }) as MatchEvent);
    const steps = playSteps(await feedList(d, applied, [10_100]));
    expect(steps).toHaveLength(1);
    expect('tour' in (steps[0] as object)).toBe(false);
  });

  it('FR-350 a digest that differs plays no tour and the model keeps none: the state is read and drawn at once', async () => {
    const s = await scripted();
    const d = new Driver(s);
    d.corrupt = true;
    await d.load(0);
    const out = await feedList(d, roundOf(s, 1), sequence(10_100, 8));
    expect(playSteps(out)).toStrictEqual([]);
    expect(out.filter((e) => e.type === 'draw')).toHaveLength(1);
    expect(d.model.applying).toBeUndefined();
    expect(d.model.touring).toBe(false);
    // While the state is read the model holds the announced record and no tour.
    const reading = new Driver(s);
    reading.corrupt = true;
    reading.holdReads = true;
    await reading.load(0);
    await feedList(reading, roundOf(s, 1).slice(0, 6), sequence(10_100, 6));
    expect(reading.model.applying?.step).toBe('read');
    expect(reading.model.applying?.tour).toBeUndefined();
  });

  it('FR-350 a record that does not fit what is held (mismatch at receipt) keeps no tour either', async () => {
    const s = await scripted();
    const d = new Driver(s);
    d.holdReads = true;
    await d.load(0);
    const list = roundOf(s, 1)
      .slice(0, 6)
      .map((e) => (e.type === 'round-applied' ? { ...e, record: { ...e.record, transferred: [...e.record.transferred, 999_999_999] } } : e));
    await feedList(d, list, sequence(10_100, 6));
    expect(d.model.applying?.step).toBe('read');
    expect(d.model.applying?.tour).toBeUndefined();
  });

  it('FR-345 a late joiner in phase 2 plays no victim tour but the later application plays the absorber tour from the public candidates', async () => {
    const s = await scripted();
    const list = roundOf(s, 1);
    const e = list[1] as Revealed;
    const victim = { round: 1, victim: e.victim, candidates: e.candidates, living: e.living, revealedAt: e.revealedAt, c2: null, a: null, seq: e.seq };
    const d = new Driver(s);
    await d.feed({ type: 'public', at: d.at, match: publicAt(s, 0, { stage: 'phase-2', victim, lastSeq: seqOfRound(1) + 2 }) });
    expect(d.effects.filter((x) => x.type === 'victim-tour')).toStrictEqual([]);
    const out = await feedList(d, list.slice(3, 6), sequence(10_100, 3));
    const tour = playSteps(out)[0]?.tour;
    expect(tour?.candidates).toStrictEqual(e.candidates);
    expect(tour?.victim).toBe(e.victim);
  });

  it('FR-350 a spectator who browses an earlier round gets no tour for the application of round N + 1', async () => {
    const s = await scripted();
    const d = new Driver(s);
    await d.load(1);
    await d.feed({ type: 'navigate', at: d.at, action: 'previous' });
    const out = await feedList(d, roundOf(s, 2), sequence(10_100, 8));
    expect(out.filter((x) => x.type === 'victim-tour' || x.type === 'complete-tour')).toStrictEqual([]);
    expect(playSteps(out).filter((p) => p.tour !== undefined)).toStrictEqual([]);
    expect(d.model.touring).toBe(false);
  });

  it('FR-350 a halt or a new reveal while the absorber tour may run completes it first', async () => {
    const s = await scripted();
    const d = new Driver(s);
    d.defer = true;
    await d.load(0);
    await feedList(d, roundOf(s, 1), sequence(10_100, 8));
    // The next reveal waits behind the check of the round; the digest then commits and drains the queue.
    const next = roundOf(s, 2);
    expect(await feedAt(d, wire([next[0] as MatchEvent])[0], 10_110)).toStrictEqual([]);
    expect(await feedAt(d, wire([next[1] as MatchEvent])[0], 10_111)).toStrictEqual([]);
    const before = d.log.length;
    await d.resolve();
    expect(d.log.slice(before).map((x) => x.effect.type)).toStrictEqual(['play-step', 'complete-tour', 'victim-tour']);
    const halt = await feedAt(d, wire([{ type: 'match-halted', seq: seqOfRound(2) + 2, round: 2, reason: 'victim-mismatch', reportedTime: 9999 }])[0], 10_200);
    expect(types(halt)).toStrictEqual(['complete-tour', 'close-stream']);
  });
});

describe('FR-337 the tours change nothing else in the model', () => {
  it('FR-337 over a whole match the model and the effects equal those of a match without absorber tours, minus the tour fields', async () => {
    const s = await scripted();
    const strip = (v: unknown): unknown =>
      JSON.parse(JSON.stringify(v, (key, x: unknown) => (key === 'touring' || key === 'tour' || key === 'candidates' ? undefined : x instanceof Map ? { map: [...x] } : x)));
    const absorber = (k: number): number => (s.records[k - 1] as Scripted['records'][number]).absorber;
    const run = async (candidatesOf: (k: number) => number[]): Promise<Driver> => {
      const d = new Driver(s);
      await d.feed({ type: 'public', at: d.at, match: publicAt(s, 0, clockPublic) });
      let at = 10_100;
      for (let k = 1; k <= s.total; k++) {
        const list = roundOf(s, k, { candidates: candidatesOf(k) });
        await feedList(d, list, list.map(() => (at += 3)));
      }
      return d;
    };
    const withTours = await run((k) => [absorber(k), (s.records[k - 1] as Scripted['records'][number]).eliminated].sort((a, b) => a - b));
    const without = await run((k) => [absorber(k)]);
    expect(playSteps(withTours.effects).filter((p) => p.tour !== undefined)).toHaveLength(s.total);
    expect(playSteps(without.effects).filter((p) => p.tour !== undefined)).toStrictEqual([]);
    const plainEffects = (d: Driver): unknown[] => d.effects.filter((e) => e.type !== 'victim-tour' && e.type !== 'complete-tour').map(strip);
    expect(plainEffects(withTours)).toStrictEqual(plainEffects(without));
    expect(strip(withTours.model)).toStrictEqual(strip(without.model));
    // The countdown: the reported time and the schedule are the same.
    expect(withTours.model.reported).toStrictEqual(without.model.reported);
    expect(withTours.model.schedule).toStrictEqual(without.model.schedule);
  });
});
