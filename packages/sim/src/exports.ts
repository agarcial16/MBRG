// FR-313: the three validated public exports built on the internal engine. Every input is `unknown`.
// Pure: no clock, no randomness, no I/O. The internal functions stay unchanged (FR-312).
import { validateMap } from '@mbrg/shared';
import type { FactionId, MapData, Result } from '@mbrg/shared';
import { absorptionCandidates } from './candidates';
import { livingFactions as livingFactionsOf } from './factions';
import { checkFaction, checkSeed, checkState } from './inputs';
import { initialState, playRound } from './internal';
import type { MatchError, MatchState, RoundRecord } from './types';

/** Map errors first, then the state check, both only when the map is valid (a state needs a map). */
function checkMapAndState(map: unknown, state: unknown, errors: MatchError[]): { map?: MapData; state?: MatchState } {
  const v = validateMap(map);
  if (!v.ok) {
    errors.push(...v.errors);
    return {};
  }
  const s = checkState(v.value, state);
  if (!s.ok) {
    errors.push(...s.errors);
    return { map: v.value };
  }
  return { map: v.value, state: s.value };
}

/** FR-42: T = number of factions - 1. */
function totalOf(map: MapData): number {
  return livingFactionsOf(initialState(map)).length - 1;
}

/**
 * FR-313(a): plays round `state.round + 1` from a valid state with the given round seed (a uint32, FR-31).
 * Errors together, in order: map errors, `invalid-state`, `invalid-seed`, then `round-out-of-range`
 * (round = state round + 1, total = T) when the state is at round T or has fewer than 2 living factions.
 * `isolated-faction` is returned as the internal step gives it. The input is never mutated.
 */
export function playRoundWithSeed(
  map: unknown,
  state: unknown,
  roundSeed: unknown,
): Result<{ state: MatchState; record: RoundRecord }, MatchError> {
  const errors: MatchError[] = [];
  const checked = checkMapAndState(map, state, errors);
  const seedOk = checkSeed(roundSeed);
  if (!seedOk) errors.push({ kind: 'invalid-seed' });
  if (checked.map !== undefined && checked.state !== undefined) {
    const total = totalOf(checked.map);
    if (checked.state.round >= total || livingFactionsOf(checked.state).length < 2) {
      errors.push({ kind: 'round-out-of-range', round: checked.state.round + 1, total });
    }
  }
  if (errors.length > 0 || checked.map === undefined || checked.state === undefined || !seedOk) {
    return { ok: false, errors };
  }
  return playRound(checked.map, checked.state, roundSeed >>> 0);
}

/**
 * FR-313(b): the absorption candidates of `faction` in `state`, in the internal order and without the
 * internal `how`. Errors together, in order: map errors, `invalid-state`, `invalid-faction`. A faction of
 * the map that owns nothing gives an empty list (the internal operation is not called for it).
 */
export function absorptionCandidatesOf(map: unknown, state: unknown, faction: unknown): Result<FactionId[], MatchError> {
  const errors: MatchError[] = [];
  const checked = checkMapAndState(map, state, errors);
  let id: FactionId | undefined;
  if (checked.map !== undefined) {
    const f = checkFaction(checked.map, faction);
    if (f.ok) id = f.value;
    else errors.push(...f.errors);
  }
  if (errors.length > 0 || checked.map === undefined || checked.state === undefined || id === undefined) {
    return { ok: false, errors };
  }
  if (!livingFactionsOf(checked.state).includes(id)) return { ok: true, value: [] };
  return { ok: true, value: [...absorptionCandidates(checked.map, checked.state, id).factions] };
}

/**
 * FR-313(c): the factions owning at least one territory, in faction order of the state. Errors together:
 * map errors, then `invalid-state`.
 */
export function livingFactions(map: unknown, state: unknown): Result<FactionId[], MatchError> {
  const errors: MatchError[] = [];
  const checked = checkMapAndState(map, state, errors);
  if (errors.length > 0 || checked.state === undefined) return { ok: false, errors };
  return { ok: true, value: livingFactionsOf(checked.state) };
}
