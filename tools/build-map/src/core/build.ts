import type { PresentationData } from '@mbrg/shared';
import { buildMapData } from './adjacency';
import { checkGrouping } from './grouping';
import { own } from './errors';
import { formatJson } from './json';
import { numberEntries } from './numbering';
import { cleanupPieces, labelPieces } from './pieces';
import { toRgb } from './png-check';
import { buildPresentation } from './presentation';
import { frameFor, project, projectionCenter, toPixel } from './projection';
import { rasterize, type RasterLayer } from './rasterize';
import { toPixelPolygons } from './rings';
import { formatReport, summariseEnclosed } from './report';
import { assignSeaZonesDetailed, seedPixels } from './sea';
import { selfCheck } from './self-check';
import type {
  BuildInputs,
  BuildOutcome,
  PngCodec,
  PreviewEntry,
  PreviewSource,
  SourceFeature,
} from './types';

/**
 * FR-112..FR-126: the whole build from in-memory inputs to in-memory outputs. The PNG codec is a
 * parameter so this stays free of files, clock and randomness (NFR-14); it takes no seed or round
 * (FR-112). Steps: grouping check, numbering, projection and frame, rasterization, sea seeds and
 * sea zones, piece cleanup, map data, presentation data, PNG, self-check, JSON and report.
 * A failure carries a preview only when it happens after rasterization (FR-123).
 */
export function buildInMemory(inputs: BuildInputs, codec: PngCodec): BuildOutcome {
  const grouping = checkGrouping(inputs.grouping, inputs.provinces, inputs.countries);
  if (grouping.length > 0) return { ok: false, errors: grouping };

  const plan = numberEntries(inputs.grouping, inputs.seeds);
  const { width, margin, minPieceSize } = inputs.params;

  // Source provinces by province code (the first feature of a code, as the presentation uses).
  const byCode = new Map<string, SourceFeature>();
  for (const feature of inputs.provinces) {
    const code = own(feature.props, 'adm1_code');
    if (typeof code === 'string' && !byCode.has(code)) byCode.set(code, feature);
  }
  const featuresOf = (codes: readonly string[]): SourceFeature[] =>
    codes.flatMap((code) => {
      const feature = byCode.get(code);
      return feature === undefined ? [] : [feature];
    });
  const landFeatures = plan.land.map((land) => featuresOf(land.provinces));

  // FR-114: projection centre and frame from the vertices of the non-excluded provinces.
  const vertices: [number, number][] = [];
  for (const features of landFeatures) {
    for (const feature of features) {
      for (const polygon of feature.polygons) {
        vertices.push(...polygon.outer.coords);
        for (const hole of polygon.holes) vertices.push(...hole.coords);
      }
    }
  }
  const center = projectionCenter(vertices);
  const frame = frameFor(
    vertices.map(([lon, lat]) => project(center, lon, lat)),
    margin,
  );
  const toUV = (lon: number, lat: number): [number, number] => {
    const [px, py] = project(center, lon, lat);
    const at = toPixel(frame, width, px, py);
    return [at.u, at.v];
  };

  // FR-115: land territories in map order, then other land (other land and excluded provinces).
  const layers: RasterLayer[] = plan.land.map((land, i) => ({
    value: land.id,
    polygons: toPixelPolygons(landFeatures[i]!, toUV),
  }));
  layers.push({
    value: 0,
    polygons: toPixelPolygons([...inputs.otherLand, ...featuresOf(inputs.grouping.excluded)], toUV),
  });
  const rasterized = rasterize(width, layers);

  const entries: PreviewEntry[] = [
    ...plan.land.map((land): PreviewEntry => ({ id: land.id, kind: 'land', owner: land.owner })),
    ...plan.sea.map((sea): PreviewEntry => ({ id: sea.id, kind: 'sea' })),
  ];
  const previewOf = (pixels: Uint32Array): PreviewSource => ({
    width,
    pixels,
    factions: plan.factions.map((f) => (f.color === undefined ? { id: f.id } : { id: f.id, color: f.color })),
    entries,
  });

  // FR-116: sea zones.
  const seeds = seedPixels(inputs.seeds, center, frame, width, rasterized);
  if (!seeds.ok) return { ok: false, errors: seeds.errors, preview: previewOf(rasterized) };
  const { pixels: assigned, enclosed } = assignSeaZonesDetailed(width, rasterized, seeds.value, plan.sea.map((s) => s.id));

  // FR-117: pieces smaller than S.
  const cleaned = cleanupPieces(width, assigned, entries, minPieceSize);
  if (!cleaned.ok) return { ok: false, errors: cleaned.errors, preview: previewOf(assigned) };
  const pixels = cleaned.value.pixels;

  // FR-118, FR-121, FR-105, FR-122.
  const map = buildMapData(width, pixels, plan);
  const presentation = buildPresentation(plan, inputs.countries, inputs.provinces);
  const png = codec.encode(width, width, toRgb(pixels));
  const errors = selfCheck(map, presentation, width, pixels, png, codec);
  if (errors.length > 0) return { ok: false, errors, preview: previewOf(pixels) };

  // FR-124: the report facts from the final id image.
  const { pieces } = labelPieces(width, pixels);
  const pieceCount = new Map<number, number>();
  let smallestPiece = Infinity;
  for (const piece of pieces) {
    pieceCount.set(piece.value, (pieceCount.get(piece.value) ?? 0) + 1);
    if (piece.size < smallestPiece) smallestPiece = piece.size;
  }
  const report = formatReport({
    version: inputs.meta.version,
    width,
    height: width,
    center,
    frame,
    factions: plan.factions.length,
    landTerritories: plan.land.length,
    seaZones: plan.sea.length,
    smallestPiece,
    reassigned: cleaned.value.reassigned,
    excluded: inputs.grouping.excluded,
    multiPiece: [...pieceCount]
      .filter(([, n]) => n > 1)
      .sort((a, b) => a[0] - b[0])
      .map(([entry, n]) => ({ entry, pieces: n })),
    enclosed: summariseEnclosed(enclosed),
  });

  return {
    ok: true,
    map,
    presentation: presentation as PresentationData,
    pixels,
    width,
    files: { map: formatJson(map), presentation: formatJson(presentation), image: png },
    report,
    preview: previewOf(pixels),
  };
}
