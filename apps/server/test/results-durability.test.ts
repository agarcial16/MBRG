import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';
import { withRawDb } from './helpers/db-scan';
import { TOTAL_STEPS, expectedRows, openScript, runScript, stepScript } from './helpers/results-script';
import type { ExpectedRow, ScriptRig } from './helpers/results-script';
import { snapshotOf } from './helpers/results-timelines';
import { serviceHarness, withTempDir } from './helpers/service-harness';

// Durability of the results (spec 008 NFR-57 results part, FR-294 results replay; M4' T5'). A server killed just AFTER the
// COMMIT of a step and BEFORE it publishes anything (the commit returns, the process is gone): the decision is stored whole,
// scored once, and after a restart the replay holds its `results` event once with its stored number, the rows exist once and
// the match goes on to the results of the uninterrupted run. The kill points between and inside transactions, and the results
// reads after each of them, are in service-durability.test.ts (the script there reads the results at its end).

const PLAYERS = ['web:p1', 'web:p2', 'web:p3', 'web:p4', 'web:p5', 'web:p6', 'discord:p1', 'web:nobody'];

interface DbRow {
  round: number;
  kind: string;
  player_id: string;
  choice: number;
  correct: number;
  points: number;
}
const resultRows = (file: string): DbRow[] =>
  withRawDb(file, (db) => db.prepare('SELECT round, kind, player_id, choice, correct, points FROM results ORDER BY round, kind, player_id').all().map((r) => ({ ...r }) as unknown as DbRow));
const eventPayloads = (file: string): string[] => withRawDb(file, (db) => db.prepare('SELECT payload_json FROM events ORDER BY seq').all().map((r) => String(r.payload_json)));
const lastSeqOfStep = (file: string, step: number): number => withRawDb(file, (db) => Number(db.prepare('SELECT last_seq FROM steps ORDER BY rowid LIMIT 1 OFFSET ?').get(step - 1)!.last_seq));
/** The result rows the script's own arithmetic expects once `done` steps are performed, in the order of the table query. */
const modelRows = (r: ScriptRig, done: number): DbRow[] =>
  expectedRows(r, done)
    .map((x: ExpectedRow) => ({ round: x.round, kind: x.kind, player_id: x.playerId, choice: x.choice, correct: x.correct ? 1 : 0, points: x.points }))
    .sort((a, b) => a.round - b.round || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.player_id < b.player_id ? -1 : 1));

/** A store whose commit of the `at`-th step decision (a transaction that wrote a step row) is followed by the end of the process. */
function killAfterCommitOf(file: string, at: number): { store: Store; fired: () => boolean } {
  const base = openStore(file);
  const state = { steps: 0, wrote: false, fired: false };
  const store: Store = {
    ...base,
    putStep: (matchId, step) => {
      state.wrote = true;
      base.putStep(matchId, step);
    },
    transaction<T>(fn: () => T): T {
      state.wrote = false;
      const value = base.transaction(fn);
      if (state.wrote) {
        state.steps += 1;
        if (state.steps === at) {
          state.fired = true;
          base.close();
          throw new Error('the process was killed after the commit');
        }
      }
      return value;
    },
  };
  return { store, fired: () => state.fired };
}

describe('the results survive a kill after the commit', () => {
  it('NFR-57 (results) FR-294 (results replay) a kill after the COMMIT of every step and before its publication: its events and rows are stored once, the replay holds the results event with its number, and the match ends with the results of the uninterrupted run', () => {
    withTempDir((dir) => {
      const referenceFile = join(dir, 'reference.sqlite');
      const reference = openScript({ store: openStore(referenceFile) });
      runScript(reference, TOTAL_STEPS);
      const id = reference.id;
      const expectedSnapshot = JSON.stringify(snapshotOf(reference.h.service, id, PLAYERS, 4));
      reference.h.close();
      const referenceRows = resultRows(referenceFile);
      const referenceEvents = eventPayloads(referenceFile);
      expect(referenceRows).toStrictEqual(modelRows(reference, TOTAL_STEPS));
      expect(referenceRows).toHaveLength(23); // the forced absorber of round 4 has no row
      expect(referenceEvents.filter((e) => e.startsWith('{"type":"results"'))).toHaveLength(8);

      for (let at = 1; at <= TOTAL_STEPS; at += 1) {
        const file = join(dir, `kill-${at}.sqlite`);
        const killer = killAfterCommitOf(file, at);
        const first = openScript({ store: killer.store });
        const published: string[] = [];
        first.h.service.subscribe((_, events) => published.push(...events.map((e) => e.type)));
        expect(() => runScript(first, TOTAL_STEPS), `kill after step ${at}`).toThrow('the process was killed after the commit');
        expect(killer.fired()).toBe(true);
        expect(first.done, `steps acknowledged before the kill ${at}`).toBe(at - 1);

        // Whole and once: the events up to the end of that step are the reference's, the rows are the ones scored by then.
        const upTo = lastSeqOfStep(referenceFile, at);
        const stored = eventPayloads(file);
        expect(stored, `events stored after kill ${at}`).toStrictEqual(referenceEvents.slice(0, upTo));
        expect(resultRows(file), `rows stored after kill ${at}`).toStrictEqual(modelRows(reference, at));
        // The decision was committed but its events were never published by the killed server.
        const previous = at === 1 ? 1 : lastSeqOfStep(referenceFile, at - 1);
        expect(published.length, `published before kill ${at}`).toBe(previous - 1);
        if (at > 1) expect(published).toContain('results');

        // The restart: a new store and service on the same file, `start()`; the replay read holds the stored events once.
        const second = serviceHarness({ store: openStore(file) });
        expect(second.service.start().failed).toStrictEqual([]);
        const replay = second.service.eventsAfter(id, 0);
        if (!replay.ok) throw new Error('replay refused');
        expect(replay.reply.lastSeq).toBe(upTo);
        expect(replay.reply.events.map((e) => JSON.stringify(e))).toStrictEqual(stored);
        const resultsEvents = replay.reply.events.filter((e) => e.type === 'results');
        expect(resultsEvents).toHaveLength(stored.filter((e) => e.startsWith('{"type":"results"')).length);
        expect(new Set(resultsEvents.map((e) => e.seq)).size).toBe(resultsEvents.length);

        // The match goes on from the next step and ends as the uninterrupted one did.
        const resumed: ScriptRig = { ...first, h: second, done: at };
        runScript(resumed, TOTAL_STEPS);
        expect(JSON.stringify(snapshotOf(second.service, id, PLAYERS, 4)), `results after kill ${at}`).toBe(expectedSnapshot);
        second.close();
        expect(resultRows(file), `final rows after kill ${at}`).toStrictEqual(referenceRows);
        expect(eventPayloads(file), `final events after kill ${at}`).toStrictEqual(referenceEvents);
      }
    });
  }, 180_000);

  it('NFR-57 (results) the script is over after its 12 steps', () => {
    const r = openScript();
    runScript(r, TOTAL_STEPS);
    expect(() => stepScript(r)).toThrow('the script is over');
    r.h.close();
  });
});
