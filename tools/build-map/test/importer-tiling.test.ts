import { describe, expect, it } from 'vitest';
import { configFromTile, tileBasins, type TilingBasin, type TilingConfig, type TilingInput, type TilingResult } from '../src/importer/tiling';

/**
 * Spec 035, the tiling core (FR-671 to FR-677, FR-685): fixtures are rasters at a real-ish scale: a land strip along
 * one edge (value 1: land is never water), basins `FIRST + index` in the water.
 */
const FIRST = 10;

interface Scene {
  width: number;
  pixels: Uint32Array;
}

/** A square ocean of one basin with a land strip along the left edge (columns 0 .. strip - 1). */
function ocean(width: number, strip = 1): Scene {
  const pixels = new Uint32Array(width * width).fill(FIRST);
  for (let y = 0; y < width; y++) for (let x = 0; x < strip; x++) pixels[y * width + x] = 1;
  return { width, pixels };
}

const basinsOf = (n: number): TilingBasin[] => Array.from({ length: n }, (_, i) => ({ name: `B${i}`, whole: false }));

function tile(scene: Scene, config: TilingConfig, over: Partial<TilingInput> = {}): TilingResult {
  const r = tileBasins({ width: scene.width, pixels: scene.pixels, firstId: FIRST, basins: basinsOf(1), pixelKm: 1, minPieceSize: 1, maxTiles: 10_000, spacing: config, ...over });
  if (!r.ok) throw new Error(`tiling failed: ${JSON.stringify(r.errors)}`);
  return r.value;
}

const xy = (pixel: number, width: number): [number, number] => [pixel % width, Math.floor(pixel / width)];

describe('FR-674 seeding', () => {
  it('FR-674 puts no two seeds of one piece closer than the coast spacing, whatever the tier', () => {
    const scene = ocean(300);
    const result = tile(scene, configFromTile(40));
    expect(result.tiles.length).toBeGreaterThan(10);
    for (let a = 0; a < result.tiles.length; a++) {
      for (let b = a + 1; b < result.tiles.length; b++) {
        const [ax, ay] = xy(result.tiles[a]!.seed, 300);
        const [bx, by] = xy(result.tiles[b]!.seed, 300);
        expect(Math.hypot(ax - bx, ay - by)).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it('FR-674 tries candidates by increasing coast distance, then row-major: the first seed is the first pixel on the coast', () => {
    const scene = ocean(200);
    const result = tile(scene, configFromTile(30));
    expect(result.tiles.some((t) => t.seed === 1)).toBe(true);
    // every coast pixel row of seeds sits on the first water column: seeds follow the coast at the coast spacing
    const onCoast = result.tiles.filter((t) => t.seed % 200 === 1).map((t) => Math.floor(t.seed / 200));
    expect(onCoast.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < onCoast.length; i++) expect(onCoast[i]! - onCoast[i - 1]!).toBeGreaterThanOrEqual(30);
  });

  it('FR-674 spaces tiles wider with the coast distance: coast tier, open tier and far tier', () => {
    const scene = ocean(900);
    const config = configFromTile(30);
    const result = tile(scene, config);
    const areas = new Map<string, number[]>();
    const classify = (x: number): string => (x <= config.bandKm ? 'coast' : x <= config.reachKm ? 'open' : 'far');
    result.tiles.forEach((t, i) => {
      const [x] = xy(t.seed, 900);
      const list = areas.get(classify(x - 1)) ?? [];
      list.push(t.pixels);
      areas.set(classify(x - 1), list);
      expect(i).toBeGreaterThanOrEqual(0);
    });
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(areas.get('coast')!)).toBeLessThan(mean(areas.get('open')!));
    expect(mean(areas.get('open')!)).toBeLessThan(mean(areas.get('far')!));
  });

  it('FR-674 covers empty frame with far-tier tiles, never a stripe of the length of the frame', () => {
    const scene = ocean(900);
    const config = configFromTile(30);
    const result = tile(scene, config);
    const extents = new Array<{ x0: number; x1: number; y0: number; y1: number }>(result.tiles.length).fill({ x0: 1e9, x1: -1, y0: 1e9, y1: -1 });
    for (let i = 0; i < 900 * 900; i++) {
      const t = result.labels[i]!;
      if (t < 0) continue;
      const [x, y] = xy(i, 900);
      const e = extents[t]!;
      extents[t] = { x0: Math.min(e.x0, x), x1: Math.max(e.x1, x), y0: Math.min(e.y0, y), y1: Math.max(e.y1, y) };
    }
    const longest = Math.max(...extents.map((e) => Math.hypot(e.x1 - e.x0 + 1, e.y1 - e.y0 + 1)));
    expect(longest).toBeLessThan(2.5 * config.farKm);
  });

  it('FR-674 gives a basin that holds no more than one tile of its own spacing exactly one tile, equal to the basin', () => {
    const scene = ocean(60);
    const result = tile(scene, configFromTile(100));
    expect(result.tiles).toHaveLength(1);
    expect(result.tiles[0]!.pixels).toBe(59 * 60);
    expect(result.labels.every((l, i) => (scene.pixels[i] === FIRST ? l === 0 : l === -1))).toBe(true);
  });

  it('FR-674 keeps a basin whole when its override is 0 (zones), however large it is', () => {
    const scene = ocean(200);
    const result = tile(scene, configFromTile(20), { basins: [{ name: 'B0', whole: true }] });
    expect(result.tiles).toHaveLength(1);
    expect(result.tiles[0]!.seed).toBe(1);
  });

  it('FR-670 scales every spacing of a basin with its own tile size', () => {
    const scene = ocean(400);
    const small = tile(scene, configFromTile(60));
    const fine = tile(scene, configFromTile(60), { basins: [{ name: 'B0', whole: false, tileKm: 30 }] });
    expect(fine.tiles.length).toBeGreaterThan(small.tiles.length * 2);
  });

  it('FR-674 gives a piece smaller than the spacing exactly one seed (the first candidate is always accepted)', () => {
    // basin 1 holds a 45 x 45 square and a 12 x 12 square apart: the small piece is far smaller than a tile of 40
    const scene = ocean(300);
    for (let y = 100; y < 145; y++) for (let x = 100; x < 145; x++) scene.pixels[y * 300 + x] = FIRST + 1;
    for (let y = 200; y < 212; y++) for (let x = 200; x < 212; x++) scene.pixels[y * 300 + x] = FIRST + 1;
    const result = tile(scene, configFromTile(40), { basins: basinsOf(2) });
    const inSmall = result.tiles.filter((t) => {
      const [x, y] = xy(t.seed, 300);
      return x >= 200 && x < 212 && y >= 200 && y < 212;
    });
    expect(inSmall).toHaveLength(1);
    expect(result.tiles.filter((t) => t.basin === 1).length).toBeGreaterThanOrEqual(2);
  });
});

describe('FR-675 partition', () => {
  it('FR-675 gives every water pixel to the nearest seed within the chamfer error (a bisector without axis bias)', () => {
    const scene = ocean(240);
    const result = tile(scene, configFromTile(45));
    const seeds = result.tiles.map((t) => xy(t.seed, 240));
    let checked = 0;
    let wrong = 0;
    for (let i = 0; i < 240 * 240; i++) {
      const t = result.labels[i]!;
      if (t < 0) continue;
      const [x, y] = xy(i, 240);
      const dist = seeds.map(([sx, sy]) => Math.hypot(x - sx, y - sy));
      const best = Math.min(...dist);
      checked++;
      if (dist[t]! - best > Math.max(1.5, 0.02 * best)) wrong++;
    }
    expect(checked).toBeGreaterThan(50_000);
    // a merged small tile (FR-676) may keep a few pixels that are nearer to a seed that no longer exists
    expect(wrong / checked).toBeLessThan(0.01);
  });

  it('FR-675 puts the border of two seeds on their perpendicular bisector within 2 pixels', () => {
    // a 200 x 60 sea under a land row: seeds of a 60-pixel coast tile line up along the strip
    const width = 200;
    const pixels = new Uint32Array(width * width).fill(FIRST);
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) if (y >= 60 || x === 0) pixels[y * width + x] = 1;
    const result = tile({ width, pixels }, configFromTile(60), { minPieceSize: 1 });
    expect(result.tiles.length).toBeGreaterThanOrEqual(2);
    const seeds = result.tiles.map((t) => xy(t.seed, width));
    let boundary = 0;
    for (let y = 0; y < 60; y++) {
      for (let x = 1; x < width - 1; x++) {
        const a = result.labels[y * width + x]!;
        const b = result.labels[y * width + x + 1]!;
        if (a < 0 || b < 0 || a === b) continue;
        boundary++;
        const da = Math.hypot(x + 0.5 - seeds[a]![0], y + 0.5 - seeds[a]![1]);
        const db = Math.hypot(x + 0.5 - seeds[b]![0], y + 0.5 - seeds[b]![1]);
        expect(Math.abs(da - db)).toBeLessThanOrEqual(2.5);
      }
    }
    expect(boundary).toBeGreaterThan(0);
  });

  it('FR-675 never lets a tile cross land or into another basin', () => {
    const width = 200;
    const pixels = new Uint32Array(width * width).fill(FIRST);
    for (let y = 0; y < width; y++) pixels[y * width + 100] = 1; // a land wall splits the sea into two pieces of one basin
    for (let y = 0; y < width; y++) for (let x = 101; x < 150; x++) pixels[y * width + x] = FIRST + 1; // and a second basin on the right
    const result = tile({ width, pixels }, configFromTile(35), { basins: basinsOf(2) });
    result.labels.forEach((l, i) => {
      if (l < 0) return;
      expect(result.tiles[l]!.basin).toBe(pixels[i]! - FIRST);
    });
    const sides = new Map<number, Set<string>>();
    result.labels.forEach((l, i) => {
      if (l < 0) return;
      const [x] = xy(i, width);
      const side = x < 100 ? 'left' : x < 150 ? 'mid' : 'right';
      const set = sides.get(l) ?? new Set<string>();
      set.add(side);
      sides.set(l, set);
    });
    for (const set of sides.values()) expect(set.size).toBe(1);
  });

  it('FR-675 refuses a step across a pinch point, so a tile never squeezes between two diagonal land pixels', () => {
    // a diagonal land line cuts a sea of one basin in two: the pieces are 4-connected apart, so no tile has pixels on both
    const width = 120;
    const pixels = new Uint32Array(width * width).fill(FIRST);
    for (let i = 0; i < width; i++) pixels[i * width + i] = 1;
    const result = tile({ width, pixels }, configFromTile(30));
    const sides = new Map<number, Set<boolean>>();
    result.labels.forEach((l, i) => {
      if (l < 0) return;
      const [x, y] = xy(i, width);
      const set = sides.get(l) ?? new Set<boolean>();
      set.add(x > y);
      sides.set(l, set);
    });
    for (const set of sides.values()) expect(set.size).toBe(1);
  });
});

describe('FR-676 minimum tile size', () => {
  it('FR-676 merges a tile under max(S, 0.1 x spacing^2) into the neighbour with the longest border', () => {
    const scene = ocean(200);
    const loose = tile(scene, configFromTile(25), { minPieceSize: 1 });
    const strict = tile(scene, configFromTile(25), { minPieceSize: 700 });
    expect(strict.merged.length).toBeGreaterThan(0);
    expect(strict.tiles.length).toBeLessThan(loose.tiles.length);
    expect(Math.min(...strict.tiles.map((t) => t.pixels))).toBeGreaterThanOrEqual(700);
  });

  it('FR-676 gives a piece under 30 pixels with no seed of its own to the nearest tile of its basin', () => {
    const scene = ocean(200);
    for (let y = 150; y < 152; y++) for (let x = 150; x < 152; x++) scene.pixels[y * 200 + x] = 1;
    for (let y = 100; y < 102; y++) for (let x = 100; x < 103; x++) scene.pixels[y * 200 + x] = 1;
    // an enclosed 2 x 2 puddle of the same basin cannot be, so make a land ring around a 3-pixel pool
    for (let y = 60; y < 65; y++) for (let x = 60; x < 65; x++) scene.pixels[y * 200 + x] = 1;
    for (let y = 61; y < 64; y++) scene.pixels[y * 200 + 62] = FIRST;
    const result = tile(scene, configFromTile(40));
    const pool = result.labels[61 * 200 + 62]!;
    expect(pool).toBeGreaterThanOrEqual(0);
    // the tile it joined is the one whose seed is nearest to the pool
    const nearest = result.tiles
      .map((t, i) => ({ i, d: Math.hypot(xy(t.seed, 200)[0] - 62, xy(t.seed, 200)[1] - 62) }))
      .sort((a, b) => a.d - b.d)[0]!.i;
    expect(pool).toBe(nearest);
  });
});

describe('FR-682 water that links to nothing', () => {
  it('FR-682 gives a piece enclosed in other land, which touches no territory and no other basin, the nearest tile of its basin and no tile of its own', () => {
    const scene = ocean(300);
    // a 15 x 15 pool of 225 pixels inside a ring of other land (value 0): bigger than a tiny piece, linked to nothing
    for (let y = 150; y < 170; y++) for (let x = 200; x < 220; x++) scene.pixels[y * 300 + x] = 0;
    for (let y = 152; y < 167; y++) for (let x = 202; x < 217; x++) scene.pixels[y * 300 + x] = FIRST;
    const result = tile(scene, configFromTile(40));
    const pool = result.labels[158 * 300 + 208]!;
    expect(pool).toBeGreaterThanOrEqual(0);
    const inPool = result.tiles.filter((t) => {
      const [x, y] = xy(t.seed, 300);
      return x >= 202 && x < 217 && y >= 152 && y < 167;
    });
    expect(inPool).toHaveLength(0);
    const nearest = result.tiles
      .map((t, i) => ({ i, d: Math.hypot(xy(t.seed, 300)[0] - 209.5, xy(t.seed, 300)[1] - 159.5) }))
      .sort((a, b) => a.d - b.d)[0]!.i;
    expect(pool).toBe(nearest);
  });

  it('FR-682 keeps a piece that touches a land territory as a tile of its own (it links the map)', () => {
    const scene = ocean(300);
    for (let y = 150; y < 170; y++) for (let x = 200; x < 220; x++) scene.pixels[y * 300 + x] = 1;
    for (let y = 152; y < 167; y++) for (let x = 202; x < 217; x++) scene.pixels[y * 300 + x] = FIRST;
    const result = tile(scene, configFromTile(40));
    const inPool = result.tiles.filter((t) => {
      const [x, y] = xy(t.seed, 300);
      return x >= 202 && x < 217 && y >= 152 && y < 167;
    });
    expect(inPool).toHaveLength(1);
  });
});

describe('FR-677, FR-678 order', () => {
  it('FR-677 lists the tiles basin by basin and, inside a basin, by the row-major position of the seed', () => {
    const width = 240;
    const pixels = new Uint32Array(width * width).fill(FIRST);
    for (let y = 0; y < width; y++) {
      pixels[y * width] = 1;
      for (let x = 120; x < width; x++) pixels[y * width + x] = FIRST + 1;
    }
    const result = tile({ width, pixels }, configFromTile(40), { basins: basinsOf(2) });
    const basins = result.tiles.map((t) => t.basin);
    expect(basins).toStrictEqual([...basins].sort((a, b) => a - b));
    expect(new Set(basins)).toStrictEqual(new Set([0, 1]));
    for (const b of [0, 1]) {
      const seeds = result.tiles.filter((t) => t.basin === b).map((t) => t.seed);
      expect(seeds).toStrictEqual([...seeds].sort((x, y) => x - y));
    }
  });

  it('FR-674 gives the same tiles for the same raster twice (NFR-175)', () => {
    const scene = ocean(180);
    const a = tile(scene, configFromTile(30));
    const b = tile(scene, configFromTile(30));
    expect(Array.from(a.labels)).toStrictEqual(Array.from(b.labels));
    expect(a.tiles).toStrictEqual(b.tiles);
  });
});

describe('FR-685 the guard', () => {
  it('FR-685 fails with too-many-tiles before any partition when the seeds exceed maxTiles', () => {
    const result = tileBasins({ width: 200, pixels: ocean(200).pixels, firstId: FIRST, basins: basinsOf(1), pixelKm: 1, minPieceSize: 1, maxTiles: 3, spacing: configFromTile(20) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    const error = result.errors[0]!;
    expect(error.kind).toBe('too-many-tiles');
    expect(error.cap).toBe(3);
    expect(error.count).toBeGreaterThan(3);
    expect(error.basins[0]!.basin).toBe(0);
  });
});

describe('FR-671 the search for tileKm', () => {
  it('FR-671 finds a whole-kilometre tile whose seed count is the largest not above the target', () => {
    const scene = ocean(300);
    const result = tile(scene, configFromTile(20), { spacing: { targetTiles: 40, frameKm: 300 } });
    expect(Number.isInteger(result.config.tileKm)).toBe(true);
    expect(result.seeds).toBeLessThanOrEqual(40);
    expect(result.seeds).toBeGreaterThan(25);
    // one kilometre smaller breaks the target (the search found the smallest tile that fits), unless it is the floor
    const smaller = tileBasins({ width: 300, pixels: scene.pixels, firstId: FIRST, basins: basinsOf(1), pixelKm: 1, minPieceSize: 1, maxTiles: 10_000, spacing: configFromTile(result.config.tileKm - 1) });
    if (smaller.ok && result.config.tileKm > 3) expect(smaller.value.seeds).toBeGreaterThanOrEqual(result.seeds);
  });

  it('FR-671 derives open, far, band and reach from the coast tile, and lets the author override them', () => {
    expect(configFromTile(24)).toStrictEqual({ tileKm: 24, openKm: 48, farKm: 96, bandKm: 24, reachKm: 144 });
    expect(configFromTile(24, { openKm: 30, reachKm: 100 })).toStrictEqual({ tileKm: 24, openKm: 30, farKm: 96, bandKm: 24, reachKm: 100 });
    const scene = ocean(300);
    const result = tile(scene, configFromTile(20), { spacing: { targetTiles: 40, frameKm: 300, overrides: { reachKm: 77 } } });
    expect(result.config.reachKm).toBe(77);
    expect(result.config.openKm).toBe(2 * result.config.tileKm);
  });

  it('FR-689 a spacing at least the frame side leaves every basin whole', () => {
    const scene = ocean(150);
    const result = tile(scene, configFromTile(400));
    expect(result.tiles).toHaveLength(1);
    expect(result.seeds).toBe(1);
  });
});
