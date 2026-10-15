import type { TerritoryId } from './types';
import type { PresentationList } from './package-types';

/** FR-92: where a `presentation-unknown-field` was found. `id` only if valid. */
export type PresentationLocation =
  | { at: 'presentation' }
  | { at: 'entry'; list: PresentationList; position: number; id?: number };

/** FR-92. `id` is omitted (never undefined) when the entry id is not valid. */
export type PresentationError =
  | { kind: 'invalid-presentation' }
  | { kind: 'invalid-presentation-list'; list: PresentationList }
  | { kind: 'invalid-presentation-entry'; list: PresentationList; position: number }
  | { kind: 'invalid-presentation-id'; list: PresentationList; position: number }
  | { kind: 'duplicate-presentation-id'; list: PresentationList; id: number; positions: number[] }
  | { kind: 'invalid-name'; list: PresentationList; position: number; id?: number }
  | { kind: 'invalid-color'; list: 'factions'; position: number; id?: number }
  | { kind: 'presentation-unknown-field'; location: PresentationLocation; field: string }
  | { kind: 'unknown-presentation-id'; list: PresentationList; id: number }
  | { kind: 'missing-presentation'; list: PresentationList; id: number }
  | { kind: 'duplicate-faction-name'; name: string; factions: number[] }
  | { kind: 'duplicate-color'; color: string; factions: number[] };

/** FR-92, FR-94: error kinds in the order of the FR-92 table. */
export const PRESENTATION_KIND_ORDER: readonly PresentationError['kind'][] = [
  'invalid-presentation',
  'invalid-presentation-list',
  'invalid-presentation-entry',
  'invalid-presentation-id',
  'duplicate-presentation-id',
  'invalid-name',
  'invalid-color',
  'presentation-unknown-field',
  'unknown-presentation-id',
  'missing-presentation',
  'duplicate-faction-name',
  'duplicate-color',
];

/** FR-106, FR-108, FR-110: input outside the domain of the id image contract. */
export type InvalidImageError = { kind: 'invalid-image' };

/** FR-110 */
export type IdImageError =
  | InvalidImageError
  | { kind: 'unknown-pixel-id'; id: number; pixelCount: number; firstPixel: { x: number; y: number } }
  | { kind: 'missing-territory-pixels'; territory: TerritoryId }
  | { kind: 'missing-adjacency'; a: TerritoryId; b: TerritoryId }
  | { kind: 'extra-adjacency'; a: TerritoryId; b: TerritoryId };

/** FR-110: error kinds in the order of the FR-110 table. */
export const ID_IMAGE_KIND_ORDER: readonly IdImageError['kind'][] = [
  'invalid-image',
  'unknown-pixel-id',
  'missing-territory-pixels',
  'missing-adjacency',
  'extra-adjacency',
];
