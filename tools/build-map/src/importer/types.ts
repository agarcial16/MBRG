import type { SourcePolygon } from '../core/types';

/** FR-587: one feature kept from a source (a null geometry is skipped and counted, never kept). */
export interface ImportFeature {
  /** Position of the feature in the file's `features` list, counting skipped ones. */
  index: number;
  /** The feature's `properties` object (null read as empty); read with the own-property rule only. */
  props: Record<string, unknown>;
  polygons: SourcePolygon[];
}

/** Longitude and latitude range of the positions read, in degrees. */
export interface Extent {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** FR-587: what the reader returns for one source file. */
export interface ReadSource {
  /** The label the caller gave the file (a path relative to the curation file for a real run). */
  file: string;
  features: ImportFeature[];
  skippedNull: number;
  /** Every position of every kept feature. */
  positions: number;
  /** Null when no position was read. */
  extent: Extent | null;
}

/** FR-588: the cap a `source-too-large` error names. */
export type CapName = 'bytes' | 'features' | 'positions' | 'properties' | 'value';

/** FR-587, FR-588: the errors of reading a source. `file` is the label the caller gave it. */
export type SourceError =
  | {
      kind: 'invalid-source';
      file: string;
      reason: 'not-utf8' | 'not-json' | 'not-feature-collection' | 'bad-feature' | 'bad-geometry' | 'unreadable';
      feature?: number;
    }
  | { kind: 'unsupported-geometry'; file: string; feature: number; type: string }
  | { kind: 'unsupported-crs'; file: string; crs: string }
  | { kind: 'coordinates-not-degrees'; file: string; feature: number }
  | {
      kind: 'source-too-large';
      file: string;
      what: CapName;
      cap: number;
      found: number;
      feature?: number;
      property?: string;
    };

/** FR-590: a polygon geometry of a shapefile record as the shapefile adapter reads it (outer ring first, then holes). */
export type ShpGeometry =
  | { type: 'Polygon'; coordinates: [number, number][][] }
  | { type: 'MultiPolygon'; coordinates: [number, number][][][] };

/** FR-590: the errors of the extract mode (`invalid-input` is the builder's existing kind, with an English reason). */
export type ExtractGeoError =
  | { kind: 'unknown-dbf-encoding'; encoding: string }
  | { kind: 'unknown-field'; field: string }
  | { kind: 'invalid-dbf-text'; field: string; record: number }
  | { kind: 'projected-crs' }
  | { kind: 'invalid-input'; reason: string };

/** FR-592: a problem of the curation file; `path` is the member path ("" for the file as a whole). */
export type CurationError = { kind: 'invalid-curation'; path: string };
