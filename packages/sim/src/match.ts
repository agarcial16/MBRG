// Public match API (FR-29, FR-42..FR-48). Pure: seed and round are parameters.
import { validateMap } from '@mbrg/shared';
import type { MapData, Result, ValidationError } from '@mbrg/shared';
import { checkRound, checkSeed } from './inputs';
import { initialState, livingFactions, playRound } from './internal';
import type { MatchError, MatchState, RoundRecord } from './types';

export { ownerOf } from './internal';

/** FR-42: T = number of factions - 1. */
export function totalRounds(map: unknown): Result<number, ValidationError> {
  const v = validateMap(map);
  if (!v.ok) return v;
  return { ok: true, value: livingFactions(initialState(v.value)).length - 1 };
}

interface Played {
  state: MatchState;
  records: RoundRecord[];
}

/** FR-43..FR-47: validates everything, then replays rounds 1..round from the initial state. */
function play(map: unknown, seed: unknown, round: unknown): Result<Played, MatchError> {
  const errors: MatchError[] = [];
  const v = validateMap(map);
  if (!v.ok) errors.push(...v.errors);
  const seedOk = checkSeed(seed);
  if (!seedOk) errors.push({ kind: 'invalid-seed' });
  const roundOk = checkRound(round);
  if (!roundOk) errors.push({ kind: 'invalid-round' });

  let data: MapData | undefined;
  let total = 0;
  if (v.ok) {
    data = v.value;
    total = livingFactions(initialState(data)).length - 1;
    if (roundOk && round > total) errors.push({ kind: 'round-out-of-range', round, total });
  }
  if (errors.length > 0 || !data || !seedOk || !roundOk) return { ok: false, errors };

  const n = round + 0; // normalises -0
  const s = seed >>> 0;
  let state = initialState(data);
  const records: RoundRecord[] = [];
  for (let i = 0; i < n; i++) {
    const r = playRound(data, state, s);
    if (!r.ok) return r;
    state = r.value.state;
    records.push(r.value.record);
  }
  return { ok: true, value: { state, records } };
}

/** FR-43: state after `round` rounds; round 0 is the initial state. */
export function getState(map: unknown, seed: unknown, round: unknown): Result<MatchState, MatchError> {
  const r = play(map, seed, round);
  return r.ok ? { ok: true, value: r.value.state } : r;
}

/** FR-44: records of rounds 1..round (empty for round 0). */
export function getRounds(map: unknown, seed: unknown, round: unknown): Result<RoundRecord[], MatchError> {
  const r = play(map, seed, round);
  return r.ok ? { ok: true, value: r.value.records } : r;
}
