import type { TerritoryId } from './types';

export type FieldLocation =
  | { at: 'map' }
  | { at: 'territory'; position: number; id?: TerritoryId };

/** FR-64. `id` is omitted (never undefined) when the territory id is invalid. */
export type ValidationError =
  | { kind: 'invalid-map' }
  | { kind: 'invalid-territories' }
  | { kind: 'invalid-territory'; position: number }
  | { kind: 'invalid-territory-id'; position: number }
  | { kind: 'invalid-neighbors'; position: number; id?: TerritoryId }
  | { kind: 'duplicate-territory-id'; id: TerritoryId; positions: number[] }
  | { kind: 'invalid-kind'; position: number; id?: TerritoryId }
  | { kind: 'missing-owner'; position: number; id?: TerritoryId }
  | { kind: 'invalid-owner'; position: number; id?: TerritoryId }
  | { kind: 'sea-owner'; position: number; id?: TerritoryId }
  | { kind: 'unknown-field'; location: FieldLocation; field: string }
  | { kind: 'unknown-neighbor'; territory: TerritoryId; neighbor: TerritoryId }
  | { kind: 'self-neighbor'; territory: TerritoryId }
  | { kind: 'duplicate-neighbor'; territory: TerritoryId; neighbor: TerritoryId }
  | { kind: 'asymmetric-adjacency'; from: TerritoryId; to: TerritoryId }
  | { kind: 'too-few-factions'; count: number }
  | { kind: 'disconnected-map'; groups: TerritoryId[][] };

/** FR-11, FR-64: error kinds in the order of the FR-64 table. */
export const VALIDATION_KIND_ORDER: readonly ValidationError['kind'][] = [
  'invalid-map',
  'invalid-territories',
  'invalid-territory',
  'invalid-territory-id',
  'invalid-neighbors',
  'duplicate-territory-id',
  'invalid-kind',
  'missing-owner',
  'invalid-owner',
  'sea-owner',
  'unknown-field',
  'unknown-neighbor',
  'self-neighbor',
  'duplicate-neighbor',
  'asymmetric-adjacency',
  'too-few-factions',
  'disconnected-map',
];
