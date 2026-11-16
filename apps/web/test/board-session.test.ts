import { describe, expect, it } from 'vitest';
import { encodeEvent } from '@mbrg/protocol';
import type { LiveModel } from '../src/core/live-model';
import { createPlayNet } from '../src/ui/live-net';
import { createPlaySession } from '../src/ui/play-session';
import { boardServer, idFor, synthetic, type BoardServer } from './helpers/board-server';
import { Driver, MATCH_ID, eventsOfRound, scripted } from './helpers/scripted-match';

const factions = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `F${i + 1}` }));
const idle = { revealing: false, absorbing: false };
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const ticks = async (n = 6): Promise<void> => {
  for (let i = 0; i < n; i++) await tick();
};
const resultsFrame = (round: number, phase: 1 | 2): unknown => JSON.parse(encodeEvent({ type: 'results', seq: 99, round, phase }));

async function model(): Promise<LiveModel> {
  const s = await scripted();
  const d = new Driver(s, MATCH_ID);
  await d.load(0);
  await d.events(eventsOfRound(s, 1).slice(0, 3));
  return d.model;
}

/** A real `PlayNet` over the synthetic server: the other reads answer empty. */
function open(count: number, me?: string): { server: BoardServer; session: ReturnType<typeof createPlaySession> } {
  const server = boardServer(synthetic(count));
  const answer = (url: string, init?: RequestInit): Promise<Response> => {
    const parts = new URL(url).pathname.split('/').filter((x) => x !== '');
    if (parts[2] === 'leaderboard' || (parts[2] === 'players' && parts.length === 3)) return server.fetch(url, init);
    if (parts[2] === 'players') return Promise.resolve(new Response(JSON.stringify({ playerId: parts[3], total: 0, items: [] }), { status: 200 }));
    if (parts[2] === 'predictions') return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    return Promise.resolve(new Response(JSON.stringify({ round: 1, phase: 1, items: [] }), { status: 200 }));
  };
  const net = createPlayNet({ base: 'http://fake', fetch: (url, init) => answer(url, init) });
  const player = me === undefined ? undefined : { playerId: me, token: 'T0kenT0kenT0kenT0kenT0kenT0ken_-' };
  const session = createPlaySession({ matchId: MATCH_ID, net, player, factions, pageUrl: 'https://mbrg.test/', makeId: () => 'req-0123456789abcdef0123456789abcdef', changed: () => undefined });
  return { server, session };
}

const paths = (server: BoardServer): string[] => server.requests.map((r) => `${r.path.split('/').pop()}${r.query}`);
const leaderboardPaths = (server: BoardServer): string[] => paths(server).filter((p) => p.startsWith('leaderboard'));

describe('FR-507 FR-508 the session reads the board page by page', () => {
  it('opens a 10,000-player match with one leaderboard page and no roster read, as a spectator', async () => {
    const { server, session } = open(10000);
    const m = await model();
    session.view(m, 0, idle);
    await ticks();
    expect(paths(server)).toEqual(['leaderboard?limit=500']);
    const view = session.view(m, 0, idle).board!;
    expect(view.count).toBe(500);
    expect(view.canGoMine).toBe(false);
  });

  it('reads the next page when the screen scrolls near the end of the loaded rows, and not before', async () => {
    const { server, session } = open(10000);
    const m = await model();
    session.view(m, 0, idle);
    await ticks();
    session.handlers.onBoardWant(100);
    await ticks();
    expect(server.requests).toHaveLength(1);
    session.handlers.onBoardWant(480);
    await ticks();
    expect(paths(server)).toEqual(['leaderboard?limit=500', 'leaderboard?limit=500&cursor=1%3A500']);
    expect(session.view(m, 0, idle).board!.count).toBe(1000);
  });

  it('FR-510 a scored phase reloads from the first page and the viewer keeps the rows they were reading', async () => {
    const { server, session } = open(3000);
    const m = await model();
    session.view(m, 0, idle);
    await ticks();
    session.handlers.onBoardWant(900);
    await ticks();
    expect(session.view(m, 0, idle).board!.count).toBeGreaterThanOrEqual(900);
    server.generation++;
    session.onFrame(resultsFrame(1, 1));
    await ticks(10);
    expect(leaderboardPaths(server).slice(-2)[0]).toBe('leaderboard?limit=500');
    expect(session.view(m, 0, idle).board!.count).toBeGreaterThanOrEqual(900);
  });

  it('FR-510 a stale cursor in the middle of a scroll restarts from the first page', async () => {
    const { server, session } = open(3000);
    const m = await model();
    session.view(m, 0, idle);
    await ticks();
    server.generation++;
    session.handlers.onBoardWant(900);
    await ticks(10);
    const reads = leaderboardPaths(server);
    expect(reads[1]).toBe('leaderboard?limit=500&cursor=1%3A500');
    expect(reads[2]).toBe('leaderboard?limit=500');
    expect(session.view(m, 0, idle).board!.count).toBeGreaterThanOrEqual(900);
    expect(session.view(m, 0, idle).board!.failed).toBe(false);
  });
});

describe('FR-516 secrecy during a tour', () => {
  it('keeps the rows shown before the tour while it runs, reads nothing, and shows the new scores once it ends', async () => {
    const { server, session } = open(300);
    const m = await model();
    session.view(m, 0, idle);
    await ticks();
    const top = session.view(m, 0, idle).board!.at(0);
    server.generation++;
    server.data = { ...server.data, rows: server.data.rows.map((r, i) => (i === 0 ? { ...r, total: r.total + 1000 } : r)) };
    const during = { revealing: true, absorbing: false };
    session.view(m, 0, during);
    const requests = server.requests.length;
    session.onFrame(resultsFrame(1, 1));
    session.handlers.onBoardWant(280);
    await ticks();
    expect(server.requests).toHaveLength(requests);
    expect(session.view(m, 0, during).board!.at(0)).toEqual(top);
    session.view(m, 0, idle);
    await ticks(10);
    expect(session.view(m, 0, idle).board!.at(0).total).toBe(top.total + 1000);
  });

  it('shows nothing of the board when the first view is already inside a tour, and reads nothing', async () => {
    const { server, session } = open(300);
    const m = await model();
    const hud = session.view(m, 0, { revealing: true, absorbing: false });
    await ticks();
    expect(hud.board).toBeUndefined();
    expect(server.requests).toHaveLength(0);
    session.view(m, 0, idle);
    await ticks();
    expect(session.view(m, 0, idle).board).toBeDefined();
  });
});

describe('FR-511 FR-512 a player finds their place', () => {
  it('"go to my place" reads pages until the row is loaded, names the jump once and then clears it', async () => {
    const me = synthetic(10000).rows[3000]!.playerId;
    const { server, session } = open(10000, me);
    const m = await model();
    session.view(m, 0, idle);
    await ticks();
    expect(session.view(m, 0, idle).board!.canGoMine).toBe(true);
    expect(session.view(m, 0, idle).board!.mine?.index).toBeUndefined();
    session.handlers.onBoardMine();
    await ticks(12);
    const view = session.view(m, 0, idle).board!;
    expect(server.requests.length).toBeLessThanOrEqual(8);
    expect(view.jump).toBeDefined();
    expect(view.at(view.jump as number).key).toBe(me);
    session.handlers.onBoardJumped();
    expect(session.view(m, 0, idle).board!.jump).toBeUndefined();
  });

  it('FR-509 shows a retry control when a page fails and reads again only after the retry', async () => {
    const { server, session } = open(3000);
    const m = await model();
    session.view(m, 0, idle);
    await ticks();
    const real = server.fetch;
    let fail = true;
    (server as { fetch: BoardServer['fetch'] }).fetch = (url, init) => (fail ? Promise.resolve(new Response('{}', { status: 429 })) : real(url, init));
    session.handlers.onBoardWant(480);
    await ticks();
    expect(session.view(m, 0, idle).board!.failed).toBe(true);
    await ticks();
    fail = false;
    session.handlers.onBoardRetry();
    await ticks();
    expect(session.view(m, 0, idle).board!.failed).toBe(false);
    expect(session.view(m, 0, idle).board!.count).toBe(1000);
  });
});

describe('FR-513 search through the session', () => {
  it('reads the remaining pages for a search and lists the matches, accents and case ignored', async () => {
    const { server, session } = open(2000);
    const m = await model();
    session.view(m, 0, idle);
    await ticks();
    session.handlers.onBoardQuery('ALVARO garcia 1');
    await ticks(14);
    const view = session.view(m, 0, idle).board!;
    expect(server.requests.length).toBeGreaterThan(3);
    expect(view.count).toBeGreaterThan(0);
    for (let i = 0; i < view.count; i++) expect(view.at(i).name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()).toContain('alvaro garcia 1');
    session.handlers.onBoardQuery('');
    expect(session.view(m, 0, idle).board!.count).toBe(2000);
  });

  it('the synthetic ids are valid player ids', () => {
    expect(idFor(7)).toBe('player:p00007');
  });
});
