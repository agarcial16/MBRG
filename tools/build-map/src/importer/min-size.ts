import type { Result } from '@mbrg/shared';
import { cleanupPieces, labelPieces, type CleanupError, type CleanupResult, type PieceEntry } from '../core/pieces';

/** A land or sea territory of the map, in map order, as the minimum-piece check names it. */
export interface TerritoryInfo {
  id: number;
  key: string;
  name: string;
}

/** FR-604: a territory with no piece of S pixels or more. */
export interface BelowMinSize {
  kind: 'territory-below-min-size';
  territory: string;
  name: string;
  /** All its pixels. */
  pixels: number;
  /** The size of its largest piece. */
  largest: number;
}

/**
 * FR-604: every land territory and sea territory (in map order) that has no piece of `minPieceSize` pixels or more,
 * one error each, all at once, before any cleanup: its key, its name, its pixel count and the size of its largest piece.
 * A territory with no pixel at all has 0 and 0. Pure.
 */
export function belowMinSize(width: number, pixels: Uint32Array, territories: readonly TerritoryInfo[], minPieceSize: number): BelowMinSize[] {
  const count = new Map<number, number>();
  const largest = new Map<number, number>();
  for (const piece of labelPieces(width, pixels).pieces) {
    count.set(piece.value, (count.get(piece.value) ?? 0) + piece.size);
    if (piece.size > (largest.get(piece.value) ?? 0)) largest.set(piece.value, piece.size);
  }
  const errors: BelowMinSize[] = [];
  for (const t of territories) {
    const best = largest.get(t.id) ?? 0;
    if (best < minPieceSize) errors.push({ kind: 'territory-below-min-size', territory: t.key, name: t.name, pixels: count.get(t.id) ?? 0, largest: best });
  }
  return errors;
}

/**
 * FR-604, FR-117, FR-163: the minimum-piece check and then the cleanup. A territory without a piece of S pixels fails
 * first, all of them at once; otherwise every piece below S is reassigned smallest first by the unchanged 003b
 * `cleanupPieces` (003c amendment included), which fails with `vanished-entry` for an entry that would lose its last
 * pixel (after the check no entry can: each keeps a piece of S or more). `entries` are in map order: land territories
 * with their owner, then the sea zones. Returns a new raster.
 */
export function cleanPieces(
  width: number,
  pixels: Uint32Array,
  entries: readonly PieceEntry[],
  territories: readonly TerritoryInfo[],
  minPieceSize: number,
): Result<CleanupResult, BelowMinSize | CleanupError> {
  const below = belowMinSize(width, pixels, territories, minPieceSize);
  if (below.length > 0) return { ok: false, errors: below };
  return cleanupPieces(width, pixels, entries, minPieceSize);
}
