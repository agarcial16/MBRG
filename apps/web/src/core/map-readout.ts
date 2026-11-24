// Always-on map hover/tap full-name readout (spec 032 FR-625, FR-627). Pure, ASCII-only.
import type { FactionId, PresentationData, TerritoryId } from '@mbrg/shared';
import type { MapPoint } from './camera';
import type { EntryIndex } from './entries';

export interface MapReadout {
  readonly territory: string;
  readonly faction: string;
}

/**
 * Resolves the full territory name and full owning faction name at a map coordinate.
 * Returns undefined outside the map, on background/sea, when owners are missing, or while a reveal hides state.
 */
export function mapReadout(
  index: EntryIndex,
  owners: ReadonlyMap<TerritoryId, FactionId> | undefined,
  presentation: PresentationData,
  point: MapPoint,
  hidden = false,
): MapReadout | undefined {
  if (hidden || owners === undefined) return undefined;
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= index.width || y >= index.height) return undefined;
  const entry = index.cells[y * index.width + x]!;
  if (entry <= 0 || index.fills[entry] !== 'land') return undefined;
  const territoryId = index.ids[entry]!;
  const factionId = owners.get(territoryId);
  if (factionId === undefined) return undefined;
  const territory = presentation.territories.find((t) => t.id === territoryId)?.name ?? String(territoryId);
  const faction = presentation.factions.find((f) => f.id === factionId)?.name ?? String(factionId);
  return { territory, faction };
}
