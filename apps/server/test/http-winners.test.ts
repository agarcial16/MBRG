import { decodeCursor, encodeError, encodePhaseWinners, errorReply, roundNotApplied } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreError } from '../src/store/store';
import { head, raw, request } from './helpers/http-client';
import { bearer, get, makeMatch, startReads } from './helpers/http-reads-kit';
import { namedOn } from './helpers/names-script';
import type { NamedRig } from './helpers/names-script';
import { attachScript } from './helpers/results-script';
import { runNamed } from './helpers/names-script';
import { SECRETS } from './helpers/core-timelines';
import { CLIENT_CREDENTIAL, closeAllServers, errorBody } from './helpers/server-harness';
import type { ServerHarness, ServerHarnessOptions } from './helpers/server-harness';

// The who-guessed-right route over a real listener (spec 011 M5 T4), through the production route table, the real service and
// the fake clock, on the scripted dev-map match with four named players (helpers/names-script.ts). Twins: http-winners-twins.

afterEach(closeAllServers);

const ALLOWED = 'https://app.example';
const OTHER = 'https://evil.example';
const SECRET = SECRETS['ascending-00-1f'];

async function started(done: number, options: ServerHarnessOptions = {}): Promise<{ h: ServerHarness; id: string; n: NamedRig }> {
  const h = await startReads({ service: { secret: SECRET }, ...options });
  const m = makeMatch(h, 'c-1', { timing: 'manual' });
  const n = namedOn(attachScript(h.base, m.id));
  runNamed(n, done);
  return { h, id: m.id, n };
}
const path = (id: string, round: number | string, phase: number | string): string => `/matches/${id}/results/${round}/${phase}/winners`;

describe('the who-guessed-right route: replies', () => {
  it('FR-386 (HTTP) the reply is the bytes of the winners encoder with a JSON content type and lists the named players who were right', async () => {
    const { h, id, n } = await started(12);
    const reply = await get(h, path(id, 1, 1));
    expect([reply.status, reply.headers['content-type']]).toStrictEqual([200, 'application/json']);
    const page = h.service.phaseWinners(id, 1, 1, { limit: 100 });
    if (!page.ok) throw new Error('read refused');
    expect(reply.text).toBe(encodePhaseWinners(page.reply));
    expect(reply.text.startsWith('{"round":1,"phase":1,"items":[{"playerId":"player:')).toBe(true);
    expect(page.reply.items.map((x) => x.name).sort()).toStrictEqual(['Ana', 'José']);
    expect(reply.text).not.toContain(n.bea.playerId);
    expect(reply.text).not.toContain('web:p1');
    const empty = await get(h, path(id, 2, 1));
    expect([empty.status, empty.text]).toStrictEqual([200, '{"round":2,"phase":1,"items":[]}']);
  });

  it('FR-386 (HTTP) a page is cut by limit and followed by its cursor without repeating an item, and the reply is written by the encoder, not by JSON.stringify of the service object', async () => {
    const { h, id } = await started(12);
    const all = ((await get(h, path(id, 1, 1))).json() as { items: unknown[] }).items;
    expect(all).toHaveLength(2);
    const seen: unknown[] = [];
    let next: string | undefined;
    for (let guard = 0; guard < 5; guard++) {
      const reply = await get(h, `${path(id, 1, 1)}?limit=1${next === undefined ? '' : `&cursor=${next}`}`);
      expect(reply.status).toBe(200);
      seen.push(...(reply.json() as { items: unknown[] }).items);
      next = (reply.json() as { next?: string }).next;
      if (next === undefined) break;
      expect(decodeCursor('phase-winners', next).ok).toBe(true);
    }
    expect(seen).toStrictEqual(all);

    const stubbed = await started(0, { stub: { phaseWinners: () => ({ ok: true, reply: { items: [{ name: 'Ana', playerId: 'player:abcdefghijkl' }], phase: 1, round: 1 } }) } });
    expect((await get(stubbed.h, path(stubbed.id, 1, 1))).text).toBe('{"round":1,"phase":1,"items":[{"playerId":"player:abcdefghijkl","name":"Ana"}]}');
  });
});

describe('the who-guessed-right route: the route checks the shapes itself', () => {
  it('FR-301 (order, results routes) with a service that accepts anything, round 0, 01, -1, phase 0, 3, x are still 400 and the query comes first', async () => {
    const { h, id } = await started(0, { stub: { phaseWinners: () => ({ ok: true, reply: { round: 1, phase: 1, items: [] } }) } });
    for (const round of ['0', '01', '-1', 'x', '1.5', '+1']) {
      const reply = await get(h, path(id, round, 1));
      expect([round, reply.status, reply.text]).toStrictEqual([round, 400, encodeError(errorReply('invalid-request', ['round']))]);
    }
    for (const phase of ['0', '3', 'x', '01', '-1', '12']) {
      const reply = await get(h, path(id, 1, phase));
      expect([phase, reply.status, reply.text]).toStrictEqual([phase, 400, encodeError(errorReply('invalid-request', ['phase']))]);
    }
    expect((await get(h, path(id, 0, 3))).text).toBe(encodeError(errorReply('invalid-request', ['round'])));
    expect((await get(h, `${path(id, 0, 3)}?limit=0`)).text).toBe(encodeError(errorReply('invalid-request', ['limit'])));
    expect((await get(h, path(id, 1, 1))).status).toBe(200);
  });

  it('FR-286 (results reads) FR-301 (order, results routes) a bad limit, cursor or other parameter is invalid-request naming it; a cursor of another list is a bad cursor', async () => {
    const { h, id } = await started(12);
    for (const [query, field] of [['limit=0', 'limit'], ['limit=501', 'limit'], ['limit=1&limit=2', 'limit'], ['cursor=zz', 'cursor'], ['playerId=x', 'playerId'], ['zeta=1&alpha=2', 'alpha']] as const) {
      const reply = await get(h, `${path(id, 1, 1)}?${query}`);
      expect([query, reply.status, reply.text]).toStrictEqual([query, 400, encodeError(errorReply('invalid-request', [field]))]);
    }
    const board = ((await get(h, `/matches/${id}/leaderboard?limit=1`)).json() as { next: string }).next;
    const results = ((await get(h, `/matches/${id}/results/1/1?limit=1`)).json() as { next: string }).next;
    const players = ((await get(h, `/matches/${id}/players?limit=1`)).json() as { next: string }).next;
    for (const foreign of [board, results, players]) expect((await get(h, `${path(id, 1, 1)}?cursor=${foreign}`)).text).toBe(encodeError(errorReply('invalid-request', ['cursor'])));
    // And the winners cursor is refused on the other lists.
    const winners = ((await get(h, `${path(id, 1, 1)}?limit=1`)).json() as { next: string }).next;
    expect(decodeCursor('phase-winners', winners).ok).toBe(true);
    for (const other of [`/matches/${id}/leaderboard`, `/matches/${id}/results/1/1`, `/matches/${id}/players`]) expect((await get(h, `${other}?cursor=${winners}`)).text).toBe(encodeError(errorReply('invalid-request', ['cursor'])));
  });

  it('FR-258 (results) an unscored phase, a round past 2^53 - 1 are 404 round-not-applied naming N, with the same bytes in every stage', async () => {
    for (const [done, applied] of [[0, 0], [1, 0], [2, 0], [3, 1], [4, 1]] as const) {
      const { h, id } = await started(done);
      const expected = encodeError(roundNotApplied(applied));
      const unscored: string[] = [`${applied + 1}/2`, `${applied + 2}/1`, `${applied + 2}/2`, '9007199254740991/1', '9007199254740992/2', '99999999999999999999999/1'];
      if (done % 3 === 0) unscored.push(`${applied + 1}/1`);
      for (const p of unscored) {
        const reply = await get(h, `/matches/${id}/results/${p}/winners`);
        expect([done, p, reply.status, reply.text]).toStrictEqual([done, p, 404, expected]);
      }
      await closeAllServers();
    }
  });

  it('FR-301 (order, results routes) an unknown match is 404 after the shape checks, and a storage failure is 503 with nothing leaked', async () => {
    let failing = false;
    const { h, id } = await started(3, {
      wrapStore: (store) => ({
        ...store,
        winnersAfter: (...args) => {
          if (failing) throw new StoreError('store-failure', 'disk /private/path SECRET-TEXT');
          return store.winnersAfter(...args);
        },
      }),
    });
    expect((await get(h, path('nope', 1, 1))).text).toBe(errorBody('unknown-match'));
    expect((await get(h, path('nope', 0, 1))).status).toBe(400);
    expect((await get(h, path('nope', 1, 9))).status).toBe(400);
    failing = true;
    const reply = await get(h, path(id, 1, 1));
    expect([reply.status, reply.text]).toStrictEqual([503, errorBody('unavailable')]);
    expect(JSON.stringify(reply.headers)).not.toContain('SECRET-TEXT');
    expect(h.logs).toStrictEqual([]);
    failing = false;
    expect((await get(h, path(id, 1, 1))).status).toBe(200);
  });

  it('FR-386 (HTTP) a method other than GET is 405 with Allow: GET, OPTIONS, and an extra or missing path segment is unknown-path', async () => {
    const { h, id } = await started(1);
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
      const reply = await request(h.port, { method, path: path(id, 1, 1), ...(method === 'POST' || method === 'PUT' ? { body: {} } : {}) });
      expect([method, reply.status, reply.headers.allow]).toStrictEqual([method, 405, 'GET, OPTIONS']);
    }
    for (const p of [`${path(id, 1, 1)}/`, `${path(id, 1, 1)}/x`, `/matches/${id}/results/1/1/winner`]) expect([p, (await get(h, p)).status]).toStrictEqual([p, 404]);
    // Without the round segment the path is the phase results route with the phase `winners`: a bad phase.
    expect((await get(h, `/matches/${id}/results/1/winners`)).text).toBe(encodeError(errorReply('invalid-request', ['phase'])));
  });
});

describe('the who-guessed-right route: CORS and limits', () => {
  it('FR-286 (results reads) any Origin without Authorization gets *, with Authorization only an allowed origin is echoed; the preflight is the public read preflight', async () => {
    const { h, id } = await started(1);
    for (const origin of [OTHER, ALLOWED, 'null']) {
      const reply = await get(h, path(id, 1, 1), { origin });
      expect([origin, reply.status, reply.headers['access-control-allow-origin'], reply.headers.vary]).toStrictEqual([origin, 200, '*', undefined]);
      expect(reply.headers['access-control-allow-credentials']).toBeUndefined();
    }
    const echoed = await get(h, path(id, 1, 1), { origin: ALLOWED, ...bearer(CLIENT_CREDENTIAL) });
    expect([echoed.status, echoed.headers['access-control-allow-origin'], echoed.headers.vary]).toStrictEqual([200, ALLOWED, 'Origin']);
    const refused = await get(h, path(id, 1, 1), { origin: OTHER, ...bearer(CLIENT_CREDENTIAL) });
    expect([refused.status, refused.headers['access-control-allow-origin']]).toStrictEqual([200, undefined]);
    const pre = await request(h.port, { method: 'OPTIONS', path: path(id, 1, 1), headers: { origin: OTHER, 'access-control-request-method': 'GET' } });
    expect([pre.status, pre.headers['access-control-allow-origin'], pre.headers['access-control-allow-methods'], pre.headers['access-control-max-age']]).toStrictEqual([204, '*', 'GET', '600']);
  });

  it('FR-299 (over HTTP) the anonymous per-minute limit counts the winners route with the other reads', async () => {
    const { h, id } = await started(1, { limits: { anonymous: 2 } });
    expect((await get(h, path(id, 1, 1))).status).toBe(200);
    expect((await get(h, `/matches/${id}/leaderboard`)).status).toBe(200);
    const limited = await get(h, path(id, 1, 1));
    expect([limited.status, limited.json()]).toMatchObject([429, { kind: 'rate-limited' }]);
    h.clock.advance(61_000);
    expect((await get(h, path(id, 1, 1))).status).toBe(200);
  });

  it('FR-386 (HTTP) a raw request for the winners path is answered like any read', async () => {
    const { h, id } = await started(1);
    expect((await raw(h.port, [head('GET', path(id, 1, 1), { connection: 'close' })])).status).toBe(200);
  });

  it('FR-386 (HTTP) the winners page is whole words: no choice, points or wrong guess in the bytes of any scored phase', async () => {
    const { h, id } = await started(12);
    for (const round of [1, 2, 3, 4]) {
      for (const phase of [1, 2]) {
        const reply = await get(h, `${path(id, round, phase)}?limit=1`);
        expect(reply.status).toBe(200);
        for (const word of ['choice', 'points', 'correct', 'victim', 'record', 'wrong']) expect(reply.text).not.toContain(word);
      }
    }
  });
});
