import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTING_VARIABLES } from '../src/service/settings';
import { bearerHeader, request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { withTempDirAsync } from './helpers/http-reads-kit';
import { baseEnv, eventsOf, withMain } from './helpers/main-child';
import { openStream } from './helpers/sse-reader';
import { takeUntilType } from './helpers/stream-run';

// The lobby flow against the production entry point (`node --import tsx src/main.ts`) as a child process, port 0, a real clock:
// anonymous creation, joins with tokens, a stream open from before the first join, the start, predictions by token and the
// first reveal on the stream. Every child is killed by its PID in a `finally` (helpers/main-child.ts). The fake clock cannot
// reach a child, so the timing is the shortest the public bounds allow and the only wait is the first phase.

const PUBLIC_ENV = { MBRG_PUBLIC_MAPS: 'dev', MBRG_PUBLIC_MIN_INTERVAL: '4', MBRG_PUBLIC_MIN_PHASE1: '1', MBRG_PUBLIC_MIN_PHASE2: '1' };
// Phase 1 lasts 6 s: long enough for the predictions of a loaded machine, short enough for the wait.
const TIMING = { i: 12, l1: 6, l2: 3 };
const creation = (requestId: string): Record<string, unknown> => ({ mapId: 'dev', timing: TIMING, requestId });

const post = (port: number, path: string, body: unknown, token?: string): Promise<ClientReply> =>
  request(port, { method: 'POST', path, body, headers: token === undefined ? {} : bearerHeader(token) });
const get = (port: number, path: string): Promise<ClientReply> => request(port, { path });

interface Joined {
  readonly playerId: string;
  readonly local: string;
  readonly token: string;
  readonly name: string;
}
async function joinAs(port: number, matchId: string, name: string): Promise<Joined> {
  const reply = await post(port, `/matches/${matchId}/players`, { name, requestId: `j-${name}` });
  expect(reply.status).toBe(201);
  const body = reply.json() as { playerId: string; playerToken: string; name: string };
  return { playerId: body.playerId, local: body.playerId.slice('player:'.length), token: body.playerToken, name: body.name };
}
async function create(port: number, requestId = 'c-1'): Promise<{ matchId: string; hostToken: string; text: string }> {
  const made = await post(port, '/matches', creation(requestId));
  expect(made.status).toBe(201);
  const body = made.json() as { matchId: string; hostToken: string };
  return { matchId: body.matchId, hostToken: body.hostToken, text: made.text };
}
const livingOf = async (port: number, matchId: string): Promise<number[]> => {
  const state = (await get(port, `/matches/${matchId}/states/0`)).json() as { owners: [number, number][] };
  return [...new Set(state.owners.map(([, faction]) => faction))].sort((a, b) => a - b);
};
/** A read of a lobby without its reported time (the real clock moves between two reads; every other byte is pinned). */
const timeless = (text: string): string => text.replace(/"reportedTime":\d+/, '"reportedTime":0');
const winner = (faction: number, playerId: string): Record<string, unknown> => ({ kind: 'winner', faction, playerId });

/** The members of a public view of a lobby: the stage, the map, the timing and the count, and nothing of any round. */
const LOBBY_KEYS = ['appliedRounds', 'commitment', 'lastSeq', 'mapDigest', 'mapId', 'matchId', 'playerCount', 'reportedTime', 'stage', 'state', 'stateDigest', 'timing', 'totalRounds'];

describe('the lobby flow against the production entry point', () => {
  it('anonymous creation, two joins, a stream from before the first join, the start, token predictions and the first reveal', async () => {
    await withMain(baseEnv(PUBLIC_ENV), async (child, port) => {
      const { matchId, hostToken, text } = await create(port);
      expect(JSON.parse(text)).toMatchObject({ match: { stage: 'lobby', playerCount: 0 } });

      // The stream is open before the first join and carries the whole story.
      const stream = await openStream({ port, path: `/matches/${matchId}/events?lastEventId=0` });
      try {
        expect(stream.status).toBe(200);
        const ana = await joinAs(port, matchId, 'Ana');
        const bea = await joinAs(port, matchId, 'Bea');
        expect(ana.playerId).not.toBe(bea.playerId);
        expect(ana.token).not.toBe(bea.token);

        // The lobby read: stage, map, timing and the count; no field of a round.
        const lobby = (await get(port, `/matches/${matchId}`)).json() as Record<string, unknown>;
        expect(Object.keys(lobby).sort()).toStrictEqual(LOBBY_KEYS);
        expect(lobby).toMatchObject({ stage: 'lobby', mapId: 'dev', timing: TIMING, playerCount: 2, appliedRounds: 0 });
        const listed = (await get(port, `/matches/${matchId}/players`)).json() as { items: { playerId: string; name: string; joinedSeq: number }[] };
        expect(listed.items).toStrictEqual([
          { playerId: ana.playerId, name: 'Ana', joinedSeq: 2 },
          { playerId: bea.playerId, name: 'Bea', joinedSeq: 3 },
        ]);

        // Nobody but the host starts it.
        expect((await post(port, `/matches/${matchId}/start`, {}, ana.token)).status).toBe(403);
        const started = await post(port, `/matches/${matchId}/start`, {}, hostToken);
        expect(started.status).toBe(200);
        expect(started.json()).toMatchObject({ matchId, stage: 'phase-1', appliedRounds: 0 });

        // Predictions by token, each under its own player id.
        const [a, b] = (await livingOf(port, matchId)) as [number, number];
        expect((await post(port, `/matches/${matchId}/predictions`, winner(a, ana.local), ana.token)).status).toBe(200);
        expect((await post(port, `/matches/${matchId}/predictions`, winner(b, bea.local), bea.token)).status).toBe(200);
        expect((await post(port, `/matches/${matchId}/predictions`, winner(a, bea.local), ana.token)).status).toBe(403);

        // The stream: the lobby, the joins, the start, then the first reveal at the close of phase 1.
        const events = await takeUntilType(stream, 'victim-revealed');
        expect(events.map((e) => e.type)).toStrictEqual(['schedule', 'player-joined', 'player-joined', 'schedule', 'phase-closed', 'victim-revealed']);
        expect(events.map((e) => e.seq)).toStrictEqual([1, 2, 3, 4, 5, 6]);
        expect(events[0]).toMatchObject({ stage: 'lobby' });
        expect(events.slice(1, 3)).toMatchObject([{ playerId: ana.playerId, name: 'Ana' }, { playerId: bea.playerId, name: 'Bea' }]);
        expect(events[3]).toMatchObject({ stage: 'phase-1', schedule: expect.any(Object) });
        expect((await get(port, `/matches/${matchId}`)).json()).toMatchObject({ stage: 'phase-2', victim: { round: 1 } });

        // No token, host token or name reached the process output.
        const out = child.stdout() + child.stderr();
        for (const secret of [ana.token, bea.token, hostToken, 'Ana', 'Bea']) expect(out).not.toContain(secret);
        expect(eventsOf(child.stdout()).map((e) => e.event)).toStrictEqual(['start-report', 'listening']);
        expect(child.stderr()).toBe('');
      } finally {
        stream.close();
      }
    });
  }, 90_000);

  it('a restart of the real server process in the lobby keeps the players, their names, the join order and the tokens', async () => {
    await withTempDirAsync(async (dir) => {
      const env = baseEnv({ ...PUBLIC_ENV, MBRG_DATABASE: join(dir, 'mbrg.sqlite') });
      const before = await withMain(env, async (_child, port) => {
        const { matchId, hostToken } = await create(port);
        const ana = await joinAs(port, matchId, 'Ana');
        const bea = await joinAs(port, matchId, 'Bea');
        const lobby = timeless((await get(port, `/matches/${matchId}`)).text);
        const players = (await get(port, `/matches/${matchId}/players`)).text;
        const replay = await openStream({ port, path: `/matches/${matchId}/events?lastEventId=0` });
        try {
          const frames = await replay.takeEvents(3);
          return { matchId, hostToken, ana, bea, lobby, players, frames: frames.map((f) => f.raw) };
        } finally {
          replay.close();
        }
      });
      // The first child was killed by its PID: no shutdown code ran.
      await withMain(env, async (_child, port) => {
        const { matchId } = before;
        expect(timeless((await get(port, `/matches/${matchId}`)).text)).toBe(before.lobby);
        expect((await get(port, `/matches/${matchId}/players`)).text).toBe(before.players);
        const replay = await openStream({ port, path: `/matches/${matchId}/events?lastEventId=0` });
        try {
          expect((await replay.takeEvents(3)).map((f) => f.raw)).toStrictEqual(before.frames);
        } finally {
          replay.close();
        }
        // A join sent again with the same request id and source replays the first reply: the same player and the same token.
        const again = await post(port, `/matches/${matchId}/players`, { name: 'Ana', requestId: 'j-Ana' });
        expect(again.status).toBe(201);
        expect(again.json()).toMatchObject({ playerId: before.ana.playerId, playerToken: before.ana.token });
        // The host token still starts the lobby and both player tokens still submit.
        expect((await post(port, `/matches/${matchId}/start`, {}, before.hostToken)).status).toBe(200);
        const [a, b] = (await livingOf(port, matchId)) as [number, number];
        expect((await post(port, `/matches/${matchId}/predictions`, winner(a, before.ana.local), before.ana.token)).status).toBe(200);
        expect((await post(port, `/matches/${matchId}/predictions`, winner(b, before.bea.local), before.bea.token)).status).toBe(200);
        expect((await get(port, `/matches/${matchId}/players`)).text).toBe(before.players);
      });
    });
  }, 120_000);
});

describe('the entry point offers no way to choose the round seeds', () => {
  const MAIN_TEXT = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const SETTINGS_TEXT = readFileSync(new URL('../src/service/settings.ts', import.meta.url), 'utf8');
  const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

  it('the 30 variables are listed once, none names a seed, and main.ts reads no seed source', () => {
    expect(SETTING_VARIABLES).toHaveLength(30);
    expect(new Set(SETTING_VARIABLES).size).toBe(30);
    expect(SETTING_VARIABLES.filter((name) => /seed|random|test/i.test(name))).toStrictEqual([]);
    // "SOURCE" in a name means the requesting address (the two rate variables), nothing else.
    expect(SETTING_VARIABLES.filter((name) => /source/i.test(name))).toStrictEqual(['MBRG_LIMIT_CREATE_SOURCE', 'MBRG_LIMIT_JOIN_SOURCE']);
    expect(/testSeedSource|seedSource|seed_source|seedOf|roundSeeds|\brandom\b|\bMBRG_TEST/i.test(code(MAIN_TEXT))).toBe(false);
    expect(/seed/i.test(code(SETTINGS_TEXT))).toBe(false);
    const read = [...new Set([...code(SETTINGS_TEXT).matchAll(/env\.([A-Z0-9_]+)/g)].map((m) => m[1]))].sort();
    expect(read).toStrictEqual([...SETTING_VARIABLES].sort());
  });

  it('a child given seed-like variables behaves as one without them: same lines, same lobby shape', async () => {
    const shape = async (extra: Record<string, string>): Promise<unknown> =>
      withMain(baseEnv({ ...PUBLIC_ENV, ...extra }), async (child, port) => {
        const { matchId, text } = await create(port);
        const redacted = JSON.stringify(JSON.parse(text), (key, value: unknown) => (key === 'matchId' || key === 'hostToken' || key === 'commitment' || key === 'reportedTime' ? '*' : value));
        return { lines: eventsOf(child.stdout()).map((e) => e.event), created: redacted, read: Object.keys((await get(port, `/matches/${matchId}`)).json() as object) };
      });
    const plain = await shape({});
    const noisy = await shape({ MBRG_TEST_SEED_SOURCE: '1', MBRG_SEED_SOURCE: 'fixed', MBRG_ROUND_SEED: '5', MBRG_SECRET: '00'.repeat(32), TEST_SEED_SOURCE: '1' });
    expect(noisy).toStrictEqual(plain);
  }, 90_000);
});
