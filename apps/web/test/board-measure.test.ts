// Measurement plan of spec 019 (a manual run, skipped in `npm test`): `MBRG_MEASURE=1 npx vitest run apps/web/test/board-measure.test.ts`.
// BEFORE (commit 7875e0d): the whole leaderboard and roster read in pages of 500, merged, sorted, ranked and paged in memory.
// AFTER (spec 019): one page on open, a page merged without sorting, the window of rows computed by `windowOf`.
import { describe, it } from 'vitest';
import { boardAfterPage, boardBegin, boardRefresh, boardView, emptyBoard, nextFetch } from '../src/core/board-model';
import { windowOf } from '../src/core/board-window';
import { boardServer, synthetic } from './helpers/board-server';

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;
const time = (run: () => void, times = 9): number => {
  const out: number[] = [];
  for (let i = 0; i < times; i++) {
    const t = performance.now();
    run();
    out.push(performance.now() - t);
  }
  return Number(median(out).toFixed(3));
};

describe.skipIf(process.env.MBRG_MEASURE !== '1')('measurement: the windowed board', () => {
  it('prints the table', async () => {
    const table: Record<string, unknown>[] = [];
    for (const n of [1000, 10000]) {
      const server = boardServer(synthetic(n));
      let state = boardRefresh(emptyBoard(''));
      const read = nextFetch(state);
      if (read === undefined) throw new Error('no read');
      const response = await server.fetch(`http://fake/matches/m/leaderboard?limit=500`);
      const page = (await response.json()) as { items: never[]; next?: string };
      const bytes = server.requests[0]!.bytes;
      const mergeMs = time(() => boardAfterPage(boardBegin(boardRefresh(emptyBoard(''))), read, page));
      state = boardAfterPage(boardBegin(state), read, page);
      const view = boardView(state);
      const paintMs = time(() => {
        const w = windowOf(view.count, 3000, 440);
        for (let i = w.first; i < w.last; i++) view.at(i);
      });
      table.push({ n, requestsOnOpen: server.requests.length, kbOnOpen: Math.round(bytes / 1024), mergePageMs: mergeMs, windowMs: paintMs, rowsHeld: view.count });
    }
    console.table(table);
  });
});describe.skipIf(process.env.MBRG_MEASURE !== '1')('measurement: the windowed board', () => {
  it('prints the table', async () => {
    const table: Record<string, unknown>[] = [];
    for (const n of [1000, 10000]) {
      const server = boardServer(synthetic(n));
      let state = boardRefresh(emptyBoard(''));
      const read = nextFetch(state);
      if (read === undefined) throw new Error('no read');
      const response = await server.fetch(`http://fake/matches/m/leaderboard?limit=500`);
      const page = (await response.json()) as { items: never[]; next?: string };
      const bytes = server.requests[0]!.bytes;
      const mergeMs = time(() => boardAfterPage(boardBegin(boardRefresh(emptyBoard(''))), read, page));
      state = boardAfterPage(boardBegin(state), read, page);
      const view = boardView(state);
      const paintMs = time(() => {
        const w = windowOf(view.count, 3000, 440);
        for (let i = w.first; i < w.last; i++) view.at(i);
      });
      table.push({ n, requestsOnOpen: server.requests.length, kbOnOpen: Math.round(bytes / 1024), mergePageMs: mergeMs, windowMs: paintMs, rowsHeld: view.count });
    }
    console.table(table);
  });
});
