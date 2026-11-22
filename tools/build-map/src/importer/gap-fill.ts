import type { WaterSet } from './sea-sources';

/** FR-603: an enclosed water set the gap fill gave to a land territory. */
export interface FilledSet {
  /** The number of pixels of the set. */
  pixels: number;
  /** The id of the land territory that took it. */
  territory: number;
}

/** The gap fill of one import: the hook for the sea pass and the sets it filled. */
export interface GapFill {
  /** The `between` hook of `assignSea`: fills what it can and returns the sets that remain. */
  between(sets: WaterSet[], pixels: Uint32Array): WaterSet[];
  /** The sets filled so far, in the order they were found. */
  filled: FilledSet[];
}

/**
 * FR-603: the gap fill G. Each enclosed water set of fewer than G pixels that touches a land territory goes, as a
 * whole, to the land territory with the highest contact count with it (the number of 4-adjacent pairs of a pixel of
 * the set and a pixel of the territory), ties to the first territory in map order; its pixels become land. A set that
 * touches only other land (value 0), or no land at all, is left for the sea pass, and so is a set of G pixels or more.
 * `isLand` tells the value of a land territory from other land and sea zones; the land ids are in map order, so the
 * lower id is the earlier territory. The sets are filled before any zone is assigned (the sea pass calls the hook
 * after isolating them). Pure apart from the pixels it fills.
 */
export function makeGapFill(width: number, gapFill: number, isLand: (value: number) => boolean): GapFill {
  const filled: FilledSet[] = [];
  const total = width * width;
  const between = (sets: WaterSet[], pixels: Uint32Array): WaterSet[] => {
    const remaining: WaterSet[] = [];
    for (const set of sets) {
      if (set.pixels.length >= gapFill) {
        remaining.push(set);
        continue;
      }
      const contact = new Map<number, number>();
      const touch = (value: number): void => {
        if (isLand(value)) contact.set(value, (contact.get(value) ?? 0) + 1);
      };
      for (const p of set.pixels) {
        const x = p % width;
        if (p >= width) touch(pixels[p - width]!);
        if (p + width < total) touch(pixels[p + width]!);
        if (x > 0) touch(pixels[p - 1]!);
        if (x < width - 1) touch(pixels[p + 1]!);
      }
      let best = -1;
      let bestCount = 0;
      for (const [value, count] of contact) {
        if (count > bestCount || (count === bestCount && value < best)) {
          best = value;
          bestCount = count;
        }
      }
      if (best === -1) {
        remaining.push(set);
        continue;
      }
      for (const p of set.pixels) pixels[p] = best;
      filled.push({ pixels: set.pixels.length, territory: best });
    }
    return remaining;
  };
  return { between, filled };
}
