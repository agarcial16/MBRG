// Graceful shutdown and the process wiring (spec 008 FR-239 (wired), NFR-54 logs; plan 18.8). Everything the platform
// provides is injected (the listener, the service, the scheduler and clock, the log, `exit`, the process emitter), so the
// whole thing is tested in process with fakes; only `main.ts` passes the real ones.
//
// Shutdown: stop accepting, close the idle keep-alive connections (and each connection that becomes idle as its request
// ends), let the requests in flight finish for at most `graceMs` (armed through the scheduler interface: timers stay in
// `scheduler.ts`), then destroy what is left, `service.close()` once (it cancels every wake-up and closes the store, which
// releases the file), log `shutdown-done`, and exit with the code of the cause (0 for a signal, 1 for a fatal error or a
// listen failure). A second trigger during a shutdown (a second signal, a fatal error) does not wait: it destroys the
// connections, closes the service if that did not happen yet, logs `shutdown-forced` and exits with 1.

import type { Server } from 'node:http';
import type { Clock } from '../clock';
import type { Scheduler, SchedulerHandle } from '../service/scheduler';
import { describeError } from './log';
import type { LogSink, ShutdownReason } from './log';

export interface ShutdownDeps {
  readonly server: Server;
  /** Only `close` is used: it cancels the service's wake-ups and closes the store. */
  readonly service: { close(): void };
  readonly scheduler: Scheduler;
  readonly clock: Clock;
  readonly log: LogSink;
  /** Leaves the process (`main.ts` flushes the output first). */
  readonly exit: (code: number) => void;
  /** How long a shutdown waits for requests in flight (SHUTDOWN_GRACE_MS). */
  readonly graceMs: number;
}

export interface Shutdown {
  /** Starts the shutdown (the first call), or forces it (any later call). */
  begin(reason: ShutdownReason, code: number): void;
  readonly phase: () => 'running' | 'closing' | 'done';
}

export function createShutdown(deps: ShutdownDeps): Shutdown {
  const { server, service, scheduler, clock, log, exit, graceMs } = deps;
  let phase: 'running' | 'closing' | 'done' = 'running';
  let exitCode = 0;
  let grace: SchedulerHandle | undefined;
  let serviceClosed = false;

  // A request that ends during the shutdown leaves an idle keep-alive connection behind: close it now, not at its timeout.
  server.on('request', (_req, res) => {
    res.once('close', () => {
      if (phase === 'closing') server.closeIdleConnections();
    });
  });

  const closeServiceOnce = (): void => {
    if (serviceClosed) return;
    serviceClosed = true;
    try {
      service.close();
    } catch (error) {
      exitCode = 1;
      log({ event: 'fatal', source: 'shutdown', error: describeError(error) });
    }
  };

  const disarmGrace = (): void => {
    if (grace !== undefined) scheduler.cancel(grace);
    grace = undefined;
  };

  const finish = (forced: boolean): void => {
    if (phase === 'done') return;
    phase = 'done';
    disarmGrace();
    closeServiceOnce();
    log({ event: 'shutdown-done', forced });
    exit(exitCode);
  };

  const forceNow = (): void => {
    if (phase === 'done') return;
    phase = 'done';
    disarmGrace();
    log({ event: 'shutdown-forced' });
    server.closeAllConnections();
    closeServiceOnce();
    exit(1);
  };

  return {
    phase: () => phase,
    begin(reason, code) {
      if (phase === 'done') return;
      if (phase === 'closing') return forceNow();
      phase = 'closing';
      exitCode = code;
      log({ event: 'shutdown-start', reason });
      grace = scheduler.at(clock.now() + graceMs, () => {
        grace = undefined;
        server.closeAllConnections();
        finish(true);
      });
      if (server.listening) {
        server.close(() => finish(false));
        server.closeIdleConnections();
      } else {
        finish(false);
      }
    },
  };
}

/** What the wiring needs of the process: an emitter (`process` itself, or a fake in the tests). */
export type ProcessLike = Pick<NodeJS.EventEmitter, 'on'>;

/**
 * `SIGINT` and `SIGTERM` start a shutdown with exit code 0; `uncaughtException` and `unhandledRejection` log `fatal` (the
 * closed description of the error, never its message) and start a shutdown with exit code 1. Handlers stay installed, so a
 * second signal forces the exit.
 */
export function wireProcess(proc: ProcessLike, shutdown: Shutdown, log: LogSink): void {
  proc.on('SIGINT', () => shutdown.begin('SIGINT', 0));
  proc.on('SIGTERM', () => shutdown.begin('SIGTERM', 0));
  proc.on('uncaughtException', (error: unknown) => {
    log({ event: 'fatal', source: 'uncaughtException', error: describeError(error) });
    shutdown.begin('fatal', 1);
  });
  proc.on('unhandledRejection', (reason: unknown) => {
    log({ event: 'fatal', source: 'unhandledRejection', error: describeError(reason) });
    shutdown.begin('fatal', 1);
  });
}
