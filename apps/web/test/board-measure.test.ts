// Measurement plan of spec 019 (a manual run, skipped in `npm test`): `MBRG_MEASURE=1 npx vitest run apps/web/test/board-measure.test.ts`.
// BEFORE: the whole leaderboard and roster read in pages of 500, merged, sorted, ranked and paged in memory.
import { describe, it } from 'vitest';
import { completeBoard, boardPage } from '../src/core/results-model';
import { createPlayNet } from '../src/ui/live-net';
import { boardServer, synthetic } from './helpers/board-server';
import { MATCH_ID } from './helpers/scripted-match';

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

describe.skipIf(process.env.MBRG_MEASURE !== '1')('measurement: today\'s board', () => {
  it('prints the table', async () => {
    const table: Record<string, unknown>[] = [];
    for (const n of [20, 200, 1000, 10000]) {
      const server = boardServer(synthetic(n));
      const net = createPlayNet({ base: 'http://fake', fetch: (url, init) => server.fetch(url, init) });
      const board = await net.leaderboard(MATCH_ID);
      const roster = await net.players(MATCH_ID);
      if (!board.ok || !roster.ok) throw new Error('read failed');
      const bytes = server.requests.reduce((sum, r) => sum + r.bytes, 0);
      const merged = completeBoard(board.value, roster.value);
      table.push({
        n,
        requests: server.requests.length,
        kb: Math.round(bytes / 1024),
        mergeMs: time(() => completeBoard(board.value, roster.value)),
        pageMs: time(() => boardPage(merged, 'player:p00001', 3)),
        heapRowsKb: Math.round((JSON.stringify(merged).length) / 1024),
      });
    }
    console.table(table);
  });
});
