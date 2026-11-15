import type { EntryKind, MapEntry, SeaZone } from './types';

/**
 * FR-58: kind of an object entry from its own `kind` field (inherited ones are ignored).
 * No own field or the text "land" is land; the text "sea" is sea; anything else is invalid.
 */
export function entryKind(entry: object): EntryKind {
  if (!Object.hasOwn(entry, 'kind')) return 'land';
  const kind: unknown = (entry as { kind?: unknown }).kind;
  if (kind === 'land') return 'land';
  if (kind === 'sea') return 'sea';
  return 'invalid';
}

/**
 * FR-57, FR-58: narrows a validated entry to a sea zone; uses the own-property kind rule of `entryKind`.
 * Assumes a validated map: an unvalidated entry with a corrupt kind such as 'Sea' reads as not-sea.
 */
export function isSeaZone(entry: MapEntry): entry is SeaZone {
  return entryKind(entry) === 'sea';
}
