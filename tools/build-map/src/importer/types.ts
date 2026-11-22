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
      reason: 'not-utf8' | 'not-json' | 'not-feature-collection' | 'bad-feature' | 'bad-geometry';
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
