import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePublicMatch } from '@mbrg/protocol';
import type { MatchEvent } from '@mbrg/protocol';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { MatchService, StartReport } from '../src/service/matches';
import { InjectedFault, withFaults } from '../src/store/faults';
import type { FaultPlan } from '../src/store/faults';
import { openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';
import { dumpRows, withRawDb } from './helpers/db-scan';
import { perform, resultsReads, scriptCursor, serviceOn } from './helpers/durability-script';
import type { ActionSpec } from './helpers/durability-script';
import { fakeClock } from './helpers/fake-clock';
import { START_MS, withTempDir } from './helpers/service-harness';

// Durability: a kill between any two storage transactions, and inside any of them (spec 008 NFR-57, M2b part; the
// results part, with the scores and the leaderboard, is M4). One scripted dev-map clock match with predictions, request
// ids, manual advances and clock ticks (helpers/durability-script.ts) runs on a database FILE. The fault seam
// (store/faults.ts) kills the first server at one point: before transaction n (`abortTransaction`: the connection is
// closed, nothing of n is written) or inside it once its first w writes ran (`abortWrite`: the connection is closed
// with no commit and no rollback statement, as a killed process leaves it). The killed process does nothing more; a
// new store and a new service are opened on the same file, `start()` runs, the action in flight is sent again (same
// request id) and the script goes on. Checked for every point:
// - the database left by the kill equals the one before transaction n: a decision is all or nothing;
// - its rows are consistent: gap-free event numbers, step rows covering exactly the events, records and states up to N;
// - the restarted run ends with the raw database, the public data, every command reply (a retried request id gives the
//   stored reply, or the command is performed once) and the published events of the uninterrupted run: no accepted
//   prediction is lost, no step is performed twice or skipped, no event is published twice or numbered twice.
// Once, a real child process is killed (SIGKILL; TerminateProcess of that one PID on Windows) between two decisions and
// inside a decision, and its database is compared with the one the seam leaves at the same point (seam fidelity).

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const KILL_CHILD = fileURLToPath(new URL('./fixtures/kill-child.ts', import.meta.url));

const WRITES = new Set(['insertMatch', 'updateMatch', 'putRecord', 'putResults', 'putStep', 'putPrediction', 'appendEvents', 'memoPut', 'memoPurge']);

/** One transaction of a run: the action it belongs to (index in the script) and the store writes it made, in order. */
interface Tx {
  readonly action: number;
  readonly writes: string[];
}

interface Trace {
  readonly txs: Tx[];
  action: number;
  killed: boolean;
}

/** Records every transaction and write of the first server, and whether the seam killed it. */
function traced(inner: Store, trace: Trace): Store {
  return new Proxy(inner, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (key === 'transaction') {
        return <T>(fn: () => T): T => {
          trace.txs.push({ action: trace.action, writes: [] });
          try {
            return target.transaction(fn);
          } catch (error) {
            if (error instanceof InjectedFault && (error.kind === 'abort' || error.kind === 'abort-inside')) trace.killed = true;
            throw error;
          }
        };
      }
      if (typeof key === 'string' && WRITES.has(key) && typeof value === 'function') {
        return (...args: unknown[]): unknown => {
          trace.txs[trace.txs.length - 1]?.writes.push(key);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return value;
    },
  });
}

/** Opens the store and checks the durability settings it runs with (WAL, synchronous FULL, exclusive lock: FR-292, PD9). */
function openChecked(file: string): Store {
  const store = openStore(file);
  const s = store.settings();
  if (s.journalMode !== 'wal' || s.synchronous !== 'full' || s.lockingMode !== 'exclusive') {
    store.close();
    throw new Error(`durability settings not in force: ${JSON.stringify(s)}`);
  }
  return store;
}

/**
 * The rows of a decision that a partial write would break: per match, event numbers 1..K without a gap; step rows (in
 * storage order) covering the events 2..K exactly (event 1 is the creation `schedule`); records of the rounds 1..N and
 * states of the rounds 0..N. Each violation is a readable text.
 */
function decisionViolations(db: DatabaseSync): string[] {
  const out: string[] = [];
  for (const m of db.prepare('SELECT id, n FROM matches ORDER BY rowid').all()) {
    const id = String(m.id);
    const n = Number(m.n);
    const seqs = db.prepare('SELECT seq FROM events WHERE match_id = ? ORDER BY seq').all(id).map((r) => Number(r.seq));
    if (seqs.some((s, i) => s !== i + 1)) out.push(`${id}: event numbers ${seqs.join(',')}`);
    const k = seqs.length;
    let next = 2;
    for (const r of db.prepare('SELECT round, kind, first_seq, last_seq FROM steps WHERE match_id = ? ORDER BY rowid').all(id)) {
      if (Number(r.first_seq) !== next || Number(r.last_seq) < Number(r.first_seq)) out.push(`${id}: step ${String(r.kind)} ${String(r.round)} covers ${String(r.first_seq)}..${String(r.last_seq)}, expected from ${next}`);
      next = Number(r.last_seq) + 1;
    }
    if (next !== k + 1) out.push(`${id}: the step rows cover events up to ${next - 1}, stored ${k}`);
    const rounds = (table: string): number[] => db.prepare(`SELECT round FROM ${table} WHERE match_id = ? ORDER BY round`).all(id).map((r) => Number(r.round));
    if (rounds('records').join(',') !== Array.from({ length: n }, (_, i) => i + 1).join(',')) out.push(`${id}: records ${rounds('records').join(',')} with N = ${n}`);
    if (rounds('states').join(',') !== Array.from({ length: n + 1 }, (_, i) => i).join(',')) out.push(`${id}: states ${rounds('states').join(',')} with N = ${n}`);
  }
  return out;
}

interface Kill {
  /** The action in flight when the server was killed. */
  readonly action: number;
  /** The raw database the killed server left. */
  readonly dump: string;
  readonly violations: string[];
  readonly start: StartReport;
}

interface Run {
  readonly specs: ActionSpec[];
  /** The reply that counted for every command (null for ticks): after a kill, the reply of the retried request. */
  readonly replies: (string | null)[];
  /** Every event published by every server of the run, in order. */
  readonly published: MatchEvent[];
  /** The transactions of the first server (up to the kill). */
  readonly txs: Tx[];
  readonly kill: Kill | undefined;
  readonly dump: string;
  readonly publicMatch: string;
  /** The results reads (phase results, players, leaderboard) at the end of the run. */
  readonly results: string;
}

/** Runs the script on `file`; with a plan, the seam kills the first server at the planned point and a new one takes over. */
function runScript(file: string, plan: FaultPlan = {}): Run {
  const clock = fakeClock(START_MS);
  const trace: Trace = { txs: [], action: 0, killed: false };
  const published: MatchEvent[] = [];
  const listen = (service: MatchService): MatchService => (service.subscribe((_, events) => published.push(...events)), service);
  const live = { service: listen(serviceOn(traced(withFaults(openChecked(file), plan), trace), clock, file)) };
  const cursor = scriptCursor();
  const specs: ActionSpec[] = [];
  const replies: (string | null)[] = [];
  let kill: Kill | undefined;
  let matchId = '';
  try {
    for (let i = 0; ; i++) {
      if (i > 200) throw new Error('the script does not end');
      const spec = cursor.next(live.service);
      if (spec === undefined) break;
      specs.push(spec);
      trace.action = i;
      clock.set(spec.at);
      let reply = perform(live.service, spec);
      if (trace.killed && kill === undefined) {
        // The killed server sends nothing more: its reply is lost. A new server starts on the same file and the client
        // sends the same request again.
        live.service.close();
        const dump = withRawDb(file, dumpRows);
        const violations = withRawDb(file, decisionViolations);
        live.service = listen(serviceOn(openChecked(file), clock, file));
        kill = { action: i, dump, violations, start: live.service.start() };
        reply = perform(live.service, spec);
      }
      if (spec.kind === 'create') matchId = (reply as { reply: { matchId: string } }).reply.matchId;
      replies.push(spec.kind === 'tick' ? null : JSON.stringify(reply));
      cursor.after(spec, reply);
    }
    const publicMatch = encodePublicMatch(live.service.publicMatch(matchId)!);
    const results = resultsReads(live.service, matchId);
    live.service.close();
    return { specs, replies, published, txs: trace.txs, kill, dump: withRawDb(file, dumpRows), publicMatch, results };
  } finally {
    live.service.close();
  }
}

/** The uninterrupted run and the database before every transaction n (index n - 1; the last entry is the final one). */
interface Reference {
  readonly run: Run;
  readonly before: string[];
}

/** Checks a killed run against the uninterrupted one: the continuation equals it in every stored and public respect. */
function expectSameContinuation(run: Run, reference: Run, where: string): void {
  expect(run.kill, `${where}: the seam killed the server`).toBeDefined();
  expect(run.kill!.violations, `${where}: rows of the database the kill left`).toStrictEqual([]);
  expect(run.specs, `${where}: the script`).toStrictEqual(reference.specs);
  expect(run.replies, `${where}: the replies that counted`).toStrictEqual(reference.replies);
  expect(run.published, `${where}: the published events`).toStrictEqual(reference.published);
  expect(run.publicMatch, `${where}: the public data`).toBe(reference.publicMatch);
  expect(run.results, `${where}: the results reads and the leaderboard`).toBe(reference.results);
  expect(run.dump === reference.dump, `${where}: the raw database at the end`).toBe(true);
}

describe('NFR-57 (durability, M2b part) a kill between and inside every storage transaction of a scripted match', () => {
  const state: { reference?: Reference } = {};

  /** The uninterrupted run and, by a kill before each transaction, the database before every transaction. */
  const reference = (dir: string): Reference => {
    if (state.reference !== undefined) return state.reference;
    const run = runScript(join(dir, 'reference.sqlite'));
    const before: string[] = [];
    for (let n = 1; n <= run.txs.length; n++) {
      const killed = runScript(join(dir, `before-${n}.sqlite`), { abortTransaction: n });
      expectSameContinuation(killed, run, `kill before transaction ${n}`);
      expect(killed.kill!.action, `kill before transaction ${n}: action`).toBe(run.txs[n - 1]!.action);
      before.push(killed.kill!.dump);
    }
    before.push(run.dump);
    state.reference = { run, before };
    return state.reference;
  };

  it('NFR-57 (durability, M2b part) the script is a full match with predictions, replacements, replays, manual advances, clock ticks and a memo purge, on a file with WAL, synchronous FULL and the exclusive lock', () => {
    withTempDir((dir) => {
      const file = join(dir, 'settings.sqlite');
      const store = openStore(file);
      try {
        expect(store.settings()).toMatchObject({ journalMode: 'wal', synchronous: 'full', lockingMode: 'exclusive' });
      } finally {
        store.close();
      }
      const run = runScript(join(dir, 'plain.sqlite'));
      const finished = JSON.parse(run.publicMatch) as { stage: string; appliedRounds: number };
      expect(finished.stage).toBe('finished');
      expect(run.kill).toBeUndefined();
      const kinds = run.specs.map((s) => s.kind);
      expect(kinds.filter((k) => k === 'advance').length).toBeGreaterThanOrEqual(3);
      expect(run.specs.filter((s) => s.kind === 'tick').length).toBeGreaterThanOrEqual(6);
      expect(run.specs.filter((s) => s.kind === 'submit').length).toBeGreaterThanOrEqual(4 * finished.appliedRounds);
      const writes = run.txs.flatMap((t) => t.writes);
      for (const w of WRITES) expect(writes, w).toContain(w);
      // Every prediction with a request id was accepted (so a lost one would show), and the purge removed the memo.
      for (const [i, spec] of run.specs.entries()) {
        if (spec.kind === 'submit') expect(JSON.parse(run.replies[i]!), spec.label).toMatchObject({ ok: true });
        if (spec.kind === 'advance') expect(JSON.parse(run.replies[i]!), spec.label).toMatchObject({ ok: true, reply: { result: 'performed' } });
      }
      withRawDb(join(dir, 'plain.sqlite'), (db) => expect(db.prepare('SELECT COUNT(*) AS n FROM memo').get()?.n).toBe(0));
      // The results reads are not vacuous: scored phases, the two players and a non-empty leaderboard.
      const reads = JSON.parse(run.results) as { phaseResults: Record<string, { items: unknown[] }>; players: Record<string, { total: number; items: unknown[] }>; leaderboard: { playerId: string }[] };
      expect(Object.keys(reads.phaseResults)).toHaveLength(8);
      expect(Object.values(reads.phaseResults).some((p) => p.items.length > 0)).toBe(true);
      expect(reads.players['web:p1']!.items.length).toBeGreaterThan(3);
      expect(reads.players['web:nobody']).toStrictEqual({ playerId: 'web:nobody', total: 0, items: [] });
      expect(reads.leaderboard.map((r) => r.playerId)).toContain('web:p1');
      expect(withRawDb(join(dir, 'plain.sqlite'), decisionViolations)).toStrictEqual([]);
    });
  });

  it('NFR-57 (durability, M2b part) a kill before every transaction n: the database holds the transactions before n only, its rows are consistent, and the restarted server continues to the stored data, replies, events and public data of the uninterrupted run', () => {
    withTempDir((dir) => {
      const started = performance.now();
      const { run, before } = reference(dir);
      expect(run.txs.length).toBeGreaterThan(30);
      // A transaction that writes a row changes the database: the comparison with "before" is not vacuous.
      run.txs.forEach((tx, i) => {
        if (tx.writes.some((w) => w !== 'memoPurge')) expect(before[i + 1] === before[i], `transaction ${i + 1} (${tx.writes.join(', ')}) changed the database`).toBe(false);
      });
      console.log(`NFR-57 kill before each of ${run.txs.length} transactions: ${Math.round(performance.now() - started)} ms`);
    });
  }, 300_000);

  it('NFR-57 (durability, M2b part) a kill inside every transaction after each of its writes (and before its commit): nothing of the decision is stored, its rows are consistent, and the restarted server continues to the uninterrupted run', () => {
    withTempDir((dir) => {
      const { run, before } = reference(dir);
      const started = performance.now();
      let points = 0;
      run.txs.forEach((tx, i) => {
        const n = i + 1;
        for (let w = 0; w <= tx.writes.length; w++) {
          const killed = runScript(join(dir, `inside-${n}-${w}.sqlite`), { abortWrite: { transaction: n, afterWrites: w } });
          const where = `kill inside transaction ${n} after ${w} of its writes (${tx.writes.join(', ')})`;
          expect(killed.kill?.dump === before[i], `${where}: the database equals the one before the transaction`).toBe(true);
          expectSameContinuation(killed, run, where);
          points += 1;
        }
      });
      console.log(`NFR-57 kill inside transactions: ${points} points, ${Math.round(performance.now() - started)} ms`);
    });
  }, 600_000);
});

interface ChildEnd {
  /** Whether the child printed the line of its stop point (then the parent killed it there). */
  readonly reached: boolean;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Spawns the kill child on `file`, waits for the line of its stop point and kills exactly that child (SIGKILL; on
 * Windows Node terminates that one process). The child is node itself (no shell), so its PID is the process that holds
 * the database. A guard kills it if the line never comes; resolves once the process is gone and its pipes are closed.
 */
function killChildAt(file: string, mode: 'between' | 'inside', action: number): Promise<ChildEnd> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', KILL_CHILD, file, mode, String(action)], { cwd: SERVER_DIR, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const line = `${mode} ${action}\n`;
    let stdout = '';
    let stderr = '';
    let reached = false;
    const guard = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      if (!reached && stdout.includes(line)) {
        reached = true;
        child.kill('SIGKILL');
      }
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(guard);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(guard);
      resolve({ reached, code, signal, stdout, stderr });
    });
  });
}

describe('NFR-57 (durability, M2b part) a real process kill validates the fault seam', () => {
  for (const mode of ['between', 'inside'] as const) {
    it(`NFR-57 (durability, M2b part) a child process killed ${mode === 'between' ? 'between two decisions' : 'inside a decision (its transaction open)'} leaves the database the seam leaves at that point, and a new server recovers to the uninterrupted run`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'mbrg-kill-'));
      try {
        const reference = runScript(join(dir, 'reference.sqlite'));
        // The stop point: the application of round 1 by a clock tick (a purge transaction, then the step transaction
        // with the match row, the record, the results of the scripted absorber predictions, the step row and then the events).
        const k = reference.specs.findIndex((s) => s.kind === 'tick' && s.label === 'tick application r1');
        expect(k).toBeGreaterThan(0);
        const stepTx = reference.txs.findIndex((t) => t.action === k && t.writes.includes('appendEvents'));
        const firstTx = reference.txs.findIndex((t) => t.action === k);
        expect(reference.txs[stepTx]!.writes).toStrictEqual(['updateMatch', 'putRecord', 'putResults', 'putStep', 'appendEvents']);
        const plan: FaultPlan = mode === 'between' ? { abortTransaction: firstTx + 1 } : { abortWrite: { transaction: stepTx + 1, afterWrites: 4 } };
        const seam = runScript(join(dir, 'seam.sqlite'), plan);
        expect(seam.kill?.action).toBe(k);

        const file = join(dir, 'killed.sqlite');
        const end = await killChildAt(file, mode, k);
        expect(end.reached, `the child reached its stop point (stdout: ${end.stdout}; stderr: ${end.stderr})`).toBe(true);
        expect(end.stdout).not.toContain('not killed');
        expect(end.stdout).toContain(`done ${k - 1}\n`);
        expect(end.stdout).not.toContain(`done ${k}\n`);
        expect(end.code === 0 || end.code === 3 || end.code === 4, `exit code ${String(end.code)}, signal ${String(end.signal)}`).toBe(false);
        console.log(`NFR-57 real kill (${mode}, action ${k}): exit code ${String(end.code)}, signal ${String(end.signal)}`);

        // Fidelity: the real kill leaves exactly the database of the seam's kill at the same point.
        const killedDump = withRawDb(file, dumpRows);
        expect(withRawDb(file, decisionViolations)).toStrictEqual([]);
        expect(killedDump === seam.kill!.dump, 'the killed database equals the seam kill database').toBe(true);
        const storedEvents = withRawDb(file, (db) => Number(db.prepare('SELECT COUNT(*) AS n FROM events').get()?.n));
        expect(storedEvents).toBeGreaterThan(1);

        // Recovery: a new server on the killed file starts and runs the rest of the script, from the action in flight.
        const clock = fakeClock(START_MS);
        const published: MatchEvent[] = [];
        const service = serviceOn(openChecked(file), clock, file);
        service.subscribe((_, events) => published.push(...events));
        try {
          clock.set(reference.specs[k]!.at);
          service.start();
          const replies: (string | null)[] = [];
          for (const spec of reference.specs.slice(k)) {
            clock.set(spec.at);
            const reply = perform(service, spec);
            replies.push(spec.kind === 'tick' ? null : JSON.stringify(reply));
          }
          expect(replies).toStrictEqual(reference.replies.slice(k));
          const matchId = (JSON.parse(reference.replies[0]!) as { reply: { matchId: string } }).reply.matchId;
          expect(encodePublicMatch(service.publicMatch(matchId)!)).toBe(reference.publicMatch);
          // What the new server published is the reference's events after those the killed one had stored.
          expect(published).toStrictEqual(reference.published.slice(storedEvents));
        } finally {
          service.close();
        }
        expect(withRawDb(file, dumpRows) === reference.dump, 'the recovered database equals the uninterrupted one').toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    }, 120_000);
  }
});
