// The leaderboard of the right column (spec 019): a search box, "go to my place", a scrolling list drawn by window (at most 60 rows in the
// DOM at any size, patched by key so a refresh moves nothing that did not change) and the viewer's own row pinned while it is out of view.
// Thin: what to show and when to read more is `core/board-model`; where a row sits is `core/board-window`; every text is in the strings.
import { scrollForIndex, windowOf, ROW_HEIGHT } from '../core/board-window';
import type { BoardRowView, BoardView } from '../core/board-model';
import { STRINGS, fillTemplate } from '../core/strings';

export interface BoardHandlers {
  /** The list shows rows up to this index (exclusive): the model keeps a margin loaded beyond it. */
  want(last: number): void;
  query(text: string): void;
  mine(): void;
  cancel(): void;
  retry(): void;
  /** The screen scrolled to the jump row and moved the focus to it. */
  jumped(): void;
}

export interface BoardPanel {
  render(view: BoardView): void;
}

const EXTRA = '#extra';

interface Drawn {
  readonly node: HTMLElement;
  sig: string;
  index: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  parent?.append(node);
  return node;
}

export function createBoardPanel(parent: HTMLElement, handlers: BoardHandlers): BoardPanel {
  el('div', 'hud-title', parent).textContent = STRINGS.boardTitle;

  const tools = el('div', 'hud-boardtools', parent);
  const search = el('input', 'hud-search hud-boardsearch', tools);
  search.type = 'search';
  search.placeholder = STRINGS.boardSearch;
  search.autocomplete = 'off';
  search.maxLength = 40;
  search.setAttribute('aria-label', STRINGS.boardSearch);
  search.addEventListener('input', () => handlers.query(search.value));
  const mineButton = el('button', 'hud-btn hud-secondary hud-boardmine', tools);
  mineButton.type = 'button';
  mineButton.textContent = STRINGS.boardGoMine;
  mineButton.addEventListener('click', () => handlers.mine());

  const status = el('div', 'hud-boardstatus', parent);
  const note = el('p', 'hud-note', status);
  note.setAttribute('role', 'status');
  const cancel = el('button', 'hud-btn hud-secondary hud-boardcancel', status);
  cancel.type = 'button';
  cancel.textContent = STRINGS.boardCancel;
  cancel.addEventListener('click', () => handlers.cancel());

  const empty = el('p', 'hud-note', parent);
  empty.textContent = STRINGS.boardEmpty;

  // The scroller is a focusable region: the arrow, page and home/end keys scroll it with no code of ours (FR-518).
  const scroller = el('div', 'hud-boardscroll', parent);
  scroller.tabIndex = 0;
  scroller.setAttribute('role', 'list');
  scroller.setAttribute('aria-label', STRINGS.boardList);
  const spacer = el('div', 'hud-boardspacer', scroller);
  const layer = el('div', 'hud-boardlayer', spacer);

  const pinned = el('div', 'hud-boardrow me hud-board-mine', parent);
  pinned.hidden = true;
  pinned.setAttribute('aria-current', 'true');
  let pinnedSig = '';

  let view: BoardView | undefined;
  let shown = '';
  let wanted = -1;
  const drawn = new Map<string, Drawn>();

  const rowText = (row: BoardRowView): { readonly name: string; readonly label: string } => {
    const name = row.me ? fillTemplate(STRINGS.boardYou, { name: row.name }) : row.name;
    const label = row.rank === undefined ? fillTemplate(STRINGS.boardRowLabelNoRank, { name, total: row.total }) : fillTemplate(STRINGS.boardRowLabel, { rank: row.rank, name, total: row.total });
    return { name, label };
  };

  /** Writes a row into `node` (three spans made on first use); only text that changed is written. */
  const fill = (node: HTMLElement, row: BoardRowView): void => {
    const { name, label } = rowText(row);
    if (node.children.length === 0) for (const cls of ['hud-num', 'hud-boardname', 'hud-num']) el('span', cls, node);
    const [rank, who, total] = [node.children[0], node.children[1], node.children[2]] as [HTMLElement, HTMLElement, HTMLElement];
    const rankText = row.rank === undefined ? STRINGS.boardNoRank : String(row.rank);
    if (rank.textContent !== rankText) rank.textContent = rankText;
    if (who.textContent !== name) who.textContent = name;
    who.title = name;
    if (total.textContent !== String(row.total)) total.textContent = String(row.total);
    node.setAttribute('aria-label', label);
    node.classList.toggle('me', row.me);
    if (row.me) node.setAttribute('aria-current', 'true');
    else node.removeAttribute('aria-current');
  };

  const extraRow = (v: BoardView): HTMLElement => {
    const node = el('div', 'hud-boardrow hud-boardextra', undefined);
    node.setAttribute('role', 'listitem');
    if (v.failed) {
      const retry = el('button', 'hud-btn hud-secondary', node);
      retry.type = 'button';
      retry.textContent = STRINGS.boardRetry;
      retry.addEventListener('click', () => handlers.retry());
    } else {
      node.textContent = STRINGS.boardLoading;
    }
    return node;
  };

  const updatePinned = (): void => {
    const mine = view?.mine;
    if (view === undefined || mine === undefined) {
      pinned.hidden = true;
      return;
    }
    const first = Math.floor(scroller.scrollTop / ROW_HEIGHT);
    const last = Math.ceil((scroller.scrollTop + scroller.clientHeight) / ROW_HEIGHT);
    const out = mine.index === undefined || mine.index < first || mine.index >= last;
    pinned.hidden = !out;
    const sig = `${mine.row.rank}|${mine.row.name}|${mine.row.total}`;
    if (out && sig !== pinnedSig) {
      pinnedSig = sig;
      fill(pinned, mine.row);
    }
  };

  /** Draws the rows in or near the view; a row already drawn is left where it is unless its place or text changed. */
  const paint = (): void => {
    if (view === undefined) return;
    const extra = view.loading || view.failed;
    const total = view.count + (extra ? 1 : 0);
    const w = windowOf(total, scroller.scrollTop, scroller.clientHeight);
    const height = `${w.height}px`;
    if (spacer.style.height !== height) spacer.style.height = height;
    const keep = new Set<string>();
    for (let i = w.first; i < w.last; i++) {
      const isExtra = i >= view.count;
      const row = isExtra ? undefined : view.at(i);
      const key = row === undefined ? EXTRA : row.key;
      keep.add(key);
      const sig = row === undefined ? (view.failed ? 'failed' : 'loading') : `${row.rank}|${row.name}|${row.total}|${row.me}`;
      let entry = drawn.get(key);
      if (entry === undefined) {
        const node = row === undefined ? extraRow(view) : el('div', 'hud-boardrow');
        node.setAttribute('role', 'listitem');
        node.tabIndex = -1;
        entry = { node, sig: '', index: -1 };
        drawn.set(key, entry);
        layer.append(node);
      }
      if (row !== undefined && entry.sig !== sig) fill(entry.node, row);
      if (entry.index !== i) {
        entry.node.style.transform = `translateY(${i * ROW_HEIGHT}px)`;
        entry.node.setAttribute('aria-posinset', String(i + 1));
        entry.node.setAttribute('aria-setsize', extra ? '-1' : String(view.count));
        entry.index = i;
      }
      entry.sig = sig;
    }
    for (const [key, entry] of drawn) {
      if (keep.has(key)) continue;
      entry.node.remove();
      drawn.delete(key);
    }
    if (w.last !== wanted) {
      wanted = w.last;
      handlers.want(Math.min(w.last, view.count));
    }
    updatePinned();
  };

  scroller.addEventListener('scroll', paint, { passive: true });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => paint()).observe(scroller);

  const goTo = (index: number): void => {
    if (view === undefined) return;
    paint();
    scroller.scrollTop = scrollForIndex(index, view.count + (view.loading || view.failed ? 1 : 0), scroller.clientHeight, scroller.scrollTop);
    paint();
    const target = view.at(index);
    drawn.get(target.key)?.node.focus({ preventScroll: true });
  };

  return {
    render(next) {
      view = next;
      if (next.version === shown) return;
      shown = next.version;
      const hasList = next.count > 0 || next.loading || next.failed;
      scroller.hidden = !hasList;
      empty.hidden = !(next.empty && next.mine === undefined && next.query.trim() === '');
      if (search.value !== next.query) search.value = next.query;
      mineButton.hidden = !next.canGoMine;
      note.textContent = next.note ?? '';
      status.hidden = next.note === undefined && !next.cancellable;
      cancel.hidden = !next.cancellable;
      scroller.setAttribute('aria-busy', String(next.loading));
      for (const [key, entry] of drawn) {
        if (key === EXTRA) {
          entry.node.remove();
          drawn.delete(key);
        }
      }
      paint();
      if (next.jump !== undefined) {
        goTo(next.jump);
        queueMicrotask(() => handlers.jumped());
      }
    },
  };
}
