// Dense entry index and owner table (FR-134, NFR-24; plan decisions P5 and P6). Pure.
// Entry index 0 is outside the map; map entries are 1..E in map order. The index image is built once
// per load; a round change only rebuilds the owner table (one byte per entry, never pixel data).
import { entryKind, factionOrder } from '@mbrg/shared';
import type { FactionId, MapData, Rgb, TerritoryId } from '@mbrg/shared';
import type { FillClass } from './theme';

/** The two index bytes per pixel hold at most this many entries (plus outside). */
export const MAX_ENTRIES = 0xffff;
/** The owner table holds a faction index in one byte (0 = none). */
export const MAX_FACTIONS = 255;

/**
 * Views of the id image by dense entry index. It is also the `IndexGrid` that `renderReference` reads:
 * `cells` and `fills` have the meaning given in `borders.ts`.
 */
export interface EntryIndex {
  width: number;
  height: number;
  /** Entry index of every pixel, row-major. */
  cells: Uint16Array;
  /** `fills[i]` is the fill class of entry index i (`fills[0]` is `outside`). */
  fills: FillClass[];
  /** `ids[i]` is the map id of entry index i (`ids[0]` is 0). */
  ids: number[];
  /** Map id -> entry index. */
  indexOf: Map<TerritoryId, number>;
  /** The texture data: RG8, two bytes per pixel, low byte of the entry index first. */
  indexPixels: Uint8Array;
}

/**
 * Builds the entry index of a checked package. Throws a RangeError on a pixel id that is not in the map
 * or on more than 65,535 entries (the package checks of FR-133 must have passed).
 */
export function buildEntryIndex(map: MapData, width: number, height: number, values: ArrayLike<number>): EntryIndex {
  const entries = map.territories;
  if (entries.length > MAX_ENTRIES) throw new RangeError(`too many map entries: ${entries.length}`);
  const ids = [0];
  const fills: FillClass[] = ['outside'];
  const indexOf = new Map<TerritoryId, number>();
  entries.forEach((entry, i) => {
    ids.push(entry.id);
    fills.push(entryKind(entry) === 'sea' ? 'sea' : 'land');
    indexOf.set(entry.id, i + 1);
  });

  const count = width * height;
  const cells = new Uint16Array(count);
  const indexPixels = new Uint8Array(count * 2);
  let lastValue = 0;
  let lastIndex = 0;
  for (let p = 0; p < count; p++) {
    const value = values[p]!;
    if (value !== lastValue) {
      lastValue = value;
      lastIndex = 0;
      if (value !== 0) {
        const found = indexOf.get(value);
        if (found === undefined) throw new RangeError(`pixel ${p} has an id that is not in the map: ${value}`);
        lastIndex = found;
      }
    }
    cells[p] = lastIndex;
    indexPixels[p * 2] = lastIndex & 255;
    indexPixels[p * 2 + 1] = lastIndex >> 8;
  }
  return { width, height, cells, fills, ids, indexOf, indexPixels };
}

/** Faction id -> faction index 1..F, in faction order (003a). */
export function factionIndexOf(map: MapData): Map<FactionId, number> {
  return new Map(factionOrder(map).map((faction, i) => [faction, i + 1]));
}

/** Colour per faction index; index 0 (no owner) is a placeholder that is never drawn. */
export function factionColorList(map: MapData, colors: ReadonlyMap<FactionId, Rgb>): Rgb[] {
  const list: Rgb[] = [[0, 0, 0]];
  for (const faction of factionOrder(map)) {
    const color = colors.get(faction);
    if (color === undefined) throw new RangeError(`faction ${faction} has no colour`);
    list.push(color);
  }
  return list;
}

/**
 * Owner table: for every entry index, the faction index of its owner in the displayed state, or 0
 * (sea, outside, or a land entry the state gives no owner). Per-entry data only: E + 1 bytes.
 */
export function ownerTable(
  index: EntryIndex,
  owners: ReadonlyMap<TerritoryId, FactionId>,
  factionIndex: ReadonlyMap<FactionId, number>,
): Uint8Array {
  if (factionIndex.size > MAX_FACTIONS) throw new RangeError(`too many factions: ${factionIndex.size}`);
  const table = new Uint8Array(index.ids.length);
  for (let i = 1; i < index.ids.length; i++) {
    if (index.fills[i] !== 'land') continue;
    const owner = owners.get(index.ids[i]!);
    table[i] = owner === undefined ? 0 : (factionIndex.get(owner) ?? 0);
  }
  return table;
}
