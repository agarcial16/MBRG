import { describe, expect, it } from 'vitest';
import { SUMMARY_KEYS, decisionsOf, percentile, stepDelays, summarize } from '../scripts/load-stats';
import type { LoadEvent, StreamLog } from '../scripts/load-stats';

// The pure part of the load procedure (plan 19.9): the 95th percentile by nearest rank, the decisions of a match found in
// its events, the delay of a step to the LAST stream's receipt of its last event, and the failure counts. The measurement
// itself (scripts/load.ts) is run by hand; these tests pin the arithmetic.

describe('NFR-49 percentile by nearest rank', () => {
  it('NFR-49 (percentile) a single value is its own 95th percentile', () => {
    expect(percentile([7.5], 95)).toBe(7.5);
  });

  it('NFR-49 (percentile) twenty values: the 19th smallest, whatever the input order', () => {
    const values = [41.3, 2.7, 18.9, 33.1, 7.2, 29.6, 12.4, 38.8, 5.5, 22.2, 15.1, 44.9, 9.3, 27.7, 35.6, 1.1, 20.4, 31.9, 13.8, 24.5];
    const copy = [...values];
    // Sorted: 1.1 2.7 5.5 7.2 9.3 12.4 13.8 15.1 18.9 20.4 22.2 24.5 27.7 29.6 31.9 33.1 35.6 38.8 41.3 44.9
    expect(percentile(values, 95)).toBe(41.3);
    expect(values).toStrictEqual(copy);
  });

  it('NFR-49 (percentile) rank is the ceiling: 21 values give the 20th, 100 values the 95th, the median is not the 95th', () => {
    const hundred = Array.from({ length: 100 }, (_, i) => (100 - i) * 1.25);
    expect(percentile(hundred, 95)).toBe(95 * 1.25);
    const twentyOne = Array.from({ length: 21 }, (_, i) => i + 0.5);
    expect(percentile(twentyOne, 95)).toBe(19.5);
    expect(percentile(twentyOne, 50)).toBe(10.5);
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
  });

  it('NFR-49 (percentile) refuses an empty list and a percentile outside (0, 100]', () => {
    expect(() => percentile([], 95)).toThrow(RangeError);
    expect(() => percentile([1], 0)).toThrow(RangeError);
    expect(() => percentile([1], 100.5)).toThrow(RangeError);
  });
});

const ev = (type: string, seq: number, extra: Record<string, unknown> = {}): LoadEvent => ({ type, seq, ...extra });

describe('NFR-49 decisions found in the events of a match', () => {
  it('NFR-49 (decisions) each decision ends at its schedule, match-finished or match-halted, and takes its instant from the event that names it', () => {
    const events: LoadEvent[] = [
      ev('schedule', 1, { reportedTime: 0 }),
      ev('phase-closed', 2, { phase: 1, at: 1000 }),
      ev('victim-revealed', 3, { revealedAt: 1000 }),
      ev('schedule', 4),
      ev('phase-closed', 5, { phase: 2, at: 1600 }),
      ev('schedule', 6),
      ev('round-applied', 7, { appliedAt: 2000 }),
      ev('match-finished', 8),
    ];
    expect(decisionsOf('m', events)).toStrictEqual([
      { matchId: 'm', at: 1000, lastSeq: 4 },
      { matchId: 'm', at: 1600, lastSeq: 6 },
      { matchId: 'm', at: 2000, lastSeq: 8 },
    ]);
  });

  it('NFR-49 (decisions) a results event inside a decision changes neither its instant nor its end (the schedule or match-finished after it)', () => {
    const events: LoadEvent[] = [
      ev('schedule', 1, { reportedTime: 0 }),
      ev('phase-closed', 2, { phase: 1, at: 1000 }),
      ev('victim-revealed', 3, { revealedAt: 1000 }),
      ev('results', 4, { round: 1, phase: 1 }),
      ev('schedule', 5),
      ev('phase-closed', 6, { phase: 2, at: 1600 }),
      ev('schedule', 7),
      ev('round-applied', 8, { appliedAt: 2000 }),
      ev('results', 9, { round: 1, phase: 2 }),
      ev('match-finished', 10),
    ];
    expect(decisionsOf('m', events)).toStrictEqual([
      { matchId: 'm', at: 1000, lastSeq: 5 },
      { matchId: 'm', at: 1600, lastSeq: 7 },
      { matchId: 'm', at: 2000, lastSeq: 10 },
    ]);
  });

  it('NFR-49 (decisions) a merged phase-2 close and application is one decision at the instant of its first event; a halt is a decision at its reported time', () => {
    const merged = [ev('schedule', 1), ev('phase-closed', 2, { phase: 2, at: 500 }), ev('round-applied', 3, { appliedAt: 500 }), ev('schedule', 4)];
    expect(decisionsOf('m', merged)).toStrictEqual([{ matchId: 'm', at: 500, lastSeq: 4 }]);
    expect(decisionsOf('m', [ev('schedule', 1), ev('match-halted', 2, { reportedTime: 777 })])).toStrictEqual([{ matchId: 'm', at: 777, lastSeq: 2 }]);
    expect(decisionsOf('m', [ev('schedule', 1)])).toStrictEqual([]);
  });
});

const stream = (matchId: string, receipts: [number, number][], extra: Partial<StreamLog> = {}): StreamLog => ({ matchId, receipts: new Map(receipts), status: 200, endedEarly: false, ...extra });

describe('NFR-49 step delays', () => {
  const steps = [
    { matchId: 'a', at: 1000, lastSeq: 4 },
    { matchId: 'a', at: 2000, lastSeq: 6 },
    { matchId: 'b', at: 1000, lastSeq: 4 },
  ];

  it('NFR-49 (delays) the delay of a step runs to the LAST stream that received its last event, not the first', () => {
    const streams = [
      stream('a', [[4, 1010], [6, 2020]]),
      stream('a', [[4, 1090], [6, 2005]]),
      stream('a', [[4, 1030], [6, 2011]]),
      stream('b', [[4, 1042]]),
    ];
    const out = stepDelays(steps, streams);
    expect(out.delays).toStrictEqual([90, 20, 42]);
    expect(out.missing).toBe(0);
  });

  it('NFR-49 (delays) a stream that never received the last event of a step is a missing receipt, and the step keeps the delays that exist', () => {
    const streams = [stream('a', [[4, 1010], [6, 2020]]), stream('a', [[4, 1090]]), stream('b', [])];
    const out = stepDelays(steps, streams);
    expect(out.missing).toBe(2);
    expect(out.delays).toStrictEqual([90, 20]);
  });

  it('NFR-49 (delays) a step no stream of its match received at all has no delay and one missing receipt per stream', () => {
    const out = stepDelays([{ matchId: 'a', at: 1000, lastSeq: 4 }], [stream('a', []), stream('a', [])]);
    expect(out.delays).toStrictEqual([]);
    expect(out.missing).toBe(2);
  });
});

describe('NFR-49 summary and failures', () => {
  const base = { replyMs: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100], nonOkReplies: 0, steps: [{ matchId: 'a', at: 1000, lastSeq: 4 }], restartMs: 1234 };

  it('NFR-49 (summary) the summary has exactly the documented keys, the 95th percentile of the replies and the worst step delay', () => {
    const summary = summarize({ ...base, streams: [stream('a', [[4, 1033]]), stream('a', [[4, 1071]])] });
    expect(Object.keys(summary)).toStrictEqual([...SUMMARY_KEYS]);
    expect(SUMMARY_KEYS).toStrictEqual(['replies', 'replyP95Ms', 'replyMaxMs', 'steps', 'worstStepDelayMs', 'missingReceipts', 'earlyCloses', 'nonOkReplies', 'failures', 'restartMs']);
    expect(summary).toStrictEqual({ replies: 10, replyP95Ms: 100, replyMaxMs: 100, steps: 1, worstStepDelayMs: 71, missingReceipts: 0, earlyCloses: 0, nonOkReplies: 0, failures: 0, restartMs: 1234 });
  });

  it('NFR-49 (summary) a missing receipt, a stream that closed early and a reply that is not 200 each count as a failure', () => {
    const missing = summarize({ ...base, streams: [stream('a', [])] });
    expect([missing.missingReceipts, missing.failures]).toStrictEqual([1, 1]);
    const early = summarize({ ...base, streams: [stream('a', [[4, 1010]], { endedEarly: true })] });
    expect([early.earlyCloses, early.failures]).toStrictEqual([1, 1]);
    const badReply = summarize({ ...base, nonOkReplies: 3, streams: [stream('a', [[4, 1010]])] });
    expect([badReply.nonOkReplies, badReply.failures]).toStrictEqual([3, 3]);
    const refused = summarize({ ...base, streams: [stream('a', [[4, 1010]]), stream('a', [], { status: 429 })] });
    expect(refused.nonOkReplies).toBe(1);
    const all = summarize({ ...base, nonOkReplies: 2, streams: [stream('a', [], { endedEarly: true }), stream('a', [[4, 1010]], { status: 503 })] });
    expect([all.missingReceipts, all.earlyCloses, all.nonOkReplies, all.failures]).toStrictEqual([1, 1, 3, 5]);
  });

  it('NFR-49 (summary) with no reply or no step the percentile and delay are null, not a thrown error', () => {
    const empty = summarize({ replyMs: [], nonOkReplies: 0, steps: [], streams: [], restartMs: null });
    expect([empty.replyP95Ms, empty.replyMaxMs, empty.worstStepDelayMs, empty.restartMs]).toStrictEqual([null, null, null, null]);
  });
});
