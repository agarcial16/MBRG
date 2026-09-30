import type { FactionId, MapFormatV1 } from '@mbrg/shared';

/** Display-name lookup per map (maps are immutable → cached by identity). */
const cache = new WeakMap<MapFormatV1, Map<FactionId, string>>();

/**
 * Display name of a faction. Faction ids are always the id of one of the
 * map's territories (the engine creates one faction per territory and never
 * renumbers them), so the territory's `name` is the faction's name — with the
 * raw id as fallback for maps without names.
 */
export function factionName(map: MapFormatV1, faction: FactionId): string {
  let names = cache.get(map);
  if (!names) {
    names = new Map();
    for (const t of map.territories) names.set(t.id, t.name?.trim() || t.id);
    cache.set(map, names);
  }
  return names.get(faction) ?? faction;
}
