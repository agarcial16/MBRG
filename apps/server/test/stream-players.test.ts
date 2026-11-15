import { encodeEvent } from '@mbrg/protocol';
import type { MatchEvent } from '@mbrg/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { productionRoutes } from '../src/http/server';
import { HEARTBEAT_FRAME, HEARTBEAT_MS } from '../src/http/sse';
import { request } from './helpers/http-client';
import { closeAllServers, startServer } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';
import { openStream } from './helpers/sse-reader';
import type { SseReader } from './helpers/sse-reader';
import { START_MS, creationBody } from './helpers/service-harness';

// The lobby on the event stream (spec 011 M4 T6): each `player-joined` event is a frame with its stored number, a late subscriber
// replays what it missed, and the start and the expiry follow in the same story. The hub is the 008 one.

const readers: SseReader[] = [];
afterEach(async () => {
  for (const r of readers.splice(0, readers.length)) r.close();
  await closeAllServers();
});

const begin = (): Promise<ServerHarness> =>
  startServer({
    routes: productionRoutes,
    service: { publicCreation: { maps: ['dev'], lobbyExpiryHours: 1, maxOpenLobbies: 10 }, scheduler: true },
    limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, anonymousStreams: 100, joinSource: 100_000, joinMatch: 100_000 },
  });
const lobbyOf = (h: ServerHarness): { matchId: string; hostToken: string } => {
  const out = h.service.createPublic({ source: 'src-host', body: creationBody('c-1') });
  if (!out.ok) throw new Error('public creation failed');
  return { matchId: out.reply.matchId, hostToken: out.reply.hostToken };
};
const joinOver = async (h: ServerHarness, matchId: string, name: string): Promise<void> => {
  const reply = await request(h.port, { method: 'POST', path: `/matches/${matchId}/players`, body: { name, requestId: `r-${name}` } });
  if (reply.status !== 201) throw new Error(`join answered ${reply.status}`);
};
const open = async (h: ServerHarness, matchId: string, headers: Record<string, string> = {}): Promise<SseReader> => {
  const reader = await openStream({ port: h.port, path: `/matches/${matchId}/events`, headers });
  readers.push(reader);
  return reader;
};
const stored = (h: ServerHarness, matchId: string, after = 0): MatchEvent[] => h.base.store.eventsAfter(matchId, after);

describe('lobby stream: the joins', () => {
  it('FR-376 (stream) a client subscribed to a lobby gets each player-joined frame in order with the stored number, id and name only', async () => {
    const h = await begin();
    const { matchId } = lobbyOf(h);
    const reader = await open(h, matchId);
    expect(reader.status).toBe(200);
    for (const name of ['Ana', 'Bea', 'Cy']) await joinOver(h, matchId, name);
    const got = await reader.takeEvents(3);
    const events = stored(h, matchId, 1);
    expect(events.map((e) => e.type)).toStrictEqual(['player-joined', 'player-joined', 'player-joined']);
    expect(got.map((f) => f.id)).toStrictEqual([2, 3, 4]);
    expect(got.map((f) => f.data)).toStrictEqual(events.map((e) => encodeEvent(e)));
    expect(got.map((f) => f.raw)).toStrictEqual(got.map((f) => `id: ${f.id}\ndata: ${f.data}\n\n`));
    for (const frame of got) {
      const body = JSON.parse(frame.data) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toStrictEqual(['name', 'playerId', 'seq', 'type']);
      expect(frame.data).not.toMatch(/token|digest/i);
    }
    expect(got.map((f) => (JSON.parse(f.data) as { name: string }).name)).toStrictEqual(['Ana', 'Bea', 'Cy']);
  });

  it('FR-376 (stream) a subscriber that connects after three joins and sends Last-Event-ID 0 replays the lobby, and one in the middle gets the rest', async () => {
    const h = await begin();
    const { matchId } = lobbyOf(h);
    for (const name of ['Ana', 'Bea', 'Cy']) await joinOver(h, matchId, name);
    const all = stored(h, matchId, 0);
    expect(all.map((e) => e.seq)).toStrictEqual([1, 2, 3, 4]);
    const whole = await open(h, matchId, { 'last-event-id': '0' });
    const got = await whole.takeEvents(4);
    expect(got.map((f) => f.id)).toStrictEqual([1, 2, 3, 4]);
    expect(got.map((f) => f.data)).toStrictEqual(all.map((e) => encodeEvent(e)));
    const middle = await open(h, matchId, { 'last-event-id': '2' });
    const rest = await middle.takeEvents(2);
    expect(rest.map((f) => f.id)).toStrictEqual([3, 4]);
    expect(rest.map((f) => f.data)).toStrictEqual(all.slice(2).map((e) => encodeEvent(e)));
    // Nothing more is sent to either until a new event exists.
    expect(middle.raw()).toBe(rest.map((f) => f.raw).join(''));
    await joinOver(h, matchId, 'Dee');
    const next = await middle.takeEvents(1);
    expect(next[0]?.id).toBe(5);
    expect((await whole.takeEvents(1))[0]?.id).toBe(5);
  });

  it('FR-376 (stream) the heartbeat of 008 reaches a lobby stream, and the anonymous stream limit applies to it', async () => {
    const h = await startServer({
      routes: productionRoutes,
      service: { publicCreation: { maps: ['dev'], maxOpenLobbies: 10 } },
      limits: { commands: 100_000, reads: 100_000, anonymous: 100_000, anonymousStreams: 2 },
    });
    const { matchId } = lobbyOf(h);
    const first = await open(h, matchId);
    const second = await open(h, matchId);
    h.scheduler.runTo(START_MS + HEARTBEAT_MS);
    const beat = await first.next();
    expect(beat).toMatchObject({ kind: 'comment', raw: HEARTBEAT_FRAME });
    expect((await second.next()).kind).toBe('comment');
    const refused = await request(h.port, { path: `/matches/${matchId}/events` });
    expect([refused.status, refused.headers['retry-after']]).toStrictEqual([429, '15']);
  });
});

describe('lobby stream: the start and the expiry', () => {
  it('FR-376 (stream) the start event follows the joins in the same story, with the next stored number', async () => {
    const h = await begin();
    const { matchId, hostToken } = lobbyOf(h);
    const reader = await open(h, matchId);
    await joinOver(h, matchId, 'Ana');
    await joinOver(h, matchId, 'Bea');
    const started = await request(h.port, { method: 'POST', path: `/matches/${matchId}/start`, body: {}, headers: { authorization: `Bearer ${hostToken}` } });
    expect(started.status).toBe(200);
    const events = stored(h, matchId, 1);
    expect(events.map((e) => e.type)).toStrictEqual(['player-joined', 'player-joined', 'schedule']);
    const got = await reader.takeEvents(3);
    expect(got.map((f) => f.id)).toStrictEqual([2, 3, 4]);
    expect(got.map((f) => f.data)).toStrictEqual(events.map((e) => encodeEvent(e)));
    expect(JSON.parse(got[2]!.data)).toMatchObject({ type: 'schedule', stage: 'phase-1' });
  });

  it('FR-376 (stream) the expiry event ends the lobby story after the joins: a late subscriber replays them and the expired schedule', async () => {
    const h = await begin();
    const { matchId } = lobbyOf(h);
    const reader = await open(h, matchId);
    await joinOver(h, matchId, 'Ana');
    h.base.scheduler!.runTo(START_MS + 3_600_000);
    expect(h.base.store.getMatch(matchId)!.match.stage).toBe('expired');
    const events = stored(h, matchId, 1);
    expect(events.map((e) => e.type)).toStrictEqual(['player-joined', 'schedule']);
    const got = await reader.takeEvents(2);
    expect(got.map((f) => f.data)).toStrictEqual(events.map((e) => encodeEvent(e)));
    expect(JSON.parse(got[1]!.data)).toMatchObject({ type: 'schedule', stage: 'expired' });
    const late = await open(h, matchId, { 'last-event-id': '0' });
    const replay = await late.takeEvents(3);
    expect(replay.map((f) => f.id)).toStrictEqual([1, 2, 3]);
  });
});
