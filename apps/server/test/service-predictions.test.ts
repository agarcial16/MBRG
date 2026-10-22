import { join } from 'node:path';
import { errorReply } from '@mbrg/protocol';
import type { StepKind } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { MEMO_RETENTION_MS } from '../src/core/memo';
import { credentialDigest } from '../src/service/ids';
import type { OwnPredictionsOutcome, SubmitOutcome } from '../src/service/matches';
import { openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';
import { listColumns, withRawDb } from './helpers/db-scan';
import { SECRETS } from './helpers/core-timelines';
import { CLOCK_TIMING, OPERATOR, START_MS, creationBody, serviceHarness, withTempDir } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// The predictions part of the lifecycle service (M2b T7): storage, stored replies of a client request id and the own
// predictions read. Partial parts only: the scoring and the results are M4, the credential reading and namespaces M3a (the
// service takes the credential text and the namespace of the caller as the HTTP layer will resolve them), so no pending id
// is named in a title. Everything runs in process, with the fake clock and an in-memory database.

const S = 1000;
const WEB = { credential: 'client-credential-web-0123456789ab', namespace: 'web' };
const BOT = { credential: 'client-credential-bot-0123456789ab', namespace: 'bot' };
/** C1, C2 and A of round 1 with I = 120, L1 = 30, L2 = 10. */
const C1 = START_MS + 80 * S;
const C2 = START_MS + 110 * S;

interface Counting {
  readonly store: Store;
  readonly puts: () => number;
  readonly memoPuts: () => number;
  readonly failPut: (on: boolean) => void;
  readonly failMemoPut: (on: boolean) => void;
}

/** The store wrapped so that a test counts the prediction and memo writes and can make them fail. */
function counting(base: Store): Counting {
  let puts = 0;
  let memoPuts = 0;
  let failP = false;
  let failM = false;
  const store: Store = {
    ...base,
    putPrediction(matchId, playerId, prediction) {
      if (failP) throw new Error('boom');
      puts += 1;
      base.putPrediction(matchId, playerId, prediction);
    },
    memoPut(scope, requestId, entry) {
      if (failM) throw new Error('boom');
      memoPuts += 1;
      base.memoPut(scope, requestId, entry);
    },
  };
  return { store, puts: () => puts, memoPuts: () => memoPuts, failPut: (on) => (failP = on), failMemoPut: (on) => (failM = on) };
}

interface Started {
  readonly h: Harness;
  readonly c: Counting;
  readonly id: string;
  readonly hostToken: string;
}

function start(store: Store = openStore(':memory:'), scheduler = false): Started {
  const c = counting(store);
  const h = serviceHarness({ store: c.store, secret: SECRETS['ascending-00-1f'], scheduler });
  const out = h.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing: { ...CLOCK_TIMING } }) });
  if (!out.ok) throw new Error(`creation failed: ${JSON.stringify(out.error)}`);
  return { h, c, id: out.reply.matchId, hostToken: out.reply.hostToken };
}

const living = (m: Started): number[] => [...new Set(m.h.store.getMatch(m.id)!.match.state.owners.map(([, f]) => f))].sort((a, b) => a - b);
const submit = (m: Started, body: Record<string, unknown>, client = WEB): SubmitOutcome => m.h.service.submit({ client, matchId: m.id, body });
const victimBody = (faction: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ kind: 'victim', round: 1, faction, playerId: 'p1', ...extra });
const accepted = (out: SubmitOutcome) => {
  if (!out.ok) throw new Error(`refused: ${JSON.stringify(out.error)}`);
  return out.reply;
};
const own = (m: Started, namespace: string, playerId: string): OwnPredictionsOutcome => m.h.service.ownPredictions({ namespace, playerId, matchId: m.id });
const mine = (m: Started, namespace: string, playerId: string) => {
  const out = own(m, namespace, playerId);
  if (!out.ok) throw new Error(`refused: ${JSON.stringify(out.error)}`);
  return out.predictions;
};
const advance = (m: Started, round: number, step: StepKind, extra: Record<string, unknown> = {}, credential: string = OPERATOR) =>
  m.h.service.advance({ credential, matchId: m.id, body: { round, step, ...extra } });

describe('submissions are stored through the service (FR-262 to FR-267 storage part)', () => {
  it('FR-266 FR-267 an accepted victim prediction is stored under the namespaced player id before the reply, with version 1', () => {
    const m = start();
    const [a] = living(m);
    const reply = accepted(submit(m, victimBody(a!)));
    expect(reply).toStrictEqual({ kind: 'victim', round: 1, choice: a, version: 1 });
    expect(m.h.store.predictionsOf(m.id, 'web:p1')).toStrictEqual([{ kind: 'victim', round: 1, choice: a, version: 1, storedMs: START_MS }]);
    m.h.close();
  });

  it('FR-267 storage part: a failing commit gives no reply of acceptance and stores nothing, memo included', () => {
    const m = start();
    const [a] = living(m);
    m.c.failPut(true);
    expect(() => submit(m, victimBody(a!, { requestId: 'r-1' }))).toThrow('boom');
    m.c.failPut(false);
    expect(m.h.store.predictionsOf(m.id, 'web:p1')).toStrictEqual([]);
    expect(m.h.store.memoGet({ credentialDigest: credentialDigest(WEB.credential), match: m.id }, 'r-1')).toBeUndefined();
    m.h.close();
  });

  it('FR-282 (b) (c) storage part: the prediction and its memo entry are written in one transaction', () => {
    const m = start();
    const [a] = living(m);
    m.c.failMemoPut(true);
    expect(() => submit(m, victimBody(a!, { requestId: 'r-1' }))).toThrow('boom');
    m.c.failMemoPut(false);
    expect(m.h.store.predictionsOf(m.id, 'web:p1')).toStrictEqual([]);
    expect(accepted(submit(m, victimBody(a!, { requestId: 'r-1' }))).version).toBe(1);
    m.h.close();
  });

  it('FR-266 the cutoff uses the effective instant: one ms before C1 is accepted, C1 itself is prediction-closed, and a time field is refused', () => {
    const m = start();
    const [a] = living(m);
    m.h.clock.set(C1 - 1);
    expect(submit(m, victimBody(a!)).ok).toBe(true);
    m.h.clock.set(C1);
    expect(submit(m, victimBody(a!, { faction: living(m)[1] }))).toStrictEqual({ ok: false, error: errorReply('prediction-closed') });
    expect(submit(m, victimBody(a!, { time: START_MS }))).toStrictEqual({ ok: false, error: errorReply('invalid-request', ['time']) });
    expect(m.h.store.predictionsOf(m.id, 'web:p1')).toHaveLength(1);
    m.h.close();
  });

  it('FR-266 the effective instant never goes back with the clock: after a clock step the stored last step instant is the floor', () => {
    const m = start();
    m.h.clock.set(C1);
    expect(m.h.service.tick().performed).toHaveLength(1); // the phase-1 close at C1
    m.h.clock.set(START_MS); // the clock goes back before the step
    const [a] = living(m);
    accepted(submit(m, { kind: 'winner', faction: a, playerId: 'p1' }));
    expect(m.h.store.predictionsOf(m.id, 'web:p1')[0]!.storedMs).toBe(C1);
    m.h.close();
  });

  it('FR-267 a replacement increments the stored version; an equal resubmission writes nothing and keeps it', () => {
    const m = start();
    const [a, b] = living(m);
    expect(accepted(submit(m, victimBody(a!))).version).toBe(1);
    m.h.clock.advance(5 * S);
    expect(accepted(submit(m, victimBody(b!)))).toStrictEqual({ kind: 'victim', round: 1, choice: b, version: 2 });
    const writes = m.c.puts();
    m.h.clock.advance(5 * S);
    expect(accepted(submit(m, victimBody(b!)))).toStrictEqual({ kind: 'victim', round: 1, choice: b, version: 2 });
    expect(m.c.puts()).toBe(writes);
    expect(m.h.store.predictionsOf(m.id, 'web:p1')).toStrictEqual([{ kind: 'victim', round: 1, choice: b, version: 2, storedMs: START_MS + 5 * S }]);
    expect(accepted(submit(m, victimBody(a!))).version).toBe(3);
    m.h.close();
  });

  it('FR-267 FR-264 a winner prediction is stored with the number of winner candidates at its instant; a victim reveal lowers it for the next change', () => {
    const m = start();
    const all = living(m);
    expect(accepted(submit(m, { kind: 'winner', faction: all[0], playerId: 'p1' }))).toStrictEqual({ kind: 'winner', choice: all[0], version: 1 });
    expect(m.h.store.predictionsOf(m.id, 'web:p1')[0]).toMatchObject({ kind: 'winner', round: 0, winnerCandidates: all.length });
    m.h.clock.set(C1);
    m.h.service.tick();
    const revealed = m.h.store.getMatch(m.id)!.match.victim!.victim;
    expect(submit(m, { kind: 'winner', faction: revealed, playerId: 'p1' })).toStrictEqual({ ok: false, error: errorReply('invalid-choice') });
    const other = all.find((f) => f !== revealed && f !== all[0])!;
    accepted(submit(m, { kind: 'winner', faction: other, playerId: 'p1' }));
    expect(m.h.store.predictionsOf(m.id, 'web:p1')[0]).toMatchObject({ choice: other, version: 2, winnerCandidates: all.length - 1 });
    m.h.close();
  });

  it('FR-262 FR-263 FR-266 choices and stages: a victim must be living, an absorber one of the revealed victim\'s candidates and only in phase 2', () => {
    const m = start();
    const [a] = living(m);
    expect(submit(m, victimBody(9999))).toStrictEqual({ ok: false, error: errorReply('invalid-choice') });
    expect(submit(m, { kind: 'absorber', round: 1, faction: a, playerId: 'p1' })).toStrictEqual({ ok: false, error: errorReply('prediction-closed') });
    m.h.clock.set(C1);
    m.h.service.tick();
    const victim = m.h.store.getMatch(m.id)!.match.victim!;
    expect(submit(m, victimBody(a!))).toStrictEqual({ ok: false, error: errorReply('prediction-closed') });
    const outsider = living(m).find((f) => !victim.candidates.includes(f))!;
    expect(submit(m, { kind: 'absorber', round: 1, faction: outsider, playerId: 'p1' })).toStrictEqual({ ok: false, error: errorReply('invalid-choice') });
    const candidate = victim.candidates[0]!;
    expect(accepted(submit(m, { kind: 'absorber', round: 1, faction: candidate, playerId: 'p1' }))).toStrictEqual({ kind: 'absorber', round: 1, choice: candidate, version: 1 });
    m.h.clock.set(C2);
    expect(submit(m, { kind: 'absorber', round: 1, faction: candidate, playerId: 'p1' })).toStrictEqual({ ok: false, error: errorReply('prediction-closed') });
    m.h.close();
  });

  it('FR-266 a finished match refuses with match-finished and stores nothing', () => {
    const m = start();
    for (let k = 1; k <= 4; k++) for (const kind of ['phase-1-close', 'phase-2-close', 'application'] as StepKind[]) advance(m, k, kind);
    const [a] = living(m);
    expect(submit(m, { kind: 'winner', faction: a, playerId: 'p1' })).toStrictEqual({ ok: false, error: errorReply('match-finished') });
    expect(m.h.store.predictionsOf(m.id, 'web:p1')).toStrictEqual([]);
    m.h.close();
  });

  it('an unknown match is unknown-match and a malformed body is invalid-request, both before any storage', () => {
    const m = start();
    expect(m.h.service.submit({ client: WEB, matchId: 'nope', body: victimBody(1) })).toStrictEqual({ ok: false, error: errorReply('unknown-match') });
    expect(submit(m, { kind: 'victim', faction: 1, playerId: 'p1' })).toStrictEqual({ ok: false, error: errorReply('invalid-request', ['round']) });
    expect(m.c.puts()).toBe(0);
    m.h.close();
  });
});

describe('stored replies of a client request id (FR-282 (b) (c) storage part)', () => {
  const scopeOf = (m: Started, credential: string) => ({ credentialDigest: credentialDigest(credential), match: m.id });

  it('FR-282 (b) the same id and content replays the stored reply after the cutoff and writes nothing again', () => {
    const m = start();
    const [a] = living(m);
    const first = accepted(submit(m, victimBody(a!, { requestId: 'r-1' })));
    const writes = m.c.puts();
    m.h.clock.set(C1 + 5 * S);
    // The same content with the key order and the id spelled differently: still the same content.
    const again = submit(m, { requestId: 'r-1', playerId: 'p1', faction: a, round: 1, kind: 'victim' });
    expect(again).toStrictEqual({ ok: true, reply: first });
    expect(m.c.puts()).toBe(writes);
    // Without the id the same submission is processed as new and is now closed.
    expect(submit(m, victimBody(a!))).toStrictEqual({ ok: false, error: errorReply('prediction-closed') });
    m.h.close();
  });

  it('FR-282 (c) the same id with a different content is request-id-reused, and nothing is stored for it', () => {
    const m = start();
    const [a, b] = living(m);
    accepted(submit(m, victimBody(a!, { requestId: 'r-1' })));
    const writes = m.c.puts();
    expect(submit(m, victimBody(b!, { requestId: 'r-1' }))).toStrictEqual({ ok: false, error: errorReply('request-id-reused') });
    expect(submit(m, victimBody(a!, { requestId: 'r-1', playerId: 'p2' }))).toStrictEqual({ ok: false, error: errorReply('request-id-reused') });
    expect(m.c.puts()).toBe(writes);
    expect(mine(m, 'web', 'p1')[0]!.choice).toBe(a);
    m.h.close();
  });

  it('FR-282 (a) the scope is (credential digest, match): another credential or another match uses the same id as new', () => {
    const m = start();
    const other = start();
    const [a, b] = living(m);
    accepted(submit(m, victimBody(a!, { requestId: 'r-1' })));
    expect(accepted(submit(m, victimBody(b!, { requestId: 'r-1' }), BOT))).toMatchObject({ choice: b, version: 1 });
    // The id is also free in another match (a separate store, the same scope shape).
    expect(accepted(other.h.service.submit({ client: WEB, matchId: other.id, body: victimBody(b!, { requestId: 'r-1' }) })).choice).toBe(b);
    m.h.close();
    other.h.close();
  });

  it('FR-282 (c) a memoised rejection replays: prediction-closed and invalid-choice are stored, also once the state has changed', () => {
    const m = start();
    const [a] = living(m);
    expect(submit(m, victimBody(9999, { requestId: 'bad' }))).toStrictEqual({ ok: false, error: errorReply('invalid-choice') });
    m.h.clock.set(C1);
    expect(submit(m, victimBody(a!, { requestId: 'late' }))).toStrictEqual({ ok: false, error: errorReply('prediction-closed') });
    expect(m.h.store.memoGet(scopeOf(m, WEB.credential), 'bad')).toBeDefined();
    expect(m.h.store.memoGet(scopeOf(m, WEB.credential), 'late')).toBeDefined();
    // Back before the cutoff (the clock goes back, the effective instant stays at the last step: nothing changed here), so
    // the replay is what answers, not a new decision.
    m.h.clock.set(START_MS);
    expect(submit(m, victimBody(a!, { requestId: 'late' }))).toStrictEqual({ ok: false, error: errorReply('prediction-closed') });
    expect(m.c.puts()).toBe(0);
    m.h.close();
  });

  it('FR-282 (d) an invalid player id is not memoised, so the request may be retried with the same id', () => {
    const m = start();
    const [a] = living(m);
    for (const playerId of ['web:p1', 'p 1', '']) {
      expect(submit(m, victimBody(a!, { playerId, requestId: 'r-1' }))).toStrictEqual({ ok: false, error: errorReply('invalid-player-id', ['playerId']) });
    }
    expect(m.h.store.memoGet(scopeOf(m, WEB.credential), 'r-1')).toBeUndefined();
    expect(accepted(submit(m, victimBody(a!, { requestId: 'r-1' }))).version).toBe(1);
    m.h.close();
  });

  it('FR-282 (e) after the 24 h retention the id is new again', () => {
    const m = start();
    const [a, b] = living(m);
    accepted(submit(m, victimBody(a!, { requestId: 'r-1' })));
    m.h.clock.set(START_MS + MEMO_RETENTION_MS);
    expect(submit(m, victimBody(b!, { requestId: 'r-1' }))).toStrictEqual({ ok: false, error: errorReply('request-id-reused') });
    m.h.clock.set(START_MS + MEMO_RETENTION_MS + 1);
    // New: processed against the current state (the match is long past its cutoff).
    expect(submit(m, victimBody(b!, { requestId: 'r-1' }))).toStrictEqual({ ok: false, error: errorReply('prediction-closed') });
    m.h.close();
  });

  it('FR-282 (b) (c) no credential text is stored: the memo rows hold the digest scope only', () => {
    withTempDir((dir) => {
      const file = join(dir, 'm.sqlite');
      const m = start(openStore(file));
      const [a] = living(m);
      accepted(submit(m, victimBody(a!, { requestId: 'r-1' })));
      m.h.close();
      withRawDb(file, (db) => {
        const rows = db.prepare('SELECT scope FROM memo').all().map((r) => String(r.scope));
        expect(rows.some((s) => s.includes(WEB.credential))).toBe(false);
        expect(rows.some((s) => s.includes(credentialDigest(WEB.credential)))).toBe(true);
      });
    });
  });
});

describe('advance requests with a client request id (FR-282 (b) (c) storage part)', () => {
  it('FR-282 (b) a repeated advance with the same id and content replays the first reply and performs and publishes nothing', () => {
    const m = start();
    const events: number[] = [];
    m.h.service.subscribe((_, e) => events.push(e.length));
    const first = advance(m, 1, 'phase-1-close', { requestId: 'a-1' });
    expect(first.ok && first.reply.result).toBe('performed');
    const steps = m.h.store.steps(m.id).length;
    const published = events.length;
    expect(advance(m, 1, 'phase-1-close', { requestId: 'a-1' })).toStrictEqual(first);
    // Without the id the same advance is an ordinary already-performed.
    const plain = advance(m, 1, 'phase-1-close');
    expect(plain.ok && plain.reply.result).toBe('already-performed');
    expect(m.h.store.steps(m.id)).toHaveLength(steps);
    expect(events).toHaveLength(published);
    m.h.close();
  });

  it('FR-282 (c) the same id with another step is request-id-reused and performs nothing', () => {
    const m = start();
    advance(m, 1, 'phase-1-close', { requestId: 'a-1' });
    const steps = m.h.store.steps(m.id).length;
    expect(advance(m, 1, 'phase-2-close', { requestId: 'a-1' })).toStrictEqual({ ok: false, error: errorReply('request-id-reused') });
    expect(m.h.store.steps(m.id)).toHaveLength(steps);
    m.h.close();
  });

  it('FR-282 (a) (d) the scope is the presenting credential: the host token uses the same id as new, and forbidden is never memoised', () => {
    const m = start();
    advance(m, 1, 'phase-1-close', { requestId: 'a-1' });
    const host = advance(m, 1, 'phase-2-close', { requestId: 'a-1' }, m.hostToken);
    expect(host.ok && host.reply.result).toBe('performed');
    expect(advance(m, 1, 'application', { requestId: 'a-2' }, 'not-a-credential-0123456789abcdef')).toStrictEqual({ ok: false, error: errorReply('forbidden') });
    expect(m.h.store.memoGet({ credentialDigest: credentialDigest('not-a-credential-0123456789abcdef'), match: m.id }, 'a-2')).toBeUndefined();
    const retried = advance(m, 1, 'application', { requestId: 'a-2' });
    expect(retried.ok && retried.reply.result).toBe('performed');
    m.h.close();
  });

  it('FR-282 (c) a memoised step-mismatch replays', () => {
    const m = start();
    const mismatch = advance(m, 1, 'application', { requestId: 'a-1' });
    expect(mismatch.ok).toBe(false);
    advance(m, 1, 'phase-1-close');
    expect(advance(m, 1, 'application', { requestId: 'a-1' })).toStrictEqual(mismatch);
    m.h.close();
  });
});

describe('own predictions (FR-270 storage part)', () => {
  it('FR-270 a client reads only the predictions of its own namespaced player id, never another namespace\'s or another player\'s', () => {
    const m = start();
    const [a, b, c] = living(m);
    accepted(submit(m, victimBody(a!)));
    accepted(submit(m, { kind: 'winner', faction: c, playerId: 'p1' }));
    accepted(submit(m, victimBody(b!, { playerId: 'p2' })));
    accepted(submit(m, victimBody(c!), BOT));
    expect(mine(m, 'web', 'p1')).toStrictEqual([
      { kind: 'victim', round: 1, choice: a, version: 1 },
      { kind: 'winner', choice: c, version: 1 },
    ]);
    expect(mine(m, 'web', 'p2')).toStrictEqual([{ kind: 'victim', round: 1, choice: b, version: 1 }]);
    expect(mine(m, 'bot', 'p1')).toStrictEqual([{ kind: 'victim', round: 1, choice: c, version: 1 }]);
    expect(mine(m, 'other', 'p1')).toStrictEqual([]);
    m.h.close();
  });

  it('FR-270 an invalid local id is invalid-player-id (a namespace cannot be sent) and an unknown match is unknown-match', () => {
    const m = start();
    expect(own(m, 'web', 'bot:p1')).toStrictEqual({ ok: false, error: errorReply('invalid-player-id', ['playerId']) });
    expect(m.h.service.ownPredictions({ namespace: 'web', playerId: 'p1', matchId: 'nope' })).toStrictEqual({ ok: false, error: errorReply('unknown-match') });
    m.h.close();
  });

  it('FR-270 own predictions stay readable after the match finished and show the stored choices and versions', () => {
    const m = start();
    const [a, b] = living(m);
    accepted(submit(m, victimBody(a!)));
    accepted(submit(m, victimBody(b!)));
    for (let k = 1; k <= 4; k++) for (const kind of ['phase-1-close', 'phase-2-close', 'application'] as StepKind[]) advance(m, k, kind);
    expect(mine(m, 'web', 'p1')).toStrictEqual([{ kind: 'victim', round: 1, choice: b, version: 2 }]);
    m.h.close();
  });
});

describe('no result rows for an empty phase (FR-269 results-empty part) and what the predictions rows hold', () => {
  it('FR-269 a match with no prediction at all runs to the end as scheduled and leaves no prediction and no result row', () => {
    withTempDir((dir) => {
      const file = join(dir, 'm.sqlite');
      const m = start(openStore(file), true);
      m.h.scheduler!.runTo(START_MS + 4 * 120 * S + 5);
      expect(m.h.store.getMatch(m.id)!.match.stage).toBe('finished');
      expect(m.h.store.steps(m.id)).toHaveLength(12);
      m.h.close();
      withRawDb(file, (db) => {
        expect(Number(db.prepare('SELECT COUNT(*) AS n FROM results').get()!.n)).toBe(0);
        expect(Number(db.prepare('SELECT COUNT(*) AS n FROM predictions').get()!.n)).toBe(0);
      });
    });
  });

  it('FR-269 a prediction for one phase only still leaves the other phases and the results table empty', () => {
    withTempDir((dir) => {
      const file = join(dir, 'm.sqlite');
      const m = start(openStore(file), true);
      const [a] = living(m);
      accepted(submit(m, victimBody(a!)));
      m.h.scheduler!.runTo(START_MS + 4 * 120 * S + 5);
      expect(m.h.store.getMatch(m.id)!.match.stage).toBe('finished');
      m.h.close();
      withRawDb(file, (db) => {
        expect(Number(db.prepare('SELECT COUNT(*) AS n FROM results').get()!.n)).toBe(0);
        expect(Number(db.prepare('SELECT COUNT(*) AS n FROM predictions').get()!.n)).toBe(1);
      });
    });
  });

  it('FR-265 FR-267 the predictions rows hold only the choice, its version and instant: no absorber and no pending state', () => {
    withTempDir((dir) => {
      const file = join(dir, 'm.sqlite');
      const m = start(openStore(file));
      const [a] = living(m);
      accepted(submit(m, victimBody(a!)));
      m.h.clock.set(C1);
      m.h.service.tick();
      const candidate = m.h.store.getMatch(m.id)!.match.victim!.candidates[0]!;
      accepted(submit(m, { kind: 'absorber', round: 1, faction: candidate, playerId: 'p1' }));
      m.h.close();
      withRawDb(file, (db) => {
        expect(listColumns(db).predictions).toStrictEqual(['match_id', 'player_id', 'kind', 'round', 'choice', 'version', 'stored_ms', 'winner_candidates']);
        const rows = db.prepare('SELECT kind, round, choice, version FROM predictions ORDER BY kind').all().map((r) => [String(r.kind), Number(r.round), Number(r.choice), Number(r.version)]);
        expect(rows).toStrictEqual([
          ['absorber', 1, candidate, 1],
          ['victim', 1, a, 1],
        ]);
      });
    });
  });
});
