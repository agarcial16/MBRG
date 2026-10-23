// The pure parts of the event stream (spec 008 FR-289 (d), (e), (f); plan 19.1, 19.2). No clock, no timer, no platform
// module: the frame of one event, the heartbeat frame, the constants and the reading of the starting number. The hub that
// writes to the sockets is `streams.ts`.

/** The comment frame sent to every open stream: no `id`, no `data`, so `Last-Event-ID` does not move (FR-289 (f)). */
export const HEARTBEAT_FRAME = ':\n\n';

/** One heartbeat every 14,000 ms keeps the 15 s bound with the margin NFR-50 gives a late timer (plan 19.2). */
export const HEARTBEAT_MS = 14_000;

/** The wait of a refused open-stream limit (D28): one heartbeat interval, the time a dead connection takes to be found. */
export const STREAM_RETRY_SECONDS = 15;

/** A stream with more than this buffered is dropped (plan 19.5); its client reconnects with `Last-Event-ID`. */
export const STREAM_BUFFER_LIMIT = 1_048_576;

/** The frame of one event: `id: <seq>`, `data: <json>` and a blank line. A json holding CR or LF would break the frame. */
export function frameOf(seq: number, json: string): string {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new RangeError('the event number is not a whole number from 1');
  if (/[\r\n]/.test(json)) throw new RangeError('the event text holds a line break');
  return `id: ${seq}\ndata: ${json}\n\n`;
}

/**
 * Where a stream starts: only the events committed after it opens (`live`), the events with a number above `after`, none
 * ever (`beyond`: the number is past 2^53 - 1, so no event will be later), or an invalid value naming its field.
 */
export type StreamStart =
  | { readonly kind: 'live' }
  | { readonly kind: 'after'; readonly after: number }
  | { readonly kind: 'beyond' }
  | { readonly kind: 'invalid'; readonly field: 'Last-Event-ID' | 'lastEventId' };

const NUMBER = /^(?:0|[1-9][0-9]*)$/;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);

function numberOf(text: string, field: 'Last-Event-ID' | 'lastEventId'): StreamStart {
  if (!NUMBER.test(text)) return { kind: 'invalid', field };
  return BigInt(text) > MAX ? { kind: 'beyond' } : { kind: 'after', after: Number(text) };
}

/**
 * The starting number of a stream (FR-289 (d), (e)): the `Last-Event-ID` header wins over the `lastEventId` parameter (an
 * `EventSource` reconnects to the same address and adds the header with the newest id). A value is `0` or digits without
 * a leading zero; a header with two values is invalid. Neither given: live only.
 */
export function readStreamStart(headerValues: readonly string[] | undefined, queryValue: string | undefined): StreamStart {
  if (headerValues !== undefined && headerValues.length > 0) {
    return headerValues.length === 1 ? numberOf(headerValues[0] as string, 'Last-Event-ID') : { kind: 'invalid', field: 'Last-Event-ID' };
  }
  if (queryValue !== undefined) return numberOf(queryValue, 'lastEventId');
  return { kind: 'live' };
}
