// The closed log of the server (spec 008 NFR-54 logs, plan 18.7, PD17). One JSON line per event; the union below is closed.
// - An event has no field that can hold a message, a credential, a token, a secret, a round seed, a player id, a choice, a
//   path, a query or a body. A thrown value is described by `describeError`: its NAME (only when a plain identifier), a
//   `code` from a closed shape, the SQLite result code NUMBER, and the same for its cause chain (depth 3). Never its message
//   (it may quote values; Node's JSON errors quote the input), its stack (a message can forge frame lines), or the SQLite
//   text (a number identifies it). Decision of T4': plan 18.7 also listed `errstr` and stack frames; both are left out.
// - There is no timestamp (the platform stamps the lines) and no per-request access log: client errors and the expected 503
//   of a storage failure are not logged per request; the failure of a clock step and any 500 are.
// - Lifecycle events go to stdout, failures to stderr (`streamOf`). The sink takes two writers, so this module never touches
//   the process itself (`main.ts` passes `process.stdout.write` and `process.stderr.write`).
// - A clock step that keeps failing (a persistent `invalid-write`, retried every 3 s) is reported by `createFailureReporter`
//   under the rate rule below, so the log shows it without flooding.

import type { Clock } from '../clock';
import type { StartReport, StepFailure } from '../service/matches';

/** The pipeline stage an exception came out of (a closed set: no text of the request). */
export type FailureStage = 'admit' | 'route' | 'body' | 'shape' | 'authorize' | 'limit' | 'decide' | 'reply';

/** A thrown value as the log sees it: closed fields only. */
export interface ErrorDescription {
  readonly name: string;
  /** An upper-case identifier (`ERR_SQLITE_ERROR`, `ENOENT`) or one of the four store codes. */
  readonly code?: string;
  /** The SQLite result code (extended codes included), a number. */
  readonly sqlite?: number;
  /** The cause, described the same way (the chain stops at depth `MAX_CAUSE_DEPTH`). */
  readonly cause?: ErrorDescription;
}

export interface RequestFailedEvent {
  readonly event: 'request-failed';
  readonly stage: FailureStage;
  readonly error: ErrorDescription;
}

export interface ListeningEvent {
  readonly event: 'listening';
  readonly port: number;
}

/** What `start()` did, as counts. */
export interface StartReportEvent {
  readonly event: 'start-report';
  readonly purged: number;
  readonly performed: number;
  readonly failed: number;
  readonly halted: number;
  readonly retry: boolean;
}

/** A clock step that failed; `suppressed` is how many repeats of the same (match, kind) the rate rule skipped since the last event. */
export interface StepFailedEvent {
  readonly event: 'step-failed';
  readonly kind: StepFailure['kind'];
  readonly matchId?: string;
  readonly suppressed: number;
  readonly error: ErrorDescription;
}

export interface ListenFailedEvent {
  readonly event: 'listen-failed';
  readonly code?: string;
}

export type FatalSource = 'uncaughtException' | 'unhandledRejection' | 'server-error' | 'open-store' | 'start' | 'shutdown';

export interface FatalEvent {
  readonly event: 'fatal';
  readonly source: FatalSource;
  readonly error: ErrorDescription;
}

export type ShutdownReason = 'SIGINT' | 'SIGTERM' | 'fatal' | 'listen-failed';

export interface ShutdownStartEvent {
  readonly event: 'shutdown-start';
  readonly reason: ShutdownReason;
}

/** `forced`: the grace period ended and the remaining connections were destroyed. */
export interface ShutdownDoneEvent {
  readonly event: 'shutdown-done';
  readonly forced: boolean;
}

/** A second signal (or a second fatal error) during a shutdown: the process leaves at once with code 1. */
export interface ShutdownForcedEvent {
  readonly event: 'shutdown-forced';
}

/** Every event the server can log (closed). */
export type LogEvent =
  | RequestFailedEvent
  | ListeningEvent
  | StartReportEvent
  | StepFailedEvent
  | ListenFailedEvent
  | FatalEvent
  | ShutdownStartEvent
  | ShutdownDoneEvent
  | ShutdownForcedEvent;

/** Where events go: injected, never a global. */
export type LogSink = (event: LogEvent) => void;

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const UPPER_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const STORE_CODES: ReadonlySet<string> = new Set(['unknown-schema-version', 'database-locked', 'store-failure', 'invalid-write']);
const MATCH_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** How many levels of a cause chain are described (the error itself is level 1). */
export const MAX_CAUSE_DEPTH = 3;

/** The class name of a thrown value, or `Error` when it has none that is a plain identifier, or `NonError` for a non-object. */
export function errorName(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'NonError';
  let name: unknown;
  try {
    name = (error as { name?: unknown }).name;
  } catch {
    return 'Error';
  }
  return typeof name === 'string' && IDENTIFIER.test(name) ? name : 'Error';
}

/** A property of a thrown object; a getter that throws gives nothing. */
const fieldOf = (error: object, key: string): unknown => {
  try {
    return (error as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
};

const describeAt = (error: unknown, level: number): ErrorDescription => {
  const name = errorName(error);
  if (typeof error !== 'object' || error === null) return { name };
  const code = fieldOf(error, 'code');
  const sqliteCode = fieldOf(error, 'sqliteCode') ?? fieldOf(error, 'errcode');
  const cause = level < MAX_CAUSE_DEPTH && fieldOf(error, 'cause') !== undefined ? describeAt(fieldOf(error, 'cause'), level + 1) : undefined;
  return {
    name,
    ...(typeof code === 'string' && (UPPER_CODE.test(code) || STORE_CODES.has(code)) ? { code } : {}),
    ...(typeof sqliteCode === 'number' && Number.isSafeInteger(sqliteCode) && sqliteCode >= 0 && sqliteCode <= 0xffffffff ? { sqlite: sqliteCode } : {}),
    ...(cause === undefined ? {} : { cause }),
  };
};

/** A thrown value as closed fields (see the header): its name, code and SQLite number, and the same for its cause chain. */
export const describeError = (error: unknown): ErrorDescription => describeAt(error, 1);

/** The `request-failed` event of a thrown value: its description and the stage, never its message. */
export function requestFailed(error: unknown, stage: FailureStage): RequestFailedEvent {
  return { event: 'request-failed', stage, error: describeError(error) };
}

/** The `start-report` event: only counts. */
export function startReportEvent(report: StartReport): StartReportEvent {
  return {
    event: 'start-report',
    purged: report.purged,
    performed: report.performed.length,
    failed: report.failed.length,
    halted: report.halted.length,
    retry: report.retry !== undefined,
  };
}

/** The listen error code (`EADDRINUSE`), when it is an upper-case identifier. */
export function listenFailed(error: unknown): ListenFailedEvent {
  const code = typeof error === 'object' && error !== null ? fieldOf(error, 'code') : undefined;
  return typeof code === 'string' && UPPER_CODE.test(code) ? { event: 'listen-failed', code } : { event: 'listen-failed' };
}

export type LogStream = 'stdout' | 'stderr';

/** Lifecycle events are stdout; everything that reports a failure is stderr. */
export function streamOf(event: LogEvent): LogStream {
  switch (event.event) {
    case 'listening':
    case 'start-report':
    case 'shutdown-start':
    case 'shutdown-done':
      return 'stdout';
    default:
      return 'stderr';
  }
}

/** The sink: one JSON line per event to the writer of its stream. */
export function createLineLog(stdout: (line: string) => void, stderr: (line: string) => void): LogSink {
  return (event) => {
    const line = `${JSON.stringify(event)}\n`;
    if (streamOf(event) === 'stdout') stdout(line);
    else stderr(line);
  };
}

/** The most often one (match, kind) is reported while it keeps failing. */
export const REPEAT_LOG_MS = 60_000;
/** A (match, kind) not seen for this long is forgotten (memory follows the matches that failed lately). */
const FORGET_MS = 10 * REPEAT_LOG_MS;

export interface FailureReporter {
  /** The `onFailure` option of the service: `(failure, cause)`. */
  (failure: StepFailure, cause: unknown): void;
}

/**
 * Rate rule of the step failures: the first failure of a match is reported at once; a failure of another kind (a storage
 * failure that became an error, or the reverse) is reported at once; a repeat of the same kind is reported at most once per
 * `REPEAT_LOG_MS`, carrying how many repeats were skipped since (`suppressed`). A step retried every 3 s thus shows in the
 * log once a minute while it lasts. A clock that went backwards reports at once.
 */
export function createFailureReporter(log: LogSink, clock: Clock): FailureReporter {
  const seen = new Map<string, { kind: StepFailure['kind']; at: number; suppressed: number }>();
  return (failure, cause) => {
    const now = clock.now();
    const key = failure.matchId;
    const entry = seen.get(key);
    if (entry !== undefined && entry.kind === failure.kind && now >= entry.at && now - entry.at < REPEAT_LOG_MS) {
      entry.suppressed += 1;
      return;
    }
    const suppressed = entry !== undefined && entry.kind === failure.kind ? entry.suppressed : 0;
    for (const [id, old] of seen) if (now - old.at > FORGET_MS) seen.delete(id);
    seen.set(key, { kind: failure.kind, at: now, suppressed: 0 });
    log({
      event: 'step-failed',
      kind: failure.kind,
      ...(MATCH_ID.test(failure.matchId) ? { matchId: failure.matchId } : {}),
      suppressed,
      error: describeError(cause),
    });
  };
}
