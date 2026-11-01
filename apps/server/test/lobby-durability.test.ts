import { join } from 'node:path';
import type { MatchEvent } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { credentialDigest } from '../src/service/ids';
import { createMapCatalog } from '../src/service/maps';
import { createMatchService } from '../src/service/matches';
import type { MatchService } from '../src/service/matches';
import { InjectedFault, withFaults } from '../src/store/faults';
import type { FaultPlan } from '../src/store/faults';
import { openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';
import { dumpRows, playerEventViolations, playerTokenPlaces, storedFutureViolations, withRawDb } from './helpers/db-scan';
import { lobbySettingsFor } from './helpers/durability-script';
import { fakeClock } from './helpers/fake-clock';
import type { FakeClock } from './helpers/fake-clock';
import { fakeRandom } from './helpers/fake-random';
import { snapshotOf } from './helpers/results-timelines';
import { START_MS, creationBody, withTempDir } from './helpers/service-harness';

// Kills across a whole lobby life (spec 011 FR-390): a public lobby with joins, the start, predictions by player token, every
// step of a 4-round match, a join in the running match and the memo purge 25 h later, plus a lobby with players that expires.
// Players, names, token digests and the lobby stage are stored in the transaction of the event they cause, so the fault seam
// kills the first server before every transaction and inside it after every write; a new store and service open on the same
// file, `start()` runs and the action in flight is sent again. The random bytes of a decision depend only on the index of
// its action and the number of the draw in it, so a decision lost in a crash and sent again draws the same ids and tokens:
// the restarted run must end with the raw database, the replies, the published events and the reads of the uninterrupted run,
// and every database a kill left must be complete (no player without its event, no event without its player, nothing ahead).

const HOUR = 3_600_000;
const S = 1000;
const WRITES = new Set(['insertMatch', 'updateMatch', 'insertLobby', 'markStarted', 'markExpired', 'purgeExpired', 'insertPlayer', 'putRecord', 'putStep', 'putPrediction', 'putResults', 'appendEvents', 'memoPut', 'memoPurge']);

interface Box {
  matchId?: string;
  hostToken?: string;
  joined: Map<string, { playerId: string; playerToken: string }>;
}
interface Ctx {
  readonly box: Box;
  readonly clock: FakeClock;
}
interface Action {
  readonly label: string;
  readonly run: (service: MatchService, ctx: Ctx) => unknown;
}

const create: Action = {
  label: 'create',
  run: (s, { box, clock }) => {
    clock.set(START_MS);
    const out = s.createPublic({ source: 'src-host', body: creationBody('c-1') });
    if (out.ok) {
      box.matchId = out.reply.matchId;
      box.hostToken = out.reply.hostToken;
    }
    return out;
  },
};
const joinAs = (name: string, requestId: string, at: number): Action => ({
  label: `join ${name}`,
  run: (s, { box, clock }) => {
    clock.set(at);
    const out = s.join({ source: `src-${requestId}`, matchId: box.matchId!, body: { name, requestId } });
    if (out.ok) box.joined.set(name, { playerId: out.reply.playerId, playerToken: out.reply.playerToken });
    return out;
  },
});
const start: Action = { label: 'start', run: (s, { box, clock }) => (clock.set(START_MS + 10 * S), s.startMatch({ credential: box.hostToken, matchId: box.matchId!, body: { requestId: 'st-1' } })) };

/** A submission by player token, built the way the identity builds it: the digest of the token and the id the lookup answers. */
const submit = (label: string, name: string, body: (shown: NonNullable<ReturnType<MatchService['publicMatch']>>) => Record<string, unknown> | undefined): Action => ({
  label,
  run: (s, { box }) => {
    const shown = s.publicMatch(box.matchId!)!;
    const fields = body(shown);
    if (fields === undefined) return 'none';
    const mine = box.joined.get(name)!;
    const found = s.playerTokenOf(box.matchId!, mine.playerToken);
    if (!found.ok || found.reply === undefined) throw new Error(`the token of ${name} does not resolve`);
    return s.submit({ client: { tokenDigest: credentialDigest(mine.playerToken), playerId: found.reply.playerId }, matchId: box.matchId!, body: { ...fields, playerId: mine.playerId.slice('player:'.length) } });
  },
});
const living = (shown: { state: { owners: readonly (readonly [number, number])[] } }): number[] => [...new Set(shown.state.owners.map(([, f]) => f))].sort((a, b) => a - b);

/**
 * One step: a tick at its anchor, or the host's advance five seconds before it (with a request id). The anchor and the round
 * are read from the stage the FIRST time the action runs and kept: sent again after a restart that already caught the step up,
 * the action still aims at the same instant (it would otherwise read the next stage's anchor).
 */
const step = (label: string, j: 0 | 1 | 2, how: 'tick' | 'host'): Action => {
  let fixed: { anchor: number; round: number } | undefined;
  return {
    label,
    run: (s, { box, clock }) => {
      if (fixed === undefined) {
        const shown = s.publicMatch(box.matchId!)!;
        fixed = { anchor: [shown.schedule!.c1, shown.schedule!.c2, shown.schedule!.a][j]!, round: shown.appliedRounds + 1 };
      }
      if (how === 'tick') {
        clock.set(fixed.anchor);
        s.tick();
        return 'step';
      }
      clock.set(fixed.anchor - 5 * S);
      return s.advance({ credential: box.hostToken, matchId: box.matchId!, body: { round: fixed.round, step: (['phase-1-close', 'phase-2-close', 'application'] as const)[j], requestId: `adv-${fixed.round}-${j}` } });
    },
  };
};

const fullScript = (): Action[] => {
  const out: Action[] = [create, joinAs('Ana', 'j-ana', START_MS + 1 * S), joinAs('José', 'j-jose', START_MS + 2 * S), joinAs('Zoë-Ñ.9', 'j-zoe', START_MS + 3 * S), joinAs('Ana', 'j-ana', START_MS + 4 * S), start];
  for (let k = 1; k <= 4; k += 1) {
    if (k === 2) out.push(joinAs('Late Joiner', 'j-late', START_MS + 200 * S));
    out.push(
      submit(`victim r${k} Ana`, 'Ana', (v) => ({ kind: 'victim', round: k, faction: living(v)[k % living(v).length] })),
      submit(`victim r${k} José`, 'José', (v) => ({ kind: 'victim', round: k, faction: living(v)[0], requestId: `v-${k}` })),
      step('tick phase-1 close', 0, 'tick'),
      submit(`absorber r${k} Ana`, 'Ana', (v) => (v.victim === undefined || v.victim.candidates.length < 2 ? undefined : { kind: 'absorber', round: k, faction: v.victim.candidates[0] })),
    );
    if (k === 1) out.push(submit('winner Ana', 'Ana', (v) => ({ kind: 'winner', faction: living(v)[1] })), submit('winner José', 'José', (v) => ({ kind: 'winner', faction: living(v)[2] })));
    out.push(k % 2 === 1 ? step('host advance phase-2 close', 1, 'host') : step('tick phase-2 close', 1, 'tick'), step('tick application', 2, 'tick'));
  }
  out.push({ label: 'tick purge', run: (s, { clock }) => (clock.set(START_MS + 25 * HOUR), s.tick(), 'step') });
  return out;
};

const expiryScript = (): Action[] => [
  create,
  joinAs('Ana', 'j-ana', START_MS + 1 * S),
  joinAs('José', 'j-jose', START_MS + 2 * S),
  { label: 'tick at the expiry', run: (s, { clock }) => (clock.set(START_MS + HOUR), s.tick()) },
];

const scenarios: Record<string, () => Action[]> = { full: fullScript, expiry: expiryScript };

interface Tx {
  readonly action: number;
  readonly writes: string[];
}
interface Run {
  readonly replies: string[];
  readonly published: string;
  readonly txs: Tx[];
  readonly killedAction: number | undefined;
  readonly killedLabel: string | undefined;
  readonly afterKill: string[];
  readonly dump: string;
  readonly reads: string;
  readonly tokensResolve: boolean;
}

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

/** Everything the spec makes readable after the script, as one text (ids and tokens are the same in every run). */
function readsOf(service: MatchService, box: Box): string {
  const id = box.matchId!;
  const ids = [...box.joined.values()].map((j) => j.playerId);
  const list = service.players(id, { limit: 500 });
  const events = service.eventsAfter(id, 0);
  const view = service.publicMatch(id);
  const winners = [1, 2, 3, 4].flatMap((round) => [1, 2].map((phase) => service.phaseWinners(id, round, phase as 1 | 2, { limit: 500 })));
  const results = view !== undefined && view.stage === 'finished' ? snapshotOf(service, id, [...ids, 'web:nobody'], 4, 2) : undefined;
  return JSON.stringify({ list, events, view, winners, results });
}

function runScenario(name: string, file: string, plan: FaultPlan = {}): Run {
  const actions = scenarios[name]!();
  const box: Box = { joined: new Map() };
  const clock = fakeClock(START_MS);
  const state = { txs: [] as Tx[], action: 0, killed: false };
  const draw = { action: 0, n: 0 };
  const random = (length: number): Uint8Array => {
    draw.n += 1;
    return fakeRandom(1 + draw.action * 1009 + draw.n * 7)(length);
  };
  const published: MatchEvent[][] = [];
  const settings = lobbySettingsFor(file);
  const build = (store: Store): MatchService => {
    const service = createMatchService({ store, clock, maps: createMapCatalog(settings.maps), settings, random });
    service.subscribe((_, events) => published.push([...events]));
    return service;
  };
  let service = build(traced(withFaults(openStore(file), plan), state));
  const replies: string[] = [];
  let killedAction: number | undefined;
  let killedLabel: string | undefined;
  let afterKill: string[] = [];
  try {
    actions.forEach((action, i) => {
      state.action = i;
      draw.action = i;
      draw.n = 0;
      const ctx: Ctx = { box, clock };
      let reply = action.run(service, ctx);
      if (state.killed && killedAction === undefined) {
        // The killed server sends nothing more; a new one starts on the same file and the client asks again.
        service.close();
        afterKill = withRawDb(file, (db) => [...playerEventViolations(db), ...storedFutureViolations(db)]);
        service = build(openStore(file));
        killedAction = i;
        killedLabel = action.label;
        service.start();
        draw.n = 0;
        reply = action.run(service, ctx);
      }
      // A tick report depends on what the restart already performed (as in 008), so only the commands' replies are compared.
      replies.push(action.label.startsWith('tick') ? 'step' : JSON.stringify(reply));
    });
    const tokensResolve = [...box.joined.values()].every((j) => {
      const found = service.playerTokenOf(box.matchId!, j.playerToken);
      return found.ok && found.reply?.playerId === j.playerId;
    });
    const reads = readsOf(service, box);
    service.close();
    return { replies, published: JSON.stringify(published.flat()), txs: state.txs, killedAction, killedLabel, afterKill, dump: withRawDb(file, dumpRows), reads, tokensResolve };
  } finally {
    service.close();
  }
}

describe('kills across the whole life of a lobby', () => {
  for (const name of Object.keys(scenarios)) {
    it(`FR-390 FR-392 the ${name} script: a kill before every transaction and inside it after every write leaves a complete database, and the restarted server reaches the raw database, replies, events and reads of the uninterrupted run`, () => {
      withTempDir((dir) => {
        const reference = runScenario(name, join(dir, 'reference.sqlite'));
        expect(reference.killedAction).toBeUndefined();
        expect(reference.tokensResolve).toBe(true);
        expect(withRawDb(join(dir, 'reference.sqlite'), (db) => [...playerEventViolations(db), ...storedFutureViolations(db)])).toStrictEqual([]);
        const writes = reference.txs.flatMap((t) => t.writes);
        for (const kind of ['insertLobby', 'insertPlayer']) expect(writes, kind).toContain(kind);
        if (name === 'full') for (const kind of ['markStarted', 'putPrediction', 'putResults', 'putStep', 'putRecord', 'memoPurge']) expect(writes, kind).toContain(kind);
        else expect(writes).toContain('markExpired');
        const check = (killed: Run, where: string): void => {
          expect(killed.killedAction, `${where}: the seam killed the server`).toBeDefined();
          expect(killed.afterKill, `${where}: the database the kill left`).toStrictEqual([]);
          expect(killed.replies, `${where} (action ${killed.killedAction}: ${killed.killedLabel}): replies`).toStrictEqual(reference.replies);
          expect(killed.published === reference.published, `${where}: published events`).toBe(true);
          expect(killed.reads === reference.reads, `${where}: reads`).toBe(true);
          expect(killed.tokensResolve, `${where}: the tokens of the final replies`).toBe(true);
          expect(killed.dump === reference.dump, `${where}: the raw database at the end`).toBe(true);
        };
        let points = 0;
        reference.txs.forEach((tx, i) => {
          const n = i + 1;
          check(runScenario(name, join(dir, `before-${n}.sqlite`), { abortTransaction: n }), `kill before transaction ${n}`);
          for (let w = 0; w <= tx.writes.length; w++) {
            check(runScenario(name, join(dir, `inside-${n}-${w}.sqlite`), { abortWrite: { transaction: n, afterWrites: w } }), `kill inside transaction ${n} after ${w} writes (${tx.writes.join(', ')})`);
            points += 1;
          }
        });
        expect(points).toBeGreaterThan(name === 'full' ? 100 : 10);
      });
    }, 600_000);
  }

  it('FR-390 a restarted lobby is a lobby with its players: names, join order and valid tokens, and a started match resumes as before, with no token in the database outside the 24 h memo', () => {
    withTempDir((dir) => {
      const file = join(dir, 'restart.sqlite');
      const box: Box = { joined: new Map() };
      const clock = fakeClock(START_MS);
      const settings = lobbySettingsFor(file);
      const random = fakeRandom(77);
      const open = (): MatchService => createMatchService({ store: openStore(file), clock, maps: createMapCatalog(settings.maps), settings, random });
      let service = open();
      const ctx: Ctx = { box, clock };
      for (const a of [create, joinAs('Ana', 'j-ana', START_MS + S), joinAs('José', 'j-jose', START_MS + 2 * S)]) a.run(service, ctx);
      service.close();
      service = open();
      service.start();
      const id = box.matchId!;
      const before = service.players(id, { limit: 500 });
      expect(before.ok && before.reply.items.map((i) => [i.name, i.joinedSeq])).toStrictEqual([['Ana', 2], ['José', 3]]);
      expect(service.publicMatch(id)).toMatchObject({ stage: 'lobby', playerCount: 2, lastSeq: 3 });
      for (const [, j] of box.joined) expect(service.playerTokenOf(id, j.playerToken)).toStrictEqual({ ok: true, reply: { playerId: j.playerId } });
      expect(start.run(service, ctx)).toMatchObject({ ok: true });
      service.close();
      service = open();
      service.start();
      expect(service.publicMatch(id)).toMatchObject({ stage: 'phase-1', playerCount: 2, lastSeq: 4 });
      for (const [, j] of box.joined) expect(service.playerTokenOf(id, j.playerToken)).toStrictEqual({ ok: true, reply: { playerId: j.playerId } });
      service.close();
      // 24 h later the memo is gone: the players and the digests stay, and no plain token is left anywhere.
      clock.set(START_MS + 26 * HOUR);
      service = open();
      service.start();
      service.tick();
      for (const [, j] of box.joined) expect(service.playerTokenOf(id, j.playerToken)).toStrictEqual({ ok: true, reply: { playerId: j.playerId } });
      service.close();
      withRawDb(file, (db) => {
        expect(db.prepare('SELECT COUNT(*) AS n FROM memo').get()!.n).toBe(0);
        expect(db.prepare('SELECT COUNT(*) AS n FROM players').get()!.n).toBe(2);
        expect(playerTokenPlaces(db, [...box.joined.values()].map((j) => j.playerToken), false)).toStrictEqual([]);
        expect(playerEventViolations(db)).toStrictEqual([]);
      });
    });
  });
});
