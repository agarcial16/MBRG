import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  LEADERBOARD_ROW_KEYS,
  PHASE_RESULT_KEYS,
  PHASE_WINNERS_PAGE_KEYS,
  PHASE_WINNER_KEYS,
  PLAYER_RESULTS_PAGE_KEYS,
  encodeLeaderboardRow,
  encodePage,
  encodePhaseResults,
  encodePhaseWinners,
  encodePlayerResults,
  type LeaderboardRow,
  type PhaseResultsPage,
  type PhaseWinnersPage,
  type PlayerResultsPage,
} from '../src/index';

// The optional player name in the results shapes and the winners page (the names are untrusted text: JSON strings only).

const reverse = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).reverse()) as T;
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
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
const playerPage: PlayerResultsPage = {
  playerId: 'web:p1',
  total: 8,
  items: [
    { kind: 'absorber', round: 2, choice: 3, correct: true, points: 3 },
    { kind: 'winner', choice: 4, correct: true, points: 5 },
  ],
  next: 'zz',
};
const row: LeaderboardRow = { rank: 1, playerId: 'web:p1', total: 12, correctVictims: 2, correctAbsorbers: 1, correctWinner: 1 };

describe('FR-257 (results encoders) a result without a name keeps the bytes of the earlier server', () => {
  it('FR-257 (results encoders) one page of each shape without a name hashes to the pinned SHA-256', () => {
    // Pins computed with the encoders before the optional name existed (spec 008 bytes).
    expect(sha(encodePhaseResults(phase1))).toBe('5921c62b04730443822fa510b1366fb6b080d248147406fea59d5f97fb56f851');
    expect(sha(encodePhaseResults(phase2))).toBe('31e4e9c873e8f2b2aa9ef5371d0dd20dc20242d2a01114d780cc249cf06477dc');
    expect(sha(encodePlayerResults(playerPage))).toBe('44c5a0667555f01c4e206e5e103471ba86cd763aa515f82949228c7d03435875');
    expect(sha(encodePage({ items: [row, { ...row, rank: 2, playerId: 'web:p2' }], next: 'c' }, encodeLeaderboardRow))).toBe(
      '57b3d00517fdc203d980910b6b17dd7ed29e2f7f7b98a55a8844802eec33bb2d',
    );
  });
});

describe('FR-257 (results encoders) the optional player name', () => {
  const named = (name: unknown): { name: string } => ({ name }) as { name: string };

  it('FR-257 (results encoders) name is the last key of each shape and is written only when present', () => {
    expect(PHASE_RESULT_KEYS.at(-1)).toBe('name');
    expect(LEADERBOARD_ROW_KEYS.at(-1)).toBe('name');
    expect(PLAYER_RESULTS_PAGE_KEYS.at(-1)).toBe('name');
    const item = { ...phase1.items[0]!, name: 'Ana' };
    expect(encodePhaseResults({ ...phase1, items: [item] })).toBe(
      '{"round":3,"phase":1,"victim":4,"items":[{"playerId":"web:p1","choice":4,"correct":true,"points":5,"name":"Ana"}],"next":"abc"}',
    );
    expect(encodePhaseResults({ ...phase1, items: [reverse(item)] })).toBe(encodePhaseResults({ ...phase1, items: [item] }));
    expect(encodePlayerResults({ ...playerPage, name: 'Ana' })).toBe(
      '{"playerId":"web:p1","total":8,"items":[{"kind":"absorber","round":2,"choice":3,"correct":true,"points":3},' +
        '{"kind":"winner","choice":4,"correct":true,"points":5}],"next":"zz","name":"Ana"}',
    );
    const { next: _n, ...last } = playerPage;
    expect(encodePlayerResults({ ...last, name: 'Ana' })).toBe(
      '{"playerId":"web:p1","total":8,"items":[{"kind":"absorber","round":2,"choice":3,"correct":true,"points":3},' +
        '{"kind":"winner","choice":4,"correct":true,"points":5}],"name":"Ana"}',
    );
    expect(encodeLeaderboardRow({ ...row, name: 'Ana' })).toBe(
      '{"rank":1,"playerId":"web:p1","total":12,"correctVictims":2,"correctAbsorbers":1,"correctWinner":1,"name":"Ana"}',
    );
    expect(encodeLeaderboardRow(reverse({ ...row, name: 'Ana' }))).toBe(encodeLeaderboardRow({ ...row, name: 'Ana' }));
    // Absent or undefined: the earlier bytes; null is refused.
    expect(encodeLeaderboardRow({ ...row, name: undefined })).toBe(encodeLeaderboardRow(row));
    expect(encodePlayerResults({ ...playerPage, name: undefined })).toBe(encodePlayerResults(playerPage));
    expect(() => encodeLeaderboardRow({ ...row, ...named(null) })).toThrow(RangeError);
    expect(() => encodePlayerResults({ ...playerPage, ...named(null) })).toThrow(RangeError);
    expect(() => encodePhaseResults({ ...phase1, items: [{ ...phase1.items[0]!, ...named(null) }] })).toThrow(RangeError);
  });

  it('FR-257 (results encoders) a name is 1 to 24 characters under the name rules, else the encoder refuses it', () => {
    const edge = 'ñ'.repeat(24);
    expect(encodeLeaderboardRow({ ...row, name: edge })).toContain(`"name":"${edge}"`);
    expect(encodeLeaderboardRow({ ...row, name: 'José Ñandú' })).toContain('"name":"José Ñandú"');
    for (const bad of ['', 'x'.repeat(25), ' Ana', 'Ana ', 'Ana\n', 'A\u0000na', 'éé', 'a​b', 3, true, ['Ana'], {}]) {
      expect(() => encodeLeaderboardRow({ ...row, ...named(bad) }), JSON.stringify(bad)).toThrow(RangeError);
      expect(() => encodePlayerResults({ ...playerPage, ...named(bad) }), JSON.stringify(bad)).toThrow(RangeError);
      expect(() => encodePhaseResults({ ...phase1, items: [{ ...phase1.items[0]!, ...named(bad) }] }), JSON.stringify(bad)).toThrow(RangeError);
    }
    const inherited = Object.assign(Object.create({ name: 'Ana' }), row);
    expect(() => encodeLeaderboardRow(inherited)).toThrow(RangeError);
    try {
      encodeLeaderboardRow({ ...row, name: 'x'.repeat(25) });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('name');
      expect((e as Error).message).not.toContain('xxxxx');
    }
  });
});

const winners: PhaseWinnersPage = {
  round: 3,
  phase: 1,
  items: [
    { playerId: 'player:aaa', name: 'Ana' },
    { playerId: 'player:bbb', name: 'Zoë' },
  ],
  next: 'abc',
};

describe('FR-257 (results encoders) the winners page', () => {
  it('FR-257 (results encoders) writes round, phase, items {playerId, name} and next in the fixed order whatever the input order', () => {
    expect([...PHASE_WINNERS_PAGE_KEYS]).toStrictEqual(['round', 'phase', 'items', 'next']);
    expect([...PHASE_WINNER_KEYS]).toStrictEqual(['playerId', 'name']);
    const text = encodePhaseWinners(winners);
    expect(text).toBe('{"round":3,"phase":1,"items":[{"playerId":"player:aaa","name":"Ana"},{"playerId":"player:bbb","name":"Zoë"}],"next":"abc"}');
    expect(encodePhaseWinners(reverse({ ...winners, items: winners.items.map((i) => reverse(i)) }))).toBe(text);
    expect(JSON.parse(text)).toStrictEqual(winners);
    const { next: _n, ...last } = winners;
    expect(encodePhaseWinners({ ...last, phase: 2 })).toBe(
      '{"round":3,"phase":2,"items":[{"playerId":"player:aaa","name":"Ana"},{"playerId":"player:bbb","name":"Zoë"}]}',
    );
    expect(encodePhaseWinners({ ...last, items: [] })).toBe('{"round":3,"phase":1,"items":[]}');
    expect(encodePhaseWinners({ ...winners, next: undefined })).not.toContain('next');
  });

  it('FR-257 (results encoders) the winners page says only who was right: no choice, points, correct flag, victim or record', () => {
    // Each extra member carries a well-typed value, so only the key list can refuse it.
    const extras: [string, unknown][] = [['choice', 4], ['points', 5], ['correct', true], ['correct', false], ['wrong', true], ['count', 2]];
    for (const [extra, value] of extras) {
      expect(() => encodePhaseWinners({ ...winners, items: [{ ...winners.items[0]!, [extra]: value }] } as never), extra).toThrow(RangeError);
    }
    for (const extra of ['victim', 'record', 'total', 'extra']) expect(() => encodePhaseWinners({ ...winners, [extra]: 1 } as never), extra).toThrow(RangeError);
  });

  it('FR-257 (results encoders) a winner needs a name of 1 to 24 characters and a player id; phase, round and next are checked', () => {
    const { name: _name, ...noName } = winners.items[0]!;
    expect(() => encodePhaseWinners({ ...winners, items: [noName] } as never)).toThrow(RangeError);
    for (const bad of ['', 'x'.repeat(25), null, 3, ' Ana']) {
      expect(() => encodePhaseWinners({ ...winners, items: [{ ...winners.items[0]!, name: bad }] } as never), String(bad)).toThrow(RangeError);
    }
    expect(() => encodePhaseWinners({ ...winners, items: [{ ...winners.items[0]!, playerId: 'p1' }] })).toThrow(RangeError);
    expect(() => encodePhaseWinners({ ...winners, items: [{ name: 'Ana' }] } as never)).toThrow(RangeError);
    expect(() => encodePhaseWinners({ ...winners, phase: 3 } as never)).toThrow(RangeError);
    expect(() => encodePhaseWinners({ ...winners, round: 0 })).toThrow(RangeError);
    expect(() => encodePhaseWinners({ ...winners, next: '' })).toThrow(RangeError);
    expect(() => encodePhaseWinners({ ...winners, next: null } as never)).toThrow(RangeError);
    expect(() => encodePhaseWinners({ ...winners, items: 'x' } as never)).toThrow(RangeError);
    expect(() => encodePhaseWinners(null as never)).toThrow(RangeError);
    const inherited = Object.assign(Object.create({ next: 'zz' }), { round: 3, phase: 1, items: [] });
    expect(() => encodePhaseWinners(inherited)).toThrow(RangeError);
  });
});
