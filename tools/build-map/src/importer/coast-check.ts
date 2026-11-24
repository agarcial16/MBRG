import { openWater } from './context-gap';

/** FR-609: a faction whose every sea contact is thin water, the sign of a sliver that links an inland territory to a zone. */
export interface ThinCoast {
  faction: number;
  /** The pixels of land of the faction 4-adjacent to thin water of a sea zone. */
  pixels: number;
  /** The land territories of the faction with such a contact, in id order. */
  territories: number[];
}

export interface CoastInput {
  width: number;
  pixels: Uint32Array;
  /** The faction of every land territory, by id. */
  owner: ReadonlyMap<number, number>;
  seaIds: ReadonlySet<number>;
  /** The radius of the opening (pixels); 0 turns the check off. */
  radius: number;
}

/**
 * FR-609: the factions with sea contact only through thin water. Open water is the opening of the water (sea zones and
 * water alike; land territories and other land are dry) by a disk of `radius` pixels, as `closeContextGaps` sees it. A
 * faction is listed when some pixel of its land is 4-adjacent to a pixel of a sea zone, and none touches open water.
 * Sorted by faction. Pure.
 */
export function thinCoastFactions(input: CoastInput): ThinCoast[] {
  const { width, pixels, owner, seaIds, radius } = input;
  if (radius < 1) return [];
  const open = openWater(width, pixels, radius, (value) => owner.has(value));
  const total = width * width;
  const thin = new Map<number, { pixels: number; territories: Set<number> }>();
  const hasOpen = new Set<number>();
  for (let p = 0; p < total; p++) {
    const faction = owner.get(pixels[p]!);
    if (faction === undefined) continue;
    const x = p % width;
    const neighbours = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p >= width ? p - width : -1, p + width < total ? p + width : -1];
    for (const q of neighbours) {
      if (q === -1 || !seaIds.has(pixels[q]!)) continue;
      if (open[q] === 1) hasOpen.add(faction);
      else {
        const entry = thin.get(faction) ?? { pixels: 0, territories: new Set<number>() };
        entry.pixels++;
        entry.territories.add(pixels[p]!);
        thin.set(faction, entry);
      }
    }
  }
  return [...thin]
    .filter(([faction]) => !hasOpen.has(faction))
    .sort((a, b) => a[0] - b[0])
    .map(([faction, e]) => ({ faction, pixels: e.pixels, territories: [...e.territories].sort((a, b) => a - b) }));
}
