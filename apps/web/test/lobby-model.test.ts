import { describe, expect, it } from 'vitest';
import { encodeEvent, type PlayerListItem, type PublicMatch } from '@mbrg/protocol';
import { afterJoin, emptyLobby, lobbyAfterFrame, lobbyAfterPlayers, lobbyStageOf, lobbyView } from '../src/core/lobby-model';
import { STRINGS } from '../src/core/strings';
import { publicAt, scripted } from './helpers/scripted-match';

const ANA = 'player:Ab3_x-9.Qz1k';
const BEA = 'player:Zy9_x-9.Qz1k';
const joined = (seq: number, playerId: string, name: string): unknown => JSON.parse(encodeEvent({ type: 'player-joined', seq, playerId, name })) as unknown;
const item = (playerId: string, name: string, joinedSeq: number): PlayerListItem => ({ playerId, name, joinedSeq });

describe('FR-400 a player-joined event adds the player and is never a fault', () => {
  it('FR-400 a player-joined frame adds the name to the list', () => {
    const next = lobbyAfterFrame(emptyLobby, joined(1, ANA, 'Ana'));
    expect(next.outcome).toBe('joined');
    expect(next.model.players).toStrictEqual([item(ANA, 'Ana', 1)]);
    expect(next.model.lastSeq).toBe(1);
  });

  it('FR-400 the same player twice (a replay after a reconnect) is listed once', () => {
    const once = lobbyAfterFrame(emptyLobby, joined(1, ANA, 'Ana')).model;
    const twice = lobbyAfterFrame(once, joined(1, ANA, 'Ana'));
    expect(twice.model.players).toHaveLength(1);
    expect(twice.outcome).toBe('ignored');
  });

  it('FR-400 the list stays in join order whatever the order the events and the read arrive in', () => {
    let model = lobbyAfterFrame(emptyLobby, joined(2, BEA, 'Bea')).model;
    model = lobbyAfterFrame(model, joined(1, ANA, 'Ana')).model;
    expect(model.players.map((p) => p.name)).toStrictEqual(['Ana', 'Bea']);
    const read = lobbyAfterPlayers(emptyLobby, [item(BEA, 'Bea', 2), item(ANA, 'Ana', 1)]);
    expect(read.players.map((p) => p.name)).toStrictEqual(['Ana', 'Bea']);
  });

  it('FR-398 the players read and the events merge without duplicates', () => {
    const fromRead = lobbyAfterPlayers(emptyLobby, [item(ANA, 'Ana', 1)]);
    const merged = lobbyAfterFrame(fromRead, joined(2, BEA, 'Bea')).model;
    expect(lobbyAfterPlayers(merged, [item(ANA, 'Ana', 1), item(BEA, 'Bea', 2)]).players).toHaveLength(2);
  });

  it('FR-400 a frame that is not an event, an unknown type or another known event leaves the list alone', () => {
    for (const data of [null, 'x', 7, {}, { type: 'player-joined', seq: 1 }, { type: 'nope', seq: 3 }, { type: 'phase-closed', seq: 3, round: 1, phase: 1, at: 5 }]) {
      const next = lobbyAfterFrame(emptyLobby, data);
      expect(next.model.players, JSON.stringify(data)).toStrictEqual([]);
      expect(next.outcome, JSON.stringify(data)).toBe('ignored');
    }
  });
});

describe('FR-399 FR-400 the lobby remembers how far the stream has been read', () => {
  it('FR-399 every known or unknown event moves the last number forward, and an old one never moves it back', () => {
    let model = lobbyAfterFrame(emptyLobby, joined(4, ANA, 'Ana')).model;
    expect(model.lastSeq).toBe(4);
    model = lobbyAfterFrame(model, { type: 'phase-closed', seq: 6, round: 1, phase: 1, at: 5 }).model;
    expect(model.lastSeq).toBe(6);
    model = lobbyAfterFrame(model, { type: 'nope', seq: 9 }).model;
    expect(model.lastSeq).toBe(9);
    expect(lobbyAfterFrame(model, joined(2, BEA, 'Bea')).model.lastSeq).toBe(9);
    expect(lobbyAfterFrame(model, 'garbage').model.lastSeq).toBe(9);
  });
});

describe('FR-399 the first schedule event leaves the lobby', () => {
  it('FR-399 a schedule event reports started, and a halted or finished match reports ended', () => {
    const schedule = JSON.parse(encodeEvent({ type: 'schedule', seq: 3, stage: 'phase-1', reportedTime: 1000 })) as unknown;
    expect(lobbyAfterFrame(emptyLobby, schedule).outcome).toBe('started');
    const halted = JSON.parse(encodeEvent({ type: 'match-halted', seq: 4, round: 1, reason: 'map-changed', reportedTime: 1001 })) as unknown;
    expect(lobbyAfterFrame(emptyLobby, halted).outcome).toBe('ended');
  });

  it('FR-399 the schedule event of a fresh lobby (stage lobby, seq 1, replayed from 0) does not close the lobby', () => {
    const frames = [
      JSON.parse(encodeEvent({ type: 'schedule', seq: 1, stage: 'lobby', reportedTime: 1000 })) as unknown,
      joined(2, ANA, 'Ana'),
    ];
    let model = emptyLobby;
    const outcomes: string[] = [];
    for (const f of frames) {
      const next = lobbyAfterFrame(model, f);
      model = next.model;
      outcomes.push(next.outcome);
    }
    expect(outcomes).toStrictEqual(['ignored', 'joined']);
    expect(model.lastSeq).toBe(2);
    expect(model.players).toHaveLength(1);
  });

  it('FR-399 a public read decides the stage: lobby stays, a running match leaves, expired and ended say so', async () => {
    const s = await scripted();
    expect(lobbyStageOf(publicAt(s, 0, { stage: 'lobby', playerCount: 0 }))).toBe('lobby');
    expect(lobbyStageOf(publicAt(s, 0, { stage: 'expired', playerCount: 0 }))).toBe('expired');
    // Only the stage matters to the decision: a bare object stands for the running stages (their public form needs a victim).
    for (const stage of ['phase-1', 'phase-2', 'locked'] as const) expect(lobbyStageOf({ stage } as PublicMatch), stage).toBe('running');
    expect(lobbyStageOf({ stage: 'halted' } as PublicMatch)).toBe('ended');
    expect(lobbyStageOf(publicAt(s, s.total))).toBe('ended');
  });
});

describe('FR-398 the lobby view', () => {
  const two = lobbyAfterPlayers(emptyLobby, [item(ANA, 'Ana', 1), item(BEA, 'Bea', 2)]);

  it('FR-398 the host with a player sees the count, the names and an enabled start', () => {
    expect(lobbyView(two, { host: true, publicCount: undefined })).toStrictEqual({ count: 2, names: ['Ana', 'Bea'], start: 'enabled' });
  });

  it('FR-398 the host with nobody joined sees a disabled start', () => {
    expect(lobbyView(emptyLobby, { host: true, publicCount: 0 })).toStrictEqual({ count: 0, names: [], start: 'disabled' });
  });

  it('FR-398 anyone but the host sees the wait for the host and no start', () => {
    expect(lobbyView(two, { host: false, publicCount: undefined }).start).toBe('waiting');
  });

  it('FR-398 the count never falls below the count the server published', () => {
    expect(lobbyView(emptyLobby, { host: false, publicCount: 3 }).count).toBe(3);
    expect(lobbyView(two, { host: false, publicCount: 1 }).count).toBe(2);
  });

  it('FR-398 the lobby view holds no round data', () => {
    expect(Object.keys(lobbyView(two, { host: true, publicCount: 2 })).sort()).toStrictEqual(['count', 'names', 'start']);
  });
});

describe('FR-400 joining a running match', () => {
  it('FR-400 a join in a lobby goes to the lobby; in a running match it goes to the match with the notice', () => {
    expect(afterJoin('lobby')).toStrictEqual({ screen: 'lobby', notice: undefined });
    for (const stage of ['phase-1', 'phase-2', 'locked'] as const) {
      expect(afterJoin(stage), stage).toStrictEqual({ screen: 'match', notice: STRINGS.joinLater });
    }
    expect(afterJoin('finished')).toStrictEqual({ screen: 'match', notice: undefined });
  });
});
