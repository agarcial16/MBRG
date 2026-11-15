import { describe, expect, it } from 'vitest';
import { openNamedScript, runNamed } from './helpers/names-script';
import { expectedRows, phaseRows } from './helpers/results-script';

// The store side of the names in the results (spec 011 M5): the result reads keep their 008 rows (no name in them) and the names
// of the ids they return are found by player id inside the match, never by the name key and never across matches.

describe('the result rows and the names of their players', () => {
  it('FR-383 the result reads return the 008 rows (no name member) and the names of their ids are those of the joined players only', () => {
    const n = openNamedScript();
    runNamed(n, 12);
    const store = n.rig.h.store;
    const rows = store.phaseResultsAfter(n.rig.id, 'victim', 1, undefined, 100);
    expect(rows.map((r) => Object.keys(r))).toStrictEqual(rows.map(() => ['playerId', 'choice', 'correct', 'points']));
    expect(rows.map((r) => r.playerId)).toStrictEqual(phaseRows(expectedRows(n.rig), 'victim', 1).map((x) => x.playerId));
    const names = store.playerNames(n.rig.id, rows.map((r) => r.playerId));
    expect([...names.entries()].sort()).toStrictEqual([[n.ana.playerId, 'Ana'], [n.bea.playerId, 'Bea'], [n.jose.playerId, 'José']].sort());
    expect(store.playerResultsAfter(n.rig.id, n.ana.playerId, undefined, 10).map((r) => Object.keys(r))).toStrictEqual(Array.from({ length: 3 }, () => ['kind', 'round', 'choice', 'correct', 'points']));
    expect(store.leaderboardTotals(n.rig.id).map((t) => Object.keys(t)[0])).toContain('playerId');
    expect(store.leaderboardTotals(n.rig.id).every((t) => !('name' in t))).toBe(true);
    n.rig.h.close();
  });

  it('FR-383 a name is looked up by player id: the name key of a name is not an id, and another match has no such player', () => {
    const n = openNamedScript();
    const store = n.rig.h.store;
    // José's name key is 'jose'; neither it nor the lower-cased name finds a player.
    expect(store.playerNames(n.rig.id, ['jose', 'ana', 'Ana', 'José']).size).toBe(0);
    expect(store.playerNames(n.rig.id, [n.jose.playerId]).get(n.jose.playerId)).toBe('José');
    expect(store.playerNames('m-another-match', [n.ana.playerId, n.jose.playerId]).size).toBe(0);
    // An id that looks like a joined one but never joined, and a client id, have no name.
    expect(store.playerNames(n.rig.id, ['player:Ghost0000000', 'web:p1', 'discord:p1']).size).toBe(0);
    n.rig.h.close();
  });
});
