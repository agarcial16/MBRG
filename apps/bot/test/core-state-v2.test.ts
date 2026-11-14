import type { LeaderboardRow, MatchEvent } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { START_ID } from '../src/core/custom-ids';
import { buildAnnouncement, closesPhase, countdownMessage, needOf, openPhaseSeconds } from '../src/core/announce';
import { nameBook } from '../src/core/names';
import { emptyState, follow, followedOf, lastOf, parseState, retire, serializeState, unfollow } from '../src/core/state';
import type { Followed } from '../src/core/state';

const HOST = 'h'.repeat(24);
const entry = (over: Partial<Followed> = {}): Followed => ({ matchId: 'm1', mapId: 'europe', hostToken: HOST, lastSeq: 1, appliedRounds: 0, forcedRound: 0, ...over });
const names = nameBook([{ id: 3, name: 'Francia' }]);
const hex = 'ab'.repeat(32);

describe('FR-464 and FR-465 the follow entry', () => {
  it('FR-464 the creator and the phase lengths survive a round trip; an entry without them (an older file) still loads', () => {
    const state = follow(emptyState(), '100', entry({ creatorId: '4242', phases: { l1: 30, l2: 5 } }));
    expect(parseState(serializeState(state))).toEqual(state);
    const older = '{"version":1,"channels":{"100":{"matchId":"m1","mapId":"europe","hostToken":"' + HOST + '","lastSeq":1,"appliedRounds":0,"forcedRound":0}}}';
    expect(parseState(older)?.channels['100']).toEqual(entry());
    expect(followedOf(parseState(older) ?? emptyState(), '100')?.creatorId).toBeUndefined();
  });

  it('FR-464 a creator that is not a Discord id, a bad phase length or an unknown key refuses the file', () => {
    const good = serializeState(follow(emptyState(), '100', entry({ creatorId: '4242', phases: { l1: 30, l2: 5 } })));
    expect(parseState(good.replace('"4242"', '"abc"'))).toBeUndefined();
    expect(parseState(good.replace('"l1": 30', '"l1": 0'))).toBeUndefined();
    expect(parseState(good.replace('"creatorId"', '"other"'))).toBeUndefined();
  });
});

describe('FR-466 last match in the state', () => {
  it('FR-466 retiring a followed match keeps its id and map and drops the host token; following again replaces it', () => {
    const followed = follow(emptyState(), '100', entry());
    const kept = retire(followed, '100');
    expect(followedOf(kept, '100')).toBeUndefined();
    expect(lastOf(kept, '100')).toEqual({ matchId: 'm1', mapId: 'europe' });
    expect(serializeState(kept)).not.toContain(HOST);
    expect(parseState(serializeState(kept))).toEqual(kept);
    expect(lastOf(follow(kept, '100', entry({ matchId: 'm2' })), '100')).toBeUndefined();
    expect(lastOf(kept, '200')).toBeUndefined();
    expect(retire(emptyState(), '100')).toEqual(emptyState());
    // Unfollowing leaves the other channels' last matches alone.
    expect(lastOf(unfollow(follow(kept, '200', entry()), '200'), '100')).toEqual({ matchId: 'm1', mapId: 'europe' });
  });

  it('FR-466 a last match with extra or bad fields refuses the file', () => {
    const kept = serializeState(retire(follow(emptyState(), '100', entry()), '100'));
    expect(parseState(kept.replace('"mapId": "europe"', '"mapId": "Europe!"'))).toBeUndefined();
    expect(parseState(kept.replace('"last"', '"lost"'))).toBeUndefined();
  });
});

describe('FR-465 countdown texts', () => {
  const schedule = (stage: 'phase-1' | 'phase-2' | 'locked'): MatchEvent => ({ type: 'schedule', seq: 2, stage, reportedTime: 5 });
  const reveal = (forced: boolean): MatchEvent => ({
    type: 'victim-revealed', seq: 3, round: 1, victim: 1, candidates: [3], living: [1, 3], revealedAt: 9, c2: null, a: null, ...(forced ? { forced: true as const } : {}), reportedTime: 9,
  });
  const phases = { phases: { l1: 30, l2: 7 } };

  it('FR-465 phase 1 counts from its length and phase 2 from its own; a forced reveal and any other event have no countdown', () => {
    expect(openPhaseSeconds(schedule('phase-1'), entry(phases))).toBe(30);
    expect(openPhaseSeconds(reveal(false), entry(phases))).toBe(7);
    expect(openPhaseSeconds(reveal(true), entry(phases))).toBeUndefined();
    expect(openPhaseSeconds(schedule('phase-2'), entry(phases))).toBeUndefined();
    expect(openPhaseSeconds(schedule('phase-1'), entry())).toBeUndefined();
  });

  it('FR-465 only the seconds are added to the text, the buttons stay', () => {
    const base = { text: 'Ronda 1 abierta.', buttons: [{ type: 'custom' as const, customId: START_ID, label: 'x', style: 'primary' as const }] };
    expect(countdownMessage(base, 25)).toEqual({ text: 'Ronda 1 abierta.\nQuedan unos 25 s.', buttons: base.buttons });
  });

  it('FR-465 the events that end an open phase stop its countdown; results and joins do not', () => {
    expect(closesPhase({ type: 'phase-closed', seq: 4, round: 1, phase: 1, at: 1 })).toBe(true);
    expect(closesPhase(reveal(false))).toBe(true);
    expect(closesPhase(schedule('phase-1'))).toBe(true);
    expect(closesPhase(schedule('phase-2'))).toBe(false);
    expect(closesPhase({ type: 'results', seq: 5, round: 1, phase: 1 })).toBe(false);
    expect(closesPhase({ type: 'player-joined', seq: 6, playerId: 'player:abc', name: 'Eva' })).toBe(false);
  });
});

describe('FR-467 final leaderboard text', () => {
  const finished: MatchEvent = { type: 'match-finished', seq: 9, winner: 3, matchSecret: hex, rule: 'rule', reportedTime: 1 };
  const row = (rank: number): LeaderboardRow => ({ rank, playerId: `discord:${700 + rank}`, total: 20 - rank, correctVictims: 0, correctAbsorbers: 0, correctWinner: 0 });
  const ctx = { follow: entry(), names };

  it('FR-467 a finished match asks for the board and posts the winner, then the first ten rows', () => {
    expect(needOf(finished, entry())).toEqual({ type: 'board' });
    const out = buildAnnouncement(finished, ctx, { board: Array.from({ length: 12 }, (_, i) => row(i + 1)) });
    expect(out[0]?.text).toContain('Francia');
    const board = out.slice(1).map((m) => m.text).join('\n');
    expect(board).toContain('1. <@701> - 19 pts');
    expect(board).toContain('10. <@710> - 10 pts');
    expect(board).not.toContain('<@711>');
    expect(JSON.stringify(out)).not.toContain(hex);
  });

  it('FR-467 with no points at all only the winner is posted', () => {
    expect(buildAnnouncement(finished, ctx, { board: [] })).toHaveLength(1);
    expect(buildAnnouncement(finished, ctx)).toHaveLength(1);
  });
});
