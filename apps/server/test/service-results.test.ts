import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { decodeCursor, encodeError, errorReply, roundNotApplied } from '@mbrg/protocol';
import type { CursorKey, ErrorReply } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { createMapCatalog } from '../src/service/maps';
import { createMatchService } from '../src/service/matches';
import type { MatchService, PageRequest, ReadOutcome } from '../src/service/matches';
import { openStore } from '../src/store/sqlite';
import { StoreError } from '../src/store/store';
import type { Store } from '../src/store/store';
import { dumpRows, withRawDb } from './helpers/db-scan';
import { DEV_DIR } from './helpers/digests';
import { DISCORD, GOLD, WEB, expectedBoard, expectedRows, openScript, phaseRows, runScript } from './helpers/results-script';
import type { ExpectedRow, ScriptRig } from './helpers/results-script';
import { OPERATOR, serviceHarness, withTempDir, writeMapPackage } from './helpers/service-harness';

// The three results reads through the lifecycle service (spec 008 M4' T3'): the results of a scored phase, a player's results
// and the leaderboard. A scripted dev-map match (helpers/results-script.ts) with seven players in two namespaces; every
// expected value is computed by that helper from the public answers and its own arithmetic, never from the scorer.

const ok = <T>(out: ReadOutcome<T>): T => {
  if (!out.ok) throw new Error(`read refused: ${JSON.stringify(out.error)}`);
  return out.reply;
};
const refused = (out: ReadOutcome<unknown>): ErrorReply => {
  if (out.ok) throw new Error('read accepted');
  return out.error;
};
const play = (done: number, options: Parameters<typeof openScript>[0] = {}): ScriptRig => {
  const r = openScript(options);
  runScript(r, done);
  return r;
};

/** Every page of a paged read with `limit`, following the cursors the service issued. */
function pages<T extends { items: readonly unknown[]; next?: string }, L extends 'phase-results' | 'player-results' | 'leaderboard'>(
  list: L,
  read: (request: PageRequest<L>) => ReadOutcome<T>,
  limit: number,
): T[] {
  const out: T[] = [];
  let after: CursorKey<L> | undefined;
  for (let guard = 0; guard < 200; guard++) {
    const got = ok(read({ limit, ...(after === undefined ? {} : { after }) }));
    out.push(got);
    expect(got.items.length).toBeLessThanOrEqual(limit);
    if (got.next === undefined) return out;
    expect(got.items.length).toBe(limit);
    const decoded = decodeCursor(list, got.next);
    if (!decoded.ok) throw new Error('the service issued a cursor the protocol does not decode');
    after = decoded.value;
  }
  throw new Error('paging did not end');
}

const phaseItem = (x: ExpectedRow) => ({ playerId: x.playerId, choice: x.choice, correct: x.correct, points: x.points });
const phaseOf = (r: ScriptRig, round: number, phase: 1 | 2, request: PageRequest<'phase-results'> = { limit: 500 }) => r.h.service.phaseResults(r.id, round, phase, request);

describe('the results of a scored phase', () => {
  it('FR-275 phase 1 gives the victim and every prediction of the phase ordered by player id, with choice, correct and points', () => {
    const r = play(1);
    expect(r.h.store.getMatch(r.id)!.match.stage).toBe('phase-2');
    const rows = phaseRows(expectedRows(r), 'victim', 1);
    expect(ok(phaseOf(r, 1, 1))).toStrictEqual({ round: 1, phase: 1, victim: GOLD[0]!.victim, items: rows.map(phaseItem) });
    expect(rows.map((x) => x.playerId)).toStrictEqual(['discord:p1', 'web:p1', 'web:p2', 'web:p3', 'web:p4', 'web:p6']);
    // Worth n = 5 for a right pick at round 1; the three right picks are the only non-zero rows.
    expect(rows.filter((x) => x.correct).map((x) => x.points)).toStrictEqual([5, 5, 5]);
    expect(rows.filter((x) => !x.correct).every((x) => x.points === 0)).toBe(true);
    r.h.close();
  });

  it('FR-275 phase 2 carries the record of the round and the absorber predictions, once the round is applied', () => {
    const r = play(3);
    const rows = phaseRows(expectedRows(r), 'absorber', 1);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const g = GOLD[0]!;
    expect(ok(phaseOf(r, 1, 2))).toStrictEqual({
      round: 1,
      phase: 2,
      record: { round: 1, eliminated: g.victim, absorber: g.absorber, transferred: g.transferred },
      items: rows.map(phaseItem),
    });
    // Phase 1 of an applied round names the same victim from the record, and keeps its rows.
    expect(ok(phaseOf(r, 1, 1))).toMatchObject({ round: 1, phase: 1, victim: g.victim });
    expect(ok(phaseOf(r, 1, 1)).items).toHaveLength(6);
    r.h.close();
  });

  it('FR-275 a phase with no prediction is a valid, empty result: the victim of a round nobody predicted and an absorber phase with no row', () => {
    const bare = serviceHarness({ secret: new Uint8Array(32) });
    const made = bare.service.create({ credential: OPERATOR, body: { mapId: 'dev', timing: 'manual', requestId: 'b-1' } });
    if (!made.ok) throw new Error('creation failed');
    for (const step of ['phase-1-close', 'phase-2-close', 'application'] as const) bare.service.advance({ credential: OPERATOR, matchId: made.reply.matchId, body: { round: 1, step } });
    const first = ok(bare.service.phaseResults(made.reply.matchId, 1, 1, { limit: 10 }));
    expect(first).toMatchObject({ round: 1, phase: 1, items: [] });
    expect(first.next).toBeUndefined();
    expect(ok(bare.service.phaseResults(made.reply.matchId, 1, 2, { limit: 10 })).items).toStrictEqual([]);
    bare.close();
  });

  it('FR-279 (c) (results) the phase results page with limits 1, 2 and 500: never a repeat or a skip, next exactly when more follow', () => {
    const r = play(12);
    for (const [round, phase] of [[1, 1], [2, 1], [1, 2], [3, 2]] as const) {
      const kind = phase === 1 ? 'victim' : 'absorber';
      const expected = phaseRows(expectedRows(r), kind, round).map(phaseItem);
      for (const limit of [1, 2, 3, 500]) {
        const got = pages('phase-results', (q) => phaseOf(r, round, phase, q), limit);
        expect(got.flatMap((g) => g.items), `${round}/${phase} limit ${limit}`).toStrictEqual(expected);
        expect(got).toHaveLength(Math.max(1, Math.ceil(expected.length / limit)));
        // The shape of every page is the same (round, phase, victim or record), whatever the page.
        for (const g of got) expect(g).toMatchObject({ round, phase });
        expect(got.slice(0, -1).every((g) => typeof g.next === 'string')).toBe(true);
        expect(got[got.length - 1]!.next).toBeUndefined();
      }
    }
    r.h.close();
  });
});

describe('a phase that is not scored', () => {
  const bytes = (error: ErrorReply): string => encodeError(error);
  const unscored: Record<number, [number, 1 | 2][]> = {
    // done = number of steps performed; the pairs are the (round, phase) that must be unscored at that stage.
    0: [[1, 1], [1, 2], [2, 1], [2, 2], [4, 1], [5, 2], [1000, 1], [2 ** 60, 2]],
    1: [[1, 2], [2, 1], [2, 2], [3, 1], [4, 2], [5, 1], [2 ** 60, 1]],
    2: [[1, 2], [2, 1], [2, 2], [3, 1], [4, 2], [5, 1], [2 ** 60, 1]],
    3: [[2, 1], [2, 2], [3, 1], [3, 2], [4, 1], [5, 2], [2 ** 60, 1]],
    4: [[2, 2], [3, 1], [3, 2], [4, 1], [5, 2], [2 ** 60, 1]],
    5: [[2, 2], [3, 1], [3, 2], [4, 1], [5, 2], [2 ** 60, 1]],
  };
  const applied: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 };

  it('FR-258 (results) FR-270 (unscored hidden) every unscored round and phase gets the same reply bytes, naming only N, in every stage', () => {
    const r = openScript();
    const seen: Record<number, string> = {};
    for (let done = 0; done <= 5; done++) {
      runScript(r, done);
      const stage = r.h.store.getMatch(r.id)!.match.stage;
      expect(stage, `done ${done}`).toBe(['phase-1', 'phase-2', 'locked', 'phase-1', 'phase-2', 'locked'][done]);
      const n = applied[done]!;
      const expected = bytes(roundNotApplied(n));
      for (const [round, phase] of unscored[done]!) expect(bytes(refused(phaseOf(r, round, phase))), `done ${done} (${round}, ${phase})`).toBe(expected);
      expect(expected).toBe(`{"kind":"round-not-applied","appliedRounds":${n}}`);
      seen[done] = expected;
    }
    // The stages of one N give one text; only N differs between the two groups.
    expect(new Set([seen[0], seen[1], seen[2]]).size).toBe(1);
    expect(new Set([seen[3], seen[4], seen[5]]).size).toBe(1);
    expect(seen[0]).not.toBe(seen[3]);
    r.h.close();
  });

  it('FR-258 (results) phase 1 of round N + 1 is unscored until the victim is revealed, and phase 2 of the revealed round is unscored until the application', () => {
    const r = play(3);
    expect(refused(phaseOf(r, 2, 1))).toStrictEqual(roundNotApplied(1));
    runScript(r, 4);
    expect(ok(phaseOf(r, 2, 1))).toMatchObject({ round: 2, phase: 1, victim: GOLD[1]!.victim });
    expect(refused(phaseOf(r, 2, 2))).toStrictEqual(roundNotApplied(1));
    runScript(r, 5);
    expect(refused(phaseOf(r, 2, 2))).toStrictEqual(roundNotApplied(1));
    runScript(r, 6);
    expect(ok(phaseOf(r, 2, 2))).toMatchObject({ round: 2, phase: 2 });
    r.h.close();
  });

  it('FR-258 (results) after the finish every round to T is scored in both phases and a round above T is round-not-applied naming T', () => {
    const r = play(12);
    for (const round of [1, 2, 3, 4]) for (const phase of [1, 2] as const) expect(phaseOf(r, round, phase).ok, `${round}/${phase}`).toBe(true);
    for (const [round, phase] of [[5, 1], [5, 2], [9, 1], [2 ** 60, 2]] as const) expect(refused(phaseOf(r, round, phase))).toStrictEqual(roundNotApplied(4));
    r.h.close();
  });

  it('FR-258 (results) an invalid round or phase is invalid-request, round before phase, and before the match is looked up', () => {
    const r = play(0);
    for (const round of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(refused(phaseOf(r, round, 1)), String(round)).toStrictEqual(errorReply('invalid-request', ['round']));
      expect(refused(r.h.service.phaseResults('m-unknown', round, 1, { limit: 10 })), String(round)).toStrictEqual(errorReply('invalid-request', ['round']));
    }
    for (const phase of [0, 3, -1, 1.5, Number.NaN]) {
      expect(refused(phaseOf(r, 1, phase as never)), String(phase)).toStrictEqual(errorReply('invalid-request', ['phase']));
      expect(refused(r.h.service.phaseResults('m-unknown', 1, phase as never, { limit: 10 }))).toStrictEqual(errorReply('invalid-request', ['phase']));
    }
    expect(refused(phaseOf(r, 0, 3 as never))).toStrictEqual(errorReply('invalid-request', ['round']));
    r.h.close();
  });
});

const playerOf = (r: ScriptRig, playerId: string, request: PageRequest<'player-results'> = { limit: 500 }) => r.h.service.playerResults(r.id, playerId, request);
const playerItem = (x: ExpectedRow) => ({ kind: x.kind, ...(x.kind === 'winner' ? {} : { round: x.round }), choice: x.choice, correct: x.correct, points: x.points });
const orderOf = (rows: ExpectedRow[]): ExpectedRow[] => [...rows].sort((a, b) => a.round - b.round || (a.kind < b.kind ? -1 : 1));

describe('the results of a player', () => {
  it('FR-276 the scored items of a player by round then kind, the winner once the match is finished, and the total of every scored item', () => {
    const r = play(12);
    const mine = orderOf(expectedRows(r).filter((x) => x.playerId === 'web:p1'));
    const reply = ok(playerOf(r, 'web:p1'));
    expect(reply).toStrictEqual({ playerId: 'web:p1', total: mine.reduce((sum, x) => sum + x.points, 0), items: mine.map(playerItem) });
    expect(reply.items[0]).toStrictEqual({ kind: 'winner', choice: mine[0]!.choice, correct: true, points: 5 });
    expect('round' in reply.items[0]!).toBe(false);
    expect(reply.items).toHaveLength(7);
    // Before the finish the winner is not listed and not in the total.
    const early = play(10);
    const earlyRows = orderOf(expectedRows(early).filter((x) => x.playerId === 'web:p1'));
    const got = ok(playerOf(early, 'web:p1'));
    expect(got.items.some((i) => i.kind === 'winner')).toBe(false);
    expect(got).toStrictEqual({ playerId: 'web:p1', total: earlyRows.reduce((sum, x) => sum + x.points, 0), items: earlyRows.map(playerItem) });
    expect(got.total).toBe(reply.total - 5);
    early.h.close();
    r.h.close();
  });

  it('FR-276 a victim of the revealed round is listed from the reveal and its absorber only from the application', () => {
    const r = play(4);
    const items = ok(playerOf(r, 'web:p1')).items;
    expect(items.map((i) => `${i.round}${i.kind}`)).toStrictEqual(['1absorber', '1victim', '2victim']);
    runScript(r, 6);
    expect(ok(playerOf(r, 'web:p1')).items.map((i) => `${i.round}${i.kind}`)).toStrictEqual(['1absorber', '1victim', '2absorber', '2victim']);
    r.h.close();
  });

  it('FR-279 (c) (results) the player results page with limits 1, 2 and 500: no repeat or skip, the same total on every page', () => {
    const r = play(12);
    const mine = orderOf(expectedRows(r).filter((x) => x.playerId === 'web:p1')).map(playerItem);
    const total = ok(playerOf(r, 'web:p1')).total;
    for (const limit of [1, 2, 3, 500]) {
      const got = pages('player-results', (q) => playerOf(r, 'web:p1', q), limit);
      expect(got.flatMap((g) => g.items), `limit ${limit}`).toStrictEqual(mine);
      for (const g of got) expect(g).toMatchObject({ playerId: 'web:p1', total });
      expect(got.slice(0, -1).every((g) => typeof g.next === 'string')).toBe(true);
      expect(got[got.length - 1]!.next).toBeUndefined();
    }
    r.h.close();
  });

  it('FR-270 (unscored hidden) a player with only unscored predictions gets the reply of an unknown well-formed player id', () => {
    const r = play(3);
    const submit = (local: string, body: Record<string, unknown>): void => {
      const out = r.h.service.submit({ client: WEB, matchId: r.id, body: { playerId: local, ...body } });
      if (!out.ok) throw new Error(`refused: ${JSON.stringify(out.error)}`);
    };
    const alive = [...new Set(r.h.store.getMatch(r.id)!.match.state.owners.map(([, f]) => f))].sort((a, b) => a - b);
    // Round 2 is pending (N = 1): its victim and absorber and the winner are all unscored.
    submit('p7', { kind: 'victim', round: 2, faction: alive[0] });
    submit('p7', { kind: 'winner', faction: alive[1] });
    const idle = ok(playerOf(r, 'web:p7'));
    expect(idle).toStrictEqual({ playerId: 'web:p7', total: 0, items: [] });
    const unknown = ok(playerOf(r, 'web:nobody'));
    expect(encodeJson({ ...idle, playerId: 'x' })).toBe(encodeJson({ ...unknown, playerId: 'x' }));
    // The same during phase 2 of round 2 (the victim row of p7 exists then: scored), and an absorber prediction stays hidden.
    runScript(r, 4);
    const revealed = r.h.store.getMatch(r.id)!.match.victim!;
    submit('p8', { kind: 'absorber', round: 2, faction: revealed.candidates[0] });
    submit('p8', { kind: 'winner', faction: alive[2] });
    expect(ok(playerOf(r, 'web:p8'))).toStrictEqual({ playerId: 'web:p8', total: 0, items: [] });
    expect(ok(playerOf(r, 'web:p7')).items).toHaveLength(1);
    // The leaderboard does not list web:p8 (only unscored predictions). web:p7 is listed: its round-2 victim row is scored at the reveal.
    expect(ok(r.h.service.leaderboard(r.id, { limit: 500 })).items.map((i) => i.playerId)).not.toContain('web:p8');
    r.h.close();
  });

  it('FR-276 a malformed player id is invalid-player-id, before the match is looked up; an unknown match is unknown-match', () => {
    const r = play(1);
    for (const bad of ['p1', 'web', 'web:', ':p1', 'web:a:b', 'Web:a', '', 'web:a b']) {
      expect(refused(playerOf(r, bad)), bad).toStrictEqual(errorReply('invalid-player-id', ['playerId']));
      expect(refused(r.h.service.playerResults('m-unknown', bad, { limit: 10 })), bad).toStrictEqual(errorReply('invalid-player-id', ['playerId']));
    }
    expect(refused(r.h.service.playerResults('m-unknown', 'web:p1', { limit: 10 }))).toStrictEqual(errorReply('unknown-match'));
    r.h.close();
  });
});

const encodeJson = (value: unknown): string => JSON.stringify(value);
const boardOf = (r: ScriptRig, request: PageRequest<'leaderboard'> = { limit: 500 }) => r.h.service.leaderboard(r.id, request);

describe('the leaderboard', () => {
  it('FR-277 one row per player with a scored prediction, all-zero players included, ranked with shared ranks, then by player id', () => {
    const r = play(12);
    const board = expectedBoard(expectedRows(r));
    expect(ok(boardOf(r))).toStrictEqual({ items: board });
    // The script has players on 0 points (p2, p6): they are ranked, share the last rank and are listed by id.
    const zeros = board.filter((b) => b.total === 0);
    expect(zeros.map((z) => z.playerId)).toStrictEqual(['web:p2', 'web:p6']);
    expect(new Set(zeros.map((z) => z.rank)).size).toBe(1);
    expect(zeros[0]!.rank).toBe(board.length - 1);
    // Ranks skip after a tie: a rank is 1 + the number of players with a higher total.
    for (const b of board) expect(b.rank).toBe(1 + board.filter((o) => o.total > b.total).length);
    expect(board.map((b) => b.rank)).toStrictEqual([...board.map((b) => b.rank)].sort((a, c) => a - c));
    expect(board.map((b) => b.playerId)).toContain('discord:p1');
    expect(board).toHaveLength(7);
    r.h.close();
  });

  it('FR-277 a rank shared by two players (1, 1, 3): equal totals share the rank and the next rank skips', () => {
    // Round 1 victim picks: p1, p3 and discord:p1 are right (5 each) and the others 0: ranks 1, 1, 1, 4, 4, 4.
    const r = play(1);
    const rows = ok(boardOf(r)).items;
    expect(rows.map((x) => [x.rank, x.playerId, x.total])).toStrictEqual([
      [1, 'discord:p1', 5],
      [1, 'web:p1', 5],
      [1, 'web:p3', 5],
      [4, 'web:p2', 0],
      [4, 'web:p4', 0],
      [4, 'web:p6', 0],
    ]);
    r.h.close();
  });

  it('FR-277 the rank is over the whole match, not over a page: pages of 1, 2, 3 and 500 concatenate to the one ranking', () => {
    const r = play(12);
    const board = expectedBoard(expectedRows(r));
    for (const limit of [1, 2, 3, 500]) {
      const got = pages('leaderboard', (q) => boardOf(r, q), limit);
      expect(got.flatMap((g) => g.items), `limit ${limit}`).toStrictEqual(board);
      expect(got.slice(0, -1).every((g) => typeof g.next === 'string')).toBe(true);
    }
    r.h.close();
  });

  it('FR-277 before anything is scored the leaderboard is empty, and a player with only unscored predictions is not on it', () => {
    const r = play(0);
    expect(ok(boardOf(r))).toStrictEqual({ items: [] });
    runScript(r, 3);
    const players = ok(boardOf(r)).items.map((x) => x.playerId);
    expect(players).toStrictEqual(['discord:p1', 'web:p1', 'web:p2', 'web:p3', 'web:p4', 'web:p6'].sort((a, b) => expectedBoard(expectedRows(r)).findIndex((x) => x.playerId === a) - expectedBoard(expectedRows(r)).findIndex((x) => x.playerId === b)));
    // p5 predicts from round 2 on: not on the board until round 2's victim is revealed.
    expect(players).not.toContain('web:p5');
    runScript(r, 4);
    expect(ok(boardOf(r)).items.map((x) => x.playerId)).toContain('web:p5');
    r.h.close();
  });
});

describe('the leaderboard cursor', () => {
  it('FR-279 (d) (leaderboard) a cursor read after a phase was scored is stale-cursor; a cursor read when nothing was scored since still works', () => {
    const r = play(1);
    const first = ok(boardOf(r, { limit: 2 }));
    expect(typeof first.next).toBe('string');
    const after = (decodeCursor('leaderboard', first.next!) as { ok: true; value: CursorKey<'leaderboard'> }).value;
    // The phase-2 close scores nothing: the generation is unchanged.
    runScript(r, 2);
    expect(ok(boardOf(r, { limit: 2, after })).items).toHaveLength(2);
    // The application scores the absorber phase: the old cursor is stale.
    runScript(r, 3);
    expect(refused(boardOf(r, { limit: 2, after }))).toStrictEqual(errorReply('stale-cursor'));
    // A fresh first page works and its cursor works until the next scored phase (the reveal of round 2).
    const fresh = ok(boardOf(r, { limit: 2 }));
    const afterFresh = (decodeCursor('leaderboard', fresh.next!) as { ok: true; value: CursorKey<'leaderboard'> }).value;
    expect(ok(boardOf(r, { limit: 2, after: afterFresh })).items.length).toBeGreaterThan(0);
    runScript(r, 4);
    expect(refused(boardOf(r, { limit: 2, after: afterFresh }))).toStrictEqual(errorReply('stale-cursor'));
    r.h.close();
  });

  it('FR-279 (d) (leaderboard) a cursor of a future generation, or of an earlier one, is stale-cursor, never a page', () => {
    const r = play(3);
    const generation = 2;
    const key = (g: number): CursorKey<'leaderboard'> => [g, 1, 'web:p1'];
    expect(ok(boardOf(r, { limit: 5, after: key(generation) })).items.length).toBeGreaterThan(0);
    for (const g of [0, 1, 3, 4, 100, Number.MAX_SAFE_INTEGER]) expect(refused(boardOf(r, { limit: 5, after: key(g) })), `generation ${g}`).toStrictEqual(errorReply('stale-cursor'));
    r.h.close();
  });

  it('FR-279 (d) (leaderboard) the generation is 2N, plus 1 while the victim of round N + 1 is revealed, and 2T when finished', () => {
    const r = openScript();
    const expectedGeneration = [0, 1, 1, 2, 3, 3, 4, 5, 5, 6, 7, 7, 8];
    for (let done = 0; done <= 12; done++) {
      runScript(r, done);
      const issued = ok(boardOf(r, { limit: 1 }));
      if (issued.next === undefined) continue;
      const decoded = decodeCursor('leaderboard', issued.next);
      expect(decoded.ok && decoded.value[0], `done ${done}`).toBe(expectedGeneration[done]);
    }
    r.h.close();
  });

  it('FR-279 (d) (leaderboard) a cursor of the current generation still works after a restart (a new service on the same file)', () => {
    withTempDir((dir) => {
      const file = join(dir, 'board.sqlite');
      const r = play(4, { store: openStore(file) });
      const issued = ok(boardOf(r, { limit: 2 })).next!;
      const expectedPages = pages('leaderboard', (q) => boardOf(r, q), 2).flatMap((g) => g.items);
      r.h.close();
      const h = serviceHarness({ store: openStore(file) });
      h.service.start();
      const decoded = decodeCursor('leaderboard', issued);
      if (!decoded.ok) throw new Error('bad cursor');
      const rest = ok(h.service.leaderboard(r.id, { limit: 500, after: decoded.value }));
      expect(rest.items).toStrictEqual(expectedPages.slice(2));
      h.close();
    });
  });
});

describe('player ids as stored', () => {
  it('FR-278 the ids are returned exactly as stored: web:a and discord:a are two rows, web:B sorts before web:a, nothing is derived from an id', () => {
    const r = openScript();
    const alive = [...new Set(r.h.store.getMatch(r.id)!.match.state.owners.map(([, f]) => f))].sort((a, b) => a - b);
    const victim = GOLD[0]!.victim;
    const wrong = alive.find((f) => f !== victim)!;
    const put = (client: typeof WEB, local: string, faction: number): void => {
      const out = r.h.service.submit({ client, matchId: r.id, body: { playerId: local, kind: 'victim', round: 1, faction } });
      if (!out.ok) throw new Error(`refused: ${JSON.stringify(out.error)}`);
    };
    put(WEB, 'a', victim);
    put(DISCORD, 'a', wrong);
    put(WEB, 'B', victim);
    put(WEB, 'x.y-z_9', wrong);
    // Close phase 1 directly (no other predictions).
    const out = r.h.service.advance({ credential: OPERATOR, matchId: r.id, body: { round: 1, step: 'phase-1-close' } });
    expect(out.ok).toBe(true);
    const items = ok(phaseOf(r, 1, 1)).items;
    expect(items.map((i) => i.playerId)).toStrictEqual(['discord:a', 'web:B', 'web:a', 'web:x.y-z_9']);
    expect(items.map((i) => i.points)).toStrictEqual([0, 5, 5, 0]);
    const board = ok(boardOf(r)).items;
    expect(board.map((b) => [b.rank, b.playerId, b.total])).toStrictEqual([
      [1, 'web:B', 5],
      [1, 'web:a', 5],
      [3, 'discord:a', 0],
      [3, 'web:x.y-z_9', 0],
    ]);
    // Each id reads only its own rows; the reply carries the id as given and the three wire members, nothing else.
    expect(ok(playerOf(r, 'web:a'))).toStrictEqual({ playerId: 'web:a', total: 5, items: [{ kind: 'victim', round: 1, choice: victim, correct: true, points: 5 }] });
    expect(ok(playerOf(r, 'discord:a'))).toStrictEqual({ playerId: 'discord:a', total: 0, items: [{ kind: 'victim', round: 1, choice: wrong, correct: false, points: 0 }] });
    for (const row of board) expect(Object.keys(row)).toStrictEqual(['rank', 'playerId', 'total', 'correctVictims', 'correctAbsorbers', 'correctWinner']);
    // The same local id under another namespace is not found as the first one.
    expect(ok(playerOf(r, 'bot:a'))).toStrictEqual({ playerId: 'bot:a', total: 0, items: [] });
    r.h.close();
  });
});

describe('a halted match', () => {
  it('FR-251 (d) (f) (results of a halted match) a halted match serves the scored results and the leaderboard as they were; the unscored stay unscored', () => {
    withTempDir((dir) => {
      const folder = writeMapPackage(dir, 'pkg', readFileSync(join(DEV_DIR, 'map.json'), 'utf8'));
      const r = play(4, { folders: { dev: folder } });
      const snapshot = (): unknown => ({
        board: pages('leaderboard', (q) => boardOf(r, q), 2).flatMap((g) => g.items),
        p11: ok(phaseOf(r, 1, 1)),
        p12: ok(phaseOf(r, 1, 2)),
        p21: ok(phaseOf(r, 2, 1)),
        p22: refused(phaseOf(r, 2, 2)),
        p1: ok(playerOf(r, 'web:p1')),
      });
      const before = snapshot();
      rmSync(join(folder, 'map.json'));
      const out = r.h.service.advance({ credential: OPERATOR, matchId: r.id, body: { round: 2, step: 'phase-2-close' } });
      expect(out).toStrictEqual({ ok: false, error: errorReply('match-halted') });
      expect(r.h.store.getMatch(r.id)!.match.stage).toBe('halted');
      expect(snapshot()).toStrictEqual(before);
      expect(before).toMatchObject({ p22: roundNotApplied(1) });
      r.h.close();
    });
  });
});

describe('the reads of the service', () => {
  it('FR-281 (e) to (g) (service) an unknown match is unknown-match for each of the three reads', () => {
    const r = play(0);
    expect(refused(r.h.service.phaseResults('m-unknown', 1, 1, { limit: 10 }))).toStrictEqual(errorReply('unknown-match'));
    expect(refused(r.h.service.playerResults('m-unknown', 'web:p1', { limit: 10 }))).toStrictEqual(errorReply('unknown-match'));
    expect(refused(r.h.service.leaderboard('m-unknown', { limit: 10 }))).toStrictEqual(errorReply('unknown-match'));
    expect(refused(r.h.service.leaderboard(42 as never, { limit: 10 }))).toStrictEqual(errorReply('unknown-match'));
    r.h.close();
  });

  it('FR-281 (e) to (g) (service) a page size outside 1 to 500 is a programming error of the caller', () => {
    const r = play(0);
    for (const limit of [0, 501, 1.5]) {
      expect(() => r.h.service.phaseResults(r.id, 1, 1, { limit })).toThrow(RangeError);
      expect(() => r.h.service.playerResults(r.id, 'web:p1', { limit })).toThrow(RangeError);
      expect(() => r.h.service.leaderboard(r.id, { limit })).toThrow(RangeError);
    }
    r.h.close();
  });

  it('FR-292 (reads) a storage failure of a results read is unavailable, and a programming error is not hidden', () => {
    const r = play(4);
    const through = (patch: Partial<Store>): MatchService => createMatchService({ store: { ...r.h.store, ...patch } as Store, clock: r.h.clock, maps: createMapCatalog(r.h.settings.maps), settings: r.h.settings });
    const fail = (error: () => Error) => (): never => {
      throw error();
    };
    const storage = (): StoreError => new StoreError('store-failure', 'injected read failure');
    const unavailable = errorReply('unavailable');
    for (const patch of [{ getMatch: fail(storage) }, { phaseResultsAfter: fail(storage) }]) {
      expect(refused(through(patch).phaseResults(r.id, 1, 1, { limit: 10 }))).toStrictEqual(unavailable);
    }
    for (const patch of [{ getMatch: fail(storage) }, { playerResultsAfter: fail(storage) }, { playerTotal: fail(storage) }]) {
      expect(refused(through(patch).playerResults(r.id, 'web:p1', { limit: 10 }))).toStrictEqual(unavailable);
    }
    for (const patch of [{ getMatch: fail(storage) }, { leaderboardTotals: fail(storage) }]) {
      expect(refused(through(patch).leaderboard(r.id, { limit: 10 }))).toStrictEqual(unavailable);
    }
    const broken = through({ leaderboardTotals: fail(() => new RangeError('inconsistent stored data')) });
    expect(() => broken.leaderboard(r.id, { limit: 10 })).toThrow(RangeError);
    r.h.close();
  });

  it('FR-281 (e) to (g) (service) the reads write nothing: the raw rows are unchanged', () => {
    withTempDir((dir) => {
      const file = join(dir, 'reads.sqlite');
      const r = play(7, { store: openStore(file) });
      r.h.close();
      const before = withRawDb(file, dumpRows);
      const h = serviceHarness({ store: openStore(file) });
      const id = r.id;
      for (let round = 0; round <= 6; round++) for (const phase of [1, 2] as const) h.service.phaseResults(id, round, phase, { limit: 1 });
      for (const player of ['web:p1', 'discord:p1', 'web:nobody']) h.service.playerResults(id, player, { limit: 2 });
      h.service.leaderboard(id, { limit: 2 });
      h.service.leaderboard(id, { limit: 2, after: [999, 1, 'web:p1'] });
      h.close();
      expect(withRawDb(file, dumpRows)).toBe(before);
    });
  });
});

