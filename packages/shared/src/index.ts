export type {
  TerritoryId,
  FactionId,
  LandTerritory,
  SeaZone,
  MapEntry,
  EntryKind,
  MapData,
  Result,
} from './types';
export type { ValidationError, FieldLocation } from './errors';
export { VALIDATION_KIND_ORDER } from './errors';
export { isValidId, MAX_ID } from './ids';
export { validateMap } from './validate';

export { entryKind, isSeaZone } from './kinds';
