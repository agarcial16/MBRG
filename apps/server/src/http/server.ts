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
//   8 unexpected   any exception: ONE `request-failed` event (name and stage only), then 500 `{"kind":"unavailable"}`
// The command and read routes are tables of `Route` (router.ts). T2'a ships the pipeline only: `productionRoutes` holds the three
// command routes (T2'b; the reads come in T3'), and `routes` is the injection point of the pipeline tests (it cannot carry a seed source: PD18).
// Connection hardening is the platform's own (PD21): the four server options below; no custom socket timers.

import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { encodeAdvance, encodeCreation, encodePrediction, errorReply, rateLimited, readSubmission } from '@mbrg/protocol';
import type { ErrorReply } from '@mbrg/protocol';
import type { Clock } from '../clock';
import { CREATION_PATH } from '../service/matches';
import type { MatchService } from '../service/matches';
import { CONNECTION_OPTIONS } from '../service/settings';
import type { ServerSettings } from '../service/settings';
import { readBody, tooLargeByLength } from './body';
import { credentialTable, hostIdentity, identify, playerIdFor, readBearer, requireClient } from './identity';
import type { Identity } from './identity';
import { createLimiter, limitKeys, playerKey } from './limits';
import type { RequestClass } from './limits';
import { requestFailed } from './log';
import type { FailureStage, LogSink } from './log';
import { corsRequestOf, sendError, sendPreflight, sendSuccess, sendUnexpected } from './respond';
import type { ReplyTarget } from './respond';
import { createRouter } from './router';
import type { Reply, Route, RouteContext } from './router';

export interface ServerOptions {
  /** The built lifecycle service (PD18: no seed source can be passed through here). */
  readonly service: MatchService;
  readonly settings: ServerSettings;
  readonly clock: Clock;
  readonly log: LogSink;
  /** The route table; omitted: the production table. The pipeline tests inject their own. */
  readonly routes?: readonly Route[];
}

/** The option keys of `createServer`, pinned by a test: nothing here can name a seed or a seed source (FR-260). */
export const SERVER_OPTION_KEYS = ['clock', 'log', 'routes', 'service', 'settings'] as const satisfies readonly (keyof ServerOptions)[];
type UnlistedOptionKey = Exclude<keyof ServerOptions, (typeof SERVER_OPTION_KEYS)[number]>;
const ALL_OPTION_KEYS_LISTED: [UnlistedOptionKey] extends [never] ? true : false = true;
void ALL_OPTION_KEYS_LISTED;

/** A service outcome as a route reply: the success with its status and encoded body, or the error (memoised ones included). */
const replyOf = <T>(outcome: { readonly ok: true; readonly reply: T } | { readonly ok: false; readonly error: ErrorReply }, status: 200 | 201, encode: (reply: T) => string): Reply =>
  outcome.ok ? { kind: 'success', status, body: encode(outcome.reply) } : { kind: 'error', error: outcome.error };

/**
 * The production routes. The three commands (T2'b): creation (201), advance (200, the host token of the match or the operator
 * credential; the service compares the credential itself, in the FR-301 order forbidden, request-id-reused, unknown-match)
 * and submission (200; the client credential gives the namespace, the body only the local id). The reads come in T3'.
 */
export const productionRoutes = (service: MatchService, settings: ServerSettings): readonly Route[] => [
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
  const { service, settings, clock, log } = options;
  const router = createRouter(options.routes ?? productionRoutes(service, settings));
  const table = credentialTable(settings);
  const limiter = createLimiter();
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
  const run = async (req: IncomingMessage, target: ReplyTarget, at: { stage: FailureStage }): Promise<void> => {
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
    }
    const ctx: RouteContext = { params, query, body, token, identity, now };
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
    const reply: Reply = route.decide(ctx);
    at.stage = 'reply';
    if (reply.kind === 'success') return sendSuccess(target, reply.status, reply.body);
    return sendError(target, reply.error);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const target: ReplyTarget = { res, cors: corsRequestOf(req), allowedOrigins: settings.allowedOrigins };
    const at = { stage: 'admit' as FailureStage };
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
    }
  };

  const server = createHttpServer({ ...CONNECTION_OPTIONS }, (req, res) => {
    // A client that vanishes mid-request must not become an uncaught 'error' event.
    req.on('error', () => undefined);
    res.on('error', () => undefined);
    void handle(req, res);
  });
  return server;
}
