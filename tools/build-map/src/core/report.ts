import { compareCodeUnits } from './errors';
import type { Frame, ProjectionCenter } from './projection';
import type { Reassignment } from './pieces';

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
  ];
  return lines.join('\n') + '\n';
}
