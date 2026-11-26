// What a map image is (spec 038 FR-717 to FR-724, NFR-191). Pure: the address of the capture page, the size of each image kind and the
// bounded cache. Nothing here names a member, a server of Discord or a community key: a capture is told apart by (match, round, kind) only.

/** The round image zoomed on the annexation, or the whole map (FR-716). */
export type CaptureFrame = 'round' | 'full';

export interface CaptureJob {
  readonly matchId: string;
  readonly mapId: string;
  readonly round: number;
  readonly frame: CaptureFrame;
}

/** FR-723: the round image is 1600 x 900; the full map is capped at 4096 px on its longer side; a file must stay under 10 MB. */
export const ROUND_SIZE = Object.freeze({ width: 1600, height: 900 });
export const FULL_LONGER_SIDE = 4096;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** FR-724, FR-725, FR-718: cache entries, idle time before the browser closes, time allowed to one capture. */
export const CACHE_ENTRIES = 32;
export const IDLE_MS = 10_000;
export const CAPTURE_TIMEOUT_MS = 20_000;

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The pixel size of a capture: the round image is fixed; the full map keeps the map's aspect with its longer side at most 4096 (never enlarged). */
export function captureSize(frame: CaptureFrame, map: Size | undefined): Size | undefined {
  if (frame === 'round') return ROUND_SIZE;
  if (map === undefined || !(map.width > 0) || !(map.height > 0)) return undefined;
  const longer = Math.max(map.width, map.height);
  const k = Math.min(1, FULL_LONGER_SIDE / longer);
  return { width: Math.max(1, Math.round(map.width * k)), height: Math.max(1, Math.round(map.height * k)) };
}

/** The same size at half (FR-723: the one retry of an image that is over 10 MB). */
export const halfSize = (size: Size): Size => ({ width: Math.max(1, Math.floor(size.width / 2)), height: Math.max(1, Math.floor(size.height / 2)) });

/**
 * The address the capturing browser opens (FR-713): the viewer's own address with the capture parameters, and nothing else, so no member,
 * server or key can be in it (NFR-191). None when the viewer address is not an address.
 */
export function captureUrl(viewer: string, job: Pick<CaptureJob, 'matchId' | 'round' | 'frame'>): string | undefined {
  try {
    const url = new URL(viewer);
    url.search = '';
    url.hash = '';
    url.searchParams.set('capture', '1');
    url.searchParams.set('match', job.matchId);
    url.searchParams.set('round', String(job.round));
    url.searchParams.set('frame', job.frame);
    return url.toString();
  } catch {
    return undefined;
  }
}

/** The pixel size of a PNG file from its header, or none when it is not one. */
export function pngSize(bytes: Uint8Array): Size | undefined {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

/** The key of a capture in the cache (FR-724): match, round and kind, nothing about who asked (NFR-191). */
export const cacheKey = (job: Pick<CaptureJob, 'matchId' | 'round' | 'frame'>): string => `${job.matchId}:${job.round}:${job.frame}`;

/** A cache of at most `max` entries; reading or writing an entry makes it the most recent, and the least recent is dropped first (FR-724). */
export interface Lru<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  readonly size: number;
}

export function createLru<V>(max: number): Lru<V> {
  const entries = new Map<string, V>();
  return {
    get(key) {
      const value = entries.get(key);
      if (value === undefined) return undefined;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > max) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
    },
    get size() {
      return entries.size;
    },
  };
}
