import type { MapFormatV1 } from '@mbrg/shared';

/**
 * Province names for an imported map.
 *
 * They live in the map itself (`Territory.name`), not in a side file, so they
 * travel with the map when it is exported or shared. The viewer already reads
 * `Territory.name` through `factionName`, which is why naming a province needs
 * no change over there.
 */

/**
 * Long enough for "Islas Canarias de Poniente", short enough to still fit on a
 * province: the name is painted on the map, and a 200-character name is a wall
 * of letters over its own province.
 */
export const MAX_NAME_LENGTH = 24;

/**
 * Tidy a name typed by a person: trim, collapse inner whitespace and newlines
 * into single spaces, and cap the length. Returns `null` when nothing is left,
 * so the caller can fall back to the territory id.
 */
export function cleanName(raw: string): string | null {
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (flat === '') return null;
  return flat.slice(0, MAX_NAME_LENGTH);
}

/**
 * A copy of `map` with `names` applied. Does not mutate the input: the import
 * screen re-runs detection on every parameter change, and the names have to
 * survive that without the previous map being edited underneath it.
 *
 * `names` is the whole truth: a territory missing from it goes back to its id,
 * which is the placeholder the assembler writes. That is what lets the user
 * clear a name by emptying the field, instead of needing a "reset" path.
 *
 * Names for territories that no longer exist are ignored, and the ones that
 * survive are reported back so the caller can say what was lost.
 */
export function applyNames(
  map: MapFormatV1,
  names: ReadonlyMap<string, string>,
): { map: MapFormatV1; kept: number; dropped: string[] } {
  const seen = new Set<string>();
  const dropped: string[] = [];
  for (const id of names.keys()) {
    if (map.territories.some((t) => t.id === id)) seen.add(id);
    else dropped.push(id);
  }

  const territories = map.territories.map((territory) => {
    const name = names.get(territory.id) ?? territory.id;
    if (name === territory.name) return territory;
    return { ...territory, name };
  });

  return { map: { ...map, territories }, kept: seen.size, dropped };
}
