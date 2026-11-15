// Fault-injection seam for the failure and kill tests (spec 008 FR-292, NFR-57, plan 17.2). A wrapper over a Store that
// fails or aborts the chosen transaction, fails one write inside it, or kills it from the inside. It lives in the store
// directory, is imported by tests only, and no production module reaches it (a scan pins that). Transactions are counted
// from 1 on the wrapper. An injected fault is a storage failure (`StoreError` code `store-failure`), as the service
// classifies it (FR-292).
import { StoreError } from './store';
import type { Store } from './store';

/**
 * `fail`: a transaction refused before it began; `abort`: the connection closed before a transaction began; `write`: one
 * write of a transaction failed (the store rolls back); `abort-inside`: the connection closed inside a transaction, with
 * no commit and no rollback statement (what a killed process leaves, NFR-57); `read`: one call of `runningMatchIds` (a
 * read outside any transaction, counted from 1 on its own) failed, the connection stays usable.
 */
export type FaultKind = 'fail' | 'abort' | 'write' | 'abort-inside' | 'read';

export class InjectedFault extends StoreError {
  readonly kind: FaultKind;
  constructor(kind: FaultKind, n: number) {
    super('store-failure', kind === 'read' ? `injected read failure of runningMatchIds call ${n}` : `injected ${kind} ${kind === 'write' || kind === 'abort-inside' ? 'inside' : 'before'} transaction ${n}`);
    this.name = 'InjectedFault';
    this.kind = kind;
  }
}

export interface FaultPlan {
  /** The transaction (or transactions) that throw before their callback runs: the connection stays usable. */
  readonly failTransaction?: number | readonly number[];
  /** The transaction before which the connection is closed with no commit, as a killed process leaves it. */
  readonly abortTransaction?: number;
  /**
   * Inside transaction `transaction`, the write after the first `afterWrites` writes throws: the earlier writes of that
   * transaction ran, so the rollback must undo a partial write.
   */
  readonly failWrite?: { readonly transaction: number; readonly afterWrites: number };
  /**
   * Inside transaction `transaction`, once its first `afterWrites` writes ran, the connection is closed with no commit and
   * no rollback statement (a process killed in the middle of a decision): before the next write, or before the commit
   * when the transaction has no further write. The connection stays closed, as for `abortTransaction`.
   */
  readonly abortWrite?: { readonly transaction: number; readonly afterWrites: number };
  /** The calls of `runningMatchIds` (counted from 1, apart from the transactions) that throw: the connection stays usable. */
  readonly failRunningIds?: readonly number[];
}

export const withFaults = (store: Store, plan: FaultPlan): Store => {
  let count = 0;
  /** The writes of the current transaction so far. */
  let writes = 0;
  /** The calls of `runningMatchIds` so far. */
  let reads = 0;
  const failing = (n: number): boolean =>
    typeof plan.failTransaction === 'number' ? plan.failTransaction === n : (plan.failTransaction ?? []).includes(n);
  const killHere = (): boolean => plan.abortWrite !== undefined && count === plan.abortWrite.transaction && writes === plan.abortWrite.afterWrites;
  const kill = (): never => {
    store.close();
    throw new InjectedFault('abort-inside', count);
  };
  /** Counts the writes of the current transaction and throws or kills at the planned one. */
  const write = (): void => {
    if (killHere()) kill();
    writes += 1;
    if (plan.failWrite !== undefined && count === plan.failWrite.transaction && writes === plan.failWrite.afterWrites + 1) throw new InjectedFault('write', count);
  };
  return {
    settings: () => store.settings(),
    tables: () => store.tables(),
    insertMatch: (row) => (write(), store.insertMatch(row)),
    updateMatch: (match) => (write(), store.updateMatch(match)),
    getMatch: (matchId) => store.getMatch(matchId),
    runningCount: () => store.runningCount(),
    runningMatchIds: () => {
      reads += 1;
      if ((plan.failRunningIds ?? []).includes(reads)) throw new InjectedFault('read', reads);
      return store.runningMatchIds();
    },
    insertLobby: (lobby) => (write(), store.insertLobby(lobby)),
    getLobby: (matchId) => store.getLobby(matchId),
    markStarted: (matchId, nowMs) => (write(), store.markStarted(matchId, nowMs)),
    markExpired: (matchId, nowMs) => (write(), store.markExpired(matchId, nowMs)),
    openLobbyCount: () => store.openLobbyCount(),
    publicRunningCount: () => store.publicRunningCount(),
    lobbiesExpiringBefore: (now) => store.lobbiesExpiringBefore(now),
    lobbyIds: () => store.lobbyIds(),
    purgeExpired: (now) => (write(), store.purgeExpired(now)),
    oldestExpiredMs: () => store.oldestExpiredMs(),
    insertPlayer: (player) => (write(), store.insertPlayer(player)),
    playerCount: (matchId) => store.playerCount(matchId),
    nameKeyTaken: (matchId, key) => store.nameKeyTaken(matchId, key),
    playerByTokenDigest: (matchId, tokenDigest) => store.playerByTokenDigest(matchId, tokenDigest),
    playersAfter: (matchId, after, limit) => store.playersAfter(matchId, after, limit),
    playerNames: (matchId, ids) => store.playerNames(matchId, ids),
    getState: (matchId, round) => store.getState(matchId, round),
    putRecord: (matchId, record) => (write(), store.putRecord(matchId, record)),
    records: (matchId) => store.records(matchId),
    putStep: (matchId, step) => (write(), store.putStep(matchId, step)),
    steps: (matchId) => store.steps(matchId),
    putPrediction: (matchId, playerId, prediction) => (write(), store.putPrediction(matchId, playerId, prediction)),
    predictionsOf: (matchId, playerId) => store.predictionsOf(matchId, playerId),
    predictionsOfPhase: (matchId, kind, round) => store.predictionsOfPhase(matchId, kind, round),
    putResults: (matchId, rows) => (write(), store.putResults(matchId, rows)),
    phaseResultsAfter: (matchId, kind, round, after, limit) => store.phaseResultsAfter(matchId, kind, round, after, limit),
    winnersAfter: (matchId, kind, round, after, limit) => store.winnersAfter(matchId, kind, round, after, limit),
    playerResultsAfter: (matchId, playerId, after, limit) => store.playerResultsAfter(matchId, playerId, after, limit),
    playerTotal: (matchId, playerId) => store.playerTotal(matchId, playerId),
    leaderboardTotals: (matchId) => store.leaderboardTotals(matchId),
    listMatches: (after, limit) => store.listMatches(after, limit),
    recordsAfter: (matchId, round, limit) => store.recordsAfter(matchId, round, limit),
    predictionsInNamespace: (matchId, namespace, after, limit, localId) => store.predictionsInNamespace(matchId, namespace, after, limit, localId),
    hostTokenDigest: (matchId) => store.hostTokenDigest(matchId),
    appendEvents: (matchId, events) => (write(), store.appendEvents(matchId, events)),
    eventsAfter: (matchId, seq) => store.eventsAfter(matchId, seq),
    memoGet: (scope, requestId) => store.memoGet(scope, requestId),
    memoPut: (scope, requestId, entry) => (write(), store.memoPut(scope, requestId, entry)),
    memoPurge: (now) => (write(), store.memoPurge(now)),
    memoOldest: () => store.memoOldest(),
    transaction<T>(fn: () => T): T {
      count += 1;
      writes = 0;
      if (count === plan.abortTransaction) {
        store.close();
        throw new InjectedFault('abort', count);
      }
      if (failing(count)) throw new InjectedFault('fail', count);
      return store.transaction(() => {
        const value = fn();
        // No further write came: the kill falls between the last write and the commit.
        if (killHere()) kill();
        return value;
      });
    },
    close: () => store.close(),
  };
};
