import { join } from 'node:path';
import { encodePublicMatch } from '@mbrg/protocol';
import type { PublicMatch } from '@mbrg/protocol';
import { getState, playRoundWithSeed } from '@mbrg/sim';
import type { MatchState } from '@mbrg/sim';
import { describe, expect, it } from 'vitest';
import { createMapCatalog } from '../src/service/maps';
import { createMatchService } from '../src/service/matches';
import type { MatchService, TestSeedSource } from '../src/service/matches';
import { openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';
import { dumpRows, withRawDb } from './helpers/db-scan';
import { devMap } from './helpers/digests';
import { CLOCK_TIMING, OPERATOR, creationBody, serviceHarness, withTempDir } from './helpers/service-harness';

// Twin matches through the lifecycle SERVICE (spec 008 NFR-47 (a), FR-257 checked on every read, command and event of
// the service; M2b' T5'). Two services with the test-only round-seed source (FR-260) run matches whose public data are
// equal and whose unrevealed outcomes differ: a different victim before the phase-1 close, or the same victim and a
// different absorber (and different later rounds) before the application. The same requests at the same clock readings
// must give byte-identical public data, replies, published events and stored events up to the step that reveals the
// difference, apart from the match id, host token and commitment (equal here when both services draw the same random
// bytes, replaced by placeholders when they do not) and the reported time (equal: one clock script). With a database
// file the server restarts after every step and the raw storage of the twins is compared too (FR-256 storage).

const CLIENT = { credential: 'client-credential-web-0123456789ab', namespace: 'web' } as const;
const NEXT = { 'phase-1': 'phase-1-close', 'phase-2': 'phase-2-close', locked: 'application' } as const;

interface Entry {
  /** The number of steps performed when the entry was recorded: an action's outputs carry the count after it. */
  readonly step: number;
  readonly label: string;
  readonly text: string;
}

interface TwinRun {
  readonly entries: Entry[];
  /** The raw database after every step (file runs only), tagged like the entries. */
  readonly dumps: Entry[];
  readonly steps: number;
}

interface TwinOptions {
  readonly mode: 'clock' | 'manual';
  /** The fake random source seed: equal for both twins, or different (then ids, token and commitment are replaced). */
  readonly randomSeed: number;
  /** A database file: the server is restarted after every step and the database dumped. */
  readonly file?: string;
  /** Keep the drawn values (match id, host token, commitment) instead of replacing them with placeholders. */
  readonly keepDrawn?: boolean;
}

/** The test-only source of one twin: round k gets `seeds[k - 1]`; a round the list does not cover is a test error. */
const sourceOf = (seeds: readonly number[]): TestSeedSource => () => (k) => {
  const seed = seeds[k - 1];
  if (seed === undefined) throw new Error(`no seed for round ${k}`);
  return seed;
};

/** Runs one twin through the service: every read and command of the script at every stage, until the match ends. */
function runTwin(seeds: readonly number[], options: TwinOptions): TwinRun {
  const testSeedSource = sourceOf(seeds);
  const h = serviceHarness({ seed: options.randomSeed, testSeedSource, ...(options.file === undefined ? {} : { store: openStore(options.file) }) });
  const live: { store: Store; service: MatchService } = { store: h.store, service: h.service };
  const entries: Entry[] = [];
  const dumps: Entry[] = [];
  let steps = 0;
  const replace: [string, string][] = [];
  const normal = (text: string): string => replace.reduce((t, [from, to]) => t.split(from).join(to), text);
  const record = (label: string, value: unknown): void => {
    entries.push({ step: steps, label, text: normal(typeof value === 'string' ? value : JSON.stringify(value)) });
  };
  const listen = (service: MatchService): void => {
    service.subscribe((matchId, events) => record(`published ${matchId === id ? 'own' : 'other'}`, events));
  };

  const timing = options.mode === 'clock' ? { ...CLOCK_TIMING } : 'manual';
  const created = h.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing }) });
  if (!created.ok) throw new Error(`creation failed: ${JSON.stringify(created.error)}`);
  const id = created.reply.matchId;
  const token = created.reply.hostToken;
  if (options.keepDrawn !== true) replace.push([id, '<match-id>'], [token, '<host-token>'], [created.reply.match.commitment, '<commitment>']);
  record('creation', created);
  record('creation replay', h.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing }) }));
  listen(h.service);

  const restart = (): void => {
    live.service.close();
    dumps.push({ step: steps, label: 'dump', text: normal(withRawDb(options.file!, dumpRows)) });
    live.store = openStore(options.file!);
    live.service = createMatchService({ store: live.store, clock: h.clock, maps: createMapCatalog(h.settings.maps), settings: h.settings, testSeedSource });
    listen(live.service);
    record('start', live.service.start());
  };
  const submit = (label: string, body: Record<string, unknown>): void => record(label, live.service.submit({ client: { ...CLIENT }, matchId: id, body }));

  for (let guard = 0; guard < 40; guard++) {
    const shown: PublicMatch = live.service.publicMatch(id)!;
    record('public', encodePublicMatch(shown));
    record('stored events', live.store.eventsAfter(id, 0));
    if (shown.stage === 'finished' || shown.stage === 'halted') break;
    const stage = shown.stage as keyof typeof NEXT;
    const round = shown.appliedRounds + 1;
    // Choices come from the public data only (equal for the twins until the reveal).
    const living = [...new Set(shown.state.owners.map(([, f]) => f))].sort((a, b) => a - b);
    const n = steps;
    if (stage === 'phase-1') {
      submit('victim', { kind: 'victim', round, faction: living[n % living.length], playerId: 'p1', requestId: `v-${n}` });
      submit('victim replay', { kind: 'victim', round, faction: living[n % living.length], playerId: 'p1', requestId: `v-${n}` });
      submit('winner', { kind: 'winner', faction: living[(n + 1) % living.length], playerId: 'p2' });
      submit('absorber too early', { kind: 'absorber', round, faction: living[0], playerId: 'p1' });
    } else if (stage === 'phase-2') {
      const candidates = shown.victim!.candidates;
      submit('absorber', { kind: 'absorber', round, faction: candidates[n % candidates.length], playerId: 'p1', requestId: `a-${n}` });
      submit('victim too late', { kind: 'victim', round, faction: living[0], playerId: 'p2' });
      submit('absorber of the victim', { kind: 'absorber', round, faction: shown.victim!.victim, playerId: 'p2' });
    } else {
      submit('absorber when locked', { kind: 'absorber', round, faction: living[0], playerId: 'p2' });
    }
    submit('next round', { kind: 'victim', round: round + 1, faction: living[0], playerId: 'p3' });
    record('own p1', live.service.ownPredictions({ namespace: 'web', playerId: 'p1', matchId: id }));
    record('own p2', live.service.ownPredictions({ namespace: 'web', playerId: 'p2', matchId: id }));
    record('mismatch', live.service.advance({ credential: OPERATOR, matchId: id, body: { round: round + 1, step: NEXT[stage] } }));
    record('forbidden', live.service.advance({ credential: 'not-the-host-token-0123456789', matchId: id, body: { round, step: NEXT[stage] } }));
    record('tick before', live.service.tick());

    steps += 1;
    if (options.mode === 'manual') {
      const body = { round, step: NEXT[stage], requestId: `adv-${n}` };
      const credential = n % 2 === 0 ? OPERATOR : token;
      record('advance', live.service.advance({ credential, matchId: id, body }));
      record('advance replay', live.service.advance({ credential, matchId: id, body }));
      record('advance again', live.service.advance({ credential: OPERATOR, matchId: id, body: { round, step: NEXT[stage] } }));
    } else {
      const schedule = shown.schedule!;
      h.clock.set(stage === 'phase-1' ? schedule.c1 : stage === 'phase-2' ? schedule.c2 : schedule.a);
      record('tick', live.service.tick());
    }
    if (options.file !== undefined) restart();
  }
  live.service.close();
  return { entries, dumps, steps };
}

/** The index of the first entry that differs (text or label), or -1. */
function firstDifference(a: readonly Entry[], b: readonly Entry[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]?.label !== b[i]?.label || a[i]?.text !== b[i]?.text || a[i]?.step !== b[i]?.step) return i;
  }
  return -1;
}

/**
 * Checks the twin property: every entry recorded before and during the steps up to (excluding) step index `reveal`,
 * and the requests before it, are identical; the first difference is an output of step `reveal` itself (its tag is
 * `reveal + 1`), so the comparison is not vacuous and nothing leaked earlier.
 */
function expectTwins(a: readonly Entry[], b: readonly Entry[], reveal: number): void {
  const i = firstDifference(a, b);
  expect(i, 'the twins never differ').toBeGreaterThanOrEqual(0);
  const before = a.slice(0, i);
  expect(before.filter((e) => e.step === reveal).length, 'no entry was compared at the reveal stage').toBeGreaterThan(0);
  expect({ step: a[i]!.step, label: a[i]!.label }).toMatchObject({ step: reveal + 1 });
  expect(b.slice(0, i)).toStrictEqual(before);
}

// The dev map: the round-0 state and the engine's outcome for a seed.
const MAP = devMap();
const STATE0 = ((): MatchState => {
  const r = getState(MAP, 0, 0);
  if (!r.ok) throw new Error('no round-0 state');
  return r.value;
})();
const outcome = (state: MatchState, seed: number): { victim: number; absorber: number; state: MatchState } => {
  const r = playRoundWithSeed(MAP, state, seed);
  if (!r.ok) throw new Error('the round cannot be played');
  return { victim: r.value.record.eliminated, absorber: r.value.record.absorber, state: r.value.state };
};

/** Two seeds for the round played from `state`: different victims, or the same victim with different absorbers. */
function seedPair(state: MatchState, kind: 'victim' | 'absorber'): [number, number] {
  const first = new Map<number, { seed: number; absorber: number }>();
  for (let seed = 101; seed < 20_101; seed++) {
    const o = outcome(state, seed);
    if (kind === 'victim') {
      const any = [...first.values()][0];
      if (any !== undefined && outcome(state, any.seed).victim !== o.victim) return [any.seed, seed];
      if (any === undefined) first.set(o.victim, { seed, absorber: o.absorber });
      continue;
    }
    const seen = first.get(o.victim);
    if (seen === undefined) first.set(o.victim, { seed, absorber: o.absorber });
    else if (seen.absorber !== o.absorber) return [seen.seed, seed];
  }
  throw new Error(`no seed pair with a different ${kind}`);
}

/** The pairs of seed lists of the twins and the step index (0-based, 3 per round) that first reveals their difference. */
function twinPairs(): { name: string; a: number[]; b: number[]; reveal: number }[] {
  const later = (base: number): number[] => [base + 1, base + 2, base + 3, base + 4];
  const [v1a, v1b] = seedPair(STATE0, 'victim');
  const [a1a, a1b] = seedPair(STATE0, 'absorber');
  const common = 7_777;
  const state1 = outcome(STATE0, common).state;
  const [v2a, v2b] = seedPair(state1, 'victim');
  const [a2a, a2b] = seedPair(state1, 'absorber');
  return [
    { name: 'a different round-1 victim, before the phase-1 close', a: [v1a, ...later(1_000)], b: [v1b, ...later(2_000)], reveal: 0 },
    { name: 'the same round-1 victim and a different absorber (and later rounds), before the application', a: [a1a, ...later(1_000)], b: [a1b, ...later(2_000)], reveal: 2 },
    { name: 'the same round 1 and a different round-2 victim, before the round-2 phase-1 close', a: [common, v2a, ...later(1_000)], b: [common, v2b, ...later(2_000)], reveal: 3 },
    { name: 'the same round 1, the same round-2 victim and a different absorber, before the round-2 application', a: [common, a2a, ...later(1_000)], b: [common, a2b, ...later(2_000)], reveal: 5 },
  ];
}

describe('NFR-47 (a) twin matches through the service', () => {
  const pairs = twinPairs();

  it('NFR-47 (a) the seed pairs have the outcomes they claim (same public data, different unrevealed outcome)', () => {
    const [p1, p2, p3, p4] = pairs;
    expect(outcome(STATE0, p1!.a[0]!).victim).not.toBe(outcome(STATE0, p1!.b[0]!).victim);
    const [x, y] = [outcome(STATE0, p2!.a[0]!), outcome(STATE0, p2!.b[0]!)];
    expect([x.victim, x.absorber === y.absorber]).toStrictEqual([y.victim, false]);
    const state1 = outcome(STATE0, p3!.a[0]!).state;
    expect(outcome(state1, p3!.a[1]!).victim).not.toBe(outcome(state1, p3!.b[1]!).victim);
    const [u, w] = [outcome(state1, p4!.a[1]!), outcome(state1, p4!.b[1]!)];
    expect([u.victim, u.absorber === w.absorber]).toStrictEqual([w.victim, false]);
  });

  for (const pair of pairs) {
    it(`NFR-47 (a) clock match with a restart after every step, ${pair.name}: byte-identical public data, replies, events and raw storage until the reveal`, () => {
      withTempDir((dir) => {
        const a = runTwin(pair.a, { mode: 'clock', randomSeed: 1, file: join(dir, 'a.sqlite') });
        const b = runTwin(pair.b, { mode: 'clock', randomSeed: 1, file: join(dir, 'b.sqlite') });
        expect(a.steps).toBeGreaterThan(pair.reveal + 1);
        expectTwins(a.entries, b.entries, pair.reveal);
        // FR-256 (storage): the databases are equal byte for byte after every step before the reveal, so they hold
        // nothing of the absorber, the pending state or a later round; they differ right after the revealing step.
        expect(b.dumps.slice(0, pair.reveal)).toStrictEqual(a.dumps.slice(0, pair.reveal));
        expect(a.dumps[pair.reveal]!.step).toBe(pair.reveal + 1);
        expect(b.dumps[pair.reveal]!.text).not.toBe(a.dumps[pair.reveal]!.text);
      });
    });

    it(`NFR-47 (a) manual match with different random draws, ${pair.name}: identical bytes apart from match id, host token and commitment until the reveal`, () => {
      const a = runTwin(pair.a, { mode: 'manual', randomSeed: 1 });
      const b = runTwin(pair.b, { mode: 'manual', randomSeed: 2 });
      expectTwins(a.entries, b.entries, pair.reveal);
    });
  }

  it('NFR-47 (a) the comparison fails for twins whose public data differ (a planted difference before any step)', () => {
    const pair = pairs[1]!;
    const a = runTwin(pair.a, { mode: 'manual', randomSeed: 1 });
    const b = runTwin(pair.b, { mode: 'manual', randomSeed: 1 });
    const planted = b.entries.map((e, i) => (i === 3 ? { ...e, text: `${e.text} ` } : e));
    expect(firstDifference(a.entries, planted)).toBe(3);
    expect(() => expectTwins(a.entries, planted, pair.reveal)).toThrow();
    // Without the replacement of the drawn values, twins with different random draws differ from the creation reply on.
    const c = runTwin(pair.b, { mode: 'manual', randomSeed: 2, keepDrawn: true });
    expect(firstDifference(a.entries, c.entries)).toBe(0);
  });
});
