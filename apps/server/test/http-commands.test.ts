import { encodeCreation, errorReply } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import { credentialDigest, sha256Ascii } from '../src/service/ids';
import { CREATION_PATH, advancePath, submissionPath } from '../src/service/matches';
import { StoreError } from '../src/store/store';
import { request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { CLIENT_CREDENTIAL, PLANTED, closeAllServers, errorBody, startServer } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { OPERATOR, START_MS, creationBody } from './helpers/service-harness';

// The three command routes over a real listener (M3a' T2'b): creation, advance and submission through the production route
// table, over the real service, an in-memory store and the fake clock. The pipeline order itself is in http-pipeline.test.ts.

afterEach(closeAllServers);

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });
const start = (options: Parameters<typeof startServer>[0] = {}): Promise<ServerHarness> => startServer({ routes: productionRoutes, ...options });
const post = (h: ServerHarness, path: string, body: unknown, token?: string): Promise<ClientReply> =>
  request(h.port, { method: 'POST', path, body, headers: token === undefined ? {} : bearer(token) });
const kindOf = (reply: ClientReply): unknown => (reply.json() as { kind?: unknown }).kind;
const C1 = START_MS + 80_000;

interface Created {
  readonly id: string;
  readonly hostToken: string;
  readonly reply: ClientReply;
}
async function create(h: ServerHarness, requestId = 'c-1'): Promise<Created> {
  const reply = await post(h, '/matches', creationBody(requestId), OPERATOR);
  expect(reply.status).toBe(201);
  const body = reply.json() as { matchId: string; hostToken: string };
  return { id: body.matchId, hostToken: body.hostToken, reply };
}
/** The factions that own territories now (the choices a prediction may name). */
const living = (h: ServerHarness, id: string): number[] =>
  [...new Set(h.base.store.getMatch(id)!.match.state.owners.map(([, f]) => f))].sort((a, b) => a - b);
const winnerBody = (faction: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ kind: 'winner', faction, playerId: 'alice', ...extra });

describe('http commands: creation', () => {
  it('FR-231 FR-232 (replies over HTTP) a creation is 201 with the match, the commitment and the host token, and nothing secret', async () => {
    const h = await start();
    const { id, hostToken, reply } = await create(h);
    const body = reply.json() as { matchId: string; hostToken: string; match: { stage: string; commitment: string; matchSecret?: string } };
    expect(reply.headers['content-type']).toBe('application/json');
    expect(body.match.stage).toBe('phase-1');
    expect(body.match.commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(body.match.matchSecret).toBeUndefined();
    expect(hostToken.length).toBeGreaterThanOrEqual(22);
    const stored = h.service.readPublicMatch(id);
    expect(stored.ok && stored.reply.matchId).toBe(id);
    // The body is the protocol encoding of the creation reply (no extra field).
    expect(reply.text).toBe(encodeCreation({ matchId: id, match: body.match as never, hostToken }));
  });

  it('FR-280 FR-298 a creation without the operator credential is forbidden and creates nothing', async () => {
    const h = await start();
    for (const token of [undefined, 'wrong-credential-0123456789abcdef', CLIENT_CREDENTIAL]) {
      const reply = await post(h, '/matches', creationBody('r-x'), token);
      expect(reply.status).toBe(403);
      expect(reply.text).toBe(errorBody('forbidden'));
    }
    const list = h.service.listMatches({ limit: 10 });
    expect(list.ok && list.reply.items).toStrictEqual([]);
  });

  it('FR-282 (b) (c) FR-298 a replay of the same request id and body returns the same reply, token and status; another body is request-id-reused', async () => {
    const h = await start();
    const first = await create(h, 'r-1');
    h.clock.advance(5_000);
    const again = await post(h, '/matches', creationBody('r-1'), OPERATOR);
    expect(again.status).toBe(201);
    expect(again.text).toBe(first.reply.text);
    expect((again.json() as { hostToken: string }).hostToken).toBe(first.hostToken);
    const list = h.service.listMatches({ limit: 10 });
    expect(list.ok && list.reply.items).toHaveLength(1);
    const other = await post(h, '/matches', creationBody('r-1', { timing: { i: 121, l1: 30, l2: 10 } }), OPERATOR);
    expect(other.status).toBe(409);
    expect(other.json()).toStrictEqual({ kind: 'request-id-reused' });
  });

  it('FR-282 (b) FR-298 a creation made through the service API is replayed through HTTP (the shared creation path)', async () => {
    const h = await start();
    expect(CREATION_PATH).toBe('/matches');
    const made = h.service.create({ credential: OPERATOR, body: creationBody('api-1') });
    if (!made.ok) throw new Error('creation failed');
    const replay = await post(h, '/matches', creationBody('api-1'), OPERATOR);
    expect(replay.status).toBe(201);
    expect((replay.json() as { matchId: string; hostToken: string }).matchId).toBe(made.reply.matchId);
    expect((replay.json() as { hostToken: string }).hostToken).toBe(made.reply.hostToken);
    expect(h.service.listMatches({ limit: 10 }).ok).toBe(true);
    const list = h.service.listMatches({ limit: 10 });
    expect(list.ok && list.reply.items).toHaveLength(1);
  });

  it('FR-292 (unavailable over HTTP) FR-298 a storage failure under a creation is 503 and nothing is stored', async () => {
    const h = await start({ faults: { failTransaction: 1 } });
    const failed = await post(h, '/matches', creationBody('r-1'), OPERATOR);
    expect(failed.status).toBe(503);
    expect(failed.text).toBe(errorBody('unavailable'));
    const list = h.service.listMatches({ limit: 10 });
    expect(list.ok && list.reply.items).toStrictEqual([]);
    expect(h.logs).toStrictEqual([]);
    expect((await post(h, '/matches', creationBody('r-1'), OPERATOR)).status).toBe(201);
  });

  it('FR-232 (replies over HTTP) a creation with a body the service refuses carries its error kind and status', async () => {
    const h = await start();
    const unknownMap = await post(h, '/matches', creationBody('r-1', { mapId: 'nowhere' }), OPERATOR);
    expect([unknownMap.status, kindOf(unknownMap)]).toStrictEqual([404, 'unknown-map']);
    const invalid = await post(h, '/matches', { mapId: 'dev' }, OPERATOR);
    expect([invalid.status, kindOf(invalid)]).toStrictEqual([400, 'invalid-request']);
    const timing = await post(h, '/matches', creationBody('r-2', { timing: { i: 5, l1: 30, l2: 10 } }), OPERATOR);
    expect([timing.status, kindOf(timing)]).toStrictEqual([422, 'invalid-timing']);
  });
});

describe('http commands: advance', () => {
  const step = (round: number, kind: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ round, step: kind, ...extra });

  it('FR-244 FR-245 (replies over HTTP) an advance is 200 with the operator credential and with the host token of that match', async () => {
    const h = await start();
    const m = await create(h);
    const byOperator = await post(h, `/matches/${m.id}/advance`, step(1, 'phase-1-close'), OPERATOR);
    expect(byOperator.status).toBe(200);
    const done = byOperator.json() as { result: string; step: { round: number; kind: string }; match: { stage: string } };
    expect([done.result, done.step.round, done.step.kind, done.match.stage]).toStrictEqual(['performed', 1, 'phase-1-close', 'phase-2']);
    const byHost = await post(h, `/matches/${m.id}/advance`, step(1, 'phase-2-close'), m.hostToken);
    expect(byHost.status).toBe(200);
    expect((byHost.json() as { step: { kind: string } }).step.kind).toBe('phase-2-close');
    // The host token of another match does not authorise this one, and the host token cannot create.
    const other = await create(h, 'c-2');
    const wrongMatch = await post(h, `/matches/${m.id}/advance`, step(1, 'application'), other.hostToken);
    expect(wrongMatch.status).toBe(403);
    expect((await post(h, '/matches', creationBody('c-3'), m.hostToken)).status).toBe(403);
  });

  it('FR-299 (over HTTP) the host token of the match is limited under its own advances bucket, apart from the anonymous address bucket', async () => {
    const h = await start({ limits: { advances: 2, anonymous: 1 } });
    const m = await create(h);
    const go = (kind: string): Promise<ClientReply> => post(h, `/matches/${m.id}/advance`, step(1, kind), m.hostToken);
    expect((await go('phase-1-close')).status).toBe(200);
    expect((await go('phase-2-close')).status).toBe(200);
    const third = await go('application');
    expect([third.status, third.headers['retry-after']]).toStrictEqual([429, '60']);
    // A token that is not the host token of the match is only the address bucket (anonymous: 1).
    expect((await post(h, `/matches/${m.id}/advance`, step(1, 'application'), 'wrong-credential-0123456789abcdef')).status).toBe(403);
    expect((await post(h, `/matches/${m.id}/advance`, step(1, 'application'), 'wrong-credential-0123456789abcdef')).status).toBe(429);
  });

  it('FR-244 a wrong, a missing and a client credential give forbidden bodies identical to each other and to an unknown match', async () => {
    const h = await start();
    const m = await create(h);
    const bodies: string[] = [];
    for (const [id, token] of [
      [m.id, undefined],
      [m.id, 'wrong-credential-0123456789abcdef'],
      [m.id, CLIENT_CREDENTIAL],
      ['no-such-match', 'wrong-credential-0123456789abcdef'],
      ['no-such-match', m.hostToken],
    ] as const) {
      const reply = await post(h, `/matches/${id}/advance`, step(1, 'phase-1-close'), token);
      expect(reply.status).toBe(403);
      bodies.push(reply.text);
    }
    expect(new Set(bodies)).toStrictEqual(new Set([errorBody('forbidden')]));
    // Nothing was performed.
    const read = h.service.readPublicMatch(m.id);
    expect(read.ok && read.reply.stage).toBe('phase-1');
  });

  it('FR-301 (order over HTTP) forbidden comes before request-id-reused, and request-id-reused before unknown-match', async () => {
    const h = await start();
    const m = await create(h);
    const first = await post(h, `/matches/${m.id}/advance`, step(1, 'phase-1-close', { requestId: 'a-1' }), OPERATOR);
    expect(first.status).toBe(200);
    // forbidden before request-id-reused: the reused id and body, with another credential.
    const reusedBody = step(1, 'phase-2-close', { requestId: 'a-1' });
    expect(await post(h, `/matches/${m.id}/advance`, reusedBody, 'wrong-credential-0123456789abcdef')).toMatchObject({ status: 403 });
    expect(await post(h, `/matches/${m.id}/advance`, reusedBody, OPERATOR)).toMatchObject({ status: 409 });
    // request-id-reused before unknown-match: a memo entry held for a match that is gone (planted in the store).
    h.base.store.transaction(() =>
      h.base.store.memoPut(
        { credentialDigest: credentialDigest(OPERATOR), match: 'ghost' },
        'g-1',
        { contentDigest: sha256Ascii('y'), reply: { ok: false, error: errorReply('unknown-match') }, createdMs: START_MS },
      ),
    );
    const ghost = await post(h, '/matches/ghost/advance', step(1, 'phase-1-close', { requestId: 'g-1' }), OPERATOR);
    expect([ghost.status, kindOf(ghost)]).toStrictEqual([409, 'request-id-reused']);
    const unknown = await post(h, '/matches/ghost/advance', step(1, 'phase-1-close', { requestId: 'g-2' }), OPERATOR);
    expect([unknown.status, kindOf(unknown)]).toStrictEqual([404, 'unknown-match']);
  });

  it('FR-282 (b) FR-298 an advance made through the service API is replayed through HTTP (the shared advance path)', async () => {
    const h = await start();
    const m = await create(h);
    expect(advancePath(m.id)).toBe(`/matches/${m.id}/advance`);
    const body = step(1, 'phase-1-close', { requestId: 'api-a' });
    const made = h.service.advance({ credential: OPERATOR, matchId: m.id, body });
    if (!made.ok) throw new Error('advance failed');
    expect(made.reply.result).toBe('performed');
    const replay = await post(h, advancePath(m.id), body, OPERATOR);
    expect(replay.status).toBe(200);
    expect(replay.json()).toStrictEqual(JSON.parse(JSON.stringify(made.reply)));
    expect(h.service.advance({ credential: OPERATOR, matchId: m.id, body })).toStrictEqual(made);
  });

  it('FR-244 FR-245 (replies over HTTP) a step mismatch is 409 with the stage and N, and a malformed body is 400', async () => {
    const h = await start();
    const m = await create(h);
    const wrong = await post(h, `/matches/${m.id}/advance`, step(1, 'application'), OPERATOR);
    expect(wrong.status).toBe(409);
    expect(kindOf(wrong)).toBe('step-mismatch');
    const bad = await post(h, `/matches/${m.id}/advance`, { round: 'one' }, OPERATOR);
    expect([bad.status, kindOf(bad)]).toStrictEqual([400, 'invalid-request']);
  });
});

describe('http commands: predictions', () => {
  it('FR-261 FR-262 FR-267 (replies over HTTP) a web client submission is 200, stored as web:<id> with version 1, and an update raises the version', async () => {
    const h = await start();
    const m = await create(h);
    const [a, b] = living(h, m.id) as [number, number];
    const first = await post(h, `/matches/${m.id}/predictions`, winnerBody(a), CLIENT_CREDENTIAL);
    expect(first.status).toBe(200);
    expect(first.json()).toStrictEqual({ kind: 'winner', choice: a, version: 1 });
    expect(h.base.store.predictionsOf(m.id, 'web:alice')).toHaveLength(1);
    const second = await post(h, `/matches/${m.id}/predictions`, winnerBody(b), CLIENT_CREDENTIAL);
    expect(second.json()).toStrictEqual({ kind: 'winner', choice: b, version: 2 });
    expect(h.base.store.predictionsOf(m.id, 'alice')).toStrictEqual([]);
    expect(h.base.store.predictionsOf(m.id, 'web:web:alice')).toStrictEqual([]);
  });

  it('FR-284 FR-264 (replies over HTTP) a player id carrying a namespace is invalid-player-id and stores nothing', async () => {
    const h = await start();
    const m = await create(h);
    const [a] = living(h, m.id) as [number];
    for (const playerId of ['discord:1', 'web:alice', ':x', 'a b']) {
      const reply = await post(h, `/matches/${m.id}/predictions`, winnerBody(a, { playerId }), CLIENT_CREDENTIAL);
      expect([playerId, reply.status, kindOf(reply)]).toStrictEqual([playerId, 400, 'invalid-player-id']);
    }
    // Without a client credential the same body is still invalid-player-id, before forbidden.
    const anon = await post(h, `/matches/${m.id}/predictions`, winnerBody(a, { playerId: 'discord:1' }));
    expect(kindOf(anon)).toBe('invalid-player-id');
    expect(h.base.store.predictionsOf(m.id, 'discord:1')).toStrictEqual([]);
  });

  it('FR-263 FR-284 (replies over HTTP) a submission without a client credential is forbidden, the operator and host token included', async () => {
    const h = await start();
    const m = await create(h);
    const [a] = living(h, m.id) as [number];
    for (const token of [undefined, OPERATOR, m.hostToken, 'wrong-credential-0123456789abcdef']) {
      const reply = await post(h, `/matches/${m.id}/predictions`, winnerBody(a), token);
      expect(reply.status).toBe(403);
      expect(reply.text).toBe(errorBody('forbidden'));
    }
    expect(h.base.store.predictionsOf(m.id, 'web:alice')).toStrictEqual([]);
  });

  it('FR-266 FR-265 (replies over HTTP) a closed phase is 409 prediction-closed and an unknown choice 422 invalid-choice', async () => {
    const h = await start();
    const m = await create(h);
    const [a] = living(h, m.id) as [number];
    const bad = await post(h, `/matches/${m.id}/predictions`, { kind: 'victim', round: 1, faction: 9999, playerId: 'alice' }, CLIENT_CREDENTIAL);
    expect([bad.status, kindOf(bad)]).toStrictEqual([422, 'invalid-choice']);
    h.clock.set(C1);
    const closed = await post(h, `/matches/${m.id}/predictions`, { kind: 'victim', round: 1, faction: a, playerId: 'alice' }, CLIENT_CREDENTIAL);
    expect([closed.status, kindOf(closed)]).toStrictEqual([409, 'prediction-closed']);
    const unknown = await post(h, '/matches/nope/predictions', winnerBody(a), CLIENT_CREDENTIAL);
    expect([unknown.status, kindOf(unknown)]).toStrictEqual([404, 'unknown-match']);
  });

  it('FR-282 (b) FR-298 a submission made through the service API is replayed through HTTP (the shared submission path)', async () => {
    const h = await start();
    const m = await create(h);
    const [a, b] = living(h, m.id) as [number, number];
    expect(submissionPath(m.id)).toBe(`/matches/${m.id}/predictions`);
    const made = h.service.submit({ client: { credential: CLIENT_CREDENTIAL, namespace: 'web' }, matchId: m.id, body: winnerBody(a, { requestId: 's-1' }) });
    if (!made.ok) throw new Error('submit failed');
    const replay = await post(h, submissionPath(m.id), winnerBody(a, { requestId: 's-1' }), CLIENT_CREDENTIAL);
    expect(replay.status).toBe(200);
    expect(replay.json()).toStrictEqual({ kind: 'winner', choice: a, version: 1 });
    const reused = await post(h, submissionPath(m.id), winnerBody(b, { requestId: 's-1' }), CLIENT_CREDENTIAL);
    expect([reused.status, kindOf(reused)]).toStrictEqual([409, 'request-id-reused']);
    expect(h.base.store.predictionsOf(m.id, 'web:alice')).toHaveLength(1);
  });

  it('FR-292 (unavailable over HTTP) a storage failure under a submission is 503 and stores nothing', async () => {
    const h = await start({ faults: { failTransaction: 2 } }); // transaction 1 is the creation
    const m = await create(h);
    const [a] = living(h, m.id) as [number];
    const failed = await post(h, `/matches/${m.id}/predictions`, winnerBody(a, { requestId: 's-1' }), CLIENT_CREDENTIAL);
    expect(failed.status).toBe(503);
    expect(failed.text).toBe(errorBody('unavailable'));
    expect(h.base.store.predictionsOf(m.id, 'web:alice')).toStrictEqual([]);
    expect(h.logs).toStrictEqual([]);
    // The failure was memoised nowhere: the same request id is processed anew.
    expect((await post(h, `/matches/${m.id}/predictions`, winnerBody(a, { requestId: 's-1' }), CLIENT_CREDENTIAL)).status).toBe(200);
  });
});

describe('http commands: rate limits through the real routes', () => {
  it('FR-299 (over HTTP) the per-player limit is 429 with Retry-After, cancels the credential ticket, and keys by match and player', async () => {
    const h = await start({ limits: { submissions: 1, commands: 3 } });
    const m = await create(h); // 1 of 3 commands for the operator (a different credential from the client)
    const m2 = await create(h, 'c-2');
    const [a] = living(h, m.id) as [number];
    const put = (id: string, player: string): Promise<ClientReply> => post(h, `/matches/${id}/predictions`, winnerBody(a, { playerId: player }), CLIENT_CREDENTIAL);
    expect((await put(m.id, 'p1')).status).toBe(200); // client commands: 1
    const refused = await put(m.id, 'p1'); // over the per-player limit: counted nowhere
    expect(refused.status).toBe(429);
    expect(refused.headers['retry-after']).toBe('60');
    expect(refused.json()).toStrictEqual({ kind: 'rate-limited', retryAfter: 60 });
    expect((await put(m.id, 'p2')).status).toBe(200); // client commands: 2 (the refusal did not count)
    expect((await put(m2.id, 'p1')).status).toBe(200); // the same player in another match has its own key: 3
    expect((await put(m.id, 'p3')).status).toBe(429); // now the credential limit
    expect((await put(m.id, 'p3')).headers['retry-after']).toBe('60');
    h.clock.advance(60_000);
    expect((await put(m.id, 'p3')).status).toBe(200);
    expect((await put(m.id, 'p1')).status).toBe(200); // the player window has opened as well
  });

  it('FR-299 (over HTTP) a request refused before authorization is not counted against the player either', async () => {
    const h = await start({ limits: { submissions: 1 } });
    const m = await create(h);
    const [a] = living(h, m.id) as [number];
    for (let i = 0; i < 3; i += 1) expect((await post(h, `/matches/${m.id}/predictions`, winnerBody(a))).status).toBe(403);
    expect((await post(h, `/matches/${m.id}/predictions`, winnerBody(a), CLIENT_CREDENTIAL)).status).toBe(200);
  });
});

describe('http commands: unexpected exceptions', () => {
  it('NFR-54 (logs) an invalid-write or a TypeError from the service is a 500 with one log event and no message or cause', async () => {
    const h = await start({
      stub: {
        create: () => {
          throw new StoreError('invalid-write', `row ${PLANTED}`, { cause: new Error(`cause ${PLANTED}`) } as never);
        },
        advance: () => {
          throw new TypeError(`namespace ${PLANTED}`);
        },
      },
    });
    const created = await post(h, '/matches', creationBody('r-1'), OPERATOR);
    expect(created.status).toBe(500);
    expect(created.text).toBe('{"kind":"unavailable"}');
    // T4': the event describes the error with the closed fields of `describeError` (name, store code, cause name), no message.
    expect(h.logs).toStrictEqual([{ event: 'request-failed', stage: 'decide', error: { name: 'StoreError', code: 'invalid-write', cause: { name: 'Error' } } }]);
    const advanced = await post(h, '/matches/some/advance', { round: 1, step: 'phase-1-close' }, OPERATOR);
    expect(advanced.status).toBe(500);
    expect(h.logs).toHaveLength(2);
    expect(h.logs[1]).toStrictEqual({ event: 'request-failed', stage: 'decide', error: { name: 'TypeError' } });
    expect(JSON.stringify([created.text, advanced.text, created.headers, h.logs])).not.toContain(PLANTED);
  });
});

describe('http commands: a short match end to end', () => {
  const stepsOf = ['phase-1-close', 'phase-2-close', 'application'] as const;

  it('FR-298 FR-245 FR-259 a match is created, predicted and advanced to its end over HTTP; the secret shows only when finished', async () => {
    const h = await start({ limits: { commands: 1000, advances: 1000 } });
    const m = await create(h);
    const [a] = living(h, m.id) as [number];
    expect((await post(h, `/matches/${m.id}/predictions`, winnerBody(a), CLIENT_CREDENTIAL)).status).toBe(200);
    let finished = false;
    for (let round = 1; round <= 60 && !finished; round += 1) {
      for (const kind of stepsOf) {
        const token = round % 2 === 0 ? m.hostToken : OPERATOR;
        const reply = await post(h, `/matches/${m.id}/advance`, { round, step: kind }, token);
        if (reply.status === 409 && kindOf(reply) === 'match-finished') {
          finished = true;
          break;
        }
        expect([round, kind, reply.status]).toStrictEqual([round, kind, 200]);
        const stage = (reply.json() as { match: { stage: string } }).match.stage;
        if (stage === 'finished') {
          finished = true;
          break;
        }
        const read = h.service.readPublicMatch(m.id);
        expect(read.ok && read.reply.matchSecret).toBeUndefined();
      }
    }
    expect(finished).toBe(true);
    const done = h.service.readPublicMatch(m.id);
    if (!done.ok) throw new Error('read failed');
    expect(done.reply.stage).toBe('finished');
    expect(done.reply.matchSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(done.reply.winner).toBeDefined();
    // A finished match refuses further predictions and advances.
    const late = await post(h, `/matches/${m.id}/predictions`, winnerBody(a, { playerId: 'bob' }), CLIENT_CREDENTIAL);
    expect([late.status, kindOf(late)]).toStrictEqual([409, 'match-finished']);
    const more = await post(h, `/matches/${m.id}/advance`, { round: 1, step: 'phase-1-close' }, OPERATOR);
    expect(more.status).toBe(409);
  }, 30_000);
});
