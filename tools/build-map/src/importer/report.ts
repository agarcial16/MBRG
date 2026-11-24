import { entryKind, factionOrder, isValidColor } from '@mbrg/shared';
import type { FactionId, MapData, MapEntry, Rgb } from '@mbrg/shared';
import { labelPieces, type Reassignment } from '../core/pieces';
import { summariseEnclosed } from '../core/report';
import type { EnclosedSet } from '../core/sea';
import type { BuiltPresentation } from '../core/types';
import type { CurationPlan } from './check-curation';
import { thinCoastFactions } from './coast-check';
import type { FilledSet } from './gap-fill';
import type { Bridge } from './exclave';
import type { ImportNumbering } from './numbering';
import type { LakeSet } from './sea-sources';
import type { TilingDetails } from './tiling-step';
import type { ViewSet } from './views';

/**
 * The 16-bit owner table of the viewer holds a faction index in two bytes, so at most this many factions draw
 * (`MAX_FACTIONS` in `apps/web/src/core/entries.ts`, spec 033 FR-640). Kept local: `tools/build-map` never
 * depends on `apps/web`.
 */
const MAX_FACTIONS = 0xffff;

/**
 * The 20 curated base palette colors of the viewer's assignment (004 FR-141, spec 033 FR-641), in assignment
 * order, as literals. Mirrors `PALETTE` in `apps/web/src/core/theme.ts` (the original 12 first, then the 8
 * Spec 031-aligned colors); the procedural last resort of `apps/web/src/core/palette.ts` is modelled by
 * `paletteExhaustedFaction`. Kept local: `tools/build-map` never depends on `apps/web`.
 */
const PALETTE: readonly Rgb[] = [
  [0xc0, 0x50, 0x4d],
  [0xe8, 0xb0, 0x4b],
  [0x6a, 0xa8, 0x4f],
  [0x8e, 0x6b, 0xbf],
  [0xe0, 0x7b, 0x39],
  [0x4b, 0xb3, 0xa7],
  [0xd1, 0x6f, 0xa6],
  [0xa3, 0xc2, 0x4a],
  [0x8b, 0x5a, 0x3c],
  [0xf2, 0xd6, 0x5c],
  [0xc9, 0x8f, 0xd6],
  [0xd4, 0xa3, 0x73],
  // Spec 033 FR-641: 8 additional curated cartographic colors
  [0x2e, 0x85, 0x6e],
  [0xe6, 0x7e, 0x88],
  [0x4d, 0x60, 0xad],
  [0x9e, 0x43, 0x6d],
  [0x82, 0xc9, 0xa0],
  [0x76, 0x85, 0x32],
  [0xc4, 0x96, 0x2c],
  [0x5f, 0x52, 0x96],
];

const sameColor = (a: Rgb, b: Rgb): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

function parseColor(text: string): Rgb {
  return [parseInt(text.slice(1, 3), 16), parseInt(text.slice(3, 5), 16), parseInt(text.slice(5, 7), 16)];
}

/**
 * The direct candidates of every faction at round 0, the copy of 004 FR-75/FR-76 the viewer's color assignment
 * builds: factions owning a land neighbour, and factions owning land that touches a sea zone shared with it.
 * A faction is never its own candidate.
 */
function directCandidates(map: MapData): Map<FactionId, Set<FactionId>> {
  const entryById = new Map<number, MapEntry>(map.territories.map((t) => [t.id, t]));
  const isSea = (e: MapEntry): boolean => entryKind(e) === 'sea';
  const linked = (a: MapEntry, b: MapEntry): boolean =>
    a.id !== b.id && a.neighbors.includes(b.id) && b.neighbors.includes(a.id);
  const ownerOfEntry = (e: MapEntry): FactionId | undefined => (isSea(e) ? undefined : (e as { owner: FactionId }).owner);

  const result = new Map<FactionId, Set<FactionId>>();
  for (const f of factionOrder(map)) result.set(f, new Set());
  const link = (a: FactionId, b: FactionId): void => {
    if (a === b) return;
    result.get(a)?.add(b);
    result.get(b)?.add(a);
  };

  for (const t of map.territories) {
    const owner = ownerOfEntry(t);
    if (owner === undefined) continue;
    for (const n of t.neighbors) {
      const m = entryById.get(n);
      if (m === undefined || !linked(t, m)) continue;
      const other = ownerOfEntry(m);
      if (other !== undefined) link(owner, other);
    }
  }
  for (const z of map.territories) {
    if (!isSea(z)) continue;
    const around = new Set<FactionId>();
    for (const n of z.neighbors) {
      const m = entryById.get(n);
      if (m === undefined || !linked(z, m)) continue;
      const owner = ownerOfEntry(m);
      if (owner !== undefined) around.add(owner);
    }
    for (const a of around) for (const b of around) link(a, b);
  }
  return result;
}

/** The land neighbours of every faction at round 0, strict in both directions (004 FR-75). */
function landNeighbours(map: MapData): Map<FactionId, Set<FactionId>> {
  const entryById = new Map<number, MapEntry>(map.territories.map((t) => [t.id, t]));
  const result = new Map<FactionId, Set<FactionId>>();
  for (const f of factionOrder(map)) result.set(f, new Set());
  for (const t of map.territories) {
    if (entryKind(t) !== 'land') continue;
    const owner = (t as { owner: FactionId }).owner;
    for (const n of t.neighbors) {
      const m = entryById.get(n);
      if (m === undefined || entryKind(m) !== 'land') continue;
      if (!t.neighbors.includes(m.id) || !m.neighbors.includes(t.id)) continue;
      const other = (m as { owner: FactionId }).owner;
      if (other === owner) continue;
      result.get(owner)?.add(other);
      result.get(other)?.add(owner);
    }
  }
  return result;
}

/**
 * FR-607 / spec 033 FR-646: the first faction, in faction order, whose color assignment by the viewer's rule
 * (004 FR-141, spec 033 FR-641 to FR-643) fails, its id; undefined when every faction gets a color.
 *
 * The shipped viewer theme enables the procedural last resort (`THEME.procedural` in
 * `apps/web/src/core/theme.ts`), whose palette supplies at least 65,535 distinct colors
 * (`apps/web/src/core/palette.ts`): every importable map is colored without exhaustion, so with `procedural`
 * (the default) this returns undefined and the report emits no `paletteExhaustedFaction` warning. Only a custom
 * finite theme without that fallback (`procedural: false`) can exhaust the 20 curated colors; steps (1) the
 * first palette color used by no colored faction and equal to no preferred color, (2) the first palette color
 * used by none of the faction's already colored direct candidates (land + sea), (3) the first palette color
 * unused by any land neighbour and used by fewest direct candidates; else the faction fails.
 * Pure: the inputs are the map and the presentation data only.
 */
export function paletteExhaustedFaction(
  map: MapData,
  presentation: BuiltPresentation,
  options: { procedural?: boolean } = {},
): FactionId | undefined {
  // The procedural last resort colors any valid map up to 65,535 factions (FR-642/FR-643).
  if (options.procedural ?? true) return undefined;

  const order = factionOrder(map);
  const preferred = new Map<FactionId, Rgb>();
  for (const f of presentation.factions) {
    if (isValidColor(f.color)) preferred.set(f.id, parseColor(f.color));
  }
  const candidates = directCandidates(map);
  const land = landNeighbours(map);
  const colors = new Map<FactionId, Rgb>();
  for (const f of order) {
    const own = preferred.get(f);
    if (own !== undefined) colors.set(f, own);
  }
  const preferredList = [...preferred.values()];
  const assigned: Rgb[] = [];

  for (const f of order) {
    if (preferred.has(f)) continue;
    const nearColors = [...(candidates.get(f) ?? [])].flatMap((g) => {
      const c = colors.get(g);
      return c === undefined ? [] : [c];
    });
    let pick = PALETTE.find((c) => !assigned.some((u) => sameColor(u, c)) && !preferredList.some((p) => sameColor(p, c)));
    if (pick === undefined) pick = PALETTE.find((c) => !nearColors.some((u) => sameColor(u, c)));
    if (pick === undefined) {
      // Step 3: relax sea-only adjacency; land neighbours stay strict.
      const landColors = [...(land.get(f) ?? [])].flatMap((g) => {
        const c = colors.get(g);
        return c === undefined ? [] : [c];
      });
      let fewest = Number.POSITIVE_INFINITY;
      for (const c of PALETTE) {
        if (landColors.some((u) => sameColor(u, c))) continue;
        const count = nearColors.filter((u) => sameColor(u, c)).length;
        if (count < fewest) {
          fewest = count;
          pick = c;
        }
      }
    }
    if (pick === undefined) return f;
    colors.set(f, pick);
    assigned.push(pick);
  }
  return undefined;
}

/** FR-597, FR-609: every faction whose land territories form more than one group over land links, in faction order. */
export function splitFactions(map: MapData): { id: FactionId; groups: number }[] {
  const order = factionOrder(map);
  const land = map.territories.filter((t) => entryKind(t) === 'land') as (MapEntry & { owner: FactionId })[];
  const byId = new Map<number, MapEntry>(map.territories.map((t) => [t.id, t]));
  const split: { id: FactionId; groups: number }[] = [];
  for (const faction of order) {
    const own = land.filter((t) => t.owner === faction);
    const seen = new Set<number>();
    let groups = 0;
    for (const start of own) {
      if (seen.has(start.id)) continue;
      groups++;
      const stack = [start.id];
      seen.add(start.id);
      while (stack.length > 0) {
        const id = stack.pop()!;
        const entry = byId.get(id);
        if (entry === undefined) continue;
        for (const n of entry.neighbors) {
          if (seen.has(n)) continue;
          const other = byId.get(n);
          if (other === undefined || entryKind(other) !== 'land' || (other as { owner: FactionId }).owner !== faction) continue;
          seen.add(n);
          stack.push(n);
        }
      }
    }
    if (groups > 1) split.push({ id: faction, groups });
  }
  return split;
}

/** One warning of the viewer-limits section (FR-607): a limit today's viewer exceeds, never an import error. */
export type ViewerWarning =
  | { kind: 'textureAbove2048'; size: number }
  | { kind: 'entriesAbove65535'; entries: number }
  | { kind: 'factionsAbove65535'; factions: number }
  | { kind: 'paletteExhaustedFaction'; faction: string };

/** The ids and keys of the factions, in faction order (the report names a faction by its key). */
export interface ReportFaction {
  id: number;
  key: string;
}

/**
 * FR-607 / spec 033 FR-646: the viewer-limits section. `requiredTextureSize` is max(width, height, entries + 1),
 * the texture size today's viewer needs to draw the map (004 FR-135 as built); reported, never a gate. The warnings
 * name each viewer limit the package exceeds: a required size above the 2,048 WebGL 2 guarantees, more than 65,535
 * entries (two-byte entry index), more than 65,535 factions (two-byte owner table), and the first faction whose
 * color assignment fails (only a custom finite theme can fail it; the shipped theme's procedural last resort
 * colors every valid map).
 */
export function viewerLimits(
  map: MapData,
  presentation: BuiltPresentation,
  width: number,
  height: number,
  entries: number,
  factions: readonly ReportFaction[],
): { requiredTextureSize: number; warnings: ViewerWarning[] } {
  const requiredTextureSize = Math.max(width, height, entries + 1);
  const warnings: ViewerWarning[] = [];
  if (requiredTextureSize > 2048) warnings.push({ kind: 'textureAbove2048', size: requiredTextureSize });
  if (entries > 65535) warnings.push({ kind: 'entriesAbove65535', entries });
  if (factions.length > MAX_FACTIONS) warnings.push({ kind: 'factionsAbove65535', factions: factions.length });
  const exhausted = paletteExhaustedFaction(map, presentation);
  if (exhausted !== undefined) {
    const key = factions.find((f) => f.id === exhausted)?.key ?? String(exhausted);
    warnings.push({ kind: 'paletteExhaustedFaction', faction: key });
  }
  return { requiredTextureSize, warnings };
}

/** The digests and counts of one source, as the report prints them (FR-609). */
export interface ReportSource {
  file: string;
  sha256: string;
  features: number;
  skippedNull: number;
}

/** What the import report needs of the import facts (the shape of the `ImportDetails` the core returns). */
export interface ImportReportDetails {
  curation: CurationPlan;
  views: ViewSet;
  numbering: ImportNumbering;
  reassigned: readonly Reassignment[];
  filled: readonly FilledSet[];
  contextGap: number;
  contextGapPixels: number;
  bridges: readonly Bridge[];
  enclosed: readonly EnclosedSet[];
  enclosedReach: number;
  lakes: readonly LakeSet[];
  /** Spec 035, FR-686: present when tiling ran. */
  tiling?: TilingDetails;
}

/** What the import report takes: the digests (the CLI holds the bytes), the import facts and the final map. */
export interface ImportReportInput {
  curation: { file: string; sha256: string };
  sources: readonly ReportSource[];
  details: ImportReportDetails;
  map: MapData;
  presentation: BuiltPresentation;
  width: number;
  pixels: Uint32Array;
  /** FR-686: the names file of the tiling, when one was read. */
  names?: { file: string; sha256: string };
}

/**
 * FR-609: the deterministic import report, English `label: value` lines in the builder's style; each list has a
 * count line followed by one indented `- item` line per item, numbers with `String(n)`. Ends with a line break.
 * The viewer-limits section (FR-607) never fails an import.
 */
export function formatImportReport(input: ImportReportInput): string {
  const { details } = input;
  const { views, numbering } = details;
  const main = views.main;
  const lines: string[] = [
    `curation: ${input.curation.file}`,
    `curationSha256: ${input.curation.sha256}`,
    `sources: ${input.sources.length}`,
    ...input.sources.map((s) => `  - file=${s.file} sha256=${s.sha256} features=${s.features} skippedNullGeometries=${s.skippedNull}`),
    `featuresRead: ${input.sources.reduce((n, s) => n + s.features, 0)}`,
    `skippedNullGeometries: ${input.sources.reduce((n, s) => n + s.skippedNull, 0)}`,
    `units: ${details.curation.units.length}`,
    `selectedUnits: ${details.curation.selection.selected.length}`,
    `noOwnerUnits: ${details.curation.selection.noOwner.length}`,
    ...details.curation.selection.noOwner.map((key) => `  - unit=${key}`),
    `multiFeatureUnits: ${details.curation.units.filter((u) => u.features.length > 1).length}`,
    `projection: ${main.projection}`,
    `projectionCenter: lon=${main.lon0} lat=${main.lat0}`,
    `frame: west=${main.frame.west} north=${main.frame.north} side=${main.frame.side}`,
    `pixelSideKm: ${(main.frame.side / input.width) * 6371}`,
    `insets: ${views.insets.length}`,
    ...views.insets.map((inset) => `  - inset=${inset.index} x=${inset.rect.x} y=${inset.rect.y} w=${inset.rect.w} h=${inset.rect.h}`),
    `factions: ${numbering.factions.length}`,
    `landTerritories: ${numbering.land.length}`,
    `multiUnitTerritories: ${details.curation.territories.filter((t) => t.units.length > 1).length}`,
    `seaZones: ${numbering.sea.length}`,
  ];

  const entries = numbering.land.length + numbering.sea.length;
  const limits = viewerLimits(input.map, input.presentation, input.width, input.width, entries, numbering.factions);
  lines.push('viewerLimits:');
  lines.push(`  requiredTextureSize: ${limits.requiredTextureSize}`);
  lines.push(`  warnings: ${limits.warnings.length}`);
  const warningLine = (w: ViewerWarning): string => {
    switch (w.kind) {
      case 'textureAbove2048':
        return `    - textureAbove2048=${w.size}`;
      case 'entriesAbove65535':
        return `    - entriesAbove65535=${w.entries}`;
      case 'factionsAbove65535':
        return `    - factionsAbove65535=${w.factions}`;
      case 'paletteExhaustedFaction':
        return `    - paletteExhaustedFaction=${w.faction}`;
    }
  };
  lines.push(...limits.warnings.map(warningLine));

  // the piece facts from the final id image, as the builder's report takes them (FR-124 style)
  const { pieces } = labelPieces(input.width, input.pixels);
  const pieceCount = new Map<number, number>();
  let smallestPiece = Infinity;
  for (const piece of pieces) {
    pieceCount.set(piece.value, (pieceCount.get(piece.value) ?? 0) + 1);
    if (piece.size < smallestPiece) smallestPiece = piece.size;
  }
  lines.push(`smallestPiece: ${smallestPiece}`);
  lines.push(`reassignedPieces: ${details.reassigned.length}`);
  lines.push(...details.reassigned.map((r) => `  - entry=${r.entry} pixels=${r.pixels} to=${r.to === 0 ? 'background' : String(r.to)}`));
  lines.push(`gapFilledSets: ${details.filled.length}`);
  lines.push(...details.filled.map((s) => `  - pixels=${s.pixels} territory=${s.territory}`));
  lines.push(`contextGap: ${details.contextGap}`);
  lines.push(`contextGapPixels: ${details.contextGapPixels}`);
  lines.push(`exclaveBridges: ${details.bridges.length}`);
  lines.push(...details.bridges.map((b) => `  - from=${b.from} to=${b.to} pixels=${b.pixels} water=${b.water} distance=${b.distance}`));
  // factions whose every sea contact is thin water (a sliver that links an inland territory to a zone)
  const owner = new Map(input.map.territories.flatMap((t): [number, number][] => ('owner' in t ? [[t.id, t.owner]] : [])));
  const thinCoast = thinCoastFactions({
    width: input.width,
    pixels: input.pixels,
    owner,
    seaIds: new Set(input.map.territories.filter((t) => 'kind' in t && t.kind === 'sea').map((t) => t.id)),
    radius: Math.floor(details.contextGap / 2),
  });
  lines.push(`thinCoastFactions: ${thinCoast.length}`);
  lines.push(...thinCoast.map((c) => `  - faction=${numbering.factions.find((f) => f.id === c.faction)?.key ?? String(c.faction)} territories=${c.territories.join(',')} pixels=${c.pixels}`));
  const enclosed = summariseEnclosed([...details.enclosed]);
  lines.push(`enclosedWaterSets: ${enclosed.sets}`);
  lines.push(`enclosedWaterPixels: ${enclosed.pixels}`);
  lines.push(`enclosedWaterZones: ${enclosed.zones.length}`);
  lines.push(...enclosed.zones.map((z) => `  - zone=${z.zone} sets=${z.sets} pixels=${z.pixels}`));
  lines.push(`enclosedReach: ${details.enclosedReach}`);
  lines.push(`enclosedLakes: ${details.lakes.length}`);
  lines.push(...details.lakes.map((l) => `  - pixels=${l.pixels} x=${l.x} y=${l.y}`));
  const multiPiece = [...pieceCount].filter(([, n]) => n > 1).sort((a, b) => a[0] - b[0]).map(([entry, pieces]) => ({ entry, pieces }));
  lines.push(`multiPieceEntries: ${multiPiece.length}`);
  lines.push(...multiPiece.map((m) => `  - entry=${m.entry} pieces=${m.pieces}`));
  const split = splitFactions(input.map);
  lines.push(`splitFactions: ${split.length}`);
  lines.push(...split.map((s) => `  - faction=${numbering.factions.find((f) => f.id === s.id)?.key ?? String(s.id)} groups=${s.groups}`));
  if (details.tiling !== undefined) lines.push(...tilingLines(details.tiling, input));
  return lines.join('\n') + '\n';
}

/** FR-686: the most factions that touch one sea entry through a link (a tile, or a zone of a map without tiling). */
export function maxFactionsPerSea(map: MapData): number {
  const owner = new Map(map.territories.flatMap((t): [number, number][] => ('owner' in t ? [[t.id, t.owner]] : [])));
  let most = 0;
  for (const t of map.territories) {
    if (!('kind' in t) || t.kind !== 'sea') continue;
    const around = new Set<number>();
    for (const n of t.neighbors) {
      const o = owner.get(n);
      if (o !== undefined) around.add(o);
    }
    if (around.size > most) most = around.size;
  }
  return most;
}

/** FR-686, FR-687: the tiling section of the report. */
function tilingLines(tiling: TilingDetails, input: ImportReportInput): string[] {
  const px = (km: number): string => String(Math.round((km / tiling.pixelKm) * 100) / 100);
  const config = tiling.config;
  return [
    'tiling: on',
    `  tileKm: ${config.tileKm} (pixels=${px(config.tileKm)})`,
    `  openTileKm: ${config.openKm} (pixels=${px(config.openKm)})`,
    `  farTileKm: ${config.farKm} (pixels=${px(config.farKm)})`,
    `  coastBandKm: ${config.bandKm} (pixels=${px(config.bandKm)})`,
    `  reachKm: ${config.reachKm} (pixels=${px(config.reachKm)})`,
    ...(tiling.targetTiles === undefined ? [] : [`  targetTiles: ${tiling.targetTiles}`]),
    `  seeds: ${tiling.seeds}`,
    `  tiles: ${tiling.tiles}`,
    `  basins: ${tiling.basins.length}`,
    ...tiling.basins.map((b) => `    - name=${b.name} pixels=${b.pixels} km2=${Math.round(b.km2)} pieces=${b.pieces} tiles=${b.tiles}`),
    `  tileAreaKm2: min=${Math.round(tiling.area.min)} median=${Math.round(tiling.area.median)} max=${Math.round(tiling.area.max)}`,
    `  maxFactionsPerTile: ${maxFactionsPerSea(input.map)}`,
    `  mergedTiles: ${tiling.merged.length}`,
    ...tiling.merged.map((m) => `    - basin=${m.basin} pixels=${m.pixels}`),
    `  namedFromFile: ${tiling.named}`,
    `  namedFromBasin: ${tiling.fallback}`,
    `  skippedNamePolygons: ${tiling.skippedNamePolygons.length}`,
    ...(input.names === undefined ? [] : [`  namesFile: file=${input.names.file} sha256=${input.names.sha256}`]),
  ];
}
