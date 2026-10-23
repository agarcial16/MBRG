import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { encodeError } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreError } from '../src/store/store';
import { DEV_DIR } from './helpers/digests';
import { raw, head, request } from './helpers/http-client';
import { advanceSteps, bearer, get, kindOf, living, makeMatch, publicOf, startReads, withTempDirAsync } from './helpers/http-reads-kit';
import { CLIENT_CREDENTIAL, closeAllServers, errorBody } from './helpers/server-harness';
import { OPERATOR, START_MS, creationBody, writeMapPackage } from './helpers/service-harness';

// The read routes over a real listener (M3a' T3'), through the production route table, the real service, an in-memory
// store and the fake clock. CORS on the wire is in http-cors-wire.test.ts, the map files in http-maps.test.ts, the twin
// matches in http-twins.test.ts.

afterEach(closeAllServers);

const DISCORD_CREDENTIAL = 'client-credential-discord-0123456789';
const CLIENTS = [
  { namespace: 'web', credential: CLIENT_CREDENTIAL },
  { namespace: 'discord', credential: DISCORD_CREDENTIAL },
];

interface Page<T> {
  items: T[];
  next?: string;
}

describe('http reads: every public read is open', () => {
  it('FR-285 FR-281 (HTTP) the list, a match, a state, the records and a record answer 200 without Authorization', async () => {
    const h = await startReads();
    const m = makeMatch(h);
    advanceSteps(h, m.id, 3);
    const list = await get(h, '/matches');
    expect(list.status).toBe(200);
    expect(list.headers['content-type']).toBe('application/json');
    expect((list.json() as Page<{ matchId: string; appliedRounds: number }>).items).toMatchObject([{ matchId: m.id, appliedRounds: 1 }]);
    const match = await get(h, `/matches/${m.id}`);
    expect(match.status).toBe(200);
    expect(match.json()).toMatchObject({ matchId: m.id, appliedRounds: 1 });
    const state0 = await get(h, `/matches/${m.id}/states/0`);
    const state1 = await get(h, `/matches/${m.id}/states/1`);
    expect([state0.status, state1.status]).toStrictEqual([200, 200]);
    expect(state0.json()).toMatchObject({ round: 0 });
    expect(state1.json()).toMatchObject({ round: 1 });
    expect((state1.json() as { stateDigest: string }).stateDigest).toMatch(/^[0-9a-f]{64}$/);
    const records = await get(h, `/matches/${m.id}/records`);
    expect(records.status).toBe(200);
    expect((records.json() as Page<{ round: number }>).items.map((r) => r.round)).toStrictEqual([1]);
    const record = await get(h, `/matches/${m.id}/records/1`);
    expect(record.status).toBe(200);
    expect(record.json()).toMatchObject({ round: 1 });
    // The record page holds the same bytes as the single record, inside its item list.
    expect(records.text).toBe(`{"items":[${record.text}]}`);
  });

  it('FR-285 a credential does not change a public read: the same bytes with the operator, a client, a host token and a wrong credential', async () => {
    const h = await startReads();
    const m = makeMatch(h);
    const plain = await get(h, `/matches/${m.id}`);
    for (const token of [OPERATOR, CLIENT_CREDENTIAL, m.hostToken, 'wrong-credential-0123456789abcdef']) {
      const reply = await get(h, `/matches/${m.id}`, bearer(token));
      expect([reply.status, reply.text]).toStrictEqual([200, plain.text]);
    }
  });

  it('FR-281 (HTTP) unknown and malformed match ids are unknown-match 404 on every match read', async () => {
    const h = await startReads();
    makeMatch(h);
    const ids = ['nope', 'a.b', 'a%20b', 'x'.repeat(65), '%2e%2e', '__proto__'];
    for (const id of ids) {
      for (const tail of ['', '/states/0', '/records', '/records/1']) {
        const reply = await get(h, `/matches/${id}${tail}`);
        expect([id, tail, reply.status, reply.text]).toStrictEqual([id, tail, 404, errorBody('unknown-match')]);
      }
    }
  });

  it('FR-281 (HTTP) reads of a halted match keep serving what it has, and a round above N is still round-not-applied', async () => {
    await withTempDirAsync(async (dir) => {
      const folder = writeMapPackage(dir, 'copy', readFileSync(join(DEV_DIR, 'map.json'), 'utf8'));
      const h = await startReads({ service: { folders: { copy: folder } } });
      const m = makeMatch(h, 'c-h', { mapId: 'copy' });
      advanceSteps(h, m.id, 3);
      rmSync(join(folder, 'map.json'));
      const halted = h.service.advance({ credential: OPERATOR, matchId: m.id, body: { round: 2, step: 'phase-1-close' } });
      expect(halted.ok ? 'performed' : halted.error.kind).toBe('match-halted');
      const match = await get(h, `/matches/${m.id}`);
      expect(match.json()).toMatchObject({ stage: 'halted', haltReason: 'map-changed', appliedRounds: 1 });
      expect((await get(h, `/matches/${m.id}/states/1`)).status).toBe(200);
      expect((await get(h, `/matches/${m.id}/records/1`)).status).toBe(200);
      const above = await get(h, `/matches/${m.id}/states/2`);
      expect([above.status, above.json()]).toStrictEqual([404, { kind: 'round-not-applied', appliedRounds: 1 }]);
    });
  });

  it('FR-259 (public data over HTTP) the secret of a match appears in no read before it finishes and in its public data once finished', async () => {
    const secret = Uint8Array.from({ length: 32 }, (_, i) => i + 7);
    const hex = Buffer.from(secret).toString('hex');
    const h = await startReads({ service: { secret } });
    const m = makeMatch(h);
    const reads = (): string[] => [`/matches`, `/matches/${m.id}`, `/matches/${m.id}/records`, `/matches/${m.id}/states/0`];
    const total = publicOf(h, m.id).totalRounds;
    for (let i = 0; i < total * 3 + 3; i += 1) {
      const shown = publicOf(h, m.id);
      if (shown.stage === 'finished') break;
      for (const path of reads()) expect((await get(h, path)).text, `${path} at step ${i}`).not.toContain(hex);
      advanceSteps(h, m.id, 1);
    }
    const done = publicOf(h, m.id);
    expect(done.stage).toBe('finished');
    const match = await get(h, `/matches/${m.id}`);
    expect(match.text).toContain(hex);
    expect((match.json() as { matchSecret: string }).matchSecret).toBe(hex);
    // Only the public data of the match carries it, not the list nor the records.
    expect((await get(h, '/matches')).text).not.toContain(hex);
    expect((await get(h, `/matches/${m.id}/records`)).text).not.toContain(hex);
  }, 60_000);
});

describe('http reads: paging', () => {
  it('FR-279 (HTTP) a list is followed with limit=2 and the cursor to the end: every item once, in order', async () => {
    const h = await startReads();
    const ids = [1, 2, 3, 4, 5].map((n) => {
      h.clock.advance(1000);
      return makeMatch(h, `c-${n}`).id;
    });
    const seen: string[] = [];
    let path = '/matches?limit=2';
    let pages = 0;
    for (;;) {
      const page = await get(h, path);
      expect(page.status).toBe(200);
      const body = page.json() as Page<{ matchId: string; createdAt: number }>;
      expect(body.items.length).toBeLessThanOrEqual(2);
      seen.push(...body.items.map((i) => i.matchId));
      pages += 1;
      if (body.next === undefined) break;
      path = `/matches?limit=2&cursor=${body.next}`;
    }
    expect(pages).toBe(3);
    expect(seen).toStrictEqual(ids);
    // Without a limit the default page holds all five and has no cursor.
    const all = (await get(h, '/matches')).json() as Page<{ matchId: string }>;
    expect([all.items.map((i) => i.matchId), all.next]).toStrictEqual([ids, undefined]);
  });

  it('FR-279 (HTTP) a match created between two pages is neither repeated nor skipped, and no stale-cursor is answered', async () => {
    const h = await startReads();
    const first = [1, 2, 3, 4].map((n) => {
      h.clock.advance(1000);
      return makeMatch(h, `c-${n}`).id;
    });
    const page1 = (await get(h, '/matches?limit=2')).json() as Page<{ matchId: string }>;
    h.clock.advance(1000);
    const added = makeMatch(h, 'c-late').id;
    const seen = page1.items.map((i) => i.matchId);
    let next = page1.next;
    while (next !== undefined) {
      const page = await get(h, `/matches?limit=2&cursor=${next}`);
      expect(page.status).toBe(200);
      const body = page.json() as Page<{ matchId: string }>;
      seen.push(...body.items.map((i) => i.matchId));
      next = body.next;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toStrictEqual([...first, added]);
  });

  it('FR-279 (HTTP) the records are paged by round with limit=1 and a cursor of the records list', async () => {
    const h = await startReads();
    const m = makeMatch(h);
    advanceSteps(h, m.id, 9);
    const rounds: number[] = [];
    let path = `/matches/${m.id}/records?limit=1`;
    for (;;) {
      const page = (await get(h, path)).json() as Page<{ round: number }>;
      rounds.push(...page.items.map((r) => r.round));
      if (page.next === undefined) break;
      path = `/matches/${m.id}/records?limit=1&cursor=${page.next}`;
    }
    expect(rounds).toStrictEqual([1, 2, 3]);
  });

  it('FR-279 (HTTP) a bad page size, a cursor of another list, an unknown or repeated parameter and an empty value are invalid-request', async () => {
    const h = await startReads();
    const m = makeMatch(h);
    advanceSteps(h, m.id, 6);
    makeMatch(h, 'c-2');
    const listCursor = ((await get(h, '/matches?limit=1')).json() as Page<unknown>).next as string;
    const recordsCursor = ((await get(h, `/matches/${m.id}/records?limit=1`)).json() as Page<unknown>).next as string;
    expect(listCursor).toBeTypeOf('string');
    expect(recordsCursor).toBeTypeOf('string');
    const cases: [string, string][] = [
      ['/matches?limit=0', 'limit'],
      ['/matches?limit=501', 'limit'],
      ['/matches?limit=-1', 'limit'],
      ['/matches?limit=01', 'limit'],
      ['/matches?limit=2.5', 'limit'],
      ['/matches?limit=', 'limit'],
      ['/matches?limit=1&limit=2', 'limit'],
      ['/matches?foo=1', 'foo'],
      ['/matches?playerId=alice', 'playerId'],
      [`/matches?cursor=${recordsCursor}`, 'cursor'],
      [`/matches/${m.id}/records?cursor=${listCursor}`, 'cursor'],
      ['/matches?cursor=', 'cursor'],
      ['/matches?cursor=%00', 'cursor'],
      [`/matches/${m.id}/records?limit=501`, 'limit'],
      [`/matches/${m.id}?limit=1`, 'limit'],
      [`/matches/${m.id}/states/0?x=1`, 'x'],
      [`/matches/${m.id}/records/1?cursor=a`, 'cursor'],
    ];
    for (const [path, field] of cases) {
      const reply = await get(h, path);
      expect([path, reply.status, reply.json()]).toStrictEqual([path, 400, { kind: 'invalid-request', items: [field] }]);
    }
    // The largest page size is accepted.
    expect((await get(h, '/matches?limit=500')).status).toBe(200);
    expect((await get(h, '/matches?limit=1')).status).toBe(200);
  });

  it('FR-279 (HTTP) a cursor with the right tag and key shape is accepted whatever its key (cursors are unsigned, PD20)', async () => {
    const h = await startReads();
    const a = makeMatch(h, 'c-1').id;
    h.clock.advance(1000);
    const b = makeMatch(h, 'c-2').id;
    const issued = ((await get(h, '/matches?limit=1')).json() as Page<unknown>).next as string;
    const decoded = JSON.parse(Buffer.from(issued, 'base64url').toString('ascii')) as [string, number, string];
    expect(decoded[0]).toBe('matches');
    // A forged cursor: the same list tag and shape naming the first match as its key.
    const forged = Buffer.from(JSON.stringify(['matches', START_MS, a])).toString('base64url');
    const page = (await get(h, `/matches?cursor=${forged}`)).json() as Page<{ matchId: string }>;
    expect(page.items.map((i) => i.matchId)).toStrictEqual([b]);
  });
});

describe('http reads: rounds', () => {
  it('FR-281 (HTTP) round segments that are not a whole number without a leading zero are invalid-request [round]; records/0 too', async () => {
    const h = await startReads();
    const m = makeMatch(h);
    advanceSteps(h, m.id, 3);
    for (const segment of ['-1', 'x', '01', '1.5', '+1', '1e2', '0x1', '00', '%31', '']) {
      for (const base of ['states', 'records']) {
        const reply = await get(h, `/matches/${m.id}/${base}/${segment}`);
        // An empty segment is a trailing slash: an unknown path; everything else names the round.
        const expected = segment === '' ? [404, 'unknown-path'] : [400, 'invalid-request'];
        expect([base, segment, reply.status, kindOf(reply)]).toStrictEqual([base, segment, ...expected]);
      }
    }
    const zero = await get(h, `/matches/${m.id}/records/0`);
    expect([zero.status, zero.json()]).toStrictEqual([400, { kind: 'invalid-request', items: ['round'] }]);
    expect((await get(h, `/matches/${m.id}/states/0`)).status).toBe(200);
    // The round segment is checked before the match: a bad round of an unknown match is invalid-request.
    expect((await get(h, '/matches/nope/states/01')).status).toBe(400);
    expect((await get(h, '/matches/nope/states/1')).status).toBe(404);
  });

  it('FR-302 (HTTP) the creation, advance, match and state replies carry the reported time of the fake clock, and it never decreases', async () => {
    const h = await startReads();
    const post = (path: string, body: unknown): ReturnType<typeof request> => request(h.port, { method: 'POST', path, body, headers: bearer(OPERATOR) });
    const created = await post('/matches', creationBody('wire-rt'));
    expect(created.status).toBe(201);
    const id = (created.json() as { matchId: string }).matchId;
    expect((created.json() as { match: { reportedTime: number } }).match.reportedTime).toBe(START_MS);
    h.clock.advance(7_000);
    const shown = await get(h, `/matches/${id}`);
    expect((shown.json() as { reportedTime: number }).reportedTime).toBe(START_MS + 7_000);
    expect((await get(h, `/matches/${id}/states/0`)).json()).toMatchObject({ round: 0, reportedTime: START_MS + 7_000 });
    const advanced = await post(`/matches/${id}/advance`, { round: 1, step: 'phase-1-close' });
    expect(advanced.status).toBe(200);
    expect((advanced.json() as { match: { reportedTime: number } }).match.reportedTime).toBe(START_MS + 7_000);
    // A late read (far past the schedule) reports the clock reading, not an older value.
    h.clock.advance(500_000);
    const late = await get(h, `/matches/${id}`);
    expect((late.json() as { reportedTime: number }).reportedTime).toBe(START_MS + 507_000);
    expect((await get(h, `/matches/${id}/states/0`)).json()).toMatchObject({ reportedTime: START_MS + 507_000 });
    // A clock set backwards never lowers it.
    h.clock.set(START_MS);
    expect((await get(h, `/matches/${id}`)).json()).toMatchObject({ reportedTime: START_MS + 507_000 });
    expect((await get(h, `/matches/${id}/states/0`)).json()).toMatchObject({ reportedTime: START_MS + 507_000 });
  });

  it('FR-258 (over HTTP) a round above N is the same round-not-applied reply for N + 1, N + 2, T + 5 and 20 digits, at every stage', async () => {
    const h = await startReads();
    const m = makeMatch(h);
    const total = publicOf(h, m.id).totalRounds;
    const huge = '99999999999999999999';
    for (let step = 0; step < 9; step += 1) {
      const shown = publicOf(h, m.id);
      const n = shown.appliedRounds;
      for (const base of ['states', 'records']) {
        const bodies = new Set<string>();
        for (const round of [n + 1, n + 2, total, total + 5, 1_000_000, 9007199254740991, huge]) {
          if (base === 'records' && round === 0) continue;
          const reply = await get(h, `/matches/${m.id}/${base}/${round}`);
          expect([base, shown.stage, round, reply.status]).toStrictEqual([base, shown.stage, round, 404]);
          bodies.add(reply.text);
        }
        expect(bodies.size, `${base} at ${shown.stage} N=${n}`).toBe(1);
        expect([...bodies][0]).toBe(encodeError({ kind: 'round-not-applied', appliedRounds: n }));
      }
      advanceSteps(h, m.id, 1);
    }
  });

  it('FR-258 (over HTTP) the states and records at applied rounds stay available and the state at N is the current one', async () => {
    const h = await startReads();
    const m = makeMatch(h);
    advanceSteps(h, m.id, 6);
    const now = publicOf(h, m.id);
    const state2 = (await get(h, `/matches/${m.id}/states/2`)).json() as { owners: unknown; stateDigest: string };
    expect(state2.owners).toStrictEqual(now.state.owners);
    expect(state2.stateDigest).toBe(now.stateDigest);
    const above = await get(h, `/matches/${m.id}/states/3`);
    expect(above.json()).toStrictEqual({ kind: 'round-not-applied', appliedRounds: 2 });
  });
});

describe('http reads: own predictions', () => {
  it('FR-270 (read) FR-281 (HTTP) own predictions need a client credential: 403 for none, wrong, operator and host token, with identical bodies', async () => {
    const h = await startReads({ clients: CLIENTS });
    const m = makeMatch(h);
    const bodies = new Set<string>();
    for (const token of [undefined, 'wrong-credential-0123456789abcdef', OPERATOR, m.hostToken]) {
      const reply = await get(h, `/matches/${m.id}/predictions`, token === undefined ? {} : bearer(token));
      expect(reply.status).toBe(403);
      bodies.add(reply.text);
    }
    expect([...bodies]).toStrictEqual([errorBody('forbidden')]);
    // A client of an unknown match: forbidden first for no credential, unknown-match with one.
    expect((await get(h, '/matches/nope/predictions')).status).toBe(403);
    expect((await get(h, '/matches/nope/predictions', bearer(CLIENT_CREDENTIAL))).status).toBe(404);
  });

  it('FR-270 (read) a client reads only the players of its own namespace; the namespace comes from the credential, never from the query', async () => {
    const h = await startReads({ clients: CLIENTS });
    const m = makeMatch(h);
    const [a, b] = living(h, m.id) as [number, number];
    const submit = (client: (typeof CLIENTS)[number], body: Record<string, unknown>): void => {
      const out = h.service.submit({ client, matchId: m.id, body });
      if (!out.ok) throw new Error(`submit failed ${JSON.stringify(out.error)}`);
    };
    submit(CLIENTS[0]!, { kind: 'winner', faction: a, playerId: 'alice' });
    submit(CLIENTS[0]!, { kind: 'victim', round: 1, faction: b, playerId: 'alice' });
    submit(CLIENTS[0]!, { kind: 'winner', faction: b, playerId: 'bob' });
    submit(CLIENTS[1]!, { kind: 'winner', faction: b, playerId: 'alice' });
    submit(CLIENTS[1]!, { kind: 'winner', faction: a, playerId: 'zed' });
    const own = async (token: string, query = ''): Promise<Page<{ playerId: string; kind: string; choice: number }>> => {
      const reply = await get(h, `/matches/${m.id}/predictions${query}`, bearer(token));
      expect([query, reply.status]).toStrictEqual([query, 200]);
      return reply.json() as Page<{ playerId: string; kind: string; choice: number }>;
    };
    const web = await own(CLIENT_CREDENTIAL);
    expect(web.items.map((i) => [i.playerId, i.kind])).toStrictEqual([['alice', 'winner'], ['alice', 'victim'], ['bob', 'winner']]);
    const discord = await own(DISCORD_CREDENTIAL);
    expect(discord.items.map((i) => [i.playerId, i.kind, i.choice])).toStrictEqual([['alice', 'winner', b], ['zed', 'winner', a]]);
    // The local id filter keeps the namespace of the credential.
    expect((await own(CLIENT_CREDENTIAL, '?playerId=alice')).items.map((i) => i.kind)).toStrictEqual(['winner', 'victim']);
    expect((await own(DISCORD_CREDENTIAL, '?playerId=alice')).items.map((i) => i.choice)).toStrictEqual([b]);
    expect((await own(DISCORD_CREDENTIAL, '?playerId=bob')).items).toStrictEqual([]);
    // No wire text carries a namespace prefix, and the body never names another namespace's player.
    const text = (await get(h, `/matches/${m.id}/predictions`, bearer(DISCORD_CREDENTIAL))).text;
    expect(text).not.toContain('web:');
    expect(text).not.toContain('discord:');
    expect(text).not.toContain('bob');
    // A namespace cannot be sent: it is an unknown parameter, or a player id with a separator.
    const sneaky = await get(h, `/matches/${m.id}/predictions?namespace=web`, bearer(DISCORD_CREDENTIAL));
    expect([sneaky.status, sneaky.json()]).toStrictEqual([400, { kind: 'invalid-request', items: ['namespace'] }]);
    for (const id of ['web:alice', 'a%3Ab', '', 'a%20b', 'x'.repeat(65)]) {
      const reply = await get(h, `/matches/${m.id}/predictions?playerId=${id}`, bearer(DISCORD_CREDENTIAL));
      expect([id, reply.status, reply.json()]).toStrictEqual([id, 400, { kind: 'invalid-player-id', items: ['playerId'] }]);
    }
    // invalid-player-id comes before forbidden (FR-301 order).
    const noCredential = await get(h, `/matches/${m.id}/predictions?playerId=web:alice`);
    expect([noCredential.status, kindOf(noCredential)]).toStrictEqual([400, 'invalid-player-id']);
  });

  it('FR-279 (HTTP) FR-270 (read) own predictions are paged by player id, round and kind with a cursor of their own list', async () => {
    const h = await startReads({ clients: CLIENTS });
    const m = makeMatch(h);
    const [a] = living(h, m.id) as [number];
    for (const playerId of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      const out = h.service.submit({ client: CLIENTS[0]!, matchId: m.id, body: { kind: 'winner', faction: a, playerId } });
      expect(out.ok).toBe(true);
    }
    const seen: string[] = [];
    let path = `/matches/${m.id}/predictions?limit=2`;
    for (;;) {
      const page = (await get(h, path, bearer(CLIENT_CREDENTIAL))).json() as Page<{ playerId: string }>;
      seen.push(...page.items.map((i) => i.playerId));
      if (page.next === undefined) break;
      path = `/matches/${m.id}/predictions?limit=2&cursor=${page.next}`;
    }
    expect(seen).toStrictEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    makeMatch(h, 'c-2');
    const other = ((await get(h, '/matches?limit=1')).json() as Page<unknown>).next as string;
    const bad = await get(h, `/matches/${m.id}/predictions?cursor=${other}`, bearer(CLIENT_CREDENTIAL));
    expect([bad.status, bad.json()]).toStrictEqual([400, { kind: 'invalid-request', items: ['cursor'] }]);
  });
});

describe('http reads: paths and methods', () => {
  it('FR-281 (HTTP) HEAD and trailing slashes are not offered; an unlisted path is unknown-path', async () => {
    const h = await startReads();
    const m = makeMatch(h);
    const headReply = await request(h.port, { method: 'HEAD', path: '/matches' });
    expect(headReply.status).toBe(405);
    expect(headReply.headers.allow).toBe('GET, OPTIONS, POST');
    for (const path of ['/matches/', `/matches/${m.id}/`, `/matches/${m.id}/records/`, '/maps/dev/map.json/', '//matches', '/matches//', '/health', '/', `/matches/${m.id}/states`, '/mat%63hes']) {
      const reply = await get(h, path);
      expect([path, reply.status, reply.text]).toStrictEqual([path, 404, errorBody('unknown-path')]);
    }
    const post = await request(h.port, { method: 'POST', path: `/matches/${m.id}/records`, body: {} });
    expect([post.status, post.headers.allow]).toStrictEqual([405, 'GET, OPTIONS']);
    expect((await request(h.port, { method: 'DELETE', path: `/matches/${m.id}` })).status).toBe(405);
  });
});

describe('http reads: limits and storage failures', () => {
  it('FR-299 (over HTTP) NFR-52 (network) reads past the anonymous limit are 429 with Retry-After and are admitted again later', async () => {
    const h = await startReads({ limits: { anonymous: 3 } });
    makeMatch(h);
    for (let i = 0; i < 3; i += 1) expect((await get(h, '/matches')).status).toBe(200);
    h.clock.advance(20_000);
    const limited = await get(h, '/matches');
    expect([limited.status, limited.headers['retry-after'], limited.json()]).toStrictEqual([429, '40', { kind: 'rate-limited', retryAfter: 40 }]);
    expect((await get(h, '/matches/nope')).status).toBe(429);
    h.clock.advance(40_000);
    expect((await get(h, '/matches')).status).toBe(200);
  });

  it('FR-299 (over HTTP) a client credential has its own read bucket, apart from the anonymous address bucket', async () => {
    const h = await startReads({ limits: { anonymous: 1, reads: 2 } });
    const m = makeMatch(h);
    const path = `/matches/${m.id}/predictions`;
    expect((await get(h, path, bearer(CLIENT_CREDENTIAL))).status).toBe(200);
    expect((await get(h, path, bearer(CLIENT_CREDENTIAL))).status).toBe(200);
    expect((await get(h, path, bearer(CLIENT_CREDENTIAL))).status).toBe(429);
    expect((await get(h, '/matches')).status).toBe(200);
    expect((await get(h, '/matches')).status).toBe(429);
  });

  it('FR-292 (unavailable over HTTP) a storage failure under a read is 503 with nothing leaked, and the next read works', async () => {
    let failing = false;
    const h = await startReads({
      wrapStore: (store) => ({
        ...store,
        getMatch: (id) => {
          if (failing) throw new StoreError('store-failure', 'disk /private/path SECRET-TEXT');
          return store.getMatch(id);
        },
        listMatches: (after, limit) => {
          if (failing) throw new StoreError('store-failure', 'disk /private/path SECRET-TEXT');
          return store.listMatches(after, limit);
        },
      }),
    });
    const m = makeMatch(h);
    failing = true;
    for (const path of ['/matches', `/matches/${m.id}`, `/matches/${m.id}/states/0`, `/matches/${m.id}/records`, `/matches/${m.id}/records/1`]) {
      const reply = await get(h, path);
      expect([path, reply.status, reply.text]).toStrictEqual([path, 503, errorBody('unavailable')]);
      expect(JSON.stringify(reply.headers)).not.toContain('SECRET-TEXT');
    }
    const own = await get(h, `/matches/${m.id}/predictions`, bearer(CLIENT_CREDENTIAL));
    expect([own.status, own.text]).toStrictEqual([503, errorBody('unavailable')]);
    expect(h.logs).toStrictEqual([]);
    failing = false;
    expect((await get(h, `/matches/${m.id}`)).status).toBe(200);
  });

  it('NFR-54 (logs) a service that throws under a read is a 500 with {"kind":"unavailable"} and one logged event', async () => {
    const h = await startReads({
      stub: {
        listMatches: () => {
          throw new TypeError('bad value planted-text-123');
        },
      },
    });
    const reply = await get(h, '/matches');
    expect([reply.status, reply.text]).toStrictEqual([500, '{"kind":"unavailable"}']);
    expect(h.logs).toHaveLength(1);
    expect(JSON.stringify(h.logs)).not.toContain('planted-text-123');
  });

  it('FR-281 (HTTP) raw requests with traversal, an absolute target or a bad query text never reach the file system or throw', async () => {
    const h = await startReads();
    const sent = async (target: string): Promise<{ status: number; kind: unknown }> => {
      const reply = await raw(h.port, [head('GET', target, { connection: 'close' })]);
      return { status: reply.status, kind: (JSON.parse(reply.body) as { kind: string }).kind };
    };
    expect(await sent('/matches?limit=%E0%A4%A')).toStrictEqual({ status: 400, kind: 'invalid-request' });
    expect(await sent('/matches?%zz=1')).toStrictEqual({ status: 400, kind: 'invalid-request' });
    expect(await sent('/../matches')).toStrictEqual({ status: 404, kind: 'unknown-path' });
    expect(await sent('http://localhost/matches')).toStrictEqual({ status: 404, kind: 'unknown-path' });
  });
});
