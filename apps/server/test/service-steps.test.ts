import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePublicMatch, errorReply } from '@mbrg/protocol';
import type { AdvanceReply, MatchEvent, StepKind } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { MEMO_RETENTION_MS } from '../src/core/memo';
import type { CoreMatch } from '../src/core/view';
import { DERIVATION_RULE } from '../src/secret';
import { credentialDigest } from '../src/service/ids';
import type { AdvanceOutcome } from '../src/service/matches';
import { createScheduler } from '../src/service/scheduler';
import type { Store } from '../src/store/store';
import { openStore } from '../src/store/sqlite';
import { fakeClock } from './helpers/fake-clock';
import { fakeRandom } from './helpers/fake-random';
import { SCENARIOS, SECRETS, T0 } from './helpers/core-timelines';
import { CLOCK_TIMING, OPERATOR, START_MS, creationBody, serviceHarness, withTempDir } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// The steps part of the lifecycle service (M2b T6): advances, clock ticks, one storage transaction per decision, events
// published after the commit, finishing a match. Authorization is checked here against the credential text the caller
// presents (the reading of a credential from an HTTP request is M3a). Everything runs in process, with the fake clock, an
// in-memory database (a temporary file for the restart test) and a hand-written event reader (NFR-52).

interface RoundGolden {
  round: number;
  victim: number;
  absorber: number;
  transferred: number[];
  stateDigest: string;
}
const golden = JSON.parse(readFileSync(new URL('./golden/dev-secrets.json', import.meta.url), 'utf8')) as { matches: Record<string, { rounds: RoundGolden[] }> };
const GOLD = golden.matches['ascending-00-1f']!.rounds;
const S = 1000;
const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const testSources = import.meta.glob(['./*.test.ts', './helpers/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const SECRET_HEX = hex(SECRETS['ascending-00-1f']);
const KINDS: readonly StepKind[] = ['phase-1-close', 'phase-2-close', 'application'];

/** The store wrapped so that a test sees how many transactions ran and whether one is open right now. */
function instrument(base: Store): { store: Store; inside: () => boolean; transactions: () => number; failAppend: (on: boolean) => void } {
  let depth = 0;
  let count = 0;
  let failing = false;
  const store: Store = {
    ...base,
    appendEvents(matchId, events) {
      if (failing) throw new Error('boom');
      base.appendEvents(matchId, events);
    },
    transaction<T>(fn: () => T): T {
      count += 1;
      depth += 1;
      try {
        return base.transaction(fn);
      } finally {
        depth -= 1;
      }
    },
  };
  return { store, inside: () => depth > 0, transactions: () => count, failAppend: (on) => (failing = on) };
}

/** What a subscriber saw at the moment of a publication: the state of the database inside its callback. */
interface Seen {
  readonly matchId: string;
  readonly events: readonly MatchEvent[];
  readonly inside: boolean;
  readonly transactions: number;
  readonly steps: number;
  readonly stored: readonly MatchEvent[];
  readonly view: CoreMatch;
  readonly records: number;
  readonly stateDigest: string | undefined;
}

interface Started {
  readonly h: Harness;
  readonly id: string;
  readonly hostToken: string;
  readonly seen: Seen[];
  readonly transactions: () => number;
  readonly failAppend: (on: boolean) => void;
}

function start(options: { timing?: unknown; secret?: keyof typeof SECRETS; scheduler?: boolean; seed?: number } = {}): Started {
  const wrapped = instrument(openStore(':memory:'));
  const h = serviceHarness({ store: wrapped.store, secret: SECRETS[options.secret ?? 'ascending-00-1f'], scheduler: options.scheduler ?? false, seed: options.seed ?? 1 });
  const seen: Seen[] = [];
  h.service.subscribe((matchId, events) => {
    const row = h.store.getMatch(matchId)!;
    seen.push({
      matchId,
      events,
      inside: wrapped.inside(),
      transactions: wrapped.transactions(),
      steps: h.store.steps(matchId).length,
      stored: h.store.eventsAfter(matchId, events[0]!.seq - 1),
      view: row.match,
      records: h.store.records(matchId).length,
      stateDigest: h.store.getState(matchId, row.match.appliedRounds)?.stateDigest,
    });
  });
  const out = h.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing: options.timing ?? { ...CLOCK_TIMING } }) });
  if (!out.ok) throw new Error(`creation failed: ${JSON.stringify(out.error)}`);
  return { h, id: out.reply.matchId, hostToken: out.reply.hostToken, seen, transactions: wrapped.transactions, failAppend: wrapped.failAppend };
}

const advance = (m: Started, round: number, step: StepKind, credential: string | null = OPERATOR, matchId: string = m.id): AdvanceOutcome =>
  m.h.service.advance({ credential: credential ?? undefined, matchId, body: { round, step } });
const performed = (out: AdvanceOutcome): AdvanceReply => {
  if (!out.ok) throw new Error(`advance refused: ${JSON.stringify(out.error)}`);
  return out.reply;
};
const rows = (m: Started): [number, string, number, string][] => m.h.store.steps(m.id).map((s) => [s.round, s.kind, s.instant, s.cause]);
const view = (m: Started): CoreMatch => m.h.store.getMatch(m.id)!.match;

/** Every step of a 4-round manual match by operator advances (12 advances). */
function finishByHand(m: Started): void {
  for (let k = 1; k <= 4; k++) for (const kind of KINDS) performed(advance(m, k, kind));
}

/** The full clock match of the plan (I = 120, L1 = 30, L2 = 10), run to round T through the fake scheduler. */
function clockRun(): Started {
  const m = start({ scheduler: true });
  m.h.scheduler!.runTo(START_MS + 4 * 120 * S + 5);
  return m;
}
// Round 4 of the secret 00-1f is forced (spec 011 FR-388): phase 2 lasts F = 5 s, so its C2 is C1 + 5 s and A is C2 + L2 = C1 + 15 s.
const instantOf = (round: number, kind: StepKind): number =>
  START_MS + ((round - 1) * 120 + (kind === 'phase-1-close' ? 80 : kind === 'phase-2-close' ? (round === 4 ? 85 : 110) : round === 4 ? 95 : 120)) * S;
const stepsOf = (m: Started, kind: StepKind): Seen[] => m.seen.filter((s) => stepKindOf(s) === kind);
const stepKindOf = (s: Seen): StepKind | null => {
  const types = s.events.map((e) => e.type);
  if (types.includes('victim-revealed')) return 'phase-1-close';
  if (types.includes('round-applied')) return 'application';
  const closed = s.events.find((e) => e.type === 'phase-closed');
  return closed !== undefined && closed.type === 'phase-closed' && closed.phase === 2 ? 'phase-2-close' : null;
};

describe('one transaction per decision, events published after the commit', () => {
  it('FR-241 FR-290 each phase-1 close stores its step row, the victim with its reveal instant and its events in one transaction, and publishes after the commit', () => {
    const m = clockRun();
    const closes = stepsOf(m, 'phase-1-close');
    expect(closes).toHaveLength(4);
    closes.forEach((s, i) => {
      const k = i + 1;
      const at = instantOf(k, 'phase-1-close');
      expect(s.inside, `round ${k}: published inside the transaction`).toBe(false);
      // The creation was transaction 1, every decision since is exactly one more: step n of the match is transaction n + 1.
      expect(s.transactions, `round ${k}`).toBe(3 * (k - 1) + 2);
      expect(s.steps).toBe(3 * (k - 1) + 1);
      expect(s.events.map((e) => e.type)).toStrictEqual(['phase-closed', 'victim-revealed', 'results', 'schedule']);
      expect(s.events[2]).toStrictEqual({ type: 'results', seq: s.events[1]!.seq + 1, round: k, phase: 1 });
      expect(s.view.stage).toBe('phase-2');
      expect(s.view.lastStepMs).toBe(at);
      expect(s.view.victim).toMatchObject({ round: k, victim: GOLD[i]!.victim, revealedAt: at });
      const revealed = s.events[1]!;
      expect(revealed.type === 'victim-revealed' && revealed.victim === GOLD[i]!.victim && revealed.revealedAt === at).toBe(true);
      // What the subscriber read back from the database is what it was told (stored before published).
      expect(s.stored).toStrictEqual(s.events);
    });
    expect(m.h.store.steps(m.id).filter((r) => r.kind === 'phase-1-close').map((r) => [r.round, r.instant, r.cause])).toStrictEqual(
      [1, 2, 3, 4].map((k) => [k, instantOf(k, 'phase-1-close'), 'clock']),
    );
    m.h.close();
  });

  it('FR-242 each phase-2 close stores its step row and the locked stage, and publishes after the commit', () => {
    const m = clockRun();
    const closes = stepsOf(m, 'phase-2-close');
    expect(closes).toHaveLength(4);
    closes.forEach((s, i) => {
      const k = i + 1;
      expect(s.inside).toBe(false);
      expect(s.transactions).toBe(3 * (k - 1) + 3);
      expect(s.steps).toBe(3 * (k - 1) + 2);
      expect(s.events.map((e) => e.type)).toStrictEqual(['phase-closed', 'schedule']);
      expect(s.events[0]).toMatchObject({ type: 'phase-closed', round: k, phase: 2, at: instantOf(k, 'phase-2-close') });
      expect(s.events[1]).toMatchObject({ type: 'schedule', stage: 'locked' });
      expect(s.view.stage).toBe('locked');
      expect(s.view.lastStepMs).toBe(instantOf(k, 'phase-2-close'));
      expect(s.stored).toStrictEqual(s.events);
    });
    m.h.close();
  });

  it('FR-243 each application stores the step row, the state and the record of its round and the anchors of the next one in one transaction', () => {
    const m = clockRun();
    const applications = stepsOf(m, 'application');
    expect(applications).toHaveLength(4);
    applications.forEach((s, i) => {
      const k = i + 1;
      const at = instantOf(k, 'application');
      expect(s.inside).toBe(false);
      expect(s.transactions).toBe(3 * k + 1);
      expect(s.steps).toBe(3 * k);
      expect(s.records).toBe(k);
      expect(s.stateDigest).toBe(GOLD[i]!.stateDigest);
      expect(s.view.appliedRounds).toBe(k);
      const applied = s.events[0]!;
      expect(applied).toStrictEqual({
        type: 'round-applied',
        seq: applied.seq,
        round: k,
        record: { round: k, eliminated: GOLD[i]!.victim, absorber: GOLD[i]!.absorber, transferred: GOLD[i]!.transferred },
        stateDigest: GOLD[i]!.stateDigest,
        appliedAt: at,
      });
      if (k < 4) {
        // Round k + 1 is anchored at the application instant (FR-239).
        expect(s.view.anchors).toStrictEqual({ t0: at, c1: at + 80 * S, c2: at + 110 * S, a: at + 120 * S });
        expect(s.view.stage).toBe('phase-1');
        expect(s.view.victim).toBeUndefined();
        expect(s.events.map((e) => e.type)).toStrictEqual(['round-applied', 'results', 'schedule']);
        expect(s.events[1]).toStrictEqual({ type: 'results', seq: applied.seq + 1, round: k, phase: 2 });
      } else {
        expect(s.view.anchors).toBeNull();
      }
      expect(s.stored).toStrictEqual(s.events);
    });
    expect(m.h.store.records(m.id).map((r) => [r.round, r.eliminated, r.absorber, [...r.transferred]])).toStrictEqual(
      GOLD.map((g) => [g.round, g.victim, g.absorber, g.transferred]),
    );
    m.h.close();
  });

  it('FR-243 with L2 = 0 the phase-2 close and the application are one decision: one transaction, two rows with one instant, phase-2 close first', () => {
    const m = start({ timing: { i: 60, l1: 20, l2: 0 }, scheduler: true });
    m.h.scheduler!.runTo(START_MS + 40 * S);
    // Creation (1) + phase-1 close (2); the chained decision at 60 s is the third.
    expect(m.transactions()).toBe(2);
    expect(rows(m)).toStrictEqual([[1, 'phase-1-close', START_MS + 40 * S, 'clock']]);
    m.h.scheduler!.runTo(START_MS + 60 * S);
    expect(m.transactions()).toBe(3);
    expect(rows(m)).toStrictEqual([
      [1, 'phase-1-close', START_MS + 40 * S, 'clock'],
      [1, 'phase-2-close', START_MS + 60 * S, 'clock'],
      [1, 'application', START_MS + 60 * S, 'clock'],
    ]);
    const last = m.seen[m.seen.length - 1]!;
    expect(last.events.map((e) => e.type)).toStrictEqual(['phase-closed', 'round-applied', 'results', 'schedule']);
    expect(last.events[2]).toMatchObject({ type: 'results', round: 1, phase: 2 });
    expect(last.inside).toBe(false);
    m.h.close();
  });

  it('FR-290 a decision whose write fails midway is rolled back, publishes nothing, and can be retried', () => {
    const m = start({ timing: 'manual' });
    const events = m.h.store.eventsAfter(m.id, 0);
    m.failAppend(true);
    expect(() => advance(m, 1, 'phase-1-close')).toThrow('boom');
    // The step row and the new stage written before the failing write are rolled back with it.
    expect(m.seen).toHaveLength(1);
    expect(m.h.store.steps(m.id)).toStrictEqual([]);
    expect(m.h.store.eventsAfter(m.id, 0)).toStrictEqual(events);
    expect(view(m)).toMatchObject({ stage: 'phase-1', lastSeq: 1, appliedRounds: 0 });
    expect(view(m).victim).toBeUndefined();
    m.failAppend(false);
    expect(performed(advance(m, 1, 'phase-1-close')).result).toBe('performed');
    expect(m.seen).toHaveLength(2);
    m.h.close();
  });
});

describe('the results event stored with its decision', () => {
  it('FR-287 (d) FR-289 (results event numbering) the dev-map match stores 37 events, numbered 1 to 37, and the step rows cover the results events', () => {
    const m = clockRun();
    const events = m.h.store.eventsAfter(m.id, 0);
    expect(events).toHaveLength(37);
    expect(events.map((e) => e.seq)).toStrictEqual(Array.from({ length: 37 }, (_, i) => i + 1));
    expect(events.filter((e) => e.type === 'results').map((e) => [(e as { round: number }).round, (e as { phase: number }).phase])).toStrictEqual([
      [1, 1], [1, 2], [2, 1], [2, 2], [3, 1], [3, 2], [4, 1], [4, 2],
    ]);
    // Each step row ends at the last event of its decision: the schedule (or match-finished) that follows the results event.
    const stepRows = m.h.store.steps(m.id).map((s) => [s.round, s.kind, s.firstSeq, s.lastSeq]);
    expect(stepRows).toStrictEqual([
      [1, 'phase-1-close', 2, 5], [1, 'phase-2-close', 6, 7], [1, 'application', 8, 10],
      [2, 'phase-1-close', 11, 14], [2, 'phase-2-close', 15, 16], [2, 'application', 17, 19],
      [3, 'phase-1-close', 20, 23], [3, 'phase-2-close', 24, 25], [3, 'application', 26, 28],
      [4, 'phase-1-close', 29, 32], [4, 'phase-2-close', 33, 34], [4, 'application', 35, 37],
    ]);
    m.h.close();
  });
});

describe('finishing a match', () => {
  it('FR-246 after round T the match is finished with its winner, a match-finished event carries the secret and the rule, and the public data shows the secret', () => {
    const m = clockRun();
    const v = view(m);
    expect(v.stage).toBe('finished');
    expect(v.appliedRounds).toBe(4);
    // The only living faction is the absorber of the last round.
    expect(v.winner).toBe(GOLD[3]!.absorber);
    const last = m.seen[m.seen.length - 1]!;
    expect(last.events.map((e) => e.type)).toStrictEqual(['round-applied', 'results', 'match-finished']);
    expect(last.events[1]).toStrictEqual({ type: 'results', seq: last.events[0]!.seq + 1, round: 4, phase: 2 });
    const finished = last.events[2]!;
    expect(finished).toStrictEqual({
      type: 'match-finished',
      seq: finished.seq,
      winner: GOLD[3]!.absorber,
      matchSecret: SECRET_HEX,
      rule: DERIVATION_RULE,
      reportedTime: instantOf(4, 'application'),
    });
    expect(last.inside).toBe(false);
    expect(last.stored).toStrictEqual(last.events);
    expect(v.lastSeq).toBe(finished.seq);
    // No schedule event follows, no timer is armed, and the match no longer counts as running.
    expect(m.h.store.eventsAfter(m.id, finished.seq)).toStrictEqual([]);
    expect(m.h.scheduler!.pending()).toStrictEqual([]);
    expect(m.h.store.runningCount()).toBe(0);
    // The public data shows the winner and the secret, and the commitment checks out against it.
    const pub = m.h.service.publicMatch(m.id)!;
    expect(pub).toMatchObject({ stage: 'finished', winner: GOLD[3]!.absorber, matchSecret: SECRET_HEX, appliedRounds: 4, lastSeq: finished.seq });
    expect(createHash('sha256').update(Buffer.from(pub.matchSecret!, 'hex')).digest('hex')).toBe(pub.commitment);
    expect(() => encodePublicMatch(pub)).not.toThrow();
    // Nothing is advanced or scheduled any more.
    expect(m.h.scheduler!.runTo(START_MS + 10_000 * S)).toBe(0);
    m.h.close();
  });

  it('FR-246 the match secret appears in no event, reply or public data before the last application', () => {
    const m = start({ timing: 'manual' });
    const everything: unknown[] = [m.h.service.publicMatch(m.id)];
    for (let k = 1; k <= 4; k++) {
      for (const kind of KINDS) {
        const out = performed(advance(m, k, kind));
        everything.push(out, m.h.service.publicMatch(m.id));
        const text = JSON.stringify([everything, m.h.store.eventsAfter(m.id, 0)]);
        if (k === 4 && kind === 'application') expect(text).toContain(SECRET_HEX);
        else expect(text, `after round ${k} ${kind}`).not.toContain(SECRET_HEX);
      }
    }
    m.h.close();
  });

  it('FR-246 the advance that applies round T replies with the finished public data, secret and winner included', () => {
    const m = start({ timing: 'manual' });
    for (let k = 1; k <= 3; k++) for (const kind of KINDS) performed(advance(m, k, kind));
    performed(advance(m, 4, 'phase-1-close'));
    performed(advance(m, 4, 'phase-2-close'));
    const reply = performed(advance(m, 4, 'application'));
    expect(reply.result).toBe('performed');
    expect(reply.match).toMatchObject({ stage: 'finished', winner: GOLD[3]!.absorber, matchSecret: SECRET_HEX, appliedRounds: 4 });
    expect(reply.match.lastSeq).toBe(view(m).lastSeq);
    expect(reply.match.schedule).toBeUndefined();
    m.h.close();
  });
});

describe('what the steps never change', () => {
  it('FR-235 (after the steps) the map, map digest, timing, commitment, number of rounds and creation instant of a match are the ones of its creation after every step of a whole match', () => {
    const m = clockRun();
    const fixed = (v: CoreMatch): unknown => [v.matchId, v.mapId, v.mapDigest, v.timing, v.commitment, v.totalRounds, v.createdAt];
    const created = fixed(m.seen[0]!.view);
    expect(m.seen).toHaveLength(13);
    for (const s of m.seen) expect(fixed(s.view)).toStrictEqual(created);
    expect(fixed(view(m))).toStrictEqual(created);
    m.h.close();
  });
});

describe('advances and authorization', () => {
  it('FR-245 an advance without the operator credential or the match host token is forbidden and changes nothing', () => {
    const a = start({ timing: 'manual' });
    const b = start({ timing: 'manual', seed: 2 });
    const other = b.hostToken;
    expect(other).not.toBe(a.hostToken);
    const before = JSON.stringify([rows(a), a.h.store.eventsAfter(a.id, 0), view(a)]);
    for (const credential of [null, '', 'wrong-credential', other, a.hostToken.toUpperCase(), `${a.hostToken} `]) {
      expect(advance(a, 1, 'phase-1-close', credential), String(credential)).toStrictEqual({ ok: false, error: errorReply('forbidden') });
    }
    expect(JSON.stringify([rows(a), a.h.store.eventsAfter(a.id, 0), view(a)])).toBe(before);
    expect(a.seen).toHaveLength(1);
    a.h.close();
    b.h.close();
  });

  it('FR-245 the operator credential and the match host token both perform the next step with cause manual', () => {
    const m = start({ timing: 'manual' });
    expect(performed(advance(m, 1, 'phase-1-close', OPERATOR)).result).toBe('performed');
    const reply = performed(advance(m, 1, 'phase-2-close', m.hostToken));
    expect(reply.result).toBe('performed');
    expect(reply.step).toStrictEqual({ round: 1, kind: 'phase-2-close', instant: START_MS, cause: 'manual' });
    expect(rows(m).map((r) => r[3])).toStrictEqual(['manual', 'manual']);
    m.h.close();
  });

  it('FR-245 the host token of one match is forbidden on another, and a host token never reaches an unknown match', () => {
    const a = start({ timing: 'manual' });
    const b = start({ timing: 'manual', seed: 2 });
    expect(advance(a, 1, 'phase-1-close', b.hostToken)).toStrictEqual({ ok: false, error: errorReply('forbidden') });
    expect(advance(a, 1, 'phase-1-close', a.hostToken, 'unknown-match-id')).toStrictEqual({ ok: false, error: errorReply('forbidden') });
    expect(advance(a, 1, 'phase-1-close', OPERATOR, 'unknown-match-id')).toStrictEqual({ ok: false, error: errorReply('unknown-match') });
    expect(rows(a)).toStrictEqual([]);
    a.h.close();
    b.h.close();
  });

  it('FR-245 an advance on a finished match is match-finished for the operator and the host token, forbidden without a credential', () => {
    const m = start({ timing: 'manual' });
    finishByHand(m);
    const before = JSON.stringify([rows(m), m.h.store.eventsAfter(m.id, 0)]);
    expect(advance(m, 1, 'phase-1-close', OPERATOR)).toStrictEqual({ ok: false, error: errorReply('match-finished') });
    expect(advance(m, 5, 'application', m.hostToken)).toStrictEqual({ ok: false, error: errorReply('match-finished') });
    expect(advance(m, 1, 'phase-1-close', null)).toStrictEqual({ ok: false, error: errorReply('forbidden') });
    expect(JSON.stringify([rows(m), m.h.store.eventsAfter(m.id, 0)])).toBe(before);
    m.h.close();
  });

  it('FR-245 a malformed advance body is invalid-request before the credential is looked at (FR-301 order)', () => {
    const m = start({ timing: 'manual' });
    for (const body of [null, {}, { round: 0, step: 'application' }, { round: 1, step: 'close' }, { round: 1, step: 'application', extra: 1 }]) {
      expect(m.h.service.advance({ credential: undefined, matchId: m.id, body })).toMatchObject({ ok: false, error: { kind: 'invalid-request' } });
    }
    m.h.close();
  });

  it('FR-300 (constant-time comparison) the service compares credential and host-token digests only through sameDigest', () => {
    const source = Object.entries(sources).find(([file]) => file.endsWith('/service/matches.ts'))![1].replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(source).toContain('sameDigest(');
    expect(/Digest\w*\s*[!=]==|[!=]==\s*\w*Digest/.test(source)).toBe(false);
  });

  it('FR-244 an advance performs the next step at the effective instant with cause manual and shifts the anchors of a clock match', () => {
    const m = start();
    m.h.clock.set(START_MS + 10 * S);
    const reply = performed(advance(m, 1, 'phase-1-close'));
    expect(reply.step).toStrictEqual({ round: 1, kind: 'phase-1-close', instant: START_MS + 10 * S, cause: 'manual' });
    expect(reply.match.schedule).toStrictEqual({ c1: START_MS + 80 * S, c2: START_MS + 40 * S, a: START_MS + 50 * S });
    expect(view(m).anchors).toMatchObject({ c2: START_MS + 40 * S, a: START_MS + 50 * S });
    m.h.close();
  });
});

describe('public data of a pending round', () => {
  it('FR-288 (data) the public data in phase-2 and locked carries the stored victim fields, and none in phase-1', () => {
    const m = start({ scheduler: true });
    expect(m.h.service.publicMatch(m.id)!.victim).toBeUndefined();
    m.h.scheduler!.runTo(START_MS + 80 * S);
    const revealed = m.seen[m.seen.length - 1]!.events[1]!;
    if (revealed.type !== 'victim-revealed') throw new Error('expected victim-revealed');
    const { type: _type, reportedTime: _reported, ...fields } = revealed;
    const phase2 = m.h.service.publicMatch(m.id)!;
    expect(phase2.stage).toBe('phase-2');
    expect(phase2.victim).toStrictEqual(fields);
    expect(fields).toMatchObject({ round: 1, victim: GOLD[0]!.victim, revealedAt: START_MS + 80 * S, c2: START_MS + 110 * S, a: START_MS + 120 * S });
    expect(fields.living).toContain(GOLD[0]!.victim);
    expect(fields.candidates.length).toBeGreaterThan(0);
    // The stored view holds the same fields, so a late joiner reads the same data.
    expect(view(m).victim).toStrictEqual(fields);
    m.h.scheduler!.runTo(START_MS + 110 * S);
    const locked = m.h.service.publicMatch(m.id)!;
    expect(locked.stage).toBe('locked');
    expect(locked.victim).toStrictEqual(fields);
    expect(() => encodePublicMatch(locked)).not.toThrow();
    m.h.scheduler!.runTo(START_MS + 120 * S);
    const next = m.h.service.publicMatch(m.id)!;
    expect(next.stage).toBe('phase-1');
    expect(next.victim).toBeUndefined();
    // No absorber of the pending round appears anywhere before its application (FR-254).
    expect(JSON.stringify(phase2)).not.toContain('absorber');
    m.h.close();
  });
});

describe('one step at a time, in order, exactly once', () => {
  it('FR-295 (serialisation) FR-247 (shell) two advances naming the same step perform one step; the second gets already-performed with the stored row', () => {
    const m = start({ timing: 'manual' });
    m.h.clock.advance(7 * S);
    const first = performed(advance(m, 1, 'phase-1-close'));
    m.h.clock.advance(7 * S);
    const second = performed(advance(m, 1, 'phase-1-close'));
    expect(first.result).toBe('performed');
    expect(second.result).toBe('already-performed');
    expect(second.step).toStrictEqual(first.step);
    expect(second.step).toStrictEqual({ round: 1, kind: 'phase-1-close', instant: START_MS + 7 * S, cause: 'manual' });
    expect(rows(m)).toHaveLength(1);
    expect(m.h.store.eventsAfter(m.id, 0).map((e) => e.seq)).toStrictEqual([1, 2, 3, 4, 5]);
    expect(m.seen).toHaveLength(2);
    expect(second.match.lastSeq).toBe(first.match.lastSeq);
    m.h.close();
  });

  it('FR-295 (serialisation) FR-247 (shell) a clock step and an advance naming it perform one step, whichever comes first', () => {
    const clockFirst = start({ scheduler: true });
    clockFirst.h.scheduler!.runTo(START_MS + 80 * S);
    const lost = performed(advance(clockFirst, 1, 'phase-1-close'));
    expect(lost.result).toBe('already-performed');
    expect(lost.step).toStrictEqual({ round: 1, kind: 'phase-1-close', instant: START_MS + 80 * S, cause: 'clock' });
    expect(rows(clockFirst)).toHaveLength(1);

    const advanceFirst = start();
    advanceFirst.h.clock.set(START_MS + 10 * S);
    performed(advance(advanceFirst, 1, 'phase-1-close'));
    expect(advanceFirst.h.service.tick().performed).toStrictEqual([]);
    // The clock reaches the old C1: the phase-1 close is not performed again; only the phase-2 close (C2 = 40 s) is overdue.
    advanceFirst.h.clock.set(START_MS + 80 * S);
    expect(advanceFirst.h.service.tick().performed.map((p) => p.steps.map((s) => s.kind))).toStrictEqual([['phase-2-close']]);
    expect(rows(advanceFirst).map((r) => r[1])).toStrictEqual(['phase-1-close', 'phase-2-close']);
    clockFirst.h.close();
    advanceFirst.h.close();
  });

  it('FR-295 (serialisation) a subscriber that advances inside its callback sees the stored result: the same step is already-performed, never a second one', () => {
    const m = start({ timing: 'manual' });
    const nested: AdvanceOutcome[] = [];
    m.h.service.subscribe((matchId, events) => {
      if (events.some((e) => e.type === 'victim-revealed')) {
        nested.push(m.h.service.advance({ credential: OPERATOR, matchId, body: { round: 1, step: 'phase-1-close' } }));
        nested.push(m.h.service.advance({ credential: OPERATOR, matchId, body: { round: 1, step: 'phase-2-close' } }));
      }
    });
    performed(advance(m, 1, 'phase-1-close'));
    expect(nested.map((n) => (n.ok ? n.reply.result : n.error.kind))).toStrictEqual(['already-performed', 'performed']);
    expect(rows(m).map((r) => [r[0], r[1]])).toStrictEqual([[1, 'phase-1-close'], [1, 'phase-2-close']]);
    m.h.close();
  });

  it('FR-295 (serialisation) an advance naming a step that is not the next one is step-mismatch with the stage and N, and stores nothing', () => {
    const m = start({ timing: 'manual' });
    const before = m.h.store.eventsAfter(m.id, 0);
    expect(advance(m, 1, 'application')).toStrictEqual({ ok: false, error: { kind: 'step-mismatch', stage: 'phase-1', appliedRounds: 0 } });
    expect(advance(m, 2, 'phase-1-close')).toStrictEqual({ ok: false, error: { kind: 'step-mismatch', stage: 'phase-1', appliedRounds: 0 } });
    expect(rows(m)).toStrictEqual([]);
    expect(m.h.store.eventsAfter(m.id, 0)).toStrictEqual(before);
    m.h.close();
  });

  it('FR-247 (shell) a mixed sequence of ticks, advances and repeated advances performs every step once and in order', () => {
    const random = fakeRandom(7);
    const m = start();
    const performedRows: [number, string][] = [];
    for (let n = 0; n < 4000 && view(m).stage !== 'finished'; n++) {
      const [pick = 0, jump = 0, extra = 0] = random(3);
      const v = view(m);
      const next = ((): [number, StepKind] => {
        const kind = v.stage === 'phase-1' ? 'phase-1-close' : v.stage === 'phase-2' ? 'phase-2-close' : 'application';
        return [v.appliedRounds + 1, kind];
      })();
      if (pick % 4 === 0) m.h.clock.advance((jump % 61) * S);
      else if (pick % 4 === 1) m.h.service.tick();
      else if (pick % 4 === 2) advance(m, next[0], next[1], extra % 2 === 0 ? OPERATOR : m.hostToken);
      else {
        // A step that was already performed (or one two steps ahead).
        const done = m.h.store.steps(m.id);
        const old = done[extra % Math.max(1, done.length)];
        if (old !== undefined) expect(performed(advance(m, old.round, old.kind)).result).toBe('already-performed');
        else expect(advance(m, 1, 'application').ok).toBe(false);
      }
    }
    for (const s of m.h.store.steps(m.id)) performedRows.push([s.round, s.kind]);
    expect(view(m).stage).toBe('finished');
    expect(performedRows).toStrictEqual([1, 2, 3, 4].flatMap((k) => KINDS.map((kind): [number, string] => [k, kind])));
    const instants = m.h.store.steps(m.id).map((s) => s.instant);
    expect(instants).toStrictEqual([...instants].sort((a, b) => a - b));
    m.h.close();
  });
});

describe('time', () => {
  it('FR-249 (service) a step by hand after the clock went back takes the last step instant, never the earlier reading', () => {
    const m = start({ timing: 'manual' });
    m.h.clock.set(START_MS + 100 * S);
    performed(advance(m, 1, 'phase-1-close'));
    m.h.clock.set(START_MS - 3_600 * S);
    const reply = performed(advance(m, 1, 'phase-2-close'));
    expect(reply.step.instant).toBe(START_MS + 100 * S);
    expect(rows(m).map((r) => r[2])).toStrictEqual([START_MS + 100 * S, START_MS + 100 * S]);
    expect(view(m).lastStepMs).toBe(START_MS + 100 * S);
    m.h.close();
  });

  it('FR-302 the reported time of replies, public data and events is kept per match and never decreases', () => {
    const m = start({ timing: 'manual' });
    m.h.clock.set(START_MS + 10 * S);
    performed(advance(m, 1, 'phase-1-close'));
    m.h.clock.set(START_MS + 15 * S);
    expect(m.h.service.publicMatch(m.id)!.reportedTime).toBe(START_MS + 15 * S);
    // The clock goes back: the effective instant falls to 11 s, the reported time stays at 15 s.
    m.h.clock.set(START_MS + 11 * S);
    expect(m.h.service.publicMatch(m.id)!.reportedTime).toBe(START_MS + 15 * S);
    const reply = performed(advance(m, 1, 'phase-2-close'));
    expect(reply.match.reportedTime).toBe(START_MS + 15 * S);
    expect(reply.step.instant).toBe(START_MS + 11 * S);
    const reported = m.h.store.eventsAfter(m.id, 0).flatMap((e) => ('reportedTime' in e ? [e.reportedTime] : []));
    expect(reported).toStrictEqual([...reported].sort((a, b) => a - b));
    expect(reported[reported.length - 1]).toBe(START_MS + 15 * S);
    // Another match keeps its own reported time.
    const other = m.h.service.create({ credential: OPERATOR, body: creationBody('c-2') });
    expect(other.ok && other.reply.match.reportedTime).toBe(START_MS + 11 * S);
    m.h.close();
  });

  it('FR-238 (purge by the tick) the first tick after the retention deletes the memo entries, and a tick before it keeps them', () => {
    const m = start({ timing: 'manual' });
    const scope = { credentialDigest: credentialDigest(OPERATOR), match: null };
    expect(m.h.store.memoGet(scope, 'c-1')).toBeDefined();
    m.h.clock.set(START_MS + MEMO_RETENTION_MS);
    expect(m.h.service.tick().purged).toBe(0);
    expect(m.h.store.memoGet(scope, 'c-1')).toBeDefined();
    m.h.clock.set(START_MS + MEMO_RETENTION_MS + 1);
    expect(m.h.service.tick().purged).toBe(1);
    expect(m.h.store.memoGet(scope, 'c-1')).toBeUndefined();
    m.h.close();
  });

  it('FR-239 a tick performs the one due step of every running match and nothing of a match with no clock', () => {
    const m = start({ timing: { ...CLOCK_TIMING } });
    const second = m.h.service.create({ credential: OPERATOR, body: creationBody('c-3') });
    const manual = m.h.service.create({ credential: OPERATOR, body: creationBody('c-4', { timing: 'manual' }) });
    if (!second.ok || !manual.ok) throw new Error('creation failed');
    m.h.clock.set(START_MS + 80 * S);
    const report = m.h.service.tick();
    expect(report.performed.map((p) => [p.matchId, p.steps.map((s) => s.kind)])).toStrictEqual([
      [m.id, ['phase-1-close']],
      [second.reply.matchId, ['phase-1-close']],
    ]);
    // One call performs one step per match: the phase-2 close is not due yet.
    expect(m.h.service.tick().performed).toStrictEqual([]);
    expect(m.h.store.steps(manual.reply.matchId)).toStrictEqual([]);
    m.h.close();
  });
});

describe('the scheduler', () => {
  it('FR-239 (scheduler) the service arms the next due instant after creation and after every decision, and cancels the earlier one', () => {
    const m = start({ scheduler: true });
    const s = m.h.scheduler!;
    expect(s.pending()).toStrictEqual([START_MS + 80 * S]);
    s.runTo(START_MS + 80 * S);
    expect(s.pending()).toStrictEqual([START_MS + 110 * S]);
    s.runTo(START_MS + 110 * S);
    expect(s.pending()).toStrictEqual([START_MS + 120 * S]);
    s.runTo(START_MS + 120 * S);
    expect(s.pending()).toStrictEqual([START_MS + 200 * S]);
    // A manual advance moves the single armed instant to the shifted anchor.
    m.h.clock.set(START_MS + 130 * S);
    performed(advance(m, 2, 'phase-1-close'));
    expect(s.pending()).toStrictEqual([START_MS + 160 * S]);
    m.h.close();
  });

  it('FR-239 (scheduler) a match with no clock arms nothing, and a callback that fires with nothing due re-arms and performs nothing', () => {
    const manual = start({ timing: 'manual', scheduler: true });
    expect(manual.h.scheduler!.pending()).toStrictEqual([]);
    performed(advance(manual, 1, 'phase-1-close'));
    expect(manual.h.scheduler!.pending()).toStrictEqual([]);
    manual.h.close();

    // The armed callback fires while the clock is still behind its instant (a backward jump, or a timer that fires early).
    const m = start({ scheduler: true });
    const armed = m.h.scheduler!.pending();
    expect(armed).toStrictEqual([START_MS + 80 * S]);
    m.h.clock.set(START_MS + 79 * S);
    expect(m.h.scheduler!.fireAll()).toBe(1);
    expect(rows(m)).toStrictEqual([]);
    expect(m.seen).toHaveLength(1);
    expect(m.h.scheduler!.pending()).toStrictEqual(armed);
    m.h.close();
  });

  it('FR-239 (scheduler) the real scheduler fires once at its instant, and cancel and close stop it; a far instant does not fire at once', async () => {
    const clock = fakeClock(1000);
    const scheduler = createScheduler(clock);
    const fired: string[] = [];
    scheduler.at(1030, () => fired.push('a'));
    const cancelled = scheduler.at(1030, () => fired.push('cancelled'));
    scheduler.cancel(cancelled);
    scheduler.at(900, () => fired.push('past'));
    scheduler.at(1000 + 2 ** 40, () => fired.push('far'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fired.sort()).toStrictEqual(['a', 'past']);
    scheduler.at(1050, () => fired.push('later'));
    scheduler.close();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(fired.sort()).toStrictEqual(['a', 'past']);
  });

  it('FR-239 (scheduler) timers are used by the scheduler module only', () => {
    const TIMERS = /\b(setTimeout|setInterval|setImmediate)\b/;
    const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const using = Object.entries(sources)
      .filter(([, raw]) => TIMERS.test(strip(raw)))
      .map(([file]) => file.replace(/^.*\/src\//, ''))
      .sort();
    expect(using).toStrictEqual(['service/scheduler.ts']);
  });
});

describe('the whole lifecycle with the fake clock (NFR-52, FR-315)', () => {
  it('FR-315 victims, records and state digests equal the dev-secrets golden for timing manual, two clock settings, mid-round advances, late steps and clock jumps; steps equal the hand-derived rows', () => {
    expect(START_MS).toBe(T0);
    expect(SCENARIOS.map((s) => s.name)).toStrictEqual(['on-time', 'l2-zero', 'manual', 'mid-round-advances', 'downtime-forward-jump', 'backward-jump']);
    for (const s of SCENARIOS) {
      const m = start({ timing: s.timing, secret: s.secret });
      s.actions.forEach((a, n) => {
        const label = `${s.name} action ${n} (at ${a.at}, ${a.act})`;
        const before = rows(m).length;
        m.h.clock.set(T0 + a.at);
        if (a.act === 'tick') m.h.service.tick();
        else performed(advance(m, a.expect!.rows[0]![0], a.act));
        const added = rows(m).slice(before);
        if (a.expect === null) {
          expect(added, label).toStrictEqual([]);
          return;
        }
        expect(added, label).toStrictEqual(a.expect.rows.map(([round, kind, offset, cause]) => [round, kind, T0 + offset, cause]));
        const v = view(m);
        expect(v.stage, label).toBe(a.expect.stage);
        expect(v.anchors === null ? null : [v.anchors.c1, v.anchors.c2, v.anchors.a], label).toStrictEqual(a.expect.anchors === null ? null : a.expect.anchors.map((o) => T0 + o));
      });
      const expected = golden.matches[s.secret]!.rounds;
      expect(m.h.store.records(m.id).map((r) => [r.round, r.eliminated, r.absorber, [...r.transferred]]), s.name).toStrictEqual(
        expected.map((g) => [g.round, g.victim, g.absorber, g.transferred]),
      );
      expected.forEach((g) => expect(m.h.store.getState(m.id, g.round)?.stateDigest, `${s.name} round ${g.round}`).toBe(g.stateDigest));
      expect(view(m).stage, s.name).toBe('finished');
      m.h.close();
    }
  });

  it('NFR-52 (store and lifecycle) an in-process match with the fake clock and an in-memory database is read by a hand-written event reader in the documented event order, without a gap', () => {
    const m = start({ scheduler: true });
    m.h.scheduler!.runTo(START_MS + 4 * 120 * S);
    // The reader: every publication in arrival order, as a client of the event stream would see them.
    const received = m.seen.flatMap((s) => s.events);
    expect(received.map((e) => e.seq)).toStrictEqual(Array.from({ length: received.length }, (_, i) => i + 1));
    expect(received).toStrictEqual(m.h.store.eventsAfter(m.id, 0));
    const order = received.map((e) => e.type);
    expect(order[0]).toBe('schedule');
    // Within each step: phase-closed, victim-revealed (phase 1 only), round-applied, results, schedule, match-finished.
    const rank: Record<string, number> = { 'phase-closed': 0, 'victim-revealed': 1, 'round-applied': 2, results: 3, schedule: 4, 'match-finished': 5 };
    for (const s of m.seen) {
      const ranks = s.events.map((e) => rank[e.type]!);
      if (!s.events.some((e) => e.type === 'match-finished')) expect(ranks, JSON.stringify(s.events.map((e) => e.type))).toStrictEqual([...ranks].sort((a, b) => a - b));
    }
    expect(order[order.length - 1]).toBe('match-finished');
    expect(order.filter((t) => t === 'match-finished')).toHaveLength(1);
    expect(order.filter((t) => t === 'schedule')).toHaveLength(1 + 11);
    m.h.close();
  });

  it('NFR-52 (store and lifecycle) a match in a database file continues after a restart from the stored rows, with the events numbered without a gap', () => {
    withTempDir((dir) => {
      const file = join(dir, 'matches.sqlite');
      const first = serviceHarness({ store: openStore(file), secret: SECRETS['ascending-00-1f'] });
      const created = first.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing: 'manual' }) });
      if (!created.ok) throw new Error('creation failed');
      const id = created.reply.matchId;
      const token = created.reply.hostToken;
      first.clock.advance(3 * S);
      expect(first.service.advance({ credential: token, matchId: id, body: { round: 1, step: 'phase-1-close' } }).ok).toBe(true);
      first.close();

      const second = serviceHarness({ store: openStore(file), start: START_MS + 9 * S });
      const again = second.service.advance({ credential: token, matchId: id, body: { round: 1, step: 'phase-1-close' } });
      expect(again.ok && again.reply.result).toBe('already-performed');
      const next = second.service.advance({ credential: OPERATOR, matchId: id, body: { round: 1, step: 'phase-2-close' } });
      expect(next.ok && next.reply.step).toStrictEqual({ round: 1, kind: 'phase-2-close', instant: START_MS + 9 * S, cause: 'manual' });
      expect(second.store.eventsAfter(id, 0).map((e) => e.seq)).toStrictEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(second.store.getMatch(id)!.match.victim?.victim).toBe(GOLD[0]!.victim);
      expect(second.store.steps(id).map((s) => [s.kind, s.instant])).toStrictEqual([['phase-1-close', START_MS + 3 * S], ['phase-2-close', START_MS + 9 * S]]);
      second.close();
    });
  });

  it('NFR-52 (store and lifecycle) the server tests import only vitest, the platform and the workspace packages: no mocking or event-source library', () => {
    const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
    const found = new Set<string>();
    for (const [file, raw] of Object.entries(testSources)) {
      if (file.includes('/fixtures/')) continue;
      for (const m of raw.matchAll(IMPORT)) found.add((m[1] ?? m[2])!);
    }
    const foreign = [...found].filter((spec) => !spec.startsWith('.') && !spec.startsWith('node:') && !spec.startsWith('@mbrg/') && spec !== 'vitest').sort();
    expect(foreign).toStrictEqual([]);
  });
});
