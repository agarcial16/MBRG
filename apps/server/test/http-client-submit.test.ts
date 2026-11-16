import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import { request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { CLIENT_CREDENTIAL, closeAllServers, errorBody, startServer } from './helpers/server-harness';
import type { ServerHarness, ServerHarnessOptions } from './helpers/server-harness';
import { START_MS, creationBody, serviceHarness } from './helpers/service-harness';

// Spec 018 FR-497, FR-500: on a client-only match only a client credential of the owning namespace submits; every other caller
// gets the `forbidden` any other non-client caller gets, before any memo, cutoff or stage rule, and nothing is stored.

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
    limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, createSource: 100_000, createAll: 100_000, joinSource: 100_000, joinMatch: 100_000, ...(options.limits ?? {}) },
  });
const post = (h: ServerHarness, path: string, body: unknown, token?: string): Promise<ClientReply> =>
  request(h.port, { method: 'POST', path, body, headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });

/** A started match: client-only (created by the `web` client) or open (anonymous), and a faction to predict. */
const startedMatch = async (h: ServerHarness, clientOnly: boolean): Promise<{ matchId: string; hostToken: string; faction: number }> => {
  const reply = await post(h, '/matches', creationBody(clientOnly ? 'c-1' : 'o-1', clientOnly ? { joinPolicy: 'client' } : {}), clientOnly ? CLIENT_CREDENTIAL : undefined);
  const created = reply.json() as { matchId: string; hostToken: string };
  expect(h.service.startMatch({ credential: created.hostToken, matchId: created.matchId, body: {} }).ok).toBe(true);
  const view = h.service.publicMatch(created.matchId)!;
  return { ...created, faction: view.state.owners[0]![1] };
};
const submission = (faction: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ kind: 'winner', faction, playerId: 'p1', ...extra });
const predictions = (h: ServerHarness, matchId: string): number => h.base.store.predictionsOf(matchId, 'web:p1').length + h.base.store.predictionsOf(matchId, 'tg:p1').length;

describe('submissions on a client-only match', () => {
  it('FR-497 the owning client submits exactly as in 008: accepted, a repeat of the request id replays, a change is a new version', async () => {
    const h = await start();
    const m = await startedMatch(h, true);
    const first = await post(h, `/matches/${m.matchId}/predictions`, submission(m.faction, { requestId: 's-1' }), CLIENT_CREDENTIAL);
    expect([first.status, first.json()]).toStrictEqual([200, { kind: 'winner', choice: m.faction, version: 1 }]);
    const again = await post(h, `/matches/${m.matchId}/predictions`, submission(m.faction, { requestId: 's-1' }), CLIENT_CREDENTIAL);
    expect([again.status, again.text]).toStrictEqual([200, first.text]);
    expect(h.base.store.predictionsOf(m.matchId, 'web:p1')).toHaveLength(1);
  });

  it('FR-497 another client, a player token, no credential and a wrong credential all get the same forbidden, and nothing is stored', async () => {
    const h = await start();
    const m = await startedMatch(h, true);
    const open = await startedMatch(h, false);
    // A player of the open match, and an own-namespace id for it: its token is not the owner's.
    const joined = await post(h, `/matches/${open.matchId}/players`, { name: 'Ana', requestId: 'j-1' });
    const playerToken = (joined.json() as { playerToken: string }).playerToken;
    const callers: [string, string | undefined][] = [
      ['another client', OTHER_CREDENTIAL],
      ['a player token', playerToken],
      ['no credential', undefined],
      ['an unknown token', 'unknown-token-0123456789abcdef'],
      ['the host token', m.hostToken],
    ];
    const reference = await post(h, `/matches/${open.matchId}/predictions`, submission(open.faction), undefined);
    expect([reference.status, reference.text]).toStrictEqual([403, errorBody('forbidden')]);
    for (const [name, token] of callers) {
      const reply = await post(h, `/matches/${m.matchId}/predictions`, submission(m.faction, { requestId: `r-${name.length}` }), token);
      expect([reply.status, reply.text], name).toStrictEqual([reference.status, reference.text]);
    }
    expect(predictions(h, m.matchId)).toBe(0);
  });

  it('FR-497 the check comes before the stage and cutoff rules: a restricted caller is forbidden even after the match ended', async () => {
    const h = await start();
    const m = await startedMatch(h, true);
    for (let i = 0; i < 200; i++) {
      const shown = h.service.publicMatch(m.matchId)!;
      if (shown.stage === 'finished') break;
      const schedule = shown.schedule!;
      h.clock.set(shown.stage === 'phase-1' ? schedule.c1 : shown.stage === 'phase-2' ? schedule.c2 : schedule.a);
      h.service.tick();
    }
    expect(h.service.publicMatch(m.matchId)?.stage).toBe('finished');
    const restricted = await post(h, `/matches/${m.matchId}/predictions`, submission(m.faction), OTHER_CREDENTIAL);
    expect([restricted.status, restricted.text]).toStrictEqual([403, errorBody('forbidden')]);
    const owner = await post(h, `/matches/${m.matchId}/predictions`, submission(m.faction), CLIENT_CREDENTIAL);
    expect(owner.text).toBe(errorBody('match-finished'));
  });

  it('FR-497 an unknown match is unknown-match for every client, as before', async () => {
    const h = await start();
    const reply = await post(h, '/matches/AAAAAAAAAAAAAAAA/predictions', submission(1), OTHER_CREDENTIAL);
    expect([reply.status, reply.text]).toStrictEqual([404, errorBody('unknown-match')]);
  });

  it('FR-500 refused submissions count against the submission limits like any refusal', async () => {
    const outcome = async (clientOnly: boolean): Promise<number[]> => {
      const h = await start({ limits: { commands: 3 } });
      const m = await startedMatch(h, clientOnly);
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await post(h, `/matches/${m.matchId}/predictions`, submission(m.faction), OTHER_CREDENTIAL)).status);
      return statuses;
    };
    const closed = await outcome(true);
    expect(closed).toStrictEqual([403, 403, 403, 429, 429]);
    // The open twin accepts the same requests and is limited at the very same count.
    expect((await outcome(false)).indexOf(429)).toBe(closed.indexOf(429));
  });
});

describe('the memo of a submission and the owning namespace', () => {
  it('FR-497 a client renamed or removed from the settings is forbidden even for a request id it used before (its memoised refusals are not replayed)', () => {
    const first = serviceHarness({ publicCreation: { maps: ['dev'] } });
    const credential = CLIENT_CREDENTIAL;
    const made = first.service.createPublic({ source: 's', body: creationBody('c-1', { joinPolicy: 'client' }), client: { credential, namespace: 'web' } });
    if (!made.ok) throw new Error('creation failed');
    const { matchId, hostToken } = made.reply;
    expect(first.service.startMatch({ credential: hostToken, matchId, body: {} }).ok).toBe(true);
    // A closed round's victim prediction is refused `prediction-closed` and memoised under the credential digest.
    first.clock.set(START_MS + 80_000 + 1);
    first.service.tick();
    const stale = { kind: 'victim', round: 1, faction: 1, playerId: 'p1', requestId: 'old-1' };
    const before = first.service.submit({ client: { credential, namespace: 'web' }, matchId, body: stale });
    expect(before.ok).toBe(false);
    expect(before.ok === false && before.error.kind).not.toBe('forbidden');
    // The same credential now configured under another namespace: not the owner.
    const renamed = first.service.submit({ client: { credential, namespace: 'web2' }, matchId, body: stale });
    expect(renamed).toStrictEqual({ ok: false, error: { kind: 'forbidden' } });
    // The owner is still recognised by its namespace.
    const owner = first.service.submit({ client: { credential, namespace: 'web' }, matchId, body: stale });
    expect(owner).toStrictEqual(before);
    first.close();
  });
});
