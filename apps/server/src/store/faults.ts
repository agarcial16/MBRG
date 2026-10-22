// Fault-injection seam for the failure and kill tests (spec 008 FR-292, NFR-57, plan 17.2). A wrapper over a Store that
// fails or aborts the chosen transaction, or fails one write inside it. It lives in the store directory, is imported by
// tests only, and no production module reaches it (a scan pins that). Transactions are counted from 1 on the wrapper.
// An injected fault is a storage failure (`StoreError` code `store-failure`), as the service classifies it (FR-292).
import { StoreError } from './store';
import type { Store } from './store';

export type FaultKind = 'fail' | 'abort' | 'write';

export class InjectedFault extends StoreError {
  readonly kind: FaultKind;
  constructor(kind: FaultKind, n: number) {
    super('store-failure', `injected ${kind} ${kind === 'write' ? 'inside' : 'before'} transaction ${n}`);
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
}

export const withFaults = (store: Store, plan: FaultPlan): Store => {
  let count = 0;
  let writes = 0;
  const failing = (n: number): boolean =>
    typeof plan.failTransaction === 'number' ? plan.failTransaction === n : (plan.failTransaction ?? []).includes(n);
  /** Counts the writes of the planned transaction and throws at the planned one. */
  const write = (): void => {
    if (plan.failWrite === undefined || count !== plan.failWrite.transaction) return;
    writes += 1;
    if (writes === plan.failWrite.afterWrites + 1) throw new InjectedFault('write', count);
  };
  return {
    settings: () => store.settings(),
    tables: () => store.tables(),
    insertMatch: (row) => (write(), store.insertMatch(row)),
    updateMatch: (match) => (write(), store.updateMatch(match)),
    getMatch: (matchId) => store.getMatch(matchId),
    runningCount: () => store.runningCount(),
    runningMatchIds: () => store.runningMatchIds(),
    getState: (matchId, round) => store.getState(matchId, round),
    putRecord: (matchId, record) => (write(), store.putRecord(matchId, record)),
    records: (matchId) => store.records(matchId),
    putStep: (matchId, step) => (write(), store.putStep(matchId, step)),
    steps: (matchId) => store.steps(matchId),
    putPrediction: (matchId, playerId, prediction) => (write(), store.putPrediction(matchId, playerId, prediction)),
    predictionsOf: (matchId, playerId) => store.predictionsOf(matchId, playerId),
    appendEvents: (matchId, events) => (write(), store.appendEvents(matchId, events)),
    eventsAfter: (matchId, seq) => store.eventsAfter(matchId, seq),
    memoGet: (scope, requestId) => store.memoGet(scope, requestId),
    memoPut: (scope, requestId, entry) => (write(), store.memoPut(scope, requestId, entry)),
    memoPurge: (now) => (write(), store.memoPurge(now)),
    memoOldest: () => store.memoOldest(),
    transaction<T>(fn: () => T): T {
      count += 1;
      if (count === plan.abortTransaction) {
        store.close();
        throw new InjectedFault('abort', count);
      }
      if (failing(count)) throw new InjectedFault('fail', count);
      return store.transaction(fn);
    },
    close: () => store.close(),
  };
};
