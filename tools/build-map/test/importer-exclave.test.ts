import { contactPairs } from '@mbrg/shared';
import { describe, expect, it } from 'vitest';
import { bridgeExclaves, type ExclaveInput } from '../src/importer/exclave';

/** A raster from rows of text: . other land (0), digits land territories (1..9), letters sea zones (a = 100, b = 101). */
function grid(rows: string[]): { width: number; pixels: Uint32Array } {
  const width = rows.length;
  const pixels = new Uint32Array(width * width);
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`the fixture must be square: row ${y} has ${row.length} of ${width}`);
    [...row].forEach((ch, x) => (pixels[y * width + x] = ch === '.' ? 0 : /\d/.test(ch) ? Number(ch) : 100 + ch.charCodeAt(0) - 97));
  });
  return { width, pixels };
}
function show(pixels: Uint32Array, width: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < width; y++) {
    rows.push([...pixels.subarray(y * width, (y + 1) * width)].map((v) => (v === 0 ? '.' : v >= 100 ? String.fromCharCode(97 + v - 100) : String(v))).join(''));
  }
  return rows;
}
const blank = (n: number): string[] => Array(n).fill('.'.repeat(n)) as string[];
/** A square of `.` with the given rectangles written over it: [x0, y0, x1, y1 (inclusive), char]. */
function paint(n: number, ...rects: [number, number, number, number, string][]): string[] {
  const rows = blank(n).map((r) => [...r]);
  for (const [x0, y0, x1, y1, ch] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) rows[y]![x] = ch;
  return rows.map((r) => r.join(''));
}
const input = (rows: string[], extra: Partial<ExclaveInput> = {}): ExclaveInput => {
  const { width, pixels } = grid(rows);
  const present = new Set(pixels);
  const landIds = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((id) => present.has(id));
  const seaIds = [100, 101].filter((id) => present.has(id));
  return { width, pixels, landIds, seaIds, reach: 64, links: 3, ...extra };
};
const links = (pixels: Uint32Array, width: number): string[] =>
  (contactPairs(width, width, pixels) as { ok: true; value: [number, number][] }).value.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`).sort();
const neighbours = (pixels: Uint32Array, width: number, id: number): number[] =>
  links(pixels, width)
    .map((k) => k.split('-').map(Number) as [number, number])
    .flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []))
    .sort((x, y) => x - y);

describe('FR-602 an exclave group is bridged to the nearest territories of the main group', () => {
  it('FR-602 paints a 4-connected line of the exclave over other land from its nearest pixel to the nearest territory', () => {
    const rows = paint(12, [0, 0, 2, 11, '1'], [8, 5, 9, 6, '3']);
    const r = input(rows);
    const result = bridgeExclaves(r);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(show(r.pixels, r.width)[5]).toBe('111' + '3'.repeat(7) + '..');
    expect(show(r.pixels, r.width)[4]).toBe('111' + '.'.repeat(9));
    expect(result.bridges).toStrictEqual([{ from: 3, to: 1, pixels: 5, water: 0, distance: 6 }]);
    expect(links(r.pixels, r.width)).toStrictEqual(['1-3']);
  });

  it('FR-602 changes nothing when the map is connected', () => {
    const rows = paint(12, [0, 0, 2, 11, '1'], [3, 5, 4, 6, '3']);
    const r = input(rows);
    const before = [...r.pixels];
    const result = bridgeExclaves(r);
    expect(result).toStrictEqual({ ok: true, bridges: [] });
    expect([...r.pixels]).toStrictEqual(before);
  });

  it('FR-602 links to the three nearest territories only, nearest first', () => {
    // a ring of four territories (top 1, right 2, bottom 3, left 4) and the exclave 5 at (5, 3): 3, 9, 11 and 5 pixels away
    const rows = paint(15, [0, 0, 13, 0, '1'], [14, 0, 14, 14, '2'], [0, 14, 13, 14, '3'], [0, 1, 0, 13, '4'], [5, 3, 5, 3, '5']);
    const r = input(rows);
    const result = bridgeExclaves(r);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.bridges.map((b) => b.to)).toStrictEqual([1, 4, 2]);
    expect(neighbours(r.pixels, r.width, 5)).toStrictEqual([1, 2, 4]);
  });

  it('FR-602 fails with unreachable-exclave when no territory of the main group lies within the reach', () => {
    const rows = paint(12, [0, 0, 1, 11, '1'], [10, 5, 11, 6, '3']);
    const r = input(rows, { reach: 5 });
    const before = [...r.pixels];
    expect(bridgeExclaves(r)).toStrictEqual({ ok: false, errors: [{ kind: 'unreachable-exclave', territories: [3], reach: 5 }] });
    expect([...r.pixels]).toStrictEqual(before);
  });

  it('FR-602 does nothing at a reach of 0', () => {
    const rows = paint(12, [0, 0, 2, 11, '1'], [8, 5, 9, 6, '3']);
    const r = input(rows, { reach: 0 });
    const before = [...r.pixels];
    expect(bridgeExclaves(r)).toStrictEqual({ ok: true, bridges: [] });
    expect([...r.pixels]).toStrictEqual(before);
  });

  it('FR-602 stops a line at the first land territory it meets and never paints over land', () => {
    // territory 2 sits between the exclave 3 and territory 1 and is linked to 1: the line to 1 would cross 2, so 2 takes the link
    const rows = paint(14, [0, 0, 2, 13, '1'], [3, 5, 4, 6, '2'], [10, 5, 11, 6, '3']);
    const r = input(rows);
    const result = bridgeExclaves(r);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.bridges.map((b) => b.to)).toStrictEqual([2]);
    expect(show(r.pixels, r.width)[5]).toBe('111' + '22' + '3'.repeat(7) + '..');
    expect(links(r.pixels, r.width)).toStrictEqual(['1-2', '2-3']);
  });

  it('FR-602 bridges one exclave group to the nearest bridged group when no main territory is in reach', () => {
    const rows = paint(24, [0, 0, 1, 23, '1'], [10, 11, 11, 12, '3'], [20, 11, 21, 12, '4']);
    const r = input(rows, { reach: 10 });
    const result = bridgeExclaves(r);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.bridges.map((b) => [b.from, b.to])).toStrictEqual([[3, 1], [4, 3]]);
    expect(links(r.pixels, r.width)).toStrictEqual(['1-3', '3-4']);
  });
});

describe('FR-602 a bridge across water leaves the sea zone whole', () => {
  // a strait of zone a between territory 1 and other land, a one-pixel-high bridge across it
  const rows = paint(12, [0, 0, 2, 11, '1'], [3, 0, 4, 11, 'a'], [9, 5, 10, 6, '3']);

  it('FR-602 keeps the zone one entry with the same neighbours: the bridge is flanked by other land so the exclave never touches the zone', () => {
    const r = input(rows);
    const beforeNeighbours = neighbours(r.pixels, r.width, 100);
    const seaPixels = (): number => r.pixels.filter((v) => v === 100).length;
    const seaBefore = seaPixels();
    const result = bridgeExclaves(r);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.bridges).toStrictEqual([{ from: 3, to: 1, pixels: 6, water: 2, distance: 7 }]);
    const out = show(r.pixels, r.width);
    expect(out[5]).toBe('111' + '3'.repeat(8) + '.');
    // the water above and below the bridge is other land, so the exclave has no contact with the zone
    expect(out[4]!.slice(3, 5)).toBe('..');
    expect(out[6]!.slice(3, 5)).toBe('..');
    expect(neighbours(r.pixels, r.width, 100)).toStrictEqual(beforeNeighbours);
    expect(neighbours(r.pixels, r.width, 3)).toStrictEqual([1]);
    // one id still (in two pieces, above and below the bridge): the line took 2 pixels and the flanks 4
    expect(seaPixels()).toBe(seaBefore - 2 - 4);
  });

  it('FR-602 gives the same bridge for the same input', () => {
    const a = input(rows);
    const b = input(rows);
    bridgeExclaves(a);
    bridgeExclaves(b);
    expect([...a.pixels]).toStrictEqual([...b.pixels]);
  });
});
