import type { MapData } from '@mbrg/shared';
import { buildMapData } from '../core/adjacency';
import { formatJson } from '../core/json';
import type { CleanupError, Reassignment } from '../core/pieces';
import { toRgb } from '../core/png-check';
import type { EnclosedSet } from '../core/sea';
import { selfCheck } from '../core/self-check';
import type { Artifact, BuildError, BuiltPresentation, PngCodec } from '../core/types';
import { checkCuration, type CurationPlan, type CurationStageError } from './check-curation';
import { usedProperties, type Curation } from './curation';
import { WATER } from '../core/rasterize';
import { closeContextGaps, defaultContextGap } from './context-gap';
import { bridgeExclaves, DEFAULT_EXCLAVE_REACH, EXCLAVE_LINKS, type Bridge, type UnreachableExclave } from './exclave';
import { makeGapFill, type FilledSet } from './gap-fill';
import { belowMinSize, cleanPieces, type BelowMinSize, type TerritoryInfo } from './min-size';
import { withPreviewColors } from './preview-colors';
import { numberMap, type ImportNumbering } from './numbering';
import { checkSpacing, runTiling, tilingParams, unknownSeas, type TilingDetails, type TilingStepError } from './tiling-step';
import { composePixels } from './pixels';
import { readSource, readSources, type SourceInput } from './read-source';
import { assignSea, defaultEnclosedReach, type LakeSet, type SeaSeedError, type SeaZone } from './sea-sources';
import type { ReadSource, SourceError } from './types';
import { buildViews, type InsetError, type ViewError, type ViewItem, type ViewSet } from './views';
import type { PreviewEntry, PreviewSource } from '../core/types';

/** FR-608: the stages of an import after the files are read, in the order they are checked. */
export type ImportStage = 'sources' | 'curation' | 'projection' | 'pixels' | 'self-check';

/** Every error an import can report after the files are read. */
export type ImportError = SourceError | CurationStageError | ViewError | InsetError | SeaSeedError | BelowMinSize | CleanupError | UnreachableExclave | BuildError | TilingStepError;

/** What the import core takes: the parsed curation and the bytes of its sources, the PNG codec injected (NFR-134). */
export interface ImportInput {
  curation: Curation;
  /** The primary source, then the context sources in the curation's order; `file` is the label for errors. */
  primary: SourceInput;
  context: readonly SourceInput[];
  /** FR-694: the names file of the tiling, when `params.tiling.names` is given. */
  names?: SourceInput;
  codec: PngCodec;
}

/** The facts of a successful import that the report (FR-609) prints; the report itself is T3.2. */
export interface ImportDetails {
  sources: ReadSource[];
  curation: CurationPlan;
  views: ViewSet;
  numbering: ImportNumbering;
  filled: FilledSet[];
  /** FR-602: the water pixels of strips between a land territory and other land that became other land. */
  /** FR-602: the context gap in force, in pixels (the curation's or the default of the map's pixel size). */
  contextGap: number;
  contextGapPixels: number;
  /** FR-602: the bridges that linked exclave groups to the main group, in the order they were drawn. */
  bridges: Bridge[];
  enclosed: EnclosedSet[];
  /** FR-603: the reach in force, in pixels (the curation's, or the default of the map's pixel size; 0: no limit). */
  enclosedReach: number;
  /** FR-603: the enclosed water sets with no zone within the reach, made other land. */
  lakes: LakeSet[];
  reassigned: Reassignment[];
  /** Spec 035: the tiling facts for the report; absent when tiling is off (`params.tiling: false`) or the map has no sea. */
  tiling?: TilingDetails;
}

/** FR-608: a failed import names the first stage with errors and lists every error of that stage. */
export type ImportOutcome =
  | {
      ok: true;
      map: MapData;
      presentation: BuiltPresentation;
      pixels: Uint32Array;
      width: number;
      files: Record<Artifact, Uint8Array>;
      details: ImportDetails;
      /** FR-610: the preview of the final assignment. */
      preview: PreviewSource;
    }
  /**
   * FR-610: a failure at or after the pixel steps carries the preview of the last assignment it computed
   * (the water sentinel may still be in it); an earlier failure carries none.
   */
  | { ok: false; stage: ImportStage; errors: ImportError[]; preview?: PreviewSource };

const fail = (stage: ImportStage, errors: readonly ImportError[]): ImportOutcome => ({ ok: false, stage, errors: [...errors] });

/**
 * FR-608, FR-606: the import from bytes to bytes. The stages run in this order and the first one with errors stops
 * the run with all of its errors: the sources (caps first), the curation (FR-599, which also stops the import before any
 * projection), the projection and the insets, the pixel steps (composition, sea, gap fill, minimum piece, cleanup),
 * and the self-check of 003b on the final map, presentation data, id image values and encoded PNG. The usage, output
 * folder and file-reading stages belong to the command. Pure: the same bytes give the same files; nothing is read or
 * written here, and no pixel buffer exists before the curation stage and the views succeed (NFR-135).
 */
export function buildPackage(input: ImportInput): ImportOutcome {
  const { curation, codec } = input;
  const { params } = curation;

  const read = readSources([{ ...input.primary, usedProperties: usedProperties(curation) }, ...input.context.map((c) => ({ ...c, usedProperties: [] }))], {
    usedProperties: [],
  });
  if (!read.ok) return fail('sources', read.errors);
  const sources = read.value;
  const primary = sources[0]!;
  const contexts = sources.slice(1);

  const stage = checkCuration(primary.features, curation);
  if (!stage.ok) return fail('curation', stage.errors);
  const plan = stage.value;
  // FR-670: tiling is on unless the curation says `false`; its basin names and its names file are checked with the curation.
  const tilingOn = tilingParams(params);
  if (tilingOn !== undefined) {
    const unknown = unknownSeas(tilingOn, [...curation.seas.map((s) => s.name), ...plan.territories.filter((t) => t.kind === 'sea').map((t) => t.name ?? '')]);
    if (unknown.length > 0) return fail('curation', unknown);
  }

  // Projection and insets: other land is every context feature and every excluded or unselected primary unit.
  const others: ViewItem[] = [
    ...contexts.flatMap((source) => source.features.map((f): ViewItem => ({ origin: { file: source.file, feature: f.index }, polygons: f.polygons }))),
    ...plan.selection.other.map((u): ViewItem => ({ origin: { unit: u.key }, polygons: u.polygons })),
  ];
  const views = buildViews({ selected: plan.selection.selected, others, params, insets: curation.insets });
  if (!views.ok) return fail('projection', views.errors);
  if (tilingOn !== undefined) {
    // FR-670: a spacing under 3 pixels or over the frame side is a curation error, known once the frame is
    const frameKm = views.value.main.frame.side * 6371;
    const bad = checkSpacing(tilingOn, frameKm / params.side, frameKm);
    if (bad.length > 0) return fail('projection', bad);
  }

  let namesRead: ReadSource | undefined;
  if (tilingOn?.names !== undefined) {
    if (input.names === undefined) return fail('sources', [{ kind: 'invalid-curation', path: 'params.tiling.names' }]);
    const names = readSource({ ...input.names, usedProperties: tilingOn.names.nameProperty }, { usedProperties: [] });
    if (!names.ok) return fail('sources', names.errors);
    namesRead = names.value;
  }
  const baseNumbering = numberMap({ territories: plan.territories, factions: plan.factions, factionOf: plan.factionOf, seas: curation.seas });
  let numbering: ImportNumbering = baseNumbering;
  /** FR-610: the preview of the last assignment computed; the piece entries are in map order. */
  const previewOf = (pixels: Uint32Array): PreviewSource => ({
    width: params.side,
    pixels,
    factions: withPreviewColors(numbering.factions.map((f) => (f.color === undefined ? { id: f.id } : { id: f.id, color: f.color }))),
    entries: numbering.pieceEntries.map((e): PreviewEntry => (e.kind === 'land' ? { id: e.id, kind: 'land', owner: e.owner } : { id: e.id, kind: 'sea' })),
  });
  const raster = composePixels({
    views: views.value,
    land: numbering.land.map((l) => ({ value: l.id, units: l.territory.units })),
    seas: numbering.sea.flatMap((s) => (s.territory === undefined ? [] : [{ value: s.id, units: s.territory.units }])),
    context: contexts.flatMap((source) => source.features.map((f) => f.polygons)),
    other: plan.selection.other,
  });
  if (!raster.ok) return fail('projection', raster.errors);

  // FR-601: an inset that names a sea gives all the water inside its rectangle to that zone
  curation.insets.forEach((inset, i) => {
    if (inset.sea === undefined) return;
    const zone = numbering.sea.find((s) => s.seed !== undefined && curation.seas[s.seed]?.name === inset.sea);
    const view = views.value.insets[i];
    if (zone === undefined || view === undefined) return;
    const { x, y, w, h } = view.rect;
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        if (raster.value[row * params.side + col] === WATER) raster.value[row * params.side + col] = zone.id;
      }
    }
  });

  // Pixel steps: the sea (gap fill between the isolation and the zones), the minimum piece, the cleanup.
  const landCount = numbering.land.length;
  const pixelKm = (views.value.main.frame.side / params.side) * 6371;
  const contextGap = params.contextGap ?? defaultContextGap(pixelKm);
  const enclosedReach = params.enclosedReach ?? defaultEnclosedReach(pixelKm);
  const contextGapPixels = closeContextGaps(params.side, raster.value, contextGap, (value) => value >= 1 && value <= landCount);
  const zones: SeaZone[] = numbering.sea.map((s) => (s.seed === undefined ? { id: s.id } : { id: s.id, seed: curation.seas[s.seed]! }));
  const fill = params.gapFill === undefined ? undefined : makeGapFill(params.side, params.gapFill, (value) => value >= 1 && value <= landCount);
  const water = assignSea({ views: views.value, pixels: raster.value, zones, enclosedReach, ...(fill === undefined ? {} : { between: fill.between }) });
  if (!water.ok) return { ok: false, stage: 'pixels', errors: water.errors, preview: previewOf(raster.value) };

  const basinTerritories: TerritoryInfo[] = [
    ...numbering.land.map((l) => ({ id: l.id, key: l.territory.key, name: l.territory.name ?? '' })),
    ...numbering.sea.flatMap((s) => (s.territory === undefined ? [] : [{ id: s.id, key: s.territory.key, name: s.territory.name ?? '' }])),
  ];
  let waterPixels = water.value.pixels;
  let enclosed = water.value.enclosed;
  let tilingDetails: TilingDetails | undefined;
  // Spec 035, FR-673: tiling runs after the water pass and before the minimum-piece check and the cleanup; the check
  // still runs on the basins first (a sea territory with no piece of S pixels fails as 028 FR-604 says).
  if (tilingOn !== undefined && numbering.sea.length > 0) {
    const below = belowMinSize(params.side, waterPixels, basinTerritories, params.minPieceSize);
    if (below.length > 0) return { ok: false, stage: 'pixels', errors: below, preview: previewOf(waterPixels) };
    const tiled = runTiling({ params, tiling: tilingOn, numbering, views: views.value, pixels: waterPixels, width: params.side, minPieceSize: params.minPieceSize, ...(namesRead === undefined ? {} : { names: namesRead }) });
    if (!tiled.ok) return { ok: false, stage: 'pixels', errors: tiled.errors, preview: previewOf(waterPixels) };
    const basinFirst = tiled.value.details.firstTile;
    // the enclosed-water report names a zone by the first tile of the basin it joined
    enclosed = enclosed.map((e) => ({ ...e, zone: basinFirst[e.zone - (landCount + 1)] ?? e.zone }));
    waterPixels = tiled.value.pixels;
    numbering = tiled.value.numbering;
    tilingDetails = tiled.value.details;
  }
  const territories: TerritoryInfo[] =
    tilingDetails === undefined
      ? basinTerritories
      : [...basinTerritories.slice(0, landCount), ...numbering.sea.map((s) => ({ id: s.id, key: s.name ?? '', name: s.name ?? '' }))];
  const cleaned = cleanPieces(params.side, waterPixels, numbering.pieceEntries, territories, params.minPieceSize);
  if (!cleaned.ok) return { ok: false, stage: 'pixels', errors: cleaned.errors, preview: previewOf(waterPixels) };
  let pixels = cleaned.value.pixels;
  let reassigned = cleaned.value.reassigned;

  // FR-602: a group of territories that touches the rest of the map nowhere is linked to its nearest territories, then the pieces are cleaned again
  const bridged = bridgeExclaves({
    width: params.side,
    pixels,
    landIds: numbering.land.map((l) => l.id),
    seaIds: numbering.sea.map((s) => s.id),
    reach: params.exclaveReach ?? DEFAULT_EXCLAVE_REACH,
    links: EXCLAVE_LINKS,
  });
  if (!bridged.ok) return { ok: false, stage: 'pixels', errors: bridged.errors, preview: previewOf(pixels) };
  if (bridged.bridges.length > 0) {
    const again = cleanPieces(params.side, pixels, numbering.pieceEntries, territories, params.minPieceSize);
    if (!again.ok) return { ok: false, stage: 'pixels', errors: again.errors, preview: previewOf(pixels) };
    pixels = again.value.pixels;
    reassigned = [...reassigned, ...again.value.reassigned];
  }

  // FR-606: the package gate of 003b on the final map.
  const map = buildMapData(params.side, pixels, numbering.plan);
  const png = codec.encode(params.side, params.side, toRgb(pixels));
  const errors = selfCheck(map, numbering.presentation, params.side, pixels, png, codec);
  if (errors.length > 0) return { ok: false, stage: 'self-check', errors, preview: previewOf(pixels) };

  return {
    ok: true,
    map,
    presentation: numbering.presentation,
    pixels,
    width: params.side,
    files: { map: formatJson(map), presentation: formatJson(numbering.presentation), image: png },
    details: {
      sources,
      curation: plan,
      views: views.value,
      numbering,
      filled: fill?.filled ?? [],
      contextGap,
      contextGapPixels,
      bridges: bridged.bridges,
      enclosed,
      enclosedReach,
      lakes: water.value.lakes,
      reassigned,
      ...(tilingDetails === undefined ? {} : { tiling: tilingDetails }),
    },
    preview: previewOf(pixels),
  };
}
