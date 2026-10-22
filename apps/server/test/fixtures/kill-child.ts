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
import { START_MS } from '../helpers/service-harness';

const [file, mode, at] = process.argv.slice(2);
const k = Number(at);
if (file === undefined || (mode !== 'between' && mode !== 'inside') || !Number.isInteger(k)) {
  writeSync(2, 'usage: kill-child <file> between|inside <action>\n');
  process.exit(2);
}

/** Prints the line and blocks the only thread until the parent kills the process. */
const hold = (line: string): never => {
  writeSync(1, `${line}\n`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120_000);
  writeSync(1, 'not killed\n');
  process.exit(3);
};

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
