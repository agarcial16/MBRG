import type { IdImageError, MapData, PresentationData, PresentationError, Result, ValidationError } from '@mbrg/shared';

/** FR-105: a PNG file that fails the id image file rules. Carries no data. */
export type PngError = { kind: 'invalid-png' };

/** The PNG seam of the builder: bytes <-> raw RGB, never anything else. */
export interface PngCodec {
  encode(width: number, height: number, rgb: Uint8Array): Uint8Array;
  decode(bytes: Uint8Array): Result<{ width: number; height: number; rgb: Uint8Array }, PngError>;
}

/** The seven builder inputs, in the order FR-112 lists them. */
export type InputName =
  | 'provinces'
  | 'countries'
  | 'otherLand'
  | 'grouping'
  | 'seeds'
  | 'meta'
  | 'params';

/** A ring of [x, y] points: [longitude, latitude] in the source, [u, v] in pixel space. */
export interface Ring {
  coords: [number, number][];
}

/** One polygon: an outer ring and its holes (FR-115). */
export interface SourcePolygon {
  outer: Ring;
  holes: Ring[];
}

/** A source feature: its properties and its polygons (a MultiPolygon has several). */
export interface SourceFeature {
  props: Record<string, unknown>;
  polygons: SourcePolygon[];
}

/** FR-112 country record: properties only; names stay `unknown` (present test in FR-121). */
export interface CountryRecord {
  adm0_a3: string;
  name?: unknown;
  name_es?: unknown;
}

/** FR-112 grouping table (FR-113). `color` and `name` of a territory stay `unknown` on purpose. */
export interface GroupingTable {
  countries: { country: string; color?: string }[];
  territories: {
    key: string;
    country?: string;
    provinces: string[];
    name?: unknown;
    color?: unknown;
  }[];
  excluded: string[];
}

/** FR-112 sea zone seed. */
export interface SeaSeed {
  name: string;
  lon: number;
  lat: number;
}

/** FR-112 build parameters: side W (H = W), margin, minimum piece size S. */
export interface BuildParams {
  width: number;
  margin: number;
  minPieceSize: number;
}

/** FR-112: exactly these inputs fully determine the output; no seed, round or match state. */
export interface BuildInputs {
  provinces: SourceFeature[];
  countries: CountryRecord[];
  otherLand: SourceFeature[];
  grouping: GroupingTable;
  seeds: SeaSeed[];
  meta: { version: string };
  params: BuildParams;
}

/** FR-112: a malformed input; `reason` is English text naming the input and the problem. */
export type InputError = { kind: 'invalid-input'; reason: string };

/** FR-113: grouping table problems, kinds in table order. */
export type GroupingError =
  | { kind: 'duplicate-country' | 'unknown-country' | 'empty-country'; country: string }
  | {
      kind:
        | 'duplicate-territory-key'
        | 'invalid-territory-country'
        | 'territory-color'
        | 'empty-territory'
        | 'missing-territory-name';
      territory: string;
    }
  | { kind: 'unknown-province' | 'duplicate-province-assignment' | 'unassigned-province'; province: string }
  | { kind: 'province-country-mismatch'; province: string; territory: string };

/** FR-116: sea seed problems, kinds in the order of the spec; `seed` is the 0-based position in the list. */
export type SeedError =
  | { kind: 'no-sea-seeds' }
  | { kind: 'seed-outside-frame' | 'seed-not-water'; seed: number; name: string }
  | { kind: 'duplicate-seed-pixel'; seeds: number[]; x: number; y: number };

/** FR-116: the pixel in which a seed point lies. */
export interface SeedPixel {
  x: number;
  y: number;
}

/** FR-119, FR-120: a faction, one per selected country. */
export interface NumberedFaction {
  id: number;
  country: string;
  color?: string;
}

/** FR-120: a land territory with its map id and owner. `name` is the table value, when the table has one. */
export interface NumberedLand {
  id: number;
  key: string;
  country: string;
  owner: number;
  provinces: string[];
  name?: unknown;
}

/** FR-120: a sea zone (no owner); `seed` is the 0-based position in the seed list. */
export interface NumberedSea {
  id: number;
  seed: number;
  name: string;
}

/** FR-120: factions, land territories and sea zones in map order. */
export interface NumberedPlan {
  factions: NumberedFaction[];
  land: NumberedLand[];
  sea: NumberedSea[];
}

/** FR-121: presentation entries; `name` is absent when no name is present (the self-check then fails). */
export interface BuiltPresentation {
  factions: { id: number; name?: string; color?: string }[];
  territories: { id: number; name?: string }[];
}

/** FR-123: the three package artifacts, in the order they are written. */
export type Artifact = 'map' | 'presentation' | 'image';

/** An entry of the map as the preview needs it: a land territory with its faction, or a sea zone. */
export type PreviewEntry = { id: number; kind: 'land'; owner: number } | { id: number; kind: 'sea' };

/**
 * FR-126: everything the preview needs. `pixels` may still hold the water sentinel (a failed build
 * previews the last assignment it computed); `factions` are in faction order with their preferred
 * colours; `entries` are in map order.
 */
export interface PreviewSource {
  width: number;
  pixels: Uint32Array;
  factions: { id: number; color?: string }[];
  entries: PreviewEntry[];
}

/** Every error a build can report (FR-112, FR-113, FR-116, FR-117, FR-122, FR-105). */
export type BuildError =
  | InputError
  | GroupingError
  | SeedError
  | { kind: 'vanished-entry'; territory: number }
  | ValidationError
  | PresentationError
  | IdImageError
  | { kind: 'png-round-trip-mismatch' }
  | PngError;

/**
 * FR-112, FR-122: the result of the in-memory build. A failure carries a preview only when it
 * happened after rasterization (FR-123).
 */
export type BuildOutcome =
  | {
      ok: true;
      map: MapData;
      presentation: PresentationData;
      pixels: Uint32Array;
      width: number;
      files: Record<Artifact, Uint8Array>;
      report: string;
      preview: PreviewSource;
    }
  | { ok: false; errors: BuildError[]; preview?: PreviewSource };
