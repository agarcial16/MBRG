import type { LeaderboardRow, MatchEvent } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { PREDICT_ID, START_ID } from '../src/core/custom-ids';
import { componentsOf } from '../src/discord/translate';
import { buildAnnouncement, closedMessage, closesPhase, countdownMessage, needOf, openPhaseSeconds } from '../src/core/announce';
import { nameBook } from '../src/core/names';
import { emptyState, follow, followedOf, lastOf, parseState, retire, serializeState, unfollow } from '../src/core/state';
import type { Followed } from '../src/core/state';

const HOST = 'h'.repeat(24);
const entry = (over: Partial<Followed> = {}): Followed => ({ matchId: 'm1', mapId: 'europe', hostToken: HOST, lastSeq: 1, appliedRounds: 0, forcedRound: 0, ...over });
const names = nameBook([{ id: 3, name: 'Francia' }]);
const hex = 'ab'.repeat(32);

describe('FR-464 and FR-465 the follow entry', () => {
  it('FR-464 the creator survives a round trip; an entry without it, or with the old phase lengths (an older file), still loads', () => {
    const state = follow(emptyState(), '100', entry({ creatorId: '4242' }));
    expect(parseState(serializeState(state))).toEqual(state);
    // The pace's phase lengths of an earlier version are read and dropped (FR-465 now uses the server's schedule).
    const withPhases = serializeState(state).replace('"creatorId"', '"phases": {"l1": 30, "l2": 5}, "creatorId"');
    expect(parseState(withPhases)).toEqual(state);
    const older = '{"version":1,"channels":{"100":{"matchId":"m1","mapId":"europe","hostToken":"' + HOST + '","lastSeq":1,"appliedRounds":0,"forcedRound":0}}}';
    expect(parseState(older)?.channels['100']).toEqual(entry());
    expect(followedOf(parseState(older) ?? emptyState(), '100')?.creatorId).toBeUndefined();
  });

  it('FR-464 a creator that is not a Discord id, a bad phase length or an unknown key refuses the file', () => {
    const good = serializeState(follow(emptyState(), '100', entry({ creatorId: '4242' })));
    expect(parseState(good.replace('"4242"', '"abc"'))).toBeUndefined();
    const old = good.replace('"creatorId"', '"phases": {"l1": 30, "l2": 5}, "creatorId"');
    expect(parseState(old.replace('"l1": 30', '"l1": 0'))).toBeUndefined();
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
  const schedule = (stage: 'phase-1' | 'phase-2' | 'locked', anchors?: { c1: number; c2: number; a: number }, reportedTime = 5_000): MatchEvent => ({
    type: 'schedule', seq: 2, stage, ...(anchors === undefined ? {} : { schedule: anchors }), reportedTime,
  });
  const reveal = (forced: boolean, c2: number | null = null, reportedTime = 9_000): MatchEvent => ({
    type: 'victim-revealed', seq: 3, round: 1, victim: 1, candidates: [3], living: [1, 3], revealedAt: 9, c2, a: null, ...(forced ? { forced: true as const } : {}), reportedTime,
  });
  const anchors = { c1: 35_500, c2: 60_000, a: 65_000 };

  it('FR-465 the seconds are the anchor minus the reported time (phase 1: C1, phase 2: C2); a forced reveal and any other event have none', () => {
    expect(openPhaseSeconds(schedule('phase-1', anchors, 5_000))).toBe(31);
    expect(openPhaseSeconds(reveal(false, 20_000, 9_000))).toBe(11);
    expect(openPhaseSeconds(reveal(true, 20_000))).toBeUndefined();
    expect(openPhaseSeconds(schedule('phase-2', anchors))).toBeUndefined();
    expect(openPhaseSeconds(schedule('phase-1'))).toBeUndefined();
    expect(openPhaseSeconds(reveal(false, null))).toBeUndefined();
    expect(openPhaseSeconds(schedule('phase-1', anchors, 35_500))).toBeUndefined();
  });

  it('FR-465 only the label of the Predict button carries the seconds; the text and the other buttons stay', () => {
    const link = { type: 'link' as const, url: 'https://v.example/', label: 'Ver' };
    const predict = { type: 'custom' as const, customId: PREDICT_ID, label: 'Predecir', style: 'primary' as const };
    const other = { type: 'custom' as const, customId: START_ID, label: 'x', style: 'success' as const };
    const base = { text: 'Ronda 1 abierta.', buttons: [predict, link, other] };
    expect(countdownMessage(base, 8)).toEqual({ text: 'Ronda 1 abierta.', buttons: [{ ...predict, label: 'Predecir · 8 s' }, link, other] });
  });

  it('FR-465 the closed message disables only the Predict button and keeps the link; the translation sends disabled', () => {
    const link = { type: 'link' as const, url: 'https://v.example/', label: 'Ver' };
    const predict = { type: 'custom' as const, customId: PREDICT_ID, label: 'Predecir · 3 s', style: 'primary' as const };
    const closed = closedMessage({ text: 'Ronda 1 abierta.', buttons: [predict, link] });
    expect(closed).toEqual({ text: 'Ronda 1 abierta.', buttons: [{ ...predict, label: 'Predecir · cerrado', disabled: true }, link] });
    const row = componentsOf(closed.buttons)[0]?.components;
    expect(row?.[0]).toMatchObject({ custom_id: PREDICT_ID, disabled: true });
    expect(row?.[1]).not.toHaveProperty('disabled');
    expect(componentsOf([predict])[0]?.components[0]).not.toHaveProperty('disabled');
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
