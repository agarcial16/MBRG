/**
 * Grids for the centred-label tests (spec 007): hand-made regions and fixed-seed random regions, as a piece index
 * holding one land entry (plan 007 section 13). Random data comes from the generator of `label-grids.ts`.
 */
import type { PieceIndex } from '../../src/core/regions';
import { rng } from './label-grids';
import { arcBandUnits, bandUnits, blobUnits, lineUnits, rectUnits, setOfUnits } from './shaped-grids';
import type { Unit } from './shaped-grids';

/** A region under test: its units (whole coordinates), the piece index, its pieces and a text aspect. */
export interface TestRegion {
  name: string;
  units: readonly Unit[];
  p: PieceIndex;
  pieces: number[];
  aspect: number;
}

/** Text aspects used by the random regions: below 1, near 1, short, long and the Castilla-La Mancha one. */
export const TEST_ASPECTS: readonly number[] = [0.6, 1, 2.5, 4, 8.53271484375];

function regionOf(name: string, all: readonly Unit[], aspect: number): TestRegion {
  // distinct units only (hand shapes may overlap), in row-major order
  const seen = new Map<number, Unit>();
  for (const u of all) seen.set(u[1] * 100000 + u[0], u);
  const units = [...seen.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  const { p, pieces } = setOfUnits(units);
  return { name, units, p, pieces, aspect };
}

/** Units of a disc of the given radius centred at the unit centre (cx + 0.5, cy + 0.5). */
function discUnits(cx: number, cy: number, radius: number): Unit[] {
  const out: Unit[] = [];
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= radius * radius) out.push([x, y] as const);
    }
  }
  return out;
}

/**
 * Hand grids of plan 007 section 13: a large diagonal band, a compact block, two lobes, a crescent whose centre
 * of mass lies outside the land, a region of 40 units, a region of one unit, one of four units, a region on the
 * image edge.
 */
export function handRegions(): TestRegion[] {
  const crescent = discUnits(30, 30, 24).filter(([x, y]) => (x - 36) * (x - 36) + (y - 30) * (y - 30) > 20 * 20);
  return [
    regionOf('diagonal band', bandUnits(2, 90, 9, (x) => 5 + x * 0.8), 4),
    regionOf('compact block', rectUnits(3, 4, 40, 36), 4),
    regionOf('two lobes', [...discUnits(14, 14, 12), ...discUnits(52, 14, 12), ...rectUnits(14, 12, 40, 5)], 2.5),
    regionOf('crescent', crescent, 4),
    regionOf('region of 40 units', rectUnits(1, 1, 8, 5), 2.5),
    regionOf('one unit', [[3, 3]], 1),
    regionOf('four units', rectUnits(2, 2, 2, 2), 1),
    regionOf('image edge', rectUnits(0, 0, 30, 6), 0.6),
    regionOf('long line', lineUnits(1, 40, 1, 1, 40), 8.53271484375),
  ];
}

/** Circular bands (cups and caps, alternating) for the given radii, thicknesses and half spans (degrees): the regions where arcs win. */
function circularBands(radii: readonly number[], thicks: readonly number[], spans: readonly number[]): TestRegion[] {
  const out: TestRegion[] = [];
  let id = 0;
  for (const radius of radii) {
    for (const thick of thicks) {
      for (const halfAngle of spans) {
        const sign = id % 2 === 0 ? 1 : -1;
        const units = arcBandUnits(radius, thick, halfAngle, sign);
        if (units.length === 0) continue;
        const { p, pieces } = setOfUnits(units);
        out.push({ name: `arc band ${String(id)}`, units, p, pieces, aspect: TEST_ASPECTS[id % TEST_ASPECTS.length]! });
        id++;
      }
    }
  }
  return out;
}

/** Twelve circular bands up to 5,000 units (the digest corpus of the `arcSearch` extraction guard). */
export function arcRegions(): TestRegion[] {
  return circularBands([60, 100, 160], [8, 16], [25, 40, 60]).slice(0, 18);
}

/** Eight small circular bands (a few hundred units): cheap enough for the brute-force reference at every step. */
export function smallArcRegions(): TestRegion[] {
  return circularBands([45, 70], [8, 14], [30, 50]);
}

/** `count` fixed-seed random regions (blobs of one to three thick segments), with aspects from TEST_ASPECTS. */
export function randomRegions(count: number, firstSeed = 1): TestRegion[] {
  const out: TestRegion[] = [];
  for (let i = 0; i < count; i++) {
    const seed = firstSeed + i;
    const next = rng(seed * 7919);
    const size = 14 + Math.floor(next() * 27);
    const aspect = TEST_ASPECTS[Math.floor(next() * TEST_ASPECTS.length)]!;
    out.push(regionOf(`random ${seed}`, blobUnits(seed, size), aspect));
  }
  return out;
}
