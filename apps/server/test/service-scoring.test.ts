import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { errorReply } from '@mbrg/protocol';
import type { StepKind } from '@mbrg/protocol';
import { absorptionCandidatesOf, livingFactions } from '@mbrg/sim';
import type { MatchState } from '@mbrg/sim';
import { describe, expect, it } from 'vitest';
import type { ResultRow } from '../src/core/scoring';
import { openStore } from '../src/store/sqlite';
import type { Store } from '../src/store/store';
import { withRawDb } from './helpers/db-scan';
import { DEV_DIR, devMap } from './helpers/digests';
import { SECRETS } from './helpers/core-timelines';
import { OPERATOR, START_MS, creationBody, serviceHarness, withTempDir, writeMapPackage } from './helpers/service-harness';
import type { Harness, HarnessOptions } from './helpers/service-harness';

// Scoring inside the step transaction (spec 008 M4 T4), through the lifecycle service with the fake clock and file or
// in-memory databases. The expectations are computed here from the public data (the revealed victim, the candidates
// and the living factions through the sim exports) and from golden/dev-secrets.json (the absorbers and the winner), never
// from src/core/scoring.ts.

const S = 1000;
const WEB = { credential: 'client-credential-web-0123456789ab', namespace: 'web' };
const SECRET = SECRETS['ascending-00-1f'];
/** C1 of round 1 with I = 120, L1 = 30, L2 = 10. */
const C1 = START_MS + 80 * S;

interface Gold {
  readonly round: number;
  readonly victim: number;
  readonly absorber: number;
}
const GOLD = (JSON.parse(readFileSync(new URL('./golden/dev-secrets.json', import.meta.url), 'utf8')) as { matches: Record<string, { rounds: Gold[] }> }).matches['ascending-00-1f']!.rounds;
const WINNER = GOLD[3]!.absorber;

interface Logged {
  readonly op: string;
  readonly rows?: readonly ResultRow[];
  readonly inside: boolean;
}

/** The store wrapped so that a test sees every write in order, whether it ran inside a transaction, and can fail one write. */
function recording(base: Store) {
  const log: Logged[] = [];
  let depth = 0;
  const fail = { putStep: false };
  const note = (op: string, rows?: readonly ResultRow[]): void => {
    log.push({ op, ...(rows === undefined ? {} : { rows: rows.map((r) => ({ ...r })) }), inside: depth > 0 });
  };
  const store: Store = {
    ...base,
    transaction<T>(fn: () => T): T {
      depth += 1;
      try {
        return base.transaction(fn);
      } finally {
        depth -= 1;
      }
    },
    updateMatch: (match) => (note('updateMatch'), base.updateMatch(match)),
    putRecord: (matchId, record) => (note('putRecord'), base.putRecord(matchId, record)),
    putResults: (matchId, rows) => (note('putResults', rows), base.putResults(matchId, rows)),
    putStep: (matchId, step) => {
      if (fail.putStep) throw new Error('boom');
      note('putStep');
      base.putStep(matchId, step);
    },
    appendEvents: (matchId, events) => (note('appendEvents'), base.appendEvents(matchId, events)),
  };
  return { store, log, fail };
}

interface Rig {
  readonly h: Harness;
  readonly id: string;
  readonly log: Logged[];
  readonly fail: { putStep: boolean };
}

function rig(options: { file?: string; manual?: boolean; folders?: HarnessOptions['folders'] } = {}): Rig {
  const rec = recording(openStore(options.file ?? ':memory:'));
  const h = serviceHarness({ store: rec.store, secret: SECRET, ...(options.folders === undefined ? {} : { folders: options.folders }) });
  const out = h.service.create({ credential: OPERATOR, body: creationBody('c-1', options.manual === false ? {} : { timing: 'manual' }) });
  if (!out.ok) throw new Error(`creation failed: ${JSON.stringify(out.error)}`);
  return { h, id: out.reply.matchId, log: rec.log, fail: rec.fail };
}

const view = (r: Rig) => r.h.store.getMatch(r.id)!.match;
const livingAtN = (r: Rig): number[] => [...new Set(view(r).state.owners.map(([, f]) => f))].sort((a, b) => a - b);
const submit = (r: Rig, playerId: string, body: Record<string, unknown>) => r.h.service.submit({ client: WEB, matchId: r.id, body: { playerId, ...body } });
const predict = (r: Rig, playerId: string, body: Record<string, unknown>): void => {
  const out = submit(r, playerId, body);
  if (!out.ok) throw new Error(`refused: ${JSON.stringify(out.error)}`);
};
const step = (r: Rig, round: number, kind: StepKind): void => {
  const out = r.h.service.advance({ credential: OPERATOR, matchId: r.id, body: { round, step: kind } });
  if (!out.ok) throw new Error(`advance refused: ${JSON.stringify(out.error)}`);
};
const play = (r: Rig, round: number): void => {
  for (const kind of ['phase-1-close', 'phase-2-close', 'application'] as const) step(r, round, kind);
};
const row = (playerId: string, kind: ResultRow['kind'], round: number, choice: number, answer: number, worth: number): ResultRow => ({
  playerId,
  kind,
  round,
  choice,
  correct: choice === answer,
  points: choice === answer ? worth : 0,
});
const resultCalls = (r: Rig): (readonly ResultRow[])[] => r.log.filter((l) => l.op === 'putResults').map((l) => l.rows!);
/** The state at `round` as the sim reads it, from the stored state (public data). */
const stateAt = (r: Rig, round: number): MatchState => {
  const stored = r.h.store.getState(r.id, round)!;
  return { mode: 'classic', round, owners: stored.state.owners.map(([t, f]) => [t, f]) };
};
const must = <T>(v: { ok: true; value: T } | { ok: false; errors: unknown[] }): T => {
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  return v.value;
};
const dump = (file: string): unknown[] =>
  withRawDb(file, (db) => db.prepare('SELECT round, kind, player_id, choice, correct, points FROM results ORDER BY round, kind, player_id').all().map((x) => ({ ...x })));

describe('scoring in the step transaction', () => {
  it('FR-271 FR-241 (scoring) a phase-1 close writes one victim row per victim prediction of the round, worth n (5 on the dev map) or 0, and nothing else', () => {
    const r = rig();
    const alive = livingAtN(r);
    expect(alive).toHaveLength(5);
    expect(must(livingFactions(devMap(), stateAt(r, 0)))).toHaveLength(5);
    alive.forEach((f, i) => predict(r, `p${i + 1}`, { kind: 'victim', round: 1, faction: f }));
    expect(resultCalls(r)).toStrictEqual([]);
    step(r, 1, 'phase-1-close');
    const victim = view(r).victim!.victim;
    expect(GOLD[0]!.victim).toBe(victim);
    const calls = resultCalls(r);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toStrictEqual(alive.map((f, i) => row(`web:p${i + 1}`, 'victim', 1, f, victim, 5)));
    expect(calls[0]!.filter((x) => x.correct)).toHaveLength(1);
    expect(calls[0]!.filter((x) => x.correct)[0]!.points).toBe(5);
    expect(calls[0]!.filter((x) => !x.correct).every((x) => x.points === 0)).toBe(true);
    // The phase-2 close scores nothing.
    step(r, 1, 'phase-2-close');
    expect(resultCalls(r)).toHaveLength(1);
    r.h.close();
  });

  it('FR-272 FR-243 (scoring) an application writes one absorber row per absorber prediction of the round, worth d (the candidates of the victim) or 0, and does not score the victim again', () => {
    const r = rig();
    const alive = livingAtN(r);
    predict(r, 'p1', { kind: 'victim', round: 1, faction: alive[0] });
    step(r, 1, 'phase-1-close');
    const revealed = view(r).victim!;
    // d from the sim, not from the core: the candidates of the victim in the state at k - 1.
    const d = must(absorptionCandidatesOf(devMap(), stateAt(r, 0), revealed.victim)).length;
    expect(d).toBe(revealed.candidates.length);
    expect(d).not.toBe(revealed.living.length);
    revealed.candidates.forEach((c, i) => predict(r, `a${i + 1}`, { kind: 'absorber', round: 1, faction: c }));
    step(r, 1, 'phase-2-close');
    expect(resultCalls(r)).toHaveLength(1);
    step(r, 1, 'application');
    const calls = resultCalls(r);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toStrictEqual(revealed.candidates.map((c, i) => row(`web:a${i + 1}`, 'absorber', 1, c, GOLD[0]!.absorber, d)));
    expect(calls[1]!.filter((x) => x.correct).map((x) => x.choice)).toStrictEqual([GOLD[0]!.absorber]);
    r.h.close();
  });

  it('FR-273 FR-246 (scoring) after round T the winner predictions are scored, each worth the candidate count stored at its last change (5, 3 and 2 here), a wrong one 0', () => {
    const r = rig();
    const start = livingAtN(r);
    const wrong = start.find((f) => f !== WINNER)!;
    predict(r, 'p1', { kind: 'winner', faction: WINNER });
    predict(r, 'p3', { kind: 'winner', faction: wrong });
    predict(r, 'p4', { kind: 'winner', faction: wrong });
    play(r, 1);
    play(r, 2);
    expect(livingAtN(r)).toHaveLength(3);
    predict(r, 'p2', { kind: 'winner', faction: WINNER });
    // Round 3: after the reveal the victim is no longer a candidate: 3 living - 1 = 2.
    step(r, 3, 'phase-1-close');
    predict(r, 'p4', { kind: 'winner', faction: WINNER });
    step(r, 3, 'phase-2-close');
    step(r, 3, 'application');
    play(r, 4);
    expect(view(r).stage).toBe('finished');
    const calls = resultCalls(r);
    const winnerCall = calls[calls.length - 1]!;
    expect(winnerCall).toStrictEqual([
      { playerId: 'web:p1', kind: 'winner', round: 0, choice: WINNER, correct: true, points: 5 },
      { playerId: 'web:p2', kind: 'winner', round: 0, choice: WINNER, correct: true, points: 3 },
      { playerId: 'web:p3', kind: 'winner', round: 0, choice: wrong, correct: false, points: 0 },
      { playerId: 'web:p4', kind: 'winner', round: 0, choice: WINNER, correct: true, points: 2 },
    ]);
    expect(calls.filter((c) => c.some((x) => x.kind === 'winner'))).toHaveLength(1);
    r.h.close();
  });

  it('FR-271 a replaced prediction is scored once, with its last choice; the cutoff submission was refused and has no row', () => {
    const r = rig({ manual: false });
    const [a, b, c] = livingAtN(r);
    r.h.clock.set(C1 - 1);
    predict(r, 'p1', { kind: 'victim', round: 1, faction: a });
    predict(r, 'p1', { kind: 'victim', round: 1, faction: b });
    predict(r, 'p3', { kind: 'victim', round: 1, faction: c });
    r.h.clock.set(C1);
    expect(submit(r, 'p2', { kind: 'victim', round: 1, faction: a })).toStrictEqual({ ok: false, error: errorReply('prediction-closed') });
    expect(r.h.service.tick().performed).toHaveLength(1);
    const victim = view(r).victim!.victim;
    expect(resultCalls(r)).toStrictEqual([[row('web:p1', 'victim', 1, b!, victim, 5), row('web:p3', 'victim', 1, c!, victim, 5)]]);
    r.h.close();
  });

  it('FR-269 (results) a phase with no prediction writes no row and makes no results write; the other kinds are not scored by a victim prediction', () => {
    const r = rig();
    predict(r, 'p1', { kind: 'winner', faction: WINNER });
    r.log.length = 0;
    play(r, 1);
    expect(resultCalls(r)).toStrictEqual([]);
    expect(r.log.map((l) => l.op)).toStrictEqual(['updateMatch', 'putStep', 'appendEvents', 'updateMatch', 'putStep', 'appendEvents', 'updateMatch', 'putRecord', 'putStep', 'appendEvents']);
    r.h.close();
  });

  it('FR-241 (scoring) FR-243 (scoring) the rows are written in the step transaction, between the record and the step row, before the events', () => {
    const r = rig();
    const [a] = livingAtN(r);
    predict(r, 'p1', { kind: 'victim', round: 1, faction: a });
    r.log.length = 0;
    step(r, 1, 'phase-1-close');
    expect(r.log.map((l) => l.op)).toStrictEqual(['updateMatch', 'putResults', 'putStep', 'appendEvents']);
    predict(r, 'p1', { kind: 'absorber', round: 1, faction: view(r).victim!.candidates[0] });
    step(r, 1, 'phase-2-close');
    r.log.length = 0;
    step(r, 1, 'application');
    expect(r.log.map((l) => l.op)).toStrictEqual(['updateMatch', 'putRecord', 'putResults', 'putStep', 'appendEvents']);
    expect(r.log.every((l) => l.inside)).toBe(true);
    r.h.close();
  });

  it('FR-271 FR-272 FR-273 the rows in the database are the rows written, in file and in memory the same calls, and the winner row has round 0', () => {
    withTempDir((dir) => {
      const file = join(dir, 'm.sqlite');
      const files = rig({ file });
      const memory = rig();
      for (const r of [files, memory]) {
        predict(r, 'p1', { kind: 'victim', round: 1, faction: livingAtN(r)[0] });
        predict(r, 'p1', { kind: 'winner', faction: WINNER });
        step(r, 1, 'phase-1-close');
        predict(r, 'p1', { kind: 'absorber', round: 1, faction: view(r).victim!.candidates[0] });
        for (const kind of ['phase-2-close', 'application'] as const) step(r, 1, kind);
        for (const k of [2, 3, 4]) play(r, k);
      }
      expect(files.log).toStrictEqual(memory.log);
      const calls = resultCalls(files);
      files.h.close();
      memory.h.close();
      const stored = dump(file);
      expect(stored).toHaveLength(3);
      expect(stored).toStrictEqual(
        calls
          .flat()
          .map((x) => ({ round: x.round, kind: x.kind, player_id: x.playerId, choice: x.choice, correct: x.correct ? 1 : 0, points: x.points }))
          .sort((x, y) => x.round - y.round || (x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0)),
      );
      expect(stored.map((x) => (x as { round: number; kind: string }).kind + (x as { round: number }).round)).toStrictEqual(['winner0', 'absorber1', 'victim1']);
    });
  });
});

describe('scoring and halting', () => {
  it('FR-251 (c) a halt at a phase-1 close (the map is gone) writes no result row and keeps the predictions', () => {
    withTempDir((dir) => {
      const folder = writeMapPackage(dir, 'pkg', readFileSync(join(DEV_DIR, 'map.json'), 'utf8'));
      const file = join(dir, 'm.sqlite');
      const r = rig({ file, folders: { dev: folder } });
      predict(r, 'p1', { kind: 'victim', round: 1, faction: livingAtN(r)[0] });
      rmSync(join(folder, 'map.json'));
      const out = r.h.service.advance({ credential: OPERATOR, matchId: r.id, body: { round: 1, step: 'phase-1-close' } });
      expect(out).toStrictEqual({ ok: false, error: errorReply('match-halted') });
      expect(view(r).stage).toBe('halted');
      r.h.close();
      expect(dump(file)).toStrictEqual([]);
      withRawDb(file, (db) => expect(db.prepare('SELECT COUNT(*) AS n FROM predictions').get()!.n).toBe(1));
    });
  });

  it('FR-251 (c) a halt after the reveal keeps the victim rows of that round and writes no absorber or winner row', () => {
    withTempDir((dir) => {
      const folder = writeMapPackage(dir, 'pkg', readFileSync(join(DEV_DIR, 'map.json'), 'utf8'));
      const file = join(dir, 'm.sqlite');
      const r = rig({ file, folders: { dev: folder } });
      predict(r, 'p1', { kind: 'victim', round: 1, faction: livingAtN(r)[0] });
      predict(r, 'p1', { kind: 'winner', faction: WINNER });
      step(r, 1, 'phase-1-close');
      predict(r, 'p1', { kind: 'absorber', round: 1, faction: view(r).victim!.candidates[0] });
      step(r, 1, 'phase-2-close');
      rmSync(join(folder, 'map.json'));
      const out = r.h.service.advance({ credential: OPERATOR, matchId: r.id, body: { round: 1, step: 'application' } });
      expect(out).toStrictEqual({ ok: false, error: errorReply('match-halted') });
      r.h.close();
      expect(dump(file).map((x) => (x as { kind: string }).kind)).toStrictEqual(['victim']);
    });
  });
});

describe('scoring and failures', () => {
  it('FR-241 (scoring) a step whose write fails after the results rolls the rows back with it; the retry scores once', () => {
    withTempDir((dir) => {
      const file = join(dir, 'm.sqlite');
      const r = rig({ file });
      const alive = livingAtN(r);
      alive.forEach((f, i) => predict(r, `p${i + 1}`, { kind: 'victim', round: 1, faction: f }));
      r.fail.putStep = true;
      expect(() => step(r, 1, 'phase-1-close')).toThrow('boom');
      expect(resultCalls(r)).toHaveLength(1);
      expect(view(r).stage).toBe('phase-1');
      r.fail.putStep = false;
      step(r, 1, 'phase-1-close');
      expect(resultCalls(r)).toHaveLength(2);
      expect(resultCalls(r)[1]).toStrictEqual(resultCalls(r)[0]);
      r.h.close();
      // A rolled-back first attempt: the retry's rows were not refused as a second scoring and the table holds each row once.
      expect(dump(file)).toHaveLength(5);
    });
  });
});
