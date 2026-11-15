import { describe, expect, it } from 'vitest';
import {
  encodeLeaderboardRow,
  encodePage,
  encodePhaseWinners,
  encodePlayerResults,
  readLeaderboardPage,
  readPhaseWinnersPage,
  readPlayerResultsPage,
  type LeaderboardRow,
  type PhaseWinnersPage,
  type PlayerResultsPage,
} from '../src/index';

// The readers of the optional name and of the winners page read back what the encoders wrote, with the exact key set.

const roundTrip = (text: string): unknown => JSON.parse(text) as unknown;
const field = (r: { ok: boolean; field?: string }): string | undefined => (r.ok ? undefined : r.field);

const results: PlayerResultsPage = {
  playerId: 'player:Ab3',
  total: 7,
  items: [{ kind: 'victim', round: 1, choice: 2, correct: true, points: 3 }],
  next: 'c1',
  name: 'Ana Ruiz',
};
const rows: LeaderboardRow[] = [
  { rank: 1, playerId: 'player:Ab3', total: 9, correctVictims: 2, correctAbsorbers: 1, correctWinner: 1, name: 'Ana Ruiz' },
  { rank: 2, playerId: 'web:b', total: 4, correctVictims: 1, correctAbsorbers: 0, correctWinner: 0 },
];
const winners: PhaseWinnersPage = {
  round: 2,
  phase: 2,
  items: [
    { playerId: 'player:Ab3', name: 'Ana Ruiz' },
    { playerId: 'player:Zz9', name: 'Beto' },
  ],
  next: 'n',
};

describe('NFR-51 (protocol readers) the readers of names in the results and of the winners page', () => {
  it('NFR-51 (protocol readers) a player page and a leaderboard page round trip with and without a name', () => {
    expect(readPlayerResultsPage(roundTrip(encodePlayerResults(results)))).toStrictEqual({ ok: true, value: results });
    const { name: _n, ...unnamed } = results;
    expect(readPlayerResultsPage(roundTrip(encodePlayerResults(unnamed)))).toStrictEqual({ ok: true, value: unnamed });
    expect(readLeaderboardPage(roundTrip(encodePage({ items: rows }, encodeLeaderboardRow)))).toStrictEqual({ ok: true, value: { items: rows } });
  });

  it('NFR-51 (protocol readers) the winners page round trips, with and without next, and empty', () => {
    expect(readPhaseWinnersPage(roundTrip(encodePhaseWinners(winners)))).toStrictEqual({ ok: true, value: winners });
    const { next: _n, ...last } = winners;
    expect(readPhaseWinnersPage(roundTrip(encodePhaseWinners(last)))).toStrictEqual({ ok: true, value: last });
    const empty: PhaseWinnersPage = { round: 1, phase: 1, items: [] };
    expect(readPhaseWinnersPage(roundTrip(encodePhaseWinners(empty)))).toStrictEqual({ ok: true, value: empty });
  });

  const resultsText = JSON.parse(encodePlayerResults(results)) as Record<string, unknown>;
  const winnersText = JSON.parse(encodePhaseWinners(winners)) as { items: Record<string, unknown>[] } & Record<string, unknown>;
  const refusals: [string, () => { ok: boolean; field?: string }, string][] = [
    ['a player page with an empty name', () => readPlayerResultsPage({ ...resultsText, name: '' }), 'name'],
    ['a player page with a 25-character name', () => readPlayerResultsPage({ ...resultsText, name: 'x'.repeat(25) }), 'name'],
    ['a player page with a name that is not text', () => readPlayerResultsPage({ ...resultsText, name: 4 }), 'name'],
    ['a leaderboard row with an untrimmed name', () => readLeaderboardPage({ items: [{ ...rows[0], name: ' Ana' }] }), 'items[0].name'],
    ['a leaderboard row with a null name', () => readLeaderboardPage({ items: [{ ...rows[0], name: null }] }), 'items[0].name'],
    ['a leaderboard row with a member after the name', () => readLeaderboardPage({ items: [{ ...rows[0], nick: 'x' }] }), 'items[0].nick'],
    ['a winners page without items', () => readPhaseWinnersPage({ round: 1, phase: 1 }), 'items'],
    ['a winners page with phase 3', () => readPhaseWinnersPage({ ...winnersText, phase: 3 }), 'phase'],
    ['a winners page with round 0', () => readPhaseWinnersPage({ ...winnersText, round: 0 }), 'round'],
    ['a winners page with an empty next', () => readPhaseWinnersPage({ ...winnersText, next: '' }), 'next'],
    ['a winners page with a victim', () => readPhaseWinnersPage({ ...winnersText, victim: 3 }), 'victim'],
    ['a winners item with a choice', () => readPhaseWinnersPage({ ...winnersText, items: [{ ...winnersText.items[0], choice: 3 }] }), 'items[0].choice'],
    ['a winners item with points', () => readPhaseWinnersPage({ ...winnersText, items: [{ ...winnersText.items[0], points: 3 }] }), 'items[0].points'],
    ['a winners item without a name', () => readPhaseWinnersPage({ ...winnersText, items: [{ playerId: 'player:Ab3' }] }), 'items[0].name'],
    ['a winners item with a client player id', () => readPhaseWinnersPage({ ...winnersText, items: [{ playerId: 'web:a', name: 'Ana' }] }), 'items[0].playerId'],
    ['a winners item with a bad name', () => readPhaseWinnersPage({ ...winnersText, items: [{ playerId: 'player:a', name: 'a<b' }] }), 'items[0].name'],
  ];
  it.each(refusals)('NFR-51 (protocol readers) refused: %s', (_n, read, expected) => {
    expect(field(read())).toBe(expected);
  });

  it('NFR-51 (protocol readers) the winners reader refuses a non-object as body and an inherited member', () => {
    for (const v of [null, undefined, 3, 'x', []]) expect(readPhaseWinnersPage(v)).toStrictEqual({ ok: false, field: 'body' });
    expect(field(readPhaseWinnersPage(Object.create({ items: [], round: 1, phase: 1 }) as object))).toBe('round');
  });
});
