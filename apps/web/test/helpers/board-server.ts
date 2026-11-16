/**
 * Synthetic players for the leaderboard of spec 019: N players with names (accents, long ones), points with many ties, a roster, and
 * the paged reads the server gives for them (`limit` and `cursor`, the cursor cut by a generation: a phase scored since is
 * `stale-cursor`). Pure data plus one injected `fetch`, so the viewer's Node tests and the measurement run use the same server.
 */
import { encodeError } from '@mbrg/protocol';
import type { LeaderboardRow, PlayerListItem } from '@mbrg/protocol';

export interface Synthetic {
  /** Every player who joined, in join order. */
  readonly roster: readonly PlayerListItem[];
  /** The scored players, ranked (competition ranking) and ordered by rank then id. */
  readonly rows: readonly LeaderboardRow[];
}

const FIRST = ['Álvaro', 'María', 'José', 'Ana', 'Íñigo', 'Zoë', 'Nuño', 'Lucía', 'Pablo', 'Elena', 'Sergio', 'Inés'];
const LAST = ['García', 'López', 'Muñoz', 'Pérez', 'Ñandú', 'Sánchez', 'Gómez', 'Fernández', 'Díaz', 'Ruiz'];

/** Name `i` of the synthetic match: always valid under the name rule (1 to 24 characters); every 7th is long. */
export function nameFor(i: number): string {
  const base = `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]} ${i}`;
  return i % 7 === 3 ? `${base} Maximiliano Del Valle`.slice(0, 24).trimEnd() : base;
}

export const idFor = (i: number): string => `player:p${String(i).padStart(5, '0')}`;

/** `count` players; about 90% have points (the server lists scored players only), with 40 distinct totals so ties are common. */
export function synthetic(count: number, scoredShare = 0.9): Synthetic {
  const roster: PlayerListItem[] = [];
  const scored: { playerId: string; total: number; name: string }[] = [];
  for (let i = 0; i < count; i++) {
    const playerId = idFor(i);
    const name = nameFor(i);
    roster.push({ playerId, name, joinedSeq: i + 1 });
    if (i % 10 !== 9 || scoredShare >= 1) scored.push({ playerId, total: 1 + ((i * 7919) % 40) * 5, name });
  }
  scored.sort((a, b) => b.total - a.total || (a.playerId < b.playerId ? -1 : 1));
  const rows: LeaderboardRow[] = scored.map((p, i) => ({
    rank: i > 0 && (scored[i - 1] as { total: number }).total === p.total ? 0 : i + 1,
    playerId: p.playerId,
    total: p.total,
    correctVictims: 0,
    correctAbsorbers: 0,
    correctWinner: 0,
    name: p.name,
  }));
  // Ties share the rank of the first row of the tie.
  for (let i = 1; i < rows.length; i++) if ((rows[i] as { rank: number }).rank === 0) (rows[i] as { rank: number }).rank = (rows[i - 1] as { rank: number }).rank;
  return { roster, rows };
}

export interface BoardServer {
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** The scored phases so far: a cursor cut at another count is `stale-cursor`. */
  generation: number;
  /** The data served; a test may swap it (a phase was scored). */
  data: Synthetic;
  readonly requests: { readonly path: string; readonly query: string; readonly bytes: number }[];
}

const json = (body: string, status = 200): Response => new Response(body, { status, headers: { 'content-type': 'application/json' } });

/** A fetch answering `/matches/<id>/leaderboard` and `/matches/<id>/players` from `data`, paged like the server (cursor = generation:index). */
export function boardServer(data: Synthetic): BoardServer {
  const server: BoardServer = {
    generation: 1,
    data,
    requests: [],
    fetch: (input) => {
      const url = new URL(input);
      const limit = Number(url.searchParams.get('limit') ?? '50');
      const cursor = url.searchParams.get('cursor');
      const parts = url.pathname.split('/').filter((x) => x !== '');
      const read = (list: readonly unknown[], sensitive: boolean): Response => {
        let from = 0;
        if (cursor !== null) {
          const [g, at] = cursor.split(':').map(Number) as [number, number];
          if (sensitive && g !== server.generation) return json(encodeError({ kind: 'stale-cursor' }), 409);
          from = at;
        }
        const items = list.slice(from, from + limit);
        const next = from + limit < list.length ? { next: `${server.generation}:${from + limit}` } : {};
        return json(JSON.stringify({ items, ...next }));
      };
      let response: Response;
      if (parts[2] === 'leaderboard') response = read(server.data.rows, true);
      else if (parts[2] === 'players' && parts.length === 3) response = read(server.data.roster, false);
      else response = json(encodeError({ kind: 'unknown-path' }), 404);
      server.requests.push({ path: url.pathname, query: url.search, bytes: 0 });
      return response.clone().text().then((text) => {
        (server.requests[server.requests.length - 1] as { bytes: number }).bytes = text.length;
        return response;
      });
    },
  };
  return server;
}
