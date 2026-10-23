// The HTTP listener and the request pipeline (spec 008 FR-280, FR-298, FR-299, FR-301; plan 18.2, PD14, PD21).
// Every request runs these stages in order and the first that fails answers, so the reply kind is the first applicable one of
// the FR-301 order:
//   1 admit        identity (Bearer from the list of header values), limiter (credential or address key)  -> rate-limited
//   2 route        the router                                                                      -> unknown-path, method-not-allowed
//   3 body         Content-Length above 4,096 (nothing read), chunked counting, JSON object, query     -> too-large, invalid-request
//   4 shape        the route's protocol reader                                              -> invalid-request, invalid-player-id
//   5 authorize    the route's credential rule                                                         -> forbidden
//   6 player limit `ticket.extend`: a refusal cancels the ticket of stage 1, so it is counted nowhere   -> rate-limited
//   7 decide       the route calls the service; the outcome is mapped by `status.ts`
//   (an event-stream route also takes a place in the open-stream gauge at stage 1 and hands it to the hub at stage 7)
//   8 unexpected   any exception: ONE `request-failed` event (name and stage only), then 500 `{"kind":"unavailable"}`
// The command and read routes are tables of `Route` (router.ts): `productionRoutes` holds the three command routes and the
// read routes (list, match, states, records, own predictions, map files); `routes` is the injection point of the pipeline tests
// (it cannot carry a seed source: PD18). A route's `decide` may be asynchronous (a map file is read once per request).
// Connection hardening is the platform's own (PD21): the four server options below; no custom socket timers.

import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';
import {
  encodeAdvance,
  encodeCreation,
  encodeMatchSummary,
  encodeOwnPrediction,
  encodePage,
  encodePrediction,
  encodePublicMatch,
  encodeRecord,
  encodeState,
  errorReply,
  isLocalId,
  rateLimited,
  readPageQuery,
  readSubmission,
} from '@mbrg/protocol';
import type { ErrorReply } from '@mbrg/protocol';
import type { Clock } from '../clock';
import { CREATION_PATH } from '../service/matches';
import type { MatchService } from '../service/matches';
import type { MapFile } from '../service/maps';
import { CONNECTION_OPTIONS } from '../service/settings';
import type { ServerSettings } from '../service/settings';
import { answerClientError } from './client-error';
import { discardBody, readBody, tooLargeByLength, unreadLargeBody } from './body';
import { credentialTable, hostIdentity, identify, playerIdFor, readBearer, requireClient } from './identity';
import type { Identity } from './identity';
import { createGauge, createLimiter, limitKeys, playerKey, streamKeys } from './limits';
import type { RequestClass, StreamLease } from './limits';
import { requestFailed } from './log';
import type { FailureStage, LogSink } from './log';
import { corsRequestOf, sendError, sendFile, sendPreflight, sendSuccess, sendUnexpected, streamHeaders } from './respond';
import type { ReplyTarget } from './respond';
import { createRouter, parseRoundSegment } from './router';
import type { Reply, Route, RouteContext } from './router';
import { STREAM_RETRY_SECONDS, readStreamStart } from './sse';
import type { StreamHub } from './streams';

export interface ServerOptions {
  /** The built lifecycle service (PD18: no seed source can be passed through here). */
  readonly service: MatchService;
  readonly settings: ServerSettings;
  readonly clock: Clock;
  readonly log: LogSink;
  /** The event stream hub (plan 19.1, PD27): built by the entry point, which also closes it at shutdown. */
  readonly streams: StreamHub;
  /** The route table; omitted: the production table. The pipeline tests inject their own. */
  readonly routes?: readonly Route[];
}

/** The option keys of `createServer`, pinned by a test: nothing here can name a seed or a seed source (FR-260). */
export const SERVER_OPTION_KEYS = ['clock', 'log', 'routes', 'service', 'settings', 'streams'] as const satisfies readonly (keyof ServerOptions)[];
type UnlistedOptionKey = Exclude<keyof ServerOptions, (typeof SERVER_OPTION_KEYS)[number]>;
const ALL_OPTION_KEYS_LISTED: [UnlistedOptionKey] extends [never] ? true : false = true;
void ALL_OPTION_KEYS_LISTED;

/** A service outcome as a route reply: the success with its status and encoded body, or the error (memoised ones included). */
const replyOf = <T>(outcome: { readonly ok: true; readonly reply: T } | { readonly ok: false; readonly error: ErrorReply }, status: 200 | 201, encode: (reply: T) => string): Reply =>
  outcome.ok ? { kind: 'success', status, body: encode(outcome.reply) } : { kind: 'error', error: outcome.error };

/** The query as name/value pairs (percent-decoded like a browser's `URLSearchParams`); empty text gives none. */
const pairsOf = (query: string): [string, string][] => [...new URLSearchParams(query)];

/** A route without query parameters: any parameter is unknown, the first in sorted order is named (as `readPageQuery` does). */
const noQuery = (ctx: RouteContext): ErrorReply | undefined => {
  const first = pairsOf(ctx.query)
    .map(([name]) => name)
    .sort()[0];
  return first === undefined ? undefined : errorReply('invalid-request', [first]);
};

/** Stage 4 of a round route: a round segment that is not `0` or a number without a leading zero is `invalid-request ['round']`. */
const roundShape = (ctx: RouteContext): ErrorReply | undefined =>
  parseRoundSegment(ctx.params.round as string).kind === 'invalid' ? errorReply('invalid-request', ['round']) : undefined;

/**
 * The round to ask the service for. A segment past the safe-integer range is `beyond`: the largest safe round is asked, which
 * gets the same `round-not-applied` (naming only N) as any round above N (FR-258), whatever the match and its stage.
 */
const roundOf = (ctx: RouteContext): number => {
  const round = parseRoundSegment(ctx.params.round as string);
  return round.kind === 'round' ? round.value : Number.MAX_SAFE_INTEGER;
};

/** The query of the stream route: only `lastEventId` is a parameter; the first other name, in sorted order, is named. */
const streamQuery = (ctx: RouteContext): ErrorReply | undefined => {
  const first = pairsOf(ctx.query)
    .map(([name]) => name)
    .filter((name) => name !== 'lastEventId')
    .sort()[0];
  return first === undefined ? undefined : errorReply('invalid-request', [first]);
};

/** Where the stream starts (FR-289 (d), (e)): the header wins; a repeated `lastEventId` parameter is invalid. */
const startOf = (ctx: RouteContext) => {
  const values = pairsOf(ctx.query)
    .filter(([name]) => name === 'lastEventId')
    .map(([, value]) => value);
  return readStreamStart(ctx.lastEventId, values.length === 0 ? undefined : values.length === 1 ? (values[0] as string) : '');
};

const MAP_FILE_TYPES = Object.freeze({ 'map.json': 'application/json', 'presentation.json': 'application/json', 'ids.png': 'image/png' } as const);

/** The bytes of a map file read once for this request: a file replaced since its size was read still gets a matching `Content-Length`. */
async function readFileBytes(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function fileReply(file: MapFile): Promise<Reply> {
  try {
    return { kind: 'file', contentType: MAP_FILE_TYPES[file.name], body: await readFileBytes(file.open()) };
  } catch {
    // The file vanished or cannot be read between the listing and the read: the server cannot serve it now (nothing was sent).
    return { kind: 'error', error: errorReply('unavailable') };
  }
}

/**
 * The production routes. The three commands (T2'b): creation (201), advance (200, the host token of the match or the operator
 * credential; the service compares the credential itself, in the FR-301 order forbidden, request-id-reused, unknown-match)
 * and submission (200; the client credential gives the namespace, the body only the local id). The reads (T3'): the match
 * list, a match, its states and records, the caller's own predictions (client credential) and the three map files; all
 * credential-free except the own predictions. A list read takes `limit` and `cursor` (and `playerId` for the own predictions).
 */
export const productionRoutes = (service: MatchService, settings: ServerSettings): readonly Route[] => [
  {
    method: 'GET',
    path: '/matches',
    body: 'none',
    checkQuery: (ctx) => {
      const query = readPageQuery('matches', pairsOf(ctx.query));
      return query.ok ? undefined : query.error;
    },
    decide: (ctx) => {
      const query = readPageQuery('matches', pairsOf(ctx.query));
      if (!query.ok) return { kind: 'error', error: query.error };
      const { limit, after } = query.value;
      return replyOf(service.listMatches(after === undefined ? { limit } : { limit, after }), 200, (page) => encodePage(page, encodeMatchSummary));
    },
  },
  {
    method: 'GET',
    path: '/matches/:id',
    body: 'none',
    checkQuery: noQuery,
    decide: (ctx) => replyOf(service.readPublicMatch(ctx.params.id as string), 200, encodePublicMatch),
  },
  {
    method: 'GET',
    path: '/matches/:id/states/:round',
    body: 'none',
    checkQuery: noQuery,
    shape: roundShape,
    decide: (ctx) => replyOf(service.stateAt(ctx.params.id as string, roundOf(ctx)), 200, encodeState),
  },
  {
    method: 'GET',
    path: '/matches/:id/records',
    body: 'none',
    checkQuery: (ctx) => {
      const query = readPageQuery('records', pairsOf(ctx.query));
      return query.ok ? undefined : query.error;
    },
    decide: (ctx) => {
      const query = readPageQuery('records', pairsOf(ctx.query));
      if (!query.ok) return { kind: 'error', error: query.error };
      const { limit, after } = query.value;
      return replyOf(service.records(ctx.params.id as string, after === undefined ? { limit } : { limit, after }), 200, (page) => encodePage(page, encodeRecord));
    },
  },
  {
    method: 'GET',
    path: '/matches/:id/records/:round',
    body: 'none',
    checkQuery: noQuery,
    shape: roundShape,
    decide: (ctx) => replyOf(service.recordAt(ctx.params.id as string, roundOf(ctx)), 200, encodeRecord),
  },
  {
    method: 'GET',
    path: '/matches/:id/predictions',
    body: 'none',
    checkQuery: (ctx) => {
      const query = readPageQuery('predictions', pairsOf(ctx.query), ['playerId']);
      return query.ok ? undefined : query.error;
    },
    // A local id with a separator or a character outside FR-297 is `invalid-player-id`, before `forbidden` (FR-301 order).
    shape: (ctx) => {
      const playerId = readPageQuery('predictions', pairsOf(ctx.query), ['playerId']);
      const local = playerId.ok ? playerId.value.extra.playerId : undefined;
      return local === undefined || isLocalId(local) ? undefined : errorReply('invalid-player-id', ['playerId']);
    },
    authorize: (ctx) => {
      const client = requireClient(ctx.identity);
      return client.ok ? undefined : client.error;
    },
    decide: (ctx) => {
      const client = requireClient(ctx.identity);
      if (!client.ok) return { kind: 'error', error: client.error };
      const query = readPageQuery('predictions', pairsOf(ctx.query), ['playerId']);
      if (!query.ok) return { kind: 'error', error: query.error };
      const { limit, after, extra } = query.value;
      // The namespace is the one of the credential; no query text can name another (FR-270).
      const request = {
        namespace: client.client.namespace,
        matchId: ctx.params.id as string,
        limit,
        ...(after === undefined ? {} : { after }),
        ...(extra.playerId === undefined ? {} : { playerId: extra.playerId }),
      };
      return replyOf(service.ownPredictionsPage(request), 200, (page) => encodePage(page, encodeOwnPrediction));
    },
  },
  {
    method: 'GET',
    path: '/matches/:id/events',
    body: 'none',
    stream: true,
    checkQuery: streamQuery,
    shape: (ctx) => {
      const start = startOf(ctx);
      return start.kind === 'invalid' ? errorReply('invalid-request', [start.field]) : undefined;
    },
    decide: (ctx) => {
      const start = startOf(ctx);
      // `beyond` (past 2^53 - 1): no event will ever be later, so the largest safe number filters everything.
      const after = start.kind === 'after' ? start.after : start.kind === 'beyond' ? Number.MAX_SAFE_INTEGER : undefined;
      return { kind: 'stream', matchId: ctx.params.id as string, after };
    },
  },
  {
    method: 'GET',
    path: '/maps/:mapId/:file',
    body: 'none',
    checkQuery: noQuery,
    decide: async (ctx) => {
      const found = service.mapFile(ctx.params.mapId as string, ctx.params.file as string);
      return found.ok ? fileReply(found.reply) : { kind: 'error', error: found.error };
    },
  },
  {
    method: 'POST',
    path: CREATION_PATH,
    body: 'object',
    decide: (ctx) => replyOf(service.create({ credential: ctx.token, body: ctx.body }), 201, encodeCreation),
  },
  {
    method: 'POST',
    path: '/matches/:id/advance',
    body: 'object',
    hostParam: 'id',
    decide: (ctx) => replyOf(service.advance({ credential: ctx.token, matchId: ctx.params.id as string, body: ctx.body }), 200, encodeAdvance),
  },
  {
    method: 'POST',
    path: '/matches/:id/predictions',
    body: 'object',
    // Stage 4: the structure first (`invalid-request`), then only the `invalid-player-id` case of the local id (before `forbidden`).
    shape: (ctx) => {
      const read = readSubmission(ctx.body);
      if (!read.ok) return read.error;
      const id = playerIdFor(ctx.identity, read.value.playerId);
      return id.ok || id.error.kind !== 'invalid-player-id' ? undefined : id.error;
    },
    authorize: (ctx) => {
      const client = requireClient(ctx.identity);
      return client.ok ? undefined : client.error;
    },
    playerLimit: (ctx) => {
      const read = readSubmission(ctx.body);
      if (!read.ok) return undefined;
      const id = playerIdFor(ctx.identity, read.value.playerId);
      return id.ok ? [{ key: playerKey(ctx.params.id as string, id.playerId), limit: settings.limits.submissions }] : undefined;
    },
    decide: (ctx) => {
      const client = requireClient(ctx.identity);
      if (!client.ok) return { kind: 'error', error: client.error };
      if (ctx.token === undefined) return { kind: 'error', error: errorReply('forbidden') };
      return replyOf(
        service.submit({ client: { credential: ctx.token, namespace: client.client.namespace }, matchId: ctx.params.id as string, body: ctx.body }),
        200,
        encodePrediction,
      );
    },
  },
];

/**
 * The limiter key of the TCP peer. A socket whose `remoteAddress` is undefined (already destroyed) must not share one
 * `address:undefined` bucket with every other such request: it gets a key of its own, numbered per socket by `ordinal`.
 */
export function addressOf(remoteAddress: string | undefined, ordinal: number): string {
  return remoteAddress === undefined ? `unknown-peer-${ordinal}` : remoteAddress;
}

const classOf = (method: string): RequestClass => (method === 'POST' ? 'command' : 'read');

export function createServer(options: ServerOptions): Server {
  const { service, settings, clock, log, streams } = options;
  const router = createRouter(options.routes ?? productionRoutes(service, settings));
  const table = credentialTable(settings);
  const limiter = createLimiter();
  const gauge = createGauge();
  const sockets = new WeakMap<object, number>();
  let socketCount = 0;
  const ordinalOf = (socket: object): number => {
    let ordinal = sockets.get(socket);
    if (ordinal === undefined) {
      socketCount += 1;
      ordinal = socketCount;
      sockets.set(socket, ordinal);
    }
    return ordinal;
  };

  /** The pipeline of one request; it answers through `target` exactly once, or throws. */
  const run = async (req: IncomingMessage, target: ReplyTarget, at: { stage: FailureStage; lease: StreamLease | undefined }): Promise<void> => {
    const method = req.method ?? 'GET';
    const now = clock.now();

    // 1. Identify and admit.
    at.stage = 'admit';
    const resolution = router.resolve(method, req.url ?? '/');
    const token = readBearer(req.headersDistinct.authorization);
    let identity: Identity = identify(token, table);
    let hostMatch = false;
    if (identity.role === 'candidate' && token !== undefined && resolution.kind === 'found' && resolution.route.hostParam !== undefined) {
      // Only an advance may be authorised by a host token; the match is asked (PD16). A storage failure here leaves the
      // request anonymous: the service answers `unavailable` itself at the decision.
      const checked = service.hostTokenMatches(resolution.params[resolution.route.hostParam] ?? '', token);
      hostMatch = checked.ok && checked.reply;
    }
    identity = hostIdentity(identity, hostMatch);
    const address = addressOf(req.socket.remoteAddress, ordinalOf(req.socket));
    const admission = limiter.admit(limitKeys(identity, classOf(method), address, settings.limits), now);
    if (resolution.kind === 'found' && resolution.route.stream === true) {
      // An event stream is one read of the per-minute limit AND a place in the open-stream gauge (FR-299 (b), plan 19.4); a
      // refusal of either counts nowhere. The wait is the largest over the refused limits (D28: 15 s for the gauge).
      const opened = gauge.open(streamKeys(identity, address, settings.limits));
      if (!admission.ok || !opened.ok) {
        if (opened.ok) opened.lease.release();
        if (admission.ok) admission.ticket.cancel();
        return sendError(target, rateLimited(Math.max(admission.ok ? 0 : admission.retryAfter, opened.ok ? 0 : STREAM_RETRY_SECONDS)));
      }
      at.lease = opened.lease;
    }
    if (!admission.ok) return sendError(target, rateLimited(admission.retryAfter));

    // 2. Route.
    at.stage = 'route';
    if (resolution.kind === 'unknown-path') return sendError(target, errorReply('unknown-path'));
    if (resolution.kind === 'method-not-allowed') return sendError(target, errorReply('method-not-allowed'), resolution.allow);
    if (resolution.kind === 'preflight') return sendPreflight(target);
    const { route, params, query } = resolution;

    // 3. Body (a declared length over the limit is answered before anything is read), then the query.
    at.stage = 'body';
    const large = tooLargeByLength(req);
    if (large !== undefined) return sendError(target, large);
    let body: unknown;
    if (route.body === 'object') {
      const read = await readBody(req);
      if (read.kind === 'aborted') return;
      if (read.kind === 'error') return sendError(target, read.error);
      body = read.value;
    } else {
      // A route without a body bounds one all the same (FR-298): over 4,096 bytes is `too-large`, a small one is ignored.
      const read = await discardBody(req);
      if (read.kind === 'aborted') return;
      if (read.kind === 'error') return sendError(target, read.error);
    }
    const ctx: RouteContext = { params, query, body, token, lastEventId: req.headersDistinct['last-event-id'], identity, now };
    const queryError = route.checkQuery?.(ctx);
    if (queryError !== undefined) return sendError(target, queryError);

    // 4. Shape. 5. Authorization.
    at.stage = 'shape';
    const shapeError = route.shape?.(ctx);
    if (shapeError !== undefined) return sendError(target, shapeError);
    at.stage = 'authorize';
    const authError = route.authorize?.(ctx);
    if (authError !== undefined) return sendError(target, authError);

    // 6. Per-player limit: a refusal cancels the whole ticket (the request is counted nowhere, FR-299 (c)).
    at.stage = 'limit';
    const playerKeys = route.playerLimit?.(ctx);
    if (playerKeys !== undefined) {
      const extended = admission.ticket.extend(playerKeys, clock.now());
      if (!extended.ok) return sendError(target, rateLimited(extended.retryAfter));
    }

    // 7. Decision.
    at.stage = 'decide';
    const reply: Reply = await route.decide(ctx);
    at.stage = 'reply';
    if (reply.kind === 'stream') {
      // The client is already gone (nothing would close this response again): the place goes back at the end of the request.
      if (req.socket.destroyed || target.res.destroyed) return;
      const opened = streams.open({ matchId: reply.matchId, after: reply.after, response: target.res, headers: streamHeaders(target), lease: at.lease as StreamLease });
      if (!opened.ok) return sendError(target, opened.error);
      at.lease = undefined; // the hub owns the response and the place now
      return;
    }
    if (reply.kind === 'success') return sendSuccess(target, reply.status, reply.body);
    if (reply.kind === 'file') return sendFile(target, reply.contentType, reply.body);
    return sendError(target, reply.error);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Any reply sent while a body over the limit is unread closes the connection (FR-298): nothing is drained.
    const target: ReplyTarget = { res, cors: corsRequestOf(req), allowedOrigins: settings.allowedOrigins, closeAfter: () => unreadLargeBody(req) };
    const at: { stage: FailureStage; lease: StreamLease | undefined } = { stage: 'admit', lease: undefined };
    try {
      await run(req, target, at);
    } catch (error) {
      // 8. Unexpected exception: one closed event (a sink that throws must not stop the 500), then the 500.
      try {
        log(requestFailed(error, at.stage));
      } catch {
        // nothing more can be done about a failing sink
      }
      try {
        sendUnexpected(target);
      } catch {
        res.destroy();
      }
    } finally {
      // A request that ends without a stream gives its open-stream place back (every 4xx and 5xx, a client gone mid-request).
      at.lease?.release();
    }
  };

  const server = createHttpServer({ ...CONNECTION_OPTIONS }, (req, res) => {
    // A client that vanishes mid-request must not become an uncaught 'error' event.
    req.on('error', () => undefined);
    res.on('error', () => undefined);
    void handle(req, res);
  });
  // Requests the parser refuses (or that time out) never reach `handle`: the reply is written here (NFR-52 network).
  server.on('clientError', answerClientError);
  return server;
}
