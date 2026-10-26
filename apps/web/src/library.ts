import { normalizeMap, validateMap, type MapFormatV1 } from '@mbrg/shared';

import { handmadeMap } from './maps/handmade.js';

/**
 * Where the viewer gets its map from.
 *
 * The hand-made map ships with the code; imported maps live in `localStorage`
 * on the player's machine, so a map never has to be committed to the repo to be
 * played. The active map is chosen with `?map=<id>` and falls back to the
 * built-in one, which keeps every shared seed link working as before.
 *
 * Stored maps are untrusted input — they came out of a file the user picked —
 * so they are validated on the way in and again on the way out.
 */

export interface MapEntry {
  id: string;
  name: string;
  map: MapFormatV1;
  /** True for the map that ships with the app. */
  builtIn: boolean;
  /** Pixel count of the source image, for the picker. */
  size?: string;
}

const STORAGE_KEY = 'mbrg.maps';
/** Keep the store small: an imported map is a few hundred KB of JSON. */
const MAX_STORED = 8;

export const HANDMADE_ID = 'handmade';

const BUILT_IN: MapEntry = {
  id: HANDMADE_ID,
  name: handmadeMap.name,
  map: handmadeMap,
  builtIn: true,
  size: `${handmadeMap.width}×${handmadeMap.height}`,
};

function readStore(): MapEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Maps saved before `polygons` are lifted on read, so an imported map does
    // not disappear from the library just because the format moved on.
    return parsed
      .map((entry) => {
        const usable = isUsableEntry(entry);
        return usable ? { ...entry, map: normalizeMap(entry.map) as MapFormatV1 } : null;
      })
      .filter((entry): entry is MapEntry => entry !== null);
  } catch {
    return []; // corrupt or blocked storage: fall back to just the built-in map
  }
}

function isUsableEntry(value: unknown): value is MapEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<MapEntry>;
  if (typeof entry.id !== 'string' || typeof entry.name !== 'string') return false;
  if (typeof entry.map !== 'object' || entry.map === null) return false;
  return validateMap(entry.map).errors.length === 0;
}

function writeStore(entries: MapEntry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* over quota or blocked: the map simply is not kept */
  }
}

/** The built-in map plus everything the user has imported. */
export function listMaps(): MapEntry[] {
  return [BUILT_IN, ...readStore()];
}

/** Find a map by id. Unknown ids fall back to the built-in map. */
export function resolveMap(id: string | null | undefined): MapEntry {
  if (!id) return BUILT_IN;
  if (id === HANDMADE_ID) return BUILT_IN;
  return readStore().find((entry) => entry.id === id) ?? BUILT_IN;
}

/** Map id from `?map=`, if present. */
export function mapIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('map');
}

/**
 * Store an imported map and return its id. Rejects a map that does not
 * validate, because everything downstream assumes a valid one.
 */
export function saveMap(name: string, map: MapFormatV1, size?: string): string {
  const { errors } = validateMap(map);
  if (errors.length > 0) {
    throw new Error(`the map is not valid: ${errors[0]}`);
  }
  const id = `map-${Date.now().toString(36)}`;
  const entry: MapEntry = { id, name, map, builtIn: false, size };
  const kept = [entry, ...readStore()].slice(0, MAX_STORED);
  writeStore(kept);
  return id;
}

/** Forget an imported map. The built-in one cannot be removed. */
export function deleteMap(id: string): void {
  writeStore(readStore().filter((entry) => entry.id !== id));
}

/** A short, unique-enough name for the picker. */
export function suggestMapName(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]+$/i, '').slice(0, 40) || 'imported map';
}
