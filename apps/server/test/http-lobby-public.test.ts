import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import { LOBBY_RETENTION_MS } from '../src/store/store';
import { request } from './helpers/http-client';
import type { ClientReply } from './helpers/http-client';
import { closeAllServers, errorBody, startServer } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { OPERATOR, START_MS, creationBody } from './helpers/service-harness';
import { openStream } from './helpers/sse-reader';

// The public data of a lobby over a real listener (spec 011 M5 T5): the match read, the players list, the match list and the
// stream, with three players, before and after the start, expired, and removed. Expected member lists are literals.

afterEach(closeAllServers);

const HOUR = 3_600_000;
const begin = (): Promise<ServerHarness> =>
  startServer({
    routes: productionRoutes,
    service: { publicCreation: { maps: ['dev'], lobbyExpiryHours: 1, maxOpenLobbies: 10 } },
    limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, createSource: 100_000, createAll: 100_000, joinSource: 100_000, joinMatch: 100_000 },
  });
const lobbyOf = (h: ServerHarness): { matchId: string; hostToken: string } => {
  const out = h.service.createPublic({ source: 'src-host', body: creationBody('c-1') });
  if (!out.ok) throw new Error('public creation failed');
  return { matchId: out.reply.matchId, hostToken: out.reply.hostToken };
};
const joinThree = (h: ServerHarness, matchId: string): string[] =>
  ['Zed', 'Amy', 'Bob'].map((name, i) => {
    const out = h.service.join({ source: 'src-a', matchId, body: { name, requestId: `j-${i}` } });
    if (!out.ok) throw new Error('join failed');
    return out.reply.playerToken;
  });
const get = (h: ServerHarness, path: string): Promise<ClientReply> => request(h.port, { path });
const keysOf = (reply: ClientReply): string[] => Object.keys(reply.json() as object);

const LOBBY_KEYS = ['matchId', 'mapId', 'mapDigest', 'totalRounds', 'timing', 'commitment', 'stage', 'appliedRounds', 'state', 'stateDigest', 'lastSeq', 'reportedTime', 'playerCount'];
const RUNNING_008_KEYS = ['matchId', 'mapId', 'mapDigest', 'totalRounds', 'timing', 'commitment', 'stage', 'appliedRounds', 'state', 'stateDigest', 'lastSeq', 'reportedTime', 'schedule'];

describe('http lobby public data', () => {
  it('FR-373 (HTTP) a lobby with three players: stage, map, timing and playerCount 3 on the match read, the three names in join order on the players list', async () => {
    const h = await begin();
    const { matchId } = lobbyOf(h);
    joinThree(h, matchId);
    const read = await get(h, `/matches/${matchId}`);
    expect(read.status).toBe(200);
    expect(keysOf(read)).toStrictEqual(LOBBY_KEYS);
    expect(read.json()).toMatchObject({ stage: 'lobby', mapId: 'dev', timing: { i: 120, l1: 30, l2: 10 }, playerCount: 3, appliedRounds: 0, lastSeq: 4 });
    for (const forbidden of ['"schedule"', '"victim"', '"winner"', '"matchSecret"', '"haltReason"', '"results"']) expect(read.text, forbidden).not.toContain(forbidden);
    // The state is the round-0 state.
    const state = await get(h, `/matches/${matchId}/states/0`);
    expect((state.json() as { owners: unknown }).owners).toStrictEqual((read.json() as { state: { owners: unknown } }).state.owners);
    const list = await get(h, `/matches/${matchId}/players`);
    expect((list.json() as { items: { name: string; joinedSeq: number }[] }).items.map((i) => [i.name, i.joinedSeq])).toStrictEqual([['Zed', 2], ['Amy', 3], ['Bob', 4]]);
    // Nothing of a round can be read: round 1 of every read is not applied, naming only 0.
    for (const path of [`/matches/${matchId}/states/1`, `/matches/${matchId}/records/1`, `/matches/${matchId}/results/1/1`, `/matches/${matchId}/results/1/2`, `/matches/${matchId}/results/1/1/winners`, `/matches/${matchId}/results/1/2/winners`]) {
      const reply = await get(h, path);
      expect([path, reply.status, reply.json()]).toStrictEqual([path, 404, expect.objectContaining({ kind: 'round-not-applied' })]);
    }
    const records = await get(h, `/matches/${matchId}/records`);
    expect(records.text).toBe('{"items":[]}');
  });

  it('FR-373 (HTTP) the stream of a lobby carries the lobby schedule event and the three joins, and no results or victim-revealed event', async () => {
    const h = await begin();
    const { matchId } = lobbyOf(h);
    joinThree(h, matchId);
    const stream = await openStream({ port: h.port, path: `/matches/${matchId}/events?lastEventId=0` });
    try {
      const frames = await stream.takeEvents(4);
      const events = frames.map((f) => JSON.parse(f.data) as { type: string; seq: number });
      expect(events.map((e) => [e.type, e.seq])).toStrictEqual([['schedule', 1], ['player-joined', 2], ['player-joined', 3], ['player-joined', 4]]);
      expect(events[0]).toMatchObject({ stage: 'lobby' });
      expect(stream.raw()).not.toMatch(/"results"|victim-revealed|phase-closed/);
    } finally {
      stream.close();
    }
  });

  it('FR-373 (HTTP) after the start the lobby view becomes the 008 running view and the count stays', async () => {
    const h = await begin();
    const { matchId, hostToken } = lobbyOf(h);
    joinThree(h, matchId);
    const started = await request(h.port, { method: 'POST', path: `/matches/${matchId}/start`, body: {}, headers: { authorization: `Bearer ${hostToken}` } });
    expect(started.status).toBe(200);
    const read = await get(h, `/matches/${matchId}`);
    expect(read.text).toBe(started.text);
    expect(keysOf(read)).toStrictEqual([...RUNNING_008_KEYS.slice(0, -1), 'playerCount', 'schedule']);
    expect(read.json()).toMatchObject({ stage: 'phase-1', playerCount: 3 });
    expect(read.text).not.toContain('"victim"');
  });

  it('FR-373 (HTTP) an expired lobby shows stage expired and keeps its players list until removed, then both answer unknown-match', async () => {
    const h = await begin();
    const { matchId } = lobbyOf(h);
    joinThree(h, matchId);
    h.clock.set(START_MS + HOUR);
    h.service.tick();
    const read = await get(h, `/matches/${matchId}`);
    expect(read.json()).toMatchObject({ stage: 'expired', playerCount: 3 });
    expect(keysOf(read)).toStrictEqual(LOBBY_KEYS);
    expect(((await get(h, `/matches/${matchId}/players`)).json() as { items: { name: string }[] }).items.map((i) => i.name)).toStrictEqual(['Zed', 'Amy', 'Bob']);
    h.clock.set(START_MS + HOUR + LOBBY_RETENTION_MS + 1);
    h.service.tick();
    for (const path of [`/matches/${matchId}`, `/matches/${matchId}/players`]) {
      const reply = await get(h, path);
      expect([path, reply.status, reply.text]).toStrictEqual([path, 404, errorBody('unknown-match')]);
    }
  });

  it('FR-373 (HTTP) the match list includes the lobby with stage lobby and the summary fields only, no player data', async () => {
    const h = await begin();
    const { matchId } = lobbyOf(h);
    joinThree(h, matchId);
    const reply = await get(h, '/matches');
    const items = (reply.json() as { items: Record<string, unknown>[] }).items;
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]!)).toStrictEqual(['matchId', 'mapId', 'stage', 'appliedRounds', 'totalRounds', 'createdAt']);
    expect(items[0]).toMatchObject({ matchId, stage: 'lobby', appliedRounds: 0 });
    expect(reply.text).not.toMatch(/playerCount|Zed|Amy|Bob|player:/);
  });

  it('FR-373 (HTTP) a running match with no players has no playerCount member (the 008 bytes)', async () => {
    const h = await begin();
    const made = h.service.create({ credential: OPERATOR, body: creationBody('c-op') });
    if (!made.ok) throw new Error('creation failed');
    const read = await get(h, `/matches/${made.reply.matchId}`);
    expect(keysOf(read)).toStrictEqual(RUNNING_008_KEYS);
    expect(read.text).not.toContain('playerCount');
  });
});
