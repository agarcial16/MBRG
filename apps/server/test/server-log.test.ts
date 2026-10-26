import { describe, expect, it } from 'vitest';
import { MAX_CAUSE_DEPTH, REPEAT_LOG_MS, createFailureReporter, createLineLog, describeError, listenFailed, requestFailed, startReportEvent, streamOf } from '../src/http/log';
import type { LogEvent } from '../src/http/log';
import { StoreError } from '../src/store/store';
import { fakeClock } from './helpers/fake-clock';

// NFR-54 (logs): the closed log. A thrown value is described by closed fields (name, code, SQLite number, cause chain) and
// never by its message; one JSON line per event; lifecycle on stdout, failures on stderr; a step that keeps failing is
// reported under the rate rule (one event per (match, kind), then at most one per REPEAT_LOG_MS).

const PLANTED = 'planted-secret-value-7f3a9c';
const CREDENTIAL = 'client-credential-web-0123456789ab';
const BODY_TEXT = '{"requestId":"planted-body-text"}';

describe('describeError', () => {
  it('NFR-54 (logs) never outputs a message: an error quoting a secret, a credential and body text gives only its name', () => {
    const error = new SyntaxError(`Unexpected token in JSON at position 3: ${BODY_TEXT} ${PLANTED} ${CREDENTIAL}`);
    expect(describeError(error)).toStrictEqual({ name: 'SyntaxError' });
    const text = JSON.stringify(requestFailed(error, 'body'));
    for (const planted of [PLANTED, CREDENTIAL, 'planted-body-text', 'Unexpected token']) expect(text).not.toContain(planted);
    // The stack is not described either (its first line holds the message).
    expect(JSON.stringify(describeError(error))).not.toContain('at ');
  });

  it('NFR-54 (logs) keeps the store code and the SQLite result code number of a native error, not its text, and describes the cause', () => {
    const native = Object.assign(new Error(`database is locked ${PLANTED}`), { code: 'ERR_SQLITE_ERROR', errcode: 5, errstr: `text with ${PLANTED}` });
    const wrapped = new StoreError('database-locked', 'the database is locked (result code 5)', { cause: native, sqliteCode: 5, sqliteText: PLANTED });
    expect(describeError(wrapped)).toStrictEqual({ name: 'StoreError', code: 'database-locked', sqlite: 5, cause: { name: 'Error', code: 'ERR_SQLITE_ERROR', sqlite: 5 } });
    expect(JSON.stringify(describeError(wrapped))).not.toContain(PLANTED);
  });

  it('NFR-54 (logs) takes a code only from a closed shape, a name only when it is an identifier, and a number only when it is a result code', () => {
    expect(describeError(Object.assign(new Error('x'), { code: PLANTED }))).toStrictEqual({ name: 'Error' });
    expect(describeError(Object.assign(new Error('x'), { code: 'ENOENT' }))).toStrictEqual({ name: 'Error', code: 'ENOENT' });
    expect(describeError(Object.assign(new Error('x'), { errcode: -1 }))).toStrictEqual({ name: 'Error' });
    expect(describeError(Object.assign(new Error('x'), { errcode: 1.5 }))).toStrictEqual({ name: 'Error' });
    expect(describeError(Object.assign(new Error('x'), { name: `has space ${PLANTED}` }))).toStrictEqual({ name: 'Error' });
    expect(describeError(PLANTED)).toStrictEqual({ name: 'NonError' });
    expect(describeError(undefined)).toStrictEqual({ name: 'NonError' });
    expect(describeError({ name: 'Custom_Error1' })).toStrictEqual({ name: 'Custom_Error1' });
  });

  it('NFR-54 (logs) limits the cause chain to its depth, survives a cycle and a getter that throws', () => {
    let chain: unknown = new RangeError('deepest');
    for (let i = 0; i < 8; i += 1) chain = new Error(`level ${i}`, { cause: chain });
    let depth = 0;
    for (let d: { cause?: unknown } | undefined = describeError(chain); d !== undefined; d = d.cause as { cause?: unknown } | undefined) depth += 1;
    expect(MAX_CAUSE_DEPTH).toBe(3);
    expect(depth).toBe(MAX_CAUSE_DEPTH);
    const loop: { name: string; cause?: unknown } = { name: 'Loop' };
    loop.cause = loop;
    expect(JSON.stringify(describeError(loop)).match(/Loop/g)).toHaveLength(MAX_CAUSE_DEPTH);
    const hostile = {
      get name(): string {
        throw new Error(PLANTED);
      },
      get code(): string {
        throw new Error(PLANTED);
      },
    };
    expect(describeError(hostile)).toStrictEqual({ name: 'Error' });
  });
});

describe('the line sink', () => {
  const EVENTS: LogEvent[] = [
    { event: 'listening', port: 8787 },
    { event: 'start-report', purged: 0, performed: 1, failed: 0, halted: 0, retry: false },
    { event: 'shutdown-start', reason: 'SIGTERM' },
    { event: 'shutdown-done', forced: false },
    { event: 'request-failed', stage: 'decide', error: { name: 'TypeError' } },
    { event: 'step-failed', kind: 'error', matchId: 'abc', suppressed: 0, error: { name: 'StoreError', code: 'invalid-write', sqlite: 19 } },
    { event: 'listen-failed', code: 'EADDRINUSE' },
    { event: 'fatal', source: 'uncaughtException', error: { name: 'Error' } },
    { event: 'shutdown-forced' },
  ];

  it('NFR-54 (logs) writes one JSON line per event, lifecycle events to stdout and failures to stderr, with no timestamp', () => {
    const out: string[] = [];
    const err: string[] = [];
    const log = createLineLog((l) => out.push(l), (l) => err.push(l));
    for (const event of EVENTS) log(event);
    expect(out.map((l) => (JSON.parse(l) as LogEvent).event)).toStrictEqual(['listening', 'start-report', 'shutdown-start', 'shutdown-done']);
    expect(err.map((l) => (JSON.parse(l) as LogEvent).event)).toStrictEqual(['request-failed', 'step-failed', 'listen-failed', 'fatal', 'shutdown-forced']);
    for (const line of [...out, ...err]) {
      expect(line.endsWith('\n')).toBe(true);
      expect(line.slice(0, -1)).not.toContain('\n');
      expect(Object.keys(JSON.parse(line) as object)).not.toContain('time');
      expect(Object.keys(JSON.parse(line) as object)).not.toContain('timestamp');
    }
    expect(EVENTS.map(streamOf).filter((s) => s === 'stdout')).toHaveLength(4);
    // Round trip: the line is the event.
    expect(JSON.parse(out[0]!)).toStrictEqual(EVENTS[0]);
  });

  it('NFR-54 (logs) the start report event holds counts only and the listen failure only an upper-case code', () => {
    const report = { purged: 2, performed: [{ matchId: 'm1', steps: [] }], failed: [{ matchId: 'm2', kind: 'error' as const }], halted: ['m3', 'm4'], retry: { kind: 'unavailable' as const, at: 5 } };
    expect(startReportEvent(report)).toStrictEqual({ event: 'start-report', purged: 2, performed: 1, failed: 1, halted: 2, retry: true });
    expect(startReportEvent({ ...report, retry: undefined }).retry).toBe(false);
    expect(listenFailed(Object.assign(new Error(PLANTED), { code: 'EADDRINUSE' }))).toStrictEqual({ event: 'listen-failed', code: 'EADDRINUSE' });
    expect(listenFailed(Object.assign(new Error(PLANTED), { code: PLANTED }))).toStrictEqual({ event: 'listen-failed' });
  });
});

describe('the step failure reporter (rate rule)', () => {
  const setup = (): { clock: ReturnType<typeof fakeClock>; events: Extract<LogEvent, { event: 'step-failed' }>[]; report: ReturnType<typeof createFailureReporter> } => {
    const clock = fakeClock(1_000_000);
    const events: Extract<LogEvent, { event: 'step-failed' }>[] = [];
    const report = createFailureReporter((e) => void (e.event === 'step-failed' && events.push(e)), clock);
    return { clock, events, report };
  };
  const cause = new StoreError('invalid-write', 'a refused write', { sqliteCode: 19 });

  it('NFR-54 (logs) FR-292 (step failures logged) the first failure of a match is reported with its cause, and nothing of the message', () => {
    const { events, report } = setup();
    report({ matchId: 'match_1-x', kind: 'error' }, new TypeError(`planted ${PLANTED}`));
    expect(events).toStrictEqual([{ event: 'step-failed', kind: 'error', matchId: 'match_1-x', suppressed: 0, error: { name: 'TypeError' } }]);
    expect(JSON.stringify(events)).not.toContain(PLANTED);
  });

  it('NFR-54 (logs) a step retried every 3 s is reported once at first and then once per window, carrying how many repeats it skipped', () => {
    const { clock, events, report } = setup();
    // 61 attempts, 3 s apart: instants 0, 3, ..., 180 s.
    for (let i = 0; i <= 60; i += 1) {
      report({ matchId: 'm', kind: 'error' }, cause);
      clock.advance(3000);
    }
    // Reported at 0 s, 60 s (the 21st attempt) and 120 s, 180 s: each window of 60 s skips 19 repeats.
    expect(events.map((e) => e.suppressed)).toStrictEqual([0, 19, 19, 19]);
    expect(events[1]!.error).toStrictEqual({ name: 'StoreError', code: 'invalid-write', sqlite: 19 });
    expect(REPEAT_LOG_MS).toBe(60_000);
  });

  it('NFR-54 (logs) a change of kind and another match are reported at once, and a clock that went backwards reports at once', () => {
    const { clock, events, report } = setup();
    report({ matchId: 'a', kind: 'unavailable' }, cause);
    report({ matchId: 'a', kind: 'unavailable' }, cause);
    report({ matchId: 'a', kind: 'error' }, cause);
    report({ matchId: 'b', kind: 'error' }, cause);
    expect(events.map((e) => [e.matchId, e.kind, e.suppressed])).toStrictEqual([
      ['a', 'unavailable', 0],
      ['a', 'error', 0],
      ['b', 'error', 0],
    ]);
    clock.set(500_000);
    report({ matchId: 'b', kind: 'error' }, cause);
    expect(events).toHaveLength(4);
  });

  it('NFR-54 (logs) a match id that is not a plain id is left out of the event', () => {
    const { events, report } = setup();
    report({ matchId: `has space ${PLANTED}`, kind: 'error' }, cause);
    expect(events[0]).not.toHaveProperty('matchId');
  });
});
