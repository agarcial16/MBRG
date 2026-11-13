// The reader of one match's event stream with reconnection (spec 012 FR-459, FR-460). It reconnects with backoff after any drop
// and resumes from the number `lastSeq()` gives (the last event announced) in the `Last-Event-ID` header. A frame is handed to
// `onFrame` one at a time and in order; if `onFrame` throws, the stream is dropped and re-opened, so the same event comes again
// until it is announced. While no connection is open nothing is handed over, so nothing can be announced.
import { backoffMs } from '../core/backoff';
import { createSseParser } from '../core/sse-parser';
import type { SseFrame } from '../core/sse-parser';

export interface StreamOptions {
  readonly url: string;
  readonly lastSeq: () => number;
  readonly onFrame: (frame: SseFrame) => Promise<void>;
  readonly signal: AbortSignal;
  /** Waits `ms`, or ends early when the signal aborts. */
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** A closed code only (no id, no token, no text of the server). */
  readonly log: (code: string) => void;
  readonly fetch?: typeof fetch;
}

export const sleepMs = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

/** Runs until the signal aborts. */
export async function followStream(options: StreamOptions): Promise<void> {
  const doFetch = options.fetch ?? fetch;
  let attempt = 0;
  while (!options.signal.aborted) {
    try {
      const response = await doFetch(options.url, { headers: { accept: 'text/event-stream', 'last-event-id': String(options.lastSeq()) }, signal: options.signal });
      if (!response.ok || response.body === null) throw new Error('refused');
      const parser = createSseParser();
      const decoder = new TextDecoder();
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        for (const frame of parser.push(decoder.decode(chunk, { stream: true }))) {
          await options.onFrame(frame);
          // Only an accepted frame resets the wait: a server that opens and drops at once is not retried every second.
          attempt = 0;
        }
      }
    } catch {
      // fall through to the wait (an abort ends the loop below)
    }
    if (options.signal.aborted) return;
    attempt += 1;
    options.log('stream-dropped');
    await options.sleep(backoffMs(attempt), options.signal);
  }
}
