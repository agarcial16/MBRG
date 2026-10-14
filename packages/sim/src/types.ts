import type { FactionId, TerritoryId, ValidationError } from '@mbrg/shared';

/** FR-30: identifier of the mode of spec 001. "Clásico" is only its UI string. */
export const MODE = 'classic';

/** FR-34: owner per territory as [territoryId, factionId] pairs in map order. No seed (FR-49). */
export interface MatchState {
  mode: typeof MODE;
  round: number;
  owners: [TerritoryId, FactionId][];
}

/** FR-40: one played round. `transferred` is in map order. No seed (FR-49). */
export interface RoundRecord {
  round: number;
  eliminated: FactionId;
  absorber: FactionId;
  transferred: TerritoryId[];
}

export type SimError =
  | { kind: 'invalid-seed' }
  | { kind: 'invalid-round' }
  | { kind: 'round-out-of-range'; round: number; total: number }
  | { kind: 'isolated-faction'; faction: FactionId; round: number };

export type MatchError = ValidationError | SimError;
