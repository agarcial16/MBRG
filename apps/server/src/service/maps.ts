// The map list of the server (spec 008 FR-232 `unknown-map`, FR-235): map ids and the package folders of the settings.
// The shell reads the three files, hashes `mapDigestBytes(files)` with SHA-256 and parses map.json; the protocol and the
// core stay pure (PD8). A listed folder that cannot be read gives `map: null` and an empty digest, which the core
// reports as map validation errors (a missing or unreadable package is never a match).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAP_FILE_NAMES, mapDigestBytes } from '@mbrg/protocol';
import type { MapFileName } from '@mbrg/protocol';
import { sha256Bytes } from './ids';

/** A listed map as read from its folder: the parsed map.json (unknown: validated by the core) and the package digest. */
export interface LoadedMap {
  readonly map: unknown;
  /** The 64-hex map digest of the three files, or '' when the package could not be read. */
  readonly digest: string;
}

export interface MapCatalog {
  /** The listed map ids in the order of the settings. */
  ids(): readonly string[];
  /** The map of a listed id (read from disk now), or undefined when the id is not in the list (`unknown-map`). */
  load(mapId: string): LoadedMap | undefined;
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** The catalog of the settings' `maps` (id -> package folder). Only own ids are listed. */
export const createMapCatalog = (folders: Readonly<Record<string, string>>): MapCatalog => ({
  ids: () => Object.keys(folders),
  load(mapId: string): LoadedMap | undefined {
    if (typeof mapId !== 'string' || !hasOwn(folders, mapId)) return undefined;
    const folder = folders[mapId] as string;
    const files = {} as Record<MapFileName, Uint8Array>;
    try {
      for (const name of MAP_FILE_NAMES) files[name] = Uint8Array.from(readFileSync(join(folder, name)));
    } catch {
      return { map: null, digest: '' };
    }
    let map: unknown = null;
    try {
      map = JSON.parse(Buffer.from(files['map.json']).toString('utf8'));
    } catch {
      map = null;
    }
    return { map, digest: sha256Bytes(mapDigestBytes(files)) };
  },
});
