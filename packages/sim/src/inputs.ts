// FR-31, FR-32, FR-45, FR-313: input checks for seed, round, state and faction. Inputs are `unknown`.
import { isSeaZone } from '@mbrg/shared';
import type { FactionId, MapData, Result, TerritoryId } from '@mbrg/shared';
import { MODE } from './types';
import type { MatchError, MatchState } from './types';

/** FR-31: a seed is a number that is an integer from 0 to 2^32 - 1 (-0 counts as 0). */
export function checkSeed(seed: unknown): seed is number {
  return typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff;
}

/** FR-45: a round is a number that is an integer >= 0 (-0 counts as 0). */
export function checkRound(round: unknown): round is number {
  return typeof round === 'number' && Number.isInteger(round) && round >= 0;
}

const NONE = Symbol('none');

/** Own-property rule: the value of an own data property, or NONE (inherited, missing, accessor). */
function ownValue(object: object, key: string | number): unknown {
  const d = Object.getOwnPropertyDescriptor(object, key);
  return d !== undefined && 'value' in d ? d.value : NONE;
}

/** FR-313: factions of a checked map, in first-seen order of its land territories. */
function mapFactions(map: MapData): Set<FactionId> {
  const found = new Set<FactionId>();
  for (const t of map.territories) if (!isSeaZone(t)) found.add(t.owner);
  return found;
}

const STATE_KEYS = ['mode', 'round', 'owners'];

/**
 * FR-313: a state is valid for `map` when it is a plain-keyed object with exactly the own data
 * properties `mode`, `round`, `owners`; the mode is `classic`; the round is a whole number from 0 to T
 * (-0 counts as 0); and the owners are exactly one [territoryId, factionId] pair per land territory of
 * the map, in map order, each faction being a faction of the map. Any failure is one `invalid-state`.
 * The value is a normalised copy; the input is never mutated and never aliased.
 */
export function checkState(map: MapData, state: unknown): Result<MatchState, MatchError> {
  const fail = (): Result<MatchState, MatchError> => ({ ok: false, errors: [{ kind: 'invalid-state' }] });
  if (typeof state !== 'object' || state === null || Array.isArray(state)) return fail();
  const keys = Reflect.ownKeys(state);
  if (keys.length !== STATE_KEYS.length || !STATE_KEYS.every((k) => keys.includes(k))) return fail();

  const mode = ownValue(state, 'mode');
  const round = ownValue(state, 'round');
  const owners = ownValue(state, 'owners');
  if (mode !== MODE) return fail();

  const land = map.territories.filter((t) => !isSeaZone(t));
  const factions = mapFactions(map);
  if (typeof round !== 'number' || !Number.isInteger(round) || round < 0 || round > factions.size - 1) return fail();
  if (!Array.isArray(owners) || owners.length !== land.length) return fail();

  const copy: [TerritoryId, FactionId][] = [];
  for (let i = 0; i < land.length; i++) {
    const pair = ownValue(owners, i);
    if (!Array.isArray(pair) || pair.length !== 2) return fail();
    const id = ownValue(pair, 0);
    const faction = ownValue(pair, 1);
    if (id !== land[i]!.id) return fail();
    if (typeof faction !== 'number' || !factions.has(faction)) return fail();
    copy.push([id as TerritoryId, faction]);
  }
  return { ok: true, value: { mode: MODE, round: round + 0, owners: copy } };
}

/** FR-313: a faction is a number that is a faction id of the map (an owner of a land territory). */
export function checkFaction(map: MapData, faction: unknown): Result<FactionId, MatchError> {
  if (typeof faction === 'number' && mapFactions(map).has(faction)) return { ok: true, value: faction };
  return { ok: false, errors: [{ kind: 'invalid-faction' }] };
}
