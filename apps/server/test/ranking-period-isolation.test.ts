import { afterEach, describe, expect, it, vi } from 'vitest';
import { DISCORD, KEY_A, KEY_B, WEB, createCommunityMatch, playMatch, populateSpread, postRanking, startHistory, walkRanking } from './helpers/ranking-kit';
import type { Client, RankPlayer, ServerHarness } from './helpers/ranking-kit';
import { put } from './helpers/history-rows';
import { closeAllServers } from './helpers/server-harness';

// Spec 027 NFR-127 and NFR-128 (twin part): the isolation twin of 025 NFR-124, in each period. Two communities x two client
// namespaces never mix, in the last 7 days, the last 30 days and all time. Four cells hold their own matches: KEY_A under the
// Discord namespace (the spread population: seven matches over 33 days, the oldest out of the month), one web match of KEY_A,
// KEY_B under Discord (an OLD match 67 days back, out of every window, and a recent one) and one web match of KEY_B. Every
// ranking read of a period answers only the rows of its own cell: the same local id of another cell is another player, and no
// name, row or total crosses a key, a namespace or the edge of a window. Key values and names are planted literals.

vi.setConfig({ testTimeout: 180_000 });
afterEach(closeAllServers);

const DAY = 86_400_000;
const PERIODS = ['last-7-days', 'last-30-days', 'all'] as const;
type Period = (typeof PERIODS)[number];

const DISCORD_B_OLD: RankPlayer[] = [{ client: DISCORD, local: 'b0', name: 'Bea Vieja', victim: 'wrong', absorber: 'wrong', winner: 'wrong' }];
const WEB_A: RankPlayer[] = [{ client: WEB, local: 'wa1', name: 'Web Ana', victim: 'wrong', absorber: 'wrong', winner: 'wrong' }];
const DISCORD_B: RankPlayer[] = [
  { client: DISCORD, local: 'b1', name: 'Bea Primera', victim: 'wrong', absorber: 'wrong', winner: 'wrong' },
  { client: DISCORD, local: 'b2', victim: 'right', absorber: 'wrong', winner: 'wrong' },
  // A local id that also plays in the KEY_A cell and has no name there: the name planted here must never reach it.
  { client: DISCORD, local: 'u41', name: 'Cross Key Name', victim: 'wrong', absorber: 'wrong', winner: 'wrong' },
];
const WEB_B: RankPlayer[] = [{ client: WEB, local: 'wb1', name: 'Web Bea', victim: 'wrong', absorber: 'right', winner: 'wrong' }];

interface Cell {
  readonly total: number;
  readonly ids: string[];
  readonly names: string[];
}

const cellOf = async (h: ServerHarness, client: Client, community: string, period: Period): Promise<Cell> => {
  const walked = await walkRanking(h, client, { community, ...(period === 'all' ? {} : { period }) }, 500);
  const rows = walked.pages.flatMap((p) => p.items);
  return { total: walked.pages[0]!.total, ids: rows.map((r) => String(r.playerId)), names: rows.map((r) => String(r.name ?? '')) };
};

describe('NFR-128 (twin part) two communities x two namespaces never mix, in any period', () => {
  it('NFR-128 (twin part) every read answers only the rows of its own key and namespace inside its period, names included, and a foreign windowed cursor the empty page', async () => {
    const h = await startHistory();
    // The old match of the KEY_B discord cell goes first: 34 days pass, then the KEY_A spread (33 more days), so it ends up
    // about 67 days behind the clock, out of every window; the other cells play last, inside both windows.
    playMatch(h, await createCommunityMatch(h, DISCORD, 'b-old', KEY_B), DISCORD_B_OLD);
    h.clock.advance(34 * DAY);
    // The old KEY_B match consumed the known secret of the harness: the spread plays arbitrary picks.
    const spread = await populateSpread(h, undefined, false);
    // A name row planted under a DISCORD player id inside a WEB match of KEY_A, older than the discord head and inside both windows
    // (data the API cannot produce: the name key carries its namespace): the namespace condition of the names read alone keeps it out.
    put(h.base.store, { id: 'zzzzzzzzzzzzzzz1', at: spread.finishedAt[6]! - 1000, community: KEY_A, namespace: 'web' });
    h.base.store.transaction(() => h.base.store.putClientName('zzzzzzzzzzzzzzz1', 'discord:u43', 'Foreign Namespace Name'));
    // The same for another community: a discord match of KEY_B, older than the KEY_A head and inside both windows, names a player
    // who plays in the KEY_A cell (the played KEY_B matches are newer than that head, so the head bound alone would not hide them).
    put(h.base.store, { id: 'zzzzzzzzzzzzzzz2', at: spread.finishedAt[6]! - 2000, community: KEY_B, namespace: 'discord' });
    h.base.store.transaction(() => h.base.store.putClientName('zzzzzzzzzzzzzzz2', 'discord:u42', 'Foreign Key Name'));
    playMatch(h, await createCommunityMatch(h, WEB, 'web-a', KEY_A), WEB_A);
    playMatch(h, await createCommunityMatch(h, DISCORD, 'b-0', KEY_B), DISCORD_B);
    playMatch(h, await createCommunityMatch(h, WEB, 'web-b', KEY_B), WEB_B);

    // The expected totals: week 6 + 0, month 18 (the spread's oldest match, u00 only, is out), all time 19; KEY_B discord: the
    // old player only in all time.
    const expectedA: Record<Period, number> = { 'last-7-days': 6, 'last-30-days': 18, all: 19 };
    const expectedB: Record<Period, string[]> = {
      'last-7-days': ['discord:b1', 'discord:b2', 'discord:u41'],
      'last-30-days': ['discord:b1', 'discord:b2', 'discord:u41'],
      all: ['discord:b0', 'discord:b1', 'discord:b2', 'discord:u41'],
    };
    for (const period of PERIODS) {
      const aDiscord = await cellOf(h, DISCORD, KEY_A, period);
      expect(aDiscord.total, period).toBe(expectedA[period]);
      expect(aDiscord.ids.every((id) => id.startsWith('discord:u')), period).toBe(true);
      const aWeb = await cellOf(h, WEB, KEY_A, period);
      expect(aWeb, period).toStrictEqual({ total: 1, ids: ['web:wa1'], names: ['Web Ana'] });
      const bDiscord = await cellOf(h, DISCORD, KEY_B, period);
      expect([...bDiscord.ids].sort(), period).toStrictEqual(expectedB[period]);
      expect(bDiscord.total, period).toBe(expectedB[period].length);
      expect(bDiscord.names, period).toContain('Bea Primera');
      // The old player's name shows only in the period that holds their match: never in a window.
      expect(bDiscord.names.includes('Bea Vieja'), period).toBe(period === 'all');
      const bWeb = await cellOf(h, WEB, KEY_B, period);
      expect(bWeb, period).toStrictEqual({ total: 1, ids: ['web:wb1'], names: ['Web Bea'] });
      // The names of the matches outside the window never show: u2's only name sits in the oldest match (out of the month), the
      // week holds no row of u2 at all; all time shows it. No name of another key or namespace reaches the discord KEY_A rows.
      expect(aDiscord.names.includes('Bea'), period).toBe(period === 'all');
      expect(aDiscord.names, period).not.toContain('Cross Key Name');
      expect(aDiscord.names, period).not.toContain('Foreign Namespace Name');
      expect(aDiscord.names, period).not.toContain('Foreign Key Name');
      expect(aWeb.names, period).not.toContain('Foreign Namespace Name');
      // No cell ever answers a row, a name or a total of another.
      for (const names of [aDiscord.names, bDiscord.names, bWeb.names]) expect(names, period).not.toContain('Web Ana');
      for (const names of [aWeb.names, bDiscord.names, bWeb.names]) expect(names, period).not.toContain('Ana Segunda');
      for (const names of [aDiscord.names, aWeb.names, bWeb.names]) expect(names, period).not.toContain('Bea Primera');
      for (const names of [aDiscord.names, aWeb.names, bDiscord.names]) expect(names, period).not.toContain('Web Bea');
      for (const ids of [aDiscord.ids, bDiscord.ids]) {
        expect(ids, period).not.toContain('web:wa1');
        expect(ids, period).not.toContain('web:wb1');
      }
      // A cursor of one cell's walk read under another cell's credential answers the empty page, never the other's rows.
      const first = await walkRanking(h, DISCORD, { community: KEY_B, ...(period === 'all' ? {} : { period }) }, 1);
      const cross = await postRanking(h, WEB.credential, { community: KEY_B, ...(period === 'all' ? {} : { period }), cursor: first.pages[0]!.next! });
      expect([cross.status, cross.text], period).toStrictEqual([200, '{"items":[],"total":0}']);
      // The same cursor under the other community key (a key that holds no such walk): the empty page.
      const acrossKeys = await postRanking(h, DISCORD.credential, { community: KEY_A, ...(period === 'all' ? {} : { period }), cursor: first.pages[0]!.next! });
      expect([acrossKeys.status, acrossKeys.text], period).toStrictEqual([200, '{"items":[],"total":0}']);
    }
    // Eleven or more matches played over HTTP plus the walks: the timeout of the file is explicit.
  });
});
