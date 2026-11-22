import { describe, expect, it } from 'vitest';
import { WATER } from '../src/core/rasterize';
import { assignSeaZonesDetailed } from '../src/core/sea';
import { makeGapFill } from '../src/importer/gap-fill';
import { assignSea, assignWater, isolateEnclosed, locateSeeds, type SeaZone, type WaterSet } from '../src/importer/sea-sources';
import type { InsetView, View, ViewSet } from '../src/importer/views';

/** A view whose pixel coordinates are the longitude and latitude themselves. */
function identity(side: number, kind: 'main' | 'inset' = 'main', toUV: View['toUV'] = (lon, lat) => [lon, lat]): View {
  return { kind, projection: 'equal-earth', lon0: 0, lat0: 0, frame: { west: 0, north: 0, side }, side, plane: () => [0, 0], toUV };
}
const views = (width: number, insets: InsetView[] = []): ViewSet => ({ width, main: identity(width), mainUnits: [], insets });

/** A raster from rows of text: W water, . other land, digits land, letters sea-unit pixels (a=100, b=101, c=102). */
function grid(rows: string[]): { width: number; pixels: Uint32Array } {
  const width = rows.length;
  const pixels = new Uint32Array(width * width);
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error('the fixture must be square');
    [...row].forEach((ch, x) => {
      pixels[y * width + x] = ch === 'W' ? WATER : ch === '.' ? 0 : /\d/.test(ch) ? Number(ch) : 100 + ch.charCodeAt(0) - 97;
    });
  });
  return { width, pixels };
}
function show(pixels: Uint32Array, width: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < width; y++) {
    rows.push([...pixels.subarray(y * width, (y + 1) * width)].map((v) => (v === WATER ? 'W' : v === 0 ? '.' : v >= 100 ? String.fromCharCode(97 + v - 100) : String(v))).join(''));
  }
  return rows;
}

/** Zones with seeds at the given pixels (the identity view: the centre of a pixel is its coordinates plus a half). */
const seedZone = (id: number, x: number, y: number, name = `seed ${id}`): SeaZone => ({ id, seed: { name, lon: x + 0.5, lat: y + 0.5 } });
const unitZone = (id: number): SeaZone => ({ id });

function run(rows: string[], zones: SeaZone[], between?: (sets: WaterSet[], pixels: Uint32Array) => WaterSet[]) {
  const { width, pixels } = grid(rows);
  const r = assignSea({ views: views(width), pixels, zones, ...(between === undefined ? {} : { between }) });
  if (!r.ok) throw new Error(`expected a sea, got ${JSON.stringify(r.errors)}`);
  return { ...r.value, rows: show(r.value.pixels, width) };
}
function seedErrors(rows: string[], zones: SeaZone[]) {
  const { width, pixels } = grid(rows);
  const r = assignSea({ views: views(width), pixels, zones });
  if (r.ok) throw new Error('expected errors');
  return r.errors;
}

describe('FR-598 the seeds of the sea zones', () => {
  const sea = ['WWWW', 'WW3W', 'W.WW', 'WWWW'];

  it('FR-598 checks each seed against the pre-sea raster: outside the frame, not on water, on a pixel another seed has', () => {
    const zones = [
      { id: 7, seed: { name: 'Far', lon: 9.5, lat: 0.5 } },
      seedZone(8, 2, 1, 'On land'),
      seedZone(9, 1, 2, 'On other land'),
      seedZone(10, 0, 0, 'First'),
      seedZone(11, 0, 0, 'Second'),
      { id: 12, seed: { name: 'North', lon: 0.5, lat: -0.1 } },
    ];
    expect(seedErrors(sea, zones)).toStrictEqual([
      { kind: 'seed-outside-frame', seed: 0, name: 'Far' },
      { kind: 'seed-outside-frame', seed: 5, name: 'North' },
      { kind: 'seed-not-water', seed: 1, name: 'On land' },
      { kind: 'seed-not-water', seed: 2, name: 'On other land' },
      { kind: 'duplicate-seed-pixel', seeds: [3, 4], x: 0, y: 0 },
    ]);
  });

  it('FR-598 lists the seed errors in the 003b kind order and then by the first seed named', () => {
    const zones = [seedZone(7, 0, 0, 'Dup A'), seedZone(8, 2, 1, 'Land'), seedZone(9, 0, 0, 'Dup B'), { id: 10, seed: { name: 'Out', lon: 40, lat: 40 } }];
    expect(seedErrors(sea, zones).map((e) => e.kind)).toStrictEqual(['seed-outside-frame', 'seed-not-water', 'duplicate-seed-pixel']);
  });

  it('FR-598 numbers a seed by its position in the seed list, not by the position of its zone', () => {
    // two sea units come first (FR-605): the seed list starts after them
    const zones = [unitZone(100), unitZone(101), seedZone(7, 2, 1, 'First seed'), seedZone(8, 2, 1, 'Second seed')];
    expect(seedErrors(sea, zones)).toStrictEqual([
      { kind: 'seed-not-water', seed: 0, name: 'First seed' },
      { kind: 'seed-not-water', seed: 1, name: 'Second seed' },
      { kind: 'duplicate-seed-pixel', seeds: [0, 1], x: 2, y: 1 },
    ]);
  });

  it('FR-598 places a seed by the composed rule: an inset whose projection holds it takes it, at its place in the image', () => {
    const inset: InsetView = { ...identity(2, 'inset', (lon, lat) => [lon - 50, lat - 60]), kind: 'inset', index: 0, rect: { x: 2, y: 1, w: 2, h: 2 }, units: [] };
    const set: ViewSet = { width: 4, main: identity(4), mainUnits: [], insets: [inset] };
    const { pixels } = grid(['WWWW', 'WWWW', 'WWWW', 'WWWW']);
    const located = locateSeeds(set, pixels, [{ id: 7, seed: { name: 'Island sea', lon: 51.5, lat: 60.5 } }, { id: 8, seed: { name: 'Main sea', lon: 0.5, lat: 3.5 } }]);
    expect(located).toStrictEqual({ ok: true, value: new Map([[0, 1 * 4 + 3], [1, 3 * 4 + 0]]) });
  });

  it('FR-598 accepts a seed on the pixels of a sea territory and gives the seed zone nothing there: the first zone in order has them', () => {
    const r = run(['WWWW', 'WaaW', 'WWWW', 'WWWW'], [unitZone(100), seedZone(7, 1, 1, 'Inside the unit')]);
    expect(r.rows).toStrictEqual(['aaaa', 'aaaa', 'aaaa', 'aaaa']);
  });
});

describe('FR-598 the water pass', () => {
  const open = ['WWWWW', 'WWWWW', 'WWWWW', 'WWWWW', 'WWWWW'];

  it('FR-598 gives every water pixel to the zone reached in the fewest steps through water, a tie to the first zone in order', () => {
    const r = run(open, [seedZone(7, 0, 0), seedZone(8, 4, 0)]);
    // the middle column is two steps from both seeds: the first zone takes it
    expect(r.rows).toStrictEqual(Array(5).fill('77788'));
  });

  it('FR-598 swaps the tie when the zones swap', () => {
    const r = run(open, [seedZone(8, 4, 0), seedZone(7, 0, 0)]);
    expect(r.rows).toStrictEqual(Array(5).fill('77888'));
  });

  it('FR-598 starts from every pixel of a sea territory and from the seed pixels together, zones in order', () => {
    // a is zone 100 (column 0), b is zone 101 (one pixel), the seed zone 7 is at (2, 0); every tie goes to the first zone
    const r = run(['aWWWW', 'aWWWW', 'aWWWW', 'aWWWW', 'aWWWb'], [unitZone(100), unitZone(101), seedZone(7, 2, 0)]);
    expect(r.rows).toStrictEqual(['aa777', 'aa77b', 'aaaab', 'aaabb', 'aaabb']);
  });

  it('FR-598 joins an enclosed lake to the zone around it, whole, and reports it', () => {
    const lake = ['WWWWWWW', 'W11111W', 'W1WWW1W', 'W1W1W1W', 'W1WWW1W', 'W11111W', 'WWWWWWW'];
    const r = run(lake, [seedZone(7, 0, 0)]);
    expect(r.rows).toStrictEqual(['7777777', '7111117', '7177717', '7171717', '7177717', '7111117', '7777777']);
    expect(r.enclosed).toStrictEqual([{ pixels: 8, zone: 7 }]);
  });

  it('FR-598 joins a lake to the zone with the nearest pixel, whichever zone is first in order', () => {
    // the lake pixel (3, 4) has a wall one pixel thick on the left, three on the right: the zone of column 0 is nearest
    const rows = ['aWWWWWWWb', 'aWWWWWWWb', 'aWWWWWWWb', 'aW11111Wb', 'aW1W111Wb', 'aW11111Wb', 'aWWWWWWWb', 'aWWWWWWWb', 'aWWWWWWWb'];
    const left = run(rows, [unitZone(100), unitZone(101)]);
    expect(left.rows[4]![3]).toBe('a');
    const swapped = run(rows, [unitZone(101), unitZone(100)]);
    expect(swapped.rows[4]![3]).toBe('a');
    expect(left.enclosed).toStrictEqual([{ pixels: 1, zone: 100 }]);
  });

  it('FR-598 gives a lake two zones are equally near to the first zone in order', () => {
    const rows = ['aWWWWWWWb', 'aWWWWWWWb', 'aWWWWWWWb', 'aWW111WWb', 'aWW1W1WWb', 'aWW111WWb', 'aWWWWWWWb', 'aWWWWWWWb', 'aWWWWWWWb'];
    expect(run(rows, [unitZone(100), unitZone(101)]).rows[4]![4]).toBe('a');
    expect(run(rows, [unitZone(101), unitZone(100)]).rows[4]![4]).toBe('b');
  });

  it('FR-598 searches the ring of a distance that ties the best one found in an earlier ring', () => {
    // the lake pixel (6, 6): zone b at (10, 9) and zone a at (11, 6) are both 25 away, in the rings 4 and 5
    const rows = Array.from({ length: 13 }, (_, y) =>
      Array.from({ length: 13 }, (_, x) => (x === 6 && y === 6 ? 'W' : x === 11 && y === 6 ? 'a' : x === 10 && y === 9 ? 'b' : '1')).join(''),
    );
    expect(run(rows, [unitZone(100), unitZone(101)]).rows[6]![6]).toBe('a');
    expect(run(rows, [unitZone(101), unitZone(100)]).rows[6]![6]).toBe('b');
  });

  it('FR-598 isolates the enclosed sets before any zone is assigned, in row-major order, and lets the gap fill take them away', () => {
    const rows = ['WWWWWWW', 'W22222W', 'W2W2W2W', 'W22222W', 'W2W2W2W', 'W22222W', 'WWWWWWW'];
    const { width, pixels } = grid(rows);
    // with no source at all the outer water is one more set; with a source in the outer water only the four lakes remain
    expect(isolateEnclosed(width, pixels, []).length).toBe(5);
    const seeded = grid(rows);
    seeded.pixels[0] = 7;
    const found = isolateEnclosed(width, seeded.pixels, [0]);
    expect(found.map((s) => s.pixels)).toStrictEqual([[16], [18], [30], [32]]);
    let seen: number[][] = [];
    const filled = run(rows, [seedZone(7, 0, 0)], (all, raster) => {
      seen = all.map((s) => [...s.pixels]);
      // the gap fill gives the first set to the land around it and keeps the rest
      for (const p of all[0]!.pixels) raster[p] = 2;
      return all.slice(1);
    });
    expect(seen).toStrictEqual([[16], [18], [30], [32]]);
    expect(filled.rows).toStrictEqual(['7777777', '7222227', '7222727', '7222227', '7272727', '7222227', '7777777']);
    expect(filled.enclosed).toStrictEqual([{ pixels: 1, zone: 7 }, { pixels: 1, zone: 7 }, { pixels: 1, zone: 7 }]);
  });

  it('FR-598 allows zero zones: every water pixel becomes background and nothing fails', () => {
    const r = run(['WW1W', 'WW1W', 'W..W', 'WWWW'], []);
    expect(r.rows).toStrictEqual(['..1.', '..1.', '....', '....']);
    expect(r.enclosed).toStrictEqual([]);
  });

  it('FR-598 turns the water into background when every zone is empty, and leaves the empty zones to the minimum-piece check', () => {
    const r = run(['WW1W', 'WWWW', 'WWWW', 'WWWW'], [unitZone(100)]);
    expect(r.rows).toStrictEqual(['..1.', '....', '....', '....']);
  });

  it('FR-598 stays fast when every zone is empty at scale: no per-pixel ring search with no source to find (the M2 review probe)', () => {
    // the empty-zone case at W = 4 above hides the cost: with no source pixel, the ring search of the enclosed-set
    // join scans the whole raster per pixel with no nearest zone to stop it. Measured on this machine before the
    // short-circuit: 16 to 68 s at W = 256 (5.3 to 22.3 s at W = 192, run alone and inside the suite); after it:
    // about a millisecond. The bound keeps a wide margin on both sides.
    const width = 256;
    const pixels = new Uint32Array(width * width).fill(WATER);
    const zones: SeaZone[] = [unitZone(100), unitZone(101)];
    const t0 = performance.now();
    const r = assignWater(width, pixels, zones);
    const elapsed = performance.now() - t0;
    expect(r.pixels.filter((v) => v !== 0).length).toBe(0);
    expect(r.enclosed).toStrictEqual([]);
    expect(elapsed, `${elapsed.toFixed(1)} ms`).toBeLessThan(5000);
  }, 90000);

  it('FR-598 runs the gap fill before the water of a zoneless map becomes background', () => {
    // a one-pixel pond inside land, open water around it, and no zone at all: the pond is gap-filled, the rest is
    // background. The short-circuit must not skip the `between` hook that does the filling.
    const gap = makeGapFill(5, 5, (value) => value === 1);
    const r = run(['W111W', 'W1W1W', 'W111W', 'WWWWW', 'WWWWW'], [], gap.between);
    expect(r.rows).toStrictEqual(['.111.', '.111.', '.111.', '.....', '.....']);
    expect(gap.filled).toStrictEqual([{ pixels: 1, territory: 1 }]);
  });

  it('FR-598 never overwrites land, other land or the pixels of an earlier zone', () => {
    const r = run(['1W.W', 'WWaW', 'WbWW', 'WWWW'], [unitZone(100), unitZone(101)]);
    expect(r.rows[0]![0]).toBe('1');
    expect(r.rows[0]![2]).toBe('.');
    expect(r.rows[1]![2]).toBe('a');
    expect(r.rows[2]![1]).toBe('b');
    expect(r.rows.join('')).not.toContain('W');
  });
});

describe('FR-598 a seeds-only sea is exactly what 003b computes', () => {
  /** A deterministic raster of water, land and other land with lakes and thin walls. */
  function field(width: number, salt: number): Uint32Array {
    const pixels = new Uint32Array(width * width);
    for (let y = 0; y < width; y++) {
      for (let x = 0; x < width; x++) {
        const h = ((x * 73856093) ^ (y * 19349663) ^ (salt * 83492791)) >>> 0;
        const r = (h >>> 7) % 100;
        pixels[y * width + x] = r < 38 ? 1 + (h % 4) : r < 46 ? 0 : WATER;
      }
    }
    return pixels;
  }

  it('FR-598 returns exactly what assignSeaZonesDetailed returns for a raster and seeds, enclosed sets included', () => {
    for (const [width, salt] of [[24, 1], [31, 2], [40, 3], [40, 4], [57, 5]] as const) {
      const base = field(width, salt);
      // seeds on the first water pixels found at three scattered places
      const found: number[] = [];
      for (const start of [0, Math.floor(width * width / 3), Math.floor((2 * width * width) / 3)]) {
        for (let i = start; i < width * width; i++) {
          if (base[i] === WATER && !found.includes(i)) {
            found.push(i);
            break;
          }
        }
      }
      expect(found.length).toBe(3);
      const ids = [50, 51, 52];
      const core = assignSeaZonesDetailed(width, base, found.map((p) => ({ x: p % width, y: Math.floor(p / width) })), ids);
      const zones = found.map((p, i) => seedZone(ids[i]!, p % width, Math.floor(p / width)));
      const mine = assignSea({ views: views(width), pixels: base.slice(), zones });
      if (!mine.ok) throw new Error(JSON.stringify(mine.errors));
      expect(mine.value.pixels).toStrictEqual(core.pixels);
      expect(mine.value.enclosed).toStrictEqual(core.enclosed);
      expect(core.enclosed.length, `fixture ${width}/${salt} has lakes`).toBeGreaterThan(0);
    }
  });

  it('FR-598 returns the same result for the same input', () => {
    const base = field(33, 9);
    const zones = [seedZone(50, 0, 0), seedZone(51, 32, 32)];
    const grabbed = [base.slice(), base.slice()].map((pixels) => assignWater(33, pixels, zones));
    expect(grabbed[0]!.pixels).toStrictEqual(grabbed[1]!.pixels);
  });
});
