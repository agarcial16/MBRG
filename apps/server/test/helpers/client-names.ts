// Shared rig of the spec 022 HTTP tests: a real server with two client credentials, a client-only or open match, predictions with
// a display name and a run to the end of the match (so every player who predicted is scored).
import { productionRoutes } from '../../src/http/server';
import { request } from './http-client';
import type { ClientReply } from './http-client';
import { CLIENT_CREDENTIAL, startServer } from './server-harness';
import type { ServerHarness, ServerHarnessOptions } from './server-harness';
import { creationBody } from './service-harness';

export const OTHER_CREDENTIAL = 'client-credential-tg-0123456789abcd';
export { CLIENT_CREDENTIAL };
const CLIENTS = [
  { namespace: 'web', credential: CLIENT_CREDENTIAL },
  { namespace: 'tg', credential: OTHER_CREDENTIAL },
];
const PUBLIC = { maps: ['dev'], lobbyExpiryHours: 1, maxOpenLobbies: 20 } as const;

export const start = (options: ServerHarnessOptions = {}): Promise<ServerHarness> =>
  startServer({
    routes: productionRoutes,
    clients: CLIENTS,
    ...options,
    service: { publicCreation: PUBLIC, seed: 7, ...(options.service ?? {}) },
    limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, createSource: 100_000, createAll: 100_000, joinSource: 100_000, joinMatch: 100_000, ...(options.limits ?? {}) },
  });
export const get = (h: ServerHarness, path: string, token?: string): Promise<ClientReply> =>
  request(h.port, { path, headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });
export const post = (h: ServerHarness, path: string, body: unknown, token?: string): Promise<ClientReply> =>
  request(h.port, { method: 'POST', path, body, headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });

export interface Rig {
  readonly h: ServerHarness;
  readonly matchId: string;
  readonly faction: number;
}

/** A started match (client-only when asked) with its first living faction. Nothing is predicted yet. */
export const begin = async (clientOnly: boolean, options: ServerHarnessOptions = {}): Promise<Rig> => {
  const h = await start(options);
  const made = await post(h, '/matches', creationBody('c-1', clientOnly ? { joinPolicy: 'client' } : {}), clientOnly ? CLIENT_CREDENTIAL : undefined);
  const { matchId, hostToken } = made.json() as { matchId: string; hostToken: string };
  if (!h.service.startMatch({ credential: hostToken, matchId, body: {} }).ok) throw new Error('the lobby did not start');
  return { h, matchId, faction: h.service.publicMatch(matchId)!.state.owners[0]![1] };
};

/** A victim prediction of round 1 by the local id `local` of the `web` client, with an optional display name and extra members. */
export const predict = (rig: Rig, local: string, extra: Record<string, unknown> = {}, token = CLIENT_CREDENTIAL): Promise<ClientReply> =>
  post(rig.h, `/matches/${rig.matchId}/predictions`, { kind: 'victim', round: 1, faction: rig.faction, playerId: local, ...extra }, token);

/** Runs the clock to the end of the match. */
export const finish = (rig: Rig): void => {
  for (let i = 0; i < 300; i++) {
    const shown = rig.h.service.publicMatch(rig.matchId)!;
    if (shown.stage === 'finished') return;
    const schedule = shown.schedule!;
    rig.h.clock.set(shown.stage === 'phase-1' ? schedule.c1 : shown.stage === 'phase-2' ? schedule.c2 : schedule.a);
    rig.h.service.tick();
  }
  throw new Error('the match did not finish');
};

export interface Row {
  rank: number;
  playerId: string;
  name?: string;
}
export const leaderboard = async (rig: Rig): Promise<Row[]> => ((await get(rig.h, `/matches/${rig.matchId}/leaderboard`)).json() as { items: Row[] }).items;

/** Records the writes of the three store methods a submission uses, in order, with the player id (never the name). */
export const recordWrites = (rig: Rig): string[] => {
  const log: string[] = [];
  const store = rig.h.base.store as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const method of ['putPrediction', 'putClientName']) {
    const original = store[method]!.bind(store);
    store[method] = (...args: unknown[]): unknown => {
      log.push(`${method}:${String(args[1])}`);
      return original(...args);
    };
  }
  return log;
};
