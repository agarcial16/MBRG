// Fault-injection seam for the failure and kill tests (spec 008 NFR-57, plan 17.2). A wrapper over a Store that
// fails or aborts the chosen transaction. It lives in the store directory, is imported by tests only, and no
// production module reaches it (a scan pins that). Transactions are counted from 1 on the wrapper.
import type { Store } from './store';

export class InjectedFault extends Error {
  readonly kind: 'fail' | 'abort';
  constructor(kind: 'fail' | 'abort', n: number) {
    super(`injected ${kind} before transaction ${n}`);
    this.name = 'InjectedFault';
    this.kind = kind;
  }
}

export interface FaultPlan {
  /** The transaction that throws before its callback runs: the connection stays usable. */
  readonly failTransaction?: number;
  /** The transaction before which the connection is closed with no commit, as a killed process leaves it. */
  readonly abortTransaction?: number;
}

export const withFaults = (store: Store, plan: FaultPlan): Store => {
  let count = 0;
  return {
    settings: () => store.settings(),
    tables: () => store.tables(),
    transaction<T>(fn: () => T): T {
      count += 1;
      if (count === plan.abortTransaction) {
        store.close();
        throw new InjectedFault('abort', count);
      }
      if (count === plan.failTransaction) throw new InjectedFault('fail', count);
      return store.transaction(fn);
    },
    close: () => store.close(),
  };
};
