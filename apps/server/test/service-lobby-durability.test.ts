import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { MatchEvent } from '@mbrg/protocol';
import { errorReply } from '@mbrg/protocol';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { roundSeed } from '../src/secret';
import type { MatchService } from '../src/service/matches';
import { InjectedFault, withFaults } from '../src/store/faults';
import type { FaultPlan } from '../src/store/faults';
import { openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';
import { absorberColumnsOutsideRecords, credentialTextColumns, dumpRows, encodingsOf, listColumns, pendingStateColumns, rowsBeyondApplied, scanValues, storedFutureViolations, withRawDb } from './helpers/db-scan';
import { lobbyServiceOn } from './helpers/durability-script';
import { fakeClock } from './helpers/fake-clock';
import { START_MS, creationBody, serviceHarness, withTempDir } from './helpers/service-harness';

// Kills inside and between the transactions of public creation, start and expiry (spec 011 M2 T9). Each scenario is a short
// script on a database FILE with a 1 h lobby expiry. The fault seam kills the first server before transaction n or inside it
// after w writes; a new store and service open on the same file, `start()` runs, the action in flight is sent again and the
// script goes on. Every point must leave a database where a lobby has its event, a start has its schedule event and an expiry
// is complete, and the restarted run must end with the raw database, the replies and the published events of the
// uninterrupted run.

const HOUR = 3_600_000;
const WRITES = new Set(['insertMatch', 'updateMatch', 'insertLobby', 'markStarted', 'markExpired', 'appendEvents', 'memoPut', 'memoPurge']);

interface Action {
  readonly label: string;
  readonly at: number;
  readonly run: (service: MatchService) => unknown;
}

/** A scenario builds its actions anew for every run (they share the ids of the earlier replies). */
const scenarios: Record<string, () => Action[]> = {
  creation: () => [{ label: 'create', at: START_MS, run: (s) => s.createPublic({ source: 'src-a', body: creationBody('c-1') }) }],
  start: () => {
    const box: { id?: string; token?: string } = {};
    return [
      {
        label: 'create',
        at: START_MS,
        run: (s) => {
          const out = s.createPublic({ source: 'src-a', body: creationBody('c-1') });
          if (out.ok) {
            box.id = out.reply.matchId;
            box.token = out.reply.hostToken;
          }
          return out;
        },
      },
      { label: 'start', at: START_MS + 4_321, run: (s) => s.startMatch({ credential: box.token, matchId: box.id!, body: { requestId: 'st-1' } }) },
      { label: 'tick at the first anchor', at: START_MS + 4_321 + 80_000, run: (s) => s.tick() },
    ];
  },
  expiry: () => [
    { label: 'create', at: START_MS, run: (s) => s.createPublic({ source: 'src-a', body: creationBody('c-1') }) },
    { label: 'tick at the expiry', at: START_MS + HOUR, run: (s) => s.tick() },
  ],
};

interface Tx {
  readonly action: number;
  readonly writes: string[];
}

interface Run {
  readonly replies: string[];
  readonly published: MatchEvent[];
  readonly txs: Tx[];
  readonly killedAction: number | undefined;
  readonly afterKill: string | undefined;
  readonly violations: string[];
  readonly dump: string;
}

/** What a partial decision would break in a lobby database (one violation per readable text). */
function lobbyViolations(db: DatabaseSync): string[] {
  const out: string[] = [];
  for (const m of db.prepare('SELECT id, stage FROM matches ORDER BY rowid').all()) {
    const id = String(m.id);
    const stage = String(m.stage);
    const lobby = db.prepare('SELECT started_ms, expired_ms FROM lobbies WHERE match_id = ?').get(id);
    const events = db.prepare('SELECT seq, payload_json FROM events WHERE match_id = ? ORDER BY seq').all(id);
    const stages = events.map((e) => (JSON.parse(String(e.payload_json)) as { stage?: string }).stage);
    if (events.some((e, i) => Number(e.seq) !== i + 1)) out.push(`${id}: event numbers have a gap`);
    if (lobby === undefined) {
      out.push(`${id}: a public match without its lobby row`);
      continue;
    }
    if (stages[0] !== 'lobby') out.push(`${id}: the first event is ${String(stages[0])}, not the lobby schedule`);
    const started = lobby.started_ms !== null;
    const expired = lobby.expired_ms !== null;
    if (stage === 'lobby' && (started || expired || events.length !== 1)) out.push(`${id}: a lobby with a mark or ${events.length} events`);
    if (stage === 'expired' && (!expired || started || stages[events.length - 1] !== 'expired' || events.length !== 2)) out.push(`${id}: an expired match without its mark or its event`);
    if (stage !== 'lobby' && stage !== 'expired' && (!started || expired || stages[1] !== 'phase-1')) out.push(`${id}: a started match without its mark or its schedule event`);
    if ((stage === 'lobby' || stage === 'expired') && started) out.push(`${id}: started mark in stage ${stage}`);
  }
  return out;
}

/** Records the transactions and writes of the first server, and whether the seam killed it. */
function traced(inner: Store, state: { txs: Tx[]; action: number; killed: boolean }): Store {
  return new Proxy(inner, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (key === 'transaction') {
        return <T>(fn: () => T): T => {
          state.txs.push({ action: state.action, writes: [] });
          try {
            return target.transaction(fn);
          } catch (error) {
            if (error instanceof InjectedFault && (error.kind === 'abort' || error.kind === 'abort-inside')) state.killed = true;
            throw error;
          }
        };
      }
      if (typeof key === 'string' && WRITES.has(key) && typeof value === 'function') {
        return (...args: unknown[]): unknown => {
          state.txs[state.txs.length - 1]?.writes.push(key);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return value;
    },
  });
}

function runScenario(name: string, file: string, plan: FaultPlan = {}): Run {
  const actions = scenarios[name]!();
  const clock = fakeClock(START_MS);
  const state = { txs: [] as Tx[], action: 0, killed: false };
  const published: MatchEvent[] = [];
  const listen = (service: MatchService): MatchService => (service.subscribe((_, events) => published.push(...events)), service);
  let service = listen(lobbyServiceOn(traced(withFaults(openStore(file), plan), state), clock, file));
  const replies: string[] = [];
  let killedAction: number | undefined;
  let afterKill: string | undefined;
  let violations: string[] = [];
  try {
    actions.forEach((action, i) => {
      state.action = i;
      clock.set(action.at);
      let reply = action.run(service);
      if (state.killed && killedAction === undefined) {
        // The killed server sends nothing more; a new one starts on the same file and the client asks again.
        service.close();
        afterKill = withRawDb(file, dumpRows);
        violations = withRawDb(file, lobbyViolations);
        service = listen(lobbyServiceOn(openStore(file), clock, file));
        killedAction = i;
        service.start();
        reply = action.run(service);
      }
      // A tick report depends on what the restart already performed (as in 008), so only the commands' replies are compared.
      replies.push(action.label.startsWith('tick') ? 'tick' : JSON.stringify(reply));
    });
    service.close();
    return { replies, published, txs: state.txs, killedAction, afterKill, violations, dump: withRawDb(file, dumpRows) };
  } finally {
    service.close();
  }
}

describe('kills inside and between the transactions of public creation, start and expiry', () => {
  for (const name of Object.keys(scenarios)) {
    it(`the ${name} script: a kill before every transaction and inside it after every write leaves a complete lobby database and the restarted server reaches the uninterrupted run`, () => {
      withTempDir((dir) => {
        const reference = runScenario(name, join(dir, 'reference.sqlite'));
        expect(reference.killedAction).toBeUndefined();
        expect(withRawDb(join(dir, 'reference.sqlite'), lobbyViolations)).toStrictEqual([]);
        const writes = reference.txs.flatMap((t) => t.writes);
        if (name !== 'creation') expect(writes).toContain(name === 'start' ? 'markStarted' : 'markExpired');
        expect(writes).toContain('insertLobby');
        expect(reference.txs.length).toBeGreaterThan(0);
        const check = (killed: Run, where: string): void => {
          expect(killed.killedAction, `${where}: the seam killed the server`).toBeDefined();
          expect(killed.violations, `${where}: the database the kill left`).toStrictEqual([]);
          expect(killed.replies, `${where}: replies`).toStrictEqual(reference.replies);
          expect(killed.published, `${where}: published events`).toStrictEqual(reference.published);
          expect(killed.dump === reference.dump, `${where}: the raw database at the end`).toBe(true);
        };
        let points = 0;
        reference.txs.forEach((tx, i) => {
          const n = i + 1;
          check(runScenario(name, join(dir, `before-${n}.sqlite`), { abortTransaction: n }), `kill before transaction ${n}`);
          for (let w = 0; w <= tx.writes.length; w++) {
            const killed = runScenario(name, join(dir, `inside-${n}-${w}.sqlite`), { abortWrite: { transaction: n, afterWrites: w } });
            check(killed, `kill inside transaction ${n} after ${w} writes (${tx.writes.join(', ')})`);
            points += 1;
          }
        });
        expect(points).toBeGreaterThan(0);
      });
    }, 120_000);
  }

  it('a kill inside the start leaves the lobby a lobby: the database equals the one before the start and the same request id then starts it', () => {
    withTempDir((dir) => {
      const reference = runScenario('start', join(dir, 'reference.sqlite'));
      const startTx = reference.txs.findIndex((t) => t.action === 1 && t.writes.includes('markStarted'));
      expect(startTx).toBeGreaterThanOrEqual(0);
      const before = runScenario('start', join(dir, 'before.sqlite'), { abortTransaction: startTx + 1 });
      const inside = runScenario('start', join(dir, 'inside.sqlite'), { abortWrite: { transaction: startTx + 1, afterWrites: reference.txs[startTx]!.writes.length - 1 } });
      expect(inside.afterKill === before.afterKill).toBe(true);
      expect(inside.violations).toStrictEqual([]);
    });
  });
});

describe('restart of a lobby in each of its states', () => {
  const reopen = (file: string, at: number): { service: MatchService; close: () => void } => {
    const service = lobbyServiceOn(openStore(file), fakeClock(at), file);
    return { service, close: () => service.close() };
  };
  const firstServer = (file: string, work: (service: MatchService, clock: ReturnType<typeof fakeClock>) => void): void => {
    const clock = fakeClock(START_MS);
    const service = lobbyServiceOn(openStore(file), clock, file);
    try {
      work(service, clock);
    } finally {
      service.close();
    }
  };
  const lobby = (service: MatchService): { matchId: string; hostToken: string } => {
    const out = service.createPublic({ source: 'src-a', body: creationBody('c-1') });
    if (!out.ok) throw new Error('creation failed');
    return out.reply;
  };

  it('a lobby is still a lobby after a restart and starts with its host token', () => {
    withTempDir((dir) => {
      const file = join(dir, 'lobby.sqlite');
      let made = { matchId: '', hostToken: '' };
      firstServer(file, (s) => (made = lobby(s)));
      const again = reopen(file, START_MS + 10_000);
      try {
        expect(again.service.start().failed).toStrictEqual([]);
        expect(again.service.publicMatch(made.matchId)).toMatchObject({ stage: 'lobby', lastSeq: 1, playerCount: 0 });
        const out = again.service.startMatch({ credential: made.hostToken, matchId: made.matchId, body: {} });
        expect(out.ok && out.reply.match.stage).toBe('phase-1');
      } finally {
        again.close();
      }
    });
  });

  it('a started match is not a lobby after a restart: it is not expired by the old expiry and the restart catches up its due step', () => {
    withTempDir((dir) => {
      const file = join(dir, 'started.sqlite');
      let made = { matchId: '', hostToken: '' };
      let schedule: unknown;
      firstServer(file, (s, clock) => {
        made = lobby(s);
        clock.set(START_MS + 5_000);
        const out = s.startMatch({ credential: made.hostToken, matchId: made.matchId, body: {} });
        schedule = out.ok ? out.reply.match.schedule : undefined;
      });
      expect(schedule).toStrictEqual({ c1: START_MS + 5_000 + 80_000, c2: START_MS + 5_000 + 110_000, a: START_MS + 5_000 + 120_000 });
      // The restart comes after the 1 h expiry of the creation: the started match is not expired; its overdue steps are caught up.
      const again = reopen(file, START_MS + HOUR + 1);
      try {
        expect(again.service.start().failed).toStrictEqual([]);
        const shown = again.service.publicMatch(made.matchId)!;
        expect(['lobby', 'expired']).not.toContain(shown.stage);
        expect(shown.lastSeq).toBeGreaterThan(2);
        expect(again.service.startMatch({ credential: made.hostToken, matchId: made.matchId, body: {} })).toStrictEqual({ ok: false, error: errorReply('match-started') });
      } finally {
        again.close();
      }
    });
  });

  it('an expired lobby is still expired after a restart and refuses a start', () => {
    withTempDir((dir) => {
      const file = join(dir, 'expired.sqlite');
      let made = { matchId: '', hostToken: '' };
      firstServer(file, (s, clock) => {
        made = lobby(s);
        clock.set(START_MS + HOUR);
        s.tick();
        expect(s.publicMatch(made.matchId)?.stage).toBe('expired');
      });
      const again = reopen(file, START_MS + HOUR + 10);
      try {
        again.service.start();
        expect(again.service.publicMatch(made.matchId)).toMatchObject({ stage: 'expired', lastSeq: 2 });
        expect(again.service.startMatch({ credential: made.hostToken, matchId: made.matchId, body: {} })).toStrictEqual({ ok: false, error: errorReply('match-expired') });
      } finally {
        again.close();
      }
    });
  });
});

describe('twin lobbies and the secrecy of a lobby', () => {
  const twinFlow = (file: string, seeds: readonly number[]): { texts: string[]; dumps: string[] } => {
    const h = serviceHarness({ store: openStore(file), publicCreation: { maps: ['dev'] }, testSeedSource: () => (k) => seeds[k - 1] ?? 0 });
    const texts: string[] = [];
    const dumps: string[] = [];
    h.service.subscribe((_, events) => texts.push(JSON.stringify(events)));
    try {
      const out = h.service.createPublic({ source: 'src-a', body: creationBody('c-1') });
      if (!out.ok) throw new Error('creation failed');
      texts.push(JSON.stringify(out), JSON.stringify(h.service.publicMatch(out.reply.matchId)), JSON.stringify(h.store.eventsAfter(out.reply.matchId, 0)));
      h.clock.advance(2_000);
      const started = h.service.startMatch({ credential: out.reply.hostToken, matchId: out.reply.matchId, body: {} });
      texts.push(JSON.stringify(started), JSON.stringify(h.service.publicMatch(out.reply.matchId)), JSON.stringify(h.store.eventsAfter(out.reply.matchId, 0)));
      return { texts, dumps };
    } finally {
      h.close();
      dumps.push(withRawDb(file, dumpRows));
    }
  };

  it('twin lobbies with the same public data and different round seeds give identical replies, events and stored rows through the creation and the start', () => {
    withTempDir((dir) => {
      const a = twinFlow(join(dir, 'a.sqlite'), [11, 22, 33, 44]);
      const b = twinFlow(join(dir, 'b.sqlite'), [987_654_321, 123_456_789, 55, 66]);
      expect(a.texts).toHaveLength(8);
      expect(b.texts).toStrictEqual(a.texts);
      expect(b.dumps).toStrictEqual(a.dumps);
    });
  });

  it('a planted secret and its round seeds are in no reply, event or row of a lobby or of a match just started, apart from the secret column', () => {
    withTempDir((dir) => {
      const file = join(dir, 'planted.sqlite');
      const secret = Uint8Array.from(createHash('sha256').update('mbrg/spec-011/m2-t9/planted').digest());
      const h = serviceHarness({ store: openStore(file), publicCreation: { maps: ['dev'] }, secret });
      const seen: string[] = [];
      h.service.subscribe((_, events) => seen.push(JSON.stringify(events)));
      let matchId = '';
      try {
        const out = h.service.createPublic({ source: 'src-a', body: creationBody('c-1') });
        if (!out.ok) throw new Error('creation failed');
        matchId = out.reply.matchId;
        seen.push(JSON.stringify(out), JSON.stringify(h.service.publicMatch(matchId)), JSON.stringify(h.store.eventsAfter(matchId, 0)));

        h.clock.advance(1_000);
        const started = h.service.startMatch({ credential: out.reply.hostToken, matchId, body: {} });
        expect(started.ok).toBe(true);
        seen.push(JSON.stringify(started), JSON.stringify(h.service.publicMatch(matchId)), JSON.stringify(h.store.eventsAfter(matchId, 0)));
      } finally {
        h.close();
      }
      const markers = [secret, ...[1, 2, 3, 4].map((k) => roundSeed(secret, k))].flatMap((v) => encodingsOf(v));
      // The texts the server gave out hold none of them.
      const text = seen.join('\n');
      for (const marker of markers) if (typeof marker === 'string') expect(text.includes(marker), `the replies and events hold ${marker.slice(0, 12)}`).toBe(false);
      withRawDb(file, (db) => {
        expect(scanValues(db, markers, ['matches.secret'])).toStrictEqual([]);
        expect(scanValues(db, encodingsOf(secret), [])).toStrictEqual(['matches.secret']);
        const columns = listColumns(db);
        expect([...absorberColumnsOutsideRecords(columns), ...pendingStateColumns(columns), ...credentialTextColumns(columns)]).toStrictEqual([]);
        expect(rowsBeyondApplied(db)).toStrictEqual([]);
        expect(storedFutureViolations(db)).toStrictEqual([]);
      });
    });
  });
});
