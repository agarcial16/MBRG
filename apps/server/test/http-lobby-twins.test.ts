import { getState, playRoundWithSeed } from '@mbrg/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { devMap } from './helpers/digests';
import { SECRETS } from './helpers/core-timelines';
import { encodingsOf } from './helpers/db-scan';
import { bearerHeader, request } from './helpers/http-client';
import { startReads } from './helpers/http-reads-kit';
import { closeAllServers } from './helpers/server-harness';
import type { ServerHarness, ServerHarnessOptions } from './helpers/server-harness';
import { START_MS, creationBody } from './helpers/service-harness';
import { openStream } from './helpers/sse-reader';
import type { SseReader } from './helpers/sse-reader';

// Twin lobbies over a real listener (spec 011 M4 T9): two servers hold lobbies whose public data are equal (same match secret,
// so the same commitment; same random bytes, so the same ids and tokens) and whose round seeds differ (the test seed source,
// the only way to tell them apart). Every reply and every stream byte of the lobby and of the start, up to the close of phase 1,
// must be byte-identical; and no byte holds the secret or a round seed in any encoding. The real process is in http-lobby-flow.

const readers: SseReader[] = [];
afterEach(async () => {
  for (const r of readers.splice(0, readers.length)) r.close();
  await closeAllServers();
});

const MAP = devMap();
const STATE0 = ((): Parameters<typeof playRoundWithSeed>[1] => {
  const r = getState(MAP, 0, 0);
  if (!r.ok) throw new Error('no round-0 state');
  return r.value;
})();
const victimOf = (seed: number): number => {
  const r = playRoundWithSeed(MAP, STATE0, seed);
  if (!r.ok) throw new Error('the round cannot be played');
  return r.value.record.eliminated;
};
const FIRST = 101;
/** Two seeds for round 1 with different victims. */
const SEEDS = ((): [number, number] => {
  for (let seed = FIRST + 1; seed < 5000; seed += 1) if (victimOf(seed) !== victimOf(FIRST)) return [FIRST, seed];
  throw new Error('no seed pair');
})();
const sourceOf = (round1: number) => () => (k: number) => (k === 1 ? round1 : 7000 + k);

const SECRET = SECRETS['ascending-00-1f'];
const PUBLIC = { maps: ['dev'], lobbyExpiryHours: 48, maxOpenLobbies: 10 } as const;
const HIGH = { createSource: 100_000, createAll: 100_000, joinSource: 100_000, joinMatch: 100_000 };

interface Session {
  readonly h: ServerHarness;
  readonly matchId: string;
  /** Every reply of the session, in order: label, status and body text. */
  readonly replies: [string, number, string][];
  /** The stream opened before the first join. */
  readonly live: SseReader;
}

/** One lobby from creation to the start, over HTTP; the same requests whatever the server. */
async function session(service: ServerHarnessOptions['service']): Promise<Session> {
  const h = await startReads({ service: { scheduler: true, secret: SECRET, publicCreation: PUBLIC, ...(service ?? {}) }, limits: HIGH });
  const replies: [string, number, string][] = [];
  const call = async (label: string, method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; text: string; json(): unknown }> => {
    const r = await request(h.port, { method, path, ...(body === undefined ? {} : { body }), headers: token === undefined ? {} : bearerHeader(token) });
    replies.push([label, r.status, r.text]);
    return r;
  };
  const made = await call('create', 'POST', '/matches', creationBody('c-1'));
  const { matchId, hostToken } = made.json() as { matchId: string; hostToken: string };
  const live = await openStream({ port: h.port, path: `/matches/${matchId}/events?lastEventId=0` });
  readers.push(live);
  const ana = (await call('join Ana', 'POST', `/matches/${matchId}/players`, { name: 'Ana', requestId: 'j-1' })).json() as { playerToken: string };
  await call('join Bea', 'POST', `/matches/${matchId}/players`, { name: 'Bea', requestId: 'j-2' });
  for (const path of ['/matches', `/matches/${matchId}`, `/matches/${matchId}/players`, `/matches/${matchId}/records`, `/matches/${matchId}/states/0`, `/matches/${matchId}/states/1`, `/matches/${matchId}/records/1`, `/matches/${matchId}/leaderboard`]) {
    await call(`lobby ${path}`, 'GET', path);
  }
  const replay = await openStream({ port: h.port, path: `/matches/${matchId}/events?lastEventId=0` });
  readers.push(replay);
  const frames = await replay.takeEvents(3);
  replies.push(['lobby replay', 200, frames.map((f) => f.raw).join('')]);
  await call('refused start', 'POST', `/matches/${matchId}/start`, {}, ana.playerToken);
  await call('start', 'POST', `/matches/${matchId}/start`, {}, hostToken);
  for (const path of ['/matches', `/matches/${matchId}`, `/matches/${matchId}/players`, `/matches/${matchId}/states/1`, `/matches/${matchId}/records/1`]) {
    await call(`started ${path}`, 'GET', path);
  }
  return { h, matchId, replies, live };
}

describe('twin lobbies over HTTP', () => {
  it('lobby reads and the start give byte-identical replies and stream bytes, until the close of phase 1 reveals the victim', async () => {
    expect(victimOf(SEEDS[0])).not.toBe(victimOf(SEEDS[1]));
    const a = await session({ testSeedSource: sourceOf(SEEDS[0]) });
    const b = await session({ testSeedSource: sourceOf(SEEDS[1]) });
    expect(a.matchId).toBe(b.matchId);
    expect(a.replies.length).toBeGreaterThan(15);
    expect(b.replies).toStrictEqual(a.replies);
    expect(a.replies.find(([label]) => label === 'start')?.[1]).toBe(200);
    expect(a.replies.find(([label]) => label === 'refused start')?.[1]).toBe(403);

    // The stream: the lobby, two joins, the start (4 events), identical bytes; a heartbeat and a clock just before C1 add nothing.
    await a.live.takeEvents(4);
    await b.live.takeEvents(4);
    for (const t of [a, b]) {
      t.h.scheduler.fireAll();
      t.h.base.scheduler!.runTo(START_MS + 80 * 1000 - 1);
    }
    expect(a.live.raw().length).toBeGreaterThan(300);
    expect(a.live.raw()).toBe(b.live.raw());

    // The close of phase 1 reveals the victim: the first frame is the same, the reveal differs, and the guard can see it.
    a.h.base.scheduler!.runTo(START_MS + 80 * 1000);
    b.h.base.scheduler!.runTo(START_MS + 80 * 1000);
    const ga = await a.live.takeEvents(2);
    const gb = await b.live.takeEvents(2);
    expect(ga[0]?.raw).toBe(gb[0]?.raw);
    expect(ga[1]?.raw).not.toBe(gb[1]?.raw);
    expect(JSON.parse(ga[1]!.data).victim).toBe(victimOf(SEEDS[0]));
    expect(JSON.parse(gb[1]!.data).victim).toBe(victimOf(SEEDS[1]));
  }, 60_000);
});

describe('the lobby and the secret', () => {
  const SEED_OF = (k: number): number => 3_000_000_000 + 7919 * k;
  const holds = (text: string, needle: string | Uint8Array): boolean => (typeof needle === 'string' ? text.includes(needle) : Buffer.from(text, 'utf8').includes(Buffer.from(needle)));

  it('no reply or stream byte of the lobby, the joins and the start holds the match secret or a round seed in any encoding', async () => {
    const s = await session({ testSeedSource: () => SEED_OF });
    // The live stream of the whole session (lobby, joins, start): everything sent so far.
    await s.live.takeEvents(4);
    const texts = [...s.replies.map(([, , text]) => text), s.live.raw()];
    const all = texts.join('\n');
    const needles = [...encodingsOf(SECRET), ...[1, 2, 3, 4].flatMap((k) => encodingsOf(SEED_OF(k)))];
    expect(needles.length).toBeGreaterThan(8);
    for (const needle of needles) expect(holds(all, needle), String(needle).slice(0, 14)).toBe(false);
    // The scan can see: the same needles are found in a text that holds them, and the host token of the creation is in the bytes.
    const hexed = Buffer.from(SECRET).toString('hex');
    expect(holds(`x${hexed}y`, needles.find((n) => n === hexed)!)).toBe(true);
    expect(holds(`x${SEED_OF(2)}y`, String(SEED_OF(2)))).toBe(true);
    const made = JSON.parse(s.replies[0]![2]) as { hostToken: string };
    expect(all).toContain(made.hostToken);
    // The creation reply and the lobby read show a commitment (the hash of the secret), never the secret itself.
    expect(JSON.parse(s.replies[0]![2]).match.commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(s.replies[0]![2]).match.commitment).not.toBe(hexed);
  }, 60_000);

  it('the lobby read names the stage, the map, the timing and the count of players, and no member of a round', async () => {
    const s = await session({ testSeedSource: () => SEED_OF });
    const lobby = s.replies.find(([label]) => label === `lobby /matches/${s.matchId}`)!;
    const view = JSON.parse(lobby[2]) as Record<string, unknown>;
    expect(Object.keys(view).sort()).toStrictEqual(['appliedRounds', 'commitment', 'lastSeq', 'mapDigest', 'mapId', 'matchId', 'playerCount', 'reportedTime', 'stage', 'state', 'stateDigest', 'timing', 'totalRounds']);
    expect(view).toMatchObject({ stage: 'lobby', mapId: 'dev', timing: { i: 120, l1: 30, l2: 10 }, playerCount: 2, appliedRounds: 0, lastSeq: 3 });
    // A round above the applied ones is one reply whatever it is (nothing of a future round exists in a lobby).
    const rounds = s.replies.filter(([label]) => /states\/1$|records\/1$/.test(label) && label.startsWith('lobby'));
    expect(rounds.map(([, status, text]) => `${status} ${text}`)).toStrictEqual(['404 {"kind":"round-not-applied","appliedRounds":0}', '404 {"kind":"round-not-applied","appliedRounds":0}']);
  }, 60_000);
});
