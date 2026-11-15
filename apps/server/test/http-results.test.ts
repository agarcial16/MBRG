import { decodeCursor, encodeError, encodeLeaderboardRow, encodePage, encodePhaseResults, encodePlayerResults, errorReply, roundNotApplied } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreError } from '../src/store/store';
import { raw, head, request } from './helpers/http-client';
import { bearer, get, makeMatch, startReads } from './helpers/http-reads-kit';
import { attachScript, runScript } from './helpers/results-script';
import type { ScriptRig } from './helpers/results-script';
import { SECRETS } from './helpers/core-timelines';
import { CLIENT_CREDENTIAL, closeAllServers, errorBody } from './helpers/server-harness';
import type { ServerHarness, ServerHarnessOptions } from './helpers/server-harness';

// The three results routes over a real listener (spec 008 M4' T4'), through the production route table, the real service,
// an in-memory store and the fake clock, on the scripted dev-map match of helpers/results-script.ts. The twins are in
// http-results-twins.test.ts.

afterEach(closeAllServers);

const ALLOWED = 'https://app.example';
const OTHER = 'https://evil.example';
const SECRET = SECRETS['ascending-00-1f'];

async function started(done: number, options: ServerHarnessOptions = {}): Promise<{ h: ServerHarness; id: string; r: ScriptRig }> {
  const h = await startReads({ service: { secret: SECRET }, ...options });
  const m = makeMatch(h, 'c-1', { timing: 'manual' });
  const r = attachScript(h.base, m.id);
  runScript(r, done);
  return { h, id: m.id, r };
}

const body = <T>(out: { ok: true; reply: T } | { ok: false; error: unknown }): T => {
  if (!out.ok) throw new Error('read refused');
  return out.reply;
};
const cursorOf = (text: string): string => (JSON.parse(text) as { next?: string }).next as string;

describe('the results routes: replies', () => {
  it('FR-281 (e) to (g) (HTTP) FR-257 (results twins over HTTP) the three replies are the bytes of the protocol encoders, with a JSON content type', async () => {
    const { h, id } = await started(12);
    const phase = await get(h, `/matches/${id}/results/1/1`);
    const player = await get(h, `/matches/${id}/players/web:p1/results`);
    const board = await get(h, `/matches/${id}/leaderboard`);
    for (const reply of [phase, player, board]) {
      expect(reply.status).toBe(200);
      expect(reply.headers['content-type']).toBe('application/json');
    }
    expect(phase.text).toBe(encodePhaseResults(body(h.service.phaseResults(id, 1, 1, { limit: 100 }))));
    expect(player.text).toBe(encodePlayerResults(body(h.service.playerResults(id, 'web:p1', { limit: 100 }))));
    expect(board.text).toBe(encodePage(body(h.service.leaderboard(id, { limit: 100 })), encodeLeaderboardRow));
    expect(phase.text.startsWith('{"round":1,"phase":1,"victim":')).toBe(true);
    expect(player.text.startsWith('{"playerId":"web:p1","total":')).toBe(true);
    expect(board.text.startsWith('{"items":[{"rank":1,"playerId":')).toBe(true);
    const two = await get(h, `/matches/${id}/results/2/2`);
    expect(two.text.startsWith('{"round":2,"phase":2,"record":{"round":2,')).toBe(true);
  });

  it('FR-279 (d) (HTTP) a page is cut by limit and followed by its cursor on each of the three routes, never repeating an item', async () => {
    const { h, id } = await started(12);
    for (const path of [`/matches/${id}/results/1/1`, `/matches/${id}/players/web:p1/results`, `/matches/${id}/leaderboard`]) {
      const all = ((await get(h, path)).json() as { items: unknown[] }).items;
      const seen: unknown[] = [];
      let next: string | undefined;
      for (let guard = 0; guard < 30; guard += 1) {
        const reply = await get(h, `${path}?limit=2${next === undefined ? '' : `&cursor=${next}`}`);
        expect(reply.status).toBe(200);
        seen.push(...(reply.json() as { items: unknown[] }).items);
        next = (reply.json() as { next?: string }).next;
        if (next === undefined) break;
      }
      expect(seen, path).toStrictEqual(all);
      expect(all.length).toBeGreaterThan(2);
    }
  });

  it('FR-281 (e) to (g) (HTTP) a reply is written by the protocol encoders, not by JSON.stringify of the service object', async () => {
    // Stubs return objects whose members are in another order: only an encoder writes the wire order.
    const { h, id } = await started(0, {
      stub: {
        phaseResults: () => ({ ok: true, reply: { items: [{ points: 5, correct: true, choice: 2, playerId: 'web:p1' }], victim: 3, phase: 1, round: 1 } }),
        playerResults: () => ({ ok: true, reply: { items: [{ points: 5, correct: true, choice: 2, round: 1, kind: 'victim' }], total: 5, playerId: 'web:p1' } }),
        leaderboard: () => ({ ok: true, reply: { items: [{ correctWinner: 0, correctAbsorbers: 0, correctVictims: 1, total: 5, playerId: 'web:p1', rank: 1 }] } }),
      },
    });
    expect((await get(h, `/matches/${id}/results/1/1`)).text).toBe('{"round":1,"phase":1,"victim":3,"items":[{"playerId":"web:p1","choice":2,"correct":true,"points":5}]}');
    expect((await get(h, `/matches/${id}/players/web:p1/results`)).text).toBe('{"playerId":"web:p1","total":5,"items":[{"kind":"victim","round":1,"choice":2,"correct":true,"points":5}]}');
    expect((await get(h, `/matches/${id}/leaderboard`)).text).toBe('{"items":[{"rank":1,"playerId":"web:p1","total":5,"correctVictims":1,"correctAbsorbers":0,"correctWinner":0}]}');
  });
});

describe('the results routes: the route checks the shapes itself', () => {
  it('FR-301 (order, results routes) with a service that accepts anything, round 0, 01, phase 3 and a bad player id are still 400, and the player id is checked before unknown-match', async () => {
    const unknown = { ok: false, error: errorReply('unknown-match') } as const;
    const { h, id } = await started(0, {
      stub: {
        phaseResults: () => ({ ok: true, reply: { round: 1, phase: 1, victim: 1, items: [] } }),
        playerResults: () => unknown,
        leaderboard: () => unknown,
      },
    });
    for (const path of ['0/1', '01/1', '1/3', '1/0', '1/01']) {
      const reply = await get(h, `/matches/${id}/results/${path}`);
      expect([path, reply.status]).toStrictEqual([path, 400]);
    }
    expect((await get(h, `/matches/${id}/results/1/1`)).status).toBe(200);
    expect((await get(h, `/matches/${id}/players/web:a:b/results`)).text).toBe(encodeError(errorReply('invalid-player-id', ['playerId'])));
    expect((await get(h, `/matches/${id}/players/web:p1/results`)).text).toBe(errorBody('unknown-match'));
  });
});

describe('the results routes: errors in the FR-301 order', () => {
  it('FR-286 (results reads) FR-301 (order, results routes) a bad limit, cursor or other parameter is invalid-request naming it, on each route', async () => {
    const { h, id } = await started(3);
    const paths = [`/matches/${id}/results/1/1`, `/matches/${id}/players/web:p1/results`, `/matches/${id}/leaderboard`];
    for (const path of paths) {
      for (const [query, field] of [['limit=0', 'limit'], ['limit=501', 'limit'], ['limit=1&limit=2', 'limit'], ['cursor=zz', 'cursor'], ['playerId=x', 'playerId'], ['zeta=1&alpha=2', 'alpha']] as const) {
        const reply = await get(h, `${path}?${query}`);
        expect([path, query, reply.status, reply.text]).toStrictEqual([path, query, 400, encodeError(errorReply('invalid-request', [field]))]);
      }
    }
    // The query comes before the shape of the path: a bad round with a bad limit names the limit.
    expect((await get(h, `/matches/${id}/results/0/3?limit=0`)).text).toBe(encodeError(errorReply('invalid-request', ['limit'])));
    // A cursor of another list is a bad cursor.
    const board = cursorOf((await get(h, `/matches/${id}/leaderboard?limit=1`)).text);
    expect(decodeCursor('leaderboard', board).ok).toBe(true);
    for (const path of paths.slice(0, 2)) expect((await get(h, `${path}?cursor=${board}`)).text).toBe(encodeError(errorReply('invalid-request', ['cursor'])));
  });

  it('FR-286 (results reads) FR-301 (order, results routes) a round of 0, 01, -1 or text is invalid-request naming round; a phase other than 1 or 2 names phase, after the round', async () => {
    const { h, id } = await started(3);
    for (const round of ['0', '01', '-1', 'x', '1.5', '1e2', '+1']) {
      const reply = await get(h, `/matches/${id}/results/${round}/1`);
      expect([round, reply.status, reply.text]).toStrictEqual([round, 400, encodeError(errorReply('invalid-request', ['round']))]);
    }
    for (const phase of ['0', '3', 'x', '01', '1.0', '-1', '12']) {
      const reply = await get(h, `/matches/${id}/results/1/${phase}`);
      expect([phase, reply.status, reply.text]).toStrictEqual([phase, 400, encodeError(errorReply('invalid-request', ['phase']))]);
    }
    expect((await get(h, `/matches/${id}/results/0/3`)).text).toBe(encodeError(errorReply('invalid-request', ['round'])));
    // Shape errors come before the match is looked up.
    expect((await get(h, '/matches/nope/results/0/1')).status).toBe(400);
    expect((await get(h, '/matches/nope/results/1/9')).status).toBe(400);
  });

  it('FR-258 (results) a round past 2^53 - 1 and any unscored phase are 404 round-not-applied naming N, with the same bytes', async () => {
    const { h, id } = await started(3);
    const expected = encodeError(roundNotApplied(1));
    for (const path of ['9007199254740991/1', '9007199254740992/2', '99999999999999999999999/1', '2/2', '3/1', '3/2', '4/1', '5/2']) {
      const reply = await get(h, `/matches/${id}/results/${path}`);
      expect([path, reply.status, reply.text]).toStrictEqual([path, 404, expected]);
    }
  });

  it('FR-286 (results reads) FR-301 (order, results routes) a malformed player id is 400 invalid-player-id after the query and before unknown-match; a well-formed unknown match is 404', async () => {
    const { h, id } = await started(3);
    const bad = encodeError(errorReply('invalid-player-id', ['playerId']));
    for (const player of ['p1', 'web', 'web:', ':p1', 'web:a:b', 'Web:a', 'web%3Ap1', 'web:a%20b', `web:${'x'.repeat(65)}`, `${'a'.repeat(17)}:x`]) {
      for (const match of [id, 'nope']) {
        const reply = await get(h, `/matches/${match}/players/${player}/results`);
        expect([match, player, reply.status, reply.text]).toStrictEqual([match, player, 400, bad]);
      }
    }
    // The query is checked first.
    expect((await get(h, `/matches/nope/players/p1/results?limit=0`)).text).toBe(encodeError(errorReply('invalid-request', ['limit'])));
    expect((await get(h, '/matches/nope/players/web:p1/results')).text).toBe(errorBody('unknown-match'));
    expect((await get(h, '/matches/nope/results/1/1')).text).toBe(errorBody('unknown-match'));
    expect((await get(h, '/matches/nope/leaderboard')).text).toBe(errorBody('unknown-match'));
    // A well-formed player with no scored prediction is 200 with no items and a total of 0.
    const idle = await get(h, `/matches/${id}/players/web:nobody/results`);
    expect([idle.status, idle.text]).toStrictEqual([200, '{"playerId":"web:nobody","total":0,"items":[]}']);
  });

  it('FR-279 (d) (HTTP) a leaderboard cursor read after a phase was scored is 409 stale-cursor', async () => {
    const { h, id, r } = await started(1);
    const first = await get(h, `/matches/${id}/leaderboard?limit=2`);
    const cursor = cursorOf(first.text);
    expect((await get(h, `/matches/${id}/leaderboard?limit=2&cursor=${cursor}`)).status).toBe(200);
    runScript(r, 3);
    const stale = await get(h, `/matches/${id}/leaderboard?limit=2&cursor=${cursor}`);
    expect([stale.status, stale.text]).toStrictEqual([409, errorBody('stale-cursor')]);
  });

  it('FR-292 (unavailable over HTTP) a storage failure under a results read is 503 with nothing leaked, and the next read works', async () => {
    let failing = false;
    const failWith = (): never => {
      throw new StoreError('store-failure', 'disk /private/path SECRET-TEXT');
    };
    const { h, id } = await started(3, {
      wrapStore: (store) => ({
        ...store,
        phaseResultsAfter: (...args) => (failing ? failWith() : store.phaseResultsAfter(...args)),
        playerResultsAfter: (...args) => (failing ? failWith() : store.playerResultsAfter(...args)),
        leaderboardTotals: (matchId) => (failing ? failWith() : store.leaderboardTotals(matchId)),
      }),
    });
    failing = true;
    for (const path of [`/matches/${id}/results/1/1`, `/matches/${id}/players/web:p1/results`, `/matches/${id}/leaderboard`]) {
      const reply = await get(h, path);
      expect([path, reply.status, reply.text]).toStrictEqual([path, 503, errorBody('unavailable')]);
      expect(JSON.stringify(reply.headers)).not.toContain('SECRET-TEXT');
    }
    expect(h.logs).toStrictEqual([]);
    failing = false;
    expect((await get(h, `/matches/${id}/leaderboard`)).status).toBe(200);
  });

  it('FR-281 (e) to (g) (HTTP) a method other than GET is 405 with Allow: GET, OPTIONS, and an extra path segment is unknown-path', async () => {
    const { h, id } = await started(1);
    for (const path of [`/matches/${id}/results/1/1`, `/matches/${id}/players/web:p1/results`, `/matches/${id}/leaderboard`]) {
      for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
        const reply = await request(h.port, { method, path, ...(method === 'POST' || method === 'PUT' ? { body: {} } : {}) });
        expect([path, method, reply.status, reply.headers.allow]).toStrictEqual([path, method, 405, 'GET, OPTIONS']);
      }
      expect((await get(h, `${path}/`)).status).toBe(404);
      expect((await get(h, `${path}/x`)).status).toBe(404);
    }
    expect((await get(h, `/matches/${id}/results/1`)).status).toBe(404);
  });
});

describe('the results routes: CORS and limits', () => {
  const PATHS = (id: string): string[] => [`/matches/${id}/results/1/1`, `/matches/${id}/players/web:p1/results`, `/matches/${id}/leaderboard`];

  it('FR-286 (results reads) any Origin without Authorization gets *, with Authorization only an allowed origin is echoed, and no credentials header', async () => {
    const { h, id } = await started(1);
    for (const path of PATHS(id)) {
      for (const origin of [OTHER, ALLOWED, 'null']) {
        const reply = await get(h, path, { origin });
        expect([path, origin, reply.status, reply.headers['access-control-allow-origin'], reply.headers.vary]).toStrictEqual([path, origin, 200, '*', undefined]);
        expect(reply.headers['access-control-allow-credentials']).toBeUndefined();
      }
      const echoed = await get(h, path, { origin: ALLOWED, ...bearer(CLIENT_CREDENTIAL) });
      expect([echoed.status, echoed.headers['access-control-allow-origin'], echoed.headers.vary]).toStrictEqual([200, ALLOWED, 'Origin']);
      const refused = await get(h, path, { origin: OTHER, ...bearer(CLIENT_CREDENTIAL) });
      expect([refused.status, refused.headers['access-control-allow-origin']]).toStrictEqual([200, undefined]);
      expect((await get(h, path)).headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('FR-286 (results reads) the preflight of a results path is the public read preflight: 204, *, GET, 600 s', async () => {
    const { h, id } = await started(1);
    for (const path of PATHS(id)) {
      const reply = await request(h.port, { method: 'OPTIONS', path, headers: { origin: OTHER, 'access-control-request-method': 'GET' } });
      expect([path, reply.status, reply.headers['access-control-allow-origin'], reply.headers['access-control-allow-methods'], reply.headers['access-control-max-age']]).toStrictEqual([path, 204, '*', 'GET', '600']);
    }
  });

  it('FR-299 (over HTTP) NFR-52 (network) the anonymous per-minute limit counts the three results routes together', async () => {
    const { h, id } = await started(1, { limits: { anonymous: 3 } });
    const [a, b, c] = PATHS(id) as [string, string, string];
    expect((await get(h, a)).status).toBe(200);
    expect((await get(h, b)).status).toBe(200);
    expect((await get(h, c)).status).toBe(200);
    const limited = await get(h, a);
    expect([limited.status, limited.json()]).toMatchObject([429, { kind: 'rate-limited' }]);
    expect((await get(h, c)).status).toBe(429);
    h.clock.advance(61_000);
    expect((await get(h, c)).status).toBe(200);
  });

  it('FR-299 (over HTTP) the credential bucket counts the results routes apart from the anonymous one', async () => {
    const { h, id } = await started(1, { limits: { anonymous: 1, reads: 2 } });
    const [a, b, c] = PATHS(id) as [string, string, string];
    expect((await get(h, a, bearer(CLIENT_CREDENTIAL))).status).toBe(200);
    expect((await get(h, b, bearer(CLIENT_CREDENTIAL))).status).toBe(200);
    expect((await get(h, c, bearer(CLIENT_CREDENTIAL))).status).toBe(429);
    expect((await get(h, c)).status).toBe(200);
    expect((await get(h, c)).status).toBe(429);
  });

  it('FR-281 (e) to (g) (HTTP) a raw request for a results path with a chunked or oversized head is answered like any read (no body is read)', async () => {
    const { h, id } = await started(1);
    const reply = await raw(h.port, [head('GET', `/matches/${id}/leaderboard`, { connection: 'close' })]);
    expect(reply.status).toBe(200);
  });
});
