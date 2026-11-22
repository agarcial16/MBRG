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
import { makeGapFill, type FilledSet } from './gap-fill';
import { cleanPieces, type BelowMinSize, type TerritoryInfo } from './min-size';
import { numberMap, type ImportNumbering } from './numbering';
import { composePixels } from './pixels';
import { readSources, type SourceInput } from './read-source';
import { assignSea, type SeaSeedError, type SeaZone } from './sea-sources';
import type { ReadSource, SourceError } from './types';
import { buildViews, type InsetError, type ViewError, type ViewItem, type ViewSet } from './views';
import type { PreviewEntry, PreviewSource } from '../core/types';

/** FR-608: the stages of an import after the files are read, in the order they are checked. */
export type ImportStage = 'sources' | 'curation' | 'projection' | 'pixels' | 'self-check';

/** Every error an import can report after the files are read. */
export type ImportError = SourceError | CurationStageError | ViewError | InsetError | SeaSeedError | BelowMinSize | CleanupError | BuildError;

/** What the import core takes: the parsed curation and the bytes of its sources, the PNG codec injected (NFR-134). */
export interface ImportInput {
  curation: Curation;
  /** The primary source, then the context sources in the curation's order; `file` is the label for errors. */
  primary: SourceInput;
  context: readonly SourceInput[];
  codec: PngCodec;
}

/** The facts of a successful import that the report (FR-609) prints; the report itself is T3.2. */
export interface ImportDetails {
  sources: ReadSource[];
  curation: CurationPlan;
  views: ViewSet;
  numbering: ImportNumbering;
  filled: FilledSet[];
  enclosed: EnclosedSet[];
  reassigned: Reassignment[];
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

  // Projection and insets: other land is every context feature and every excluded or unselected primary unit.
  const others: ViewItem[] = [
    ...contexts.flatMap((source) => source.features.map((f): ViewItem => ({ origin: { file: source.file, feature: f.index }, polygons: f.polygons }))),
    ...plan.selection.other.map((u): ViewItem => ({ origin: { unit: u.key }, polygons: u.polygons })),
  ];
  const views = buildViews({ selected: plan.selection.selected, others, params, insets: curation.insets });
  if (!views.ok) return fail('projection', views.errors);

  const numbering = numberMap({ territories: plan.territories, factions: plan.factions, factionOf: plan.factionOf, seas: curation.seas });
  /** FR-610: the preview of the last assignment computed; the piece entries are in map order. */
  const previewOf = (pixels: Uint32Array): PreviewSource => ({
    width: params.side,
    pixels,
    factions: numbering.factions.map((f) => (f.color === undefined ? { id: f.id } : { id: f.id, color: f.color })),
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

  // Pixel steps: the sea (gap fill between the isolation and the zones), the minimum piece, the cleanup.
  const landCount = numbering.land.length;
  const zones: SeaZone[] = numbering.sea.map((s) => (s.seed === undefined ? { id: s.id } : { id: s.id, seed: curation.seas[s.seed]! }));
  const fill = params.gapFill === undefined ? undefined : makeGapFill(params.side, params.gapFill, (value) => value >= 1 && value <= landCount);
  const water = assignSea({ views: views.value, pixels: raster.value, zones, ...(fill === undefined ? {} : { between: fill.between }) });
  if (!water.ok) return { ok: false, stage: 'pixels', errors: water.errors, preview: previewOf(raster.value) };

  const territories: TerritoryInfo[] = [
    ...numbering.land.map((l) => ({ id: l.id, key: l.territory.key, name: l.territory.name ?? '' })),
    ...numbering.sea.flatMap((s) => (s.territory === undefined ? [] : [{ id: s.id, key: s.territory.key, name: s.territory.name ?? '' }])),
  ];
  const cleaned = cleanPieces(params.side, water.value.pixels, numbering.pieceEntries, territories, params.minPieceSize);
  if (!cleaned.ok) return { ok: false, stage: 'pixels', errors: cleaned.errors, preview: previewOf(water.value.pixels) };
  const pixels = cleaned.value.pixels;

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
      enclosed: water.value.enclosed,
      reassigned: cleaned.value.reassigned,
    },
    preview: previewOf(pixels),
  };
}
