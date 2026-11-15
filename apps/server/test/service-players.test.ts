import { CURSOR_LISTS, PLAYER_LIST_ITEM_KEYS, decodeCursor, encodeCursor, encodePlayerListItem, errorReply, readPageQuery } from '@mbrg/protocol';
import type { Page, PlayerListItem } from '@mbrg/protocol';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InjectedFault } from '../src/store/faults';
import { openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';
import { dumpRows, withRawDb } from './helpers/db-scan';
import { SECRETS } from './helpers/core-timelines';
import { creationBody, serviceHarness, withTempDir } from './helpers/service-harness';
import type { Harness, HarnessOptions } from './helpers/service-harness';

// The players list of a match at service level (spec 011 M3 T8): id, name and join order, paged by the join sequence number.
// It reads only: no token, no digest, no prediction, no write.

const PUBLIC = { maps: ['dev'], lobbyExpiryHours: 48 } as const;
const publicHarness = (extra: HarnessOptions = {}): Harness => serviceHarness({ publicCreation: PUBLIC, secret: SECRETS['ascending-00-1f'], ...extra });

const lobbyOf = (h: Harness, requestId = 'c-1'): { matchId: string; hostToken: string } => {
  const out = h.service.createPublic({ source: 'src-host', body: creationBody(requestId) });
  if (!out.ok) throw new Error('public creation failed');
  return { matchId: out.reply.matchId, hostToken: out.reply.hostToken };
};
const joinAs = (h: Harness, matchId: string, name: string) => {
  const out = h.service.join({ source: `src-${name}`, matchId, body: { name, requestId: `j-${name}` } });
  if (!out.ok) throw new Error('join refused');
  return out.reply;
};
const NAMES = ['Zoe', 'ana', 'Mia', 'Bea', 'Cy'];
const lobbyWithPlayers = (h: Harness, names: readonly string[] = NAMES) => {
  const { matchId, hostToken } = lobbyOf(h);
  const replies = names.map((n) => joinAs(h, matchId, n));
  return { matchId, hostToken, replies };
};
const pageOf = (h: Harness, matchId: string, limit: number, after?: readonly [number]): Page<PlayerListItem> => {
  const out = h.service.players(matchId, after === undefined ? { limit } : { limit, after });
  if (!out.ok) throw new Error(`players failed: ${JSON.stringify(out.error)}`);
  return out.reply;
};
const cursorOf = (page: Page<PlayerListItem>): readonly [number] => {
  const decoded = decodeCursor('players', page.next!);
  if (!decoded.ok) throw new Error('cursor refused');
  return decoded.value;
};

describe('the players list', () => {
  it('players list: lists the players in join order, not by name, with the join sequence number', () => {
    const h = publicHarness();
    try {
      const { matchId, replies } = lobbyWithPlayers(h);
      const page = pageOf(h, matchId, 500);
      expect(page.next).toBeUndefined();
      expect(page.items).toStrictEqual(replies.map((r, i) => ({ playerId: r.playerId, name: NAMES[i], joinedSeq: i + 2 })));
      for (const item of page.items) expect(() => encodePlayerListItem(item)).not.toThrow();
    } finally {
      h.close();
    }
  });

  it('players list: shows only the player id, the name and the join order: no token, no digest, no prediction (a scan of the reply bytes)', () => {
    const h = publicHarness();
    try {
      const { matchId, replies } = lobbyWithPlayers(h);
      const page = pageOf(h, matchId, 500);
      for (const item of page.items) expect(Object.keys(item)).toStrictEqual([...PLAYER_LIST_ITEM_KEYS]);
      const bytes = JSON.stringify(page);
      for (const r of replies) {
        expect(bytes).not.toContain(r.playerToken);
        expect(bytes).not.toContain(Buffer.from(r.playerToken).toString('base64'));
      }
      expect(bytes).not.toMatch(/token|digest|prediction|nameKey|name_key|joinedMs/i);
    } finally {
      h.close();
    }
  });

  it('players list: pages of 1, 2 and 500: the cursors never repeat or skip a player, and the last page has no cursor', () => {
    const h = publicHarness();
    try {
      const { matchId, replies } = lobbyWithPlayers(h);
      const all = replies.map((r) => r.playerId);
      for (const limit of [1, 2, 3, 4, 5, 6, 500]) {
        const seen: string[] = [];
        let after: readonly [number] | undefined;
        for (let guard = 0; guard < 20; guard += 1) {
          const page = pageOf(h, matchId, limit, after);
          expect(page.items.length).toBeLessThanOrEqual(limit);
          seen.push(...page.items.map((i) => i.playerId));
          if (page.next === undefined) break;
          expect(page.items).toHaveLength(limit);
          after = cursorOf(page);
        }
        expect(seen, `limit ${limit}`).toStrictEqual(all);
      }
      // A page that ends exactly on the last player has no cursor.
      expect(pageOf(h, matchId, 5, undefined).next).toBeUndefined();
      expect(pageOf(h, matchId, 4, undefined).next).toBeDefined();
    } finally {
      h.close();
    }
  });

  it('players list: a cursor issued for another list is invalid-request [cursor]; the players cursor is accepted for this list only', () => {
    const own = encodeCursor('players', [3]);
    expect(readPageQuery('players', [['cursor', own]])).toMatchObject({ ok: true, value: { after: [3] } });
    for (const list of CURSOR_LISTS.filter((l) => l !== 'players')) {
      const key = list === 'matches' ? ([1, 'm'] as const) : list === 'records' ? ([1] as const) : list === 'predictions' ? (['a', 1, 'victim'] as const) : list === 'phase-results' ? (['web:a'] as const) : list === 'player-results' ? ([1, 'victim'] as const) : list === 'phase-winners' ? (['player:a'] as const) : ([1, 1, 'web:a'] as const);
      const foreign = encodeCursor(list, key as never);
      expect(readPageQuery('players', [['cursor', foreign]]), list).toStrictEqual({ ok: false, error: errorReply('invalid-request', ['cursor']) });
    }
  });

  it('players list: a lobby, a running match and a finished match all answer; an empty lobby gives an empty page', () => {
    const h = publicHarness();
    try {
      const empty = lobbyOf(h, 'c-0');
      expect(pageOf(h, empty.matchId, 10)).toStrictEqual({ items: [] });
      const { matchId, hostToken, replies } = lobbyWithPlayers(h, ['Ana', 'Bea']);
      lobbyOf(h, 'c-9');
      const ids = replies.map((r) => r.playerId);
      expect(pageOf(h, matchId, 10).items.map((i) => i.playerId)).toStrictEqual(ids);
      expect(h.service.startMatch({ credential: hostToken, matchId, body: {} }).ok).toBe(true);
      expect(pageOf(h, matchId, 10).items.map((i) => i.playerId)).toStrictEqual(ids);
      for (let i = 0; i < 400 && h.store.getMatch(matchId)!.match.stage !== 'finished'; i += 1) {
        h.clock.advance(60_000);
        h.service.tick();
      }
      expect(h.store.getMatch(matchId)!.match.stage).toBe('finished');
      expect(pageOf(h, matchId, 10).items.map((i) => i.playerId)).toStrictEqual(ids);
    } finally {
      h.close();
    }
  });

  it('players list: an expired lobby still lists its players', () => {
    const h = publicHarness();
    try {
      const { matchId, replies } = lobbyWithPlayers(h, ['Ana']);
      h.clock.advance(49 * 3_600_000);
      h.service.tick();
      expect(h.store.getMatch(matchId)!.match.stage).toBe('expired');
      expect(pageOf(h, matchId, 10).items.map((i) => i.playerId)).toStrictEqual([replies[0]!.playerId]);
    } finally {
      h.close();
    }
  });

  it('players list: an unknown match is unknown-match, whatever the page', () => {
    const h = publicHarness();
    try {
      lobbyWithPlayers(h);
      expect(h.service.players('no-such-match', { limit: 10 })).toStrictEqual({ ok: false, error: errorReply('unknown-match') });
      expect(h.service.players(undefined as unknown as string, { limit: 10 })).toStrictEqual({ ok: false, error: errorReply('unknown-match') });
    } finally {
      h.close();
    }
  });

  it('players list: a page size outside 1 to 500 is a programming error of the caller', () => {
    const h = publicHarness();
    try {
      const { matchId } = lobbyWithPlayers(h);
      for (const limit of [0, 501, 1.5, -1, Number.NaN]) expect(() => h.service.players(matchId, { limit }), String(limit)).toThrow(RangeError);
    } finally {
      h.close();
    }
  });

  it('players list: a storage failure is unavailable', () => {
    const real = openStore(':memory:');
    const failing: Store = {
      ...real,
      playersAfter: () => {
        throw new InjectedFault('read', 1);
      },
    };
    const h = publicHarness({ store: failing });
    try {
      const { matchId } = lobbyOf(h);
      expect(h.service.players(matchId, { limit: 10 })).toStrictEqual({ ok: false, error: errorReply('unavailable') });
    } finally {
      h.close();
    }
  });

  it('players list: reading changes nothing in the database dump, and publishes nothing', () => {
    withTempDir((dir) => {
      const file = join(dir, 'players.db');
      const first = publicHarness({ store: openStore(file) });
      let matchId = '';
      try {
        matchId = lobbyWithPlayers(first).matchId;
      } finally {
        first.close();
      }
      const before = withRawDb(file, dumpRows);
      const second = publicHarness({ store: openStore(file) });
      try {
        const published: unknown[] = [];
        second.service.subscribe((e) => published.push(e));
        pageOf(second, matchId, 2);
        pageOf(second, matchId, 500);
        second.service.players('no-such-match', { limit: 3 });
        expect(published).toStrictEqual([]);
      } finally {
        second.close();
      }
      expect(withRawDb(file, dumpRows)).toBe(before);
    });
  });
});
