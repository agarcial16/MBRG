import { describe, expect, it } from 'vitest';
import { growFootprints } from '../src/core/footprint';
import { WATER } from '../src/core/rasterize';

/** A raster from rows of text: `.` water, `0` background land, digits and letters are land ids (a = 10, b = 11 ...). */
function raster(rows: string[]): { width: number; pixels: Uint32Array } {
  const width = rows[0]!.length;
  const pixels = new Uint32Array(width * rows.length);
  rows.forEach((row, y) => {
    expect(row.length).toBe(width);
    [...row].forEach((c, x) => {
      pixels[y * width + x] = c === '.' ? WATER : c === '0' ? 0 : parseInt(c, 36);
    });
  });
  return { width, pixels };
}

const count = (pixels: Uint32Array, id: number): number => pixels.reduce((n, v) => n + (v === id ? 1 : 0), 0);

function pixelsOf(width: number, pixels: Uint32Array, id: number): [number, number][] {
  const out: [number, number][] = [];
  pixels.forEach((v, i) => {
    if (v === id) out.push([i % width, Math.floor(i / width)]);
  });
  return out;
}

/** True when the pixels form one 4-connected piece. */
function connected(list: [number, number][]): boolean {
  if (list.length === 0) return false;
  const key = (x: number, y: number): string => `${x},${y}`;
  const left = new Set(list.map(([x, y]) => key(x, y)));
  const stack = [list[0]!];
  left.delete(key(...list[0]!));
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const k = key(x + dx, y + dy);
      if (left.delete(k)) stack.push([x + dx, y + dy]);
    }
  }
  return left.size === 0;
}

const open = (rows: number, cols: number): string[] => Array.from({ length: rows }, () => '.'.repeat(cols));

describe('FR-705 minimum footprint: a unit with fewer pixels than the minimum grows', () => {
  it('FR-705 gives a unit with no pixel the minimum, a connected blob around its anchor, in open water', () => {
    const { width, pixels } = raster(open(21, 21));
    const result = growFootprints(width, pixels, [1], [[10.5, 10.5]], 9);
    expect(count(result.pixels, 1)).toBe(9);
    const blob = pixelsOf(width, result.pixels, 1);
    expect(connected(blob)).toBe(true);
    // a disc around the anchor: every pixel within two pixels of its centre
    for (const [x, y] of blob) expect(Math.hypot(x + 0.5 - 10.5, y + 0.5 - 10.5)).toBeLessThanOrEqual(2);
  });

  it('FR-705 grows a one-pixel unit around that pixel, keeping it', () => {
    const rows = open(15, 15);
    rows[7] = '.......1.......';
    const { width, pixels } = raster(rows);
    const result = growFootprints(width, pixels, [1], [[0, 0]], 9);
    expect(count(result.pixels, 1)).toBe(9);
    expect(result.pixels[7 * width + 7]).toBe(1);
    expect(connected(pixelsOf(width, result.pixels, 1))).toBe(true);
  });

  it('FR-705 leaves a unit that already has the minimum untouched, and changes nothing when every unit has it', () => {
    const rows = open(9, 9);
    rows[4] = '....111..';
    rows[5] = '....111..';
    rows[6] = '....111..';
    const { width, pixels } = raster(rows);
    const result = growFootprints(width, pixels, [1], [[4, 4]], 9);
    expect(Array.from(result.pixels)).toStrictEqual(Array.from(pixels));
    expect(result.grown).toStrictEqual([]);
  });

  it('FR-705 never writes another land territory or the background when water is within reach, and returns a new array', () => {
    const rows = open(13, 13);
    rows[6] = '...1..2.......';
    rows[6] = rows[6]!.slice(0, 13);
    rows[3] = '0000000000000';
    const { width, pixels } = raster(rows);
    const before = Uint32Array.from(pixels);
    const result = growFootprints(width, pixels, [1, 2], [[0, 0], [0, 0]], 9);
    expect(Array.from(pixels)).toStrictEqual(Array.from(before));
    expect(count(result.pixels, 0)).toBe(13);
    expect(count(result.pixels, 1)).toBe(9);
    expect(count(result.pixels, 2)).toBe(9);
  });

  it('FR-705 never takes a pixel from another unit that is itself below the minimum', () => {
    const rows = open(7, 7);
    rows[3] = '...12..';
    const { width, pixels } = raster(rows);
    const result = growFootprints(width, pixels, [1, 2], [[3.5, 3.5], [4.5, 3.5]], 9);
    expect(result.pixels[3 * width + 3]).toBe(1);
    expect(result.pixels[3 * width + 4]).toBe(2);
    expect(count(result.pixels, 1)).toBe(9);
    expect(count(result.pixels, 2)).toBe(9);
  });

  it('FR-705 a landlocked unit with no water around takes pixels from a big neighbour, preferring water when it is near', () => {
    const rows = Array.from({ length: 13 }, () => '9'.repeat(13));
    rows[6] = '999999a999999';
    const { width, pixels } = raster(rows);
    const result = growFootprints(width, pixels, [10, 9], [[6.5, 6.5], [0, 0]], 9);
    expect(count(result.pixels, 10)).toBe(9);
    expect(count(result.pixels, 9)).toBe(169 - 9);
    expect(connected(pixelsOf(width, result.pixels, 10))).toBe(true);
  });

  it('FR-705 does not take from a neighbour that is itself small (below four times the minimum): a unit boxed in by one stays as it is', () => {
    const { width, pixels } = raster(['00000', '0bbb0', '0bab0', '0bbb0', '00000']);
    // b (id 11) has 8 pixels: at least the minimum of 4 but under 16, so it is no donor
    const result = growFootprints(width, pixels, [10, 11], [[2.5, 2.5], [0, 0]], 4);
    expect(count(result.pixels, 11)).toBe(8);
    expect(count(result.pixels, 10)).toBe(1);
    expect(result.grown).toStrictEqual([]);
  });

  it('FR-705 is deterministic and processes units in the order given: two units competing for the same water', () => {
    const rows = open(7, 11);
    rows[3] = '....1.2....';
    const { width, pixels } = raster(rows);
    const a = growFootprints(width, pixels, [1, 2], [[4.5, 3.5], [6.5, 3.5]], 9);
    const b = growFootprints(width, pixels, [1, 2], [[4.5, 3.5], [6.5, 3.5]], 9);
    expect(Array.from(a.pixels)).toStrictEqual(Array.from(b.pixels));
    expect(count(a.pixels, 1)).toBe(9);
    expect(count(a.pixels, 2)).toBe(9);
    expect(a.grown).toStrictEqual([{ id: 1, from: 1, to: 9 }, { id: 2, from: 1, to: 9 }]);
  });

  it('FR-705 clips at the image edge: a unit on the corner still reaches the minimum', () => {
    const rows = open(9, 9);
    rows[0] = '1........';
    const { width, pixels } = raster(rows);
    const result = growFootprints(width, pixels, [1], [[0, 0]], 9);
    expect(count(result.pixels, 1)).toBe(9);
    expect(connected(pixelsOf(width, result.pixels, 1))).toBe(true);
  });

  it('FR-705 works on a non-square raster (the height comes from the pixel count)', () => {
    const { width, pixels } = raster(open(5, 25));
    const result = growFootprints(width, pixels, [1], [[20.5, 2.5]], 9);
    expect(count(result.pixels, 1)).toBe(9);
    expect(result.pixels.length).toBe(125);
  });

  it('FR-705 uses the anchor only when the unit has no pixel: the centroid of its own pixels decides otherwise', () => {
    const rows = open(15, 15);
    rows[2] = '..1............';
    const { width, pixels } = raster(rows);
    const result = growFootprints(width, pixels, [1], [[12.5, 12.5]], 9);
    const blob = pixelsOf(width, result.pixels, 1);
    for (const [x, y] of blob) expect(Math.hypot(x - 2, y - 2)).toBeLessThanOrEqual(2.5);
  });

  it('FR-705 stops short, without error, when there is nothing it may claim', () => {
    const rows = Array.from({ length: 5 }, () => '00000');
    rows[2] = '00100';
    const { width, pixels } = raster(rows);
    const result = growFootprints(width, pixels, [1], [[2.5, 2.5]], 9);
    expect(count(result.pixels, 1)).toBe(1);
    expect(result.grown).toStrictEqual([]);
  });
});
