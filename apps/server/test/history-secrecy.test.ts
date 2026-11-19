import { afterEach, describe, expect, it } from 'vitest';
import { DISCORD, KEY_A, KEY_B, KEY_Z, WEB, createCommunityMatch, playMatch, playSteps, postHistory, startHistory, walk } from './helpers/history-kit';
import type { Player } from './helpers/history-kit';
import { closeAllServers } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';

// Spec 024 NFR-117 and FR-561 (the twin): a match of the same community that is not finished (a lobby, or running with its
// predictions stored and scored) never shows in a history reply, never changes its total and never changes one byte of it, before or
// after any of its steps. Two servers are built the same way (same clock, same random source, so the same match ids and instants);
// the second one holds in addition the unfinished matches of the same key, under both namespaces. Every reply of the first must
// equal, byte for byte, the reply of the twin without them, at every step. The twin proves nothing unless the finish DOES change
// the reply, so the last check is the opposite one.

afterEach(closeAllServers);

const ANA: Player = { client: DISCORD, local: 'u1', name: 'Ana', victim: 'right', absorber: 'right', winner: 'right' };
const BEA: Player = { client: DISCORD, local: 'u2', name: 'Bea', victim: 'right', absorber: 'wrong', winner: 'wrong' };
const CAL: Player = { client: DISCORD, local: 'u3', victim: 'wrong', absorber: 'wrong', winner: 'wrong' };
const WEBBY: Player = { client: WEB, local: 'w1', name: 'Web', victim: 'right', absorber: 'right', winner: 'right' };

// The players of the unfinished matches have names no finished match holds: a name stored while a match runs that reached a reply
// would show in the bytes of the compared replies (and in the plain check below), never hide behind a name of the finished ones.
const PLANTED = 'Planted-Run-';
const RUN_ANA: Player = { ...ANA, name: PLANTED + 'Zed' };
const RUN_BEA: Player = { ...BEA, name: PLANTED + 'Quy' };
const RUN_CAL: Player = { ...CAL, name: PLANTED + 'Xo' };
const RUN_WEB: Player = { ...WEBBY, name: PLANTED + 'Web' };
const RUNNERS = [RUN_ANA, RUN_BEA, RUN_CAL];

/** The finished history both twins share: four matches of KEY_A (two namespaces) and one of KEY_B. */
async function finished(h: ServerHarness, known = true): Promise<void> {
  playMatch(h, await createCommunityMatch(h, DISCORD, 'f-1', KEY_A), [ANA, BEA, CAL], known);
  playMatch(h, await createCommunityMatch(h, DISCORD, 'f-2', KEY_A), []);
  playMatch(h, await createCommunityMatch(h, WEB, 'f-3', KEY_A), [WEBBY]);
  playMatch(h, await createCommunityMatch(h, DISCORD, 'f-4', KEY_A), []);
  playMatch(h, await createCommunityMatch(h, DISCORD, 'f-5', KEY_B), []);
}

const BODIES = [
  { community: KEY_A },
  { community: KEY_A, playerId: 'u1' },
  { community: KEY_A, playerId: 'u9' },
  { community: KEY_A, limit: 2, playerId: 'u2' },
  { community: KEY_A, limit: 500 },
  { community: KEY_B },
];

/** Every reply a caller can get about the community, whole (status, headers but the wall-clock date, bytes): both namespaces, pages and walks by cursors. */
async function replies(h: ServerHarness): Promise<string[]> {
  const out: string[] = [];
  for (const client of [DISCORD, WEB]) {
    for (const body of BODIES) {
      const reply = await postHistory(h, client.credential, body);
      out.push(`${reply.status}\n${JSON.stringify({ ...reply.headers, date: undefined })}\n${reply.text}`);
    }
  }
  for (const size of [1, 2, 3]) out.push(...(await walk(h, DISCORD, { community: KEY_A, playerId: 'u1' }, size)).texts);
  return out;
}

const totalOf = async (h: ServerHarness): Promise<number> => ((await postHistory(h, DISCORD.credential, { community: KEY_A })).json() as { total: number }).total;

describe('NFR-117 FR-561 the twin of an unfinished match of the same community', () => {
  it('NFR-117 FR-561 lobbies and running matches of the key, under both namespaces, with scored predictions, leave every reply byte for byte as the twin\'s at every step', async () => {
    const twin = await startHistory();
    const real = await startHistory();
    await finished(twin);
    await finished(real);
    const base = await replies(twin);
    expect(base.length).toBeGreaterThan(15);
    expect(await totalOf(twin)).toBe(3);
    expect(await replies(real)).toStrictEqual(base);

    // Lobbies of the key (not started), one for each namespace.
    await createCommunityMatch(real, DISCORD, 'u-lobby', KEY_A);
    await createCommunityMatch(real, WEB, 'u-web-lobby', KEY_A);
    expect(await replies(real)).toStrictEqual(base);

    // A running match of the key under each namespace with predictions stored: step by step, the web one one step behind.
    const running = await createCommunityMatch(real, DISCORD, 'u-run', KEY_A);
    const webRunning = await createCommunityMatch(real, WEB, 'u-web-run', KEY_A);
    const web = playSteps(real, webRunning, [RUN_WEB], false);
    const watched: number[] = [];
    let scoredRows = 0;
    for (const done of playSteps(real, running, RUNNERS, false)) {
      watched.push(done);
      if (done > 0) web.next();
      if (done === 12) break;
      const shown = real.service.readPublicMatch(running.id);
      // Started and not finished: the stage is neither the lobby nor the end.
      expect(shown.ok ? shown.reply.stage : 'unreadable', `stage after ${done} steps`).not.toMatch(/^(finished|lobby|expired|unreadable)$/);
      scoredRows = Math.max(scoredRows, real.base.store.leaderboardTotals(running.id).length);
      const now = await replies(real);
      expect(now, `after ${done} steps of the match`).toStrictEqual(base);
      expect(now.join('\n'), `after ${done} steps`).not.toContain(PLANTED);
    }
    expect(watched).toStrictEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // The rounds applied before the finish scored three players: the data was there to leak.
    expect(scoredRows).toBeGreaterThanOrEqual(3);

    // The control: the finish is the one thing that changes the reply, and only by that match, first in the list.
    expect(await totalOf(real)).toBe(4);
    expect(await replies(real)).not.toStrictEqual(base);
    const page = (await postHistory(real, DISCORD.credential, { community: KEY_A, limit: 1 })).json() as { items: { matchId: string }[] };
    expect(page.items[0]?.matchId).toBe(running.id);
    // The web match is still running: the web history did not gain it.
    const webPage = (await postHistory(real, WEB.credential, { community: KEY_A })).json() as { total: number; items: { matchId: string }[] };
    expect(webPage.total).toBe(1);
    expect(webPage.items.map((i) => i.matchId)).not.toContain(webRunning.id);
  }, 120_000);

  it('NFR-117 FR-561 a running match OLDER than the finished ones, stalled while they finished, is in no total either: the twin has it under another key', async () => {
    const twin = await startHistory();
    const real = await startHistory();
    // The same draws on both servers: only the key of the first match differs (KEY_A in the real one, another key in the twin).
    const oldReal = playSteps(real, await createCommunityMatch(real, DISCORD, 'u-old', KEY_A), RUNNERS, true);
    const oldTwin = playSteps(twin, await createCommunityMatch(twin, DISCORD, 'u-old', KEY_Z), RUNNERS, true);
    for (let i = 0; i <= 5; i += 1) {
      oldReal.next();
      oldTwin.next();
    }
    await finished(real, false);
    await finished(twin, false);
    // The stalled match last stepped before every finished one: the head of the history does not exclude it by its instant.
    const base = await replies(twin);
    expect(await totalOf(twin)).toBe(3);
    expect(await replies(real)).toStrictEqual(base);
    for (let done = 6; done < 12; done += 1) {
      oldReal.next();
      oldTwin.next();
      expect(await replies(real), `after ${done} steps of the older match`).toStrictEqual(base);
    }
    expect(await totalOf(real)).toBe(3);
  }, 120_000);

  it('NFR-117 FR-561 a running match does not move the snapshot of a walk in progress, before or after its steps', async () => {
    const real = await startHistory();
    await finished(real);
    const first = (await postHistory(real, DISCORD.credential, { community: KEY_A, limit: 1 })).json() as { next: string; total: number };
    const running = await createCommunityMatch(real, DISCORD, 'u-run', KEY_A);
    const seen: string[] = [];
    for (const done of playSteps(real, running, [RUN_ANA, RUN_BEA], false)) {
      if (done === 12) break;
      const reply = await postHistory(real, DISCORD.credential, { community: KEY_A, limit: 1, cursor: first.next });
      seen.push(reply.text);
    }
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(1);
    expect(first.total).toBe(3);
  }, 60_000);
});
