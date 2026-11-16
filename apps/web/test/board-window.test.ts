import { describe, expect, it } from 'vitest';
import { MAX_DOM_ROWS, ROW_HEIGHT, scrollForIndex, windowOf } from '../src/core/board-window';

describe('FR-508 NFR-105 windowing', () => {
  it('draws only the rows in or near the view, with the offset and the height of the whole list', () => {
    const w = windowOf(1000, 0, 440);
    expect(w.first).toBe(0);
    expect(w.last).toBeGreaterThanOrEqual(Math.ceil(440 / ROW_HEIGHT));
    expect(w.last).toBeLessThanOrEqual(MAX_DOM_ROWS);
    expect(w.height).toBe(1000 * ROW_HEIGHT);
    expect(w.top).toBe(0);
  });

  it('starts before the first visible row (overscan) and places the rows at their offset', () => {
    const w = windowOf(1000, 500 * ROW_HEIGHT, 440);
    expect(w.first).toBeLessThan(500);
    expect(w.last).toBeGreaterThan(500 + Math.floor(440 / ROW_HEIGHT));
    expect(w.top).toBe(w.first * ROW_HEIGHT);
  });

  it('never draws more than the cap, whatever the size of the list or of the view', () => {
    for (const count of [0, 1, 5, 60, 61, 1000, 10000]) {
      for (const viewport of [0, 100, 440, 2000, 10000]) {
        for (const scroll of [0, 12345, count * ROW_HEIGHT]) {
          const w = windowOf(count, scroll, viewport);
          expect(w.last - w.first).toBeLessThanOrEqual(MAX_DOM_ROWS);
          expect(w.first).toBeGreaterThanOrEqual(0);
          expect(w.last).toBeLessThanOrEqual(count);
        }
      }
    }
  });

  it('clamps a scroll past the end and handles the empty list', () => {
    const end = windowOf(100, 10 ** 9, 440);
    expect(end.last).toBe(100);
    expect(end.first).toBeGreaterThanOrEqual(100 - MAX_DOM_ROWS);
    expect(windowOf(0, 0, 440)).toEqual({ first: 0, last: 0, top: 0, height: 0 });
  });

  it('is a pure function of its arguments', () => {
    expect(windowOf(777, 4321, 500)).toEqual(windowOf(777, 4321, 500));
  });
});

describe('FR-511 scroll to a row', () => {
  it('centres the row when it is out of the view and keeps the scroll when it is in the view', () => {
    const view = 440;
    const to = scrollForIndex(300, 1000, view, 0);
    expect(to).toBeGreaterThan(0);
    expect(to).toBeLessThanOrEqual(300 * ROW_HEIGHT);
    expect(to + view).toBeGreaterThanOrEqual(301 * ROW_HEIGHT);
    expect(scrollForIndex(300, 1000, view, to)).toBe(to);
  });

  it('never scrolls beyond the content', () => {
    expect(scrollForIndex(999, 1000, 440, 0)).toBeLessThanOrEqual(1000 * ROW_HEIGHT - 440);
    expect(scrollForIndex(0, 1000, 440, 5000)).toBe(0);
  });
});
