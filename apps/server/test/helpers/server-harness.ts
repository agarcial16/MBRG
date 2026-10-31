import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import { encodeError, encodePublicMatch, errorReply, readSubmission } from '@mbrg/protocol';
import { requireClient, playerIdFor } from '../../src/http/identity';
import { playerKey } from '../../src/http/limits';
import type { LogEvent } from '../../src/http/log';
import type { Route } from '../../src/http/router';
import { createServer } from '../../src/http/server';
import { createStreamHub } from '../../src/http/streams';
import type { StreamHub } from '../../src/http/streams';
import type { MatchService } from '../../src/service/matches';
import { DEFAULT_LIMITS } from '../../src/service/settings';
import type { Limits, ServerSettings } from '../../src/service/settings';
import { withFaults } from '../../src/store/faults';
import type { FaultPlan } from '../../src/store/faults';
import { openStore } from '../../src/store/sqlite';
import type { Store } from '../../src/store/store';
import type { FakeClock } from './fake-clock';
import { fakeScheduler } from './fake-scheduler';
import type { FakeScheduler } from './fake-scheduler';
import { serviceHarness } from './service-harness';
import type { Harness, HarnessOptions } from './service-harness';

// The HTTP test harness: the real service over an in-memory store (optionally behind the fault seam), the fake clock, a log
// that records every event, and `createServer` listening on port 0 of 127.0.0.1. Every harness registers itself so that
// `closeAllServers` (called from afterEach) closes the listeners and destroys the sockets a test left open.

export const CLIENT_CREDENTIAL = 'client-credential-web-0123456789ab';
export const CLIENT_NAMESPACE = 'web';
/** A text a thrown error quotes: it must never reach a reply or the log. */
export const PLANTED = 'planted-secret-value-7f3a9c';

export interface ServerHarnessOptions {
  /** The route table: given the real service and the settings (default: `testRoutes`). */
  readonly routes?: (service: MatchService, settings: ServerSettings) => readonly Route[];
  readonly limits?: Partial<Limits>;
  /** Methods of the real service replaced by stubs (a stub that throws, for the unexpected-exception tests). */
  readonly stub?: Partial<MatchService>;
  readonly faults?: FaultPlan;
  readonly allowedOrigins?: readonly string[];
  /** Client credentials (default: one, namespace `web`). */
  readonly clients?: ServerSettings['clients'];
  /** Wraps the store (after the fault seam): a read that throws a storage failure, for example. */
  readonly wrapStore?: (store: Store) => Store;
  /** Options of the underlying service harness (map folders, fake random seed, test-only round-seed source, secret). */
  readonly service?: Omit<HarnessOptions, 'store'>;
  /** The port to listen on (default 0: any free port); the hand-run fixture uses a fixed one. */
  readonly port?: number;
  /** The trusted proxy hops of the settings (default 0: `X-Forwarded-For` is ignored). */
  readonly trustedProxyHops?: number;
  /** Called after each logged event is recorded (it may throw: a failing sink). */
  readonly onLog?: (event: LogEvent) => void;
}

export interface ServerHarness {
  readonly port: number;
  readonly server: Server;
  readonly service: MatchService;
  readonly base: Harness;
  readonly clock: FakeClock;
  readonly settings: ServerSettings;
  /** The event stream hub of the server and the fake scheduler that drives its heartbeat. */
  readonly streams: StreamHub;
  readonly scheduler: FakeScheduler;
  /** Every event the server logged, in order. */
  readonly logs: LogEvent[];
  close(): Promise<void>;
}

const open: ServerHarness[] = [];

const success = (body: string): { kind: 'success'; status: 200; body: string } => ({ kind: 'success', status: 200, body });
const ok = (): { kind: 'success'; status: 200; body: string } => success('{"ok":true}');

/**
 * Stub routes that exercise each stage of the pipeline the way the command routes will (T2'b), over the real service:
 * - `GET /ping`, `POST /echo` (a JSON object), `GET /boom` (throws a TypeError quoting `PLANTED`);
 * - `GET /read-only` has no `POST`: a `POST` to it is a 405;
 * - `POST /submit` shape (`readSubmission`, then the player id) before authorization (a client credential);
 * - `POST /players/:player` counts the player under (match `m`, player) after authorization;
 * - `POST /advance/:id` is authorised by the operator or the host token of match `:id`;
 * - `GET /match/:id` reads the real service; `POST /create` calls `service.create` (the fault seam test).
 */
export function testRoutes(service: MatchService, settings: ServerSettings): readonly Route[] {
  return [
    { method: 'GET', path: '/ping', body: 'none', decide: ok },
    { method: 'GET', path: '/read-only', body: 'none', decide: ok },
    { method: 'POST', path: '/echo', body: 'object', decide: (ctx) => success(`{"keys":${Object.keys(ctx.body as object).length}}`) },
    {
      method: 'GET',
      path: '/boom',
      body: 'none',
      decide: () => {
        throw new TypeError(`bad value ${PLANTED}`);
      },
    },
    {
      method: 'POST',
      path: '/submit',
      body: 'object',
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
      decide: ok,
    },
    {
      method: 'POST',
      path: '/players/:player',
      body: 'none',
      authorize: (ctx) => {
        const client = requireClient(ctx.identity);
        return client.ok ? undefined : client.error;
      },
      playerLimit: (ctx) => [{ key: playerKey('m', ctx.params.player as string), limit: settings.limits.submissions }],
      decide: ok,
    },
    {
      method: 'POST',
      path: '/advance/:id',
      body: 'none',
      hostParam: 'id',
      authorize: (ctx) => (ctx.identity.role === 'operator' || ctx.identity.role === 'host' ? undefined : errorReply('forbidden')),
      decide: (ctx) => success(`{"as":"${ctx.identity.role}"}`),
    },
    {
      method: 'POST',
      path: '/holders/:id',
      body: 'none',
      matchParam: 'id',
      holders: ['player'],
      decide: (ctx) => success(`{"as":"${ctx.identity.role}"}`),
    },
    {
      method: 'POST',
      path: '/either/:id',
      body: 'none',
      matchParam: 'id',
      holders: ['host', 'player'],
      decide: (ctx) => success(`{"as":"${ctx.identity.role}"}`),
    },
    {
      method: 'GET',
      path: '/match/:id',
      body: 'none',
      decide: (ctx) => {
        const read = service.readPublicMatch(ctx.params.id as string);
        return read.ok ? success(encodePublicMatch(read.reply)) : { kind: 'error', error: read.error };
      },
    },
    {
      method: 'POST',
      path: '/create',
      body: 'object',
      decide: (ctx) => {
        const made = service.create({ credential: ctx.token, body: ctx.body });
        return made.ok ? success('{"created":true}') : { kind: 'error', error: made.error };
      },
    },
  ];
}

export async function startServer(options: ServerHarnessOptions = {}): Promise<ServerHarness> {
  const inner = options.faults === undefined ? openStore(':memory:') : withFaults(openStore(':memory:'), options.faults);
  const store = options.wrapStore === undefined ? inner : options.wrapStore(inner);
  const base = serviceHarness({ ...(options.service ?? {}), store });
  const service: MatchService = options.stub === undefined ? base.service : { ...base.service, ...options.stub };
  const settings: ServerSettings = {
    ...base.settings,
    clients: options.clients ?? [{ namespace: CLIENT_NAMESPACE, credential: CLIENT_CREDENTIAL }],
    allowedOrigins: options.allowedOrigins ?? ['https://app.example'],
    host: '127.0.0.1',
    port: options.port ?? 0,
    limits: { ...DEFAULT_LIMITS, ...(options.limits ?? {}) },
    trustedProxyHops: options.trustedProxyHops ?? 0,
  };
  const logs: LogEvent[] = [];
  const routes = (options.routes ?? testRoutes)(service, settings);
  const scheduler = fakeScheduler(base.clock);
  const streams = createStreamHub({ service, scheduler, clock: base.clock });
  const server = createServer({ service, settings, clock: base.clock, streams, log: (event) => {
      logs.push(event);
      options.onLog?.(event);
    },
    routes,
  });
  const sockets = new Set<Socket>();
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the test server has no port');
  let closed = false;
  const harness: ServerHarness = {
    port: address.port,
    server,
    service,
    base,
    clock: base.clock,
    settings,
    streams,
    scheduler,
    logs,
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      base.close();
    },
  };
  open.push(harness);
  return harness;
}

/** Closes every server a test started (call from `afterEach`). */
export async function closeAllServers(): Promise<void> {
  const all = open.splice(0, open.length);
  await Promise.all(all.map((h) => h.close()));
}

/** The round seeds of one dev secret of golden/dev-secrets.json (round 1 first). */
export function goldSeeds(secret = 'ascending-00-1f'): number[] {
  const gold = JSON.parse(readFileSync(new URL('../golden/dev-secrets.json', import.meta.url), 'utf8')) as { matches: Record<string, { rounds: { seed: number }[] }> };
  return gold.matches[secret]!.rounds.map((r) => r.seed);
}

/** A test-only round-seed source that plays the seeds in order (`seeds[k - 1]` for round k). */
export const seedSourceOf = (seeds: readonly number[]) => () => (k: number) => seeds[k - 1] ?? 7000 + k;

/** The error body of a kind with no items, as the server writes it. */
export const errorBody = (kind: Parameters<typeof errorReply>[0]): string => encodeError(errorReply(kind));
