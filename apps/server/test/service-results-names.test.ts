import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeCursor, encodeLeaderboardRow, encodePage, encodePhaseResults, encodePlayerResults, errorReply, roundNotApplied } from '@mbrg/protocol';
import type { CursorKey, ErrorReply } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import type { PageRequest, ReadOutcome } from '../src/service/matches';
import { openStore } from '../src/store/sqlite';
import { dumpRows, withRawDb } from './helpers/db-scan';
import { openNamedScript, runNamed } from './helpers/names-script';
import type { NamedRig } from './helpers/names-script';
import { GOLD, expectedBoard, expectedRows, openScript, phaseRows, runScript } from './helpers/results-script';
import { serviceHarness, withTempDir } from './helpers/service-harness';

// The three results reads with the names of web players (spec 011 M5): the name is an added member next to the player id for a
// player who joined by name and is absent for every other id. The expected values come from the script's own arithmetic
// (helpers/results-script.ts, helpers/names-script.ts), never from the scorer; the order, ranks, totals and cursors are proved
// unchanged by reading the same finished match with its `players` rows deleted.

const ok = <T>(out: ReadOutcome<T>): T => {
  if (!out.ok) throw new Error(`read refused: ${JSON.stringify(out.error)}`);
  return out.reply;
};
const refused = (out: ReadOutcome<unknown>): ErrorReply => {
  if (out.ok) throw new Error('read accepted');
  return out.error;
};

type ListName = 'phase-results' | 'player-results' | 'leaderboard';
function pages<T extends { items: readonly unknown[]; next?: string }, L extends ListName>(list: L, read: (request: PageRequest<L>) => ReadOutcome<T>, limit: number): T[] {
  const out: T[] = [];
  let after: CursorKey<L> | undefined;
  for (let guard = 0; guard < 200; guard++) {
    const got = ok(read({ limit, ...(after === undefined ? {} : { after }) }));
    out.push(got);
    if (got.next === undefined) return out;
    const decoded = decodeCursor(list, got.next);
    if (!decoded.ok) throw new Error('the service issued a cursor the protocol does not decode');
    after = decoded.value;
  }
  throw new Error('paging did not end');
}

const finished = (options: Parameters<typeof openNamedScript>[0] = {}): NamedRig => {
  const n = openNamedScript(options);
  runNamed(n, 12);
  return n;
};
const withName = <T extends { playerId: string }>(x: T, names: ReadonlyMap<string, string>): T | (T & { name: string }) => (names.has(x.playerId) ? { ...x, name: names.get(x.playerId)! } : x);
const phaseItem = (x: { playerId: string; choice: number; correct: boolean; points: number }) => ({ playerId: x.playerId, choice: x.choice, correct: x.correct, points: x.points });
const phaseOf = (n: NamedRig, round: number, phase: 1 | 2, request: PageRequest<'phase-results'> = { limit: 500 }) => n.rig.h.service.phaseResults(n.rig.id, round, phase, request);
const boardOf = (n: NamedRig, request: PageRequest<'leaderboard'> = { limit: 500 }) => n.rig.h.service.leaderboard(n.rig.id, request);

describe('the results reads carry the name of web players', () => {
  it('FR-383 the phase results name the web players and no other id, in the order of the player ids', () => {
    const n = finished();
    const rows = phaseRows(expectedRows(n.rig), 'victim', 1);
    expect(rows.map((x) => x.playerId)).toStrictEqual(expect.arrayContaining([n.ana.playerId, n.bea.playerId, n.jose.playerId, 'web:p1', 'discord:p1']));
    const expected = rows.map((x) => withName(phaseItem(x), n.names));
    expect(ok(phaseOf(n, 1, 1))).toStrictEqual({ round: 1, phase: 1, victim: GOLD[0]!.victim, items: expected });
    // Names as stored: trimmed, NFC, the case the player gave.
    expect(expected.filter((x) => 'name' in x).map((x) => (x as { name: string }).name).sort()).toStrictEqual(['Ana', 'Bea', 'José']);
    expect(ok(phaseOf(n, 1, 1)).items.filter((x) => !('name' in x)).map((x) => x.playerId)).toStrictEqual(['discord:p1', 'web:p1', 'web:p2', 'web:p3', 'web:p4', 'web:p6']);
    // The absorber phase of round 1: only Ana and Bea predicted it.
    const absorbers = phaseRows(expectedRows(n.rig), 'absorber', 1).map((x) => withName(phaseItem(x), n.names));
    expect(ok(phaseOf(n, 1, 2)).items).toStrictEqual(absorbers);
    expect(absorbers.filter((x) => 'name' in x)).toHaveLength(2);
    // A phase nobody named predicted has no name member at all.
    expect(ok(phaseOf(n, 2, 1)).items.some((x) => 'name' in x)).toBe(false);
    n.rig.h.close();
  });

  it('FR-383 a player page carries the name for a web player (also with no result) and none for a client id or an id that never joined', () => {
    const n = finished();
    const mine = expectedRows(n.rig)
      .filter((x) => x.playerId === n.ana.playerId)
      .sort((a, b) => a.round - b.round || (a.kind < b.kind ? -1 : 1));
    expect(mine.map((x) => `${x.round}${x.kind}`)).toStrictEqual(['0winner', '1absorber', '1victim']);
    const total = mine.reduce((sum, x) => sum + x.points, 0);
    const items = mine.map((x) => ({ kind: x.kind, ...(x.kind === 'winner' ? {} : { round: x.round }), choice: x.choice, correct: x.correct, points: x.points }));
    expect(ok(n.rig.h.service.playerResults(n.rig.id, n.ana.playerId, { limit: 500 }))).toStrictEqual({ playerId: n.ana.playerId, total, items, name: 'Ana' });
    // Joined but never predicted: an empty page that still names the player.
    expect(ok(n.rig.h.service.playerResults(n.rig.id, n.zed.playerId, { limit: 500 }))).toStrictEqual({ playerId: n.zed.playerId, total: 0, items: [], name: 'Zed' });
    // Client credentials have no name; an id that looks joined but never was has none either.
    const web = ok(n.rig.h.service.playerResults(n.rig.id, 'web:p1', { limit: 500 }));
    expect(Object.keys(web)).toStrictEqual(['playerId', 'total', 'items']);
    expect(ok(n.rig.h.service.playerResults(n.rig.id, 'player:Ghost0000000', { limit: 500 }))).toStrictEqual({ playerId: 'player:Ghost0000000', total: 0, items: [] });
    // The name is on every page of a paged read.
    for (const page of pages('player-results', (q) => n.rig.h.service.playerResults(n.rig.id, n.ana.playerId, q), 1)) expect(page.name).toBe('Ana');
    n.rig.h.close();
  });

  it('FR-383 the leaderboard names the web players, ranks them with the others and leaves Zed (no result) off', () => {
    const n = finished();
    const board = expectedBoard(expectedRows(n.rig));
    const expected = board.map((x) => withName(x, n.names));
    expect(ok(boardOf(n)).items).toStrictEqual(expected);
    expect(board.some((x) => x.playerId === n.zed.playerId)).toBe(false);
    expect(expected.filter((x) => 'name' in x)).toHaveLength(3);
    expect(ok(boardOf(n)).items.filter((x) => !('name' in x)).length).toBe(board.length - 3);
    for (const limit of [1, 2, 3, 500]) expect(pages('leaderboard', (q) => boardOf(n, q), limit).flatMap((p) => p.items), `limit ${limit}`).toStrictEqual(expected);
    n.rig.h.close();
  });

  it('FR-383 on the wire the name is the last member of an item, of a player page and of a row', () => {
    const n = finished();
    const first = ok(phaseOf(n, 1, 1));
    const text = encodePhaseResults(first);
    const ana = first.items.find((x) => x.playerId === n.ana.playerId)!;
    expect(text).toContain(`{"playerId":"${n.ana.playerId}","choice":${ana.choice},"correct":true,"points":5,"name":"Ana"}`);
    expect(text).toContain('{"playerId":"web:p1","choice":');
    expect(text).not.toMatch(/"web:p1"[^}]*"name"/);
    expect(encodePlayerResults(ok(n.rig.h.service.playerResults(n.rig.id, n.zed.playerId, { limit: 500 })))).toBe(`{"playerId":"${n.zed.playerId}","total":0,"items":[],"name":"Zed"}`);
    const row = ok(boardOf(n)).items.find((x) => x.playerId === n.jose.playerId)!;
    expect(encodeLeaderboardRow(row).endsWith(',"name":"José"}')).toBe(true);
    expect(encodePage({ items: ok(boardOf(n)).items }, encodeLeaderboardRow)).toContain('"name":"Ana"');
    n.rig.h.close();
  });

  it('FR-383 a name differing only by case is refused at the join, so no two rows of a match differ only in the case of their names', () => {
    const n = openNamedScript();
    const again = n.rig.h.service.join({ source: 'src-x', matchId: n.rig.id, body: { name: 'ANA', requestId: 'j-x' } });
    expect(again).toStrictEqual({ ok: false, error: errorReply('name-taken') });
    n.rig.h.close();
  });
});

describe('names change nothing but the added member', () => {
  it('FR-383 every read of the finished match equals the read of the same match with its players rows deleted, once the names are removed', () => {
    withTempDir((dir) => {
      const file = join(dir, 'named.sqlite');
      const n = finished({ store: openStore(file) });
      const id = n.rig.id;
      const named = {
        phase: (round: number, phase: 1 | 2, q: PageRequest<'phase-results'>) => n.rig.h.service.phaseResults(id, round, phase, q),
        player: (player: string, q: PageRequest<'player-results'>) => n.rig.h.service.playerResults(id, player, q),
        board: (q: PageRequest<'leaderboard'>) => n.rig.h.service.leaderboard(id, q),
      };
      const players = [n.ana.playerId, n.bea.playerId, n.jose.playerId, n.zed.playerId, 'web:p1', 'discord:p1', 'web:nobody'];
      const namedReads = {
        phases: [1, 2, 3, 4].flatMap((round) => ([1, 2] as const).flatMap((phase) => [1, 2, 500].map((limit) => pages('phase-results', (q) => named.phase(round, phase, q), limit)))),
        player: players.flatMap((p) => [1, 3, 500].map((limit) => pages('player-results', (q) => named.player(p, q), limit))),
        board: [1, 2, 3, 500].map((limit) => pages('leaderboard', (q) => named.board(q), limit)),
      };
      n.rig.h.close();
      const twin = join(dir, 'nameless.sqlite');
      copyFileSync(file, twin);
      withRawDb(twin, (db) => db.exec('DELETE FROM players'));
      const plain = serviceHarness({ store: openStore(twin) });
      const plainReads = {
        phases: [1, 2, 3, 4].flatMap((round) => ([1, 2] as const).flatMap((phase) => [1, 2, 500].map((limit) => pages('phase-results', (q) => plain.service.phaseResults(id, round, phase, q), limit)))),
        player: players.flatMap((p) => [1, 3, 500].map((limit) => pages('player-results', (q) => plain.service.playerResults(id, p, q), limit))),
        board: [1, 2, 3, 500].map((limit) => pages('leaderboard', (q) => plain.service.leaderboard(id, q), limit)),
      };
      plain.close();
      const strip = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x: unknown) => (k === 'name' ? undefined : x)));
      expect(strip(namedReads)).toStrictEqual(strip(plainReads));
      // The nameless twin has no name anywhere; the named reads have some (so the comparison is not vacuous), and the cursors are the same texts.
      expect(JSON.stringify(plainReads)).not.toContain('"name"');
      expect(JSON.stringify(namedReads)).toContain('"name":"Ana"');
      expect(JSON.stringify(namedReads.board.map((b) => b.map((p) => p.next)))).toBe(JSON.stringify(plainReads.board.map((b) => b.map((p) => p.next))));
    });
  });

  it('FR-383 an unscored phase gives the same error as a match without names, naming only N, in the stages around a reveal', () => {
    for (const done of [0, 1, 2, 3, 4]) {
      const n = openNamedScript();
      const plain = openScript();
      runNamed(n, done);
      runScript(plain, done);
      const applied = n.rig.h.store.getMatch(n.rig.id)!.match.appliedRounds;
      for (const [round, phase] of [[1, 1], [1, 2], [2, 1], [2, 2], [3, 1], [7, 2]] as const) {
        const a = phaseOf(n, round, phase);
        const b = plain.h.service.phaseResults(plain.id, round, phase, { limit: 500 });
        expect(a.ok, `${done} ${round}/${phase}`).toBe(b.ok);
        if (!a.ok) {
          expect(a.error).toStrictEqual(b.ok ? undefined : b.error);
          expect(a.error).toStrictEqual(roundNotApplied(applied));
        }
      }
      n.rig.h.close();
      plain.h.close();
    }
  });

  it('FR-383 a join does not change the leaderboard generation: a cursor survives it and is stale only after a phase is scored', () => {
    const n = openNamedScript();
    runNamed(n, 1);
    const first = ok(boardOf(n, { limit: 1 }));
    expect(typeof first.next).toBe('string');
    const after = (decodeCursor('leaderboard', first.next!) as { ok: true; value: CursorKey<'leaderboard'> }).value;
    const late = n.rig.h.service.join({ source: 'src-late', matchId: n.rig.id, body: { name: 'Late', requestId: 'j-late' } });
    expect(late.ok).toBe(true);
    expect(ok(boardOf(n, { limit: 1, after })).items.length).toBe(1);
    expect(ok(boardOf(n, { limit: 1 })).next).toBe(first.next);
    runNamed(n, 3);
    expect(refused(boardOf(n, { limit: 1, after }))).toStrictEqual(errorReply('stale-cursor'));
    n.rig.h.close();
  });

  it('FR-383 the reads write nothing: the raw rows are unchanged after every read', () => {
    withTempDir((dir) => {
      const file = join(dir, 'reads.sqlite');
      const n = finished({ store: openStore(file) });
      n.rig.h.close();
      const before = withRawDb(file, dumpRows);
      const h = serviceHarness({ store: openStore(file) });
      for (let round = 1; round <= 5; round++) for (const phase of [1, 2] as const) h.service.phaseResults(n.rig.id, round, phase, { limit: 1 });
      for (const p of [n.ana.playerId, n.zed.playerId, 'web:p1', 'player:Ghost0000000']) h.service.playerResults(n.rig.id, p, { limit: 2 });
      h.service.leaderboard(n.rig.id, { limit: 2 });
      h.close();
      expect(withRawDb(file, dumpRows)).toBe(before);
    });
  });
});
