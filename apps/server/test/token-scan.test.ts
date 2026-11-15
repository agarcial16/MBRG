import { join } from 'node:path';
import type { PublicMatch } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { MEMO_RETENTION_MS } from '../src/core/memo';
import { credentialDigest } from '../src/service/ids';
import type { MatchService } from '../src/service/matches';
import { openStore } from '../src/store/sqlite';
import { credentialTextColumns, listColumns, needlesHeldBy, playerEventViolations, playerTokenPlaces, scanValues, tokenNeedles, withRawDb } from './helpers/db-scan';
import { lobbyServiceWith } from './helpers/durability-script';
import { fakeClock } from './helpers/fake-clock';
import { fakeRandom } from './helpers/fake-random';
import { bearer, startReads } from './helpers/http-reads-kit';
import { request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { openStream } from './helpers/sse-reader';
import type { Frame } from './helpers/sse-reader';
import { closeAllServers } from './helpers/server-harness';
import { START_MS, creationBody, withTempDir } from './helpers/service-harness';

// NFR-73: a token (the host token, a player token) is given once, in the reply that creates it (and in the replay of that reply
// for 24 h), and appears nowhere else: not in a read, an event frame, an error, a header or a log line; the database keeps only
// its one-way digest, except for the 24 h memo of the reply, which is gone 24 h + 1 ms later. A scripted session of public
// creation, joins, the start, predictions, refused and rate-limited requests, a failing request, a restart and an expiry is
// scanned for every token in every encoding (text, decimal, hexadecimal, base64 with and without padding, base64url, bytes).

afterEach(closeAllServers);

const HOUR = 3_600_000;
const NAME_ANA = 'Zoë Planted';
const NAME_BEA = 'Bea-Marker-77';
const NAME_ZED = 'Cy.Needle.5';

interface Seen {
  readonly what: string;
  readonly text: string;
  /** The tokens this output carries by design: the reply that created them, and its replay. */
  readonly carries: readonly string[];
}

describe('tokens in the replies, events, errors, headers and logs of a session', () => {
  it('NFR-73 no read, event frame, error body, header or log line holds a host or player token in any encoding, apart from the reply that created it and its replay; names are in no log line', async () => {
    const seen: Seen[] = [];
    const tokens = new Map<string, string>(); // label -> token text
    let real: MatchService | undefined;
    let throwNext = false;
    const h = await startReads({
      service: { publicCreation: { maps: ['dev'], lobbyExpiryHours: 1 } },
      limits: { joinSource: 9 },
      stub: {
        submit: (req) => {
          if (throwNext) {
            throwNext = false;
            throw new TypeError(`boom ${[...tokens.values()].join(' ')} ${NAME_ANA}`);
          }
          return real!.submit(req);
        },
      },
    });
    real = h.base.service;

    const keep = (what: string, r: ClientReply, carries: readonly string[] = []): ClientReply => {
      seen.push({ what: `${what} (${r.status})`, text: `${r.status}\n${JSON.stringify(r.headers)}\n${r.text}`, carries });
      return r;
    };
    const post = (what: string, path: string, body: unknown, token?: string, carries: readonly string[] = []): Promise<ClientReply> =>
      request(h.port, { method: 'POST', path, body, headers: token === undefined ? {} : bearer(token) }).then((r) => keep(what, r, carries));
    const get = (what: string, path: string, token?: string): Promise<ClientReply> => request(h.port, { path, headers: token === undefined ? {} : bearer(token) }).then((r) => keep(what, r));

    // Public creation and its replay carry the host token.
    const made = await post('creation', '/matches', creationBody('t-1'), undefined);
    expect(made.status).toBe(201);
    const { matchId: id, hostToken } = made.json() as { matchId: string; hostToken: string };
    const shownOf = (): PublicMatch => {
      const read = h.service.readPublicMatch(id);
      if (!read.ok) throw new Error('no public data');
      return read.reply;
    };
    tokens.set('host', hostToken);
    seen[seen.length - 1] = { ...seen[seen.length - 1]!, carries: ['host'] };
    const replay = await post('creation replay', '/matches', creationBody('t-1'), undefined, ['host']);
    expect(replay.json()).toStrictEqual(made.json());

    // A stream from the start of the match; its frames are scanned like the replies.
    const feed = await openStream({ port: h.port, path: `/matches/${id}/events?lastEventId=0` });
    expect(feed.status).toBe(200);

    // Joins: each reply and its replay carry the player's own token.
    const players: { label: string; name: string; playerId: string; local: string; token: string }[] = [];
    for (const [label, name] of [['ana', NAME_ANA], ['bea', NAME_BEA], ['zed', NAME_ZED]] as const) {
      const r = await post(`join ${label}`, `/matches/${id}/players`, { name, requestId: `j-${label}` });
      expect(r.status).toBe(201);
      const body = r.json() as { playerId: string; playerToken: string };
      tokens.set(label, body.playerToken);
      seen[seen.length - 1] = { ...seen[seen.length - 1]!, carries: [label] };
      players.push({ label, name, playerId: body.playerId, local: body.playerId.slice('player:'.length), token: body.playerToken });
    }
    const [ana, bea, zed] = players as [(typeof players)[number], (typeof players)[number], (typeof players)[number]];
    expect((await post('join replay ana', `/matches/${id}/players`, { name: NAME_ANA, requestId: 'j-ana' }, undefined, ['ana'])).json()).toMatchObject({ playerToken: ana.token });
    // Refused joins: the name is taken, the name is bad, the body is bad; the rate limit of one source.
    expect((await post('join name taken', `/matches/${id}/players`, { name: NAME_ANA.toUpperCase(), requestId: 'j-x' })).status).toBe(409);
    expect((await post('join bad name', `/matches/${id}/players`, { name: 'no <tags>', requestId: 'j-y' })).status).toBe(400);
    expect((await post('join bad body', `/matches/${id}/players`, { requestId: 'j-z' })).status).toBe(400);
    const statuses = new Set<number>();
    let flooded = 0;
    for (let i = 0; i < 12; i += 1) {
      const status = (await post('join flood', `/matches/${id}/players`, { name: `Flood ${i}`, requestId: `j-f${i}` })).status;
      statuses.add(status);
      if (status === 201) flooded += 1;
    }
    expect(statuses.has(429)).toBe(true);

    // Requests that send a token and are refused: the reply does not echo it.
    expect((await post('start by a player', `/matches/${id}/start`, {}, ana.token)).status).toBe(403);
    expect((await post('start by a wrong token', `/matches/${id}/start`, {}, 'wrong-token-0123456789abcdefghijklmnop')).status).toBe(403);
    expect((await post('prediction before the start', `/matches/${id}/predictions`, { kind: 'winner', faction: 1, playerId: ana.local }, ana.token)).status).toBeGreaterThanOrEqual(400);
    expect((await post('unknown path with a token', '/nowhere', {}, bea.token)).status).toBe(404);
    expect((await request(h.port, { method: 'DELETE', path: `/matches/${id}`, headers: bearer(bea.token) }).then((r) => keep('delete with a token', r))).status).toBe(405);
    expect((await post('bad body with a token', `/matches/${id}/predictions`, '{"bad json', bea.token)).status).toBe(400);
    expect((await request(h.port, { method: 'OPTIONS', path: `/matches/${id}/predictions`, headers: { origin: 'https://app.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization' } }).then((r) => keep('preflight', r))).status).toBe(204);

    // The start and the predictions by token; a prediction under another player's id is refused; one request fails inside.
    expect((await post('start', `/matches/${id}/start`, {}, hostToken)).status).toBe(200);
    expect((await post('start again', `/matches/${id}/start`, {}, hostToken)).status).toBe(409);
    const living = shownOf().state.owners.map(([, f]) => f);
    const [fa, fb] = [...new Set(living)].sort((a, b) => a - b) as [number, number];
    expect((await post('winner ana', `/matches/${id}/predictions`, { kind: 'winner', faction: fa, playerId: ana.local }, ana.token)).status).toBe(200);
    expect((await post('winner bea', `/matches/${id}/predictions`, { kind: 'winner', faction: fb, playerId: bea.local }, bea.token)).status).toBe(200);
    expect((await post('victim ana', `/matches/${id}/predictions`, { kind: 'victim', round: 1, faction: fa, playerId: ana.local }, ana.token)).status).toBe(200);
    expect((await post('under another id', `/matches/${id}/predictions`, { kind: 'winner', faction: fa, playerId: bea.local }, ana.token)).status).toBe(403);
    throwNext = true;
    expect((await post('a failing prediction', `/matches/${id}/predictions`, { kind: 'winner', faction: fa, playerId: zed.local }, zed.token)).status).toBe(500);
    expect((await get('own predictions', `/matches/${id}/predictions?playerId=${ana.local}`, ana.token)).status).toBe(200);

    // The match goes on to its end by the clock; every read is made at every stage.
    const reads = (): string[] => [`/matches/${id}`, `/matches/${id}/players`, `/matches/${id}/players?limit=1`, `/matches/${id}/leaderboard`, `/matches/${id}/records`, `/matches/${id}/states/0`, `/matches/${id}/players/${ana.playerId}/results`, `/matches/${id}/results/1/1`, `/matches/${id}/results/1/2`, `/matches/${id}/results/1/1/winners`, `/matches/${id}/results/1/2/winners`, '/matches'];
    for (const path of reads()) await get(`read ${path}`, path, zed.token);
    for (let guard = 0; guard < 20; guard += 1) {
      const shown = shownOf();
      if (shown.stage === 'finished') break;
      const anchor = shown.stage === 'phase-1' ? shown.schedule!.c1 : shown.stage === 'phase-2' ? shown.schedule!.c2 : shown.schedule!.a;
      h.clock.set(anchor);
      h.service.tick();
      for (const path of reads()) await get(`read ${path}`, path);
    }
    expect(shownOf().stage).toBe('finished');
    for (const path of [...reads(), `/matches/${id}/results/4/1/winners`, `/matches/${id}/results/4/2/winners`, `/matches/${id}/players/${bea.playerId}/results`, `/matches/${id}/players/${zed.playerId}/results`]) await get(`read at the end ${path}`, path, bea.token);

    // The stream: every frame up to the end of the match.
    const frames: Frame[] = [];
    do frames.push(await feed.next(10_000)); while (!(frames[frames.length - 1] as Frame).raw.includes('"type":"match-finished"'));
    feed.close();
    seen.push({ what: 'event stream headers and frames', text: `${JSON.stringify(feed.headers)}\n${frames.map((f) => f.raw).join('')}`, carries: [] });
    expect(frames.length).toBeGreaterThan(30);
    expect(frames.map((f) => (f.kind === 'event' ? (JSON.parse(f.data) as { type: string }).type : '')).filter((t) => t === 'player-joined')).toHaveLength(3 + flooded);

    // The logs of the server: every line, as the sink wrote it.
    const logText = h.logs.map((e) => JSON.stringify(e));
    expect(h.logs.some((e) => e.event === 'request-failed')).toBe(true);
    seen.push({ what: 'log lines', text: logText.join('\n'), carries: [] });

    // --- The scan. Each output is checked against the needles of every token it does not carry by design. ---
    const needles = new Map([...tokens].map(([label, token]) => [label, tokenNeedles(token)] as const));
    const leaks: string[] = [];
    for (const out of seen) {
      for (const [label, list] of needles) {
        if (out.carries.includes(label)) continue;
        const held = needlesHeldBy(out.text, list);
        if (held.length > 0) leaks.push(`${out.what}: holds the ${label} token (${held[0]})`);
      }
    }
    expect(leaks).toStrictEqual([]);
    // The scan sees a token where it is: the carriers hold their own token (a scan that finds nothing anywhere would prove nothing).
    for (const label of ['host', 'ana', 'bea', 'zed']) {
      const carriers = seen.filter((s) => s.carries.includes(label));
      expect(carriers.length, label).toBeGreaterThanOrEqual(label === 'host' || label === 'ana' ? 2 : 1);
      for (const c of carriers) expect(needlesHeldBy(c.text, needles.get(label)!), `${label}: ${c.what}`).not.toStrictEqual([]);
    }
    // The refused requests that sent a token were seen, and the failing one logged a request-failed event with its stage and a class name only.
    expect(seen.filter((s) => s.what.startsWith('start by a player') || s.what.startsWith('unknown path with a token') || s.what.startsWith('delete with a token')).length).toBe(3);
    const failed = h.logs.filter((e) => e.event === 'request-failed');
    expect(failed).toHaveLength(1);
    expect(Object.keys(failed[0]!).sort()).toStrictEqual(['error', 'event', 'stage']);
    expect(JSON.stringify(failed[0])).not.toContain('boom');

    // Names: a name is in no log line, not even as a length or a hash (the log has closed fields only), and every event is a known one.
    for (const name of [NAME_ANA, NAME_BEA, NAME_ZED, 'Flood']) {
      const forms = [name, JSON.stringify(name).slice(1, -1), name.normalize('NFD'), encodeURIComponent(name)];
      for (const form of forms) expect(logText.some((l) => l.includes(form)), `a log line holds ${form}`).toBe(false);
    }
    const KNOWN = ['request-failed', 'listening', 'start-report', 'step-failed', 'listen-failed', 'fatal', 'shutdown-start', 'shutdown-done', 'shutdown-forced'];
    expect(h.logs.filter((e) => !KNOWN.includes(e.event))).toStrictEqual([]);
  }, 60_000);
});

describe('tokens in the database', () => {
  it('NFR-73 the database keeps a token only as a digest and in the 24 h memo of its reply: across a restart and an expiry, and the memo is gone 24 h + 1 ms after the reply', () => {
    withTempDir((dir) => {
      const file = join(dir, 'tokens.sqlite');
      const clock = fakeClock(START_MS);
      const random = fakeRandom(31);
      const open = (): MatchService => lobbyServiceWith(openStore(file), clock, file, random);
      const tokens: string[] = [];
      let service = open();

      // A lobby with three players, started; a second lobby with two players that expires.
      const first = service.createPublic({ source: 'src-a', body: creationBody('c-1') });
      const second = service.createPublic({ source: 'src-b', body: creationBody('c-2') });
      if (!first.ok || !second.ok) throw new Error('creation failed');
      tokens.push(first.reply.hostToken, second.reply.hostToken);
      const joined: { matchId: string; playerId: string; token: string }[] = [];
      const joinAs = (matchId: string, name: string, at: number): void => {
        clock.set(at);
        const out = service.join({ source: `src-${name}`, matchId, body: { name, requestId: `j-${name}` } });
        if (!out.ok) throw new Error(`join refused: ${JSON.stringify(out.error)}`);
        tokens.push(out.reply.playerToken);
        joined.push({ matchId, playerId: out.reply.playerId, token: out.reply.playerToken });
      };
      joinAs(first.reply.matchId, 'Ana', START_MS + 1_000);
      joinAs(first.reply.matchId, 'Bea', START_MS + 2_000);
      joinAs(second.reply.matchId, 'Cy', START_MS + 3_000);
      joinAs(second.reply.matchId, 'Dee', START_MS + 4_000);
      clock.set(START_MS + 5_000);
      expect(service.startMatch({ credential: first.reply.hostToken, matchId: first.reply.matchId, body: {} }).ok).toBe(true);
      const living = [...new Set(service.publicMatch(first.reply.matchId)!.state.owners.map(([, f]) => f))].sort((a, b) => a - b);
      const caller = (token: string, playerId: string) => ({ tokenDigest: credentialDigest(token), playerId });
      const ana = joined[0]!;
      expect(service.submit({ client: caller(ana.token, ana.playerId), matchId: ana.matchId, body: { kind: 'winner', faction: living[0], playerId: ana.playerId.slice('player:'.length) } }).ok).toBe(true);
      service.close();

      // A restart; a join in the running match; the second lobby expires one hour after its creation.
      clock.set(START_MS + 10_000);
      service = open();
      service.start();
      joinAs(first.reply.matchId, 'Eve', START_MS + 11_000);
      clock.set(START_MS + HOUR + 1_000);
      service.tick();
      expect(service.publicMatch(second.reply.matchId)!.stage).toBe('expired');
      service.close();

      withRawDb(file, (db) => {
        // Memo rows hold the plain tokens (the replies, for 24 h); nothing else holds a token in any form.
        expect(playerTokenPlaces(db, tokens, true)).toStrictEqual([]);
        for (const token of tokens) expect(scanValues(db, [token]), token.slice(0, 8)).toStrictEqual(['memo.reply_json']);
        expect(credentialTextColumns(listColumns(db))).toStrictEqual([]);
        // The digests are there: one per player, equal to the digest of the token the player was given.
        const digests = db.prepare('SELECT token_digest FROM players ORDER BY joined_seq').all().map((r) => String(r.token_digest)).sort();
        expect(digests).toStrictEqual(joined.map((j) => credentialDigest(j.token)).sort());
        expect(playerEventViolations(db)).toStrictEqual([]);
      });

      // The memo is gone 24 h + 1 ms after the reply it holds: at 24 h exactly every row is still there, 1 ms later the first ones are
      // gone, and once the last reply is older than 24 h no row is left, while the players and their digests stay.
      const memoCount = (): number => withRawDb(file, (db) => Number(db.prepare('SELECT COUNT(*) AS n FROM memo').get()!.n));
      const created = START_MS; // the first creation reply
      const total = memoCount();
      expect(total).toBe(7); // two creations and five joins (the start had no request id)
      clock.set(created + MEMO_RETENTION_MS);
      service = open();
      service.start();
      service.tick();
      service.close();
      expect(memoCount()).toBe(total);
      clock.set(created + MEMO_RETENTION_MS + 1);
      service = open();
      service.start();
      service.tick();
      service.close();
      expect(memoCount()).toBeLessThan(total);
      clock.set(START_MS + 11_000 + MEMO_RETENTION_MS + 1);
      service = open();
      service.start();
      service.tick();
      for (const j of joined.filter((x) => x.matchId === first.reply.matchId)) expect(service.playerTokenOf(j.matchId, j.token)).toStrictEqual({ ok: true, reply: { playerId: j.playerId } });
      service.close();
      expect(memoCount()).toBe(0);
      withRawDb(file, (db) => {
        for (const token of tokens) expect(scanValues(db, tokenNeedles(token)), token.slice(0, 8)).toStrictEqual([]);
        expect(Number(db.prepare('SELECT COUNT(*) AS n FROM players').get()!.n)).toBe(5);
      });
    });
  }, 60_000);
});
