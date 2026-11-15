import { decodeCursor, encodeError, encodePhaseWinners, errorReply, roundNotApplied } from '@mbrg/protocol';
import type { CursorKey, PhaseWinnersPage } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import type { PageRequest, ReadOutcome } from '../src/service/matches';
import { dumpRows, withRawDb } from './helpers/db-scan';
import { openNamedScript, runNamed } from './helpers/names-script';
import type { NamedRig } from './helpers/names-script';
import { expectedRows, phaseRows } from './helpers/results-script';
import { openStore } from '../src/store/sqlite';
import { serviceHarness, withTempDir } from './helpers/service-harness';
import { join } from 'node:path';

// The "who guessed right" read at service level (spec 011 M5 T4): the NAMED players whose prediction of a scored phase was right,
// by player id, paged. Expected values come from the script's own arithmetic (helpers/results-script.ts, names-script.ts).

const ok = <T>(out: ReadOutcome<T>): T => {
  if (!out.ok) throw new Error(`read refused: ${JSON.stringify(out.error)}`);
  return out.reply;
};
const winnersOf = (n: NamedRig, round: number, phase: 1 | 2, request: PageRequest<'phase-winners'> = { limit: 500 }) => n.rig.h.service.phaseWinners(n.rig.id, round, phase, request);

function pages(read: (request: PageRequest<'phase-winners'>) => ReadOutcome<PhaseWinnersPage>, limit: number): PhaseWinnersPage[] {
  const out: PhaseWinnersPage[] = [];
  let after: CursorKey<'phase-winners'> | undefined;
  for (let guard = 0; guard < 200; guard++) {
    const got = ok(read({ limit, ...(after === undefined ? {} : { after }) }));
    out.push(got);
    if (got.next === undefined) return out;
    const decoded = decodeCursor('phase-winners', got.next);
    if (!decoded.ok) throw new Error('the service issued a cursor the protocol does not decode');
    after = decoded.value;
  }
  throw new Error('paging did not end');
}

/** The expected winners of a phase: the correct rows of NAMED players (joined by name), ordered by player id. */
const expectedWinners = (n: NamedRig, kind: 'victim' | 'absorber', round: number) =>
  phaseRows(expectedRows(n.rig), kind, round)
    .filter((x) => x.correct && n.names.has(x.playerId))
    .map((x) => ({ playerId: x.playerId, name: n.names.get(x.playerId)! }));

const finished = (): NamedRig => {
  const n = openNamedScript();
  runNamed(n, 12);
  return n;
};

describe('the who-guessed-right read: scored phases', () => {
  it('FR-386 a scored phase lists the named players who guessed right, by player id, and no client-credential player', () => {
    const n = finished();
    const victims = expectedWinners(n, 'victim', 1);
    // Ana and Jose were right; Bea was wrong; web:p1 / discord:p1 were right but have no name (Q12).
    expect(victims.map((x) => x.name).sort()).toStrictEqual(['Ana', 'José']);
    expect(phaseRows(expectedRows(n.rig), 'victim', 1).filter((x) => x.correct).length).toBeGreaterThan(2);
    expect(ok(winnersOf(n, 1, 1))).toStrictEqual({ round: 1, phase: 1, items: victims });
    const absorbers = expectedWinners(n, 'absorber', 1);
    expect(absorbers.map((x) => x.name)).toStrictEqual(['Ana']);
    expect(ok(winnersOf(n, 1, 2))).toStrictEqual({ round: 1, phase: 2, items: absorbers });
    // Phases nobody named predicted, and the id order of the items is the code unit order of the ids.
    for (const [round, phase] of [[2, 1], [2, 2], [3, 1], [4, 1], [4, 2]] as const) expect(ok(winnersOf(n, round, phase)).items).toStrictEqual([]);
    const ids = ok(winnersOf(n, 1, 1)).items.map((x) => x.playerId);
    expect(ids).toStrictEqual([...ids].sort());
    n.rig.h.close();
  });

  it('FR-386 paging by 1, 2 and 500 repeats and skips nobody and the last page has no cursor', () => {
    const n = finished();
    const expected = expectedWinners(n, 'victim', 1);
    for (const limit of [1, 2, 500]) {
      const got = pages((q) => winnersOf(n, 1, 1, q), limit);
      expect(got.flatMap((p) => p.items), `limit ${limit}`).toStrictEqual(expected);
      expect(got.length).toBe(Math.ceil(expected.length / limit));
      for (const p of got.slice(0, -1)) expect(p.next).toBeDefined();
      expect(got[got.length - 1]!.next).toBeUndefined();
      for (const p of got) expect([p.round, p.phase]).toStrictEqual([1, 1]);
    }
    // The cursor text is the one the protocol decodes to the last player id of the page.
    const first = ok(winnersOf(n, 1, 1, { limit: 1 }));
    expect(decodeCursor('phase-winners', first.next!)).toStrictEqual({ ok: true, value: [first.items[0]!.playerId] });
    n.rig.h.close();
  });

  it('FR-386 the reply holds only the round, the phase, the ids, the names and the cursor: no wrong guess, choice, points, victim, record or count', () => {
    const n = finished();
    for (const [round, phase] of [[1, 1], [1, 2], [2, 1], [3, 2]] as const) {
      const page = ok(winnersOf(n, round, phase, { limit: 1 }));
      expect(Object.keys(page).every((k) => ['round', 'phase', 'items', 'next'].includes(k))).toBe(true);
      for (const item of page.items) expect(Object.keys(item)).toStrictEqual(['playerId', 'name']);
      const text = encodePhaseWinners(page);
      for (const word of ['choice', 'points', 'correct', 'victim', 'record', 'total', 'count', 'wrong', 'absorber', 'rank']) expect(text, word).not.toContain(`"${word}"`);
    }
    // Bea guessed wrong in round 1: nothing of her appears in the victim or absorber winners, whatever the page size.
    for (const [round, phase] of [[1, 1], [1, 2]] as const) {
      const text = JSON.stringify(pages((q) => winnersOf(n, round, phase, q), 1));
      expect(text).not.toContain(n.bea.playerId);
      expect(text).not.toContain('Bea');
    }
    // Two winners, one wrong named player: the page carries 2 items, the same as without Bea's row.
    expect(ok(winnersOf(n, 1, 1)).items).toHaveLength(2);
    n.rig.h.close();
  });

  it('FR-386 a player who joined after the phase closed is never listed, and a joined player with no prediction is not listed', () => {
    const n = openNamedScript();
    runNamed(n, 4);
    const before = ok(winnersOf(n, 1, 1));
    const late = n.rig.h.service.join({ source: 'src-late', matchId: n.rig.id, body: { name: 'Late', requestId: 'j-late' } });
    expect(late.ok).toBe(true);
    runNamed(n, 12);
    const after = ok(winnersOf(n, 1, 1));
    expect(after).toStrictEqual(before);
    for (const [round, phase] of [[1, 1], [1, 2], [2, 1], [2, 2], [3, 1], [3, 2], [4, 1], [4, 2]] as const) {
      const text = JSON.stringify(ok(winnersOf(n, round, phase)));
      expect(text).not.toContain('Late');
      expect(text).not.toContain('Zed');
    }
    n.rig.h.close();
  });

  it('FR-386 the phase 2 of a forced round (one candidate) lists nobody, though a named player is right in the other phases', () => {
    const n = finished();
    const forced = Object.entries(n.rig.candidates).filter(([, c]) => c.length === 1).map(([k]) => Number(k));
    expect(forced.length).toBeGreaterThan(0);
    for (const round of forced) {
      expect(ok(winnersOf(n, round, 2))).toStrictEqual({ round, phase: 2, items: [] });
      expect(phaseRows(expectedRows(n.rig), 'absorber', round)).toStrictEqual([]);
    }
    n.rig.h.close();
  });

  it('FR-386 reads write nothing and a match with no named player answers empty pages', () => {
    withTempDir((dir) => {
      const file = join(dir, 'winners.sqlite');
      const n = (() => {
        const rig = openNamedScript({ store: openStore(file) });
        runNamed(rig, 12);
        return rig;
      })();
      n.rig.h.close();
      const before = withRawDb(file, dumpRows);
      const h = serviceHarness({ store: openStore(file) });
      for (let round = 1; round <= 6; round++) for (const phase of [1, 2] as const) h.service.phaseWinners(n.rig.id, round, phase, { limit: 1 });
      h.close();
      expect(withRawDb(file, dumpRows)).toBe(before);
      // The same file with the players rows gone: every scored phase lists nobody.
      withRawDb(file, (db) => db.exec('DELETE FROM players'));
      const plain = serviceHarness({ store: openStore(file) });
      for (let round = 1; round <= 4; round++) for (const phase of [1, 2] as const) expect(ok(plain.service.phaseWinners(n.rig.id, round, phase, { limit: 500 }))).toStrictEqual({ round, phase, items: [] });
      plain.close();
    });
  });
});

describe('the who-guessed-right read: unscored phases and shapes', () => {
  const scored = (done: number, round: number, phase: 1 | 2): boolean => {
    const applied = Math.floor(done / 3);
    if (round <= applied) return true;
    return phase === 1 && round === applied + 1 && done % 3 !== 0;
  };

  it('FR-386 P12 an unscored phase of any stage answers round-not-applied naming only N, with the same bytes as the phase results', () => {
    const bytes = new Map<number, string>();
    for (let done = 0; done <= 12; done++) {
      const n = openNamedScript();
      runNamed(n, done);
      const applied = Math.floor(done / 3);
      for (const [round, phase] of [[1, 1], [1, 2], [2, 1], [2, 2], [3, 1], [4, 2], [5, 1], [5, 2], [7, 2], [Number.MAX_SAFE_INTEGER, 1]] as const) {
        const got = winnersOf(n, round, phase);
        const results = n.rig.h.service.phaseResults(n.rig.id, round, phase, { limit: 500 });
        expect(got.ok, `${done} ${round}/${phase}`).toBe(scored(done, round, phase));
        expect(results.ok).toBe(got.ok);
        if (!got.ok) {
          expect(got.error).toStrictEqual(roundNotApplied(applied));
          expect(results.ok ? undefined : results.error).toStrictEqual(got.error);
          const text = encodeError(got.error);
          // Byte-identical across stages and rounds with the same N.
          expect(bytes.get(applied) ?? text).toBe(text);
          bytes.set(applied, text);
        }
      }
      n.rig.h.close();
    }
    expect(bytes.size).toBe(5);
  });

  it('FR-386 the phase 1 of the pending round is readable exactly while its victim is revealed (phase 2 and locked), never before', () => {
    const n = openNamedScript();
    expect(winnersOf(n, 1, 1).ok).toBe(false);
    runNamed(n, 1);
    expect(winnersOf(n, 1, 1).ok).toBe(true);
    expect(winnersOf(n, 1, 2).ok).toBe(false);
    runNamed(n, 2);
    expect(winnersOf(n, 1, 1).ok).toBe(true);
    expect(winnersOf(n, 1, 2).ok).toBe(false);
    runNamed(n, 3);
    expect(winnersOf(n, 1, 2).ok).toBe(true);
    expect(winnersOf(n, 2, 1).ok).toBe(false);
    n.rig.h.close();
  });

  it('FR-386 a round below 1 or not whole is invalid-request round, a phase other than 1 or 2 is phase, both before the match is looked up; an unknown match is unknown-match', () => {
    const n = openNamedScript();
    const service = n.rig.h.service;
    for (const round of [0, -1, 1.5, Number.NaN]) expect(service.phaseWinners('nope', round, 1, { limit: 10 })).toStrictEqual({ ok: false, error: errorReply('invalid-request', ['round']) });
    expect(service.phaseWinners('nope', 1, 3 as 1, { limit: 10 })).toStrictEqual({ ok: false, error: errorReply('invalid-request', ['phase']) });
    expect(service.phaseWinners('nope', 1, 1, { limit: 10 })).toStrictEqual({ ok: false, error: errorReply('unknown-match') });
    n.rig.h.close();
  });
});
