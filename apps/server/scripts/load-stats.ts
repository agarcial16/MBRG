// The pure part of the NFR-49 load procedure (plan 19.9): no clock, no I/O, no randomness. `scripts/load.ts` measures; this
// module turns what it recorded into the figures of the pull request.

/** The members of an event the procedure reads (the wire event, parsed). */
export interface LoadEvent {
  readonly type: string;
  readonly seq: number;
  readonly [member: string]: unknown;
}

/** One decision of a match: the instant it was performed at and the number of the last event it produced. */
export interface DecisionEnd {
  readonly matchId: string;
  readonly at: number;
  readonly lastSeq: number;
}

/** What one open stream recorded: the HTTP status of its reply, when each event arrived (ms) and whether it ended early. */
export interface StreamLog {
  readonly matchId: string;
  readonly status: number;
  readonly receipts: ReadonlyMap<number, number>;
  readonly endedEarly: boolean;
}

export const SUMMARY_KEYS = ['replies', 'replyP95Ms', 'replyMaxMs', 'steps', 'worstStepDelayMs', 'missingReceipts', 'earlyCloses', 'nonOkReplies', 'failures', 'restartMs'] as const;

export interface LoadSummary {
  readonly replies: number;
  readonly replyP95Ms: number | null;
  readonly replyMaxMs: number | null;
  readonly steps: number;
  readonly worstStepDelayMs: number | null;
  readonly missingReceipts: number;
  readonly earlyCloses: number;
  readonly nonOkReplies: number;
  readonly failures: number;
  readonly restartMs: number | null;
}

/** The p-th percentile by nearest rank: the value at rank ceil(p / 100 * n) of the sorted list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new RangeError('percentile of an empty list');
  if (!(p > 0 && p <= 100)) throw new RangeError('percentile outside (0, 100]');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(1, rank) - 1] as number;
}

/** The instant a decision names, from the first event of the group that carries one. */
function instantOf(group: readonly LoadEvent[]): number | undefined {
  for (const event of group) {
    if (event.type === 'phase-closed' && typeof event.at === 'number') return event.at;
    if (event.type === 'victim-revealed' && typeof event.revealedAt === 'number') return event.revealedAt;
    if (event.type === 'round-applied' && typeof event.appliedAt === 'number') return event.appliedAt;
    if (event.type === 'match-halted' && typeof event.reportedTime === 'number') return event.reportedTime;
  }
  return undefined;
}

/**
 * The decisions of a match found in its events in order: each ends at a `schedule`, `match-finished` or `match-halted`
 * event (plan 19.8). The group that holds only the creation `schedule` names no instant and is not a decision.
 */
export function decisionsOf(matchId: string, events: readonly LoadEvent[]): DecisionEnd[] {
  const out: DecisionEnd[] = [];
  let group: LoadEvent[] = [];
  for (const event of events) {
    group.push(event);
    if (event.type !== 'schedule' && event.type !== 'match-finished' && event.type !== 'match-halted') continue;
    const at = instantOf(group);
    if (at !== undefined) out.push({ matchId, at, lastSeq: event.seq });
    group = [];
  }
  return out;
}

/**
 * For each step, the delay from its instant to the LAST stream's receipt of its last event (never the first). A stream of
 * the step's match that has no receipt of that event is one missing receipt; a step no stream received has no delay. Streams
 * whose reply was not 200 are counted elsewhere (`nonOkReplies`) and skipped here.
 */
export function stepDelays(steps: readonly DecisionEnd[], streams: readonly StreamLog[]): { delays: number[]; missing: number } {
  const delays: number[] = [];
  let missing = 0;
  for (const step of steps) {
    let last: number | undefined;
    for (const stream of streams) {
      if (stream.matchId !== step.matchId || stream.status !== 200) continue;
      const received = stream.receipts.get(step.lastSeq);
      if (received === undefined) missing += 1;
      else last = last === undefined ? received : Math.max(last, received);
    }
    if (last !== undefined) delays.push(last - step.at);
  }
  return { delays, missing };
}

export interface SummaryInput {
  /** Reply times (ms) of the submissions that were sent. */
  readonly replyMs: readonly number[];
  /** Submissions answered with something other than 200. */
  readonly nonOkReplies: number;
  readonly steps: readonly DecisionEnd[];
  readonly streams: readonly StreamLog[];
  readonly restartMs: number | null;
}

/** The figures: the 95th percentile of the replies, the worst step delay, the restart time and the failure counts. */
export function summarize(input: SummaryInput): LoadSummary {
  const { delays, missing } = stepDelays(input.steps, input.streams);
  const earlyCloses = input.streams.filter((s) => s.endedEarly).length;
  const nonOkReplies = input.nonOkReplies + input.streams.filter((s) => s.status !== 200).length;
  return {
    replies: input.replyMs.length,
    replyP95Ms: input.replyMs.length === 0 ? null : percentile(input.replyMs, 95),
    replyMaxMs: input.replyMs.length === 0 ? null : Math.max(...input.replyMs),
    steps: input.steps.length,
    worstStepDelayMs: delays.length === 0 ? null : Math.max(...delays),
    missingReceipts: missing,
    earlyCloses,
    nonOkReplies,
    failures: missing + earlyCloses + nonOkReplies,
    restartMs: input.restartMs,
  };
}
