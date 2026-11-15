import { compareCodeUnits } from './errors';
import type { Frame, ProjectionCenter } from './projection';
import type { Reassignment } from './pieces';
import type { EnclosedSet } from './sea';

/** FR-124: the facts of a successful build the report lists. */
export interface ReportFacts {
  version: string;
  width: number;
  height: number;
  center: ProjectionCenter;
  frame: Frame;
  factions: number;
  landTerritories: number;
  seaZones: number;
  /** Size of the smallest piece in the final id image (after FR-117). */
  smallestPiece: number;
  reassigned: readonly Reassignment[];
  excluded: readonly string[];
  /** Every map entry with more than one piece, with its piece count. */
  multiPiece: readonly { entry: number; pieces: number }[];
  /** FR-165: enclosed water joined to sea zones while assigning (before the FR-117 cleanup). */
  enclosed: { sets: number; pixels: number; zones: readonly { zone: number; sets: number; pixels: number }[] };
}

/**
 * FR-124: the deterministic build report, English `label: value` lines; each list has a count line
 * followed by one indented `- item` line per item. Numbers are written with `String(n)`. Excluded
 * provinces are listed once each, in code-unit order. Ends with a line break.
 */
export function formatReport(facts: ReportFacts): string {
  const excluded = [...new Set(facts.excluded)].sort(compareCodeUnits);
  const lines = [
    `sourceVersion: ${facts.version}`,
    `width: ${facts.width}`,
    `height: ${facts.height}`,
    `projectionCenter: lon=${facts.center.lon0} lat=${facts.center.lat0}`,
    `frame: west=${facts.frame.west} north=${facts.frame.north} side=${facts.frame.side}`,
    `factions: ${facts.factions}`,
    `landTerritories: ${facts.landTerritories}`,
    `seaZones: ${facts.seaZones}`,
    `smallestPiece: ${facts.smallestPiece}`,
    `reassignedPieces: ${facts.reassigned.length}`,
    ...facts.reassigned.map(
      (r) => `  - entry=${r.entry} pixels=${r.pixels} to=${r.to === 0 ? 'background' : String(r.to)}`,
    ),
    `excludedProvinces: ${excluded.length}`,
    ...excluded.map((code) => `  - ${code}`),
    `multiPieceEntries: ${facts.multiPiece.length}`,
    ...facts.multiPiece.map((m) => `  - entry=${m.entry} pieces=${m.pieces}`),
    `enclosedWaterSets: ${facts.enclosed.sets}`,
    `enclosedWaterPixels: ${facts.enclosed.pixels}`,
    `enclosedWaterZones: ${facts.enclosed.zones.length}`,
    ...facts.enclosed.zones.map((z) => `  - zone=${z.zone} sets=${z.sets} pixels=${z.pixels}`),
  ];
  return lines.join('\n') + '\n';
}

/** FR-165: totals of the enclosed water sets and, per zone that received some, its sets and pixels (ascending zone id). */
export function summariseEnclosed(enclosed: readonly EnclosedSet[]): ReportFacts['enclosed'] {
  const perZone = new Map<number, { sets: number; pixels: number }>();
  let pixels = 0;
  for (const set of enclosed) {
    pixels += set.pixels;
    const entry = perZone.get(set.zone) ?? { sets: 0, pixels: 0 };
    entry.sets++;
    entry.pixels += set.pixels;
    perZone.set(set.zone, entry);
  }
  return {
    sets: enclosed.length,
    pixels,
    zones: [...perZone].sort((a, b) => a[0] - b[0]).map(([zone, v]) => ({ zone, ...v })),
  };
}
