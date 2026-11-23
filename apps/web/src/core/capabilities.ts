// Graphics capability check (FR-135) and viewer count refusal (spec 029, FR-586 to FR-589). Pure:
// the browser facts come in as plain numbers and the counts are read from the package.
import { factionOrder } from '@mbrg/shared';
import type { MapData } from '@mbrg/shared';
import { MAX_ENTRIES, MAX_FACTIONS } from './entries';
import { fillTemplate, STRINGS } from './strings';

export interface Capabilities {
  webgl2: boolean;
  maxTextureSize: number;
}

/** Viewer-internal error kinds (English identifiers, listed in the language test). */
export type CapabilityError =
  | { kind: 'no-webgl2' }
  | { kind: 'texture-too-small'; maxTextureSize: number; required: number }
  | { kind: 'too-many-territories'; count: number; limit: number }
  | { kind: 'too-many-factions'; count: number; limit: number };

/**
 * No WebGL 2 context, or a maximum texture size below the id image width or height, below the
 * owner table size (entries + 1), or below the faction colour table size (factions + 1), means
 * the map cannot be drawn (FR-135, spec 033 FR-644).
 */
export function checkCapabilities(
  caps: Capabilities,
  width: number,
  height: number,
  tableSize: number,
  factionTableSize = 0,
): CapabilityError[] {
  if (!caps.webgl2) return [{ kind: 'no-webgl2' }];
  const required = Math.max(width, height, tableSize, factionTableSize);
  if (caps.maxTextureSize < required) return [{ kind: 'texture-too-small', maxTextureSize: caps.maxTextureSize, required }];
  return [];
}

/**
 * Refuses a package whose counts pass the map format but exceed the viewer's own tables (FR-586 to
 * FR-589, spec 033 FR-644): the entry index holds one entry index in two bytes per pixel, the owner
 * table one faction index in two bytes per entry, so more entries than `MAX_ENTRIES` or more factions
 * than `MAX_FACTIONS` cannot be drawn. The limits are read from the table sizes themselves (FR-589),
 * never written inline, so widening the tables widens the refusal with them. Territories are named
 * before factions (FR-588). Pure.
 */
export function checkCounts(map: MapData): CapabilityError[] {
  const errors: CapabilityError[] = [];
  if (map.territories.length > MAX_ENTRIES) {
    errors.push({ kind: 'too-many-territories', count: map.territories.length, limit: MAX_ENTRIES });
  }
  const factions = factionOrder(map).length;
  if (factions > MAX_FACTIONS) errors.push({ kind: 'too-many-factions', count: factions, limit: MAX_FACTIONS });
  return errors;
}

/** The Spanish message of FR-135 and of the count refusal (spec 029), naming the limit that was passed. */
export function capabilityMessage(error: CapabilityError): string {
  if (error.kind === 'no-webgl2') return STRINGS.noWebgl2;
  if (error.kind === 'too-many-territories') return fillTemplate(STRINGS.tooManyTerritories, { count: error.count, limit: error.limit });
  if (error.kind === 'too-many-factions') return fillTemplate(STRINGS.tooManyFactions, { count: error.count, limit: error.limit });
  return fillTemplate(STRINGS.textureTooSmall, { size: error.maxTextureSize, required: error.required });
}
