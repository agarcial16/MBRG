export type { Coord, MapFormatV1, Territory } from './map.js';
export { mainRing, ringArea } from './map.js';
export { normalizeMap, validateMap, type ValidationResult } from './validate.js';
export { buildAdjacency } from './adjacency.js';
export type {
  Faction,
  FactionId,
  MatchState,
  Ownership,
  PickWeighting,
  RoundEvent,
  SimOptions,
  TerritoryId,
} from './match.js';
