import { describe, expect, it } from 'vitest';
import type { MapData } from '@mbrg/shared';
import * as sim from '../src/index';
import { absorptionCandidates } from '../src/candidates';
import { livingFactions } from '../src/factions';
import { initialState, neighborFactions, playRound } from '../src/internal';
import type { MatchState } from '../src/types';
import { gridMap, mapFrom } from './helpers/maps';
import { land, sea, seaMapFrom } from './helpers/sea-maps';

const direct = (factions: number[]) => ({ how: 'direct', factions });
const none = { how: 'none', factions: [] };

describe('absorption candidates, direct part (FR-75, FR-76, FR-81)', () => {
  it('FR-76 FR-81 an island faction reaches its rival through a shared zone', () => {
    const map = seaMapFrom([land(1, 10), sea(2), land(3, 20)], [[1, 2], [2, 3]]);
    expect(absorptionCandidates(map, initialState(map), 10)).toStrictEqual(direct([20]));
    expect(absorptionCandidates(map, initialState(map), 20)).toStrictEqual(direct([10]));
  });

  it('FR-75 FR-76 Denmark mix: land-only G, sea-only Sw, and G also on the zone counted once', () => {
    // Denmark (1, f1) borders Germany (2, f2) by land; Sweden (3, f3) is across the zone (4).
    const only = seaMapFrom([land(1, 1), land(2, 2), land(3, 3), sea(4)], [[1, 2], [1, 4], [3, 4]]);
    expect(absorptionCandidates(only, initialState(only), 1)).toStrictEqual(direct([2, 3]));
    // Germany also touches the zone: still one candidate each, no weighting.
    const both = seaMapFrom([land(1, 1), land(2, 2), land(3, 3), sea(4)], [[1, 2], [1, 4], [2, 4], [3, 4]]);
    expect(absorptionCandidates(both, initialState(both), 1)).toStrictEqual(direct([2, 3]));
  });

  it('FR-75 several shared zones and several links count the faction once', () => {
    const map = seaMapFrom(
      [land(1, 1), land(2, 1), land(3, 2), land(4, 2), sea(5), sea(6)],
      [[1, 5], [2, 5], [3, 5], [4, 5], [1, 6], [3, 6], [1, 3]],
    );
    expect(absorptionCandidates(map, initialState(map), 1)).toStrictEqual(direct([2]));
  });

  it('FR-76 a landlocked faction gets its land neighbors; with none it gets none', () => {
    const map = mapFrom([1, 2, 3], [[1, 2], [2, 3]]);
    expect(absorptionCandidates(map, initialState(map), 2)).toStrictEqual(direct([1, 3]));
    const split = seaMapFrom([land(1, 1), land(2, 2)], []);
    expect(absorptionCandidates(split, initialState(split), 1)).toStrictEqual(none);
  });

  it('FR-76 an unshared coast adds nothing and does not widen', () => {
    const map = seaMapFrom([land(1, 1), land(2, 2), land(3, 3), sea(4), sea(5)], [[1, 2], [1, 4], [4, 5], [5, 3]]);
    expect(absorptionCandidates(map, initialState(map), 1)).toStrictEqual(direct([2]));
  });

  it('FR-76 a lake touching only the faction own land adds no candidate', () => {
    const map = seaMapFrom([land(1, 1), land(2, 1), land(3, 2), sea(4)], [[1, 4], [2, 4], [1, 3]]);
    expect(absorptionCandidates(map, initialState(map), 1)).toStrictEqual(direct([2]));
  });

  it('FR-76 a bay is only its own zone: a zone beyond it is not a direct sharer', () => {
    const map = seaMapFrom([land(1, 1), land(2, 2), land(3, 3), sea(4), sea(5)], [[1, 4], [4, 5], [5, 3], [1, 2]]);
    expect(absorptionCandidates(map, initialState(map), 1)).toStrictEqual(direct([2]));
  });

  it('FR-76 a one-way land-sea link does not touch', () => {
    // Land 1 lists zone 3 but zone 3 does not list it; zone 3 lists land 2 but 2 does not list it back.
    const map = seaMapFrom([land(1, 1), land(2, 2), sea(3), land(4, 3)], [[3, 4]], [[1, 3], [3, 2]]);
    expect(absorptionCandidates(map, initialState(map), 1)).toStrictEqual(none);
    // Confirmed link on the coast side, one-way link on the far side.
    const far = seaMapFrom([land(1, 1), sea(2), land(3, 2)], [[1, 2]], [[2, 3]]);
    expect(absorptionCandidates(far, initialState(far), 1)).toStrictEqual(none);
  });

  it('FR-75 candidates follow faction order of the current state, each once, multi-territory factions', () => {
    const map = seaMapFrom([land(1, 1), land(2, 2), land(3, 3), land(4, 1), sea(5)], [[1, 2], [4, 5], [3, 5]]);
    expect(absorptionCandidates(map, initialState(map), 1)).toStrictEqual(direct([2, 3]));
    // A state where faction 3 now owns territory 2 and faction 2 territory 3: order follows the state.
    const state: MatchState = { mode: 'classic', round: 1, owners: [[1, 1], [2, 3], [3, 2], [4, 1]] };
    expect(livingFactions(state)).toStrictEqual([1, 3, 2]);
    expect(absorptionCandidates(map, state, 1)).toStrictEqual(direct([3, 2]));
  });

  it('FR-81 returns how candidates were found, takes only (map, state, faction), and throws for a dead faction', () => {
    expect(absorptionCandidates.length).toBe(3);
    const map = seaMapFrom([land(1, 1), land(2, 2)], [[1, 2]]);
    const r = absorptionCandidates(map, initialState(map), 1);
    expect(Object.keys(r).sort()).toStrictEqual(['factions', 'how']);
    expect(() => absorptionCandidates(map, initialState(map), 99)).toThrow();
  });

  it('FR-81 the operation is internal: not exported from @mbrg/sim', () => {
    expect(Object.keys(sim)).not.toContain('absorptionCandidates');
    expect(Object.keys(sim).sort()).toEqual(['MODE', 'getRounds', 'getState', 'ownerOf', 'totalRounds']);
  });
});

describe('NFR-7 candidates equal land-neighbor factions on maps without sea', () => {
  const hand8 = (): MapData =>
    mapFrom(
      [1, 2, 3, 4, 5, 6, 7, 8],
      [[1, 2], [2, 3], [3, 4], [4, 5], [4, 6], [5, 6], [6, 7], [7, 8], [1, 5], [4, 8]],
    );
  const multi = (): MapData =>
    mapFrom(
      [1, 1, 2, 2, 3, 3, 4, 5, 5],
      [[1, 3], [2, 4], [3, 5], [4, 6], [5, 7], [6, 8], [7, 9], [8, 9], [1, 2]],
    );

  it.each([
    ['hand8', hand8],
    ['grid 4x4', () => gridMap(4, 4)],
    ['multi-territory', multi],
  ])('NFR-7 %s: every round of the reference match has direct candidates = neighborFactions', (_n, make) => {
    const map = make();
    for (const seed of [42, 7]) {
      let state = initialState(map);
      while (livingFactions(state).length > 1) {
        const r = playRound(map, state, seed);
        if (!r.ok) throw new Error('unexpected error');
        const e = r.value.record.eliminated;
        const c = absorptionCandidates(map, state, e);
        expect(c).toStrictEqual({ how: 'direct', factions: neighborFactions(map, state, e) });
        state = r.value.state;
      }
    }
  });
});

const widened = (distance: number, factions: number[]) => ({ how: 'widened', distance, factions });

describe('absorption candidates, widening through the sea (FR-77, FR-78, NFR-9)', () => {
  it('FR-77 NFR-9 widened at exactly distance 1: the next zone touches a rival', () => {
    // 1 (f1) - coast zone 2 - zone 3 - 4 (f2). Zone 2 is f1 own coast and touches no other faction.
    const map = seaMapFrom([land(1, 1), sea(2), sea(3), land(4, 2)], [[1, 2], [2, 3], [3, 4]]);
    expect(absorptionCandidates(map, initialState(map), 1)).toStrictEqual(widened(1, [2]));
    expect(absorptionCandidates(map, initialState(map), 2)).toStrictEqual(widened(1, [1]));
  });

  it('FR-77 NFR-9 widened at exactly distance 2: open-ocean zones are used only while widening', () => {
    const map = seaMapFrom(
      [land(1, 1), sea(2), sea(3), sea(4), land(5, 2)],
      [[1, 2], [2, 3], [3, 4], [4, 5]],
    );
    expect(absorptionCandidates(map, initialState(map), 1)).toStrictEqual(widened(2, [2]));
    // Faction 2 touches only zone 3, which is not a coast of faction 1: it is found by widening, not directly.
    const ocean = seaMapFrom([land(1, 1), sea(2), sea(3), land(4, 2)], [[1, 2], [2, 3], [3, 4]]);
    expect(absorptionCandidates(ocean, initialState(ocean), 1).how).toBe('widened');
  });

  it('FR-77 stops at the first distance with a candidate: nearer faction only, farther one left out', () => {
    const map = seaMapFrom(
      [land(1, 1), sea(2), sea(3), land(4, 2), sea(5), land(6, 3)],
      [[1, 2], [2, 3], [3, 4], [3, 5], [5, 6]],
    );
    expect(absorptionCandidates(map, initialState(map), 1)).toStrictEqual(widened(1, [2]));
  });

  it('FR-77 factions found at the same distance are all included once, in faction order', () => {
    // Zone 3 at distance 1 touches f3 (twice), f2; zone 4 at distance 1 touches f2 again.
    const map = seaMapFrom(
      [land(1, 1), sea(2), sea(3), sea(4), land(5, 3), land(6, 3), land(7, 2), land(8, 2)],
      [[1, 2], [2, 3], [2, 4], [3, 5], [3, 6], [3, 7], [4, 8]],
    );
    expect(absorptionCandidates(map, initialState(map), 1)).toStrictEqual(widened(1, [3, 2]));
    // Faction order follows the state: here faction 2 appears before faction 3.
    const state: MatchState = {
      mode: 'classic',
      round: 1,
      owners: [[1, 1], [7, 2], [8, 2], [5, 3], [6, 3]],
    };
    expect(livingFactions(state)).toStrictEqual([1, 2, 3]);
    expect(absorptionCandidates(map, state, 1)).toStrictEqual(widened(1, [2, 3]));
  });

  it('FR-77 every zone at the next distance is checked, not only the first one found', () => {
    // Zone 3 (first at distance 1) touches nobody; zone 4 (second) touches the rival.
    const map = seaMapFrom(
      [land(1, 1), sea(2), sea(3), sea(4), land(5, 2)],
      [[1, 2], [2, 3], [2, 4], [4, 5]],
    );
    expect(absorptionCandidates(map, initialState(map), 1)).toStrictEqual(widened(1, [2]));
  });

  it('FR-77 the zone reach grows one hop at a time from every coast zone of a multi-territory faction', () => {
    const map = seaMapFrom(
      [land(1, 1), land(2, 1), sea(3), sea(4), sea(5), sea(7), land(6, 2)],
      [[1, 3], [3, 5], [2, 4], [4, 5], [5, 7], [7, 6]],
    );
    expect(absorptionCandidates(map, initialState(map), 1)).toStrictEqual(widened(2, [2]));
  });

  it('FR-77 widening uses only mutual sea-to-sea links', () => {
    const map = seaMapFrom([land(1, 1), sea(2), sea(3), land(4, 2)], [[1, 2], [3, 4]], [[2, 3]]);
    expect(absorptionCandidates(map, initialState(map), 1)).toStrictEqual(none);
    const back = seaMapFrom([land(1, 1), sea(2), sea(3), land(4, 2)], [[1, 2], [3, 4]], [[3, 2]]);
    expect(absorptionCandidates(back, initialState(back), 1)).toStrictEqual(none);
  });

  it('FR-77 the reach ignores the faction own land and cycles in the sea graph', () => {
    const map = seaMapFrom(
      [land(1, 1), land(2, 1), sea(3), sea(4), sea(5), land(6, 2)],
      [[1, 3], [2, 4], [3, 4], [4, 5], [3, 5], [5, 6]],
    );
    expect(absorptionCandidates(map, initialState(map), 1)).toStrictEqual(widened(1, [2]));
  });

  it('FR-78 NFR-9 an isolated faction gets none on a hand-built disconnected map without sea', () => {
    const map = mapFrom([1, 2, 3], [[2, 3]]);
    expect(absorptionCandidates(map, initialState(map), 1)).toStrictEqual(none);
    expect(absorptionCandidates(map, initialState(map), 2)).toStrictEqual(direct([3]));
  });

  it('FR-78 NFR-9 an isolated faction gets none on a disconnected map with sea zones', () => {
    // Island 1 with its zones 2, 3 (reaches nothing); 4 and 5 are elsewhere linked by land-sea.
    const map = seaMapFrom(
      [land(1, 1), sea(2), sea(3), land(4, 2), sea(5), land(6, 3)],
      [[1, 2], [2, 3], [4, 5], [5, 6]],
    );
    expect(absorptionCandidates(map, initialState(map), 1)).toStrictEqual(none);
    expect(absorptionCandidates(map, initialState(map), 2)).toStrictEqual(direct([3]));
  });

  it('FR-78 a faction with no coast and no land neighbor gets none, even beside open sea', () => {
    const map = seaMapFrom([land(1, 1), land(2, 2), sea(3)], [[2, 3]]);
    expect(absorptionCandidates(map, initialState(map), 1)).toStrictEqual(none);
  });
});
