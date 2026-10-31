import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  LEADERBOARD_ROW_KEYS,
  PHASE_RESULTS_PAGE_KEYS,
  PHASE_RESULT_KEYS,
  PHASE_WINNERS_PAGE_KEYS,
  PHASE_WINNER_KEYS,
  PLAYER_RESULTS_PAGE_KEYS,
  PLAYER_RESULT_KEYS,
  encodeCursor,
  encodeLeaderboardRow,
  encodePage,
  encodePhaseResults,
  encodePhaseWinners,
  encodePlayerResults,
  isPlayerId,
  decodeCursor,
  type LeaderboardRow,
  type PhaseResultsPage,
  type PhaseWinnersPage,
  type PlayerResultsPage,
} from '../src/index';

// The results replies (FR-257 (results encoders), FR-279 (results lists)): fixed key order, absent members omitted.

const reverse = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).reverse()) as T;
const record = { round: 3, eliminated: 4, absorber: 2, transferred: [10, 11] };

const phase1: PhaseResultsPage = {
  round: 3,
  phase: 1,
  victim: 4,
  items: [
    { playerId: 'web:p1', choice: 4, correct: true, points: 5 },
    { playerId: 'discord:p2', choice: 2, correct: false, points: 0 },
  ],
  next: 'abc',
};
const phase2: PhaseResultsPage = { round: 3, phase: 2, record, items: [{ playerId: 'web:p1', choice: 2, correct: true, points: 3 }] };

describe('FR-257 (results encoders) the phase results page', () => {
  it('FR-257 (results encoders) writes round, phase, victim, items and next in the fixed order whatever the input order', () => {
    expect([...PHASE_RESULTS_PAGE_KEYS]).toStrictEqual(['round', 'phase', 'victim', 'record', 'items', 'next']);
    expect([...PHASE_RESULT_KEYS]).toStrictEqual(['playerId', 'choice', 'correct', 'points', 'name']);
    const text = encodePhaseResults(phase1);
    expect(text).toBe(
      '{"round":3,"phase":1,"victim":4,"items":[{"playerId":"web:p1","choice":4,"correct":true,"points":5},' +
        '{"playerId":"discord:p2","choice":2,"correct":false,"points":0}],"next":"abc"}',
    );
    const shuffled = reverse({ ...phase1, items: phase1.items.map((i) => reverse(i)) });
    expect(encodePhaseResults(shuffled)).toBe(text);
    expect(JSON.parse(text)).toStrictEqual(phase1);
  });

  it('FR-257 (results encoders) victim is present exactly for phase 1 and record exactly for phase 2', () => {
    expect(encodePhaseResults(phase2)).toBe(
      '{"round":3,"phase":2,"record":{"round":3,"eliminated":4,"absorber":2,"transferred":[10,11]},' +
        '"items":[{"playerId":"web:p1","choice":2,"correct":true,"points":3}]}',
    );
    expect(() => encodePhaseResults({ ...phase1, record } as never)).toThrow(RangeError);
    expect(() => encodePhaseResults({ ...phase2, victim: 4 } as never)).toThrow(RangeError);
    const { victim: _v, ...noVictim } = phase1;
    expect(() => encodePhaseResults(noVictim as never)).toThrow(RangeError);
    const { record: _r, ...noRecord } = phase2;
    expect(() => encodePhaseResults(noRecord as never)).toThrow(RangeError);
    // The record is the record of the page's round.
    expect(() => encodePhaseResults({ ...phase2, record: { ...record, round: 2 } })).toThrow(RangeError);
  });

  it('FR-257 (results encoders) next is written exactly when present and an empty page is valid', () => {
    const { next: _n, ...last } = phase1;
    expect(encodePhaseResults(last)).not.toContain('next');
    expect(encodePhaseResults({ ...last, items: [] })).toBe('{"round":3,"phase":1,"victim":4,"items":[]}');
    expect(encodePhaseResults({ ...last, next: undefined })).not.toContain('next');
    expect(() => encodePhaseResults({ ...phase1, next: '' })).toThrow(RangeError);
    expect(() => encodePhaseResults({ ...phase1, next: null } as never)).toThrow(RangeError);
  });

  it('FR-257 (results encoders) refuses an extra, inherited or null member and a value out of shape', () => {
    expect(() => encodePhaseResults({ ...phase1, extra: 1 } as never)).toThrow(RangeError);
    expect(() => encodePhaseResults({ ...phase1, items: [{ ...phase1.items[0]!, x: 1 }] } as never)).toThrow(RangeError);
    expect(() => encodePhaseResults({ ...phase1, victim: null } as never)).toThrow(RangeError);
    expect(() => encodePhaseResults({ ...phase1, items: [{ ...phase1.items[0]!, points: null }] } as never)).toThrow(RangeError);
    const inheritedNext = Object.assign(Object.create({ next: 'zz' }), { round: 3, phase: 1, victim: 4, items: [] });
    expect(() => encodePhaseResults(inheritedNext)).toThrow(RangeError);
    const inheritedItem = Object.assign(Object.create({ points: 1 }), { playerId: 'web:p1', choice: 4, correct: false });
    expect(() => encodePhaseResults({ ...phase1, items: [inheritedItem] })).toThrow(RangeError);
    for (const bad of ['yes', 1, 0, null, undefined]) {
      expect(() => encodePhaseResults({ ...phase1, items: [{ ...phase1.items[0]!, correct: bad }] } as never), String(bad)).toThrow(RangeError);
    }
    for (const bad of [-1, 1.5, '3', Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => encodePhaseResults({ ...phase1, items: [{ ...phase1.items[0]!, points: bad }] } as never), String(bad)).toThrow(RangeError);
    }
    // A wrong choice is worth nothing; a malformed player id, a phase outside 1 and 2, a round below 1 are refused.
    expect(() => encodePhaseResults({ ...phase1, items: [{ playerId: 'web:p1', choice: 2, correct: false, points: 3 }] })).toThrow(RangeError);
    expect(() => encodePhaseResults({ ...phase1, items: [{ ...phase1.items[0]!, playerId: 'p1' }] })).toThrow(RangeError);
    expect(() => encodePhaseResults({ ...phase1, items: [{ ...phase1.items[0]!, choice: 0 }] })).toThrow(RangeError);
    expect(() => encodePhaseResults({ ...phase1, phase: 3 } as never)).toThrow(RangeError);
    expect(() => encodePhaseResults({ ...phase1, round: 0 })).toThrow(RangeError);
    expect(() => encodePhaseResults(null as never)).toThrow(RangeError);
  });
});

const playerPage: PlayerResultsPage = {
  playerId: 'web:p1',
  total: 8,
  items: [
    { kind: 'absorber', round: 2, choice: 3, correct: true, points: 3 },
    { kind: 'victim', round: 2, choice: 5, correct: false, points: 0 },
    { kind: 'winner', choice: 4, correct: true, points: 5 },
  ],
  next: 'zz',
};

describe('FR-257 (results encoders) the player results page', () => {
  it('FR-257 (results encoders) writes playerId, total, items and next; round is absent exactly for a winner item', () => {
    expect([...PLAYER_RESULTS_PAGE_KEYS]).toStrictEqual(['playerId', 'total', 'items', 'next', 'name']);
    expect([...PLAYER_RESULT_KEYS]).toStrictEqual(['kind', 'round', 'choice', 'correct', 'points']);
    const text = encodePlayerResults(playerPage);
    expect(text).toBe(
      '{"playerId":"web:p1","total":8,"items":[{"kind":"absorber","round":2,"choice":3,"correct":true,"points":3},' +
        '{"kind":"victim","round":2,"choice":5,"correct":false,"points":0},' +
        '{"kind":"winner","choice":4,"correct":true,"points":5}],"next":"zz"}',
    );
    expect(encodePlayerResults(reverse({ ...playerPage, items: playerPage.items.map((i) => reverse(i)) }))).toBe(text);
    const { next: _n, ...last } = playerPage;
    expect(encodePlayerResults(last)).toBe(text.replace(',"next":"zz"', ''));
    expect(encodePlayerResults({ playerId: 'web:nobody', total: 0, items: [] })).toBe('{"playerId":"web:nobody","total":0,"items":[]}');
    // The round is required for victim and absorber, refused for the winner.
    expect(() => encodePlayerResults({ ...last, items: [{ kind: 'victim', choice: 5, correct: false, points: 0 }] })).toThrow(RangeError);
    expect(() => encodePlayerResults({ ...last, items: [{ kind: 'winner', round: 1, choice: 4, correct: true, points: 5 }] } as never)).toThrow(RangeError);
    expect(() => encodePlayerResults({ ...last, items: [{ kind: 'loser', choice: 4, correct: true, points: 5 }] } as never)).toThrow(RangeError);
  });

  it('FR-257 (results encoders) refuses an extra, inherited or null member, a bad total and a bad correct flag', () => {
    expect(() => encodePlayerResults({ ...playerPage, extra: 1 } as never)).toThrow(RangeError);
    expect(() => encodePlayerResults({ ...playerPage, total: null } as never)).toThrow(RangeError);
    for (const bad of [-1, 0.5, '8']) expect(() => encodePlayerResults({ ...playerPage, total: bad } as never), String(bad)).toThrow(RangeError);
    expect(() => encodePlayerResults({ ...playerPage, playerId: 'p1' })).toThrow(RangeError);
    const inherited = Object.assign(Object.create({ total: 4 }), { playerId: 'web:p1', items: [] });
    expect(() => encodePlayerResults(inherited)).toThrow(RangeError);
    expect(() => encodePlayerResults({ ...playerPage, items: [{ ...playerPage.items[0]!, correct: 'true' }] } as never)).toThrow(RangeError);
    expect(() => encodePlayerResults({ ...playerPage, items: [{ ...playerPage.items[0]!, points: -3 }] })).toThrow(RangeError);
    expect(() => encodePlayerResults({ ...playerPage, items: [{ ...playerPage.items[0]!, round: null }] } as never)).toThrow(RangeError);
    expect(() => encodePlayerResults({ ...playerPage, items: [{ ...playerPage.items[0]!, extra: 1 }] } as never)).toThrow(RangeError);
  });
});

const row: LeaderboardRow = { rank: 1, playerId: 'web:p1', total: 12, correctVictims: 2, correctAbsorbers: 1, correctWinner: 1 };

describe('FR-257 (results encoders) the leaderboard row', () => {
  it('FR-257 (results encoders) writes rank, playerId, total and the three correct counts in the fixed order', () => {
    expect([...LEADERBOARD_ROW_KEYS]).toStrictEqual(['rank', 'playerId', 'total', 'correctVictims', 'correctAbsorbers', 'correctWinner', 'name']);
    const text = encodeLeaderboardRow(row);
    expect(text).toBe('{"rank":1,"playerId":"web:p1","total":12,"correctVictims":2,"correctAbsorbers":1,"correctWinner":1}');
    expect(encodeLeaderboardRow(reverse(row))).toBe(text);
    expect(encodePage({ items: [row, { ...row, rank: 1, playerId: 'web:p2' }], next: 'c' }, encodeLeaderboardRow)).toBe(
      `{"items":[${text},${encodeLeaderboardRow({ ...row, playerId: 'web:p2' })}],"next":"c"}`,
    );
  });

  it('FR-257 (results encoders) refuses an extra, inherited or null member, a rank below 1 and a winner count above 1', () => {
    expect(() => encodeLeaderboardRow({ ...row, extra: 1 } as never)).toThrow(RangeError);
    expect(() => encodeLeaderboardRow({ ...row, total: null } as never)).toThrow(RangeError);
    for (const bad of [0, -1, 1.5, '1']) expect(() => encodeLeaderboardRow({ ...row, rank: bad } as never), String(bad)).toThrow(RangeError);
    for (const bad of [-1, 2, 0.5]) expect(() => encodeLeaderboardRow({ ...row, correctWinner: bad } as never), String(bad)).toThrow(RangeError);
    expect(() => encodeLeaderboardRow({ ...row, total: -1 })).toThrow(RangeError);
    expect(() => encodeLeaderboardRow({ ...row, correctVictims: -1 })).toThrow(RangeError);
    expect(() => encodeLeaderboardRow({ ...row, playerId: 'p1' })).toThrow(RangeError);
    const { total: _t, ...missing } = row;
    expect(() => encodeLeaderboardRow(missing as never)).toThrow(RangeError);
    const inherited = Object.assign(Object.create({ total: 5 }), missing);
    expect(() => encodeLeaderboardRow(inherited)).toThrow(RangeError);
  });
});

describe('FR-257 (results encoders) the player id', () => {
  it('FR-257 (results encoders) isPlayerId accepts namespace:local id and nothing else', () => {
    for (const ok of ['web:a', 'discord:A.b-c_9', 'a:b', `${'a'.repeat(16)}:x`, `web:${'x'.repeat(64)}`, 'web:.', 'web:-']) expect(isPlayerId(ok), ok).toBe(true);
    const bad = ['web', ':a', 'web:', 'web:a:b', 'Web:a', `${'a'.repeat(17)}:x`, `web:${'x'.repeat(65)}`, 'web: a', 'web:a\n', 'we b:a', 'web:é', '', ':', '::'];
    for (const b of bad) expect(isPlayerId(b), b).toBe(false);
    for (const b of [3, null, undefined, {}, ['web:a']]) expect(isPlayerId(b)).toBe(false);
  });

  it('FR-279 (results lists) the longest cursor key of each results list stays under 256 characters', () => {
    const longest = `${'a'.repeat(16)}:${'Z'.repeat(64)}`;
    const big = Number.MAX_SAFE_INTEGER;
    expect(encodeCursor('phase-results', [longest]).length).toBeLessThan(256);
    expect(encodeCursor('player-results', [big, 'absorber']).length).toBeLessThan(256);
    expect(encodeCursor('leaderboard', [big, big, longest]).length).toBeLessThan(256);
    expect(decodeCursor('leaderboard', encodeCursor('leaderboard', [big, big, longest]))).toStrictEqual({ ok: true, value: [big, big, longest] });
  });
});
