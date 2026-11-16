import { createHash } from 'node:crypto';
import { PUBLIC_CONFIG_KEYS } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import { request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { CLIENT_CREDENTIAL, closeAllServers, startServer } from './helpers/server-harness';
import type { ServerHarness, ServerHarnessOptions } from './helpers/server-harness';
import { creationBody } from './helpers/service-harness';

// Spec 018 FR-498, FR-499, FR-502: every read and the event stream of a client-only match answer the bytes of its open twin,
// except the `clientOnly` member of the views; the own-prediction read keeps its rule; the public config has no new member;
// the host token starts the lobby and does nothing else.

afterEach(closeAllServers);

const OTHER_CREDENTIAL = 'client-credential-tg-0123456789abcd';
const CLIENTS = [
  { namespace: 'web', credential: CLIENT_CREDENTIAL },
  { namespace: 'tg', credential: OTHER_CREDENTIAL },
];
const PUBLIC = { maps: ['dev'], lobbyExpiryHours: 1, maxOpenLobbies: 20 } as const;
const start = (options: ServerHarnessOptions = {}): Promise<ServerHarness> =>
  startServer({
    routes: productionRoutes,
    clients: CLIENTS,
    ...options,
    service: { publicCreation: PUBLIC, ...(options.service ?? {}) },
    limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, createSource: 100_000, createAll: 100_000, joinSource: 100_000, joinMatch: 100_000 },
  });
const get = (h: ServerHarness, path: string, token?: string): Promise<ClientReply> =>
  request(h.port, { path, headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });
const post = (h: ServerHarness, path: string, body: unknown, token?: string): Promise<ClientReply> =>
  request(h.port, { method: 'POST', path, body, headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });

/** The same scripted run on a harness: a creation, a start, owner submissions and the whole match to its end. */
const run = async (clientOnly: boolean): Promise<{ h: ServerHarness; matchId: string; hostToken: string }> => {
  const h = await start({ service: { seed: 7 } });
  const made = await post(h, '/matches', creationBody('c-1', clientOnly ? { joinPolicy: 'client' } : {}), clientOnly ? CLIENT_CREDENTIAL : undefined);
  const { matchId, hostToken } = made.json() as { matchId: string; hostToken: string };
  expect(h.service.startMatch({ credential: hostToken, matchId, body: {} }).ok).toBe(true);
  const faction = h.service.publicMatch(matchId)!.state.owners[0]![1];
  // Only the owner submits in the client-only run; the open run takes the same submissions from the same client.
  expect((await post(h, `/matches/${matchId}/predictions`, { kind: 'winner', faction, playerId: 'p1' }, CLIENT_CREDENTIAL)).status).toBe(200);
  expect((await post(h, `/matches/${matchId}/predictions`, { kind: 'victim', round: 1, faction, playerId: 'p1' }, CLIENT_CREDENTIAL)).status).toBe(200);
  for (let i = 0; i < 300; i++) {
    const shown = h.service.publicMatch(matchId)!;
    if (shown.stage === 'finished') break;
    const schedule = shown.schedule!;
    h.clock.set(shown.stage === 'phase-1' ? schedule.c1 : shown.stage === 'phase-2' ? schedule.c2 : schedule.a);
    h.service.tick();
  }
  expect(h.service.publicMatch(matchId)?.stage).toBe('finished');
  return { h, matchId, hostToken };
};
const withoutFlag = (text: string): string => text.replace(',"clientOnly":true', '');

describe('reads of a client-only match', () => {
  it('FR-498 every public read and the events answer the bytes of the open twin, except the clientOnly member', async () => {
    const closed = await run(true);
    const open = await run(false);
    expect(closed.matchId).toBe(open.matchId);
    const id = closed.matchId;
    const paths = [
      '/matches',
      `/matches/${id}`,
      `/matches/${id}/states/0`,
      `/matches/${id}/states/1`,
      `/matches/${id}/records`,
      `/matches/${id}/records/1`,
      `/matches/${id}/players`,
      `/matches/${id}/results/1/1`,
      `/matches/${id}/results/1/2`,
      `/matches/${id}/results/1/1/winners`,
      `/matches/${id}/players/web:p1/results`,
      `/matches/${id}/leaderboard`,
      '/maps/dev/map.json',
    ];
    let flagged = 0;
    for (const path of paths) {
      const a = await get(closed.h, path);
      const b = await get(open.h, path);
      expect(a.status, path).toBe(b.status);
      if (a.text.includes('"clientOnly":true')) flagged += 1;
      expect(withoutFlag(a.text), path).toBe(b.text);
    }
    // The match view and the list item carry the flag; no other read does.
    expect(flagged).toBe(2);
    const events = (h: ServerHarness): string => JSON.stringify(h.service.eventsAfter(id, 0));
    expect(events(closed.h)).toBe(events(open.h));
  });

  it('FR-498 the own-prediction read keeps its rule: a client reads its own namespace only, whatever the match', async () => {
    const closed = await run(true);
    const id = closed.matchId;
    const own = await get(closed.h, `/matches/${id}/predictions`, CLIENT_CREDENTIAL);
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.json())).toContain('"kind":"winner"');
    const other = await get(closed.h, `/matches/${id}/predictions`, OTHER_CREDENTIAL);
    expect(other.status).toBe(200);
    expect(JSON.stringify(other.json())).not.toContain('"kind":"winner"');
    expect((await get(closed.h, `/matches/${id}/predictions`)).status).toBe(403);
  });

  it('FR-502 the public config has the members and bytes it had, and no member for the policy', async () => {
    const h = await start();
    const config = await get(h, '/config');
    expect(config.status).toBe(200);
    expect(Object.keys(config.json() as object)).toStrictEqual([...PUBLIC_CONFIG_KEYS]);
    expect(config.text).not.toMatch(/client|policy|join/i);
    expect(createHash('sha256').update(config.text).digest('hex')).toHaveLength(64);
  });

  it('FR-498 a client-only match restarted with its owning client removed or renamed stays client-only: reads work, every submission is forbidden', async () => {
    const closed = await run(true);
    const id = closed.matchId;
    // The same store behind a server whose settings no longer hold the `web` credential.
    const again = await startServer({
      routes: productionRoutes,
      clients: [{ namespace: 'tg', credential: OTHER_CREDENTIAL }],
      service: { publicCreation: PUBLIC },
      wrapStore: () => closed.h.base.store,
      limits: { commands: 100_000, reads: 100_000, anonymous: 100_000 },
    });
    const view = await get(again, `/matches/${id}`);
    expect(view.status).toBe(200);
    expect((view.json() as { clientOnly?: boolean }).clientOnly).toBe(true);
    for (const token of [CLIENT_CREDENTIAL, OTHER_CREDENTIAL, undefined]) {
      const reply = await post(again, `/matches/${id}/predictions`, { kind: 'winner', faction: 1, playerId: 'p1' }, token);
      expect([reply.status, (reply.json() as { kind: string }).kind], String(token)).toStrictEqual([403, 'forbidden']);
    }
  });
});

describe('the host token on a client-only match', () => {
  it('FR-499 it starts the lobby and nothing else: no join, no submission, and the policy is still there afterwards', async () => {
    const h = await start();
    const made = await post(h, '/matches', creationBody('c-1', { joinPolicy: 'client' }), CLIENT_CREDENTIAL);
    const { matchId, hostToken } = made.json() as { matchId: string; hostToken: string };
    const joined = await post(h, `/matches/${matchId}/players`, { name: 'Host', requestId: 'j-1' }, hostToken);
    expect([joined.status, (joined.json() as { kind: string }).kind]).toStrictEqual([403, 'joins-closed']);
    const started = await post(h, `/matches/${matchId}/start`, {}, hostToken);
    expect(started.status).toBe(200);
    const view = started.json() as { stage: string; clientOnly?: boolean };
    expect([view.stage, view.clientOnly]).toStrictEqual(['phase-1', true]);
    const faction = h.service.publicMatch(matchId)!.state.owners[0]![1];
    const predicted = await post(h, `/matches/${matchId}/predictions`, { kind: 'winner', faction, playerId: 'p1' }, hostToken);
    expect([predicted.status, (predicted.json() as { kind: string }).kind]).toStrictEqual([403, 'forbidden']);
    // Starting again, or any other command with it, changes nothing about the policy.
    expect(h.base.store.getClientNamespace(matchId)).toBe('web');
    expect((await get(h, `/matches/${matchId}`)).json()).toMatchObject({ clientOnly: true });
  });
});
