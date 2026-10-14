// Internal round engine (FR-39). Not re-exported from index.ts.
import type { FactionId, MapData, Result, TerritoryId } from '@mbrg/shared';
import { pickIndex, roundRng } from './rng';
import { MODE } from './types';
import type { MatchState, RoundRecord, SimError } from './types';

/** FR-33: round 0, every territory owned by its initial owner. */
export function initialState(map: MapData): MatchState {
  return {
    mode: MODE,
    round: 0,
    owners: map.territories.map((t): [TerritoryId, FactionId] => [t.id, t.owner]),
  };
}

/** FR-34: owner of a territory by id. */
export function ownerOf(state: MatchState, territory: TerritoryId): FactionId | undefined {
  for (const [t, f] of state.owners) if (t === territory) return f;
  return undefined;
}

/** Distinct owners in first-seen order of the current state (faction order). */
export function livingFactions(state: MatchState): FactionId[] {
  const seen = new Set<FactionId>();
  const out: FactionId[] = [];
  for (const [, f] of state.owners) {
    if (!seen.has(f)) {
      seen.add(f);
      out.push(f);
    }
  }
  return out;
}

/**
 * FR-36: factions that own a territory mutually adjacent to a territory of `faction`,
 * as the union over all its territories, in faction order of the current state.
 */
export function neighborFactions(map: MapData, state: MatchState, faction: FactionId): FactionId[] {
  const ownerById = new Map(state.owners);
  const neighborsById = new Map(map.territories.map((t) => [t.id, t.neighbors]));
  const found = new Set<FactionId>();
  for (const t of map.territories) {
    if (ownerById.get(t.id) !== faction) continue;
    for (const n of t.neighbors) {
      const owner = ownerById.get(n);
      if (owner === undefined || owner === faction) continue;
      if (!neighborsById.get(n)?.includes(t.id)) continue; // mutual links only
      found.add(owner);
    }
  }
  return livingFactions(state).filter((f) => found.has(f));
}

/**
 * FR-35..FR-40: plays one round. A pure function of (map, state, seed): the randomness of
 * round k depends only on (seed, k). `seed` is a uint32. Requires >= 2 living factions.
 */
export function playRound(
  map: MapData,
  state: MatchState,
  seed: number,
): Result<{ state: MatchState; record: RoundRecord }, SimError> {
  const round = state.round + 1;
  const living = livingFactions(state);
  if (living.length < 2) throw new Error('playRound needs at least 2 living factions');

  const rng = roundRng(seed, round);
  const eliminated = living[pickIndex(rng, living.length)]!;
  const candidates = neighborFactions(map, state, eliminated);
  if (candidates.length === 0) {
    return { ok: false, errors: [{ kind: 'isolated-faction', faction: eliminated, round }] };
  }
  const absorber = candidates[pickIndex(rng, candidates.length)]!;

  const transferred: TerritoryId[] = [];
  const owners = state.owners.map(([t, f]): [TerritoryId, FactionId] => {
    if (f !== eliminated) return [t, f];
    transferred.push(t);
    return [t, absorber];
  });
  return {
    ok: true,
    value: {
      state: { mode: MODE, round, owners },
      record: { round, eliminated, absorber, transferred },
    },
  };
}
