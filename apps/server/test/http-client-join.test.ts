import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import type { CoreMatch } from '../src/core/view';
import { LOBBY_RETENTION_MS } from '../src/store/store';
import { request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { CLIENT_CREDENTIAL, closeAllServers, errorBody, startServer } from './helpers/server-harness';
import type { ServerHarness, ServerHarnessOptions } from './helpers/server-harness';
import { OPERATOR, START_MS, creationBody } from './helpers/service-harness';

// Spec 018 FR-496, FR-500: a join on a client-only match is `joins-closed` (403) for everybody, whatever the stage, the name,
// the player count or the credential, and stores, draws and publishes nothing. The twin open match answers as before.

afterEach(closeAllServers);

const PUBLIC = { maps: ['dev'], lobbyExpiryHours: 1, maxOpenLobbies: 20 } as const;
const start = (options: ServerHarnessOptions = {}): Promise<ServerHarness> =>
  startServer({
    routes: productionRoutes,
    ...options,
    service: { publicCreation: PUBLIC, ...(options.service ?? {}) },
    limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, createSource: 100_000, createAll: 100_000, joinSource: 100_000, joinMatch: 100_000, ...(options.limits ?? {}) },
  });
const post = (h: ServerHarness, path: string, body: unknown, token?: string): Promise<ClientReply> =>
  request(h.port, { method: 'POST', path, body, headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });
const createClientOnly = async (h: ServerHarness, id = 'c-1'): Promise<{ matchId: string; hostToken: string }> => {
  const reply = await post(h, '/matches', creationBody(id, { joinPolicy: 'client' }), CLIENT_CREDENTIAL);
  if (reply.status !== 201) throw new Error(`creation failed: ${reply.text}`);
  return reply.json() as { matchId: string; hostToken: string };
};
const createOpen = async (h: ServerHarness, id = 'o-1'): Promise<{ matchId: string; hostToken: string }> => (await post(h, '/matches', creationBody(id))).json() as never;
const join = (h: ServerHarness, matchId: string, name: string, requestId: string, token?: string): Promise<ClientReply> => post(h, `/matches/${matchId}/players`, { name, requestId }, token);

/** What a refused join must leave untouched. */
const snapshot = (h: ServerHarness, matchId: string) => ({
  draws: h.base.draws.length,
  players: h.base.store.playerCount(matchId),
  events: h.base.store.eventsAfter(matchId, 0).length,
  lastSeq: h.base.store.getMatch(matchId)?.match.lastSeq,
  memo: h.base.store.memoOldest(),
  matches: h.base.store.listMatches(undefined, 100).length,
});

/** Brings a client-only match to a stage: `lobby` as created, `running` started, `finished`, `halted` and `expired`. */
const toStage = (h: ServerHarness, match: { matchId: string; hostToken: string }, stage: string): void => {
  const { matchId, hostToken } = match;
  if (stage === 'lobby') return;
  if (stage === 'expired') {
    h.clock.set(START_MS + 2 * 3_600_000);
    h.service.tick();
    expect(h.base.store.getMatch(matchId)?.match.stage).toBe('expired');
    return;
  }
  expect(h.service.startMatch({ credential: hostToken, matchId, body: {} }).ok).toBe(true);
  if (stage === 'running') return;
  if (stage === 'halted') {
    const stored = h.base.store.getMatch(matchId)!.match;
    h.base.store.transaction(() => h.base.store.updateMatch({ ...stored, stage: 'halted', haltReason: 'clock-failure', anchors: null, lastSeq: stored.lastSeq + 1 } as unknown as CoreMatch));
    return;
  }
  for (let i = 0; i < 200; i++) {
    const shown = h.service.publicMatch(matchId)!;
    if (shown.stage === 'finished') return;
    const schedule = shown.schedule!;
    h.clock.set(shown.stage === 'phase-1' ? schedule.c1 : shown.stage === 'phase-2' ? schedule.c2 : schedule.a);
    h.service.tick();
  }
  throw new Error('the match does not finish');
};

describe('joins on a client-only match', () => {
  for (const stage of ['lobby', 'running', 'finished', 'halted', 'expired']) {
    it(`FR-496 a join in stage ${stage} is joins-closed 403 for every caller and every name, and nothing is drawn, stored or published`, async () => {
      const h = await start();
      const match = await createClientOnly(h);
      toStage(h, match, stage);
      // A player row and a tiny cap make the free-name, taken-name and full cases all reachable.
      h.base.store.transaction(() =>
        h.base.store.insertPlayer({ matchId: match.matchId, playerId: 'player:seed', name: 'Taken', nameKey: 'taken', tokenDigest: 'f'.repeat(64), joinedSeq: 90, joinedMs: START_MS }),
      );
      const open = await createOpen(h);
      const player = await join(h, open.matchId, 'Opener', 'p-1');
      const playerToken = (player.json() as { playerToken: string }).playerToken;
      const before = snapshot(h, match.matchId);
      const callers: [string, string | undefined][] = [
        ['no credential', undefined],
        ['the operator', OPERATOR],
        ['the owning client', CLIENT_CREDENTIAL],
        ['the host token', match.hostToken],
        ['a player token', playerToken],
        ['an unknown token', 'unknown-token-0123456789abcdef'],
      ];
      for (const [name, token] of callers) {
        for (const [label, joinName] of [['a free name', 'Freya'], ['a taken name', 'Taken'], ['a name with other case', 'TAKEN']] as const) {
          const reply = await join(h, match.matchId, joinName, `r-${name.length}-${label.length}`, token);
          expect([reply.status, reply.text], `${name}, ${label}`).toStrictEqual([403, errorBody('joins-closed')]);
        }
      }
      expect(snapshot(h, match.matchId)).toStrictEqual(before);
    });
  }

  it('FR-496 a full match is joins-closed too, never match-full', async () => {
    const h = await start({ service: { maxPlayers: 1 } });
    const match = await createClientOnly(h);
    h.base.store.transaction(() =>
      h.base.store.insertPlayer({ matchId: match.matchId, playerId: 'player:seed', name: 'Seed', nameKey: 'seed', tokenDigest: 'e'.repeat(64), joinedSeq: 90, joinedMs: START_MS }),
    );
    const reply = await join(h, match.matchId, 'Late', 'r-1');
    expect([reply.status, reply.text]).toStrictEqual([403, errorBody('joins-closed')]);
  });

  it('FR-496 an unknown match is unknown-match as before, and an invalid body is invalid-request before the policy', async () => {
    const h = await start();
    const match = await createClientOnly(h);
    const unknown = await join(h, 'AAAAAAAAAAAAAAAA', 'Ana', 'r-1');
    expect([unknown.status, unknown.text]).toStrictEqual([404, errorBody('unknown-match')]);
    const bad = await post(h, `/matches/${match.matchId}/players`, { name: 5, requestId: 'r-2' });
    expect(bad.status).toBe(400);
    expect((bad.json() as { kind: string }).kind).toBe('invalid-request');
  });

  it('FR-496 the twin open match still accepts the join, with the 011 reply', async () => {
    const h = await start();
    const open = await createOpen(h);
    const reply = await join(h, open.matchId, 'Ana', 'r-1');
    expect(reply.status).toBe(201);
    expect((reply.json() as { match: { playerCount: number } }).match.playerCount).toBe(1);
    expect('clientOnly' in (reply.json() as { match: object }).match).toBe(false);
  });

  it('FR-500 refused joins count against the join limits exactly as the refusals of an open match do', async () => {
    const outcome = async (clientOnly: boolean): Promise<number[]> => {
      const h = await start({ limits: { joinSource: 3 } });
      const match = clientOnly ? await createClientOnly(h) : await createOpen(h);
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await join(h, match.matchId, `Name${i}`, `r-${i}`)).status);
      return statuses;
    };
    const closed = await outcome(true);
    const open = await outcome(false);
    expect(closed).toStrictEqual([403, 403, 403, 429, 429]);
    expect(open).toStrictEqual([201, 201, 201, 429, 429]);
  });

  it('FR-496 a client-only lobby purged after its retention takes its row away without a failure', async () => {
    const h = await start();
    const match = await createClientOnly(h);
    h.clock.set(START_MS + 2 * 3_600_000);
    h.service.tick();
    h.clock.set(START_MS + 2 * 3_600_000 + LOBBY_RETENTION_MS + 1);
    h.service.tick();
    // The memo purge and the lobby purge run in one transaction: the match is gone, and so is the policy row.
    expect(h.base.store.getClientNamespace(match.matchId)).toBeUndefined();
    expect((await join(h, match.matchId, 'Ana', 'r-9')).text).toBe(errorBody('unknown-match'));
  });
});

describe('the contract for the viewer', () => {
  it('FR-504 a client-only match shows clientOnly true to the viewer, and a join it still sends is joins-closed so it can fall back to watching', async () => {
    const h = await start();
    const match = await createClientOnly(h);
    const view = await request(h.port, { path: `/matches/${match.matchId}` });
    expect(view.status).toBe(200);
    expect((view.json() as { clientOnly?: boolean }).clientOnly).toBe(true);
    const refused = await join(h, match.matchId, 'Visitor', 'v-1');
    expect([refused.status, refused.text]).toStrictEqual([403, errorBody('joins-closed')]);
    // The open match shows no member, so the viewer shows the name door as before.
    const open = await createOpen(h);
    expect('clientOnly' in ((await request(h.port, { path: `/matches/${open.matchId}` })).json() as object)).toBe(false);
  });
});
