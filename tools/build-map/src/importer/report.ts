import { entryKind, factionOrder, isValidColor } from '@mbrg/shared';
import type { FactionId, MapData, MapEntry, Rgb } from '@mbrg/shared';
import { labelPieces, type Reassignment } from '../core/pieces';
import { summariseEnclosed } from '../core/report';
import type { EnclosedSet } from '../core/sea';
import type { BuiltPresentation } from '../core/types';
import type { CurationPlan } from './check-curation';
import type { FilledSet } from './gap-fill';
import type { ImportNumbering } from './numbering';
import type { ViewSet } from './views';

/**
 * The 12 palette colors of the viewer's assignment (004 FR-141), in assignment order, as literals. PD5 retracted:
 * the viewer's own `PALETTE` stays untouched in `apps/web`; this is the importer-local copy FR-607 computes with,
 * pinned by importer fixtures, and the viewer's own tests still pin the viewer.
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

/**
 * FR-607: the first faction, in faction order, whose color assignment by the viewer's rule (004 FR-141, with the
 * palette above) fails, its id; undefined when every faction gets a color. The same two-step rule as the viewer:
 * step (1) the first palette color used by no colored faction and equal to no preferred color of the map, step
 * (2) the first palette color used by none of the faction's already colored direct candidates; else the faction
 * fails. Pure: the inputs are the map and the presentation data only.
 */
export function paletteExhaustedFaction(map: MapData, presentation: BuiltPresentation): FactionId | undefined {
  const order = factionOrder(map);
  const preferred = new Map<FactionId, Rgb>();
  for (const f of presentation.factions) {
    if (isValidColor(f.color)) preferred.set(f.id, parseColor(f.color));
  }
  const candidates = directCandidates(map);
  const colors = new Map<FactionId, Rgb>();
  for (const f of order) {
    const own = preferred.get(f);
    if (own !== undefined) colors.set(f, own);
  }
  const preferredList = [...preferred.values()];
  const assigned: Rgb[] = [];

  for (const f of order) {
    if (preferred.has(f)) continue;
    let pick = PALETTE.find((c) => !assigned.some((u) => sameColor(u, c)) && !preferredList.some((p) => sameColor(p, c)));
    if (pick === undefined) {
      const nearColors = [...(candidates.get(f) ?? [])].flatMap((g) => {
        const c = colors.get(g);
        return c === undefined ? [] : [c];
      });
      pick = PALETTE.find((c) => !nearColors.some((u) => sameColor(u, c)));
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
  | { kind: 'factionsAbove255'; factions: number }
  | { kind: 'paletteExhaustedFaction'; faction: string };

/** The ids and keys of the factions, in faction order (the report names a faction by its key). */
export interface ReportFaction {
  id: number;
  key: string;
}

/**
 * FR-607: the viewer-limits section. `requiredTextureSize` is max(width, height, entries + 1), the texture size
 * today's viewer needs to draw the map (004 FR-135 as built); reported, never a gate. The warnings name each viewer
 * limit the package exceeds: a required size above the 2,048 WebGL 2 guarantees, more than 65,535 entries (two-byte
 * entry index), more than 255 factions (one-byte owner table), and the first faction whose color assignment fails.
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
  if (factions.length > 255) warnings.push({ kind: 'factionsAbove255', factions: factions.length });
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
  enclosed: readonly EnclosedSet[];
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
      case 'factionsAbove255':
        return `    - factionsAbove255=${w.factions}`;
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
  const enclosed = summariseEnclosed([...details.enclosed]);
  lines.push(`enclosedWaterSets: ${enclosed.sets}`);
  lines.push(`enclosedWaterPixels: ${enclosed.pixels}`);
  lines.push(`enclosedWaterZones: ${enclosed.zones.length}`);
  lines.push(...enclosed.zones.map((z) => `  - zone=${z.zone} sets=${z.sets} pixels=${z.pixels}`));
  const multiPiece = [...pieceCount].filter(([, n]) => n > 1).sort((a, b) => a[0] - b[0]).map(([entry, pieces]) => ({ entry, pieces }));
  lines.push(`multiPieceEntries: ${multiPiece.length}`);
  lines.push(...multiPiece.map((m) => `  - entry=${m.entry} pieces=${m.pieces}`));
  const split = splitFactions(input.map);
  lines.push(`splitFactions: ${split.length}`);
  lines.push(...split.map((s) => `  - faction=${numbering.factions.find((f) => f.id === s.id)?.key ?? String(s.id)} groups=${s.groups}`));
  return lines.join('\n') + '\n';
}
