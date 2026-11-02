import { describe, expect, it } from 'vitest';
import {
  encodeCreation, encodeError, encodeJoinReply, encodeLeaderboardRow, encodeOwnPrediction, encodePage, encodePhaseWinners, encodePlayerListItem,
  encodePlayerResults, encodePrediction, encodePublicConfig, encodePublicMatch, errorReply, rateLimited,
} from '@mbrg/protocol';
import type { LeaderboardRow, OwnPrediction, PlayerListItem, PlayerResult, PublicConfig } from '@mbrg/protocol';
import { createPlayNet } from '../src/ui/live-net';
import type { FetchLike } from '../src/ui/live-net';
import liveNetSource from '../src/ui/live-net.ts?raw';
import { MATCH_ID, publicAt, scripted } from './helpers/scripted-match';
import { codeOnly } from './helpers/scan';

const BASE = 'https://mbrg.test';
const CONFIG: PublicConfig = { maps: ['europe'], minInterval: 30, maxInterval: 3600, minPhase1: 10, minPhase2: 5, maxPlayers: 20, enabled: true };
const HOST = 'H0stH0stH0stH0stH0stH0stH0st_-ab';
const TOKEN = 'T0kenT0kenT0kenT0kenT0kenT0ken_-';
const PLAYER = 'player:Ab3_x-9.Qz1k';
const REQUEST = '0123456789abcdef0123456789abcdef';

interface Seen {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly credentials: RequestCredentials | undefined;
  readonly body: string | undefined;
}
type Answer = Response | 'network';

function fake(answers: Answer[]): { fetch: FetchLike; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetch: FetchLike = async (url, init) => {
    seen.push({ url, method: init?.method ?? 'GET', headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) }, credentials: init?.credentials, body: typeof init?.body === 'string' ? init.body : undefined });
    const next = answers.shift();
    if (next === undefined || next === 'network') throw new TypeError('network');
    return next;
  };
  return { fetch, seen };
}
const ok = (body: string, status = 200): Response => new Response(body, { status, headers: { 'content-type': 'application/json' } });
const refused = (kind: Parameters<typeof errorReply>[0], status: number, extra: Record<string, string> = {}): Response =>
  new Response(encodeError(errorReply(kind)), { status, headers: { 'content-type': 'application/json', ...extra } });

describe('FR-393 the public config read', () => {
  it('FR-393 GET /config is credential-free and gives the decoded config', async () => {
    const { fetch, seen } = fake([ok(encodePublicConfig(CONFIG))]);
    const read = await createPlayNet({ base: BASE, fetch }).config();
    expect(read).toStrictEqual({ ok: true, value: CONFIG });
    expect(seen).toStrictEqual([{ url: `${BASE}/config`, method: 'GET', headers: {}, credentials: 'omit', body: undefined }]);
  });

  it('FR-393 a config the decoder refuses, a refusal and a network failure are failures with an outcome', async () => {
    const { fetch } = fake([ok('{"maps":[]}'), refused('unavailable', 503), 'network']);
    const net = createPlayNet({ base: BASE, fetch });
    expect(await net.config()).toMatchObject({ ok: false, outcome: 'unreadable' });
    expect(await net.config()).toMatchObject({ ok: false, outcome: 'unavailable', status: 503 });
    expect(await net.config()).toMatchObject({ ok: false, outcome: 'network' });
  });
});

describe('FR-394 FR-395 creation', () => {
  it('FR-394 a creation is a POST with the body and no Authorization header, and the reply is read', async () => {
    const s = await scripted();
    const match = publicAt(s, 0, { stage: 'lobby', playerCount: 0 });
    const { fetch, seen } = fake([ok(encodeCreation({ matchId: MATCH_ID, match, hostToken: HOST }), 201)]);
    const body = { mapId: 'europe', timing: { i: 30, l1: 10, l2: 5 }, requestId: REQUEST };
    const read = await createPlayNet({ base: BASE, fetch }).create(body);
    expect(read.ok && read.value.hostToken).toBe(HOST);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe('POST');
    expect(seen[0]!.url).toBe(`${BASE}/matches`);
    expect(JSON.parse(seen[0]!.body as string)).toStrictEqual(body);
    expect(Object.keys(seen[0]!.headers).map((k) => k.toLowerCase())).toStrictEqual(['content-type']);
    expect(seen[0]!.credentials).toBe('omit');
  });

  it('FR-395 each refusal keeps its code, and rate-limited keeps the seconds to wait', async () => {
    const { fetch } = fake([refused('too-many-matches', 429), new Response(encodeError(rateLimited(7)), { status: 429, headers: { 'content-type': 'application/json' } }), refused('invalid-timing', 400), 'network']);
    const net = createPlayNet({ base: BASE, fetch });
    const body = { mapId: 'europe', timing: { i: 30, l1: 10, l2: 5 }, requestId: REQUEST };
    expect(await net.create(body)).toMatchObject({ ok: false, outcome: 'too-many-matches', status: 429 });
    expect(await net.create(body)).toMatchObject({ ok: false, outcome: 'rate-limited', retryAfter: 7 });
    expect(await net.create(body)).toMatchObject({ ok: false, outcome: 'invalid-timing' });
    expect(await net.create(body)).toMatchObject({ ok: false, outcome: 'network' });
  });

  it('FR-395 a 201 whose body is not a creation reply is unreadable, not a success', async () => {
    const { fetch } = fake([ok('{"matchId":"x"}', 201)]);
    expect(await createPlayNet({ base: BASE, fetch }).create({ mapId: 'europe', timing: { i: 30, l1: 10, l2: 5 }, requestId: REQUEST })).toMatchObject({ ok: false, outcome: 'unreadable' });
  });
});

describe('FR-396 FR-398 join, players and start', () => {
  it('FR-396 a join posts the name and the request id with no credential and reads the token once', async () => {
    const s = await scripted();
    const match = publicAt(s, 0, { stage: 'lobby', playerCount: 1 });
    const { fetch, seen } = fake([ok(encodeJoinReply({ playerId: PLAYER, name: 'Ana', playerToken: TOKEN, match }), 201)]);
    const read = await createPlayNet({ base: BASE, fetch }).join(MATCH_ID, { name: 'Ana', requestId: REQUEST });
    expect(read.ok && read.value.playerToken).toBe(TOKEN);
    expect(seen[0]!.url).toBe(`${BASE}/matches/${MATCH_ID}/players`);
    expect(seen[0]!.method).toBe('POST');
    expect(JSON.parse(seen[0]!.body as string)).toStrictEqual({ name: 'Ana', requestId: REQUEST });
    expect(Object.keys(seen[0]!.headers).map((k) => k.toLowerCase())).toStrictEqual(['content-type']);
  });

  it('FR-396 name-taken, match-full, match-expired and match-finished come back as their codes', async () => {
    const { fetch } = fake([refused('name-taken', 409), refused('match-full', 409), refused('match-expired', 410), refused('match-finished', 409)]);
    const net = createPlayNet({ base: BASE, fetch });
    const outcomes: string[] = [];
    for (let i = 0; i < 4; i++) {
      const read = await net.join(MATCH_ID, { name: 'Ana', requestId: REQUEST });
      outcomes.push(read.ok ? 'ok' : read.outcome);
    }
    expect(outcomes).toStrictEqual(['name-taken', 'match-full', 'match-expired', 'match-finished']);
  });

  it('FR-398 start posts to the match with the host token as the only credential', async () => {
    const s = await scripted();
    const started = publicAt(s, 0, { stage: 'phase-1' });
    const { fetch, seen } = fake([ok(encodePublicMatch(started))]);
    const read = await createPlayNet({ base: BASE, fetch }).start(MATCH_ID, HOST, REQUEST);
    expect(read.ok && read.value.stage).toBe('phase-1');
    expect(seen[0]!.url).toBe(`${BASE}/matches/${MATCH_ID}/start`);
    expect(seen[0]!.headers.Authorization).toBe(`Bearer ${HOST}`);
    expect(JSON.parse(seen[0]!.body as string)).toStrictEqual({ requestId: REQUEST });
    expect(seen[0]!.url).not.toContain(HOST);
  });

  it('FR-398 a refused start keeps its code', async () => {
    const { fetch } = fake([refused('forbidden', 403)]);
    expect(await createPlayNet({ base: BASE, fetch }).start(MATCH_ID, HOST, REQUEST)).toMatchObject({ ok: false, outcome: 'forbidden', status: 403 });
  });

  it('FR-398 the players read follows the pages until there is no next one', async () => {
    const item = (n: number): PlayerListItem => ({ playerId: `player:Ab3_x-9.Qz${n}k`, name: `P${n}`, joinedSeq: n });
    const { fetch, seen } = fake([ok(encodePage({ items: [item(1), item(2)], next: 'CURSOR1' }, encodePlayerListItem)), ok(encodePage({ items: [item(3)] }, encodePlayerListItem))]);
    const read = await createPlayNet({ base: BASE, fetch }).players(MATCH_ID);
    expect(read.ok && read.value.map((p) => p.name)).toStrictEqual(['P1', 'P2', 'P3']);
    expect(seen.map((r) => r.url)).toStrictEqual([`${BASE}/matches/${MATCH_ID}/players?limit=500`, `${BASE}/matches/${MATCH_ID}/players?limit=500&cursor=CURSOR1`]);
    for (const r of seen) expect(r.headers).toStrictEqual({});
  });

  it('FR-398 a players read that fails halfway is a failure, not a short list', async () => {
    const item: PlayerListItem = { playerId: 'player:Ab3_x-9.Qz1k', name: 'P1', joinedSeq: 1 };
    const { fetch } = fake([ok(encodePage({ items: [item], next: 'C' }, encodePlayerListItem)), 'network']);
    expect(await createPlayNet({ base: BASE, fetch }).players(MATCH_ID)).toMatchObject({ ok: false, outcome: 'network' });
  });

  it('FR-398 a match id outside the id rules is refused before any request', async () => {
    const { fetch, seen } = fake([]);
    const net = createPlayNet({ base: BASE, fetch });
    expect(await net.players('x/../y')).toMatchObject({ ok: false, outcome: 'invalid-match' });
    expect(await net.join('bad', { name: 'Ana', requestId: REQUEST })).toMatchObject({ ok: false, outcome: 'invalid-match' });
    expect(await net.start('bad', HOST, REQUEST)).toMatchObject({ ok: false, outcome: 'invalid-match' });
    expect(seen).toStrictEqual([]);
  });
});

describe('FR-401 FR-402 FR-404 submitting and reading the own predictions', () => {
  const LOCAL = 'Ab3_x-9.Qz1k';
  const body = { kind: 'victim', round: 2, faction: 7, playerId: LOCAL, requestId: REQUEST } as const;

  it('FR-401 a submission posts the body with the player token as the only credential and reads the stored choice', async () => {
    const { fetch, seen } = fake([ok(encodePrediction({ kind: 'victim', round: 2, choice: 7, version: 1 }))]);
    const read = await createPlayNet({ base: BASE, fetch }).submit(MATCH_ID, TOKEN, body);
    expect(read).toStrictEqual({ ok: true, value: { kind: 'victim', round: 2, choice: 7, version: 1 } });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(`${BASE}/matches/${MATCH_ID}/predictions`);
    expect(seen[0]!.method).toBe('POST');
    expect(seen[0]!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(seen[0]!.body as string)).toStrictEqual(body);
    expect(seen[0]!.url).not.toContain(TOKEN);
    expect(seen[0]!.body).not.toContain(TOKEN);
    expect(seen[0]!.credentials).toBe('omit');
  });

  it('FR-404 closed, forced and network failures keep their codes', async () => {
    const { fetch } = fake([refused('prediction-closed', 409), refused('forced-absorber', 409), refused('forbidden', 403), 'network']);
    const net = createPlayNet({ base: BASE, fetch });
    const outcomes: string[] = [];
    for (let i = 0; i < 4; i++) {
      const read = await net.submit(MATCH_ID, TOKEN, body);
      outcomes.push(read.ok ? 'ok' : read.outcome);
    }
    expect(outcomes).toStrictEqual(['prediction-closed', 'forced-absorber', 'forbidden', 'network']);
  });

  it('FR-404 a token or a match outside the id rules is refused before any request', async () => {
    const { fetch, seen } = fake([]);
    const net = createPlayNet({ base: BASE, fetch });
    expect(await net.submit(MATCH_ID, 'short', body)).toMatchObject({ ok: false, outcome: 'missing-credential' });
    expect(await net.submit('bad', TOKEN, body)).toMatchObject({ ok: false, outcome: 'invalid-match' });
    expect(await net.ownPredictions(MATCH_ID, '', LOCAL)).toMatchObject({ ok: false, outcome: 'missing-credential' });
    expect(await net.ownPredictions(MATCH_ID, TOKEN, 'player:x')).toMatchObject({ ok: false, outcome: 'invalid-player-id' });
    expect(seen).toStrictEqual([]);
  });

  it('FR-401 the own predictions read sends the player token as Bearer and the local id as the only query, over all pages', async () => {
    const own = (round: number, choice: number): OwnPrediction => ({ playerId: LOCAL, kind: 'victim', round, choice, version: 1 });
    const { fetch, seen } = fake([ok(encodePage({ items: [own(1, 3)], next: 'C1' }, encodeOwnPrediction)), ok(encodePage({ items: [own(2, 4)] }, encodeOwnPrediction))]);
    const read = await createPlayNet({ base: BASE, fetch }).ownPredictions(MATCH_ID, TOKEN, LOCAL);
    expect(read.ok && read.value.map((p) => p.choice)).toStrictEqual([3, 4]);
    expect(seen.map((r) => r.url)).toStrictEqual([
      `${BASE}/matches/${MATCH_ID}/predictions?limit=500&playerId=${LOCAL}`,
      `${BASE}/matches/${MATCH_ID}/predictions?limit=500&playerId=${LOCAL}&cursor=C1`,
    ]);
    for (const r of seen) {
      expect(r.method).toBe('GET');
      expect(r.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(r.url).not.toContain(TOKEN);
    }
  });
});

describe('FR-406 FR-407 results, leaderboard and winners reads', () => {
  it('FR-406 the player results and the leaderboard are credential-free GETs over all pages', async () => {
    const r = (round: number): PlayerResult => ({ kind: 'victim', round, choice: 2, correct: true, points: 10 });
    const row = (rank: number, id: string): LeaderboardRow => ({ rank, playerId: id, total: 10, correctVictims: 1, correctAbsorbers: 0, correctWinner: 0, name: `N${rank}` });
    const { fetch, seen } = fake([
      ok(encodePlayerResults({ playerId: PLAYER, total: 20, items: [r(1)], next: 'P1', name: 'Ana' })),
      ok(encodePlayerResults({ playerId: PLAYER, total: 25, items: [r(2)] })),
      ok(encodePage({ items: [row(1, 'player:a'), row(2, 'player:b')] }, encodeLeaderboardRow)),
    ]);
    const net = createPlayNet({ base: BASE, fetch });
    const scores = await net.playerResults(MATCH_ID, PLAYER);
    expect(scores.ok && scores.value.total).toBe(20);
    expect(scores.ok && scores.value.items.map((i) => i.round)).toStrictEqual([1, 2]);
    expect(scores.ok && scores.value.name).toBe('Ana');
    const board = await net.leaderboard(MATCH_ID);
    expect(board.ok && board.value.map((x) => x.name)).toStrictEqual(['N1', 'N2']);
    expect(seen.map((x) => x.url)).toStrictEqual([
      `${BASE}/matches/${MATCH_ID}/players/${PLAYER}/results?limit=500`,
      `${BASE}/matches/${MATCH_ID}/players/${PLAYER}/results?limit=500&cursor=P1`,
      `${BASE}/matches/${MATCH_ID}/leaderboard?limit=500`,
    ]);
    for (const x of seen) expect(x.headers).toStrictEqual({});
    expect(await net.playerResults(MATCH_ID, 'nope')).toMatchObject({ ok: false, outcome: 'invalid-player-id' });
  });

  it('FR-407 the winners read gives the names of a scored phase, credential-free, and an unscored phase is a failure', async () => {
    const { fetch, seen } = fake([
      ok(encodePhaseWinners({ round: 3, phase: 1, items: [{ playerId: 'player:a', name: 'Ana' }, { playerId: 'player:b', name: 'Beto' }] })),
      refused('round-not-applied', 404),
    ]);
    const net = createPlayNet({ base: BASE, fetch });
    const names = await net.winners(MATCH_ID, 3, 1);
    expect(names.ok && names.value.map((w) => w.name)).toStrictEqual(['Ana', 'Beto']);
    expect(seen[0]!.url).toBe(`${BASE}/matches/${MATCH_ID}/results/3/1/winners?limit=500`);
    expect(seen[0]!.headers).toStrictEqual({});
    expect(await net.winners(MATCH_ID, 4, 2)).toMatchObject({ ok: false, outcome: 'round-not-applied' });
    expect(await net.winners(MATCH_ID, 0, 2)).toMatchObject({ ok: false, outcome: 'bad-round' });
    expect(await net.winners('bad', 1, 2)).toMatchObject({ ok: false, outcome: 'invalid-match' });
  });
});

describe('NFR-78 tokens stay out of the transport', () => {
  it('NFR-78 the transport source never logs', () => {
    expect(codeOnly(liveNetSource)).not.toMatch(/console/);
  });
});
