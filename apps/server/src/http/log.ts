// The closed log of the HTTP layer (spec 008 NFR-54 logs, plan 18.7, PD17). T2'a holds only what the pipeline needs: the
// `request-failed` event of an unexpected exception. The full union (`listening`, `step-failed`, `shutdown`, `fatal`, ...),
// the JSON-line sink and `describeError` (frames, SQLite codes) arrive in T4'.
// - An event has no field that can hold a message, a cause, a credential, a token, a secret, a round seed, a player id, a
//   path, a query or a body: the error is described by its NAME alone, and only when the name is a plain identifier.
// - There is no timestamp (the sink of T4' adds none either: the platform stamps lines) and no per-request access log.

/** The pipeline stage an exception came out of (a closed set: no text of the request). */
export type FailureStage = 'admit' | 'route' | 'body' | 'shape' | 'authorize' | 'limit' | 'decide' | 'reply';

export interface RequestFailedEvent {
  readonly event: 'request-failed';
  readonly stage: FailureStage;
  readonly error: { readonly name: string };
}

/** Every event the HTTP layer can log (closed; T4' widens it). */
export type LogEvent = RequestFailedEvent;

/** Where events go: injected, never a global (`main.ts` renders them as JSON lines in T4'). */
export type LogSink = (event: LogEvent) => void;

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** The class name of a thrown value, or `Error` when it has none that is a plain identifier, or `NonError` for a non-object. */
export function errorName(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'NonError';
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' && IDENTIFIER.test(name) ? name : 'Error';
}

/** The `request-failed` event of a thrown value: its name and the stage, never its message or its cause. */
export function requestFailed(error: unknown, stage: FailureStage): RequestFailedEvent {
  return { event: 'request-failed', stage, error: { name: errorName(error) } };
}
