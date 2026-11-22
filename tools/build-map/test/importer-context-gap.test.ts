import { describe, expect, it } from 'vitest';
import { WATER } from '../src/core/rasterize';
import { closeContextGaps } from '../src/importer/context-gap';
import { assignSea, type SeaZone } from '../src/importer/sea-sources';
import type { InsetView, View, ViewSet } from '../src/importer/views';

/** A view whose pixel coordinates are the longitude and latitude themselves. */
function identity(side: number, kind: 'main' | 'inset' = 'main'): View {
  return { kind, projection: 'equal-earth', lon0: 0, lat0: 0, frame: { west: 0, north: 0, side }, side, plane: () => [0, 0], toUV: (lon, lat) => [lon, lat] };
}
function views(width: number, insets: InsetView[] = []): ViewSet {
  return { width, main: identity(width), mainUnits: [], insets };
}

/** A raster from rows of text: W water, . other land (value 0), digits land, letters sea-unit pixels (a = 100, b = 101). */
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
const isLand = (v: number): boolean => v >= 1 && v <= 9;

describe('FR-602 the gap between a land territory and other land', () => {
  it('FR-602 turns a strip of water between a land territory and other land into other land, never into water a zone can take', () => {
    const { width, pixels } = grid(Array(6).fill('W11W..') as string[]);
    expect(closeContextGaps(width, pixels, 2, isLand)).toBe(6);
    expect(show(pixels, width)).toStrictEqual(Array(6).fill('W11...'));
  });

  it('FR-602 closes a strip as wide as the gap and leaves a wider one, a strait, as water', () => {
    const rows = Array(7).fill('W1WWW..') as string[];
    const narrow = grid(rows);
    expect(closeContextGaps(narrow.width, narrow.pixels, 2, isLand)).toBe(0);
    expect(show(narrow.pixels, narrow.width)).toStrictEqual(rows);
    const wide = grid(rows);
    expect(closeContextGaps(wide.width, wide.pixels, 3, isLand)).toBe(21);
    expect(show(wide.pixels, wide.width)).toStrictEqual(Array(7).fill('W1.....'));
  });

  it('FR-602 leaves water between two land territories, between two pieces of other land, and open coast alone', () => {
    const { width, pixels } = grid(['WWWWWWWW', 'W11W22WW', 'W11W22WW', 'WWWWWWWW', 'WWWWWWWW', 'W..W..WW', 'W..W..WW', 'WWWWWWWW']);
    const before = [...pixels];
    // no water pixel has a land territory and other land both next to it: the rows between them are two pixels wide
    expect(closeContextGaps(width, pixels, 1, isLand)).toBe(0);
    expect([...pixels]).toStrictEqual(before);
  });

  it('FR-602 changes nothing at a gap of 0 and never touches a sea zone pixel', () => {
    const a = grid(['WWWWWW', 'W1WaWW', 'W1W.WW', 'WWWWWW', 'WWWWWW', 'WWWWWW']);
    const before = [...a.pixels];
    expect(closeContextGaps(a.width, a.pixels, 0, isLand)).toBe(0);
    expect([...a.pixels]).toStrictEqual(before);
    expect(closeContextGaps(a.width, a.pixels, 2, isLand)).toBeGreaterThan(0);
    expect(show(a.pixels, a.width)[1]![3]).toBe('a');
  });

  it('FR-598 keeps the strip out of every sea zone: it joins the other land, and the zone keeps only the open sea', () => {
    // two land territories on the border of other land; the open sea is on the west, and a one-pixel strip runs along the
    // border and is joined to the open sea at the south end
    const rows = ['WW11W....', 'WW11W....', 'WW11W....', 'WW22W....', 'WW22W....', 'WW22W....', 'WWWWW....', 'WWWWW....', 'WWWWW....'];
    const { width, pixels } = grid(rows);
    const zones: SeaZone[] = [{ id: 100, seed: { name: 'Open', lon: 0.5, lat: 0.5 } }];
    closeContextGaps(width, pixels, 2, isLand);
    const r = assignSea({ views: views(width), pixels, zones });
    if (!r.ok) throw new Error('expected a sea');
    const out = show(r.value.pixels, width);
    // the strip beside the territories is other land now, not zone 'a'
    expect(out.slice(0, 6).map((row) => row[4])).toStrictEqual(['.', '.', '.', '.', '.', '.']);
    // the west coast of the territories is still the zone
    expect(out.slice(0, 6).map((row) => row.slice(0, 2))).toStrictEqual(Array(6).fill('aa'));
  });
});

describe('FR-601 the water of an inset that holds a seed', () => {
  /** An inset whose rectangle covers x 4..7, y 4..7 of an 8 x 8 image; its own coordinates are the longitude - 50 and latitude - 60. */
  const inset = (): InsetView => ({
    ...identity(4, 'inset'),
    toUV: (lon, lat) => [lon - 50, lat - 60],
    kind: 'inset',
    index: 0,
    rect: { x: 4, y: 4, w: 4, h: 4 },
    units: [],
  });
  const water = Array(8).fill('WWWWWWWW') as string[];
  const run = (zones: SeaZone[], rows: string[] = water) => {
    const { width, pixels } = grid(rows);
    const r = assignSea({ views: views(width, [inset()]), pixels, zones });
    if (!r.ok) throw new Error(`expected a sea, got ${JSON.stringify(r.errors)}`);
    return show(r.value.pixels, width);
  };
  const outside: SeaZone = { id: 100, seed: { name: 'Outside', lon: 3.5, lat: 3.5 } };
  const inside: SeaZone = { id: 101, seed: { name: 'Inside', lon: 53.5, lat: 63.5 } };

  it('FR-601 gives the water inside the rectangle only to the zones whose seed is inside it, even where a zone outside is nearer', () => {
    // the outside seed touches the rectangle's corner; the inside seed is at its far corner: the rectangle is the inside zone's
    expect(run([outside, inside])).toStrictEqual(['aaaaaaaa', 'aaaaaaaa', 'aaaaaaaa', 'aaaaaaaa', 'aaaabbbb', 'aaaabbbb', 'aaaabbbb', 'aaaabbbb']);
  });

  it('FR-601 keeps the old rule for a rectangle without a seed: its water joins the zone reached through the main water', () => {
    expect(run([outside])).toStrictEqual(Array(8).fill('aaaaaaaa'));
  });

  it('FR-601 still gives water the inside seed cannot reach, an enclosed pocket, to the nearest zone', () => {
    // a wall of land splits the rectangle: the pocket on the left has no seed in it and joins the nearest zone, the outside one
    const rows = ['WWWWWWWW', 'WWWWWWWW', 'WWWWWWWW', 'WWWWWWWW', 'WWWWW1WW', 'WWWWW1WW', 'WWWWW1WW', 'WWWWW1WW'];
    const out = run([outside, inside], rows);
    expect(out.slice(4)).toStrictEqual(Array(4).fill('aaaaa1bb'.slice(0, 8)));
  });
});
