// An in-process fake of the MBRG server on node:http (spec 012 tests). It serves only the public interface the bot uses, records
// every request (method, path, whether and which bearer it carried) and holds PLANTED secrets that no public answer may carry:
// a test then proves no message of the bot contains them (NFR-88, NFR-89).
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { encodeEvent, encodePublicMatch } from '@mbrg/protocol';
import type { MatchEvent, PublicMatch } from '@mbrg/protocol';

export const CREDENTIAL = 'discord-credential-PLANTED-0123456789';
export const HOST_TOKEN = 'host-token-PLANTED-0123456789abcdef';
export const MATCH_ID = 'match-0123456789abcdef';
export const FUTURE_SECRET = 'FUTURO-SECRETO-ronda-9';
export const MATCH_SECRET = 'ab'.repeat(32);

export interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly bearer: string | undefined;
  readonly lastEventId: string | undefined;
  readonly body: unknown;
}

export interface ResultRow {
  readonly playerId: string;
  readonly choice: number;
  readonly correct: boolean;
  readonly points: number;
}

export type Unnumbered = MatchEvent extends infer E ? (E extends { seq: number } ? Omit<E, 'seq'> : never) : never;

export interface FakeOptions {
  readonly factions?: readonly { readonly id: number; readonly name: string }[];
}

export interface Fake {
  readonly url: string;
  readonly requests: Recorded[];
  /** The stored events, in order: what a resume replays. */
  readonly events: MatchEvent[];
  match: PublicMatch;
  /** Rows of the phase results by `${round}/${phase}`. */
  results: Map<string, ResultRow[]>;
  leaderboard: { rank: number; playerId: string; total: number; name?: string }[];
  /** The error every prediction gets, when set; otherwise it is accepted. */
  submitError: { status: number; body: unknown } | undefined;
  /** While true the server refuses every connection and request (a crash). */
  down: boolean;
  /** Page size of the phase results (to exercise paging). */
  pageSize: number;
  /** Predictions accepted: the player id seen by the server is the body's local id. */
  predictions: { playerId: string; kind: string; round: number; faction: number }[];
  /** Appends an event (its number is the next one), patches the public data and sends it to every open stream. */
  emit(event: Unnumbered, patch?: Partial<PublicMatch>): number;
  /** Closes every open event stream (a dropped connection). */
  dropStreams(): void;
  streamCount(): number;
  close(): Promise<void>;
}

const hex = (c: string): string => c.repeat(64);

export function baseMatch(over: Partial<PublicMatch> = {}): PublicMatch {
  return {
    matchId: MATCH_ID, mapId: 'europe', mapDigest: hex('a'), totalRounds: 2, timing: { i: 60, l1: 30, l2: 5 }, commitment: hex('b'), stage: 'lobby', appliedRounds: 0,
    state: { mode: 'classic', round: 0, owners: [[1, 1], [2, 2], [3, 3]] }, stateDigest: hex('c'), lastSeq: 1, reportedTime: 1000, playerCount: 0, ...over,
  };
}

export const SCHEDULE = { c1: 30_000, c2: 60_000, a: 65_000 } as const;

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

async function bodyOf(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? undefined : JSON.parse(text);
}

export async function startFake(options: FakeOptions = {}): Promise<Fake> {
  const factions = options.factions ?? [{ id: 1, name: 'Alemania' }, { id: 2, name: 'España' }, { id: 3, name: 'Francia' }, { id: 99, name: FUTURE_SECRET }];
  const streams = new Set<ServerResponse>();
  const events: MatchEvent[] = [];
  const state = {} as Fake;

  const frameOf = (event: MatchEvent): string => `id: ${event.seq}\ndata: ${encodeEvent(event)}\n\n`;

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const path = url.pathname;
      const auth = req.headers.authorization;
      const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
      const lastEventId = typeof req.headers['last-event-id'] === 'string' ? req.headers['last-event-id'] : undefined;
      const body = req.method === 'POST' ? await bodyOf(req) : undefined;
      state.requests.push({ method: req.method ?? 'GET', path: path + url.search, bearer, lastEventId, body });
      if (state.down) return req.socket.destroy();

      if (path === '/config') return json(res, 200, { maps: ['europe', 'asia'], minInterval: 30, maxInterval: 3600, minPhase1: 10, minPhase2: 5, maxPlayers: 50, enabled: true });
      if (path === '/matches' && req.method === 'POST') {
        events.length = 0;
        events.push({ type: 'schedule', seq: 1, stage: 'lobby', reportedTime: 1000 });
        state.match = baseMatch({ lastSeq: 1 });
        return json(res, 201, { matchId: MATCH_ID, match: JSON.parse(encodePublicMatch(state.match)), hostToken: HOST_TOKEN });
      }
      if (path === `/matches/${MATCH_ID}/start` && req.method === 'POST') {
        if (bearer !== HOST_TOKEN) return json(res, 403, { kind: 'forbidden' });
        if (state.match.stage !== 'lobby') return json(res, 409, { kind: 'match-started' });
        state.emit({ type: 'schedule', stage: 'phase-1', schedule: SCHEDULE, reportedTime: 2000 }, { stage: 'phase-1', schedule: SCHEDULE });
        return json(res, 200, JSON.parse(encodePublicMatch(state.match)));
      }
      if (path === `/matches/${MATCH_ID}`) return json(res, 200, JSON.parse(encodePublicMatch(state.match)));
      if (path === `/matches/${MATCH_ID}/events`) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
        res.write(': open\n\n');
        const after = lastEventId === undefined ? Number.MAX_SAFE_INTEGER : Number(lastEventId);
        for (const event of events) if (event.seq > after) res.write(frameOf(event));
        streams.add(res);
        res.on('close', () => streams.delete(res));
        return;
      }
      if (path === `/matches/${MATCH_ID}/predictions` && req.method === 'POST') {
        if (bearer !== CREDENTIAL) return json(res, 403, { kind: 'forbidden' });
        if (state.submitError !== undefined) return json(res, state.submitError.status, state.submitError.body);
        const b = body as { kind: string; round: number; faction: number; playerId: string };
        state.predictions.push({ playerId: b.playerId, kind: b.kind, round: b.round, faction: b.faction });
        return json(res, 200, { kind: b.kind, round: b.round, choice: b.faction, version: 1 });
      }
      const states = /^\/matches\/[^/]+\/states\/(\d+)$/.exec(path);
      if (states !== null) {
        const round = Number(states[1]);
        // A round beyond the applied ones is the future: what a bot that asked for it would see.
        const owners = round > state.match.appliedRounds ? [[1, 99]] : round === 0 ? [[1, 1], [2, 2], [3, 3]] : [[1, 2], [2, 2], [3, 3]].slice(0, 3 - round + 1);
        return json(res, 200, { round, owners, stateDigest: hex('d'), reportedTime: 1000 });
      }
      const results = /^\/matches\/[^/]+\/results\/(\d+)\/([12])$/.exec(path);
      if (results !== null) {
        const rows = state.results.get(`${results[1]}/${results[2]}`);
        if (rows === undefined) return json(res, 409, { kind: 'round-not-applied', appliedRounds: state.match.appliedRounds });
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), state.pageSize);
        const from = Number(url.searchParams.get('cursor') ?? 0);
        const items = rows.slice(from, from + limit);
        const more = from + limit < rows.length;
        return json(res, 200, { round: Number(results[1]), phase: Number(results[2]), victim: 1, items, ...(more ? { next: String(from + limit) } : {}) });
      }
      if (path === `/matches/${MATCH_ID}/leaderboard`) {
        const limit = Number(url.searchParams.get('limit') ?? 100);
        const items = state.leaderboard.slice(0, limit).map((r) => ({ ...r, correctVictims: 0, correctAbsorbers: 0, correctWinner: 0 }));
        return json(res, 200, { items });
      }
      if (/^\/maps\/[^/]+\/presentation\.json$/.test(path)) return json(res, 200, { factions, territories: [] });
      return json(res, 404, { kind: 'unknown-path' });
    })().catch(() => {
      if (!res.headersSent) json(res, 500, { kind: 'unavailable' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  Object.assign(state, {
    url: `http://127.0.0.1:${port}`,
    requests: [] as Recorded[],
    events,
    match: baseMatch(),
    results: new Map<string, ResultRow[]>(),
    leaderboard: [],
    submitError: undefined,
    down: false,
    pageSize: 500,
    predictions: [],
    emit(event: Unnumbered, patch: Partial<PublicMatch> = {}): number {
      const seq = state.match.lastSeq + 1;
      const full = { ...event, seq } as MatchEvent;
      events.push(full);
      const merged: Record<string, unknown> = { ...state.match, ...patch, lastSeq: seq };
      for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
      state.match = merged as unknown as PublicMatch;
      for (const stream of streams) stream.write(frameOf(full));
      return seq;
    },
    dropStreams(): void {
      for (const stream of [...streams]) stream.destroy();
      streams.clear();
    },
    streamCount: () => streams.size,
    close(): Promise<void> {
      state.dropStreams();
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  });
  return state;
}
