import { describe, expect, it } from 'vitest';
import { SEED_KIND_ORDER } from '../src/core/errors';
import { WATER } from '../src/core/rasterize';
import { assignSeaZones, seedPixels } from '../src/core/sea';
import { unproject, type Frame, type ProjectionCenter } from '../src/core/projection';
import type { SeaSeed } from '../src/core/types';

/** '.' water, 'o' background (0), a digit = land territory id. */
function grid(rows: string[]): { width: number; pixels: Uint32Array } {
  const width = rows.length;
  const pixels = new Uint32Array(width * width);
  rows.forEach((row, y) => {
    expect(row.length).toBe(width);
    [...row].forEach((ch, x) => {
      pixels[y * width + x] = ch === '.' ? WATER : ch === 'o' ? 0 : Number(ch);
    });
  });
  return { width, pixels };
}

function show(pixels: Uint32Array, width: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < width; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const v = pixels[y * width + x]!;
      row += v === WATER ? '.' : v === 0 ? 'o' : v >= 10 ? String.fromCharCode(87 + v) : String(v);
    }
    rows.push(row);
  }
  return rows;
}

const CENTER: ProjectionCenter = { lon0: 0, lat0: 0 };
/** Pixel side 0.01 projected units: the centre of pixel (x, y) is far from every edge. */
function frameFor(width: number): Frame {
  return { west: -0.005 * width, north: 0.005 * width, side: 0.01 * width };
}

/** The seed whose projected point is the centre of pixel (x, y) of a W-pixel frame. */
function seedAt(width: number, x: number, y: number, name = `s${x}${y}`): SeaSeed {
  const f = frameFor(width);
  const [lon, lat] = unproject(CENTER, f.west + (x + 0.5) * 0.01, f.north - (y + 0.5) * 0.01);
  return { name, lon, lat };
}

describe('FR-116 seed pixels', () => {
  it('FR-116 a seed point lies in the pixel that contains it', () => {
    const { width, pixels } = grid(['....', '....', '....', '....']);
    const seeds = [seedAt(4, 3, 0), seedAt(4, 0, 2)];
    expect(seedPixels(seeds, CENTER, frameFor(4), width, pixels)).toStrictEqual({
      ok: true,
      value: [
        { x: 3, y: 0 },
        { x: 0, y: 2 },
      ],
    });
  });

  // Seed at (0, 0) on the unit sphere projects exactly to (0, 0); the frames below put it exactly
  // on pixel edges (pixel side 1).
  const origin: SeaSeed[] = [{ name: 'origen', lon: 0, lat: 0 }];
  const open = grid(['....', '....', '....', '....']);

  it('FR-116 a seed on a vertical and horizontal pixel edge lies in the pixel to its east and south', () => {
    const frame: Frame = { west: -2, north: 2, side: 4 };
    expect(seedPixels(origin, CENTER, frame, 4, open.pixels)).toStrictEqual({
      ok: true,
      value: [{ x: 2, y: 2 }],
    });
  });

  it('FR-116 a seed on a vertical edge only lies in the pixel to its east', () => {
    const frame: Frame = { west: -2, north: 2.5, side: 4 };
    expect(seedPixels(origin, CENTER, frame, 4, open.pixels)).toStrictEqual({
      ok: true,
      value: [{ x: 2, y: 2 }],
    });
  });

  it('FR-116 a seed on a horizontal edge only lies in the pixel to its south', () => {
    const frame: Frame = { west: -2.5, north: 2, side: 4 };
    expect(seedPixels(origin, CENTER, frame, 4, open.pixels)).toStrictEqual({
      ok: true,
      value: [{ x: 2, y: 2 }],
    });
  });

  it('FR-116 a seed on the west or north outer edge of the frame is inside, in pixel 0', () => {
    const frame: Frame = { west: 0, north: 0, side: 4 };
    expect(seedPixels(origin, CENTER, frame, 4, open.pixels)).toStrictEqual({
      ok: true,
      value: [{ x: 0, y: 0 }],
    });
  });

  it('FR-116 a seed on the east outer edge of the frame is seed-outside-frame', () => {
    const frame: Frame = { west: -4, north: 2, side: 4 };
    expect(seedPixels(origin, CENTER, frame, 4, open.pixels)).toStrictEqual({
      ok: false,
      errors: [{ kind: 'seed-outside-frame', seed: 0, name: 'origen' }],
    });
  });

  it('FR-116 a seed on the south outer edge of the frame is seed-outside-frame', () => {
    const frame: Frame = { west: -2, north: 4, side: 4 };
    expect(seedPixels(origin, CENTER, frame, 4, open.pixels)).toStrictEqual({
      ok: false,
      errors: [{ kind: 'seed-outside-frame', seed: 0, name: 'origen' }],
    });
  });

  it('FR-116 a seed beyond the west or north edge is seed-outside-frame', () => {
    const frame: Frame = { west: 0.5, north: -0.5, side: 4 };
    expect(seedPixels(origin, CENTER, frame, 4, open.pixels)).toStrictEqual({
      ok: false,
      errors: [{ kind: 'seed-outside-frame', seed: 0, name: 'origen' }],
    });
  });

  it('FR-116 an empty seed list is no-sea-seeds, with no data field and nothing else', () => {
    expect(seedPixels([], CENTER, frameFor(4), 4, open.pixels)).toStrictEqual({
      ok: false,
      errors: [{ kind: 'no-sea-seeds' }],
    });
  });

  it('FR-116 a seed on land or on other land is seed-not-water', () => {
    const { width, pixels } = grid(['.1o.', '....', '....', '....']);
    const seeds = [seedAt(4, 1, 0, 'tierra'), seedAt(4, 2, 0, 'fondo'), seedAt(4, 3, 0, 'mar')];
    expect(seedPixels(seeds, CENTER, frameFor(4), width, pixels)).toStrictEqual({
      ok: false,
      errors: [
        { kind: 'seed-not-water', seed: 0, name: 'tierra' },
        { kind: 'seed-not-water', seed: 1, name: 'fondo' },
      ],
    });
  });

  it('FR-116 seeds sharing a pixel are duplicate-seed-pixel with ascending positions and the pixel', () => {
    const seeds = [seedAt(4, 1, 1, 'a'), seedAt(4, 2, 2, 'b'), seedAt(4, 1, 1, 'c'), seedAt(4, 1, 1, 'd')];
    expect(seedPixels(seeds, CENTER, frameFor(4), 4, open.pixels)).toStrictEqual({
      ok: false,
      errors: [{ kind: 'duplicate-seed-pixel', seeds: [0, 2, 3], x: 1, y: 1 }],
    });
  });

  it('FR-116 two seeds in different pixels of the same water body are not duplicates', () => {
    const seeds = [seedAt(4, 1, 1), seedAt(4, 2, 1)];
    expect(seedPixels(seeds, CENTER, frameFor(4), 4, open.pixels).ok).toBe(true);
  });

  it('FR-116 a seed outside the frame is reported only as seed-outside-frame', () => {
    const f = frameFor(4);
    const [lon, lat] = unproject(CENTER, f.west - 1, f.north + 1);
    const seeds: SeaSeed[] = [{ name: 'lejos', lon, lat }];
    expect(seedPixels(seeds, CENTER, f, 4, open.pixels)).toStrictEqual({
      ok: false,
      errors: [{ kind: 'seed-outside-frame', seed: 0, name: 'lejos' }],
    });
  });

  it('FR-116 the seed error kinds are listed in the order no-sea-seeds, outside, not-water, duplicate', () => {
    expect(SEED_KIND_ORDER).toStrictEqual([
      'no-sea-seeds',
      'seed-outside-frame',
      'seed-not-water',
      'duplicate-seed-pixel',
    ]);
  });

  it('FR-116 errors come in kind order, then by seed position, whatever the seed order', () => {
    const { width, pixels } = grid(['.1..', '....', '....', '....']);
    const f = frameFor(4);
    const [lon, lat] = unproject(CENTER, f.west - 1, f.north + 1);
    const seeds: SeaSeed[] = [
      seedAt(4, 3, 3, 'dupA'), // 0: duplicate with 1
      seedAt(4, 3, 3, 'dupB'), // 1
      seedAt(4, 1, 0, 'tierra2'), // 2: not water
      { name: 'fuera2', lon, lat }, // 3: outside
      seedAt(4, 1, 0, 'tierra1'), // 4: not water (and duplicate of 2)
      { name: 'fuera1', lon, lat }, // 5: outside
      seedAt(4, 2, 2, 'ok'), // 6
    ];
    expect(seedPixels(seeds, CENTER, f, width, pixels)).toStrictEqual({
      ok: false,
      errors: [
        { kind: 'seed-outside-frame', seed: 3, name: 'fuera2' },
        { kind: 'seed-outside-frame', seed: 5, name: 'fuera1' },
        { kind: 'seed-not-water', seed: 2, name: 'tierra2' },
        { kind: 'seed-not-water', seed: 4, name: 'tierra1' },
        { kind: 'duplicate-seed-pixel', seeds: [0, 1], x: 3, y: 3 },
        { kind: 'duplicate-seed-pixel', seeds: [2, 4], x: 1, y: 0 },
      ],
    });
  });

  it('FR-116 duplicate pixels are ordered by the first seed named, not by pixel position', () => {
    const seeds = [seedAt(4, 3, 3, 'a'), seedAt(4, 0, 0, 'b'), seedAt(4, 0, 0, 'c'), seedAt(4, 3, 3, 'd')];
    const result = seedPixels(seeds, CENTER, frameFor(4), 4, open.pixels);
    expect(result).toStrictEqual({
      ok: false,
      errors: [
        { kind: 'duplicate-seed-pixel', seeds: [0, 3], x: 3, y: 3 },
        { kind: 'duplicate-seed-pixel', seeds: [1, 2], x: 0, y: 0 },
      ],
    });
  });
});

describe('FR-116 sea zones', () => {
  it('FR-116 each water pixel joins the seed reached in the fewest steps', () => {
    const { width, pixels } = grid(['......', '......', '......', '......', '......', '......']);
    const out = assignSeaZones(width, pixels, [{ x: 0, y: 0 }, { x: 5, y: 0 }], [7, 8]);
    expect(show(out, width)).toStrictEqual([
      '777888',
      '777888',
      '777888',
      '777888',
      '777888',
      '777888',
    ]);
  });

  it('FR-116 a tie goes to the seed listed first, whichever seed lies first in the image', () => {
    // Seed 0 (id 7) is at the right; seed 1 (id 8) at the left. The middle column is equidistant.
    const { width, pixels } = grid(['.....', '.....', '.....', '.....', '.....']);
    const out = assignSeaZones(width, pixels, [{ x: 4, y: 2 }, { x: 0, y: 2 }], [7, 8]);
    for (const row of show(out, width)) expect(row).toBe('88777');
  });

  it('FR-116 the tie rule is the minimum seed position, not the order of discovery', () => {
    // A queue that starts from the seeds in image order gives the tie pixels to seed 1 here.
    const rows = [
      '.......',
      '.......',
      '.......',
      '.......',
      '.......',
      '.......',
      '.......',
    ];
    const { width, pixels } = grid(rows);
    const seeds = [{ x: 6, y: 6 }, { x: 0, y: 0 }]; // seed 0 is LAST in row-major order
    const ids = [7, 8];
    const out = assignSeaZones(width, pixels, seeds, ids);
    const fifo = naiveFifo(width, pixels, seeds, ids);
    expect(show(fifo, width)).not.toStrictEqual(show(out, width));
    // Antidiagonal pixels are 6 steps from both seeds: all go to seed 0 (id 7).
    for (let i = 0; i < width; i++) expect(out[i * width + (6 - i)]).toBe(7);
  });

  it('FR-116 distance counts steps through water only, never straight lines', () => {
    // A wall at column 2 with a gap in the last row. Seed A (id 7) is 2 columns from (3,0) through
    // the wall but 10 steps around it; seed B (id 8) is 4 steps away.
    const { width, pixels } = grid(['..1..', '..1..', '..1..', '..1..', '.....']);
    const out = assignSeaZones(width, pixels, [{ x: 1, y: 0 }, { x: 3, y: 4 }], [7, 8]);
    expect(out[0 * width + 3]).toBe(8);
    expect(out[1 * width + 3]).toBe(8);
    // (1,3): 3 steps from A, 3 steps from B around the gap: the tie goes to A, listed first.
    expect(out[3 * width + 1]).toBe(7);
  });

  it('FR-116 water with no seed reachable (a lake) becomes background', () => {
    const { width, pixels } = grid(['...1.', '...1.', '1111.', '..1..', '..1..']);
    const out = assignSeaZones(width, pixels, [{ x: 0, y: 0 }], [7]);
    expect(show(out, width)).toStrictEqual(['7771o', '7771o', '1111o', 'oo1oo', 'oo1oo']);
  });

  it('FR-116 a water pixel touching a seed region only by a corner is not reachable', () => {
    const { width, pixels } = grid(['.1...', '1.111', '11111', '11111', '11111']);
    const out = assignSeaZones(width, pixels, [{ x: 0, y: 0 }], [7]);
    expect(show(out, width)).toStrictEqual(['71ooo', '1o111', '11111', '11111', '11111']);
  });

  it('FR-116 land and background pixels are left as they are and the input is not changed', () => {
    const { width, pixels } = grid(['1o..', '.2..', '..3.', '....']);
    const before = [...pixels];
    const out = assignSeaZones(width, pixels, [{ x: 3, y: 3 }], [9]);
    expect([...pixels]).toStrictEqual(before);
    expect(show(out, width)).toStrictEqual(['1o99', '9299', '9939', '9999']);
  });

  it('FR-116 the water of one body is split between two seeds by step distance', () => {
    const { width, pixels } = grid(['........', '........', '........', '........', '........', '........', '........', '........']);
    const out = assignSeaZones(width, pixels, [{ x: 1, y: 3 }, { x: 6, y: 3 }], [7, 8]);
    for (let y = 0; y < width; y++) {
      for (let x = 0; x < width; x++) {
        const d0 = Math.abs(x - 1) + Math.abs(y - 3);
        const d1 = Math.abs(x - 6) + Math.abs(y - 3);
        expect(out[y * width + x]).toBe(d0 <= d1 ? 7 : 8);
      }
    }
  });

  it('FR-116 each seed pixel takes the id of its own seed', () => {
    const { width, pixels } = grid(['....', '....', '....', '....']);
    const out = assignSeaZones(width, pixels, [{ x: 0, y: 0 }, { x: 3, y: 3 }, { x: 3, y: 0 }], [4, 5, 6]);
    expect(out[0]).toBe(4);
    expect(out[3 * width + 3]).toBe(5);
    expect(out[3]).toBe(6);
  });
});

/** Plain FIFO multi-source BFS, seeds queued in row-major order of their pixels (discarded design). */
function naiveFifo(
  width: number,
  pixels: Uint32Array,
  seeds: { x: number; y: number }[],
  ids: number[],
): Uint32Array {
  const out = pixels.slice();
  const order = seeds.map((s, i) => i).sort((a, b) => seeds[a]!.y * width + seeds[a]!.x - (seeds[b]!.y * width + seeds[b]!.x));
  const queue: number[] = [];
  for (const i of order) {
    const p = seeds[i]!.y * width + seeds[i]!.x;
    out[p] = ids[i]!;
    queue.push(p);
  }
  for (let h = 0; h < queue.length; h++) {
    const p = queue[h]!;
    const x = p % width;
    const y = (p - x) / width;
    const near: number[] = [];
    if (y > 0) near.push(p - width);
    if (y < width - 1) near.push(p + width);
    if (x > 0) near.push(p - 1);
    if (x < width - 1) near.push(p + 1);
    for (const q of near) {
      if (out[q] === WATER) {
        out[q] = out[p]!;
        queue.push(q);
      }
    }
  }
  return out;
}
