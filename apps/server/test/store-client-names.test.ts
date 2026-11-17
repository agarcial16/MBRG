import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MatchEvent, PublicState } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import type { ResultRow } from '../src/core/scoring';
import type { CoreMatch } from '../src/core/view';
import { InjectedFault, withFaults } from '../src/store/faults';
import { openStore } from '../src/store/sqlite';
import { LOBBY_RETENTION_MS, StoreError, type Store } from '../src/store/store';
import { withRawDb } from './helpers/db-scan';

// Spec 022 storage: the display name of a client player is one row of `client_names`, replaced by the latest accepted name, read
// only for a player that has a result row, joined to the winners, and purged with its match.

const DIGEST = (c: string): string => c.repeat(64);
const SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 5 + 1) % 256);
const T0 = 1_700_000_000_000;
const state = (round: number): PublicState => ({ mode: 'classic', round, owners: [[1, 10], [2, 20], [3, 30]] });
const id = (c: string): string => c.repeat(16);
const PLANTED = 'Zq Planted Name';

const matchOf = (matchId: string, over: Partial<CoreMatch> = {}): CoreMatch => ({
  matchId,
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
  ...over,
});
const schedule = (match: CoreMatch): MatchEvent => ({ type: 'schedule', seq: 1, stage: match.stage, reportedTime: match.createdAt });

/** A public lobby as the service stores it (client-only when a namespace is given). */
const put = (store: Store, matchId: string, namespace?: string, createdAt = T0): void => {
  const match = matchOf(matchId, { createdAt, lastStepMs: createdAt });
  store.transaction(() => {
    store.insertMatch({ match, secret: SECRET, hostTokenDigest: DIGEST('b') });
    if (namespace !== undefined) store.insertClientMatch(matchId, namespace);
    store.appendEvents(matchId, [schedule(match)]);
    store.insertLobby({ matchId, public: true, expiresMs: createdAt + 1000 });
  });
};

/** A running match of two applied rounds, so absorber rows of rounds 1 and 2 can be stored. */
const putRunning = (store: Store, matchId: string): void => {
  const match = matchOf(matchId, { stage: 'phase-1', appliedRounds: 2, state: state(2), lastSeq: 1 });
  store.transaction(() => {
    store.insertMatch({ match, secret: SECRET, hostTokenDigest: DIGEST('b') });
    store.appendEvents(matchId, [schedule(match)]);
  });
};

const withStore = <T>(body: (store: Store) => T): T => {
  const store = openStore(':memory:');
  try {
    return body(store);
  } finally {
    store.close();
  }
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
const row = (playerId: string, correct: boolean, round = 1): ResultRow => ({ playerId, kind: 'absorber', round, choice: 1, correct, points: correct ? 3 : 0 });
const nameRows = (store: Store, matchId: string): [string, string][] => [...store.clientNames(matchId, ['discord:1', 'discord:2', 'discord:3']).entries()];

describe('putClientName', () => {
  it('stores a name and a second call replaces it, leaving one row', () => {
    withStore((store) => {
      putRunning(store, id('A'));
      store.transaction(() => {
        store.putClientName(id('A'), 'discord:1', 'Ana');
        store.putResults(id('A'), [row('discord:1', false)]);
      });
      expect(nameRows(store, id('A'))).toStrictEqual([['discord:1', 'Ana']]);
      store.transaction(() => store.putClientName(id('A'), 'discord:1', 'Ana Maria'));
      expect(nameRows(store, id('A'))).toStrictEqual([['discord:1', 'Ana Maria']]);
    });
  });

  it('refuses a call outside a transaction, a missing match, a joined player id, a malformed id and a bad name', () => {
    withStore((store) => {
      putRunning(store, id('A'));
      expect(codeOf(() => store.putClientName(id('A'), 'discord:1', 'Ana'))).toBe('invalid-write');
      const inTx = (matchId: string, playerId: string, name: string): string => codeOf(() => store.transaction(() => store.putClientName(matchId, playerId, name)));
      expect(inTx(id('Z'), 'discord:1', 'Ana')).toBe('invalid-write');
      expect(inTx(id('A'), 'player:abc', 'Ana')).toBe('invalid-write');
      expect(inTx(id('A'), 'nocolon', 'Ana')).toBe('invalid-write');
      expect(inTx(id('A'), 'discord:', 'Ana')).toBe('invalid-write');
      expect(inTx(id('A'), 'discord:1', '')).toBe('invalid-write');
      expect(inTx(id('A'), 'discord:1', 'x'.repeat(25))).toBe('invalid-write');
      expect(inTx(id('A'), 'discord:1', 'x'.repeat(24))).toBe('no error');
      expect(inTx(id('A'), 'discord:2', '\u{1D4D0}'.repeat(24))).toBe('no error');
    });
  });

  it('rolls back with its transaction', () => {
    withStore((store) => {
      putRunning(store, id('A'));
      expect(() =>
        store.transaction(() => {
          store.putClientName(id('A'), 'discord:1', 'Ana');
          store.putResults(id('A'), [row('discord:1', false)]);
          throw new Error('boom');
        }),
      ).toThrow('boom');
      store.transaction(() => store.putResults(id('A'), [row('discord:1', false)]));
      expect(nameRows(store, id('A'))).toStrictEqual([]);
    });
  });

  it('the fault wrapper counts it as a write', () => {
    const raw = openStore(':memory:');
    putRunning(raw, id('A'));
    const store = withFaults(raw, { failWrite: { transaction: 1, afterWrites: 0 } });
    try {
      expect(() => store.transaction(() => store.putClientName(id('A'), 'discord:1', 'Ana'))).toThrow(InjectedFault);
    } finally {
      store.close();
    }
  });
});

describe('clientNames reads only scored players', () => {
  it('a name of a player with no result row is never returned, nor one of another match or of an id not asked', () => {
    withStore((store) => {
      putRunning(store, id('A'));
      putRunning(store, id('B'));
      store.transaction(() => {
        store.putClientName(id('A'), 'discord:1', PLANTED);
        store.putClientName(id('A'), 'discord:2', 'Bea');
        store.putClientName(id('B'), 'discord:1', 'Other match');
      });
      // predicted but not scored: nothing, whatever the id asked
      expect(nameRows(store, id('A'))).toStrictEqual([]);
      store.transaction(() => store.putResults(id('A'), [row('discord:2', true)]));
      expect(nameRows(store, id('A'))).toStrictEqual([['discord:2', 'Bea']]);
      expect([...store.clientNames(id('A'), ['discord:1']).values()]).toStrictEqual([]);
      expect([...store.clientNames(id('B'), ['discord:1', 'discord:2']).values()]).toStrictEqual([]);
      store.transaction(() => store.putResults(id('B'), [row('discord:1', false)]));
      expect(nameRows(store, id('B'))).toStrictEqual([['discord:1', 'Other match']]);
    });
  });

  it('works for more ids than one query holds, and ignores duplicates in the asked list', () => {
    withStore((store) => {
      putRunning(store, id('A'));
      const ids = Array.from({ length: 1200 }, (_, i) => `discord:${i + 1000}`);
      store.transaction(() => {
        for (const p of ids) store.putClientName(id('A'), p, `n${p}`);
        store.putResults(id('A'), ids.map((p) => row(p, false)));
      });
      const got = store.clientNames(id('A'), [...ids, ...ids.slice(0, 5)]);
      expect(got.size).toBe(1200);
      expect(got.get('discord:1999')).toBe('ndiscord:1999');
      expect(store.clientNames(id('A'), []).size).toBe(0);
    });
  });
});

describe('winnersAfter with client names', () => {
  const join = (store: Store, matchId: string, playerId: string, name: string, seq: number): void =>
    store.transaction(() => store.insertPlayer({ matchId, playerId, name, nameKey: name.toLowerCase(), tokenDigest: DIGEST(String(seq)), joinedSeq: seq, joinedMs: T0 }));

  it('lists a named client winner, leaves out a client winner without a name, keeps a player winner', () => {
    withStore((store) => {
      putRunning(store, id('A'));
      join(store, id('A'), 'player:p1', 'Pat', 2);
      store.transaction(() => {
        store.putClientName(id('A'), 'discord:1', 'Ana');
        store.putResults(id('A'), [row('discord:1', true), row('discord:2', true), row('discord:3', false), row('player:p1', true)]);
        store.putClientName(id('A'), 'discord:3', 'Wrong guess');
      });
      expect(store.winnersAfter(id('A'), 'absorber', 1, undefined, 10)).toStrictEqual([
        { playerId: 'discord:1', name: 'Ana' },
        { playerId: 'player:p1', name: 'Pat' },
      ]);
      expect(store.winnersAfter(id('A'), 'absorber', 1, 'discord:1', 10).map((w) => w.playerId)).toStrictEqual(['player:p1']);
      expect(store.winnersAfter(id('A'), 'absorber', 1, undefined, 1).map((w) => w.playerId)).toStrictEqual(['discord:1']);
    });
  });

  it('a store without client names returns exactly the rows of the player join', () => {
    withStore((store) => {
      putRunning(store, id('A'));
      join(store, id('A'), 'player:p1', 'Pat', 2);
      join(store, id('A'), 'player:p2', 'Quin', 3);
      store.transaction(() => store.putResults(id('A'), [row('discord:1', true), row('player:p1', true), row('player:p2', true), row('web:x', true)]));
      expect(store.winnersAfter(id('A'), 'absorber', 1, undefined, 10)).toStrictEqual([
        { playerId: 'player:p1', name: 'Pat' },
        { playerId: 'player:p2', name: 'Quin' },
      ]);
    });
  });
});

describe('purge and access', () => {
  it('the purge of an expired lobby deletes its names with the match and keeps those of another match', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrg-names-'));
    try {
      const file = join(dir, 'p.sqlite');
      const store = openStore(file);
      put(store, id('A'), 'discord');
      put(store, id('B'), 'discord', T0 + 5_000);
      store.transaction(() => {
        store.putClientName(id('A'), 'discord:1', 'Ana');
        store.putClientName(id('B'), 'discord:1', 'Bea');
      });
      store.transaction(() => store.markExpired(id('A'), T0 + 1000));
      store.transaction(() => store.purgeExpired(T0 + 1000 + LOBBY_RETENTION_MS + 1));
      expect(store.getMatch(id('A'))).toBeUndefined();
      expect(store.getMatch(id('B'))).toBeDefined();
      store.close();
      const rows = withRawDb(file, (db) => db.prepare('SELECT match_id, name FROM client_names').all().map((r) => [String(r.match_id), String(r.name)]));
      expect(rows).toStrictEqual([[id('B'), 'Bea']]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the source touches client_names only in the schema, the one upsert, the two reads and the purge', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(d, entry.name));
        else if (entry.name.endsWith('.ts')) files.push(join(d, entry.name));
      }
    };
    walk(dir);
    const hits = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').filter((line) => /client_names/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)));
    expect(hits.filter((line) => /\b(REPLACE|ALTER|DROP)\b/i.test(line))).toStrictEqual([]);
    const sqlite = readFileSync(join(dir, 'store', 'sqlite.ts'), 'utf8');
    expect(sqlite.match(/INSERT INTO client_names/g)).toHaveLength(1);
    expect(sqlite.match(/ON CONFLICT \(match_id, player_id\) DO UPDATE SET name/g)?.length ?? 0).toBe(1);
    expect(sqlite.match(/DELETE FROM client_names/g) ?? []).toHaveLength(0);
    // the purge deletes it through the child-first table list, the one place the table name sits next to `DELETE FROM ${table}`
    expect(sqlite).toMatch(/'client_matches', 'client_names'\]\) \{\s*run\(`DELETE FROM \$\{table\} WHERE match_id = \?`/);
  });

  it('the Store interface has exactly the two methods for the table', () => {
    const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'store', 'store.ts'), 'utf8');
    expect(text.match(/^\s+(putClientName|clientNames)\(/gm)).toHaveLength(2);
  });
});
