import type { Result } from '@mbrg/shared';
import type { CurationError } from './types';
import type { Params, TilingParams } from './curation';
import { tileNumbering, type ImportNumbering } from './numbering';
import { dominantFeatures, nameFeatures, NAME_MAX_CODE_POINTS, numberRepeatedNames, rasterizeNames } from './tile-names';
import { configFromTile, tileBasins, type MergedTile, type TilingBasin, type TilingConfig, type TilingError } from './tiling';
import type { ReadSource } from './types';
import type { ViewSet } from './views';

/**
 * Spec 035: the tiling step of an import. It resolves the parameters (FR-670, FR-671), splits the basins (FR-673 to
 * FR-677), names the tiles (FR-679, FR-694) and renumbers the sea (FR-678). Pure (NFR-175); the pixel work is in
 * `tiling.ts`, the names in `tile-names.ts`.
 */

/** The radius of the sphere the pixel size is measured on (028 FR-609). */
const EARTH_KM = 6371;

/** FR-671: the default number of tiles is `min(600, 2 x land territories)`. */
export const DEFAULT_TILE_CAP = 600;

/** FR-670: a `zones` key that names no basin. */
export interface UnknownSea {
  kind: 'unknown-sea';
  name: string;
}

/** FR-679: a tile name over the 80 code points of 003a FR-87. */
export interface TileNameTooLong {
  kind: 'tile-name-too-long';
  name: string;
  length: number;
}

export type TilingStepError = TilingError | UnknownSea | TileNameTooLong | CurationError;

/** Whether tiling runs (FR-670): on unless the curation says `false`. */
export function tilingParams(params: Params): TilingParams | undefined {
  return params.tiling === false ? undefined : (params.tiling ?? { zones: new Map() });
}

/** FR-670: the `zones` keys that name no basin, in code-unit order of the key. */
export function unknownSeas(tiling: TilingParams, basinNames: readonly string[]): UnknownSea[] {
  const known = new Set(basinNames);
  return [...tiling.zones.keys()].filter((name) => !known.has(name)).sort().map((name) => ({ kind: 'unknown-sea' as const, name }));
}

/** What the report prints of a tiling (FR-686, FR-687). */
export interface TilingDetails {
  config: TilingConfig;
  /** The number of tiles asked for when `tileKm` was searched (FR-671); absent when the author gave `tileKm`. */
  targetTiles?: number;
  pixelKm: number;
  /** The seeds before merges. */
  seeds: number;
  basins: { name: string; pixels: number; km2: number; pieces: number; tiles: number }[];
  tiles: number;
  /** Tile areas in km2. */
  area: { min: number; median: number; max: number };
  merged: { basin: string; pixels: number }[];
  /** Tiles named from the names file, and tiles that kept their basin's name. */
  named: number;
  fallback: number;
  /** Polygons of the names file a view could not draw, by feature position. */
  skippedNamePolygons: number[];
  /** The id of the first tile of each basin, in basin order (the enclosed-water report names zones by it). */
  firstTile: number[];
  /** The number of tiles of the basin whose tile every pixel carries, by id. */
  names: string[];
}

export interface TilingStepInput {
  params: Params;
  tiling: TilingParams;
  numbering: ImportNumbering;
  views: ViewSet;
  /** The raster after the water pass: no water is left; basins carry their ids. */
  pixels: Uint32Array;
  width: number;
  minPieceSize: number;
  /** The parsed names file when `tiling.names` is given. */
  names?: ReadSource;
}

export interface TilingStepOutput {
  pixels: Uint32Array;
  numbering: ImportNumbering;
  details: TilingDetails;
}

const codePoints = (text: string): number => [...text].length;

/**
 * FR-670: the spacings in force or the search that finds them, checked against the pixel size and the frame. A spacing
 * under 3 pixels or over the frame side is `invalid-curation` with the member path.
 */
export function checkSpacing(tiling: TilingParams, pixelKm: number, frameKm: number): CurationError[] {
  const errors: CurationError[] = [];
  const check = (member: string, value: number | undefined, zero = false): void => {
    if (value === undefined || (zero && value === 0)) return;
    if (value < 3 * pixelKm || value > frameKm) errors.push({ kind: 'invalid-curation', path: member });
  };
  check('params.tiling.tileKm', tiling.tileKm);
  check('params.tiling.openTileKm', tiling.openTileKm);
  check('params.tiling.farTileKm', tiling.farTileKm);
  check('params.tiling.coastBandKm', tiling.coastBandKm);
  check('params.tiling.reachKm', tiling.reachKm);
  for (const [name, km] of tiling.zones) check(`params.tiling.zones.${name}`, km, true);
  return errors;
}

/**
 * FR-673 to FR-679: tiles the basins of `pixels`, names the tiles and renumbers the sea. Returns the raster with the tile
 * ids and the new numbering, or the errors (`too-many-tiles`, `tile-name-too-long`).
 */
export function runTiling(input: TilingStepInput): Result<TilingStepOutput, TilingStepError> {
  const { tiling, numbering, views, width } = input;
  const frameKm = views.main.frame.side * EARTH_KM;
  const pixelKm = frameKm / width;
  const basinNames = numbering.sea.map((s) => s.name ?? '');
  const basins: TilingBasin[] = basinNames.map((name) => {
    const zone = tiling.zones.get(name);
    return zone === undefined ? { name, whole: false } : zone === 0 ? { name, whole: true } : { name, whole: false, tileKm: zone };
  });
  const firstId = numbering.land.length + 1;
  const overrides: Partial<Omit<TilingConfig, 'tileKm'>> = {
    ...(tiling.openTileKm === undefined ? {} : { openKm: tiling.openTileKm }),
    ...(tiling.farTileKm === undefined ? {} : { farKm: tiling.farTileKm }),
    ...(tiling.coastBandKm === undefined ? {} : { bandKm: tiling.coastBandKm }),
    ...(tiling.reachKm === undefined ? {} : { reachKm: tiling.reachKm }),
  };
  const targetTiles = tiling.targetTiles ?? Math.min(DEFAULT_TILE_CAP, 2 * Math.max(1, numbering.land.length));
  const split = tileBasins({
    width,
    pixels: input.pixels,
    firstId,
    basins,
    pixelKm,
    minPieceSize: input.minPieceSize,
    maxTiles: tiling.maxTiles ?? 10_000,
    spacing: tiling.tileKm === undefined ? { targetTiles, frameKm, overrides } : configFromTile(tiling.tileKm, overrides),
  });
  if (!split.ok) return split;
  const { labels, tiles, config } = split.value;

  // FR-679: names from the names file where one is given; a basin that stays whole keeps its name.
  const perBasin = new Array<number>(basins.length).fill(0);
  for (const tile of tiles) perBasin[tile.basin]!++;
  let dominant: Int32Array | undefined;
  let features: ReturnType<typeof nameFeatures> = [];
  let skipped: number[] = [];
  if (input.names !== undefined && tiling.names !== undefined) {
    features = nameFeatures(input.names, tiling.names.nameProperty);
    const raster = rasterizeNames(views, features);
    skipped = raster.skipped;
    dominant = dominantFeatures(labels, tiles.length, raster.ranks, features.length);
  }
  let named = 0;
  const bases = tiles.map((tile, t) => {
    const basinName = basinNames[tile.basin]!;
    if (perBasin[tile.basin] === 1) return basinName;
    const rank = dominant === undefined ? -1 : dominant[t]!;
    if (rank >= 0) {
      named++;
      return features[rank]!.name;
    }
    return basinName;
  });
  const names = numberRepeatedNames(bases);
  const tooLong = names.filter((n) => codePoints(n) > NAME_MAX_CODE_POINTS).map((name): TileNameTooLong => ({ kind: 'tile-name-too-long', name, length: codePoints(name) }));
  if (tooLong.length > 0) return { ok: false, errors: tooLong };

  // The raster with the tile ids (FR-678).
  const pixels = input.pixels.slice();
  for (let i = 0; i < labels.length; i++) if (labels[i]! >= 0) pixels[i] = firstId + labels[i]!;
  const tiled = tileNumbering(numbering, names.map((name) => ({ name })));

  const firstTile = new Array<number>(basins.length).fill(-1);
  tiles.forEach((tile, t) => {
    if (firstTile[tile.basin]! < 0) firstTile[tile.basin] = firstId + t;
  });
  const km2 = tiles.map((t) => t.pixels * pixelKm * pixelKm).sort((a, b) => a - b);
  const merged: MergedTile[] = split.value.merged;
  const details: TilingDetails = {
    config,
    ...(tiling.tileKm === undefined ? { targetTiles } : {}),
    pixelKm,
    seeds: split.value.seeds,
    basins: basins.map((b, i) => ({ name: b.name, pixels: split.value.basins[i]!.pixels, km2: split.value.basins[i]!.pixels * pixelKm * pixelKm, pieces: split.value.basins[i]!.pieces, tiles: split.value.basins[i]!.tiles })),
    tiles: tiles.length,
    area: { min: km2[0] ?? 0, median: km2[Math.floor(km2.length / 2)] ?? 0, max: km2[km2.length - 1] ?? 0 },
    merged: merged.map((m) => ({ basin: basinNames[m.basin]!, pixels: m.pixels })),
    named,
    fallback: tiles.length - named,
    skippedNamePolygons: skipped,
    firstTile,
    names,
  };
  return { ok: true, value: { pixels, numbering: tiled, details } };
}
