import { join } from 'node:path';
import type { MatchEvent } from '@mbrg/protocol';
import { errorReply } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { MEMO_RETENTION_MS } from '../src/core/memo';
import { credentialDigest } from '../src/service/ids';
import type { MatchService } from '../src/service/matches';
import { InjectedFault, withFaults } from '../src/store/faults';
import type { FaultPlan } from '../src/store/faults';
import { openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';
import { playerEventViolations, playerTokenPlaces, withRawDb } from './helpers/db-scan';
import { lobbyServiceWith } from './helpers/durability-script';
import { fakeClock } from './helpers/fake-clock';
import { fakeRandom } from './helpers/fake-random';
import { START_MS, creationBody, withTempDir } from './helpers/service-harness';

// Kills and restarts around the join (spec 011 M3 T9). A script on a database FILE (public creation, three joins by name, a
// replayed join, a refused name, the start and a join in the running match) is killed by the fault seam before every
// transaction and inside it after every write; a new store and service open on the same file, `start()` runs and the action in
// flight is sent again. A join draws its ids and token from a random source that goes on across the restart, so the
// restarted run is compared with the uninterrupted one by what a player is (name, join order, event), not by the bytes of the
// ids. Every point must leave no player without its event and no event without its player.

const WRITES = new Set(['insertMatch', 'updateMatch', 'insertLobby', 'markStarted', 'markExpired', 'insertPlayer', 'appendEvents', 'memoPut', 'memoPurge']);

interface Joined {
  playerId: string;
  playerToken: string;
}

interface Box {
  matchId?: string;
  hostToken?: string;
  /** The last successful reply of each join, by name. */
  joined: Map<string, Joined>;
}

interface Action {
  readonly label: string;
  readonly at: number;
  readonly run: (service: MatchService, box: Box) => unknown;
}

const joinAction = (label: string, at: number, source: string, name: string, requestId: string): Action => ({
  label,
  at,
  run: (s, box) => {
    const out = s.join({ source, matchId: box.matchId!, body: { name, requestId } });
    if (out.ok) box.joined.set(name, { playerId: out.reply.playerId, playerToken: out.reply.playerToken });
    return out;
  },
});

/** Built anew for every run. The replay and the refusal write nothing. */
const script = (): Action[] => [
  {
    label: 'create',
    at: START_MS,
    run: (s, box) => {
      const out = s.createPublic({ source: 'src-host', body: creationBody('c-1') });
      if (out.ok) {
        box.matchId = out.reply.matchId;
        box.hostToken = out.reply.hostToken;
      }
      return out;
    },
  },
  joinAction('join Ana', START_MS + 1_000, 'src-a', 'Ana', 'j-ana'),
  joinAction('join Bea', START_MS + 2_000, 'src-b', 'Bea', 'j-bea'),
  joinAction('replay of Ana', START_MS + 3_000, 'src-a', 'Ana', 'j-ana'),
  joinAction('Ana again under another request', START_MS + 3_500, 'src-c', ' ANA ', 'j-other'),
  { label: 'start', at: START_MS + 4_000, run: (s, box) => s.startMatch({ credential: box.hostToken, matchId: box.matchId!, body: { requestId: 'st-1' } }) },
  joinAction('join Cy in the running match', START_MS + 5_000, 'src-d', 'Cy', 'j-cy'),
];

interface Tx {
  readonly action: number;
  readonly writes: string[];
}

interface Run {
  readonly replies: string[];
  readonly published: string[];
  readonly txs: Tx[];
  readonly killedAction: number | undefined;
  readonly afterKill: string[];
  readonly shape: string;
  readonly tokensFound: boolean[];
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

/** What the database says about the players and their events, without the bytes of the ids and tokens. */
const shapeOf = (file: string): string =>
  withRawDb(file, (db) =>
    JSON.stringify({
      players: db.prepare('SELECT name, name_key, joined_seq, joined_ms FROM players ORDER BY joined_seq').all().map((p) => [p.name, p.name_key, p.joined_seq, p.joined_ms]),
      events: db.prepare('SELECT seq, type, payload_json FROM events ORDER BY seq').all().map((e) => {
        const payload = JSON.parse(String(e.payload_json)) as Record<string, unknown>;
        return [e.seq, e.type, e.type === 'player-joined' ? payload.name : payload.stage ?? null];
      }),
      stage: db.prepare('SELECT stage FROM matches').all().map((m) => m.stage),
    }),
  );

function runScript(file: string, plan: FaultPlan = {}): Run {
  const actions = script();
  const box: Box = { joined: new Map() };
  const clock = fakeClock(START_MS);
  const random = fakeRandom(5);
  const state = { txs: [] as Tx[], action: 0, killed: false };
  const published: string[] = [];
  const listen = (service: MatchService): MatchService => (service.subscribe((_, events: readonly MatchEvent[]) => published.push(...events.map((e) => JSON.stringify({ ...e, playerId: e.type === 'player-joined' ? 'id' : undefined })))), service);
  let service = listen(lobbyServiceWith(traced(withFaults(openStore(file), plan), state), clock, file, random));
  const replies: string[] = [];
  let killedAction: number | undefined;
  let afterKill: string[] = [];
  /** A reply without the bytes of ids and tokens. */
  const plain = (reply: unknown): string =>
    JSON.stringify(reply, (key, value: unknown) => (key === 'playerId' || key === 'playerToken' || key === 'matchId' || key === 'hostToken' || key === 'commitment' ? 'x' : value));
  try {
    actions.forEach((action, i) => {
      state.action = i;
      clock.set(action.at);
      let reply = action.run(service, box);
      if (state.killed && killedAction === undefined) {
        // The killed server sends nothing more; a new one starts on the same file and the client asks again.
        service.close();
        afterKill = withRawDb(file, playerEventViolations);
        service = listen(lobbyServiceWith(openStore(file), clock, file, random));
        killedAction = i;
        service.start();
        reply = action.run(service, box);
      }
      replies.push(plain(reply));
    });
    // Every token of the final replies finds its player on the live service.
    const tokensFound = [...box.joined.values()].map((j) => {
      const found = service.playerTokenOf(box.matchId!, j.playerToken);
      return found.ok && found.reply?.playerId === j.playerId;
    });
    service.close();
    return { replies, published, txs: state.txs, killedAction, afterKill, shape: shapeOf(file), tokensFound };
  } finally {
    service.close();
  }
}

describe('kills inside and between the transactions of the join', () => {
  it('a kill before every transaction and inside it after every write leaves no player without its event and no event without its player, and the restarted server reaches the uninterrupted run', () => {
    withTempDir((dir) => {
      const reference = runScript(join(dir, 'reference.sqlite'));
      expect(reference.killedAction).toBeUndefined();
      expect(withRawDb(join(dir, 'reference.sqlite'), playerEventViolations)).toStrictEqual([]);
      expect(reference.tokensFound).toStrictEqual([true, true, true]);
      const joinTxs = reference.txs.filter((t) => t.writes.includes('insertPlayer'));
      expect(joinTxs).toHaveLength(3);
      // The player is written before its event, then the lobby row, then the memo of the reply: one transaction.
      for (const tx of joinTxs) expect(tx.writes).toStrictEqual(['insertPlayer', 'appendEvents', 'updateMatch', 'memoPut']);
      const check = (killed: Run, where: string): void => {
        expect(killed.killedAction, `${where}: the seam killed the server`).toBeDefined();
        expect(killed.afterKill, `${where}: the database the kill left`).toStrictEqual([]);
        expect(killed.replies, `${where}: replies`).toStrictEqual(reference.replies);
        expect(killed.published, `${where}: published events`).toStrictEqual(reference.published);
        expect(killed.shape, `${where}: players and events at the end`).toBe(reference.shape);
        expect(killed.tokensFound, `${where}: the tokens of the final replies`).toStrictEqual([true, true, true]);
      };
      let points = 0;
      reference.txs.forEach((tx, i) => {
        const n = i + 1;
        check(runScript(join(dir, `before-${n}.sqlite`), { abortTransaction: n }), `kill before transaction ${n}`);
        for (let w = 0; w <= tx.writes.length; w++) {
          check(runScript(join(dir, `inside-${n}-${w}.sqlite`), { abortWrite: { transaction: n, afterWrites: w } }), `kill inside transaction ${n} after ${w} writes (${tx.writes.join(', ')})`);
          points += 1;
        }
      });
      expect(points).toBeGreaterThan(10);
    });
  }, 240_000);

  it('a join killed inside its transaction leaves the lobby as it was and the same request is a first join afterwards', () => {
    withTempDir((dir) => {
      const reference = runScript(join(dir, 'reference.sqlite'));
      const joinTx = reference.txs.findIndex((t) => t.action === 1 && t.writes.includes('insertPlayer'));
      expect(joinTx).toBeGreaterThanOrEqual(0);
      const killed = runScript(join(dir, 'inside.sqlite'), { abortWrite: { transaction: joinTx + 1, afterWrites: 3 } });
      expect(killed.killedAction).toBe(1);
      expect(killed.afterKill).toStrictEqual([]);
      expect(withRawDb(join(dir, 'inside.sqlite'), (db) => db.prepare('SELECT COUNT(*) AS n FROM players').get()!.n)).toBe(3);
    });
  });
});

describe('restart of a lobby and of a running match with players', () => {
  const settle = (): { random: ReturnType<typeof fakeRandom>; clock: ReturnType<typeof fakeClock> } => ({ random: fakeRandom(9), clock: fakeClock(START_MS) });

  it('a restart in the lobby keeps the players, their names, join order and tokens, and a name stays taken', () => {
    withTempDir((dir) => {
      const file = join(dir, 'lobby.sqlite');
      const { random, clock } = settle();
      const first = lobbyServiceWith(openStore(file), clock, file, random);
      const made = first.createPublic({ source: 'src-host', body: creationBody('c-1') });
      if (!made.ok) throw new Error('creation failed');
      const { matchId } = made.reply;
      clock.set(START_MS + 1_000);
      const ana = first.join({ source: 'src-a', matchId, body: { name: 'Ana', requestId: 'j-1' } });
      clock.set(START_MS + 2_000);
      const bea = first.join({ source: 'src-b', matchId, body: { name: 'Bea', requestId: 'j-2' } });
      if (!ana.ok || !bea.ok) throw new Error('join failed');
      const before = first.players(matchId, { limit: 500 });
      first.close();

      clock.set(START_MS + 60_000);
      const again = lobbyServiceWith(openStore(file), clock, file, random);
      try {
        expect(again.start().failed).toStrictEqual([]);
        expect(again.players(matchId, { limit: 500 })).toStrictEqual(before);
        expect(before).toMatchObject({ ok: true, reply: { items: [{ playerId: ana.reply.playerId, name: 'Ana', joinedSeq: 2 }, { playerId: bea.reply.playerId, name: 'Bea', joinedSeq: 3 }] } });
        expect(again.playerTokenOf(matchId, ana.reply.playerToken)).toStrictEqual({ ok: true, reply: { playerId: ana.reply.playerId } });
        expect(again.playerTokenOf(matchId, bea.reply.playerToken)).toStrictEqual({ ok: true, reply: { playerId: bea.reply.playerId } });
        expect(again.publicMatch(matchId)).toMatchObject({ stage: 'lobby', lastSeq: 3, playerCount: 2 });
        // The same name is still taken, the replay of a join still answers with its first reply, and the next join continues the order.
        expect(again.join({ source: 'src-z', matchId, body: { name: 'ana', requestId: 'j-x' } })).toStrictEqual({ ok: false, error: errorReply('name-taken') });
        expect(again.join({ source: 'src-a', matchId, body: { name: 'Ana', requestId: 'j-1' } })).toStrictEqual(ana);
        const cy = again.join({ source: 'src-c', matchId, body: { name: 'Cy', requestId: 'j-3' } });
        expect(cy.ok && cy.reply.match).toMatchObject({ playerCount: 3, lastSeq: 4 });
        expect(again.eventsAfter(matchId, 1).ok).toBe(true);
      } finally {
        again.close();
      }
    });
  });

  it('a restart in the running match keeps the tokens valid for predictions, and 24 h later the memo is gone while the players and their tokens stay', () => {
    withTempDir((dir) => {
      const file = join(dir, 'running.sqlite');
      const { random, clock } = settle();
      const first = lobbyServiceWith(openStore(file), clock, file, random);
      const made = first.createPublic({ source: 'src-host', body: creationBody('c-1') });
      if (!made.ok) throw new Error('creation failed');
      const { matchId, hostToken } = made.reply;
      clock.set(START_MS + 1_000);
      const ana = first.join({ source: 'src-a', matchId, body: { name: 'Ana', requestId: 'j-1' } });
      if (!ana.ok) throw new Error('join failed');
      clock.set(START_MS + 2_000);
      expect(first.startMatch({ credential: hostToken, matchId, body: {} }).ok).toBe(true);
      first.close();

      clock.set(START_MS + 10_000);
      const second = lobbyServiceWith(openStore(file), clock, file, random);
      const local = ana.reply.playerId.slice('player:'.length);
      try {
        second.start();
        const found = second.playerTokenOf(matchId, ana.reply.playerToken);
        expect(found).toStrictEqual({ ok: true, reply: { playerId: ana.reply.playerId } });
        const shown = second.publicMatch(matchId)!;
        const living = [...new Set(shown.state.owners.map(([, f]) => f))].sort((a, b) => a - b);
        // A caller built the way the identity does: the digest of the token and the id the lookup answered.
        const caller = { tokenDigest: credentialDigest(ana.reply.playerToken), playerId: ana.reply.playerId };
        const out = second.submit({ client: caller, matchId, body: { kind: 'winner', faction: living[0], playerId: local } });
        expect(out.ok).toBe(true);
      } finally {
        second.close();
      }

      clock.set(START_MS + MEMO_RETENTION_MS + 3_600_000);
      const third = lobbyServiceWith(openStore(file), clock, file, random);
      try {
        third.start();
        expect(third.playerTokenOf(matchId, ana.reply.playerToken)).toStrictEqual({ ok: true, reply: { playerId: ana.reply.playerId } });
        // The reply of the join is no longer replayed: the same request is a new join and the name is taken.
        expect(third.join({ source: 'src-a', matchId, body: { name: 'Ana', requestId: 'j-1' } })).toStrictEqual({ ok: false, error: errorReply('name-taken') });
      } finally {
        third.close();
      }
      withRawDb(file, (db) => {
        expect(db.prepare('SELECT COUNT(*) AS n FROM memo').get()!.n).toBe(0);
        expect(db.prepare('SELECT COUNT(*) AS n FROM players').get()!.n).toBe(1);
        expect(playerTokenPlaces(db, [ana.reply.playerToken, hostToken], false)).toStrictEqual([]);
        expect(playerEventViolations(db)).toStrictEqual([]);
      });
    });
  });
});
