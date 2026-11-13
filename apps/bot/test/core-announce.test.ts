import type { LeaderboardRow, MatchEvent } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { advanceFollow, buildAnnouncement, endsFollowing, lobbyMessage, needOf, viewerLink } from '../src/core/announce';
import { START_ID, PREDICT_ID, parseCustomId, pickId, findId } from '../src/core/custom-ids';
import { nameBook, readFactionNames } from '../src/core/names';
import { boardMessages, summarizeWinners, userIdOf, winnersText } from '../src/core/results';
import { emptyState, follow, followedOf, parseState, serializeState, unfollow } from '../src/core/state';
import type { Followed } from '../src/core/state';

const HOST = 'h'.repeat(24);
const entry = (over: Partial<Followed> = {}): Followed => ({ matchId: 'm1', mapId: 'europe', hostToken: HOST, lastSeq: 1, appliedRounds: 0, forcedRound: 0, ...over });
const names = nameBook([
  { id: 1, name: 'Alemania' },
  { id: 2, name: 'España' },
  { id: 3, name: 'Francia' },
]);
const ctx = (over: Partial<Followed> = {}, viewerUrl?: string) => ({ follow: entry(over), names, ...(viewerUrl === undefined ? {} : { viewerUrl }) });
const hex = 'ab'.repeat(32);

const schedule = (stage: 'phase-1' | 'phase-2' | 'locked', seq = 2): MatchEvent => ({ type: 'schedule', seq, stage, reportedTime: 5 });
const revealed = (over: { forced?: true; candidates?: number[] } = {}): MatchEvent => ({
  type: 'victim-revealed', seq: 3, round: 2, victim: 1, candidates: over.candidates ?? [2, 3], living: [1, 2, 3], revealedAt: 9, c2: null, a: null,
  ...(over.forced === true ? { forced: true as const } : {}), reportedTime: 9,
});
const applied = (): MatchEvent => ({ type: 'round-applied', seq: 6, round: 2, record: { round: 2, eliminated: 1, absorber: 2, transferred: [4] }, stateDigest: hex, appliedAt: 9 });

describe('FR-453 event to message', () => {
  it('FR-453 round opened (phase 1) has ONE Predict button and the round number', () => {
    const out = buildAnnouncement(schedule('phase-1'), ctx({ appliedRounds: 1 }));
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toContain('Ronda 2');
    expect(out[0]?.buttons).toEqual([{ type: 'custom', customId: PREDICT_ID, label: 'Predecir', style: 'primary' }]);
  });

  it('FR-453 a schedule event of another stage says nothing', () => {
    expect(buildAnnouncement(schedule('phase-2'), ctx())).toEqual([]);
    expect(buildAnnouncement(schedule('locked'), ctx())).toEqual([]);
  });

  it('FR-453 victim revealed (phase 2) names the victim and offers ONE Predict button, never one per candidate', () => {
    const out = buildAnnouncement(revealed({ candidates: Array.from({ length: 40 }, (_, i) => i + 2) }), ctx());
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toContain('Alemania');
    expect(out[0]?.buttons.filter((b) => b.type === 'custom')).toHaveLength(1);
    expect(out[0]?.text).not.toContain('Francia');
  });

  it('FR-453 a forced absorber is announced as forced, with the absorber and no Predict button', () => {
    const out = buildAnnouncement(revealed({ forced: true, candidates: [3] }), ctx());
    expect(out[0]?.text).toContain('forzado');
    expect(out[0]?.text).toContain('Francia');
    expect(out[0]?.buttons).toEqual([]);
  });

  it('FR-453 round applied names victim, absorber and the factions left', () => {
    const out = buildAnnouncement(applied(), ctx(), { left: 5 });
    expect(out[0]?.text).toContain('Alemania');
    expect(out[0]?.text).toContain('España');
    expect(out[0]?.text).toContain('Quedan 5 facciones');
    expect(buildAnnouncement(applied(), ctx(), { left: 1 })[0]?.text).toContain('Queda 1 facción');
  });

  it('FR-453 match finished names the winner and never the match secret', () => {
    const event: MatchEvent = { type: 'match-finished', seq: 9, winner: 3, matchSecret: hex, rule: 'rule', reportedTime: 1 };
    const out = buildAnnouncement(event, ctx());
    expect(out[0]?.text).toContain('Francia');
    expect(JSON.stringify(out)).not.toContain(hex);
    expect(endsFollowing(event)).toBe(true);
    expect(endsFollowing(applied())).toBe(false);
  });

  it('FR-453 events the channel is not told about give no message', () => {
    const joined: MatchEvent = { type: 'player-joined', seq: 4, playerId: 'player:abc', name: 'Eva' };
    expect(buildAnnouncement(joined, ctx())).toEqual([]);
    expect(buildAnnouncement({ type: 'phase-closed', seq: 3, round: 1, phase: 1, at: 1 }, ctx())).toEqual([]);
  });

  it('FR-453 a faction without a name is shown by its number', () => {
    expect(names.nameOf(77)).toBe('Facción 77');
    expect(readFactionNames({ factions: [{ id: 1, name: 'A' }, { id: 'x', name: 'B' }, { id: 2 }], other: 1 })).toEqual([{ id: 1, name: 'A' }]);
    expect(readFactionNames(null)).toEqual([]);
  });
});

describe('FR-462 viewer link', () => {
  it('FR-462 builds the link from the configured address at the round', () => {
    expect(viewerLink('https://viewer.example/play', 'm1', 3)).toBe('https://viewer.example/play?match=m1&round=3');
    const out = buildAnnouncement(schedule('phase-1'), ctx({}, 'https://viewer.example/'));
    expect(out[0]?.buttons[1]).toEqual({ type: 'link', url: 'https://viewer.example/?match=m1&round=1', label: 'Ver en el visor' });
  });

  it('FR-462 posts no link when no address is configured or it is not an address', () => {
    expect(viewerLink(undefined, 'm1', 1)).toBeUndefined();
    expect(viewerLink('not an address', 'm1', 1)).toBeUndefined();
    expect(buildAnnouncement(schedule('phase-1'), ctx())[0]?.buttons.some((b) => b.type === 'link')).toBe(false);
    expect(buildAnnouncement(revealed(), ctx())[0]?.buttons.some((b) => b.type === 'link')).toBe(false);
  });
});

describe('FR-456 who guessed right', () => {
  const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `discord:${1000 + i}`);

  it('FR-456 up to ten mentions and no "more"', () => {
    const w = summarizeWinners(ids(10));
    expect(w.userIds).toHaveLength(10);
    expect(w.more).toBe(0);
    const text = winnersText(1, w);
    expect(text).toContain('<@1000>');
    expect(text).not.toContain('más');
  });

  it('FR-456 more than ten: ten mentions, then "y N más"', () => {
    const w = summarizeWinners(ids(13));
    expect(w.userIds).toHaveLength(10);
    expect(w.more).toBe(3);
    expect(winnersText(2, w)).toContain('y 3 más');
    expect(winnersText(2, w)).not.toContain('<@1010>');
  });

  it('FR-456 nobody right says so, and only discord players are mentioned', () => {
    expect(winnersText(1, summarizeWinners([]))).toBe('Nadie acertó la víctima.');
    expect(winnersText(2, summarizeWinners([]))).toBe('Nadie acertó el absorbente.');
    expect(summarizeWinners(['player:abc', 'other:12', 'discord:12a']).userIds).toEqual([]);
    expect(userIdOf('discord:42')).toBe('42');
  });

  it('FR-456 needs the winners of a scored phase only, and none for the phase 2 of a forced round', () => {
    const r1: MatchEvent = { type: 'results', seq: 5, round: 2, phase: 1 };
    const r2: MatchEvent = { type: 'results', seq: 8, round: 2, phase: 2 };
    expect(needOf(r1, entry())).toEqual({ type: 'winners', round: 2, phase: 1 });
    expect(needOf(r2, entry())).toEqual({ type: 'winners', round: 2, phase: 2 });
    expect(needOf(r2, entry({ forcedRound: 2 }))).toEqual({ type: 'none' });
    expect(needOf(r1, entry({ forcedRound: 2 }))).toEqual({ type: 'winners', round: 2, phase: 1 });
    expect(needOf(applied(), entry())).toEqual({ type: 'left', round: 2 });
    expect(needOf(schedule('phase-1'), entry())).toEqual({ type: 'none' });
    expect(buildAnnouncement(r1, ctx(), { winners: summarizeWinners(ids(2)) })[0]?.text).toContain('<@1001>');
  });
});

describe('FR-457 leaderboard text', () => {
  const row = (rank: number, playerId: string, total: number, name?: string): LeaderboardRow =>
    ({ rank, playerId, total, correctVictims: 0, correctAbsorbers: 0, correctWinner: 0, ...(name === undefined ? {} : { name }) });

  it('FR-457 lists rank, mention and points of the first ten', () => {
    const rows = Array.from({ length: 14 }, (_, i) => row(i + 1, `discord:${500 + i}`, 100 - i));
    const out = boardMessages(rows);
    const text = out.map((m) => m.text).join('\n');
    expect(text).toContain('1. <@500> - 100 pts');
    expect(text).toContain('10. <@509> - 91 pts');
    expect(text).not.toContain('<@510>');
  });

  it('FR-457 an empty board says so; a web player shows its name', () => {
    expect(boardMessages([])[0]?.text).toBe('Todavía no hay puntos.');
    expect(boardMessages([row(1, 'player:abc', 5, 'Eva')])[0]?.text).toContain('1. Eva - 5 pts');
  });
});

describe('FR-459 follow state', () => {
  it('FR-459 advancing records the event number, the applied rounds and the forced round', () => {
    const a = advanceFollow(entry(), applied());
    expect(a).toMatchObject({ lastSeq: 6, appliedRounds: 2 });
    const f = advanceFollow(entry(), revealed({ forced: true, candidates: [2] }));
    expect(f).toMatchObject({ lastSeq: 3, forcedRound: 2 });
    expect(advanceFollow(entry({ lastSeq: 9 }), schedule('phase-2', 4)).lastSeq).toBe(9);
    expect(advanceFollow(entry(), { type: 'unknown', seq: 7 }).lastSeq).toBe(7);
  });

  it('FR-459 the state survives a text round trip and refuses anything that is not exactly a state', () => {
    const state = follow(emptyState(), '123456789', entry({ lastSeq: 7 }));
    expect(parseState(serializeState(state))).toEqual(state);
    expect(parseState('nope')).toBeUndefined();
    expect(parseState('{"version":2,"channels":{}}')).toBeUndefined();
    expect(parseState('{"version":1,"channels":{"abc":{}}}')).toBeUndefined();
    const bad = serializeState(state).replace('"lastSeq": 7', '"lastSeq": -1');
    expect(parseState(bad)).toBeUndefined();
    expect(parseState(serializeState(emptyState()))).toEqual(emptyState());
  });

  it('NFR-89 a host token is kept only for a followed match', () => {
    const state = follow(emptyState(), '42', entry());
    expect(serializeState(state)).toContain(HOST);
    const after = unfollow(state, '42');
    expect(serializeState(after)).not.toContain(HOST);
    expect(followedOf(after, '42')).toBeUndefined();
    expect(followedOf(state, '__proto__')).toBeUndefined();
  });
});

describe('FR-451 lobby message and ids', () => {
  it('FR-451 the lobby message has the match name, the map and a Start button', () => {
    const m = lobbyMessage('abcd1234', 'europe');
    expect(m.text).toContain('abcd1234');
    expect(m.text).toContain('europe');
    expect(m.buttons).toEqual([{ type: 'custom', customId: START_ID, label: 'Iniciar', style: 'success' }]);
  });

  it('FR-454 custom ids round-trip and refuse anything else', () => {
    expect(parseCustomId(pickId('victim', 3))).toEqual({ type: 'pick', kind: 'victim', round: 3 });
    expect(parseCustomId(findId('absorber', 12))).toEqual({ type: 'find', kind: 'absorber', round: 12 });
    expect(parseCustomId(PREDICT_ID)).toEqual({ type: 'predict' });
    expect(parseCustomId(START_ID)).toEqual({ type: 'start' });
    expect(parseCustomId('mbrg:pick:winner:3')).toBeUndefined();
    expect(parseCustomId('mbrg:pick:victim:0')).toBeUndefined();
    expect(parseCustomId('other')).toBeUndefined();
  });
});
