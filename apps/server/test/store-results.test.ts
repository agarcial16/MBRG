import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { StepKind } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import type { ResultRow } from '../src/core/scoring';
import { openStore } from '../src/store/sqlite';
import { StoreError } from '../src/store/store';
import { storedFutureViolations, withRawDb } from './helpers/db-scan';
import { DEV_DIR } from './helpers/digests';
import { SECRETS } from './helpers/core-timelines';
import { OPERATOR, START_MS, creationBody, serviceHarness, withTempDir, writeMapPackage } from './helpers/service-harness';
import type { Harness, HarnessOptions } from './helpers/service-harness';

// The result rows of the store (spec 008 M4 T4, plan 20.5): the scorer's input read, the refusals of premature rows (defence
// in depth for FR-256 and FR-270) and the storage anti-spoiler scan over the new rows and events (NFR-47 (d), results).

const S = 1000;
const WEB = { credential: 'client-credential-web-0123456789ab', namespace: 'web' };

interface Rig {
  readonly h: Harness;
  readonly id: string;
}

function rig(options: HarnessOptions & { timing?: unknown } = {}): Rig {
  const { timing, ...rest } = options;
  const h = serviceHarness({ secret: SECRETS['ascending-00-1f'], ...rest });
  const out = h.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing: timing ?? 'manual' }) });
  if (!out.ok) throw new Error(`creation failed: ${JSON.stringify(out.error)}`);
  return { h, id: out.reply.matchId };
}

const step = (r: Rig, round: number, kind: StepKind): void => {
  const out = r.h.service.advance({ credential: OPERATOR, matchId: r.id, body: { round, step: kind } });
  if (!out.ok) throw new Error(`advance refused: ${JSON.stringify(out.error)}`);
};
const predict = (r: Rig, playerId: string, body: Record<string, unknown>): void => {
  const out = r.h.service.submit({ client: WEB, matchId: r.id, body: { playerId, ...body } });
  if (!out.ok) throw new Error(`refused: ${JSON.stringify(out.error)}`);
};
const living = (r: Rig): number[] => [...new Set(r.h.store.getMatch(r.id)!.match.state.owners.map(([, f]) => f))].sort((a, b) => a - b);
const row = (kind: ResultRow['kind'], round: number, playerId = 'web:x', correct = false, points = 0): ResultRow => ({ playerId, kind, round, choice: 1, correct, points });
const put = (r: Rig, rows: readonly ResultRow[]): void => r.h.store.transaction(() => r.h.store.putResults(r.id, rows));
/** The refusal of a put: its error code, or undefined when it was accepted. */
const refusal = (r: Rig, rows: readonly ResultRow[]): string | undefined => {
  try {
    put(r, rows);
    return undefined;
  } catch (error) {
    if (error instanceof StoreError) return error.code;
    throw error;
  }
};

describe('the scorer input of the store', () => {
  it('FR-271 FR-272 FR-273 predictionsOfPhase lists the predictions of one kind and round by player id in code unit order, with the winner count only for the winner', () => {
    const r = rig();
    const alive = living(r);
    predict(r, 'c', { kind: 'victim', round: 1, faction: alive[0] });
    predict(r, 'B', { kind: 'victim', round: 1, faction: alive[1] });
    predict(r, 'a', { kind: 'victim', round: 1, faction: alive[2] });
    predict(r, 'a', { kind: 'winner', faction: alive[3] });
    predict(r, 'B', { kind: 'winner', faction: alive[4] });
    expect(r.h.store.predictionsOfPhase(r.id, 'victim', 1)).toStrictEqual([
      { playerId: 'web:B', choice: alive[1] },
      { playerId: 'web:a', choice: alive[2] },
      { playerId: 'web:c', choice: alive[0] },
    ]);
    expect(r.h.store.predictionsOfPhase(r.id, 'winner', 0)).toStrictEqual([
      { playerId: 'web:B', choice: alive[4], winnerCandidates: 5 },
      { playerId: 'web:a', choice: alive[3], winnerCandidates: 5 },
    ]);
    expect(r.h.store.predictionsOfPhase(r.id, 'absorber', 1)).toStrictEqual([]);
    expect(r.h.store.predictionsOfPhase(r.id, 'victim', 2)).toStrictEqual([]);
    expect(r.h.store.predictionsOfPhase('m-unknown', 'victim', 1)).toStrictEqual([]);
    r.h.close();
  });

  it('FR-271 predictionsOfPhase refuses a winner that is not round 0, another kind at round 0, and an unknown kind', () => {
    const r = rig();
    expect(() => r.h.store.predictionsOfPhase(r.id, 'winner', 1)).toThrow(RangeError);
    expect(() => r.h.store.predictionsOfPhase(r.id, 'victim', 0)).toThrow(RangeError);
    expect(() => r.h.store.predictionsOfPhase(r.id, 'absorber', 1.5)).toThrow(RangeError);
    expect(() => r.h.store.predictionsOfPhase(r.id, 'loser' as never, 1)).toThrow(RangeError);
    r.h.close();
  });
});

describe('putResults refusals', () => {
  it('FR-271 FR-272 FR-273 in phase 1 of round 1 no row is accepted: no victim before its reveal, no absorber, no winner', () => {
    const r = rig();
    for (const rows of [[row('victim', 1)], [row('victim', 2)], [row('absorber', 1)], [row('winner', 0)]]) expect(refusal(r, rows), JSON.stringify(rows)).toBe('invalid-write');
    expect(refusal(r, [])).toBeUndefined();
    r.h.close();
  });

  it('FR-271 FR-272 after the phase-1 close the victim of round N + 1 is accepted once; a victim of N + 2, an absorber of round 1 and the winner are refused', () => {
    const r = rig();
    step(r, 1, 'phase-1-close');
    expect(refusal(r, [row('victim', 2)])).toBe('invalid-write');
    expect(refusal(r, [row('absorber', 1)])).toBe('invalid-write');
    expect(refusal(r, [row('winner', 0)])).toBe('invalid-write');
    expect(refusal(r, [row('victim', 1)])).toBeUndefined();
    // A phase is scored once: the same key again is refused, another player is not.
    expect(refusal(r, [row('victim', 1)])).toBe('invalid-write');
    expect(refusal(r, [row('victim', 1, 'web:y')])).toBeUndefined();
    r.h.close();
  });

  it('FR-272 after the application the absorber of round N is accepted once, the absorber of N + 1 and the victim of N + 1 before its reveal are refused', () => {
    const r = rig();
    for (const kind of ['phase-1-close', 'phase-2-close', 'application'] as const) step(r, 1, kind);
    expect(r.h.store.getMatch(r.id)!.match).toMatchObject({ stage: 'phase-1', appliedRounds: 1 });
    expect(refusal(r, [row('absorber', 2)])).toBe('invalid-write');
    expect(refusal(r, [row('victim', 2)])).toBe('invalid-write');
    expect(refusal(r, [row('winner', 0)])).toBe('invalid-write');
    expect(refusal(r, [row('absorber', 1)])).toBeUndefined();
    expect(refusal(r, [row('absorber', 1)])).toBe('invalid-write');
    r.h.close();
  });

  it('FR-273 the winner row is accepted only when the match is finished, with round 0, once', () => {
    const r = rig();
    for (let k = 1; k <= 4; k++) for (const kind of ['phase-1-close', 'phase-2-close', 'application'] as const) step(r, k, kind);
    expect(r.h.store.getMatch(r.id)!.match.stage).toBe('finished');
    expect(refusal(r, [row('winner', 1)])).toBe('invalid-write');
    expect(refusal(r, [row('winner', 0)])).toBeUndefined();
    expect(refusal(r, [row('winner', 0)])).toBe('invalid-write');
    expect(refusal(r, [row('absorber', 5)])).toBe('invalid-write');
    r.h.close();
  });

  it('FR-271 a refused batch leaves none of its rows, and a row is refused unless its points fit its correct bit', () => {
    const r = rig();
    step(r, 1, 'phase-1-close');
    expect(refusal(r, [row('victim', 1, 'web:ok'), row('absorber', 1, 'web:ok')])).toBe('invalid-write');
    expect(refusal(r, [row('victim', 1, 'web:ok', false, 3)])).toBe('invalid-write');
    expect(refusal(r, [row('victim', 1, 'web:ok', true, -1)])).toBe('invalid-write');
    expect(refusal(r, [row('victim', 1, 'web:ok', true, 1.5)])).toBe('invalid-write');
    expect(refusal(r, [row('victim', 0, 'web:ok')])).toBe('invalid-write');
    expect(refusal(r, [row('loser' as never, 1, 'web:ok')])).toBe('invalid-write');
    expect(refusal(r, [{ ...row('victim', 1, 'web:ok'), correct: 1 as never }])).toBe('invalid-write');
    // Nothing of the refused batches was stored: the same row is accepted now.
    expect(refusal(r, [row('victim', 1, 'web:ok', true, 5)])).toBeUndefined();
    r.h.close();
  });

  it('FR-271 a write outside a transaction and a write for an unknown match are refused', () => {
    const r = rig();
    expect(() => r.h.store.putResults(r.id, [row('victim', 1)])).toThrow(StoreError);
    expect(() => r.h.store.transaction(() => r.h.store.putResults('m-unknown', [row('victim', 1)]))).toThrow(StoreError);
    r.h.close();
  });
});

describe('the storage scan sees the results rules (NFR-47 (d), results)', () => {
  /** A file database with one created match (store closed), for planting rows with a raw connection. */
  const planted = (body: (db: import('node:sqlite').DatabaseSync, id: string) => void): void =>
    withTempDir((dir) => {
      const file = join(dir, 'planted.sqlite');
      const r = rig({ store: openStore(file) });
      r.h.close();
      withRawDb(file, (db) => {
        expect(storedFutureViolations(db)).toStrictEqual([]);
        body(db, r.id);
      });
    });
  const result = (db: import('node:sqlite').DatabaseSync, id: string, round: number, kind: string, player: string): void => {
    db.prepare('INSERT INTO results (match_id, round, kind, player_id, choice, correct, points) VALUES (?, ?, ?, ?, 1, 1, 5)').run(id, round, kind, player);
  };
  const event = (db: import('node:sqlite').DatabaseSync, id: string, seq: number, payload: Record<string, unknown>): void => {
    db.prepare('INSERT INTO events (match_id, seq, type, payload_json) VALUES (?, ?, ?, ?)').run(id, seq, String(payload.type), JSON.stringify(payload));
  };

  it('FR-271 FR-272 FR-273 planted rows are flagged: an absorber of the pending round, a victim before its reveal or of a later round, a winner of a running match', () => {
    planted((db, id) => {
      result(db, id, 1, 'absorber', 'web:a');
      result(db, id, 1, 'victim', 'web:b');
      result(db, id, 3, 'victim', 'web:c');
      result(db, id, 0, 'winner', 'web:d');
      expect(storedFutureViolations(db)).toStrictEqual([
        `${id} result absorber round 1 web:a: absorber scored for a round above N = 0`,
        `${id} result victim round 1 web:b: victim scored before its reveal (N = 0, stage phase-1)`,
        `${id} result victim round 3 web:c: victim scored before its reveal (N = 0, stage phase-1)`,
        `${id} result winner round 0 web:d: winner scored in stage phase-1`,
      ]);
    });
  });

  it('FR-271 a victim row of a revealed round is not flagged, an absorber row of the same round still is', () => {
    planted((db, id) => {
      db.prepare("UPDATE matches SET stage = 'phase-2', victim = 2, reveal_ms = ? WHERE id = ?").run(START_MS, id);
      event(db, id, 2, { type: 'phase-closed', seq: 2, round: 1, phase: 1, at: START_MS });
      event(db, id, 3, { type: 'victim-revealed', seq: 3, round: 1, reportedTime: START_MS });
      event(db, id, 4, { type: 'results', seq: 4, round: 1, phase: 1 });
      result(db, id, 1, 'victim', 'web:a');
      expect(storedFutureViolations(db)).toStrictEqual([]);
      result(db, id, 1, 'absorber', 'web:a');
      expect(storedFutureViolations(db)).toStrictEqual([`${id} result absorber round 1 web:a: absorber scored for a round above N = 0`]);
    });
  });

  it('FR-287 (d) planted results events are flagged: (N + 1, 1) before the reveal, (k, 2) above N, and a round above N + 1', () => {
    planted((db, id) => {
      event(db, id, 2, { type: 'results', seq: 2, round: 1, phase: 1 });
      event(db, id, 3, { type: 'results', seq: 3, round: 1, phase: 2 });
      event(db, id, 4, { type: 'results', seq: 4, round: 2, phase: 1 });
      expect(storedFutureViolations(db)).toStrictEqual([
        `${id} event 2 results: round 1 scored in stage phase-1`,
        `${id} event 3 results: phase 2 results for round 1 above N = 0`,
        `${id} event 4 results: round 2 above N + 1 = 1`,
      ]);
    });
  });

  it('FR-271 FR-272 FR-273 the scan finds nothing over full matches with predictions: manual, clock with L2 above 0, clock with L2 = 0, and halted, at every step', () => {
    const script = (r: Rig, k: number, kind: StepKind): void => {
      step(r, k, kind);
      if (kind === 'phase-1-close') {
        const candidates = r.h.store.getMatch(r.id)!.match.victim!.candidates;
        // A victim with one candidate is a forced absorber: the server refuses the prediction, so none is sent.
        if (candidates.length > 1) predict(r, 'p1', { kind: 'absorber', round: k, faction: candidates[0] });
      }
    };
    const kinds = ['phase-1-close', 'phase-2-close', 'application'] as const;
    for (let stopAt = 1; stopAt <= 12; stopAt++) {
      withTempDir((dir) => {
        const file = join(dir, 'm.sqlite');
        const r = rig({ store: openStore(file) });
        let done = 0;
        for (let k = 1; k <= 4 && done < stopAt; k++) {
          // The same two predictions every round: the victim and (once the reveal is out) the absorber.
          const alive = living(r);
          predict(r, 'p1', { kind: 'victim', round: k, faction: alive[0] });
          predict(r, 'p2', { kind: 'victim', round: k, faction: alive[alive.length - 1] });
          for (let i = 0; i < 3 && done < stopAt; i++, done++) script(r, k, kinds[i]!);
        }
        r.h.close();
        withRawDb(file, (db) => expect(storedFutureViolations(db), `stop at step ${stopAt}`).toStrictEqual([]));
      });
    }
    for (const timing of [{ i: 120, l1: 30, l2: 10 }, { i: 60, l1: 20, l2: 0 }]) {
      withTempDir((dir) => {
        const file = join(dir, 'm.sqlite');
        const r = rig({ store: openStore(file), scheduler: true, timing });
        predict(r, 'p1', { kind: 'victim', round: 1, faction: living(r)[0] });
        predict(r, 'p1', { kind: 'winner', faction: living(r)[1] });
        r.h.scheduler!.runTo(START_MS + 4 * timing.i * S + 5);
        expect(r.h.store.getMatch(r.id)!.match.stage).toBe('finished');
        r.h.close();
        withRawDb(file, (db) => {
          expect(storedFutureViolations(db), JSON.stringify(timing)).toStrictEqual([]);
          expect(Number(db.prepare('SELECT COUNT(*) AS n FROM results').get()!.n)).toBe(2);
        });
      });
    }
    withTempDir((dir) => {
      const folder = writeMapPackage(dir, 'pkg', readFileSync(join(DEV_DIR, 'map.json'), 'utf8'));
      const file = join(dir, 'm.sqlite');
      const r = rig({ store: openStore(file), folders: { dev: folder } });
      predict(r, 'p1', { kind: 'victim', round: 1, faction: living(r)[0] });
      step(r, 1, 'phase-1-close');
      rmSync(join(folder, 'map.json'));
      expect(r.h.service.advance({ credential: OPERATOR, matchId: r.id, body: { round: 1, step: 'phase-2-close' } }).ok).toBe(false);
      r.h.close();
      withRawDb(file, (db) => {
        expect(storedFutureViolations(db)).toStrictEqual([]);
        expect(Number(db.prepare("SELECT COUNT(*) AS n FROM results WHERE kind = 'victim'").get()!.n)).toBe(1);
      });
    });
  });
});
