// Server entry point (spec 008). Runs under `tsx` (plan section 7). `--check` proves the platform: the workspace links to
// `@mbrg/sim` and `@mbrg/shared`, and the store (the only user of `node:sqlite`). Without it, the entry point reads the
// SETTINGS (FR-260, NFR-47 (f): it passes no round-seed source and reads no variable that could set one), opens the store,
// builds the lifecycle service and the HTTP listener, calls `service.start()` (FR-239, FR-294), listens on the configured
// host and port, and shuts down gracefully on SIGINT and SIGTERM (plan 18.8). It is the only module that reads the
// environment and the process; it logs only the closed events of `http/log.ts` (JSON lines) and the names of invalid settings.
import { systemClock } from './clock';
import { createServer } from './http/server';
import { createFailureReporter, createLineLog, describeError, listenFailed, startReportEvent } from './http/log';
import { createShutdown, wireProcess } from './http/shutdown';
import { createStreamHub } from './http/streams';
import { createMapCatalog } from './service/maps';
import { createMatchService } from './service/matches';
import { createScheduler } from './service/scheduler';
import { SHUTDOWN_GRACE_MS, readSettings } from './service/settings';
import type { Store } from './store/store';
import { installWarningFilter } from './warnings';

// Before the dynamic import of the store, whose load of node:sqlite emits the ExperimentalWarning (NFR-53).
installWarningFilter();

const check = async (): Promise<void> => {
  const sim = await import('@mbrg/sim');
  const shared = await import('@mbrg/shared');
  const { openStore } = await import('./store/sqlite');
  const exported = [sim.playRoundWithSeed, sim.absorptionCandidatesOf, sim.livingFactions, sim.getState];
  if (!exported.every((f) => typeof f === 'function')) throw new Error('@mbrg/sim exports are missing');
  if (Object.keys(shared).length === 0) throw new Error('@mbrg/shared exports are missing');
  const store = openStore(':memory:');
  try {
    if (store.settings().userVersion !== 2) throw new Error('the store did not create schema version 2');
  } finally {
    store.close();
  }
  console.log('check ok');
};

/** Leaves once what was written is flushed (an exit right after a write can cut a pipe). */
const exitFlushed = (code: number): void => {
  process.exitCode = code;
  process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));
};

const start = async (): Promise<void> => {
  const read = readSettings(process.env);
  if (!read.ok) {
    console.error(`invalid settings: ${read.problems.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const { settings } = read;
  const log = createLineLog(
    (line) => void process.stdout.write(line),
    (line) => void process.stderr.write(line),
  );
  const { openStore } = await import('./store/sqlite');
  let store: Store;
  try {
    store = openStore(settings.databasePath);
  } catch (error) {
    log({ event: 'fatal', source: 'open-store', error: describeError(error) });
    process.exitCode = 1;
    return;
  }
  const clock = systemClock;
  const scheduler = createScheduler(clock);
  const onFailure = createFailureReporter(log, clock);
  const service = createMatchService({ store, clock, maps: createMapCatalog(settings.maps), settings, scheduler, onFailure });
  const streams = createStreamHub({ service, scheduler, clock });
  const server = createServer({ service, settings, clock, log, streams });
  const shutdown = createShutdown({ server, service, scheduler, clock, log, exit: exitFlushed, graceMs: SHUTDOWN_GRACE_MS, streams });
  wireProcess(process, shutdown, log);
  server.on('error', (error) => {
    if (server.listening) {
      log({ event: 'fatal', source: 'server-error', error: describeError(error) });
      shutdown.begin('fatal', 1);
    } else {
      log(listenFailed(error));
      shutdown.begin('listen-failed', 1);
    }
  });
  try {
    log(startReportEvent(service.start()));
  } catch (error) {
    log({ event: 'fatal', source: 'start', error: describeError(error) });
    shutdown.begin('fatal', 1);
    return;
  }
  server.listen(settings.port, settings.host, () => {
    const address = server.address();
    if (address !== null && typeof address === 'object') log({ event: 'listening', port: address.port });
  });
};

if (process.argv.includes('--check')) {
  await check();
} else {
  await start();
}
