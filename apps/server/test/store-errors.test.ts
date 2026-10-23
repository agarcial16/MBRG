import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StepKind } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { isStorageFailure } from '../src/service/matches';
import type { AdvanceOutcome } from '../src/service/matches';
import { InjectedFault } from '../src/store/faults';
import { classifyStoreError, openStore } from '../src/store/sqlite';
import { StoreError } from '../src/store/store';
import type { Store, StoredStep } from '../src/store/store';
import { OPERATOR, START_MS, creationBody, serviceHarness } from './helpers/service-harness';

// FR-292 (error classification): a native SQLite error is classified by its primary result code: busy and locked are
// `database-locked`; I/O, full, read-only, cannot-open, corrupt and not-a-database are `store-failure` (storage failures:
// a command replies `unavailable`, a clock step is retried); a constraint violation, a misuse, a range or a logic error is
// `invalid-write`, a programming error (a command rethrows it, a clock step reports `error`). Without a result code (a
// platform that does not attach it) the message gives the class. NFR-54 (cause kept without values): the StoreError keeps
// the native error as `cause` and the result code and its generic text, but its own message never quotes the native
// message (which may hold values); the cause is not an enumerable field, so serialising the error drops it.
// Platform (recorded in tasks.md, T4): Node v24.0.0 attaches `errcode` and `errstr` to every `ERR_SQLITE_ERROR`; CI runs
// v24.21.0, which this machine cannot run, so these tests accept a native error without them and the fallback is tested
// with synthetic errors.

const withTempDir = <T>(body: (dir: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrg-errors-'));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const thrown = (action: () => unknown): unknown => {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('no error was thrown');
};

interface Native extends Error {
  code?: unknown;
  errcode?: unknown;
  errstr?: unknown;
}

/** A synthetic native error: `ERR_SQLITE_ERROR` with the given message and, when given, a result code and text. */
const synthetic = (message: string, errcode?: number, errstr?: string): Native => {
  const e: Native = new Error(message);
  e.code = 'ERR_SQLITE_ERROR';
  if (errcode !== undefined) e.errcode = errcode;
  if (errstr !== undefined) e.errstr = errstr;
  return e;
};

const classOf = (error: unknown): string => {
  const out = classifyStoreError(error);
  return out instanceof StoreError ? out.code : 'unchanged';
};

/** Real native errors of the installed platform, each with the class it must get. */
function nativeErrors(dir: string): [string, Native, string][] {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (k INTEGER PRIMARY KEY, v TEXT NOT NULL)');
  db.exec("INSERT INTO t VALUES (1, 'a')");
  const out: [string, Native, string][] = [
    ['primary key', thrown(() => db.prepare("INSERT INTO t VALUES (1, 'b')").run()) as Native, 'invalid-write'],
    ['not null', thrown(() => db.prepare('INSERT INTO t VALUES (2, NULL)').run()) as Native, 'invalid-write'],
    ['syntax', thrown(() => db.prepare('SELEC 1').get()) as Native, 'invalid-write'],
    ['nested transaction', thrown(() => {
      db.exec('BEGIN');
      try {
        db.exec('BEGIN');
      } finally {
        db.exec('ROLLBACK');
      }
    }) as Native, 'invalid-write'],
  ];
  db.close();
  out.push(['closed connection', thrown(() => db.prepare('SELECT 1').get()) as Native, 'store-failure']);
  const ro = new DatabaseSync(':memory:', { readOnly: true });
  out.push(['read-only', thrown(() => ro.exec('CREATE TABLE x (a)')) as Native, 'store-failure']);
  ro.close();
  out.push(['cannot open', thrown(() => new DatabaseSync(join(dir, 'missing', 'dir', 'x.sqlite'))) as Native, 'store-failure']);
  const junk = join(dir, 'junk.sqlite');
  writeFileSync(junk, 'this file is plain text and not a database; '.repeat(8));
  const notDb = new DatabaseSync(junk);
  out.push(['not a database', thrown(() => notDb.prepare('SELECT * FROM sqlite_master').all()) as Native, 'store-failure']);
  notDb.close();
  const file = join(dir, 'busy.sqlite');
  const holder = new DatabaseSync(file, { timeout: 0 });
  holder.exec('PRAGMA locking_mode = EXCLUSIVE');
  holder.exec('BEGIN IMMEDIATE; CREATE TABLE q (a); COMMIT');
  const other = new DatabaseSync(file, { timeout: 0 });
  out.push(['busy', thrown(() => other.exec('BEGIN IMMEDIATE')) as Native, 'database-locked']);
  other.close();
  holder.close();
  return out;
}

describe('FR-292 (error classification) native errors of the installed platform', () => {
  it('FR-292 (error classification) NFR-54 (cause kept without values) each native error gets its class, keeps itself as the cause and its result code when the platform gives one', () => {
    withTempDir((dir) => {
      for (const [label, native, expected] of nativeErrors(dir)) {
        const out = classifyStoreError(native);
        expect(out, label).toBeInstanceOf(StoreError);
        const e = out as StoreError;
        expect(e.code, label).toBe(expected);
        expect(e.cause, label).toBe(native);
        if (typeof native.errcode === 'number') {
          expect(e.sqliteCode, label).toBe(native.errcode);
          expect(e.sqliteText, label).toBe(native.errstr);
        } else {
          expect(e.sqliteCode, label).toBeUndefined();
          expect(e.sqliteText, label).toBeUndefined();
        }
        expect(e.message, label).not.toContain(native.message);
        expect(isStorageFailure(e), label).toBe(expected !== 'invalid-write');
      }
    });
  });

  it('FR-292 (error classification) a raw duplicate insert through the store is invalid-write, not a storage failure, and keeps the native cause', () => {
    const store = openStore(':memory:');
    try {
      store.transaction(() => {
        store.insertMatch({
          match: {
            matchId: 'EEEEEEEEEEEEEEEE', mapId: 'dev', mapDigest: 'a'.repeat(64), totalRounds: 5, timing: 'manual', commitment: 'c'.repeat(64), stage: 'phase-1',
            appliedRounds: 0, state: { mode: 'classic', round: 0, owners: [[1, 10], [2, 20]] }, stateDigest: 'd'.repeat(64), lastSeq: 0, createdAt: START_MS, lastStepMs: START_MS, anchors: null,
          },
          secret: new Uint8Array(32),
          hostTokenDigest: 'b'.repeat(64),
        });
      });
      const row: StoredStep = { round: 1, kind: 'phase-1-close', instant: START_MS, cause: 'manual', firstSeq: 1, lastSeq: 1 };
      store.transaction(() => store.putStep('EEEEEEEEEEEEEEEE', row));
      for (const action of [() => store.transaction(() => store.putStep('EEEEEEEEEEEEEEEE', row)), () => store.transaction(() => store.putStep('missing', row))]) {
        const e = thrown(action);
        expect(e).toBeInstanceOf(StoreError);
        expect((e as StoreError).code).toBe('invalid-write');
        expect(isStorageFailure(e)).toBe(false);
        expect((e as StoreError).cause).toBeInstanceOf(Error);
        expect(((e as StoreError).cause as Native).code).toBe('ERR_SQLITE_ERROR');
      }
      // The connection is usable after the refused write.
      expect(store.steps('EEEEEEEEEEEEEEEE')).toStrictEqual([row]);
    } finally {
      store.close();
    }
  });

  it('FR-292 (error classification) the closed connection is a storage failure with its cause; the locked file at open keeps its cause too', () => {
    const store = openStore(':memory:');
    store.close();
    const e = thrown(() => store.getMatch('x')) as StoreError;
    expect(e.code).toBe('store-failure');
    expect((e.cause as Native).code).toBe('ERR_INVALID_STATE');
    withTempDir((dir) => {
      const file = join(dir, 'lock.sqlite');
      const first = openStore(file);
      try {
        const locked = thrown(() => openStore(file)) as StoreError;
        expect(locked.code).toBe('database-locked');
        expect((locked.cause as Native).code).toBe('ERR_SQLITE_ERROR');
      } finally {
        first.close();
      }
    });
  });
});

describe('FR-292 (error classification) by result code and by message', () => {
  it('FR-292 (error classification) the primary result code decides, extended codes included', () => {
    const cases: [number, string][] = [
      [5, 'database-locked'], // BUSY
      [261, 'database-locked'], // BUSY_RECOVERY
      [6, 'database-locked'], // LOCKED
      [262, 'database-locked'], // LOCKED_SHAREDCACHE
      [10, 'store-failure'], // IOERR
      [266, 'store-failure'], // IOERR_READ
      [3338, 'store-failure'], // IOERR_FSYNC
      [13, 'store-failure'], // FULL
      [8, 'store-failure'], // READONLY
      [14, 'store-failure'], // CANTOPEN
      [11, 'store-failure'], // CORRUPT
      [26, 'store-failure'], // NOTADB
      [19, 'invalid-write'], // CONSTRAINT
      [1555, 'invalid-write'], // CONSTRAINT_PRIMARYKEY
      [2067, 'invalid-write'], // CONSTRAINT_UNIQUE
      [787, 'invalid-write'], // CONSTRAINT_FOREIGNKEY
      [21, 'invalid-write'], // MISUSE
      [25, 'invalid-write'], // RANGE
      [1, 'invalid-write'], // ERROR (logic)
      [20, 'invalid-write'], // MISMATCH
    ];
    for (const [code, expected] of cases) {
      // The message says the opposite of the code: the code wins.
      const message = expected === 'invalid-write' ? 'disk I/O error' : 'UNIQUE constraint failed: t.k';
      const out = classifyStoreError(synthetic(message, code, 'generic text'));
      expect((out as StoreError).code, String(code)).toBe(expected);
      expect((out as StoreError).sqliteCode, String(code)).toBe(code);
      expect((out as StoreError).sqliteText, String(code)).toBe('generic text');
    }
  });

  it('FR-292 (error classification) without a result code the message gives the class', () => {
    const cases: [string, string][] = [
      ['database is locked', 'database-locked'],
      ['database table is locked: t', 'database-locked'],
      ['database is busy', 'database-locked'],
      ['disk I/O error', 'store-failure'],
      ['database or disk is full', 'store-failure'],
      ['attempt to write a readonly database', 'store-failure'],
      ['unable to open database file', 'store-failure'],
      ['database disk image is malformed', 'store-failure'],
      ['file is not a database', 'store-failure'],
      ['UNIQUE constraint failed: t.k', 'invalid-write'],
      ['NOT NULL constraint failed: t.v', 'invalid-write'],
      ['FOREIGN KEY constraint failed', 'invalid-write'],
      ['near "SELEC": syntax error', 'invalid-write'],
      ['no such table: nope', 'invalid-write'],
      ['cannot start a transaction within a transaction', 'invalid-write'],
      ['column index out of range', 'invalid-write'],
      // An unrecognised text keeps the earlier rule: a storage failure, retried.
      ['something new went wrong', 'store-failure'],
    ];
    for (const [message, expected] of cases) {
      const native = synthetic(message);
      const out = classifyStoreError(native) as StoreError;
      expect(out.code, message).toBe(expected);
      expect(out.cause, message).toBe(native);
      expect(out.sqliteCode, message).toBeUndefined();
      expect(out.sqliteText, message).toBeUndefined();
    }
    // A code that is not a whole number is ignored like an absent one.
    expect(classOf(synthetic('database is locked', Number.NaN))).toBe('database-locked');
    expect(classOf(Object.assign(synthetic('disk I/O error'), { errcode: '19' }))).toBe('store-failure');
  });

  it('FR-292 (error classification) anything that is not a native SQLite error is returned unchanged', () => {
    const fault = new InjectedFault('fail', 2);
    const store = new StoreError('invalid-write', 'refused');
    const range = new RangeError('inconsistent stored data');
    const type = new TypeError('bad argument');
    const other = Object.assign(new Error('database is locked'), { code: 'ERR_OTHER' });
    const bigint = Object.assign(new TypeError('BigInt value is too large to bind.'), { code: 'ERR_INVALID_ARG_VALUE' });
    for (const e of [fault, store, range, type, other, bigint, 'text', 7, undefined]) expect(classifyStoreError(e)).toBe(e);
    // The fault seam's injected faults are storage failures without a native cause.
    expect(fault.code).toBe('store-failure');
    expect(fault.cause).toBeUndefined();
    expect(isStorageFailure(fault)).toBe(true);
  });

  it('NFR-54 (cause kept without values) the store error quotes no value of the native message and serialises without its cause', () => {
    const planted = 'planted-value-7f3a9c';
    for (const native of [synthetic(`UNIQUE constraint failed: ${planted}`, 2067, 'constraint failed'), synthetic(`disk I/O error near ${planted}`), synthetic(planted, 10, 'disk I/O error')]) {
      const out = classifyStoreError(native) as StoreError;
      expect(out.cause).toBe(native);
      expect(out.message).not.toContain(planted);
      expect(String(out)).not.toContain(planted);
      expect(JSON.stringify(out)).not.toContain(planted);
      expect(Object.keys(out)).not.toContain('cause');
    }
  });
});

describe('FR-292 (error classification) through the service', () => {
  /** A store whose event write also writes a raw duplicate step row while `failing` holds: a real constraint violation. */
  function duplicating(base: Store): { store: Store; fail: (on: boolean) => void } {
    let failing = false;
    const row: StoredStep = { round: 9, kind: 'application', instant: START_MS, cause: 'manual', firstSeq: 1, lastSeq: 1 };
    return {
      store: {
        ...base,
        appendEvents(matchId, events) {
          if (failing) {
            base.putStep(matchId, row);
            base.putStep(matchId, row);
          }
          base.appendEvents(matchId, events);
        },
      },
      fail: (on) => (failing = on),
    };
  }

  it('FR-292 (error classification) a constraint violation inside a command is rethrown as invalid-write and rolls back, never replied unavailable', () => {
    const d = duplicating(openStore(':memory:'));
    const h = serviceHarness({ store: d.store });
    const created = h.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing: 'manual' }) });
    if (!created.ok) throw new Error('creation failed');
    d.fail(true);
    const advance = (round: number, step: StepKind): AdvanceOutcome => h.service.advance({ credential: OPERATOR, matchId: created.reply.matchId, body: { round, step } });
    const e = thrown(() => advance(1, 'phase-1-close'));
    expect(e).toBeInstanceOf(StoreError);
    expect((e as StoreError).code).toBe('invalid-write');
    expect(h.store.steps(created.reply.matchId)).toStrictEqual([]);
    d.fail(false);
    const out = advance(1, 'phase-1-close');
    expect(out.ok && out.reply.result).toBe('performed');
    h.close();
  });

  it('FR-292 (error classification) a constraint violation in a clock step is reported as error, not unavailable, and retried', () => {
    const d = duplicating(openStore(':memory:'));
    const h = serviceHarness({ store: d.store, scheduler: true });
    const created = h.service.create({ credential: OPERATOR, body: creationBody('c-1') });
    if (!created.ok) throw new Error('creation failed');
    d.fail(true);
    h.clock.set(START_MS + 80_000);
    const report = h.service.tick();
    expect(report.failed).toStrictEqual([{ matchId: created.reply.matchId, kind: 'error' }]);
    expect(report.performed).toStrictEqual([]);
    expect(h.scheduler!.pending()).toStrictEqual([START_MS + 83_000]);
    h.close();
  });
});
