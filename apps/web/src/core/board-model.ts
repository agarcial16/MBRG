// The leaderboard of the match screen at scale (spec 019 FR-507 to FR-516). Pure: one immutable state, reducers and one view. The shell
// (`ui/play-session.ts`) runs the reads this module asks for (`nextFetch`) and feeds the replies back; nothing here touches the network,
// the DOM or a clock. The list is the server's own order (rank, then id) read page by page by cursor, then the joined players the server
// does not list (0 points, FR-432) once the scored rows are all read; it is never sorted on the client (FR-514).
import { nameKey } from '@mbrg/protocol';
import type { LeaderboardRow, Page, PlayerListItem } from '@mbrg/protocol';
import { STRINGS, fillTemplate } from './strings';

/** The `limit` of every page read (the server maximum). */
export const PAGE_LIMIT = 500;
/** NFR-106: the pages one search or one "go to my place" may read. */
export const SEEK_PAGE_CAP = 20;
/** The rows kept loaded beyond the last row the screen needs, so a scroll meets no gap. */
const PREFETCH = 30;
/** A restart after `stale-cursor` is tried this many times before the retry control is shown (the list moved under every try). */
const STALE_TRIES = 3;

/** A joined player the server lists no score for: shown with 0 points after the scored rows. */
interface TailRow {
  readonly playerId: string;
  readonly name: string;
}

/** What was read: the rows themselves. `version` changes whenever any of it changes. */
export interface BoardData {
  /** The scored rows read so far, in the server order. */
  readonly scored: readonly LeaderboardRow[];
  /** The cursor of the next page of scored rows, undefined when none is left (or none was read yet). */
  readonly next: string | undefined;
  readonly scoredDone: boolean;
  /** Every joined player known: the roster pages read and the `player-joined` frames. */
  readonly roster: readonly PlayerListItem[];
  readonly rosterNext: string | undefined;
  readonly rosterDone: boolean;
  /** Joined players with no scored row, in join order; filled once every scored row is read. */
  readonly tail: readonly TailRow[];
  /** The index of every listed player in the list (scored rows, then the tail). */
  readonly index: ReadonlyMap<string, number>;
  readonly version: number;
}

type Seek = { readonly what: 'mine' | 'search'; readonly pages: number };
type Refresh = { readonly rows: readonly LeaderboardRow[]; readonly next: string | undefined; readonly target: number; readonly tries: number };

/** What the screen asked for and how the reads stand. */
export interface BoardUi {
  /** The viewer's player id, or '' for a spectator. */
  readonly me: string;
  /** The rows the screen needs loaded (last row in or near the view, plus a margin). */
  readonly want: number;
  readonly query: string;
  readonly seek: Seek | undefined;
  readonly busy: boolean;
  readonly failed: boolean;
  /** A reload from the first page in progress; the rows shown stay until it lands (FR-510). */
  readonly refresh: Refresh | undefined;
  /** Counts the restarts of the reads: a reply to a read of an earlier epoch is dropped. */
  readonly epoch: number;
  /** The row the screen scrolls to and focuses once, then clears (FR-511). */
  readonly jump: number | undefined;
  /** "Go to my place" ended without finding the row. */
  readonly missing: boolean;
}

export interface BoardState {
  readonly data: BoardData;
  readonly ui: BoardUi;
}

/** The read the shell makes next: the cursor is undefined for the first page. */
export interface PageRead {
  readonly what: 'scored' | 'roster' | 'refresh';
  readonly cursor: string | undefined;
  readonly epoch: number;
}

const localName = (playerId: string): string => playerId.slice(playerId.indexOf(':') + 1);

function derive(base: Omit<BoardData, 'tail' | 'index' | 'version'>, version: number): BoardData {
  const listed = new Set(base.scored.map((row) => row.playerId));
  const tail: TailRow[] = base.scoredDone ? base.roster.filter((p) => !listed.has(p.playerId)).map((p) => ({ playerId: p.playerId, name: p.name })) : [];
  const index = new Map<string, number>();
  base.scored.forEach((row, i) => index.set(row.playerId, i));
  tail.forEach((row, i) => index.set(row.playerId, base.scored.length + i));
  return { ...base, tail, index, version };
}

const emptyData: BoardData = derive({ scored: [], next: undefined, scoredDone: false, roster: [], rosterNext: undefined, rosterDone: false }, 0);

/** A board that read nothing: `me` is the viewer's player id ('' for a spectator). The first call of the shell is `boardRefresh`. */
export const emptyBoard = (me: string): BoardState => ({
  data: emptyData,
  ui: { me, want: PAGE_LIMIT, query: '', seek: undefined, busy: false, failed: false, refresh: undefined, epoch: 0, jump: undefined, missing: false },
});

const withUi = (state: BoardState, ui: Partial<BoardUi>): BoardState => ({ ...state, ui: { ...state.ui, ...ui } });
const loadedCount = (data: BoardData): number => data.scored.length + data.tail.length;
const allLoaded = (data: BoardData): boolean => data.scoredDone && data.rosterDone;
/** Rank of the tail: it shares the rank of the last scored row when that row has no points, else it comes after every scored row. */
const tailRank = (data: BoardData): number => {
  const last = data.scored[data.scored.length - 1];
  return last !== undefined && last.total === 0 ? last.rank : data.scored.length + 1;
};

/** FR-508: the screen shows rows up to index `last` (exclusive); the model keeps a margin beyond it loaded. */
export function boardWant(state: BoardState, last: number): BoardState {
  const want = Math.max(1, last) + PREFETCH;
  return want === state.ui.want ? state : withUi(state, { want });
}

/** FR-510: a phase was scored (or the first read): reload the loaded window from the first page; the rows shown stay until the new ones land. */
export const boardRefresh = (state: BoardState): BoardState =>
  withUi(state, { refresh: { rows: [], next: undefined, target: Math.max(1, state.ui.want, loadedCount(state.data)), tries: 0 }, epoch: state.ui.epoch + 1, failed: false });

/** FR-509: the retry control; the failed read is asked again by the next `nextFetch`. */
export const boardRetry = (state: BoardState): BoardState => (state.ui.failed ? withUi(state, { failed: false }) : state);

/** FR-513: the text of the search box; a blank text is the full list. */
export function boardQuery(state: BoardState, text: string): BoardState {
  if (text === state.ui.query) return state;
  const blank = text.trim() === '';
  return withUi(state, { query: text, seek: blank ? undefined : { what: 'search', pages: state.ui.seek?.what === 'search' ? state.ui.seek.pages : 0 }, jump: undefined, missing: false });
}

/** FR-511: "go to my place": the search is cleared, the pages are read until the row is found (at most NFR-106), then `jump` names its index. */
export function boardGoMine(state: BoardState): BoardState {
  if (state.ui.me === '') return state;
  const at = state.data.index.get(state.ui.me);
  return withUi(state, { query: '', seek: at === undefined ? { what: 'mine', pages: 0 } : undefined, jump: at, missing: false, failed: false });
}

/** The cancel control of a long read: no more pages are read for it; what was read stays. */
export const boardCancel = (state: BoardState): BoardState => (state.ui.seek === undefined && !state.ui.missing ? state : withUi(state, { seek: undefined, missing: false }));

/** The screen scrolled to the jump row and moved the focus. */
export const boardJumped = (state: BoardState): BoardState => (state.ui.jump === undefined ? state : withUi(state, { jump: undefined }));

/** FR-432: players who joined (the roster read, `player-joined` frames): listed at once, 0 points, after the scored ones. */
export function boardPlayers(state: BoardState, players: readonly PlayerListItem[], page?: { readonly next: string | undefined }): BoardState {
  const known = new Set(state.data.roster.map((p) => p.playerId));
  const added = players.filter((p) => !known.has(p.playerId));
  if (added.length === 0 && page === undefined) return state;
  const roster = [...state.data.roster, ...added].sort((a, b) => a.joinedSeq - b.joinedSeq || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0));
  const data = derive(
    { scored: state.data.scored, next: state.data.next, scoredDone: state.data.scoredDone, roster, rosterNext: page === undefined ? state.data.rosterNext : page.next, rosterDone: page === undefined ? state.data.rosterDone : page.next === undefined },
    state.data.version + 1,
  );
  return { ...state, data };
}

/** What must be loaded for what the screen asks: everything while a search or a go-to-my-place needs it, else the window. */
function needed(state: BoardState): number {
  const { seek, query } = state.ui;
  if (seek?.what === 'search' && query.trim() !== '') return Infinity;
  if (seek?.what === 'mine') return Infinity;
  return state.ui.want;
}

/** FR-509: the next read, or undefined when nothing is due (nothing needed, one is running, one failed and waits for retry, the cap is met). */
export function nextFetch(state: BoardState): PageRead | undefined {
  const { ui, data } = state;
  if (ui.busy || ui.failed) return undefined;
  if (ui.refresh !== undefined) return { what: 'refresh', cursor: ui.refresh.next, epoch: ui.epoch };
  if (loadedCount(data) >= needed(state)) return undefined;
  if (ui.seek !== undefined && ui.seek.pages >= SEEK_PAGE_CAP) return undefined;
  if (!data.scoredDone) return { what: 'scored', cursor: data.next, epoch: ui.epoch };
  if (!data.rosterDone) return { what: 'roster', cursor: data.rosterNext, epoch: ui.epoch };
  return undefined;
}

export const boardBegin = (state: BoardState): BoardState => withUi(state, { busy: true });

/** What the "go to my place" read found: the row is there (jump), or nothing more can be read (missing). */
function settleSeek(state: BoardState): BoardState {
  const { seek, me } = state.ui;
  if (seek?.what !== 'mine') return state;
  const at = state.data.index.get(me);
  if (at !== undefined) return withUi(state, { seek: undefined, jump: at, missing: false });
  if (allLoaded(state.data) || seek.pages >= SEEK_PAGE_CAP) return withUi(state, { seek: undefined, missing: true });
  return state;
}

const counted = (ui: BoardUi, read: PageRead): Partial<BoardUi> => (ui.seek === undefined || read.what === 'refresh' ? {} : { seek: { ...ui.seek, pages: ui.seek.pages + 1 } });

/** A page arrived. `read` is what `nextFetch` asked for. */
export function boardAfterPage(state: BoardState, read: PageRead, page: Page<LeaderboardRow> | Page<PlayerListItem>): BoardState {
  const { data, ui } = state;
  // A reply to a read the state has moved past (a refresh started meanwhile) is dropped.
  if (read.what !== 'roster' && read.epoch !== ui.epoch) return withUi(state, { busy: false });
  let next: BoardState;
  if (read.what === 'roster') {
    next = boardPlayers(withUi(state, {}), page.items as readonly PlayerListItem[], { next: page.next });
  } else if (read.what === 'scored') {
    const scored = [...data.scored, ...(page.items as readonly LeaderboardRow[])];
    next = { ...state, data: derive({ ...data, scored, next: page.next, scoredDone: page.next === undefined }, data.version + 1) };
  } else {
    const job = ui.refresh as Refresh;
    const rows = [...job.rows, ...(page.items as readonly LeaderboardRow[])];
    if (page.next === undefined || rows.length >= job.target) {
      // The reloaded window replaces the old rows at once: nothing is shown half old, half new.
      next = { ...state, data: derive({ ...data, scored: rows, next: page.next, scoredDone: page.next === undefined }, data.version + 1), ui: { ...ui, refresh: undefined } };
    } else {
      next = { ...state, ui: { ...ui, refresh: { ...job, rows, next: page.next } } };
    }
  }
  return settleSeek(withUi(next, { busy: false, ...counted(ui, read) }));
}

/**
 * A read failed. `stale-cursor` (a phase was scored since the cursor was cut, FR-510) restarts from the first page, keeping the number of rows
 * wanted; any other failure stops the reads and shows the retry control, keeping every row already shown (FR-509).
 */
export function boardAfterFailure(state: BoardState, read: PageRead, outcome: string): BoardState {
  const { ui } = state;
  if (read.what !== 'roster' && read.epoch !== ui.epoch) return withUi(state, { busy: false });
  if (outcome === 'stale-cursor' && read.what !== 'roster') {
    const tries = (ui.refresh?.tries ?? 0) + 1;
    if (tries > STALE_TRIES) return withUi(state, { busy: false, failed: true });
    const target = Math.max(ui.refresh?.target ?? 1, state.data.scored.length, ui.want);
    return withUi(state, { busy: false, refresh: { rows: [], next: undefined, target, tries }, epoch: ui.epoch + 1 });
  }
  return withUi(state, { busy: false, failed: true, ...counted(ui, read) });
}

/** The rank of the viewer when the list holds the row, else undefined. */
export function boardRankOf(state: BoardState): number | undefined {
  const at = state.data.index.get(state.ui.me);
  if (at === undefined) return undefined;
  const scored = state.data.scored[at];
  return scored !== undefined ? scored.rank : tailRank(state.data);
}

/** The name the list gives the viewer, or undefined when the list does not hold the row. */
export function boardOwnName(state: BoardState): string | undefined {
  const at = state.data.index.get(state.ui.me);
  if (at === undefined) return undefined;
  const scored = state.data.scored[at];
  if (scored !== undefined) return scored.name ?? localName(scored.playerId);
  return (state.data.tail[at - state.data.scored.length] as TailRow).name;
}

/** Something was read (or failed to be): the column has a board to show, even an empty one. */
export const boardReady = (state: BoardState): boolean => state.data.scoredDone || state.data.scored.length > 0 || state.data.roster.length > 0 || state.ui.failed;

/** The scored rows read: the top of the board for the champion line (FR-448). */
export const boardScored = (state: BoardState): readonly LeaderboardRow[] => state.data.scored;

/** The data of `shown` with the reads and requests of `live`: during a tour the rows stay as they were before it (FR-516, 013 FR-449). */
export const boardFrozen = (live: BoardState, shown: BoardData): BoardState => (live.data === shown ? live : { ...live, data: shown });

// ---- search (FR-513) -------------------------------------------------------------------------------------------------------------

const keyCache = new WeakMap<object, string>();
const keyOfRow = (row: object, name: string): string => {
  let key = keyCache.get(row);
  if (key === undefined) {
    key = nameKey(name);
    keyCache.set(row, key);
  }
  return key;
};

/** The comparison key of a search text: case and accents do not matter (the server's own name key). */
export const searchKey = (text: string): string => nameKey(text.trim());

/** The indexes of the rows whose name contains the text, ignoring case and accents, in list order. */
export function matchingRows(data: BoardData, text: string): readonly number[] {
  const needle = searchKey(text);
  const out: number[] = [];
  const total = data.scored.length + data.tail.length;
  for (let i = 0; i < total; i++) {
    const row = i < data.scored.length ? (data.scored[i] as LeaderboardRow) : (data.tail[i - data.scored.length] as TailRow);
    const name = row.name ?? localName(row.playerId);
    if (keyOfRow(row, name).includes(needle)) out.push(i);
  }
  return out;
}

let lastSearch: { readonly data: BoardData; readonly text: string; readonly matches: readonly number[] } | undefined;
const searched = (data: BoardData, text: string): readonly number[] => {
  if (lastSearch === undefined || lastSearch.data !== data || lastSearch.text !== text) lastSearch = { data, text, matches: matchingRows(data, text) };
  return lastSearch.matches;
};

// ---- view ------------------------------------------------------------------------------------------------------------------------

export interface BoardRowView {
  readonly key: string;
  /** Undefined for the viewer's own row before the list holds it. */
  readonly rank: number | undefined;
  readonly name: string;
  readonly total: number;
  readonly me: boolean;
}

export interface BoardView {
  /** Changes whenever anything the screen draws (but the scroll position) changes: the screen redraws only then (NFR-105, NFR-107). */
  readonly version: string;
  /** The rows of the list: the loaded ones (the matches while a search is on). */
  readonly count: number;
  /** A loading row closes the list: more rows exist or are being read. */
  readonly loading: boolean;
  /** A read failed: the retry control is shown and the rows stay. */
  readonly failed: boolean;
  readonly query: string;
  /** The line under the search box: searching, no match, cap, "not found", or none. */
  readonly note: string | undefined;
  /** A long read can be cancelled. */
  readonly cancellable: boolean;
  /** FR-511: the viewer is a player of the match. */
  readonly canGoMine: boolean;
  /** FR-511: the row to scroll to and focus, once. */
  readonly jump: number | undefined;
  /** Nothing to list at all: "boardEmpty". */
  readonly empty: boolean;
  /** FR-512: the viewer's own row, with the index it has in the list when the list holds it. */
  readonly mine: { readonly row: BoardRowView; readonly index: number | undefined } | undefined;
  at(index: number): BoardRowView;
}

/** The view of the board; `own` is what the player read says of the viewer (name and points) for a row not listed yet. */
export function boardView(state: BoardState, own?: { readonly name: string; readonly total: number }): BoardView {
  const { data, ui } = state;
  const searching = ui.query.trim() !== '';
  const matches = searching ? searched(data, ui.query) : undefined;
  const rank = tailRank(data);
  const rowAt = (i: number): BoardRowView => {
    const scored = data.scored[i];
    if (scored !== undefined) return { key: scored.playerId, rank: scored.rank, name: scored.name ?? localName(scored.playerId), total: scored.total, me: scored.playerId === ui.me };
    const tail = data.tail[i - data.scored.length] as TailRow;
    return { key: tail.playerId, rank, name: tail.name, total: 0, me: tail.playerId === ui.me };
  };
  const count = matches === undefined ? loadedCount(data) : matches.length;
  const more = !allLoaded(data) || ui.refresh !== undefined;
  const capped = ui.seek !== undefined && ui.seek.pages >= SEEK_PAGE_CAP;
  const reading = !ui.failed && !capped && (matches === undefined ? more : ui.seek !== undefined && more);
  const loaded = loadedCount(data);
  let note: string | undefined;
  if (ui.missing) note = fillTemplate(STRINGS.boardMineFar, { count: loaded });
  else if (matches !== undefined) {
    if (more && capped) note = fillTemplate(STRINGS.boardSearchCap, { count: loaded });
    else if (reading) note = fillTemplate(STRINGS.boardSearching, { count: loaded });
    else if (matches.length === 0) note = STRINGS.boardNoMatch;
  }
  const at = ui.me === '' ? undefined : data.index.get(ui.me);
  const listed = at === undefined ? undefined : rowAt(at);
  const mineRow: BoardRowView | undefined =
    ui.me === '' ? undefined : listed ?? (own === undefined ? undefined : { key: ui.me, rank: undefined, name: own.name, total: own.total, me: true });
  const mineIndex = at === undefined ? undefined : matches === undefined ? at : undefined;
  const version = [data.version, ui.failed, ui.busy, reading, ui.query, ui.seek?.what, ui.seek?.pages, ui.jump, ui.missing, note, mineRow?.name, mineRow?.total, mineRow?.rank, mineIndex, ui.refresh === undefined].join('|');
  return {
    version,
    count,
    loading: reading,
    failed: ui.failed,
    query: ui.query,
    note,
    cancellable: ui.seek !== undefined && !capped && !allLoaded(data),
    canGoMine: ui.me !== '',
    jump: ui.jump,
    empty: loaded === 0 && allLoaded(data),
    mine: mineRow === undefined ? undefined : { row: mineRow, index: mineIndex },
    at: (index) => rowAt(matches === undefined ? index : (matches[index] as number)),
  };
}
