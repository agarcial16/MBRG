import { describe, expect, it } from 'vitest';
import { encodeLeaderboardRow, encodePage, encodePhaseWinners, encodePlayerResults, readLeaderboardPage, readPhaseWinnersPage, readPlayerResultsPage } from '@mbrg/protocol';
import type { LeaderboardRow } from '@mbrg/protocol';
import { boardAfterPage, boardBegin, boardOwnName, boardQuery, boardRankOf, boardRefresh, boardView, emptyBoard, nextFetch, type BoardState } from '../src/core/board-model';
import { championLine, winnersView } from '../src/core/results-model';

// Spec 022 FR-538: the viewer shows the name the server sends for a client player, with no change to its fallback to the local id
// (019 `localName`); a duplicated name is told apart by the rank, and the search of 019 finds players by this name.

const row = (rank: number, playerId: string, total: number, name?: string): LeaderboardRow => ({
  rank, playerId, total, correctVictims: 1, correctAbsorbers: 0, correctWinner: 0, ...(name === undefined ? {} : { name }),
});

/** A board that read one page of scored rows, as the shell does: ask for a read, then hand the page over. */
const loaded = (me: string, rows: readonly LeaderboardRow[]): BoardState => {
  const asked = boardBegin(boardRefresh(emptyBoard(me)));
  const read = nextFetch(boardRefresh(emptyBoard(me)));
  if (read === undefined) throw new Error('the board asked for no read');
  return boardAfterPage(asked, read, { items: rows });
};
const names = (state: BoardState): string[] => {
  const view = boardView(state);
  return Array.from({ length: view.count }, (_, i) => view.at(i)).map((r) => `${r.rank}:${r.name}`);
};

const ROWS = [
  row(1, 'discord:111', 9, 'Ana Lopez'),
  row(2, 'discord:222', 7, 'Sam'),
  row(3, 'discord:333', 7, 'Sam'),
  row(4, 'discord:444', 3),
  row(5, 'player:Ab3', 1, 'Pat'),
];

describe('FR-538 the board shows the name of a client player', () => {
  it('FR-538 rows with a name show it, a row without one shows the id as before, and a duplicated name is told apart by the rank', () => {
    const state = loaded('discord:222', ROWS);
    expect(names(state)).toStrictEqual(['1:Ana Lopez', '2:Sam', '3:Sam', '4:444', '5:Pat']);
  });

  it('FR-538 the own place shows the name the list gives the viewer and its rank', () => {
    const state = loaded('discord:222', ROWS);
    expect(boardOwnName(state)).toBe('Sam');
    expect(boardRankOf(state)).toBe(2);
    const view = boardView(state);
    expect(Array.from({ length: view.count }, (_, i) => view.at(i)).filter((r) => r.me).map((r) => [r.rank, r.name])).toStrictEqual([[2, 'Sam']]);
    expect(boardOwnName(loaded('discord:444', ROWS))).toBe('444');
  });

  it('FR-538 the search finds a client player by the name, ignoring case and accents, and by the id as before', () => {
    const state = loaded('', [...ROWS, row(6, 'discord:555', 0, 'José Luis')]);
    const found = (text: string): string[] => names(boardQuery(state, text));
    expect(found('ANA lo')).toStrictEqual(['1:Ana Lopez']);
    expect(found('sam')).toStrictEqual(['2:Sam', '3:Sam']);
    expect(found('jose')).toStrictEqual(['6:José Luis']);
    expect(found('444')).toStrictEqual(['4:444']);
  });

  it('FR-538 the champion line and the winners line use the name, and the id when there is none', () => {
    expect(championLine([row(1, 'discord:111', 9, 'Ana Lopez')], 'discord:999')?.text).toContain('Ana Lopez');
    expect(championLine([row(1, 'discord:111', 9, 'Ana Lopez')], 'discord:111')?.you).toBe(true);
    expect(championLine([row(1, 'discord:444', 9)], '')?.text).toContain('444');
    const line = winnersView(1, ['Ana Lopez', 'Sam', 'Sam'], false, 0).line;
    expect(line).toContain('Ana Lopez');
    expect(line).toContain('Sam, Sam');
  });
});

describe('FR-538 the replies of the server reach the models with the name intact', () => {
  const NAMES = ['Ana Lopez', 'José Luis', 'a.b_c-d 9', 'x'.repeat(24), '山田 Дима'];

  it('FR-538 a leaderboard page with cleaned Discord-style names decodes and fills the board', () => {
    const rows = NAMES.map((name, i) => row(i + 1, `discord:${100 + i}`, 10 - i, name));
    const text = encodePage({ items: rows }, encodeLeaderboardRow);
    const read = readLeaderboardPage(JSON.parse(text));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.items.map((r) => r.name)).toStrictEqual(NAMES);
    expect(names(loaded('', read.value.items))).toStrictEqual(NAMES.map((n, i) => `${i + 1}:${n}`));
  });

  it('FR-538 a winners page and the own-player read with client ids decode with the name', () => {
    const winners = readPhaseWinnersPage(JSON.parse(encodePhaseWinners({ round: 2, phase: 1, items: NAMES.map((name, i) => ({ playerId: `discord:${100 + i}`, name })) })));
    expect(winners.ok && winners.value.items.map((w) => w.name)).toStrictEqual(NAMES);
    const own = readPlayerResultsPage(JSON.parse(encodePlayerResults({ playerId: 'discord:100', total: 3, items: [], name: 'Ana Lopez' })));
    expect(own.ok && own.value.name).toBe('Ana Lopez');
  });

  it('FR-538 a name outside the rule is refused by the decoder as before: no new leniency', () => {
    for (const bad of ['a<b', '', ' x', 'x'.repeat(25), 'two  spaces']) {
      expect(readLeaderboardPage({ items: [{ rank: 1, playerId: 'discord:1', total: 1, correctVictims: 0, correctAbsorbers: 0, correctWinner: 0, name: bad }] }).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});
