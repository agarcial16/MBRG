import { request } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';

// A hand-written reader of an event stream over a real socket (M3b T5, NFR-52): it keeps every byte received, cuts the bytes
// into frames at each blank line, and waits for the next frame with a real-time limit. No `EventSource`, no parser library.
// A reply that is not a stream (a 429, a 404) is read to its end as plain text.

/** One frame as the server wrote it: an event (`id` and `data`) or a comment (a line starting with `:`). */
export type Frame =
  | { readonly kind: 'event'; readonly id: number; readonly data: string; readonly raw: string }
  | { readonly kind: 'comment'; readonly text: string; readonly raw: string };

export interface SseReader {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  /** Every byte received so far, as text. */
  raw(): string;
  /** The next frame; rejects after `timeoutMs` of real time, or when the stream ended with none left. */
  next(timeoutMs?: number): Promise<Frame>;
  /** The next `count` frames. */
  take(count: number, timeoutMs?: number): Promise<Frame[]>;
  /** The next `count` EVENT frames (comments are skipped). */
  takeEvents(count: number, timeoutMs?: number): Promise<Extract<Frame, { kind: 'event' }>[]>;
  /** Resolves with the whole text when the server ends the reply (non-stream replies), or rejects after the time limit. */
  body(timeoutMs?: number): Promise<string>;
  /** Resolves when the connection has ended, from either side. */
  readonly ended: Promise<void>;
  hasEnded(): boolean;
  /** Closes the connection from the client side. */
  close(): void;
}

function parseFrame(text: string): Frame {
  const lines = text.split('\n');
  if (lines.every((line) => line.startsWith(':'))) return { kind: 'comment', text: lines.map((l) => l.slice(1)).join('\n'), raw: `${text}\n\n` };
  let id: number | undefined;
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith('id: ')) id = Number(line.slice(4));
    else if (line.startsWith('data: ')) data.push(line.slice(6));
    else throw new Error(`unexpected line in a frame: ${JSON.stringify(line)}`);
  }
  if (id === undefined || data.length !== 1) throw new Error(`a frame needs one id and one data line: ${JSON.stringify(text)}`);
  return { kind: 'event', id, data: data[0] as string, raw: `${text}\n\n` };
}

export interface OpenOptions {
  readonly port: number;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string | readonly string[]>>;
  readonly method?: string;
}

/** Sends the request and resolves when the reply headers arrive. */
export function openStream(options: OpenOptions): Promise<SseReader> {
  return new Promise<SseReader>((resolve, reject) => {
    const call = request({ host: '127.0.0.1', port: options.port, method: options.method ?? 'GET', path: options.path, headers: options.headers as never, agent: false });
    call.on('error', reject);
    call.on('response', (res: IncomingMessage) => {
      let text = '';
      let consumed = 0;
      let over = false;
      let waiter: (() => void) | undefined;
      const frames: Frame[] = [];
      const wake = (): void => {
        const w = waiter;
        waiter = undefined;
        w?.();
      };
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        text += chunk;
        for (;;) {
          const cut = text.indexOf('\n\n', consumed);
          if (cut < 0) break;
          const piece = text.slice(consumed, cut);
          consumed = cut + 2;
          if (res.headers['content-type']?.startsWith('text/event-stream') === true) frames.push(parseFrame(piece));
        }
        wake();
      });
      const done = new Promise<void>((resolveEnded) => {
        const end = (): void => {
          over = true;
          wake();
          resolveEnded();
        };
        res.on('end', end);
        res.on('close', end);
        res.on('error', end);
      });
      const waitFor = async (what: string, ready: () => boolean, timeoutMs: number): Promise<void> => {
        const deadline = Date.now() + timeoutMs;
        while (!ready()) {
          if (over) throw new Error(`the stream ended while waiting for ${what}`);
          const left = deadline - Date.now();
          if (left <= 0) throw new Error(`timed out waiting for ${what}; received so far: ${JSON.stringify(text)}`);
          await new Promise<void>((resolveWait) => {
            const timer = setTimeout(resolveWait, left);
            waiter = () => {
              clearTimeout(timer);
              resolveWait();
            };
          });
        }
      };
      const reader: SseReader = {
        status: res.statusCode ?? 0,
        headers: res.headers,
        raw: () => text,
        async next(timeoutMs = 3000) {
          await waitFor('the next frame', () => frames.length > 0, timeoutMs);
          return frames.shift() as Frame;
        },
        async take(count, timeoutMs = 3000) {
          const out: Frame[] = [];
          for (let i = 0; i < count; i += 1) out.push(await reader.next(timeoutMs));
          return out;
        },
        async takeEvents(count, timeoutMs = 3000) {
          const out: Extract<Frame, { kind: 'event' }>[] = [];
          while (out.length < count) {
            const frame = await reader.next(timeoutMs);
            if (frame.kind === 'event') out.push(frame);
          }
          return out;
        },
        async body(timeoutMs = 3000) {
          await waitFor('the end of the reply', () => over, timeoutMs).catch(() => undefined);
          if (!over) throw new Error(`the reply did not end: ${JSON.stringify(text)}`);
          return text;
        },
        ended: done,
        hasEnded: () => over,
        close: () => {
          res.destroy();
          call.destroy();
        },
      };
      resolve(reader);
    });
    call.end();
  });
}
