// The storage interface (spec 008, FR-291, plan 17.1). Everything the lifecycle service needs from storage goes
// through this interface, so a change in `node:sqlite` touches `sqlite.ts` only. Operations on matches, steps,
// predictions, events and memos are added to it by the next task.

/** Why a store could not be opened. */
export type StoreErrorCode = 'unknown-schema-version' | 'database-locked' | 'store-failure';

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

/** The settings of the open database, read back from the connection (plan PD9). */
export interface StoreSettings {
  readonly journalMode: string;
  readonly synchronous: 'off' | 'normal' | 'full' | 'extra';
  readonly foreignKeys: boolean;
  readonly lockingMode: string;
  readonly userVersion: number;
}

export interface Store {
  /** The settings in force on this connection. */
  settings(): StoreSettings;
  /** The tables of the schema, as the database reports them. */
  tables(): string[];
  /**
   * Runs `fn` inside one write transaction (BEGIN IMMEDIATE ... COMMIT): a throw rolls everything back and is
   * rethrown. Transactions never nest. Plan PD10.
   */
  transaction<T>(fn: () => T): T;
  /** Releases the connection and the exclusive lock. */
  close(): void;
}
