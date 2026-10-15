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

export type {
  PresentationList,
  FactionPresentation,
  TerritoryPresentation,
  PresentationData,
  Rgb,
  ContactPair,
  IdImage,
} from './package-types';
export type {
  PresentationLocation,
  PresentationError,
  InvalidImageError,
  IdImageError,
} from './package-errors';
export { PRESENTATION_KIND_ORDER, ID_IMAGE_KIND_ORDER } from './package-errors';
export { isValidName, isValidColor } from './names';
