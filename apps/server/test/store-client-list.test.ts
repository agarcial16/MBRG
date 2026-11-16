import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { MatchEvent, PublicState } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import type { CoreMatch } from '../src/core/view';
import { openStore, READ_SQL } from '../src/store/sqlite';
import type { Store } from '../src/store/store';

// Spec 018 FR-501: the match list carries `clientOnly: true` for the matches with a client row and nothing for the others.

const DIGEST = (c: string): string => c.repeat(64);
const SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 5 + 1) % 256);
const T0 = 1_700_000_000_000;
const state: PublicState = { mode: 'classic', round: 0, owners: [[1, 10], [2, 20]] };
const id = (n: number): string => String(n).padStart(16, '0');

const lobby = (matchId: string, createdAt: number): CoreMatch => ({
  matchId, mapId: 'dev', mapDigest: DIGEST('a'), totalRounds: 5, timing: { i: 120, l1: 30, l2: 10 }, commitment: DIGEST('c'), stage: 'lobby',
  appliedRounds: 0, state, stateDigest: DIGEST('d'), lastSeq: 1, createdAt, lastStepMs: createdAt, anchors: null,
});

const put = (store: Store, n: number, clientOnly: boolean): void => {
  const match = lobby(id(n), T0 + n);
  const event: MatchEvent = { type: 'schedule', seq: 1, stage: 'lobby', reportedTime: match.createdAt };
  store.transaction(() => {
    store.insertMatch({ match, secret: SECRET, hostTokenDigest: DIGEST('b') });
    if (clientOnly) store.insertClientMatch(match.matchId, 'discord');
    store.appendEvents(match.matchId, [event]);
  });
};

describe('the match list and client-only matches', () => {
  it('FR-501 a mixed list carries clientOnly true only on the client matches, in keyset order across a page boundary', () => {
    const store = openStore(':memory:');
    try {
      for (let n = 1; n <= 5; n++) put(store, n, n % 2 === 0);
      const first = store.listMatches(undefined, 3);
      expect(first.map((m) => m.matchId)).toStrictEqual([id(1), id(2), id(3)]);
      expect(first.map((m) => m.clientOnly)).toStrictEqual([undefined, true, undefined]);
      expect('clientOnly' in first[0]!).toBe(false);
      const last = first[2]!;
      const rest = store.listMatches([last.createdAt, last.matchId], 10);
      expect(rest.map((m) => [m.matchId, m.clientOnly])).toStrictEqual([[id(4), true], [id(5), undefined]]);
      // The member is exactly `true`, and no namespace is in any row of the list.
      expect(JSON.stringify([...first, ...rest])).not.toContain('discord');
    } finally {
      store.close();
    }
  });

  it('FR-501 the list query reaches the client rows through the primary key, not a scan of client_matches per row', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrg-list-'));
    try {
      const file = join(dir, 'l.sqlite');
      openStore(file).close();
      const db = new DatabaseSync(file);
      try {
        const plan = db.prepare(`EXPLAIN QUERY PLAN ${READ_SQL.listMatches}`).all(-1, '', 10).map((r) => String(r.detail));
        const forClient = plan.find((d) => /client_matches/.test(d));
        expect(forClient, plan.join(' | ')).toMatch(/SEARCH .*USING (INDEX|PRIMARY KEY|COVERING INDEX)/);
        expect(plan.some((d) => /SCAN (c|client_matches)\b/.test(d)), plan.join(' | ')).toBe(false);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
