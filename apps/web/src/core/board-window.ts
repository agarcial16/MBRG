// Windowed rendering of the leaderboard (spec 019 FR-508, NFR-105): which rows of a long list are drawn for a scroll position. Pure:
// numbers in, numbers out. The panel keeps a spacer of the full height and draws only `[first, last)` at `top`.

/** The height of one row in pixels: also the touch target of a row (NFR-108). */
export const ROW_HEIGHT = 44;
/** The rows drawn at most, at any list size (NFR-105). */
export const MAX_DOM_ROWS = 60;
/** The rows drawn beyond the view on each side, so a short scroll shows no gap. */
const OVERSCAN = 8;

export interface RowWindow {
  /** The first row drawn. */
  readonly first: number;
  /** One past the last row drawn. */
  readonly last: number;
  /** The offset of the first row from the top of the list, in pixels. */
  readonly top: number;
  /** The height of the whole list, in pixels. */
  readonly height: number;
}

/** The rows to draw for a list of `count` rows, a scroll position and a view height (all pixels). */
export function windowOf(count: number, scrollTop: number, viewport: number, rowHeight = ROW_HEIGHT): RowWindow {
  if (count <= 0) return { first: 0, last: 0, top: 0, height: 0 };
  const height = count * rowHeight;
  const scroll = Math.min(Math.max(0, scrollTop), Math.max(0, height - viewport));
  const visibleFirst = Math.floor(scroll / rowHeight);
  const visibleLast = Math.min(count, Math.ceil((scroll + Math.max(0, viewport)) / rowHeight));
  let first = Math.max(0, visibleFirst - OVERSCAN);
  let last = Math.min(count, visibleLast + OVERSCAN);
  if (last - first > MAX_DOM_ROWS) {
    // A view taller than the cap (or a large overscan): keep the first visible rows, drop the far side.
    last = first + MAX_DOM_ROWS;
    if (last > count) {
      last = count;
      first = Math.max(0, count - MAX_DOM_ROWS);
    }
  }
  return { first, last, top: first * rowHeight, height };
}

/** The scroll position that shows row `index`: unchanged when the row is already in the view, else the row centred (kept inside the content). */
export function scrollForIndex(index: number, count: number, viewport: number, current: number, rowHeight = ROW_HEIGHT): number {
  const max = Math.max(0, count * rowHeight - viewport);
  const top = index * rowHeight;
  if (top >= current && top + rowHeight <= current + viewport) return Math.min(current, max);
  return Math.min(max, Math.max(0, top - Math.floor((viewport - rowHeight) / 2)));
}
