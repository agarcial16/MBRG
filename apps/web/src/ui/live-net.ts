// The network of the live viewer (D30): the ONLY module besides `ui/load.ts` that calls `fetch`. It reads the public data,
// states, records and the map files, and the event stream (FR-307 transport, FR-289 (d) transport, FR-308). Every request is a
// credential-free GET (`credentials: 'omit'`, no Authorization): a cross-origin read is a simple request answered `*`. The
// stream reconnection adds only `Last-Event-ID`. Failures are classified for the retry policy of `core/live-retry.ts`.
import {
  MAP_FILE_NAMES,
  mapDigestBytes,
  readErrorReply,
  readPublicMatch,
  readRecordReply,
  readStateReply,
  type Decoded,
  type MapFileName,
  type PublicMatch,
  type RecordReply,
  type StateReply,
} from '@mbrg/protocol';
import { classifyReply, retryAfterMs } from '../core/live-retry';
import { createSseParser } from '../core/live-sse';
import { digestAvailable, sha256Hex } from './web-crypto';

/** The part of `fetch` the transport uses. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The digest functions; the platform ones by default. */
export interface DigestApi {
  available(): boolean;
  sha256Hex(bytes: Uint8Array): Promise<string>;
}

export interface LiveNetDeps {
  /** The server origin, for example `http://127.0.0.1:8787` (a trailing slash is dropped). */
  readonly base: string;
  readonly fetch: FetchLike;
  readonly digest?: DigestApi;
}

/** A request that failed: retry by the schedule (with the server's `Retry-After` when it sent one) or the match does not exist. */
export interface NetFailure {
  readonly ok: false;
  readonly outcome: 'retry' | 'unknown-match';
  readonly retryAfterMs?: number;
}

/** The scene cannot go on: no digest function (insecure origin) or the map files are not the ones the match announced. */
export interface NetFatal {
  readonly ok: false;
  readonly outcome: 'fatal';
  readonly fatal: 'insecure-origin' | 'digest-mismatch';
}

export type NetRead<T> = { readonly ok: true; readonly value: T } | NetFailure;
export type MapFiles = Readonly<Record<MapFileName, Uint8Array>>;

/** What the caller gets for one stream: it never opened, it ended or failed after opening, or the caller aborted it. */
export type StreamEnd = { readonly type: 'failed'; readonly failure: NetFailure } | { readonly type: 'dropped' } | { readonly type: 'aborted' };

export interface StreamHandlers {
  /** The reply was 200: the stream is open. */
  opened(): void;
  /** A chunk of bytes arrived (a heartbeat counts). */
  bytes(): void;
  /** One frame arrived: its data parsed as JSON (null when it is not JSON, which the model treats as a refused event). */
  frame(data: unknown): void;
}

export interface LiveNet {
  readPublic(matchId: string): Promise<NetRead<PublicMatch> | NetFatal>;
  readState(matchId: string, round: number): Promise<NetRead<StateReply>>;
  readRecord(matchId: string, round: number): Promise<NetRead<RecordReply>>;
  /** The three files as bytes, checked against the announced digest; nothing is returned on a mismatch. */
  readMapFiles(mapId: string, mapDigest: string): Promise<NetRead<MapFiles> | NetFatal>;
  /** First connection: the `lastEventId` parameter; later ones: the `Last-Event-ID` header (FR-289 (d)). */
  openStream(matchId: string, start: { readonly after: number; readonly via: 'parameter' | 'header' }, handlers: StreamHandlers, signal: AbortSignal): Promise<StreamEnd>;
}

const platformDigest: DigestApi = { available: () => digestAvailable(), sha256Hex: (bytes) => sha256Hex(bytes) };

const failure = (outcome: NetFailure['outcome'], wait?: number): NetFailure => (wait === undefined ? { ok: false, outcome } : { ok: false, outcome, retryAfterMs: wait });

export function createLiveNet(deps: LiveNetDeps): LiveNet {
  const base = deps.base.endsWith('/') ? deps.base.slice(0, -1) : deps.base;
  const digest = deps.digest ?? platformDigest;
  const get = (path: string, init: RequestInit = {}): Promise<Response> => deps.fetch(`${base}${path}`, { ...init, credentials: 'omit' });

  /** A reply that is not 200, as the failure the policy needs: `unknown-match` is fatal, everything else is retried. */
  async function refused(response: Response): Promise<NetFailure> {
    let kind: string | undefined;
    try {
      const read = readErrorReply(JSON.parse(await response.text()));
      kind = read.ok ? read.value.kind : undefined;
    } catch {
      kind = undefined;
    }
    return failure(classifyReply(response.status, kind) === 'unknown-match' ? 'unknown-match' : 'retry', retryAfterMs(response.headers.get('retry-after')));
  }

  async function readJson<T>(path: string, read: (input: unknown) => Decoded<T>): Promise<NetRead<T>> {
    try {
      const response = await get(path);
      if (response.status !== 200) return await refused(response);
      const decoded = read(JSON.parse(await response.text()));
      return decoded.ok ? { ok: true, value: decoded.value } : failure('retry');
    } catch {
      return failure('retry');
    }
  }

  async function readFile(mapId: string, name: MapFileName): Promise<NetRead<Uint8Array>> {
    try {
      const response = await get(`/maps/${mapId}/${name}`);
      if (response.status !== 200) return await refused(response);
      return { ok: true, value: new Uint8Array(await response.arrayBuffer()) };
    } catch {
      return failure('retry');
    }
  }

  return {
    async readPublic(matchId) {
      // Fail closed: with no digest function nothing can be verified, so no request is sent at all.
      if (!digest.available()) return { ok: false, outcome: 'fatal', fatal: 'insecure-origin' };
      return readJson(`/matches/${matchId}`, readPublicMatch);
    },
    readState: (matchId, round) => readJson(`/matches/${matchId}/states/${round}`, readStateReply),
    readRecord: (matchId, round) => readJson(`/matches/${matchId}/records/${round}`, readRecordReply),

    async readMapFiles(mapId, mapDigest) {
      if (!digest.available()) return { ok: false, outcome: 'fatal', fatal: 'insecure-origin' };
      const files: Partial<Record<MapFileName, Uint8Array>> = {};
      for (const name of MAP_FILE_NAMES) {
        const file = await readFile(mapId, name);
        if (!file.ok) return file;
        files[name] = file.value;
      }
      const all = files as MapFiles;
      // The digest is over the raw bytes of the three files, never over decoded text.
      if ((await digest.sha256Hex(mapDigestBytes(all))) !== mapDigest) return { ok: false, outcome: 'fatal', fatal: 'digest-mismatch' };
      return { ok: true, value: all };
    },

    async openStream(matchId, start, handlers, signal) {
      const path = `/matches/${matchId}/events${start.via === 'parameter' ? `?lastEventId=${start.after}` : ''}`;
      let response: Response;
      try {
        response = await get(path, start.via === 'header' ? { headers: { 'Last-Event-ID': String(start.after) }, signal } : { signal });
      } catch {
        return signal.aborted ? { type: 'aborted' } : { type: 'failed', failure: failure('retry') };
      }
      if (response.status !== 200) return { type: 'failed', failure: await refused(response) };
      if (response.body === null) return { type: 'failed', failure: failure('retry') };
      handlers.opened();
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      const parser = createSseParser();
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) return signal.aborted ? { type: 'aborted' } : { type: 'dropped' };
          handlers.bytes();
          for (const frame of parser.push(decoder.decode(chunk.value, { stream: true }))) {
            let data: unknown = null;
            try {
              data = JSON.parse(frame.data);
            } catch {
              data = null;
            }
            handlers.frame(data);
          }
        }
      } catch {
        return signal.aborted ? { type: 'aborted' } : { type: 'dropped' };
      }
    },
  };
}
