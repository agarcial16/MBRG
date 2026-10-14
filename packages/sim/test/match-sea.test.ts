import { describe, expect, it } from 'vitest';
import type { MapData } from '@mbrg/shared';
import { MODE, getRounds, getState, ownerOf, totalRounds } from '../src/index';
import { absorptionCandidates } from '../src/candidates';
import { initialState, livingFactions, ownerOf as internalOwnerOf, playRound } from '../src/internal';
import { pickIndex, roundRng } from '../src/rng';
import type { RoundRecord } from '../src/types';
import { land, sea, seaMapFrom } from './helpers/sea-maps';

/**
 * Widening map. Factions A=10 (land 1), B=20 (land 2 and island 6 on zone 102),
 * D=40 (island 3 alone on zone 101), E=50 and F=60 (islands 4, 5 on zone 103).
 * Zones 101-102-103 form a chain; land 1 touches zone 102. D has nobody on its own zone,
 * so it widens one hop to zone 102 where A and B touch.
 */
const widenMap = (): MapData =>
  seaMapFrom(
    [land(1, 10), land(2, 20), sea(101), land(3, 40), sea(102), land(6, 20), sea(103), land(4, 50), land(5, 60)],
    [
      [1, 2],
      [3, 101],
      [101, 102],
      [102, 103],
      [1, 102],
      [6, 102],
      [4, 103],
      [5, 103],
    ],
  );

function rounds(map: unknown, seed: number, n: number): RoundRecord[] {
  const r = getRounds(map, seed, n);
  if (!r.ok) throw new Error('unexpected failure: ' + JSON.stringify(r.errors));
  return r.value;
}
function total(map: unknown): number {
  const r = totalRounds(map);
  if (!r.ok) throw new Error('unexpected failure');
  return r.value;
}

describe('match with sea zones (FR-60, FR-72..FR-80)', () => {
  it('FR-75 FR-78 replaying both draws by hand reproduces every recorded round, seeds 0..199', () => {
    const map = widenMap();
    let widened = 0;
    let direct = 0;
    for (let seed = 0; seed < 200; seed++) {
      const records = rounds(map, seed, total(map));
      let state = initialState(map);
      for (const rec of records) {
        const rng = roundRng(seed, rec.round);
        const living = livingFactions(state);
        const eliminated = living[pickIndex(rng, living.length)]!;
        const c = absorptionCandidates(map, state, eliminated);
        if (c.how === 'widened') widened++;
        if (c.how === 'direct') direct++;
        const absorber = c.factions[pickIndex(rng, c.factions.length)]!;
        expect(rec.eliminated).toBe(eliminated);
        expect(rec.absorber).toBe(absorber);
        const next = playRound(map, state, seed);
        if (!next.ok) throw new Error('unexpected failure');
        state = next.value.state;
      }
    }
    expect(widened).toBeGreaterThan(0);
    expect(direct).toBeGreaterThan(0);
  });

  it('FR-72 FR-73 sea zones never appear in states or records; ownerOf of a sea id is undefined', () => {
    const map = widenMap();
    const seaIds = [101, 102, 103];
    const t = total(map);
    for (let seed = 0; seed < 50; seed++) {
      for (const rec of rounds(map, seed, t)) {
        for (const id of seaIds) expect(rec.transferred).not.toContain(id);
        expect(seaIds).not.toContain(rec.eliminated);
        expect(seaIds).not.toContain(rec.absorber);
      }
      for (let n = 0; n <= t; n++) {
        const s = getState(map, seed, n);
        if (!s.ok) throw new Error('unexpected failure');
        for (const id of seaIds) {
          expect(s.value.owners.some(([t2]) => t2 === id)).toBe(false);
          expect(ownerOf(s.value, id)).toBeUndefined();
          expect(internalOwnerOf(s.value, id)).toBeUndefined();
        }
      }
    }
  });

  it('FR-74 the mode stays classic on a sea map', () => {
    const map = widenMap();
    expect(MODE).toBe('classic');
    const s = getState(map, 3, 2);
    if (!s.ok) throw new Error('unexpected failure');
    expect(s.value.mode).toBe('classic');
  });

  it('FR-79 transferred holds the land territories of the eliminated faction in map order, never sea', () => {
    const map = widenMap();
    const landIds = map.territories.filter((t) => t.kind !== 'sea').map((t) => t.id);
    for (let seed = 0; seed < 100; seed++) {
      let state = initialState(map);
      for (const rec of rounds(map, seed, total(map))) {
        const expected = landIds.filter((id) => ownerOf(state, id) === rec.eliminated);
        expect(rec.transferred).toStrictEqual(expected);
        const next = playRound(map, state, seed);
        if (!next.ok) throw new Error('unexpected failure');
        state = next.value.state;
      }
    }
  });

  it('FR-60 FR-80 total rounds is land factions minus one, with multi-territory factions; one remains', () => {
    const map = widenMap();
    expect(total(map)).toBe(4); // A, B, D, E, F
    for (let seed = 0; seed < 50; seed++) {
      const s = getState(map, seed, 4);
      if (!s.ok) throw new Error('unexpected failure');
      expect(livingFactions(s.value)).toHaveLength(1);
      expect(s.value.owners).toHaveLength(6); // all land territories, no sea
      expect(rounds(map, seed, 4)).toHaveLength(4);
    }
  });

  it('FR-80 sea zones never count as factions: two land factions across seas play one round', () => {
    const map = seaMapFrom([land(1, 10), sea(2), sea(3), land(4, 20)], [[1, 2], [2, 3], [3, 4]]);
    expect(total(map)).toBe(1);
  });

  it('FR-35 FR-60 faction order Y,X,Y,Z,X gives [Y,X,Z] with seas interleaved', () => {
    const map = seaMapFrom(
      [sea(10), land(1, 7), sea(11), land(2, 5), land(3, 7), sea(12), land(4, 9), land(5, 5)],
      [[1, 10], [10, 11], [11, 2], [2, 3], [3, 12], [12, 4], [4, 5]],
    );
    expect(livingFactions(initialState(map))).toStrictEqual([7, 5, 9]);
  });

  it('FR-35 FR-60 faction order Y,Y,Z,X,Z gives [Y,Z,X] with seas interleaved', () => {
    const map = seaMapFrom(
      [land(1, 7), sea(10), land(2, 7), land(3, 9), sea(11), land(4, 5), land(5, 9)],
      [[1, 2], [2, 3], [3, 10], [10, 4], [4, 5], [5, 11], [11, 1]],
    );
    expect(livingFactions(initialState(map))).toStrictEqual([7, 9, 5]);
  });

  it('FR-62 moving a sea zone in the list leaves states and records unchanged, seeds 0..99', () => {
    const map = widenMap();
    const zone = map.territories.find((t) => t.id === 102)!;
    const rest = map.territories.filter((t) => t.id !== 102);
    const moved: MapData = { territories: [...rest, zone] };
    const first: MapData = { territories: [zone, ...rest] };
    const t = total(map);
    for (let seed = 0; seed < 100; seed++) {
      const base = rounds(map, seed, t);
      expect(rounds(moved, seed, t)).toStrictEqual(base);
      expect(rounds(first, seed, t)).toStrictEqual(base);
      for (let n = 0; n <= t; n++) {
        expect(getState(moved, seed, n)).toStrictEqual(getState(map, seed, n));
      }
    }
  });

  it('FR-63 adding kind land to every land entry leaves the match unchanged', () => {
    const map = widenMap();
    const withKind: MapData = {
      territories: map.territories.map((t) => (t.kind === 'sea' ? t : { ...t, kind: 'land' as const })),
    };
    const t = total(map);
    for (let seed = 0; seed < 100; seed++) {
      expect(rounds(withKind, seed, t)).toStrictEqual(rounds(map, seed, t));
    }
  });

  it('FR-53 a sea match survives a JSON round trip', () => {
    const map = widenMap();
    const t = total(map);
    const r = rounds(map, 11, t);
    const s = getState(map, 11, t);
    if (!s.ok) throw new Error('unexpected failure');
    expect(JSON.parse(JSON.stringify(r))).toStrictEqual(r);
    expect(JSON.parse(JSON.stringify(s.value))).toStrictEqual(s.value);
  });

  it('FR-78 playRound reports isolated-faction when the sea gives no candidate', () => {
    // Land 2 reaches nothing; land 1 has a dead-end zone nobody else touches.
    const map = seaMapFrom([land(1, 10), land(2, 20), sea(101)], [[1, 101]]);
    for (let seed = 0; seed < 10; seed++) {
      const r = playRound(map, initialState(map), seed);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0]!.kind).toBe('isolated-faction');
      }
    }
  });
});

describe('inherited kind is not sea (FR-58 FR-72 FR-80)', () => {
  /** Same entry, but `kind: 'sea'` sits on the prototype (not own), as non-JSON input could. */
  const withInheritedSea = (map: MapData, id: number): MapData => ({
    territories: map.territories.map((t) =>
      t.id === id ? (Object.assign(Object.create({ kind: 'sea' }) as object, t) as typeof t) : t,
    ),
  });

  it('FR-58 FR-72 FR-80 a land entry with an inherited sea kind stays land: state, rounds and match work', () => {
    const base = seaMapFrom([land(1, 1), land(2, 2)], [[1, 2]]);
    const map = withInheritedSea(base, 2);
    expect(initialState(map).owners).toStrictEqual([[1, 1], [2, 2]]);
    expect(total(map)).toBe(1);
    const recs = rounds(map, 7, 1);
    expect(recs).toHaveLength(1);
    const s = getState(map, 7, 1);
    expect(s.ok).toBe(true);
    if (!s.ok) throw new Error('unexpected failure');
    expect(ownerOf(s.value, 2)).toBeDefined();
  });

  it('FR-58 FR-75 FR-80 absorptionCandidates treats an inherited sea kind as land, same as the plain map', () => {
    const plain = widenMap();
    for (const id of [1, 2, 3, 6]) {
      const map = withInheritedSea(plain, id);
      expect(initialState(map).owners).toStrictEqual(initialState(plain).owners);
      expect(total(map)).toBe(total(plain));
      const state = initialState(plain);
      for (const f of livingFactions(state)) {
        expect(absorptionCandidates(map, state, f)).toStrictEqual(absorptionCandidates(plain, state, f));
      }
      expect(rounds(map, 3, total(map))).toStrictEqual(rounds(plain, 3, total(plain)));
    }
  });
});
