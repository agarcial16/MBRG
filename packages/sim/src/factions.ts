// Faction helpers shared by the round engine and the candidate search. Not re-exported from index.ts.
import type { FactionId, TerritoryId } from '@mbrg/shared';
import type { MatchState } from './types';

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
