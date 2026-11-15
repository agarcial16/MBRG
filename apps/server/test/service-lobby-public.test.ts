import { errorReply, roundNotApplied } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { LOBBY_RETENTION_MS } from '../src/store/store';
import { CLOCK_TIMING, OPERATOR, START_MS, creationBody, serviceHarness } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// The public data of a lobby, at service level (spec 011 M5 T5): stage, map, timing and the player count and the names, and
// nothing of a round. Round-0 state only; the 008 fields appear at the start; an expired lobby keeps its players until the
// record is removed. Expected member lists are literals.

const HOUR = 3_600_000;
const publicHarness = (hours = 1): Harness => serviceHarness({ publicCreation: { maps: ['dev'], lobbyExpiryHours: hours } });

const lobbyWithThree = (h: Harness): { matchId: string; hostToken: string; players: { playerId: string; name: string }[] } => {
  const out = h.service.createPublic({ source: 'src-host', body: creationBody('c-1') });
  if (!out.ok) throw new Error('public creation failed');
  const players = ['Zed', 'Amy', 'Bob'].map((name, i) => {
    const joined = h.service.join({ source: 'src-a', matchId: out.reply.matchId, body: { name, requestId: `j-${i}` } });
    if (!joined.ok) throw new Error('join failed');
    return { playerId: joined.reply.playerId, name };
  });
  return { matchId: out.reply.matchId, hostToken: out.reply.hostToken, players };
};
const viewOf = (h: Harness, id: string) => {
  const out = h.service.readPublicMatch(id);
  if (!out.ok) throw new Error('no public data');
  return out.reply;
};

const LOBBY_KEYS = ['matchId', 'mapId', 'mapDigest', 'totalRounds', 'timing', 'commitment', 'stage', 'appliedRounds', 'state', 'stateDigest', 'lastSeq', 'reportedTime', 'playerCount'];
const RUNNING_008_KEYS = ['matchId', 'mapId', 'mapDigest', 'totalRounds', 'timing', 'commitment', 'stage', 'appliedRounds', 'state', 'stateDigest', 'lastSeq', 'reportedTime', 'schedule'];

describe('the public data of a lobby', () => {
  it('FR-373 a lobby with three players shows its stage, map, timing and player count, and no member of a round', () => {
    const h = publicHarness();
    const { matchId } = lobbyWithThree(h);
    const view = viewOf(h, matchId);
    expect(Object.keys(view)).toStrictEqual(LOBBY_KEYS);
    expect(view).toMatchObject({ stage: 'lobby', mapId: 'dev', timing: CLOCK_TIMING, playerCount: 3, appliedRounds: 0 });
    for (const forbidden of ['schedule', 'victim', 'winner', 'matchSecret', 'haltReason', 'results']) expect(view, forbidden).not.toHaveProperty(forbidden);
    // The state is the round-0 state, the one any reader may fetch.
    const zero = h.service.stateAt(matchId, 0);
    expect(zero.ok && zero.reply.owners).toStrictEqual(view.state.owners);
    expect(zero.ok && zero.reply.stateDigest).toBe(view.stateDigest);
    h.close();
  });

  it('FR-373 the players list shows the three names in join order, and nothing of a round can be read from a lobby', () => {
    const h = publicHarness();
    const { matchId, players } = lobbyWithThree(h);
    const list = h.service.players(matchId, { limit: 500 });
    expect(list.ok && list.reply.items.map((i) => [i.playerId, i.name])).toStrictEqual(players.map((p) => [p.playerId, p.name]));
    expect(list.ok && list.reply.items.map((i) => i.joinedSeq)).toStrictEqual([2, 3, 4]);
    const none = { ok: false, error: roundNotApplied(0) };
    expect(h.service.stateAt(matchId, 1)).toStrictEqual(none);
    expect(h.service.recordAt(matchId, 1)).toStrictEqual(none);
    for (const phase of [1, 2] as const) {
      expect(h.service.phaseResults(matchId, 1, phase, { limit: 10 })).toStrictEqual(none);
      expect(h.service.phaseWinners(matchId, 1, phase, { limit: 10 })).toStrictEqual(none);
    }
    const records = h.service.records(matchId, { limit: 10 });
    expect(records.ok && records.reply.items).toStrictEqual([]);
    const board = h.service.leaderboard(matchId, { limit: 10 });
    expect(board.ok && board.reply.items).toStrictEqual([]);
    h.close();
  });

  it('FR-373 the events of a lobby are the schedule event of the lobby and the joins: no results and no victim-revealed event', () => {
    const h = publicHarness();
    const { matchId, players } = lobbyWithThree(h);
    const read = h.service.eventsAfter(matchId, 0);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.reply.events.map((e) => e.type)).toStrictEqual(['schedule', 'player-joined', 'player-joined', 'player-joined']);
    expect(read.reply.events[0]).toMatchObject({ seq: 1, stage: 'lobby' });
    expect(read.reply.events.slice(1)).toMatchObject(players.map((p, i) => ({ seq: i + 2, playerId: p.playerId, name: p.name })));
    expect(JSON.stringify(read.reply.events)).not.toMatch(/results|victim-revealed|phase-closed|record/);
    h.close();
  });

  it('FR-373 after the start the lobby fields stay or go as the plan says: the count stays (players exist), the 008 fields appear', () => {
    const h = publicHarness();
    const { matchId, hostToken } = lobbyWithThree(h);
    const started = h.service.startMatch({ credential: hostToken, matchId, body: {} });
    expect(started.ok).toBe(true);
    const view = viewOf(h, matchId);
    expect(Object.keys(view).sort()).toStrictEqual([...RUNNING_008_KEYS, 'playerCount'].sort());
    expect(view).toMatchObject({ stage: 'phase-1', playerCount: 3, appliedRounds: 0 });
    expect(Object.keys(view.schedule!)).toStrictEqual(['c1', 'c2', 'a']);
    expect(view.schedule!.c1).toBeGreaterThan(START_MS);
    expect(view).not.toHaveProperty('victim');
    h.close();
  });

  it('FR-373 an expired lobby shows the stage expired and its count, keeps its players list until the record is removed, then it is unknown', () => {
    const h = publicHarness(1);
    const { matchId, players } = lobbyWithThree(h);
    h.clock.set(START_MS + HOUR);
    h.service.tick();
    const view = viewOf(h, matchId);
    expect(view).toMatchObject({ stage: 'expired', playerCount: 3 });
    expect(Object.keys(view)).toStrictEqual(LOBBY_KEYS);
    const list = h.service.players(matchId, { limit: 500 });
    expect(list.ok && list.reply.items.map((i) => i.name)).toStrictEqual(players.map((p) => p.name));
    h.clock.set(START_MS + HOUR + LOBBY_RETENTION_MS);
    h.service.tick();
    expect(viewOf(h, matchId).stage).toBe('expired');
    h.clock.set(START_MS + HOUR + LOBBY_RETENTION_MS + 1);
    h.service.tick();
    expect(h.service.readPublicMatch(matchId)).toStrictEqual({ ok: false, error: errorReply('unknown-match') });
    expect(h.service.players(matchId, { limit: 500 })).toStrictEqual({ ok: false, error: errorReply('unknown-match') });
    h.close();
  });

  it('FR-373 the match list includes the lobby with stage lobby and the six summary fields only: no player data', () => {
    const h = publicHarness();
    const { matchId } = lobbyWithThree(h);
    const list = h.service.listMatches({ limit: 500 });
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.reply.items).toStrictEqual([{ matchId, mapId: 'dev', stage: 'lobby', appliedRounds: 0, totalRounds: expect.any(Number), createdAt: START_MS }]);
    expect(Object.keys(list.reply.items[0]!)).toStrictEqual(['matchId', 'mapId', 'stage', 'appliedRounds', 'totalRounds', 'createdAt']);
    h.close();
  });

  it('FR-373 a running match with no players has no player count (the 008 bytes), and it appears with the first join', () => {
    const h = publicHarness();
    const made = h.service.create({ credential: OPERATOR, body: creationBody('c-op') });
    if (!made.ok) throw new Error('creation failed');
    const id = made.reply.matchId;
    expect(Object.keys(viewOf(h, id))).toStrictEqual(RUNNING_008_KEYS);
    expect(viewOf(h, id)).not.toHaveProperty('playerCount');
    const joined = h.service.join({ source: 'src-a', matchId: id, body: { name: 'Ana', requestId: 'j-1' } });
    expect(joined.ok).toBe(true);
    expect(viewOf(h, id)).toMatchObject({ playerCount: 1 });
    h.close();
  });
});
