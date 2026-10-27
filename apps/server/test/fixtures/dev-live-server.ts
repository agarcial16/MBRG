// HAND-RUN local fixture (spec 008 M5' T6', H12): the real HTTP server over the real service with the FAKE clock, a fixed fake
// random seed and an in-memory store, for looking at the live viewer and the web test client by hand. It is not an entry point
// of the product (FR-260, NFR-47 (f) unchanged) and no test runs it.
//
//   cd apps/server
//   node --import tsx test/fixtures/dev-live-server.ts [manual|clock|auto] [port]
//
// It creates one dev-map match (timing `manual`, or the clock timing (`clock`: you move it with `tick`; `auto`: it runs in real time) I = 120 s, L1 = 30 s, L2 = 10 s), listens on the port
// (default 8787, the viewer's development default), prints the viewer and client addresses and the credential line for
// `apps/web/.env.local`, then reads commands from standard input, one per line:
//   tick <seconds>   moves the fake clock forward, firing the match's steps and the stream heartbeat on the way
//   advance          one operator step of the manual match (phase-1 close, phase-2 close or application)
//   break-map        edits the served copy of the map: the next step halts the match (map-changed), the viewer's digest check fails
//                    for a page loaded afterwards
//   quit             stops the server and exits
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { productionRoutes } from '../../src/http/server';
import { DEV_DIR } from '../helpers/digests';
import { advanceSteps, makeMatch } from '../helpers/http-reads-kit';
import { CLIENT_CREDENTIAL, startServer } from '../helpers/server-harness';

const mode = process.argv[2] === 'auto' ? 'auto' : process.argv[2] === 'clock' ? 'clock' : 'manual';
const port = Number(process.argv[3] ?? 8787);
const ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

const dir = mkdtempSync(join(tmpdir(), 'mbrg-dev-live-'));
const folder = join(dir, 'dev');
mkdirSync(folder);
for (const file of ['map.json', 'ids.png', 'presentation.json']) copyFileSync(join(DEV_DIR, file), join(folder, file));

const h = await startServer({
  routes: productionRoutes,
  port,
  allowedOrigins: ORIGINS,
  service: { scheduler: true, seed: 42, folders: { dev: folder } },
  limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, advances: 100_000, submissions: 100_000, streams: 100_000, anonymousStreams: 100_000 },
});
const { id } = makeMatch(h, 'dev-live', { timing: mode === 'manual' ? 'manual' : { i: 120, l1: 30, l2: 10 } });

const out = (text: string): void => void process.stdout.write(`${text}\n`);
out(`server   http://127.0.0.1:${h.port}`);
out(`match    ${id} (${mode})`);
out(`viewer   http://localhost:5173/?match=${id}`);
out(`client   http://localhost:5173/client.html?match=${id}`);
out('env      apps/web/.env.local needs:');
out(`           VITE_MBRG_WEB_CREDENTIAL=${CLIENT_CREDENTIAL}`);
out('commands tick <seconds> | advance | break-map | quit');

const stop = async (): Promise<void> => {
  await h.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  process.exit(0);
};

// `auto`: the fake clock follows real time, one second per second, so the match runs by itself like the real one (the commands still work).
if (mode === 'auto') {
  setInterval(() => {
    const target = h.clock.now() + 1000;
    h.base.scheduler?.runTo(target);
    h.scheduler.runTo(target);
  }, 1000);
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const [command, argument] = line.trim().split(/\s+/);
  try {
    if (command === 'tick') {
      const seconds = Number(argument);
      if (!Number.isFinite(seconds) || seconds < 0) return out('tick needs a number of seconds');
      const target = h.clock.now() + seconds * 1000;
      h.base.scheduler?.runTo(target);
      h.scheduler.runTo(target);
      out(`clock +${seconds} s`);
    } else if (command === 'advance') {
      advanceSteps(h, id, 1);
      out('advanced one step');
    } else if (command === 'break-map') {
      writeFileSync(join(folder, 'map.json'), `${readFileSync(join(DEV_DIR, 'map.json'), 'utf8')} `);
      out('map edited: the next step halts the match');
    } else if (command === 'quit') {
      void stop();
    } else if (command !== undefined && command !== '') {
      out(`unknown command: ${command}`);
    }
  } catch (error) {
    out(`failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
});
lines.on('close', () => void stop());
