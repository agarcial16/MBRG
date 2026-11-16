import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MatchEvent, PublicState } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import type { CoreMatch } from '../src/core/view';
import { InjectedFault, withFaults } from '../src/store/faults';
import { openStore } from '../src/store/sqlite';
import { LOBBY_RETENTION_MS, StoreError, type Store } from '../src/store/store';

// Spec 018 storage: the owning namespace of a client-only match is one row of `client_matches`, written in the creation
// transaction with the match and read only by the policy checks. The policy lives and dies with its match.

const DIGEST = (c: string): string => c.repeat(64);
const SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 5 + 1) % 256);
const T0 = 1_700_000_000_000;
const state = (round: number): PublicState => ({ mode: 'classic', round, owners: [[1, 10], [2, 20], [3, 30]] });
const id = (c: string): string => c.repeat(16);

const lobbyMatch = (matchId: string, over: Partial<CoreMatch> = {}): CoreMatch => ({
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

/** A public lobby as the service stores it, with the owning namespace when given. */
const put = (store: Store, matchId: string, namespace?: string, createdAt = T0): void => {
  const match = lobbyMatch(matchId, { createdAt, lastStepMs: createdAt });
  store.transaction(() => {
    store.insertMatch({ match, secret: SECRET, hostTokenDigest: DIGEST('b') });
    if (namespace !== undefined) store.insertClientMatch(matchId, namespace);
    store.appendEvents(matchId, [schedule(match)]);
    store.insertLobby({ matchId, public: true, expiresMs: createdAt + 1000 });
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

describe('client matches in the store', () => {
  it('FR-491 inserting then reading gives the namespace; a match without a row reads undefined', () => {
    withStore((store) => {
      put(store, id('A'), 'discord');
      put(store, id('B'));
      expect(store.getClientNamespace(id('A'))).toBe('discord');
      expect(store.getClientNamespace(id('B'))).toBeUndefined();
      expect(store.getClientNamespace(id('Z'))).toBeUndefined();
    });
  });

  it('FR-494 a second insert for the same match is refused and changes nothing; a missing match or no transaction is refused', () => {
    withStore((store) => {
      put(store, id('A'), 'discord');
      expect(codeOf(() => store.transaction(() => store.insertClientMatch(id('A'), 'telegram')))).toBe('invalid-write');
      expect(store.getClientNamespace(id('A'))).toBe('discord');
      expect(codeOf(() => store.transaction(() => store.insertClientMatch(id('Z'), 'discord')))).toBe('invalid-write');
      expect(codeOf(() => store.insertClientMatch(id('A'), 'x'))).toBe('invalid-write');
    });
  });

  it('FR-491 the row is written with the match and rolls back with it', () => {
    withStore((store) => {
      expect(() =>
        store.transaction(() => {
          store.insertMatch({ match: lobbyMatch(id('A')), secret: SECRET, hostTokenDigest: DIGEST('b') });
          store.insertClientMatch(id('A'), 'discord');
          throw new Error('abort');
        }),
      ).toThrow('abort');
      expect(store.getMatch(id('A'))).toBeUndefined();
      expect(store.getClientNamespace(id('A'))).toBeUndefined();
    });
  });

  it('FR-491 the fault wrapper counts the insert as a write', () => {
    const store = withFaults(openStore(':memory:'), { failWrite: { transaction: 1, afterWrites: 1 } });
    try {
      expect(() =>
        store.transaction(() => {
          store.insertMatch({ match: lobbyMatch(id('A')), secret: SECRET, hostTokenDigest: DIGEST('b') });
          store.insertClientMatch(id('A'), 'discord');
        }),
      ).toThrow(InjectedFault);
      expect(store.getMatch(id('A'))).toBeUndefined();
    } finally {
      store.close();
    }
  });

  it('FR-494 the namespace appears in no other read of the store', () => {
    withStore((store) => {
      put(store, id('A'), 'ns-marker-x');
      const everything = JSON.stringify(
        {
          match: store.getMatch(id('A')),
          list: store.listMatches(undefined, 10),
          events: store.eventsAfter(id('A'), 0),
          lobby: store.getLobby(id('A')),
          players: store.playerCount(id('A')),
          ids: [store.runningMatchIds(), store.lobbyIds(), store.lobbiesExpiringBefore(T0 + 10_000)],
        },
        (_k, v) => (v instanceof Uint8Array ? Array.from(v) : v),
      );
      expect(everything).not.toContain('ns-marker-x');
    });
  });

  it('FR-494 the purge of an expired lobby after its retention deletes the client row, the lobby and the match; a started one stays', () => {
    withStore((store) => {
      put(store, id('A'), 'discord');
      put(store, id('B'));
      put(store, id('C'), 'discord', T0 + 1);
      store.transaction(() => {
        store.markExpired(id('A'), T0 + 1000);
        store.markExpired(id('B'), T0 + 1000);
        store.markStarted(id('C'), T0 + 5);
      });
      const at = T0 + 1000 + LOBBY_RETENTION_MS + 1;
      expect(store.transaction(() => store.purgeExpired(at))).toBe(2);
      expect(store.getMatch(id('A'))).toBeUndefined();
      expect(store.getClientNamespace(id('A'))).toBeUndefined();
      expect(store.getMatch(id('B'))).toBeUndefined();
      expect(store.getMatch(id('C'))).toBeDefined();
      expect(store.getClientNamespace(id('C'))).toBe('discord');
    });
  });

  it('FR-494 start, expiry, steps and a halt leave the row as it was', () => {
    withStore((store) => {
      put(store, id('A'), 'discord');
      put(store, id('B'), 'discord', T0 + 1);
      const namespaces = (): string => JSON.stringify([store.getClientNamespace(id('A')), store.getClientNamespace(id('B'))]);
      const before = namespaces();
      store.transaction(() => store.markExpired(id('A'), T0 + 1000));
      const running = lobbyMatch(id('B'), { stage: 'phase-1', lastSeq: 2, lastStepMs: T0 + 10, createdAt: T0 + 1, anchors: { t0: T0 + 10, c1: T0 + 80_010, c2: T0 + 110_010, a: T0 + 120_010 } });
      store.transaction(() => {
        store.markStarted(id('B'), T0 + 10);
        store.updateMatch(running);
      });
      store.transaction(() => store.updateMatch({ ...running, stage: 'halted', lastSeq: 3, haltReason: 'clock-failure', anchors: null } as unknown as CoreMatch));
      expect(namespaces()).toBe(before);
    });
  });
});

describe('no path changes or removes a client match row', () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));

  it('FR-494 the sources use client_matches only in INSERT, SELECT, CREATE and the table list of the purge', () => {
    const kinds = new Set<string>();
    const purgeLists: string[] = [];
    for (const file of files(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO|ALTER\s+TABLE|DROP\s+TABLE|FROM|CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS|JOIN)\s+client_matches\b/gi)) {
        kinds.add((m[1] ?? '').toUpperCase().replace(/\s+/g, ' '));
      }
      if (/\[[^\]]*'client_matches'[^\]]*\]/.test(text)) purgeLists.push(file.slice(SRC.length + 1).replace(/\\/g, '/'));
    }
    for (const forbidden of ['UPDATE', 'REPLACE INTO', 'ALTER TABLE', 'DROP TABLE', 'DELETE FROM']) expect(kinds.has(forbidden), forbidden).toBe(false);
    expect(kinds.has('INSERT INTO')).toBe(true);
    // The one delete is the child-first table list of the purge, in sqlite.ts; `TABLES` in schema.ts lists every table too.
    expect(purgeLists.sort()).toStrictEqual(['store/schema.ts', 'store/sqlite.ts']);
  });

  it('FR-494 the Store interface has no method that changes or removes a client match', () => {
    const text = readFileSync(join(SRC, 'store', 'store.ts'), 'utf8');
    const methods = [...text.matchAll(/^\s+(\w*[cC]lient\w*)[(<]/gm)].map((m) => m[1]);
    expect(methods.sort()).toStrictEqual(['getClientNamespace', 'insertClientMatch']);
  });
});
