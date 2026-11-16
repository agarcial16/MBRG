/**
 * The debug scene of spec 019: a vite dev server whose middleware plays the match server for the scripted dev-map match
 * (3 rounds applied, fixed seed) with `MBRG_DEBUG_PLAYERS` synthetic players (default 1000). Run with
 * `npx vite apps/web --config apps/web/test/helpers/board-debug.vite.config.ts`, then open
 * `http://localhost:5173/?match=AbCdEfGh01234567`. Development helper only: nothing in the product imports it.
 */
import { encodeError } from '@mbrg/protocol';
import { createFakeServer } from './fake-server';
import { boardServer, synthetic, type BoardServer } from './board-server';
import { MATCH_ID, scripted } from './scripted-match';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export interface DebugScene {
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  readonly board: BoardServer;
}

export async function debugScene(players: number, appliedRounds = 3): Promise<DebugScene> {
  const s = await scripted();
  const match = await createFakeServer(s, appliedRounds);
  const board = boardServer(synthetic(players));
  return {
    board,
    fetch: (url, init) => {
      const parts = new URL(url).pathname.split('/').filter((x) => x !== '');
      if (parts[0] === 'matches' && parts[1] === MATCH_ID) {
        if (parts[2] === 'leaderboard' || (parts[2] === 'players' && parts.length === 3)) return board.fetch(url);
        if (parts[2] === 'players' && parts[4] === 'results') {
          const mine = board.data.rows.find((r) => r.playerId === decodeURIComponent(parts[3] as string));
          return Promise.resolve(mine === undefined ? json(encodeError({ kind: 'unknown-player' }), 404) : json({ playerId: mine.playerId, total: mine.total, items: [], name: mine.name }));
        }
        if (parts[2] === 'results') return Promise.resolve(json({ round: Number(parts[3]), phase: Number(parts[4]), items: [] }));
        if (parts[2] === 'predictions') return Promise.resolve(json({ items: [] }));
      }
      return match.fetch(url, init);
    },
  };
}
