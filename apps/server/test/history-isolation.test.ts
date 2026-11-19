import { afterEach, describe, expect, it } from 'vitest';
import { DISCORD, KEY_A, KEY_B, KEY_C, KEY_Z, WEB, createCommunityMatch, playMatch, postHistory, startHistory, walk } from './helpers/history-kit';
import type { Client, HistoryBody, Player } from './helpers/history-kit';
import { closeAllServers } from './helpers/server-harness';
import type { ServerHarness } from './helpers/server-harness';

// Spec 024 NFR-119 (isolation): a reply for community A under namespace N never contains or counts a match of another community or
// another namespace. Two keys by two namespaces, a match without a key, and the same local player id in both namespaces; every
// combination is read whole, by pages of every size and with a cursor of another combination, and each reply holds exactly the
// matches of its own cell: no id, no player and no count of a neighbour.

afterEach(closeAllServers);

type Cell = 'A-discord' | 'A-web' | 'B-discord' | 'B-web';
const CELLS: readonly { cell: Cell; key: string; client: Client }[] = [
  { cell: 'A-discord', key: KEY_A, client: DISCORD },
  { cell: 'A-web', key: KEY_A, client: WEB },
  { cell: 'B-discord', key: KEY_B, client: DISCORD },
  { cell: 'B-web', key: KEY_B, client: WEB },
];
/** The same local id `u1` plays in every namespace: the namespace is the only thing that tells them apart. */
const playersOf = (client: Client): Player[] => [
  { client, local: 'u1', name: `${client.namespace}-one`, victim: 'right', absorber: 'right', winner: 'right' },
  { client, local: 'u2', name: `${client.namespace}-two`, victim: 'wrong', absorber: 'wrong', winner: 'wrong' },
];

interface Built {
  readonly h: ServerHarness;
  readonly ids: Record<Cell | 'none' | 'other-key', string[]>;
}

async function build(): Promise<Built> {
  const h = await startHistory();
  const ids: Built['ids'] = { 'A-discord': [], 'A-web': [], 'B-discord': [], 'B-web': [], none: [], 'other-key': [] };
  let n = 0;
  const make = async (cell: Cell | 'none' | 'other-key', client: Client, key: string | undefined, known: boolean): Promise<void> => {
    const made = await createCommunityMatch(h, client, `iso-${(n += 1)}`, key);
    playMatch(h, made, playersOf(client), known);
    ids[cell].push(made.id);
  };
  // The very first match of a server has the known secret (right picks). Interleave the cells so no cell is a block in the order.
  await make('A-discord', DISCORD, KEY_A, true);
  await make('B-web', WEB, KEY_B, false);
  await make('A-web', WEB, KEY_A, false);
  await make('B-discord', DISCORD, KEY_B, false);
  await make('A-discord', DISCORD, KEY_A, false);
  await make('none', DISCORD, undefined, false);
  await make('A-web', WEB, KEY_A, false);
  await make('other-key', DISCORD, KEY_C, false);
  await make('B-discord', DISCORD, KEY_B, false);
  await make('A-discord', DISCORD, KEY_A, false);
  await make('B-web', WEB, KEY_B, false);
  return { h, ids };
}

const allIds = (ids: Built['ids']): string[] => Object.values(ids).flat();

describe('NFR-119 two keys by two namespaces never mix', () => {
  it('NFR-119 each cell reads exactly its own matches, newest finish first, whatever the page size, and its total counts only them', async () => {
    const { h, ids } = await build();
    for (const { cell, key, client } of CELLS) {
      const own = ids[cell];
      expect(own.length, cell).toBeGreaterThanOrEqual(2);
      const foreign = allIds(ids).filter((id) => !own.includes(id));
      for (const size of [1, 2, 3, 500]) {
        const walked = await walk(h, client, { community: key }, size);
        const got = walked.pages.flatMap((p) => p.items.map((i) => i.matchId));
        // Matches finish in creation order, so the history is the own ids reversed.
        expect(got, `${cell} size ${size}`).toStrictEqual([...own].reverse());
        for (const page of walked.pages) expect(page.total, `${cell} total`).toBe(own.length);
        for (const text of walked.texts) for (const id of foreign) expect(text, `${cell} holds ${id}`).not.toContain(id);
      }
    }
  }, 120_000);

  it('NFR-119 the players of an entry are those of its namespace, and the same local id in the other namespace is another player', async () => {
    const { h, ids } = await build();
    for (const { cell, key, client } of CELLS) {
      const reply = await postHistory(h, client.credential, { community: key, playerId: 'u1', limit: 500 });
      const page = reply.json() as { items: { matchId: string; top: { playerId: string; name?: string }[]; asker?: unknown }[] };
      expect(page.items.length, cell).toBe(ids[cell].length);
      for (const item of page.items) {
        for (const row of item.top) {
          expect(row.playerId.startsWith(`${client.namespace}:`), `${cell} ${row.playerId}`).toBe(true);
          expect(row.name?.startsWith(client.namespace) ?? true).toBe(true);
        }
        expect(item.asker, `${cell} asker`).toBeDefined();
      }
      // The other namespace's names never appear.
      const other = client === DISCORD ? 'web' : 'discord';
      expect(reply.text).not.toContain(`${other}-one`);
      expect(reply.text).not.toContain(`${other}:`);
    }
    // An asker that only played in one namespace is `played: false` in the other, for the same key and the same local id.
    const only = await startHistory();
    const made = await createCommunityMatch(only, DISCORD, 'solo-1', KEY_A);
    playMatch(only, made, [{ client: DISCORD, local: 'solo', name: 'Solo', victim: 'right' }], true);
    const discord = (await postHistory(only, DISCORD.credential, { community: KEY_A, playerId: 'solo' })).json() as { items: { asker: unknown }[] };
    const web = (await postHistory(only, WEB.credential, { community: KEY_A, playerId: 'solo' })).json() as { items: unknown[]; total: number };
    expect(discord.items[0]?.asker).toMatchObject({ points: expect.any(Number), rank: 1 });
    expect(web).toStrictEqual({ items: [], total: 0 });
  }, 120_000);

  it('NFR-119 a cursor made for one cell used on another cell lists only the matches of the cell asked, never a neighbour\'s', async () => {
    const { h, ids } = await build();
    const cursors: string[] = [];
    for (const { key, client } of CELLS) {
      const first = (await postHistory(h, client.credential, { community: key, limit: 1 })).json() as { next?: string };
      expect(first.next).toBeDefined();
      cursors.push(first.next as string);
    }
    for (const { cell, key, client } of CELLS) {
      for (const cursor of cursors) {
        const body: HistoryBody = { community: key, limit: 500, cursor };
        const reply = await postHistory(h, client.credential, body);
        if (reply.status !== 200) {
          // A cursor from another list or an altered one is refused by name, never a leak.
          expect(reply.status, cell).toBe(400);
          continue;
        }
        const got = (reply.json() as { items: { matchId: string }[] }).items.map((i) => i.matchId);
        for (const id of got) expect(ids[cell], `${cell} got ${id}`).toContain(id);
      }
    }
  }, 120_000);

  it('NFR-119 an unknown key, a key that only has unfinished matches elsewhere and a match without a key read as an empty history', async () => {
    const { h } = await build();
    for (const client of [DISCORD, WEB]) {
      const reply = await postHistory(h, client.credential, { community: KEY_Z });
      expect(reply.json()).toStrictEqual({ items: [], total: 0 });
    }
    // KEY_C has matches only under discord.
    expect((await postHistory(h, WEB.credential, { community: KEY_C })).json()).toStrictEqual({ items: [], total: 0 });
    expect(((await postHistory(h, DISCORD.credential, { community: KEY_C })).json() as { total: number }).total).toBe(1);
  }, 120_000);
});
