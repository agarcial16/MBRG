import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { errorReply } from '@mbrg/protocol';
import type { StepKind } from '@mbrg/protocol';
import { absorptionCandidatesOf, getState, livingFactions, playRoundWithSeed } from '@mbrg/sim';
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
  readonly seed: number;
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

function rig(options: { file?: string; manual?: boolean; folders?: HarnessOptions['folders']; secret?: Uint8Array } = {}): Rig {
  const rec = recording(openStore(options.file ?? ':memory:'));
  const h = serviceHarness({ store: rec.store, secret: options.secret ?? SECRET, ...(options.folders === undefined ? {} : { folders: options.folders }) });
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

describe('a forced absorber is not predicted and does not score', () => {
  const A5 = SECRETS['all-a5'];
  /** Plays whole rounds `from` to `to` by manual steps. */
  const playRounds = (r: Rig, from: number, to: number): void => {
    for (let k = from; k <= to; k++) play(r, k);
  };

  it('FR-387 a forced round writes no absorber row: the winner is the only row of the last application, the leaderboard has no absorber points', () => {
    const r = rig();
    const winner = GOLD[3]!.absorber;
    predict(r, 'p1', { kind: 'winner', faction: winner });
    playRounds(r, 1, 3);
    step(r, 4, 'phase-1-close');
    expect(view(r).victim!.candidates).toHaveLength(1);
    // The one candidate is refused in phase 2 of the forced round; nothing is stored.
    expect(submit(r, 'p1', { kind: 'absorber', round: 4, faction: view(r).victim!.candidates[0] })).toStrictEqual({ ok: false, error: errorReply('forced-absorber') });
    expect(r.h.store.predictionsOf(r.id, 'web:p1').map((x) => x.kind)).toStrictEqual(['winner']);
    step(r, 4, 'phase-2-close');
    const before = resultCalls(r).length;
    step(r, 4, 'application');
    const calls = resultCalls(r);
    expect(calls).toHaveLength(before + 1);
    expect(calls[calls.length - 1]).toStrictEqual([{ playerId: 'web:p1', kind: 'winner', round: 0, choice: winner, correct: true, points: 5 }]);
    expect(calls.flat().filter((x) => x.kind === 'absorber')).toStrictEqual([]);
    r.h.close();
  });

  it('FR-387 the results event of phase 2 of a forced round is still emitted, with an empty phase-results page', () => {
    const r = rig({ secret: A5 });
    playRounds(r, 1, 2);
    const mark = view(r).lastSeq;
    step(r, 3, 'phase-1-close');
    expect(view(r).victim!.forced).toBe(true);
    predict(r, 'p1', { kind: 'winner', faction: livingAtN(r).find((f) => f !== view(r).victim!.victim) });
    step(r, 3, 'phase-2-close');
    step(r, 3, 'application');
    const tail = r.h.store.eventsAfter(r.id, mark).map((e) => `${e.type}${e.type === 'results' ? `/${(e as { phase: number }).phase}` : ''}`);
    expect(tail).toStrictEqual(['phase-closed', 'victim-revealed', 'results/1', 'schedule', 'phase-closed', 'schedule', 'round-applied', 'results/2', 'schedule']);
    const page = r.h.service.phaseResults(r.id, 3, 2, { limit: 10 });
    expect(page.ok && page.reply.items).toStrictEqual([]);
    r.h.close();
  });

  it('FR-387 a victim prediction in a forced round scores n as before, and a forced round (d = 1) with three factions living is worth 3 to the victim', () => {
    const r = rig({ secret: A5 });
    playRounds(r, 1, 2);
    const alive = livingAtN(r);
    expect(alive).toHaveLength(3);
    alive.forEach((f, i) => predict(r, `p${i + 1}`, { kind: 'victim', round: 3, faction: f }));
    step(r, 3, 'phase-1-close');
    const victim = view(r).victim!.victim;
    const last = resultCalls(r).filter((c) => c.some((x) => x.round === 3));
    expect(last).toHaveLength(1);
    expect(last[0]).toStrictEqual(alive.map((f, i) => row(`web:p${i + 1}`, 'victim', 3, f, victim, 3)));
    r.h.close();
  });

  it('FR-387 rounds with two and three candidates score d as before (all-a5 round 1: d = 2; the first secret round 2: d = 3)', () => {
    for (const [secret, round, d] of [[A5, 1, 2], [SECRET, 2, 3]] as const) {
      const r = rig({ secret });
      if (round === 2) play(r, 1);
      step(r, round, 'phase-1-close');
      const candidates = view(r).victim!.candidates;
      expect(candidates).toHaveLength(d);
      expect('forced' in view(r).victim!).toBe(false);
      candidates.forEach((c, i) => predict(r, `a${i + 1}`, { kind: 'absorber', round, faction: c }));
      step(r, round, 'phase-2-close');
      step(r, round, 'application');
      const rows = resultCalls(r)[resultCalls(r).length - 1]!;
      expect(rows).toHaveLength(d);
      expect(rows.filter((x) => x.correct).map((x) => x.points)).toStrictEqual([d]);
      r.h.close();
    }
  });

  it('FR-387 the dev secrets give a forced last round and a non-forced first round; all-a5 also forces round 3', () => {
    const forcedRounds: Record<string, number[]> = {};
    for (const [name, secret] of Object.entries(SECRETS)) {
      const r = rig({ secret });
      const forced: number[] = [];
      for (let k = 1; k <= 4; k++) {
        step(r, k, 'phase-1-close');
        if (view(r).victim!.forced === true) forced.push(k);
        step(r, k, 'phase-2-close');
        step(r, k, 'application');
      }
      forcedRounds[name] = forced;
      r.h.close();
    }
    expect(forcedRounds).toStrictEqual({ 'ascending-00-1f': [4], 'ascending-20-3f': [4], 'all-a5': [3, 4] });
  });

  it('FR-387 the public data after the reveal show forced, and its bytes are identical for twin matches whose forced-round seeds differ', () => {
    // Twins: the same seeds for rounds 1 to 3, two different seeds for round 4 that pick the same victim.
    const map = devMap();
    let state = must(getState(map, 0, 0));
    for (const g of GOLD.slice(0, 3)) state = must(playRoundWithSeed(map, state, g.seed)).state;
    const wanted = must(playRoundWithSeed(map, state, GOLD[3]!.seed)).record.eliminated;
    let other = GOLD[3]!.seed;
    for (let s = 1; s < 5000; s++) {
      if (s !== GOLD[3]!.seed && must(playRoundWithSeed(map, state, s)).record.eliminated === wanted) {
        other = s;
        break;
      }
    }
    expect(other).not.toBe(GOLD[3]!.seed);
    const outputs = [GOLD[3]!.seed, other].map((last) => {
      const seeds = [...GOLD.slice(0, 3).map((g) => g.seed), last];
      const h = serviceHarness({ seed: 7, testSeedSource: () => (k) => seeds[k - 1]! });
      const created = h.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing: 'manual' }) });
      if (!created.ok) throw new Error('creation failed');
      const id = created.reply.matchId;
      for (let k = 1; k <= 3; k++) for (const kind of ['phase-1-close', 'phase-2-close', 'application'] as const) h.service.advance({ credential: OPERATOR, matchId: id, body: { round: k, step: kind } });
      h.service.advance({ credential: OPERATOR, matchId: id, body: { round: 4, step: 'phase-1-close' } });
      const text = JSON.stringify([h.service.publicMatch(id), h.store.eventsAfter(id, 0)]);
      expect(h.service.publicMatch(id)!.victim!.forced).toBe(true);
      h.close();
      return text;
    });
    expect(outputs[0]).toBe(outputs[1]);
    expect(outputs[0]).toContain('"forced":true');
  });
});
