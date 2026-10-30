import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePublicMatch } from '@mbrg/protocol';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openStore } from '../src/store/sqlite';
import { dumpRows, withRawDb } from './helpers/db-scan';
import { CLIENT, resultsReads } from './helpers/durability-script';
import { START_MS, OPERATOR, creationBody, serviceHarness, withTempDir } from './helpers/service-harness';
import type { Harness } from './helpers/service-harness';

// A database written before schema version 2 (spec 011 M2 T9). The committed fixture (written by the previous store) opens,
// upgrades and is served by the service; and a running operator match, cut back to the version 1 shape, continues to step
// and score after the upgrade exactly as the same match does on a native version 2 file: same events, results, public data
// and stored rows. (The previous build itself is not available to the tests; the cut-back file has exactly the version 1
// tables, definitions and meta, and operator matches have no lobby row.)

const V1_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'v1-database.db');
const S = 1000;

/** Rewrites a closed version 2 file as a version 1 file: the v2 tables dropped, `meta` and `user_version` back to 1. */
const cutBackToV1 = (file: string): void => {
  const db = new DatabaseSync(file);
  try {
    db.exec('BEGIN');
    db.exec('DROP TABLE players');
    db.exec('DROP TABLE lobbies');
    db.exec('UPDATE meta SET schema_version = 1');
    db.exec('PRAGMA user_version = 1');
    db.exec('COMMIT');
  } finally {
    db.close();
  }
};

const harnessOn = (file: string, at: number): Harness => serviceHarness({ store: openStore(file), start: at });

/** Ticks at every due anchor until the match ends. */
const finish = (h: Harness, matchId: string): void => {
  for (let i = 0; i < 100; i++) {
    const shown = h.service.publicMatch(matchId)!;
    if (shown.stage === 'finished' || shown.stage === 'halted') return;
    const schedule = shown.schedule!;
    h.clock.set(shown.stage === 'phase-1' ? schedule.c1 : shown.stage === 'phase-2' ? schedule.c2 : schedule.a);
    h.service.tick();
  }
  throw new Error('the match does not end');
};

describe('a database written before the lobby tables', () => {
  it('FR-391 the committed version 1 file opens as version 2 under the service and its matches are served as they were', () => {
    withTempDir((dir) => {
      const file = join(dir, 'v1.sqlite');
      copyFileSync(V1_FIXTURE, file);
      const h = harnessOn(file, START_MS + 10_000);
      try {
        expect(h.store.settings().userVersion).toBe(2);
        const a = h.service.publicMatch('AAAAAAAAAAAAAAAA');
        const b = h.service.publicMatch('BBBBBBBBBBBBBBBB');
        expect(a).toMatchObject({ stage: 'phase-2', appliedRounds: 1, lastSeq: 3 });
        expect(b).toMatchObject({ stage: 'phase-1', appliedRounds: 0 });
        expect('playerCount' in a!).toBe(false);
        expect(h.service.readPublicMatch('AAAAAAAAAAAAAAAA').ok).toBe(true);
        expect(h.store.eventsAfter('AAAAAAAAAAAAAAAA', 0).map((e) => e.seq)).toStrictEqual([1, 2, 3]);
        // Neither match is a lobby: public creation counts see nothing of them.
        expect(h.store.openLobbyCount()).toBe(0);
        expect(h.store.publicRunningCount()).toBe(0);
        expect(h.store.lobbyIds()).toStrictEqual([]);
        // (The fixture's map digest is not the dev map's, so a server start check would halt them: the file is only read here;
        // stepping after the upgrade is proved by the next test with a real match.)
      } finally {
        h.close();
      }
    });
  });

  it('FR-391 a running operator match cut back to version 1 steps and scores after the upgrade exactly as on a native version 2 file', () => {
    withTempDir((dir) => {
      const base = join(dir, 'base.sqlite');
      // The first server: an operator clock match with predictions, up to the close of phase 1 of round 1.
      const first = harnessOn(base, START_MS);
      let matchId = '';
      try {
        const made = first.service.create({ credential: OPERATOR, body: creationBody('c-1') });
        if (!made.ok) throw new Error('creation failed');
        matchId = made.reply.matchId;
        const submit = (body: Record<string, unknown>): void => {
          expect(first.service.submit({ client: { ...CLIENT }, matchId, body }).ok).toBe(true);
        };
        submit({ kind: 'victim', round: 1, faction: 1, playerId: 'p1', requestId: 'v-1' });
        submit({ kind: 'winner', faction: 2, playerId: 'p1', requestId: 'w-1' });
        submit({ kind: 'victim', round: 1, faction: 3, playerId: 'p2' });
        first.clock.set(START_MS + 80 * S);
        first.service.tick();
        expect(first.service.publicMatch(matchId)?.stage).toBe('phase-2');
      } finally {
        first.close();
      }
      const native = join(dir, 'native.sqlite');
      const old = join(dir, 'old.sqlite');
      copyFileSync(base, native);
      copyFileSync(base, old);
      cutBackToV1(old);
      expect(withRawDb(old, (db) => Number(db.prepare('PRAGMA user_version').get()?.user_version))).toBe(1);
      expect(withRawDb(old, (db) => db.prepare("SELECT name FROM sqlite_master WHERE name IN ('lobbies', 'players')").all())).toStrictEqual([]);

      const outcome = (file: string): { events: string; results: string; publicMatch: string; dump: string } => {
        const h = harnessOn(file, START_MS + 80 * S);
        try {
          expect(h.service.start().failed).toStrictEqual([]);
          finish(h, matchId);
          const shown = h.service.publicMatch(matchId)!;
          expect(shown.stage).toBe('finished');
          return { events: JSON.stringify(h.store.eventsAfter(matchId, 0)), results: resultsReads(h.service, matchId), publicMatch: encodePublicMatch(shown), dump: '' };
        } finally {
          h.close();
        }
      };
      const a = outcome(native);
      const b = outcome(old);
      expect(b.events).toBe(a.events);
      expect(b.results).toBe(a.results);
      expect(b.publicMatch).toBe(a.publicMatch);
      // Scored: the run is not vacuous.
      expect(JSON.parse(a.results).players['web:p1'].items.length).toBeGreaterThan(0);
      // The stored rows end equal, the upgrade included (both files are version 2 now).
      expect(withRawDb(old, dumpRows) === withRawDb(native, dumpRows)).toBe(true);
      expect(withRawDb(old, (db) => Number(db.prepare('PRAGMA user_version').get()?.user_version))).toBe(2);
    });
  });
});
