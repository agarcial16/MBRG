// Child process of the real kill test (spec 008 NFR-57, M2b' T6'). It runs the durability script
// (helpers/durability-script.ts) on the database file given as the first argument and stops at a controlled point,
// where it prints one line and blocks (no timer, no event loop turn: the parent kills it there):
// - `between <k>`: actions 0..k-1 are committed and action k has not started (a kill between two decisions);
// - `inside <k>`: inside the step transaction of action k, after its earlier writes and before its events are written
//   (a kill in the middle of a decision; the transaction is open and uncommitted).
// Lines go to stdout with a synchronous write, so they are out before the block. If nobody kills it, it gives up after
// 120 s and exits with code 3 (code 4 when the script ends without reaching the point). Run with `node --import tsx`.
import { writeSync } from 'node:fs';
import { openStore } from '../../src/store/sqlite';
import type { Store } from '../../src/store/store';
import { perform, scriptCursor, serviceOn } from '../helpers/durability-script';
import { fakeClock } from '../helpers/fake-clock';
import { CLOCK_TIMING, OPERATOR, START_MS, creationBody } from '../helpers/service-harness';

const [file, mode, at] = process.argv.slice(2);
const k = Number(at);

/** Prints the line and blocks the only thread until the parent kills the process. */
const hold = (line: string): never => {
  writeSync(1, `${line}\n`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120_000);
  writeSync(1, 'not killed\n');
  process.exit(3);
};

/** The clock reading of the restarted server in `late-start`: long after the first anchor (C1 = +80 s) of the match. */
const LATE_START_OFFSET_MS = 500_000;

/**
 * M3b' T3': a kill after the COMMIT of a decision and before its publication reaches anyone (a stream hub subscribes after
 * the listener registered here, and listeners run in registration order). Prints `created <matchId>` first.
 * - `after-commit`: the phase-1 close of a clock match at C1 (the clock tick of a running server);
 * - `late-start`: a server restarted long after C1; the late phase-1 close is performed by `start()`.
 */
function holdAtPublication(path: string, kind: 'after-commit' | 'late-start'): never {
  const clock = fakeClock(START_MS);
  let service = serviceOn(openStore(path), clock, path);
  const created = service.create({ credential: OPERATOR, body: creationBody('c-1', { timing: { ...CLOCK_TIMING } }) });
  if (!created.ok) {
    writeSync(2, 'creation failed\n');
    process.exit(2);
  }
  writeSync(1, `created ${created.reply.matchId}\n`);
  if (kind === 'late-start') {
    service.close();
    clock.set(START_MS + LATE_START_OFFSET_MS);
    service = serviceOn(openStore(path), clock, path);
  } else {
    clock.set(START_MS + 80_000);
  }
  service.subscribe((_matchId, events) => hold(`published ${events.map((e) => e.seq).join(',')}`));
  if (kind === 'after-commit') service.tick();
  else service.start();
  writeSync(1, 'not held\n');
  process.exit(4);
}

if (file !== undefined && (mode === 'after-commit' || mode === 'late-start')) holdAtPublication(file, mode);
if (file === undefined || (mode !== 'between' && mode !== 'inside') || !Number.isInteger(k)) {
  writeSync(2, 'usage: kill-child <file> between|inside <action> | after-commit | late-start\n');
  process.exit(2);
}

const base = openStore(file);
const state = { action: -1 };
const store: Store =
  mode === 'inside'
    ? {
        ...base,
        appendEvents(matchId, events) {
          if (state.action === k) hold(`inside ${k}`);
          base.appendEvents(matchId, events);
        },
      }
    : base;

const clock = fakeClock(START_MS);
const service = serviceOn(store, clock, file);
const cursor = scriptCursor();
for (let i = 0; ; i++) {
  const spec = cursor.next(service);
  if (spec === undefined) break;
  if (mode === 'between' && i === k) hold(`between ${k}`);
  state.action = i;
  clock.set(spec.at);
  cursor.after(spec, perform(service, spec));
  writeSync(1, `done ${i}\n`);
}
writeSync(1, 'finished\n');
service.close();
process.exit(4);
