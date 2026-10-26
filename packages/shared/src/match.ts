export type TerritoryId = string;

/** A faction id. By convention a faction starts as the territory with the same id. */
export type FactionId = string;

/** Territory → owning faction. A territory always has exactly one owner. */
export type Ownership = Record<TerritoryId, FactionId>;

export interface Faction {
  id: FactionId;
  /** Territories owned by this faction. */
  provinces: TerritoryId[];
}

/** How the doomed faction is chosen each round. */
export type PickWeighting = 'uniform' | 'provinces';

export interface SimOptions {
  /** Integer seed. The sim never invents entropy itself — callers (tests, server) pass it. */
  seed: number;
  /** Default 'uniform'. 'provinces' weights bigger factions to fall (anti-snowball "drama"). */
  weighting?: PickWeighting;
}

export interface RoundEvent {
  /** 1-based round number. */
  round: number;
  eliminated: FactionId;
  annexer: FactionId;
  /** Every province of the eliminated faction (transferred to `annexer`). */
  gained: TerritoryId[];
  /** Number of factions still alive AFTER this round. */
  remaining: number;
  /** Full ownership snapshot AFTER this round — drives replay/animation. */
  owners: Ownership;
}

/**
 * Plain-JSON match state (serializable: store it, send it, resume it).
 * Determinism rule: everything that affects the future must live in this state
 * (including `rngState`), never in ambient randomness.
 */
export interface MatchState {
  seed: number;
  weighting: PickWeighting;
  /** Internal PRNG state (uint32). Persist this to resume or fork a match. */
  rngState: number;
  owners: Ownership;
  /** Alive factions in deterministic insertion order. */
  factions: Faction[];
  /** Rounds completed so far. */
  round: number;
  log: RoundEvent[];
  done: boolean;
  winner: FactionId | null;
}
