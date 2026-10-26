// The map list of the server (spec 008 FR-232 `unknown-map`, FR-235, FR-250, FR-281 (j)): map ids and the package folders of
// the settings; `file` serves the three files of a listed package by their fixed names only.
// The shell reads the three files, hashes `mapDigestBytes(files)` with SHA-256 and parses map.json; the protocol and the
// core stay pure (PD8). A listed folder that cannot be read gives `map: null` and an empty digest, which the core
// reports as map validation errors (a missing or unreadable package is never a match).

import { createReadStream, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { MAP_FILE_NAMES, mapDigestBytes } from '@mbrg/protocol';
import type { MapFileName } from '@mbrg/protocol';
import { validateMap } from '@mbrg/shared';
import { sha256Bytes } from './ids';

/** A listed map as read from its folder: the parsed map.json (unknown: validated by the core) and the package digest. */
export interface LoadedMap {
  readonly map: unknown;
  /** The 64-hex map digest of the three files, or '' when the package could not be read. */
  readonly digest: string;
}

/** One file of a listed map package as served to the viewer (FR-281 (j)): its size now and a fresh stream of its stored bytes. */
export interface MapFile {
  readonly name: MapFileName;
  readonly size: number;
  /** Opens a new read stream of the file (one per request; the caller consumes or destroys it). */
  open(): Readable;
}

export interface MapCatalog {
  /** The listed map ids in the order of the settings. */
  ids(): readonly string[];
  /** The map of a listed id (read from disk now), or undefined when the id is not in the list (`unknown-map`). */
  load(mapId: string): LoadedMap | undefined;
  /**
   * One of the three files of a listed package (FR-281 (j)): undefined when the map id is not listed, `null` when the file
   * cannot be read. The name is only compared with the three fixed names (never joined as given), so no request text can
   * name a path outside the package folder; the caller checks the name first. Optional so that a hand-written catalog of
   * the earlier tests stays valid: a catalog without it serves no file (`unknown-map`); `createMapCatalog` always has it.
   */
  file?(mapId: string, name: MapFileName): MapFile | null | undefined;
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Whether `name` is exactly one of the three file names of a package (FR-281 (j)). */
export const isMapFileName = (name: unknown): name is MapFileName => typeof name === 'string' && (MAP_FILE_NAMES as readonly string[]).includes(name);

/**
 * The map the core gets for a step of a match (FR-250): the parsed map.json of the package listed under the match's map
 * id when the package can be read, has the stored map digest and passes validation; otherwise null, and the core halts
 * the match with `map-changed`. Read at the moment of the step, never cached across decisions.
 */
export function mapForStep(catalog: MapCatalog, mapId: string, storedDigest: string): unknown {
  const loaded = catalog.load(mapId);
  if (loaded === undefined || loaded.digest === '' || loaded.digest !== storedDigest) return null;
  return validateMap(loaded.map).ok ? loaded.map : null;
}

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
  file(mapId: string, name: MapFileName): MapFile | null | undefined {
    if (typeof mapId !== 'string' || !hasOwn(folders, mapId)) return undefined;
    // The joined name is one of the fixed constants, never the caller's text.
    const fixed = MAP_FILE_NAMES.find((n) => n === name);
    if (fixed === undefined) throw new RangeError('not a map file name');
    const path = join(folders[mapId] as string, fixed);
    let size: number;
    try {
      const stat = statSync(path);
      if (!stat.isFile()) return null;
      size = stat.size;
    } catch {
      return null;
    }
    return { name: fixed, size, open: () => createReadStream(path) };
  },
});
