/**
 * A fake server for the live transport tests (plan 21.14): an injected `fetch` over the protocol encoders that serves the
 * replies and frames of `scripted-match.ts` and the dev map files, records every request, and lets a test answer any status,
 * drop a request or end/fail the event stream. Web standard types only (DOM lib), so it runs in the viewer's Node tests.
 */
import { encodeError, encodeRecord, encodeState, mapDigestBytes, roundNotApplied, type ErrorReply, type MapFileName, type PublicMatch } from '@mbrg/protocol';
import { DEV_MAP_TEXT, DEV_PRESENTATION_TEXT, devPngBytes } from './dev-map';
import { MATCH_ID, publicAt, recordReply, stateReply, type Scripted } from './scripted-match';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface LoggedRequest {
  readonly url: string;
  readonly path: string;
  readonly query: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly credentials: RequestCredentials | undefined;
  readonly method: string;
  readonly body: string | undefined;
  /** The round a state or record path names, otherwise undefined. */
  readonly round: number | undefined;
}

/** A reply forced for the next request: a status with a body and headers, or a network failure. */
export type Forced = 'network' | { readonly status: number; readonly body?: string; readonly headers?: Readonly<Record<string, string>> };

export interface FakeServer {
  readonly fetch: FetchFn;
  readonly requests: LoggedRequest[];
  /** The applied rounds the server reports (N). */
  n: number;
  /** The map files served, as bytes (a test may change a byte). */
  readonly files: Record<MapFileName, Uint8Array>;
  /** The digest of the original dev map files, as the public data announces it. */
  readonly mapDigest: string;
  /** Fields merged into the public data (for example a clock timing and its schedule). */
  publicExtra: Partial<PublicMatch>;
  /** Replies for the next requests, one each, in order, before any route answers. */
  readonly forced: Forced[];
  /** Pushes text to the stream that was opened last. */
  push(text: string): void;
  /** Ends the stream that was opened last in the normal way. */
  end(): void;
  /** Errors the body of the stream that was opened last. */
  fail(): void;
  /** How many streams have been opened. */
  streams(): number;
}

const encoder = new TextEncoder();

async function sha256Of(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', copy));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const json = (body: string, status = 200): Response => new Response(body, { status, headers: { 'content-type': 'application/json' } });
const errorReply = (reply: ErrorReply, status: number, headers: Record<string, string> = {}): Response =>
  new Response(encodeError(reply), { status, headers: { 'content-type': 'application/json', ...headers } });

export async function createFakeServer(s: Scripted, n = 0): Promise<FakeServer> {
  const files: Record<MapFileName, Uint8Array> = {
    'map.json': encoder.encode(DEV_MAP_TEXT),
    'ids.png': devPngBytes(),
    'presentation.json': encoder.encode(DEV_PRESENTATION_TEXT),
  };
  const mapDigest = await sha256Of(mapDigestBytes(files));
  const requests: LoggedRequest[] = [];
  const forced: Forced[] = [];
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  const server: FakeServer = {
    n,
    files,
    mapDigest,
    publicExtra: {},
    requests,
    forced,
    fetch: (input, init) => {
      const url = new URL(input);
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => (headers[key] = value));
      const parts = url.pathname.split('/').filter((x) => x !== '');
      const roundText = parts[0] === 'matches' && (parts[2] === 'states' || parts[2] === 'records') ? parts[3] : undefined;
      requests.push({ url: input, path: url.pathname, query: url.search, headers, credentials: init?.credentials, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined, round: roundText === undefined ? undefined : Number(roundText) });
      const next = forced.shift();
      if (next === 'network') return Promise.reject(new TypeError('network error'));
      if (next !== undefined) return Promise.resolve(new Response(next.body ?? '', { status: next.status, headers: next.headers }));
      if (parts[0] === 'maps' && parts.length === 3) {
        const bytes = files[parts[2] as MapFileName];
        return Promise.resolve(bytes === undefined || parts[1] !== 'dev' ? errorReply({ kind: 'unknown-map' }, 404) : new Response(bytes as BodyInit, { status: 200 }));
      }
      if (parts[0] !== 'matches' || parts[1] !== MATCH_ID) {
        return Promise.resolve(errorReply({ kind: parts[0] === 'matches' ? 'unknown-match' : 'unknown-path' }, 404));
      }
      if (parts.length === 2) return Promise.resolve(json(JSON.stringify(publicAt(s, server.n, { mapDigest: server.mapDigest, ...server.publicExtra }))));
      if (parts[2] === 'states' || parts[2] === 'records') {
        const round = Number(roundText);
        const known = parts[2] === 'states' ? round >= 0 : round >= 1;
        if (!Number.isInteger(round) || !known || round > server.n) return Promise.resolve(errorReply(roundNotApplied(server.n), 404));
        return Promise.resolve(json(parts[2] === 'states' ? encodeState(stateReply(s, round)) : encodeRecord(recordReply(s, round))));
      }
      if (parts[2] === 'events') {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controllers.push(controller);
            init?.signal?.addEventListener('abort', () => {
              try {
                controller.error(new DOMException('aborted', 'AbortError'));
              } catch {
                // already closed
              }
            });
          },
        });
        return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
      }
      return Promise.resolve(errorReply({ kind: 'unknown-path' }, 404));
    },
    push: (text) => (controllers[controllers.length - 1] as ReadableStreamDefaultController<Uint8Array>).enqueue(encoder.encode(text)),
    end: () => (controllers[controllers.length - 1] as ReadableStreamDefaultController<Uint8Array>).close(),
    fail: () => (controllers[controllers.length - 1] as ReadableStreamDefaultController<Uint8Array>).error(new TypeError('connection lost')),
    streams: () => controllers.length,
  };
  return server;
}

/** The wire text of one event frame, as the server writes it. */
export const frameText = (event: unknown): string => `id: ${(event as { seq: number }).seq}\ndata: ${JSON.stringify(event)}\n\n`;
