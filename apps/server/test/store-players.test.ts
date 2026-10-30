import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MatchEvent, PublicState } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import type { CoreMatch } from '../src/core/view';
import { credentialDigest } from '../src/service/ids';
import { InjectedFault, withFaults } from '../src/store/faults';
import { READ_SQL, openStore } from '../src/store/sqlite';
import { LOBBY_RETENTION_MS, NameTakenError, StoreError, type Store, type StoredPlayer } from '../src/store/store';
import { credentialTextColumns, dumpRows, listColumns, scanValues, withRawDb } from './helpers/db-scan';

// Player storage (spec 011 plan section 3): a player row holds the digest of the token, the name as shown and its key; the
// plain token is never an argument of the store. Rows are written in the caller's transaction, with the join event.

const withTempDir = <T>(body: (dir: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrg-players-'));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const withStore = <T>(body: (store: Store) => T): T => {
  const store = openStore(':memory:');
  try {
    return body(store);
  } finally {
    store.close();
  }
};

const DIGEST = (c: string): string => c.repeat(64);
const SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 5 + 1) % 256);
const T0 = 1_700_000_000_000;
const state = (round: number): PublicState => ({ mode: 'classic', round, owners: [[1, 10], [2, 20], [3, 30]] });

const lobbyMatch = (id: string): CoreMatch => ({
  matchId: id,
  mapId: 'dev',
  mapDigest: DIGEST('a'),
  totalRounds: 5,
  timing: { i: 120, l1: 30, l2: 10 },
  commitment: DIGEST('c'),
  stage: 'lobby',
  appliedRounds: 0,
  state: state(0),
  stateDigest: DIGEST('d'),
  lastSeq: 1,
  createdAt: T0,
  lastStepMs: T0,
  anchors: null,
});

const schedule = (match: CoreMatch): MatchEvent => ({ type: 'schedule', seq: 1, stage: match.stage, reportedTime: match.createdAt });
const mid = (c: string): string => c.repeat(16);

const putMatch = (store: Store, matchId: string, lobby = true): void => {
  const match = lobbyMatch(matchId);
  store.transaction(() => {
    store.insertMatch({ match, secret: SECRET, hostTokenDigest: DIGEST('b') });
    store.appendEvents(matchId, [schedule(match)]);
    if (lobby) store.insertLobby({ matchId, public: true, expiresMs: T0 + 1000 });
  });
};

interface Draft {
  matchId: string;
  playerId: string;
  name: string;
  nameKey: string;
  tokenDigest: string;
  joinedSeq: number;
  joinedMs: number;
}

/** A player draft: id `player:<local>`, name and key from the same word, a digest of a planted token. */
const draft = (matchId: string, word: string, joinedSeq: number, over: Partial<Draft> = {}): Draft => ({
  matchId,
  playerId: `player:${word.padEnd(12, 'x').slice(0, 12)}`,
  name: word,
  nameKey: word.toLowerCase(),
  tokenDigest: credentialDigest(`TOKEN-${matchId}-${word}`),
  joinedSeq,
  joinedMs: T0 + joinedSeq,
  ...over,
});

const addPlayer = (store: Store, d: Draft): void => {
  store.transaction(() => store.insertPlayer(d));
};

const codeOf = (action: () => unknown): string => {
  try {
    action();
  } catch (error) {
    if (error instanceof StoreError) return error.code;
    throw error;
  }
  return 'no error';
};

describe('players: insert', () => {
  it('a stored player reads back as id, name, join order and join instant, with no digest and no name key', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      addPlayer(store, draft(mid('A'), 'Ana', 2));
      const found = store.playersAfter(mid('A'), undefined, 10);
      expect(found).toStrictEqual([{ playerId: 'player:Anaxxxxxxxxx', name: 'Ana', joinedSeq: 2, joinedMs: T0 + 2 }]);
      expect(Object.keys(found[0]!)).toStrictEqual(['playerId', 'name', 'joinedSeq', 'joinedMs']);
    });
  });

  it('the table holds only the digest: a planted token appears nowhere in the file, and no column of the schema could hold a token text', () => {
    withTempDir((dir) => {
      const file = join(dir, 'players.sqlite');
      const token = 'PLANTEDtokenText0123456789abcdefghijklmn';
      const store = openStore(file);
      putMatch(store, mid('A'));
      addPlayer(store, draft(mid('A'), 'Ana', 2, { tokenDigest: credentialDigest(token) }));
      store.close();
      withRawDb(file, (db) => {
        expect(scanValues(db, [token])).toStrictEqual([]);
        expect(scanValues(db, [credentialDigest(token)])).toStrictEqual(['players.token_digest']);
        expect(credentialTextColumns(listColumns(db))).toStrictEqual([]);
        const row = db.prepare('SELECT * FROM players').get();
        expect(Object.keys(row ?? {}).sort()).toStrictEqual(['joined_ms', 'joined_seq', 'match_id', 'name', 'name_key', 'player_id', 'token_digest']);
        expect(row?.token_digest).toBe(credentialDigest(token));
      });
    });
  });

  it('the token is not an argument: anything but a digest in its place is refused, a token text included, and nothing is stored', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      const token = 'PLANTEDtokenText0123456789abcdefghijklmn';
      for (const bad of [token, '', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), credentialDigest('x').toUpperCase()]) {
        expect(codeOf(() => store.transaction(() => store.insertPlayer(draft(mid('A'), 'Ana', 2, { tokenDigest: bad })))), bad).toBe('invalid-write');
      }
      expect(store.playerCount(mid('A'))).toBe(0);
      expect(store.insertPlayer.length).toBe(1);
    });
  });

  it('a draft out of shape is refused: player id outside the player namespace, empty name or key, join order or instant that is not a whole number', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      const bad: Array<Partial<Draft>> = [
        { playerId: 'web:abcdefghijkl' },
        { playerId: 'player:' },
        { playerId: 'player:a b' },
        { playerId: 'abcdefghijkl' },
        { name: '' },
        { nameKey: '' },
        { joinedSeq: 0 },
        { joinedSeq: -1 },
        { joinedSeq: 1.5 },
        { joinedSeq: Number.NaN },
        { joinedMs: -1 },
        { joinedMs: 0.5 },
      ];
      for (const over of bad) {
        expect(codeOf(() => store.transaction(() => store.insertPlayer(draft(mid('A'), 'Ana', 2, over)))), JSON.stringify(over)).toBe('invalid-write');
      }
      expect(store.playerCount(mid('A'))).toBe(0);
    });
  });

  it('a player of a match that does not exist is refused', () => {
    withStore((store) => {
      expect(codeOf(() => store.transaction(() => store.insertPlayer(draft(mid('Z'), 'Ana', 2))))).toBe('invalid-write');
    });
  });

  it('a write outside a transaction is refused', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      expect(codeOf(() => store.insertPlayer(draft(mid('A'), 'Ana', 2)))).toBe('invalid-write');
      expect(store.playerCount(mid('A'))).toBe(0);
    });
  });

  it('a second player with the same player id or the same join order in a match is refused, in another match both are fine', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      putMatch(store, mid('B'));
      addPlayer(store, draft(mid('A'), 'Ana', 2));
      expect(codeOf(() => store.transaction(() => store.insertPlayer(draft(mid('A'), 'Bea', 3, { playerId: 'player:Anaxxxxxxxxx' }))))).toBe('invalid-write');
      expect(codeOf(() => store.transaction(() => store.insertPlayer(draft(mid('A'), 'Bea', 2))))).toBe('invalid-write');
      expect(store.playerCount(mid('A'))).toBe(1);
      addPlayer(store, draft(mid('B'), 'Ana', 2));
      expect(store.playerCount(mid('B'))).toBe(1);
    });
  });
});

describe('players: the name key is unique in a match', () => {
  it('a second player with the same key is refused with the dedicated error the service reads, not a generic failure', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      addPlayer(store, draft(mid('A'), 'Ana', 2));
      let caught: unknown;
      try {
        store.transaction(() => store.insertPlayer(draft(mid('A'), 'Other', 3, { nameKey: 'ana', playerId: 'player:Otherxxxxxxx' })));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(NameTakenError);
      expect(caught).toBeInstanceOf(StoreError);
      expect((caught as StoreError).code).toBe('invalid-write');
      expect((caught as Error).name).toBe('NameTakenError');
      expect(store.playerCount(mid('A'))).toBe(1);
    });
  });

  it('nameKeyTaken tells whether a match holds a key, never across matches, and reads nothing else', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      putMatch(store, mid('B'));
      expect(store.nameKeyTaken(mid('A'), 'ana')).toBe(false);
      addPlayer(store, draft(mid('A'), 'Ana', 2));
      expect(store.nameKeyTaken(mid('A'), 'ana')).toBe(true);
      expect(store.nameKeyTaken(mid('A'), 'Ana')).toBe(false);
      expect(store.nameKeyTaken(mid('A'), 'bea')).toBe(false);
      expect(store.nameKeyTaken(mid('B'), 'ana')).toBe(false);
      expect(store.nameKeyTaken(mid('Z'), 'ana')).toBe(false);
    });
  });

  it('the message and the error carry no name and no key', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      addPlayer(store, draft(mid('A'), 'Ana', 2, { name: 'SECRETNAME', nameKey: 'secretkey' }));
      try {
        store.transaction(() => store.insertPlayer(draft(mid('A'), 'Bea', 3, { name: 'SECRETNAME', nameKey: 'secretkey' })));
        expect.unreachable();
      } catch (error) {
        expect(String((error as Error).message)).not.toMatch(/SECRETNAME|secretkey/i);
        expect(JSON.stringify(error)).not.toMatch(/SECRETNAME|secretkey/i);
      }
    });
  });

  it('the same key in another match is allowed, and a refused name does not take a join order', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      putMatch(store, mid('B'));
      addPlayer(store, draft(mid('A'), 'Ana', 2));
      addPlayer(store, draft(mid('B'), 'Ana', 2));
      expect(codeOf(() => store.transaction(() => store.insertPlayer(draft(mid('A'), 'Dup', 3, { nameKey: 'ana', playerId: 'player:Dupxxxxxxxxx' }))))).toBe('invalid-write');
      addPlayer(store, draft(mid('A'), 'Cleo', 3));
      expect(store.playersAfter(mid('A'), undefined, 10).map((p) => p.name)).toStrictEqual(['Ana', 'Cleo']);
    });
  });

  it('two inserts of one transaction with the same key give the error at the second, which rolls the first back too when the caller lets it', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      expect(() =>
        store.transaction(() => {
          store.insertPlayer(draft(mid('A'), 'Ana', 2));
          store.insertPlayer(draft(mid('A'), 'Dup', 3, { nameKey: 'ana', playerId: 'player:Dupxxxxxxxxx' }));
        }),
      ).toThrow(NameTakenError);
      expect(store.playerCount(mid('A'))).toBe(0);
    });
  });
});

describe('players: lookup by token digest', () => {
  it('finds the player of a match by the digest of its token', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      addPlayer(store, draft(mid('A'), 'Ana', 2));
      addPlayer(store, draft(mid('A'), 'Bea', 3));
      expect(store.playerByTokenDigest(mid('A'), credentialDigest(`TOKEN-${mid('A')}-Bea`))).toStrictEqual({ playerId: 'player:Beaxxxxxxxxx', name: 'Bea', joinedSeq: 3, joinedMs: T0 + 3 });
      expect(store.playerByTokenDigest(mid('A'), credentialDigest('nobody'))).toBeUndefined();
    });
  });

  it('never across matches: a digest of a player of A finds nothing in B, and the same digest in two matches finds each its own player', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      putMatch(store, mid('B'));
      const shared = credentialDigest('SHARED');
      addPlayer(store, draft(mid('A'), 'Ana', 2, { tokenDigest: shared }));
      expect(store.playerByTokenDigest(mid('B'), shared)).toBeUndefined();
      expect(store.playerByTokenDigest(mid('Z'), shared)).toBeUndefined();
      addPlayer(store, draft(mid('B'), 'Bea', 2, { tokenDigest: shared }));
      expect(store.playerByTokenDigest(mid('A'), shared)?.name).toBe('Ana');
      expect(store.playerByTokenDigest(mid('B'), shared)?.name).toBe('Bea');
    });
  });

  it('a value that is not a digest is a RangeError, never a match', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      addPlayer(store, draft(mid('A'), 'Ana', 2));
      for (const bad of ['', 'x', 'A'.repeat(64), '%'.repeat(64)]) expect(() => store.playerByTokenDigest(mid('A'), bad), bad).toThrow(RangeError);
    });
  });

  it('the statement runs through the index on the digest', () => {
    withTempDir((dir) => {
      const file = join(dir, 'plan.sqlite');
      const store = openStore(file);
      store.close();
      withRawDb(file, (db) => {
        const plan = db.prepare(`EXPLAIN QUERY PLAN ${READ_SQL.playerByTokenDigest}`).all('m', 'd').map((r) => String(r.detail)).join(' | ');
        expect(plan).toContain('players_by_token');
        expect(plan).not.toMatch(/SCAN players/);
      });
    });
  });
});

describe('players: the list in join order', () => {
  // Join orders with gaps (other events take numbers between joins), inserted out of order.
  const SEQS = [2, 3, 5, 6, 9, 10, 12];
  const names = ['P2', 'P3', 'P5', 'P6', 'P9', 'P10', 'P12'];

  const seeded = (store: Store): void => {
    putMatch(store, mid('A'));
    putMatch(store, mid('B'));
    for (const i of [4, 0, 6, 2, 5, 1, 3]) addPlayer(store, draft(mid('A'), names[i]!, SEQS[i]!));
    addPlayer(store, draft(mid('B'), 'Other', 4));
  };

  it('is ordered by join order, not by insertion, name or id, and holds only the match asked for', () => {
    withStore((store) => {
      seeded(store);
      expect(store.playersAfter(mid('A'), undefined, 500).map((p) => p.joinedSeq)).toStrictEqual(SEQS);
      expect(store.playersAfter(mid('A'), undefined, 500).map((p) => p.name)).toStrictEqual(names);
      expect(store.playersAfter(mid('B'), undefined, 500).map((p) => p.name)).toStrictEqual(['Other']);
      expect(store.playersAfter(mid('Z'), undefined, 500)).toStrictEqual([]);
    });
  });

  it('is a strict keyset: the key itself is not returned, a key between two joins returns the next one', () => {
    withStore((store) => {
      seeded(store);
      expect(store.playersAfter(mid('A'), 5, 500).map((p) => p.joinedSeq)).toStrictEqual([6, 9, 10, 12]);
      expect(store.playersAfter(mid('A'), 7, 500).map((p) => p.joinedSeq)).toStrictEqual([9, 10, 12]);
      expect(store.playersAfter(mid('A'), 12, 500)).toStrictEqual([]);
      expect(store.playersAfter(mid('A'), 0, 500)).toHaveLength(7);
    });
  });

  it('pages of 1, 2 and 500 (and one more row to know there is a next page) neither repeat nor skip a player', () => {
    withStore((store) => {
      seeded(store);
      for (const limit of [1, 2, 3, 500]) {
        const seen: number[] = [];
        let after: number | undefined;
        for (let guard = 0; guard < 20; guard++) {
          const rows = store.playersAfter(mid('A'), after, limit + 1);
          const page = rows.slice(0, limit);
          seen.push(...page.map((p) => p.joinedSeq));
          if (rows.length <= limit) break;
          after = page[page.length - 1]!.joinedSeq;
        }
        expect(seen, `limit ${limit}`).toStrictEqual(SEQS);
      }
    });
  });

  it('refuses a key or a limit that is not a whole number in range', () => {
    withStore((store) => {
      seeded(store);
      for (const limit of [0, -1, 1.5, Number.NaN]) expect(() => store.playersAfter(mid('A'), undefined, limit), String(limit)).toThrow(RangeError);
      for (const after of [-1, 1.5, Number.NaN]) expect(() => store.playersAfter(mid('A'), after, 5), String(after)).toThrow(RangeError);
    });
  });
});

describe('players: count and names', () => {
  it('counts the players of one match, 0 for an empty or unknown match', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      putMatch(store, mid('B'));
      expect(store.playerCount(mid('A'))).toBe(0);
      addPlayer(store, draft(mid('A'), 'Ana', 2));
      addPlayer(store, draft(mid('A'), 'Bea', 3));
      addPlayer(store, draft(mid('B'), 'Cleo', 2));
      expect(store.playerCount(mid('A'))).toBe(2);
      expect(store.playerCount(mid('B'))).toBe(1);
      expect(store.playerCount(mid('Z'))).toBe(0);
    });
  });

  it('gives the names of the joined players among the ids asked, ignoring ids of other matches, clients and unknown players', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      putMatch(store, mid('B'));
      addPlayer(store, draft(mid('A'), 'Ana', 2));
      addPlayer(store, draft(mid('A'), 'Bea', 3));
      addPlayer(store, draft(mid('B'), 'Cleo', 2));
      const got = store.playerNames(mid('A'), ['player:Beaxxxxxxxxx', 'player:Anaxxxxxxxxx', 'player:Cleoxxxxxxxx', 'player:Nobodyxxxxxx', 'web:someone', 'player:Beaxxxxxxxxx']);
      expect([...got.entries()].sort()).toStrictEqual([['player:Anaxxxxxxxxx', 'Ana'], ['player:Beaxxxxxxxxx', 'Bea']]);
      expect(store.playerNames(mid('A'), []).size).toBe(0);
      expect(store.playerNames(mid('Z'), ['player:Anaxxxxxxxxx']).size).toBe(0);
    });
  });

  it('reads 500 ids at once', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      const ids: string[] = [];
      store.transaction(() => {
        for (let i = 0; i < 500; i++) {
          const d = draft(mid('A'), `N${i}`, i + 2, { playerId: `player:${String(i).padStart(12, 'q')}` });
          store.insertPlayer(d);
          ids.push(d.playerId);
        }
      });
      expect(store.playerNames(mid('A'), ids).size).toBe(500);
    });
  });

  it('refuses an id that is not a text', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      expect(() => store.playerNames(mid('A'), [3 as unknown as string])).toThrow(RangeError);
    });
  });
});

describe('players: transactions, purge and the fault seam', () => {
  it('rolls back with its transaction', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      expect(() =>
        store.transaction(() => {
          store.insertPlayer(draft(mid('A'), 'Ana', 2));
          throw new Error('abort');
        }),
      ).toThrow('abort');
      expect(store.playerCount(mid('A'))).toBe(0);
      expect(store.playersAfter(mid('A'), undefined, 10)).toStrictEqual([]);
    });
  });

  it('is removed with the lobby that expires, and only with it', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      putMatch(store, mid('B'));
      addPlayer(store, draft(mid('A'), 'Ana', 2));
      addPlayer(store, draft(mid('B'), 'Bea', 2));
      store.transaction(() => store.markExpired(mid('A'), T0 + 5));
      expect(store.transaction(() => store.purgeExpired(T0 + 5 + LOBBY_RETENTION_MS + 1))).toBe(1);
      expect(store.playerCount(mid('A'))).toBe(0);
      expect(store.playerCount(mid('B'))).toBe(1);
    });
  });

  it('the fault seam wraps the new operations: the same keys as the store, a write that fails leaves nothing, a read does not count as a write', () => {
    withStore((store) => {
      putMatch(store, mid('A'));
      expect(Object.keys(withFaults(store, {})).sort()).toStrictEqual(Object.keys(store).sort());
      const failing = withFaults(store, { failWrite: { transaction: 1, afterWrites: 0 } });
      expect(() => failing.transaction(() => failing.insertPlayer(draft(mid('A'), 'Ana', 2)))).toThrow(InjectedFault);
      expect(store.playerCount(mid('A'))).toBe(0);
      const later = withFaults(store, { failWrite: { transaction: 1, afterWrites: 1 } });
      expect(() =>
        later.transaction(() => {
          later.insertPlayer(draft(mid('A'), 'Ana', 2));
          expect(later.playerCount(mid('A'))).toBe(1);
          expect(later.playersAfter(mid('A'), undefined, 5)).toHaveLength(1);
          expect(later.playerByTokenDigest(mid('A'), credentialDigest(`TOKEN-${mid('A')}-Ana`))?.name).toBe('Ana');
          expect(later.playerNames(mid('A'), ['player:Anaxxxxxxxxx']).size).toBe(1);
          later.insertPlayer(draft(mid('A'), 'Bea', 3));
        }),
      ).toThrow(InjectedFault);
      expect(store.playerCount(mid('A'))).toBe(0);
    });
  });

  it('a kill after the insert and before the commit leaves the file as it was', () => {
    withTempDir((dir) => {
      const file = join(dir, 'kill.sqlite');
      const base = openStore(file);
      putMatch(base, mid('A'));
      base.close();
      const before = withRawDb(file, dumpRows);
      const killed = withFaults(openStore(file), { abortWrite: { transaction: 1, afterWrites: 1 } });
      expect(() =>
        killed.transaction(() => {
          killed.insertPlayer(draft(mid('A'), 'Ana', 2));
          killed.insertPlayer(draft(mid('A'), 'Bea', 3));
        }),
      ).toThrow(InjectedFault);
      expect(withRawDb(file, dumpRows)).toBe(before);
    });
  });

  it('survives a reopen: the rows, their order and the digests are the same', () => {
    withTempDir((dir) => {
      const file = join(dir, 'reopen.sqlite');
      const first = openStore(file);
      putMatch(first, mid('A'));
      addPlayer(first, draft(mid('A'), 'Ana', 2));
      addPlayer(first, draft(mid('A'), 'Bea', 3));
      first.close();
      const second = openStore(file);
      try {
        const rows: StoredPlayer[] = second.playersAfter(mid('A'), undefined, 10);
        expect(rows.map((p) => p.name)).toStrictEqual(['Ana', 'Bea']);
        expect(second.playerByTokenDigest(mid('A'), credentialDigest(`TOKEN-${mid('A')}-Bea`))?.joinedSeq).toBe(3);
      } finally {
        second.close();
      }
    });
  });
});
