import { afterEach, describe, expect, it } from 'vitest';
import { DISCORD, KEY_A, KEY_B, WEB, createCommunityMatch, playMatch, populateRanking, postRanking, startHistory, walkRanking } from './helpers/ranking-kit';
import type { Client, RankPlayer, ServerHarness } from './helpers/ranking-kit';
import { closeAllServers } from './helpers/server-harness';

// Spec 025 NFR-124 (twin part): two communities x two client namespaces never mix. Four cells hold their own matches —
// the ranking population of KEY_A under the Discord namespace, one web match of KEY_A, one discord match of KEY_B and one web
// match of KEY_B — and every ranking read answers only the rows of its own cell: the same local id of another cell is another
// player, and no name, row or total crosses a key or a namespace. Key values and ids are planted literals.

afterEach(closeAllServers);

const WEB_A: RankPlayer[] = [{ client: WEB, local: 'wa1', name: 'Web Ana', victim: 'wrong', absorber: 'wrong', winner: 'wrong' }];
const DISCORD_B: RankPlayer[] = [
  { client: DISCORD, local: 'b1', name: 'Bea Primera', victim: 'wrong', absorber: 'wrong', winner: 'wrong' },
  { client: DISCORD, local: 'b2', victim: 'right', absorber: 'wrong', winner: 'wrong' },
];
const WEB_B: RankPlayer[] = [{ client: WEB, local: 'wb1', name: 'Web Bea', victim: 'wrong', absorber: 'right', winner: 'wrong' }];

interface Cell {
  readonly total: number;
  readonly ids: string[];
  readonly names: string[];
}

const cellOf = async (h: ServerHarness, client: Client, community: string): Promise<Cell> => {
  const walked = await walkRanking(h, client, { community }, 500);
  const rows = walked.pages.flatMap((p) => p.items);
  return { total: walked.pages[0]!.total, ids: rows.map((r) => String(r.playerId)), names: rows.map((r) => String(r.name ?? '')) };
};

describe('NFR-124 (twin part) two communities x two namespaces never mix', () => {
  it('NFR-124 (twin part) every read answers only the rows of its own key and namespace, names included, and a foreign cursor the empty page', async () => {
    const h = await startHistory();
    await populateRanking(h);
    // The other three cells, each with its own players and planted names.
    playMatch(h, await createCommunityMatch(h, WEB, 'web-a', KEY_A), WEB_A);
    playMatch(h, await createCommunityMatch(h, DISCORD, 'b-0', KEY_B), DISCORD_B);
    playMatch(h, await createCommunityMatch(h, WEB, 'web-b', KEY_B), WEB_B);

    // The four cells: the 18 discord players of KEY_A, one web player of KEY_A, the two discord players of KEY_B, one of KEY_B.
    const aDiscord = await cellOf(h, DISCORD, KEY_A);
    expect(aDiscord.total).toBe(18);
    expect(aDiscord.ids.every((id) => id.startsWith('discord:u'))).toBe(true);
    expect(aDiscord.names).toContain('Ana Segunda');
    const aWeb = await cellOf(h, WEB, KEY_A);
    expect(aWeb).toStrictEqual({ total: 1, ids: ['web:wa1'], names: ['Web Ana'] });
    const bDiscord = await cellOf(h, DISCORD, KEY_B);
    expect(bDiscord.ids).toStrictEqual(['discord:b1', 'discord:b2']);
    expect(bDiscord.total).toBe(2);
    expect(bDiscord.names).toContain('Bea Primera');
    const bWeb = await cellOf(h, WEB, KEY_B);
    expect(bWeb).toStrictEqual({ total: 1, ids: ['web:wb1'], names: ['Web Bea'] });
    // No cell ever answers a row, a name or a total of another: each planted name appears in its own cell only.
    for (const names of [aDiscord.names, bDiscord.names, bWeb.names]) expect(names).not.toContain('Web Ana');
    for (const names of [aWeb.names, bDiscord.names, bWeb.names]) expect(names).not.toContain('Ana Segunda');
    for (const names of [aDiscord.names, aWeb.names, bWeb.names]) expect(names).not.toContain('Bea Primera');
    for (const names of [aDiscord.names, aWeb.names, bDiscord.names]) expect(names).not.toContain('Web Bea');
    for (const ids of [aDiscord.ids, bDiscord.ids]) {
      expect(ids).not.toContain('web:wa1');
      expect(ids).not.toContain('web:wb1');
    }
    // A cursor of one cell's walk read under another cell's credential answers the empty page, never the other's rows.
    const first = await walkRanking(h, DISCORD, { community: KEY_B }, 1);
    const cross = await postRanking(h, WEB.credential, { community: KEY_B, cursor: first.pages[0]!.next! });
    expect([cross.status, cross.text]).toStrictEqual([200, '{"items":[],"total":0}']);
  });
});
