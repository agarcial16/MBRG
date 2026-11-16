import { describe, expect, it } from 'vitest';
import type { LeaderboardRow, PlayerListItem } from '@mbrg/protocol';
import {
  SEEK_PAGE_CAP,
  boardAfterFailure,
  boardAfterPage,
  boardBegin,
  boardCancel,
  boardFrozen,
  boardGoMine,
  boardJumped,
  boardPlayers,
  boardQuery,
  boardRankOf,
  boardRefresh,
  boardRetry,
  boardView,
  boardWant,
  emptyBoard,
  matchingRows,
  nextFetch,
  searchKey,
  type BoardState,
} from '../src/core/board-model';
import { STRINGS } from '../src/core/strings';
import { boardServer, idFor, synthetic, type BoardServer } from './helpers/board-server';

/** Runs the reads the model asks for against the synthetic server until it asks for none (or `max` reads), like the shell does. */
async function drive(start: BoardState, server: BoardServer, max = 200): Promise<{ state: BoardState; reads: string[] }> {
  let state = start;
  const reads: string[] = [];
  for (let i = 0; i < max; i++) {
    const fetch = nextFetch(state);
    if (fetch === undefined) break;
    state = boardBegin(state);
    const path = fetch.what === 'roster' ? 'players' : 'leaderboard';
    const query = `limit=500${fetch.cursor === undefined ? '' : `&cursor=${encodeURIComponent(fetch.cursor)}`}`;
    reads.push(`${path}?${query}`);
    const response = await server.fetch(`http://fake/matches/m/${path}?${query}`);
    const body = (await response.json()) as { kind?: string; items: never[]; next?: string };
    state = response.status === 200 ? boardAfterPage(state, fetch, body) : boardAfterFailure(state, fetch, body.kind ?? 'unreadable');
  }
  return { state, reads };
}

const opened = async (count: number, me = ''): Promise<{ server: BoardServer; state: BoardState; reads: string[] }> => {
  const server = boardServer(synthetic(count));
  const first = boardRefresh(emptyBoard(me));
  const { state, reads } = await drive(first, server);
  return { server, state, reads };
};

describe('FR-507 FR-508 FR-509 paging by cursor, on demand', () => {
  it('opens a 10,000-player match with one page and no roster read', async () => {
    const { reads, state } = await opened(10000);
    expect(reads).toEqual(['leaderboard?limit=500']);
    expect(state.data.scored).toHaveLength(500);
    expect(boardView(state).count).toBe(500);
    expect(boardView(state).loading).toBe(true);
  });

  it('reads the next page only when the screen wants rows beyond the loaded ones', async () => {
    const { server, state } = await opened(10000);
    const near = await drive(boardWant(state, 100), server);
    expect(near.reads).toEqual([]);
    const far = await drive(boardWant(state, 480), server);
    expect(far.reads).toEqual(['leaderboard?limit=500&cursor=1%3A500']);
    expect(far.state.data.scored).toHaveLength(1000);
  });

  it('lets the viewer reach any rank of a 1,000-player match, scored first then the unscored players at 0 points', async () => {
    const { server, state } = await opened(1000);
    const all = await drive(boardWant(state, 5000), server);
    const view = boardView(all.state);
    expect(view.count).toBe(1000);
    expect(view.loading).toBe(false);
    const last = view.at(999);
    expect(last.total).toBe(0);
    expect(view.at(0).rank).toBe(1);
  });

  it('keeps the rows shown and shows the retry control when a page fails, with no request loop', async () => {
    const { server, state } = await opened(2000);
    const limited = { ...server, fetch: async () => new Response(JSON.stringify({ kind: 'rate-limited' }), { status: 429 }) } as BoardServer;
    const failed = await drive(boardWant(state, 480), limited);
    expect(failed.reads).toHaveLength(1);
    const view = boardView(failed.state);
    expect(view.failed).toBe(true);
    expect(view.count).toBe(500);
    expect(nextFetch(failed.state)).toBeUndefined();
    expect(nextFetch(boardRetry(failed.state))).toEqual({ what: 'scored', cursor: '1:500' });
  });
});

describe('FR-510 a scored phase and stale-cursor', () => {
  it('refreshes from the first page and swaps the rows only when the new ones landed', async () => {
    const { server, state } = await opened(2000);
    const deep = await drive(boardWant(state, 900), server);
    expect(deep.state.data.scored.length).toBeGreaterThanOrEqual(900);
    const refreshing = boardRefresh(deep.state);
    // The old rows stay on screen while the reload runs.
    expect(boardView(refreshing).count).toBe(deep.state.data.scored.length);
    server.generation++;
    const done = await drive(refreshing, server);
    expect(done.reads[0]).toBe('leaderboard?limit=500');
    expect(done.state.ui.refresh).toBeUndefined();
    expect(done.state.data.scored.length).toBeGreaterThanOrEqual(900);
  });

  it('restarts from the first page on stale-cursor and keeps asking for as many rows as were wanted', async () => {
    const { server, state } = await opened(3000);
    const wanted = boardWant(state, 900);
    server.generation++;
    const done = await drive(wanted, server);
    expect(done.reads[0]).toBe('leaderboard?limit=500&cursor=1%3A500');
    expect(done.reads[1]).toBe('leaderboard?limit=500');
    expect(done.state.data.scored.length).toBeGreaterThanOrEqual(900);
    expect(done.state.ui.failed).toBe(false);
  });

  it('shows the retry control when the list keeps moving under every restart', async () => {
    const { server, state } = await opened(3000);
    const moving = { ...server, fetch: async () => new Response(JSON.stringify({ kind: 'stale-cursor' }), { status: 409 }) } as BoardServer;
    const done = await drive(boardWant(state, 900), moving);
    expect(done.state.ui.failed).toBe(true);
    expect(done.state.data.scored).toHaveLength(500);
  });
});

describe('FR-514 order and ranking with ties', () => {
  it('keeps the server order and shares the rank of equal points, across page borders', async () => {
    const { server, state } = await opened(3000);
    const all = await drive(boardWant(state, 5000), server);
    const rows = all.state.data.scored;
    expect(rows).toEqual(server.data.rows);
    for (let i = 1; i < rows.length; i++) {
      const before = rows[i - 1] as LeaderboardRow;
      const row = rows[i] as LeaderboardRow;
      expect(row.rank).toBe(before.total === row.total ? before.rank : i + 1);
    }
    // 40 totals over 2,700 scored players: a tie spans the page border at row 500.
    expect((rows[499] as LeaderboardRow).rank).toBe((rows[500] as LeaderboardRow).rank);
  });

  it('puts the players without a score after the scored ones with 0 points and one shared rank', async () => {
    const { server, state } = await opened(100);
    const all = await drive(boardWant(state, 500), server);
    const view = boardView(all.state);
    const scored = all.state.data.scored.length;
    expect(view.count).toBe(100);
    expect(scored).toBe(90);
    for (let i = scored; i < 100; i++) {
      expect(view.at(i).total).toBe(0);
      expect(view.at(i).rank).toBe(scored + 1);
    }
  });

  it('gives the 0-point newcomers the rank of scored rows that also have 0 points', () => {
    const rows: LeaderboardRow[] = [
      { rank: 1, playerId: 'player:a', total: 5, correctVictims: 0, correctAbsorbers: 0, correctWinner: 0 },
      { rank: 2, playerId: 'player:b', total: 0, correctVictims: 0, correctAbsorbers: 0, correctWinner: 0 },
    ];
    let state = boardAfterPage(boardBegin(emptyBoard('')), { what: 'scored', cursor: undefined }, { items: rows });
    state = boardPlayers(state, [{ playerId: 'player:c', name: 'Carla', joinedSeq: 3 }]);
    const view = boardView(state);
    expect(view.at(2)).toMatchObject({ name: 'Carla', total: 0, rank: 2 });
    expect(view.at(0).name).toBe('a');
  });

  it('does not reorder rows between two refreshes of the same scores', async () => {
    const { server, state } = await opened(1000);
    const a = (await drive(boardWant(state, 5000), server)).state;
    const b = (await drive(boardRefresh(boardWant(a, 5000)), server)).state;
    const keys = (s: BoardState): string[] => Array.from({ length: boardView(s).count }, (_, i) => boardView(s).at(i).key);
    expect(keys(b)).toEqual(keys(a));
  });

  it('shows the name as the server gave it, or the local id when it gave none (FR-515)', () => {
    const rows: LeaderboardRow[] = [
      { rank: 1, playerId: 'player:Ab3_x', total: 9, correctVictims: 0, correctAbsorbers: 0, correctWinner: 0, name: 'María' },
      { rank: 2, playerId: 'player:Qz1k', total: 7, correctVictims: 0, correctAbsorbers: 0, correctWinner: 0 },
    ];
    const view = boardView(boardAfterPage(boardBegin(emptyBoard('')), { what: 'scored', cursor: undefined }, { items: rows }));
    expect(view.at(0).name).toBe('María');
    expect(view.at(1).name).toBe('Qz1k');
  });
});

describe('FR-511 FR-433 only the own row carries the mark', () => {
  it('marks the own row and no other, and the label of the screen adds "(tú)" to it alone', async () => {
    const me = synthetic(300).rows[7]!.playerId;
    const { state } = await opened(300, me);
    const view = boardView(state);
    const marked = Array.from({ length: view.count }, (_, i) => view.at(i)).filter((r) => r.me);
    expect(marked.map((r) => r.key)).toEqual([me]);
    expect(STRINGS.boardYou.replace('{name}', 'Ana')).toBe('Ana (tú)');
  });
});

describe('FR-513 NFR-106 search by name', () => {
  it('ignores case and accents', () => {
    const roster: PlayerListItem[] = [
      { playerId: 'player:a', name: 'José Núñez', joinedSeq: 1 },
      { playerId: 'player:b', name: 'JOSEFA', joinedSeq: 2 },
      { playerId: 'player:c', name: 'Ana', joinedSeq: 3 },
    ];
    const state = boardPlayers(boardAfterPage(boardBegin(emptyBoard('')), { what: 'scored', cursor: undefined }, { items: [] }), roster);
    expect(matchingRows(state.data, 'jose')).toEqual([0, 1]);
    expect(matchingRows(state.data, 'NUNEZ')).toEqual([0]);
    expect(matchingRows(state.data, ' ñ ')).toEqual([0, 2]);
    expect(searchKey('  ÁLVARO ')).toBe(searchKey('alvaro'));
  });

  it('loads the remaining pages in order and lists every match with its rank', async () => {
    const { server, state } = await opened(3000);
    const searching = boardQuery(state, 'zoe perez 29');
    expect(boardView(searching).note).toContain('buscando');
    const done = await drive(searching, server);
    const view = boardView(done.state);
    expect(done.reads.map((r) => r.split('?')[0])).toContain('players');
    const names = Array.from({ length: view.count }, (_, i) => view.at(i).name);
    expect(view.count).toBeGreaterThan(0);
    expect(names.every((n) => n.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes('zoe perez 29'))).toBe(true);
    expect(view.at(0).rank).toBeGreaterThan(0);
    expect(view.loading).toBe(false);
  });

  it('searches the roster too: players with no score are found (decision 2)', async () => {
    const { server, state } = await opened(300);
    const wanted = server.data.roster.find((p) => !server.data.rows.some((r) => r.playerId === p.playerId));
    expect(wanted).toBeDefined();
    const done = await drive(boardQuery(state, (wanted as PlayerListItem).name), server);
    const view = boardView(done.state);
    const found = Array.from({ length: view.count }, (_, i) => view.at(i));
    expect(found.some((r) => r.key === (wanted as PlayerListItem).playerId && r.total === 0)).toBe(true);
  });

  it('stops at 20 pages and says the search covers the first rows only', async () => {
    const { server, state } = await opened(15000);
    const done = await drive(boardQuery(state, 'no such player'), server);
    const pagesRead = done.reads.length;
    expect(pagesRead).toBeLessThanOrEqual(SEEK_PAGE_CAP);
    const view = boardView(done.state);
    expect(view.note).toBe(STRINGS.boardSearchCap.replace('{count}', String(done.state.data.scored.length)));
    expect(view.loading).toBe(false);
    expect(nextFetch(done.state)).toBeUndefined();
  });

  it('says "sin resultados" when nothing matches a fully read list, and a blank text is the full list', async () => {
    const { server, state } = await opened(100);
    const none = boardView((await drive(boardQuery(state, 'qqqq'), server)).state);
    expect(none.count).toBe(0);
    expect(none.note).toBe(STRINGS.boardNoMatch);
    const blank = boardView(boardQuery(boardQuery(state, 'qqqq'), '   '));
    expect(blank.count).toBe(boardView(state).count);
    expect(blank.note).toBeUndefined();
  });
});

describe('FR-511 FR-512 go to my place and the pinned row', () => {
  it('reads pages until the row is loaded, then names its index once', async () => {
    const me = synthetic(10000).rows[5000]!.playerId;
    const { server, state } = await opened(10000, me);
    expect(boardView(state).mine?.index).toBeUndefined();
    const done = await drive(boardGoMine(state), server);
    const view = boardView(done.state);
    expect(view.jump).toBe(done.state.data.index.get(me));
    expect(view.at(view.jump as number).key).toBe(me);
    expect(view.at(view.jump as number).me).toBe(true);
    expect(done.reads.length).toBeLessThanOrEqual(SEEK_PAGE_CAP);
    expect(boardView(boardJumped(done.state)).jump).toBeUndefined();
    expect(boardRankOf(done.state)).toBe(view.at(view.jump as number).rank);
  });

  it('jumps at once when the row is already loaded and never reads for it', async () => {
    const me = idFor(10);
    const { server, state } = await opened(1000, me);
    const view = boardView(boardGoMine(state));
    expect(view.jump).toBeDefined();
    expect(nextFetch(boardGoMine(state))).toBeUndefined();
    expect(server.requests).toHaveLength(1);
  });

  it('can be cancelled: what was read stays and no more pages are read', async () => {
    const { server, state } = await opened(10000, idFor(9000));
    const started = boardGoMine(state);
    expect(boardView(started).cancellable).toBe(true);
    const once = await drive(started, server, 2);
    const cancelled = boardCancel(once.state);
    expect(nextFetch(cancelled)).toBeUndefined();
    expect(cancelled.data.scored.length).toBeGreaterThanOrEqual(1000);
  });

  it('says so when the row is not among the first rows after the cap', async () => {
    const { server, state } = await opened(30000, idFor(29999));
    const done = await drive(boardGoMine(state), server);
    expect(done.reads.length).toBeLessThanOrEqual(SEEK_PAGE_CAP);
    expect(boardView(done.state).note).toContain('Tu fila no está');
  });

  it('has no go-to-my-place and no pinned row for a spectator', async () => {
    const { state } = await opened(1000);
    const view = boardView(state);
    expect(view.canGoMine).toBe(false);
    expect(view.mine).toBeUndefined();
    expect(boardGoMine(state)).toBe(state);
  });

  it('pins the own row with "-" as rank while the list does not hold it, from the read of the player', async () => {
    const { state } = await opened(10000, idFor(9999));
    const view = boardView(state, { name: 'Zoë Pérez', total: 12 });
    expect(view.mine?.row).toMatchObject({ rank: undefined, name: 'Zoë Pérez', total: 12, me: true });
    expect(view.mine?.index).toBeUndefined();
  });
});

describe('FR-516 the rows shown before a tour stay during it', () => {
  it('shows the frozen rows while the live state moves on', async () => {
    const { server, state } = await opened(300);
    const before = state.data;
    server.generation++;
    server.data = synthetic(300).roster.length > 0 ? { ...server.data, rows: server.data.rows.map((r) => ({ ...r, total: r.total + 1000 })) } : server.data;
    const live = (await drive(boardRefresh(state), server)).state;
    expect(live.data).not.toBe(before);
    const shown = boardView(boardFrozen(live, before));
    expect(shown.at(0).total).toBe(boardView(boardFrozen(state, before)).at(0).total);
    expect(boardView(live).at(0).total).toBeGreaterThan(1000);
  });
});

describe('NFR-107 a refresh keeps the version while nothing changed', () => {
  it('gives the same version for the same state, and a new one when a row changes', async () => {
    const { state } = await opened(300);
    expect(boardView(state).version).toBe(boardView(state).version);
    const joined = boardPlayers(state, [{ playerId: 'player:zzz', name: 'Nuevo', joinedSeq: 9999 }]);
    expect(boardView(joined).version).not.toBe(boardView(state).version);
  });
});
