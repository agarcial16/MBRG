import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFailureReporter } from '../src/http/log';
import type { LogEvent } from '../src/http/log';
import { productionRoutes } from '../src/http/server';
import { createShutdown } from '../src/http/shutdown';
import { roundSeed } from '../src/secret';
import { StoreError } from '../src/store/store';
import type { Store } from '../src/store/store';
import { DEV_DIR } from './helpers/digests';
import { encodingsOf } from './helpers/db-scan';
import { head, raw, request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { bearer, living, makeMatch, publicOf, startReads, withTempDirAsync } from './helpers/http-reads-kit';
import { CHILD_OPERATOR, baseEnv, eventsOf, withMain } from './helpers/main-child';
import { CLIENT_CREDENTIAL, closeAllServers } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { OPERATOR, START_MS, creationBody } from './helpers/service-harness';

// NFR-47 (c) (the log scan), NFR-54 (logs), FR-255 and FR-256 (log parts): a scripted session through the real listener with
// a fake random source (a known match secret) and a known round-seed source, planted operator and client credentials, a
// planted host token and a planted player id, driving every failure path (400, 403, 404, 405, 409, 413, 429, 500, 503, a
// halted match, a clock step that fails for good, a shutdown). Nothing sent before the match finishes holds the secret or a
// round seed in any encoding; no credential is in any reply or log line; the host token is only in the creation reply and
// its replay; the logs never hold the secret, even after the finish.

afterEach(closeAllServers);

const SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff);
const SECRET_HEX = Buffer.from(SECRET).toString('hex');
const seedOf = (k: number): number => 3_000_000_000 + 7919 * k;
const seedSource = (): ((k: number) => number) => seedOf;
const PLAYER = 'planted-player-c0ffee';
const OPTIONS = { secret: SECRET, testSeedSource: seedSource };

const holds = (text: string, needle: string | Uint8Array): boolean => (typeof needle === 'string' ? text.includes(needle) : Buffer.from(text, 'utf8').includes(Buffer.from(needle)));
/** Every encoding of the secret and of the first rounds' seeds. */
const SECRET_NEEDLES = encodingsOf(SECRET);
const SEED_NEEDLES = [1, 2, 3, 4, 5, 6].flatMap((k) => encodingsOf(seedOf(k)));

const session = {
  /** Replies (status, headers, body) sent while no match of the session had finished. */
  before: [] as string[],
  after: [] as string[],
  statuses: new Set<number>(),
  logs: [] as string[],
  hostTokens: [] as string[],
};
const entryOf = (status: number, headers: unknown, text: string): string => `${status}\n${JSON.stringify(headers)}\n${text}`;
const keep = (r: ClientReply, finished: boolean): void => {
  session.statuses.add(r.status);
  (finished ? session.after : session.before).push(entryOf(r.status, r.headers, r.text));
};
const logEvents = (events: readonly LogEvent[]): void => void session.logs.push(...events.map((e) => JSON.stringify(e)));

/** A request to a server of the session; `finishedMatch` names the match whose finish moves the reply into `after`. */
async function call(h: ServerHarness, req: Parameters<typeof request>[1], finishedMatch?: string): Promise<ClientReply> {
  const r = await request(h.port, req);
  keep(r, finishedMatch !== undefined && publicOf(h, finishedMatch).stage === 'finished');
  return r;
}

describe('the log scan', () => {
  it('NFR-47 (c) NFR-54 (logs) FR-255 (log part) FR-256 (log part) no reply or log line holds a secret, a round seed or a credential on any failure path; the host token is only in the creation reply and its replay', async () => {
    // --- A: the main session, a manual match played to its end by its host token. ---
    const A = await startReads({ service: OPTIONS });
    const post = (path: string, body: unknown, token: string | undefined, id?: string): Promise<ClientReply> =>
      call(A, { method: 'POST', path, body, headers: token === undefined ? {} : bearer(token) }, id);
    const created = await post('/matches', creationBody('scan-1', { timing: 'manual' }), OPERATOR);
    expect(created.status).toBe(201);
    const { matchId: id, hostToken } = created.json() as { matchId: string; hostToken: string };
    const replay = await post('/matches', creationBody('scan-1', { timing: 'manual' }), OPERATOR);
    expect(replay.json()).toStrictEqual(created.json());
    session.hostTokens.push(hostToken);
    const [a] = living(A, id);

    // Successful reads and commands before the finish.
    for (const path of ['/matches', `/matches/${id}`, `/matches/${id}/states/0`, `/matches/${id}/records`]) expect((await call(A, { path }, id)).status).toBe(200);
    expect((await post(`/matches/${id}/predictions`, { kind: 'winner', faction: a, playerId: PLAYER, requestId: 'p-1' }, CLIENT_CREDENTIAL, id)).status).toBe(200);
    expect((await call(A, { path: `/matches/${id}/predictions?playerId=${PLAYER}`, headers: bearer(CLIENT_CREDENTIAL) }, id)).status).toBe(200);
    expect((await post(`/matches/${id}/advance`, { round: 1, step: 'phase-1-close' }, hostToken, id)).status).toBe(200);
    // 400, 403, 404, 405, 409, 413.
    expect((await post(`/matches/${id}/predictions`, { kind: 'winner', faction: a, playerId: 'discord:1' }, CLIENT_CREDENTIAL, id)).status).toBe(400);
    expect((await call(A, { method: 'POST', path: '/matches', body: '{"bad json', headers: bearer(OPERATOR) }, id)).status).toBe(400);
    expect((await call(A, { path: '/matches?limit=0' }, id)).status).toBe(400);
    expect((await post(`/matches/${id}/advance`, { round: 1, step: 'phase-2-close' }, 'wrong-token-0123456789abcdef', id)).status).toBe(403);
    expect((await post(`/matches/${id}/predictions`, { kind: 'winner', faction: a, playerId: PLAYER }, undefined, id)).status).toBe(403);
    expect((await call(A, { path: '/nowhere' }, id)).status).toBe(404);
    expect((await call(A, { path: '/matches/no-such-match' }, id)).status).toBe(404);
    expect((await call(A, { path: `/matches/${id}/states/9` }, id)).status).toBe(404);
    expect((await call(A, { method: 'DELETE', path: `/matches/${id}` }, id)).status).toBe(405);
    expect((await post(`/matches/${id}/advance`, { round: 1, step: 'application' }, hostToken, id)).status).toBe(409);
    expect((await post('/matches', { ...creationBody('scan-1', { timing: 'manual' }), mapId: 'other' }, OPERATOR, id)).status).toBe(409);
    const big = await raw(A.port, [head('POST', '/matches', { authorization: `Bearer ${OPERATOR}`, 'content-length': '4097', 'content-type': 'application/json' })]);
    expect(big.status).toBe(413);
    session.statuses.add(413);
    session.before.push(entryOf(big.status, big.headers, big.body));

    // The match goes on to its end by the host token (the reply that finishes it, and all after, may hold the secret).
    while (publicOf(A, id).stage !== 'finished') {
      const shown = publicOf(A, id);
      const step = shown.stage === 'phase-1' ? 'phase-1-close' : shown.stage === 'phase-2' ? 'phase-2-close' : 'application';
      expect((await post(`/matches/${id}/advance`, { round: shown.appliedRounds + 1, step }, hostToken, id)).status).toBe(200);
    }
    expect((await call(A, { path: `/matches/${id}` }, id)).text).toContain(SECRET_HEX);

    // A shutdown at the end, over the same listener: its lines are logged too.
    const exits: number[] = [];
    const shutdown = createShutdown({ server: A.server, service: A.service, scheduler: A.base.scheduler ?? { at: () => 0, cancel: () => undefined }, clock: A.clock, log: (e) => void A.logs.push(e), exit: (c) => void exits.push(c), graceMs: 5000 });
    shutdown.begin('SIGTERM', 0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(exits).toStrictEqual([0]);
    logEvents(A.logs);

    // --- B: the rate limit (429). ---
    const B = await startReads({ service: OPTIONS, limits: { anonymous: 2 } });
    makeMatch(B);
    for (let i = 0; i < 4; i += 1) await call(B, { path: '/matches' });
    logEvents(B.logs);

    // --- C: a storage failure on a command and on a read (503). ---
    const C = await startReads({
      service: OPTIONS,
      faults: { failTransaction: 1 },
      wrapStore: (store): Store => ({ ...store, getMatch: () => { throw new StoreError('store-failure', `read failed ${SECRET_HEX} ${OPERATOR} ${CLIENT_CREDENTIAL}`, { cause: new Error(SECRET_HEX) }); } }),
    });
    expect((await call(C, { method: 'POST', path: '/matches', body: creationBody('c-1'), headers: bearer(OPERATOR) })).status).toBe(503);
    expect((await call(C, { path: '/matches/anything' })).status).toBe(503);
    logEvents(C.logs);

    // --- D: unexpected exceptions that quote every planted value in their messages (500). ---
    const quote = `${SECRET_HEX} ${OPERATOR} ${CLIENT_CREDENTIAL} ${hostToken} ${PLAYER} ${seedOf(1)}`;
    const D = await startReads({
      service: OPTIONS,
      stub: {
        readPublicMatch: () => {
          throw new TypeError(`unexpected ${quote}`);
        },
        create: () => {
          throw new RangeError(`unexpected ${quote}`);
        },
      },
    });
    expect((await call(D, { path: '/matches/x' })).status).toBe(500);
    expect((await call(D, { method: 'POST', path: '/matches', body: creationBody('d-1'), headers: bearer(OPERATOR) })).status).toBe(500);
    expect(D.logs.map((e) => e.event)).toStrictEqual(['request-failed', 'request-failed']);
    logEvents(D.logs);

    // --- E: a halted match (its map package changed after the creation). ---
    await withTempDirAsync(async (dir) => {
      const folder = join(dir, 'pkg');
      mkdirSync(folder);
      for (const file of ['map.json', 'ids.png', 'presentation.json']) copyFileSync(join(DEV_DIR, file), join(folder, file));
      const E = await startReads({ service: { ...OPTIONS, folders: { dev: folder } } });
      const made = makeMatch(E);
      session.hostTokens.push(made.hostToken);
      writeFileSync(join(folder, 'map.json'), `${readFileSync(join(DEV_DIR, 'map.json'), 'utf8')} `);
      const halted = await call(E, { method: 'POST', path: `/matches/${made.id}/advance`, body: { round: 1, step: 'phase-1-close' }, headers: bearer(OPERATOR) });
      expect(halted.status).toBe(409);
      expect((halted.json() as { kind: string }).kind).toBe('match-halted');
      expect((await call(E, { path: `/matches/${made.id}` })).status).toBe(200);
      logEvents(E.logs);
    });

    // --- F: a clock step that fails for good (an invalid-write retried every 3 s), reported under the rate rule. ---
    const failures: LogEvent[] = [];
    const flaky = { broken: false };
    const F = await startReads({
      service: { ...OPTIONS, scheduler: true, onFailure: (failure, cause) => reporter(failure, cause) },
      wrapStore: (store): Store => ({
        ...store,
        updateMatch(match) {
          if (flaky.broken) {
            throw new StoreError('invalid-write', `constraint failed ${SECRET_HEX} ${OPERATOR} ${PLAYER}`, { cause: Object.assign(new Error(`UNIQUE constraint failed: ${SECRET_HEX} ${seedOf(1)}`), { code: 'ERR_SQLITE_ERROR', errcode: 19, errstr: SECRET_HEX }), sqliteCode: 19, sqliteText: SECRET_HEX });
          }
          store.updateMatch(match);
        },
      }),
    });
    const reporter = createFailureReporter((e) => void failures.push(e), F.clock);
    const flakyMatch = makeMatch(F, 'f-1', {});
    session.hostTokens.push(flakyMatch.hostToken);
    flaky.broken = true;
    F.base.scheduler!.runTo(START_MS + 80_000 + 3 * 3000 * 21);
    // 64 attempts, 3 s apart, over 189 s: reported at 0, 60, 120 and 180 s into the failure, 19 repeats skipped each time.
    expect(failures.map((e) => (e.event === 'step-failed' ? e.suppressed : -1))).toStrictEqual([0, 19, 19, 19]);
    logEvents(failures);
    logEvents(F.logs);
    expect((await call(F, { path: `/matches/${flakyMatch.id}` })).status).toBe(200);

    // --- The scan. ---
    for (const code of [400, 403, 404, 405, 409, 413, 429, 500, 503]) expect(session.statuses.has(code), `status ${code}`).toBe(true);
    expect(session.before.length).toBeGreaterThan(30);
    expect(session.logs.length).toBeGreaterThan(5);
    // Nothing sent before the finish, and no log line at any time, holds the secret or a round seed.
    for (const text of [...session.before, ...session.logs]) {
      for (const needle of [...SECRET_NEEDLES, ...SEED_NEEDLES]) expect(holds(text, needle), `${String(needle).slice(0, 14)} in ${text.slice(0, 80)}`).toBe(false);
    }
    // The scan can see the secret: it is in the replies after the finish.
    expect(session.after.some((t) => t.includes(SECRET_HEX))).toBe(true);
    // No credential is in any reply or log line, and nothing is logged about a player, a path, a body or a message.
    const everything = [...session.before, ...session.after, ...session.logs];
    for (const credential of [OPERATOR, CLIENT_CREDENTIAL, 'wrong-token-0123456789abcdef']) expect(everything.filter((t) => t.includes(credential)), credential).toStrictEqual([]);
    for (const line of session.logs) {
      for (const planted of [PLAYER, ...session.hostTokens, 'planted', 'unexpected', 'constraint failed', 'UNIQUE', 'read failed', '/matches', 'Bearer']) expect(line, planted).not.toContain(planted);
    }
    // The host token of the main match is only in the creation reply and its replay (the same text twice).
    const withToken = everything.filter((t) => t.includes(hostToken));
    expect(withToken).toHaveLength(2);
    for (const text of withToken) expect(text.startsWith('201\n')).toBe(true);
    // The own predictions carry the planted player id only in the reply to its client.
    expect(everything.filter((t) => t.includes(PLAYER))).toHaveLength(1);
  }, 60_000);

  it('NFR-47 (c) a production process holds no planted credential, host token, secret or round seed in stdout or stderr, whatever it served', async () => {
    const CLIENT = 'child-client-credential-abcdef0123456789';
    const env = baseEnv({ MBRG_CLIENTS: JSON.stringify([{ namespace: 'web', credential: CLIENT }]), MBRG_ALLOWED_ORIGINS: 'https://app.example', MBRG_LIMIT_ANONYMOUS: '3' });
    await withMain(env, async (child, port) => {
      const authed = { authorization: `Bearer ${CHILD_OPERATOR}` };
      const created = await request(port, { method: 'POST', path: '/matches', headers: authed, body: creationBody('s-1', { timing: 'manual' }) });
      const { matchId, hostToken } = created.json() as { matchId: string; hostToken: string };
      const asHost = { authorization: `Bearer ${hostToken}` };
      const statuses: number[] = [];
      const note = async (r: Promise<ClientReply>): Promise<ClientReply> => {
        const reply = await r;
        statuses.push(reply.status);
        return reply;
      };
      await note(request(port, { method: 'POST', path: `/matches/${matchId}/advance`, headers: { authorization: 'Bearer nope-0123456789abcdefghij' }, body: { round: 1, step: 'phase-1-close' } }));
      await note(request(port, { method: 'POST', path: '/matches', headers: authed, body: '{"x' }));
      await note(request(port, { method: 'POST', path: `/matches/${matchId}/predictions`, headers: { authorization: `Bearer ${CLIENT}` }, body: { kind: 'winner', faction: 1, playerId: 'discord:1' } }));
      await note(request(port, { path: '/nowhere', headers: authed }));
      await raw(port, [head('POST', '/matches', { authorization: `Bearer ${CHILD_OPERATOR}`, 'content-length': '4097' })]);
      for (let i = 0; i < 6; i += 1) await note(request(port, { path: '/matches' }));
      expect(statuses).toContain(429);
      // The match is played to its end by its host token: the secret is revealed to the client only now.
      let shown = (await request(port, { path: `/matches/${matchId}`, headers: authed })).json() as { stage: string; appliedRounds: number; matchSecret?: string };
      while (shown.stage !== 'finished') {
        const step = shown.stage === 'phase-1' ? 'phase-1-close' : shown.stage === 'phase-2' ? 'phase-2-close' : 'application';
        const advanced = await request(port, { method: 'POST', path: `/matches/${matchId}/advance`, headers: asHost, body: { round: shown.appliedRounds + 1, step } });
        expect(advanced.status).toBe(200);
        shown = (advanced.json() as { match: typeof shown }).match;
      }
      const secret = new Uint8Array(Buffer.from(shown.matchSecret!, 'hex'));
      const out = `${child.stdout()}\n${child.stderr()}`;
      const needles: (string | Uint8Array)[] = [CHILD_OPERATOR, CLIENT, hostToken, 'nope-0123456789abcdefghij', matchId, ...encodingsOf(secret), ...[1, 2, 3, 4].flatMap((k) => encodingsOf(roundSeed(secret, k))).filter((n) => typeof n !== 'string' || n.length >= 8)];
      for (const needle of needles) expect(holds(out, needle), String(needle).slice(0, 16)).toBe(false);
      expect(eventsOf(child.stdout()).map((e) => e.event)).toStrictEqual(['start-report', 'listening']);
      expect(child.stderr()).toBe('');
    });
  }, 120_000);
});
