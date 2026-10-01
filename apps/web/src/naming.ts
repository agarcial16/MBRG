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

/**
 * Read a name file: a flat map of colour to name.
 *
 * ```json
 * { "#c0392b": "Aurelia", "#27ae60": "Borgoña" }
 * ```
 *
 * Keys are matched loosely on purpose — `c0392b`, `#c0392b` and `#C0392B` are the
 * same colour, and a name file written by hand or copied out of a CSS block will
 * not agree on the punctuation. A `colors` wrapper is also accepted, because that
 * is what a names file wants to grow into (labels, ids) and having two shapes to
 * remember is worse than accepting one extra.
 *
 * Anything that is not a colour → name pair is dropped rather than throwing: a
 * name file is hand-written, and a typo in one line should cost one province, not
 * the whole upload.
 */
export function parseNameFile(text: string): {
  byColor: Map<string, string>;
  rejected: number;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`the name file is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('the name file must be an object of "#colour": "name" pairs');
  }
  // Accept both { "#abc": "x" } and { "colors": { "#abc": "x" } }.
  const source =
    typeof (parsed as { colors?: unknown }).colors === 'object' &&
    (parsed as { colors: unknown }).colors !== null
      ? ((parsed as { colors: Record<string, unknown> }).colors)
      : (parsed as Record<string, unknown>);

  const byColor = new Map<string, string>();
  let rejected = 0;
  for (const [key, value] of Object.entries(source)) {
    const name = cleanName(typeof value === 'string' ? value : '');
    if (!name || !/^#?[0-9a-f]{3,8}$/i.test(key.trim())) {
      rejected++;
      continue;
    }
    byColor.set(key.trim().toLowerCase().replace(/^#/, ''), name);
  }
  return { byColor, rejected };
}

/**
 * Name the provinces of a map by the colour of the region they came from.
 *
 * This only works in mode A, where every province has a colour of its own, and
 * it is worth saying so out loud: in a colouring-book map two regions are told
 * apart by the lines around them and their colours are arbitrary, so a name file
 * cannot address them at all.
 *
 * A colour can produce several provinces — a region that connectivity split, or
 * one province appearing twice on the map — and they all get the same name. That
 * is reported per colour rather than hidden, because it is usually the sign that
 * the map's colours are not as unique as they looked.
 */
export function namesByColor(
  territories: readonly { id: string; color?: number }[],
  byColor: ReadonlyMap<string, string>,
): { names: Map<string, string>; matched: number; unmatched: string[]; shared: string[] } {
  const names = new Map<string, string>();
  const hits = new Map<string, string[]>();
  for (const territory of territories) {
    const color = territory.color;
    if (color === undefined) continue;
    const name = byColor.get(color.toString(16).padStart(6, '0'));
    if (!name) continue;
    names.set(territory.id, name);
    const list = hits.get(name) ?? [];
    list.push(territory.id);
    hits.set(name, list);
  }
  const shared = [...hits.entries()].filter(([, ids]) => ids.length > 1).map(([name]) => name);
  return { names, matched: names.size, unmatched: [...byColor.keys()].filter((c) => !hits.has(byColor.get(c)!)), shared };
}
