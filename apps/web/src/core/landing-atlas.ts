// Static background atlas catalog and deterministic per-visit rotation (spec 030 FR-614, FR-615).
// Pure: no DOM, no clock, no randomness. Plates are keyed by mapId so additional predefined maps
// (Spain, World) plug directly into ATLAS_PLATES without changing the rotation or layout logic.
import type { StorageLike } from './play-token';
import { STRINGS, fillTemplate } from './strings';

export interface AtlasPlate {
  readonly id: string;
  readonly mapId: string;
  readonly mapLabel: string;
  readonly round: number;
  readonly assetUrl: string;
}

export const VISIT_STORAGE_KEY = 'mbrg:landing:visit';

/** Pre-rendered static mid-round plates of predefined maps (dev map today; Spain/world append here). */
export const ATLAS_PLATES: readonly AtlasPlate[] = [
  { id: 'dev-s42-r2', mapId: 'dev', mapLabel: STRINGS.landingMapDev, round: 2, assetUrl: '/atlas/dev-s42-r2.webp' },
  { id: 'dev-s7-r2', mapId: 'dev', mapLabel: STRINGS.landingMapDev, round: 2, assetUrl: '/atlas/dev-s7-r2.webp' },
  { id: 'dev-s19-r3', mapId: 'dev', mapLabel: STRINGS.landingMapDev, round: 3, assetUrl: '/atlas/dev-s19-r3.webp' },
  { id: 'dev-s101-r1', mapId: 'dev', mapLabel: STRINGS.landingMapDev, round: 1, assetUrl: '/atlas/dev-s101-r1.webp' },
];

/** Interleaves plates round-robin by mapId (preserving first-seen map order) so consecutive visits rotate across maps. */
export function interleaveByMap(plates: readonly AtlasPlate[]): readonly AtlasPlate[] {
  const buckets = new Map<string, AtlasPlate[]>();
  for (const plate of plates) {
    const list = buckets.get(plate.mapId);
    if (list === undefined) buckets.set(plate.mapId, [plate]);
    else list.push(plate);
  }
  const groups = [...buckets.values()];
  const out: AtlasPlate[] = [];
  for (let row = 0; ; row++) {
    let added = false;
    for (const group of groups) {
      const item = group[row];
      if (item !== undefined) {
        out.push(item);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

/** Deterministic FNV-1a 32-bit unsigned hash for string visit keys. */
export function hashVisitKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Selects one static atlas plate deterministically for `visit`. When `mapId` is provided and matches at least one plate,
 * rotation stays within that map; otherwise it interleaves across all available maps.
 */
export function selectAtlasPlate(
  visit: number,
  plates: readonly AtlasPlate[] = ATLAS_PLATES,
  mapId?: string,
): AtlasPlate {
  const matched = mapId === undefined ? plates : plates.filter((p) => p.mapId === mapId);
  const pool = matched.length > 0 ? matched : plates;
  const order = interleaveByMap(pool);
  const n = Number.isFinite(visit) ? Math.trunc(visit) : 0;
  const index = ((n % order.length) + order.length) % order.length;
  return order[index]!;
}

const WHOLE = /^[0-9]+$/;
const VISIT_CAP = 1_000_000_000;

/** Reads and advances the stored visit counter (0 on first visit or when storage is unavailable or corrupt). */
export function nextVisitIndex(storage: StorageLike | undefined): number {
  if (storage === undefined) return 0;
  try {
    const raw = storage.getItem(VISIT_STORAGE_KEY);
    const next = raw !== null && WHOLE.test(raw) ? (Number(raw) + 1) % VISIT_CAP : 0;
    storage.setItem(VISIT_STORAGE_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}

/** Caption line for the static atlas plate badge, formatted through STRINGS. */
export function atlasCaption(plate: AtlasPlate): string {
  return fillTemplate(STRINGS.landingAtlasCaption, { name: plate.mapLabel, round: plate.round });
}
