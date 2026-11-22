import { describe, expect, it } from 'vitest';
import { WATER } from '../src/core/rasterize';
import type { SourcePolygon } from '../src/core/types';
import { composePixels, type PixelInput } from '../src/importer/pixels';
import type { Unit } from '../src/importer/units';
import { buildViews, type InsetView, type View, type ViewSet } from '../src/importer/views';

/** A polygon of a rectangle in view coordinates: with the identity view below, lon is the column and lat the row. */
function rect(u0: number, v0: number, u1: number, v1: number, ...holes: [number, number, number, number][]): SourcePolygon {
  const ring = (a: number, b: number, c: number, d: number) => ({ coords: [[a, b], [c, b], [c, d], [a, d], [a, b]] as [number, number][] });
  return { outer: ring(u0, v0, u1, v1), holes: holes.map((h) => ring(...h)) };
}

function unit(key: string, polygons: SourcePolygon[], kind: 'land' | 'sea' = 'land'): Unit {
  return { key, features: [], firstFeature: 0, polygons, sourceName: key, name: key, kind, territory: undefined, faction: undefined, layer: undefined };
}

/** A view whose pixel coordinates are the longitude and latitude themselves. */
function identity(side: number, kind: 'main' | 'inset' = 'main', projection: 'laea' | 'equal-earth' = 'equal-earth', toUV: View['toUV'] = (lon, lat) => [lon, lat]): View {
  return { kind, projection, lon0: 0, lat0: 0, frame: { west: 0, north: 0, side }, side, plane: () => [0, 0], toUV };
}

function setOf(width: number, mainUnits: Unit[], insets: InsetView[] = [], main: View = identity(width)): ViewSet {
  return { width, main, mainUnits, insets };
}
/** An inset whose raster coordinates are the longitude and latitude minus 100: its units sit at 100 and above. */
function insetOf(index: number, r: { x: number; y: number; w: number; h: number }, units: Unit[]): InsetView {
  return { ...identity(Math.max(r.w, r.h), 'inset', 'equal-earth', (lon, lat) => [lon - 100, lat - 100]), kind: 'inset', index, rect: r, units };
}

function compose(input: Partial<PixelInput> & Pick<PixelInput, 'views'>): Uint32Array {
  const r = composePixels({ land: [], seas: [], context: [], other: [], ...input });
  if (!r.ok) throw new Error(`expected pixels, got ${JSON.stringify(r.errors)}`);
  return r.value;
}

/** The raster as rows of text: 'W' water, '.' other land, digits the value. */
function show(pixels: Uint32Array, width: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < width; y++) {
    rows.push([...pixels.subarray(y * width, (y + 1) * width)].map((v) => (v === WATER ? 'W' : v === 0 ? '.' : v > 9 ? '#' : String(v))).join(''));
  }
  return rows;
}

describe('FR-602 the pixels of the composed image', () => {
  const a = unit('A', [rect(1, 1, 4, 4)]);
  const b = unit('B', [rect(5, 1, 7, 4)]);

  it('FR-602 gives each pixel by its centre to the land territory that contains it and the rest to water', () => {
    const rows = show(compose({ views: setOf(8, [a, b]), land: [{ value: 1, units: [a] }, { value: 2, units: [b] }] }), 8);
    expect(rows).toStrictEqual(['WWWWWWWW', 'W111W22W', 'W111W22W', 'W111W22W', 'WWWWWWWW', 'WWWWWWWW', 'WWWWWWWW', 'WWWWWWWW']);
  });

  it('FR-602 takes the first territory in map order for a pixel in several, and decides a centre exactly on a shared edge the same way', () => {
    const left = unit('L', [rect(1, 1, 3.5, 4)]);
    const right = unit('R', [rect(3.5, 1, 6, 4)]);
    // column 3 has its centre at 3.5, on the shared edge: the boundary is inside both, so the first in map order has it
    const first = show(compose({ views: setOf(8, [left, right]), land: [{ value: 1, units: [left] }, { value: 2, units: [right] }] }), 8);
    expect(first[2]).toBe('W11122WW');
    const swapped = show(compose({ views: setOf(8, [left, right]), land: [{ value: 2, units: [right] }, { value: 1, units: [left] }] }), 8);
    expect(swapped[2]).toBe('W11222WW');
    // two territories over the same ground: the first wins every pixel, the second is never blended in
    const over = show(compose({ views: setOf(8, [a]), land: [{ value: 5, units: [a] }, { value: 6, units: [a] }] }), 8);
    expect(over[2]).toBe('W555WWWW');
    expect(over.join('')).not.toContain('6');
  });

  it('FR-602 keeps the pixel whose centre is on the edge of a hole and takes only the strict interior of the hole away', () => {
    const holed = unit('H', [rect(0, 0, 8, 8, [2.5, 2.5, 5.5, 5.5])]);
    const rows = show(compose({ views: setOf(8, [holed]), land: [{ value: 1, units: [holed] }] }), 8);
    // the hole's edges pass through the centres of columns and rows 2 and 5: those stay land; 3 and 4 are inside
    expect(rows).toStrictEqual(['11111111', '11111111', '11111111', '111WW111', '111WW111', '11111111', '11111111', '11111111']);
  });

  it('FR-602 draws other land as value 0, never as water: the context features, then the excluded and the unselected primary units', () => {
    const france = unit('FR', [rect(0, 0, 8, 1)]);
    const portugal = unit('PT', [rect(0, 6, 1, 8)]);
    const context = [[rect(7, 3, 8, 5)]];
    const rows = show(compose({ views: setOf(8, [a]), land: [{ value: 1, units: [a] }], context, other: [france, portugal] }), 8);
    expect(rows).toStrictEqual(['........', 'W111WWWW', 'W111WWWW', 'W111WWW.', 'WWWWWWW.', 'WWWWWWWW', '.WWWWWWW', '.WWWWWWW']);
  });

  it('FR-602 gives a pixel in land and in other land to the land territory: land layers come first', () => {
    const floor = unit('F', [rect(0, 0, 8, 8)]);
    const rows = show(compose({ views: setOf(8, [a]), land: [{ value: 1, units: [a] }], other: [floor] }), 8);
    expect(rows[2]).toBe('.111....');
    expect(rows[0]).toBe('........');
  });

  it('FR-602 drops a context polygon with a vertex beyond 90 degrees of arc of a Lambert view, and keeps it with Equal Earth', () => {
    const toUV: View['toUV'] = (lon, lat) => [lon / 40 + 4, 4 - lat / 40];
    const laea = setOf(8, [], [], identity(8, 'main', 'laea', toUV));
    const near = rect(20, -20, 40, 20);
    const far = rect(100, -20, 120, 20);
    // near covers column 4 of rows 3 and 4; far would cover column 6 of the same rows
    expect(show(compose({ views: laea, context: [[near], [far]] }), 8)).toStrictEqual(['WWWWWWWW', 'WWWWWWWW', 'WWWWWWWW', 'WWWW.WWW', 'WWWW.WWW', 'WWWWWWWW', 'WWWWWWWW', 'WWWWWWWW']);
    const earth = setOf(8, [], [], identity(8, 'main', 'equal-earth', toUV));
    expect(show(compose({ views: earth, context: [[far]] }), 8)).toStrictEqual(['WWWWWWWW', 'WWWWWWWW', 'WWWWWWWW', 'WWWWWW.W', 'WWWWWW.W', 'WWWWWWWW', 'WWWWWWWW', 'WWWWWWWW']);
  });

  it('FR-602 gives a sea unit the water pixels no land or other land has, to the first sea zone in order', () => {
    const wet = unit('WET', [rect(0, 0, 8, 3)], 'sea');
    const wetter = unit('WETTER', [rect(0, 2, 8, 6)], 'sea');
    const floor = unit('F', [rect(0, 0, 1, 8)]);
    const rows = show(
      compose({
        views: setOf(8, [a, wet, wetter]),
        land: [{ value: 1, units: [a] }],
        seas: [{ value: 7, units: [wet] }, { value: 8, units: [wetter] }],
        other: [floor],
      }),
      8,
    );
    // land and other land win inside a sea unit; a pixel in two zones belongs to the first in order
    expect(rows).toStrictEqual(['.7777777', '.1117777', '.1117777', '.1118888', '.8888888', '.8888888', '.WWWWWWW', '.WWWWWWW']);
  });

  it('FR-602 allows a view with no territory at all', () => {
    expect(show(compose({ views: setOf(4, []) }), 4)).toStrictEqual(['WWWW', 'WWWW', 'WWWW', 'WWWW']);
  });
});

describe('FR-589 the other land of context sources and unselected units', () => {
  it('FR-589 is one value-0 layer: context features in list order, then the other units, none of them ever selected or water', () => {
    const land = unit('L', [rect(2, 2, 4, 4)]);
    const spain = unit('ES', [rect(0, 0, 2, 8)]);
    const france = unit('FR', [rect(4, 0, 8, 2)]);
    const rows = show(
      compose({ views: setOf(8, [land]), land: [{ value: 1, units: [land] }], context: [[rect(6, 6, 8, 8)], [rect(5, 5, 7, 7)]], other: [spain, france] }),
      8,
    );
    expect(rows).toStrictEqual(['..WW....', '..WW....', '..11WWWW', '..11WWWW', '..WWWWWW', '..WWW..W', '..WWW...', '..WWWW..']);
  });
});

describe('FR-601 the composition of the insets', () => {
  const W = 12;
  const main = unit('M', [rect(0, 0, 3, 3)]);
  const island = unit('I', [rect(101, 101, 102, 102)]);

  it('FR-601 composes the main raster with every inset rectangle overwritten by the blitted window of the inset raster', () => {
    const inset = insetOf(0, { x: 6, y: 5, w: 3, h: 3 }, [island]);
    const rows = show(
      compose({ views: setOf(W, [main], [inset]), land: [{ value: 1, units: [main] }, { value: 2, units: [island] }], other: [unit('O', [rect(0, 0, 12, 12)])] }),
      W,
    );
    // the island sits in the rectangle (6..8, 5..7) from its own projection; around it the rectangle is water, not other land
    expect(rows.slice(5, 8).map((r) => r.slice(5, 10))).toStrictEqual(['.WWW.', '.W2W.', '.WWW.']);
    // the main part is untouched, the other land of the main projection is around the rectangle
    expect(rows[0]!.slice(0, 4)).toBe('111.');
    expect(rows[4]).toBe('.'.repeat(12));
  });

  it('FR-601 blits only the rectangle of a square raster larger than it, at (x, y)', () => {
    // a 5 x 2 rectangle: the raster is a 5 x 5 square, only its first two rows reach the image
    const wide = unit('WD', [rect(100, 100, 105, 105)]);
    const inset = insetOf(0, { x: 4, y: 8, w: 5, h: 2 }, [wide]);
    const rows = show(compose({ views: setOf(W, [], [inset]), land: [{ value: 3, units: [wide] }] }), W);
    expect(rows.map((r) => r.split('3').length - 1)).toStrictEqual([0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 0, 0]);
    expect(rows[8]!.indexOf('3')).toBe(4);
    expect(rows[10]).toBe('WWWWWWWWWWWW');
  });

  it('FR-601 reads the window of a tall rectangle with the stride of its square raster', () => {
    const tall = unit('TL', [rect(100, 100, 101.5, 105)]);
    const inset = insetOf(0, { x: 4, y: 2, w: 2, h: 5 }, [tall]);
    expect(inset.side).toBe(5);
    const rows = show(compose({ views: setOf(W, [], [inset]), land: [{ value: 3, units: [tall] }] }), W);
    expect(rows.slice(1, 8).map((r) => r.slice(3, 7))).toStrictEqual(['WWWW', 'W33W', 'W33W', 'W33W', 'W33W', 'W33W', 'WWWW']);
  });

  it('FR-601 draws a unit only in the views it belongs to', () => {
    const ghost = unit('G', [rect(9, 9, 10, 10)]);
    const inset = insetOf(0, { x: 0, y: 6, w: 2, h: 2 }, [ghost]);
    const rows = show(compose({ views: setOf(W, [], [inset]), land: [{ value: 3, units: [ghost] }] }), W);
    // the ghost belongs to the inset, whose projection puts it elsewhere: the main projection never draws it
    expect(rows.join('')).not.toContain('3');
  });

  it('FR-601 rasterizes an inset at its own side, never at the side of the image', () => {
    const inset = insetOf(0, { x: 8, y: 8, w: 2, h: 2 }, [island]);
    expect(inset.side).toBe(2);
    const r = composePixels({ views: setOf(W, [main], [inset]), land: [{ value: 1, units: [main] }, { value: 2, units: [island] }], seas: [], context: [], other: [] });
    expect(r.ok && r.value.length).toBe(W * W);
    expect(r.ok && show(r.value, W).slice(8, 10).map((row) => row.slice(8, 10))).toStrictEqual(['WW', 'W2']);
  });

  it('FR-601 fails inset-hides-land when the main projection gives a pixel of the rectangle to a selected land unit', () => {
    const inset = insetOf(0, { x: 2, y: 2, w: 3, h: 3 }, [island]);
    const r = composePixels({ views: setOf(W, [main], [inset]), land: [{ value: 1, units: [main] }, { value: 2, units: [island] }], seas: [], context: [], other: [] });
    expect(r).toStrictEqual({ ok: false, errors: [{ kind: 'inset-hides-land', inset: 0 }] });
    // other land under the rectangle is no land: it is overwritten
    const calm = composePixels({ views: setOf(W, [], [inset]), land: [{ value: 2, units: [island] }], seas: [], context: [], other: [main] });
    expect(calm.ok).toBe(true);
  });

  it('FR-601 composes the real views of the importer: the island is drawn from the inset projection at the rectangle', () => {
    const box = (w: number, s: number, e: number, n: number): SourcePolygon => ({ outer: { coords: [[w, s], [e, s], [e, n], [w, n], [w, s]] }, holes: [] });
    const spain = { ...unit('ES', [box(-9, 40, 3, 44)]), features: [{ index: 0, props: { region: 'M' }, polygons: [box(-9, 40, 3, 44)] }] };
    const canaries = { ...unit('IC', [box(-18, 27.5, -13.5, 29.5)]), features: [{ index: 0, props: { region: 'IC' }, polygons: [box(-18, 27.5, -13.5, 29.5)] }] };
    const built = buildViews({
      selected: [spain, canaries],
      params: { side: 256, margin: 0.02, minPieceSize: 4, projection: 'laea' },
      insets: [{ select: [{ property: 'region', eq: 'IC' }], at: [8, 6] }],
    });
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const pixels = compose({ views: built.value, land: [{ value: 1, units: [spain] }, { value: 2, units: [canaries] }] });
    const { x, y, w, h } = built.value.insets[0]!.rect;
    let inside = 0;
    let outside = 0;
    for (let row = 0; row < 256; row++) {
      for (let col = 0; col < 256; col++) {
        const v = pixels[row * 256 + col]!;
        if (v === 2) {
          if (col >= x && col < x + w && row >= y && row < y + h) inside++;
          else outside++;
        }
      }
    }
    expect(inside).toBeGreaterThan(1000);
    expect(outside).toBe(0);
    // Spain is in the main projection, outside the rectangle
    expect(pixels.filter((v) => v === 1).length).toBeGreaterThan(10000);
  });
});

describe('FR-602 the composition is deterministic', () => {
  it('FR-602 gives the same image for the same input', () => {
    const a = unit('A', [rect(1, 1, 4, 4)]);
    const input = { views: setOf(8, [a]), land: [{ value: 1, units: [a] }] };
    expect(compose(input)).toStrictEqual(compose(input));
  });
});

describe('FR-600 a ring split at the antimeridian rasterizes as the band it covers', () => {
  /** A closed rectangle ring in longitude and latitude degrees. */
  const lonBox = (west: number, south: number, east: number, north: number): SourcePolygon => ({
    outer: { coords: [[west, south], [east, south], [east, north], [west, north], [west, south]] },
    holes: [],
  });

  it('FR-600 draws the antimeridian vertex of a split ring on its ring\'s side: a narrow western band, never a globe stripe', () => {
    // the reviewer's probe at W = 128: a western polygon touching the antimeridian (widened so the band holds
    // whole pixels at this side), a far-east unit holding the frame at world scale
    const west = unit('W', [lonBox(-180, -17, -170, -15)]);
    const east = unit('E', [lonBox(20, -10, 30, 0)]);
    const built = buildViews({ selected: [west, east], params: { side: 128, margin: 0.02, minPieceSize: 1, projection: 'equal-earth' }, insets: [] });
    if (!built.ok) throw new Error(JSON.stringify(built.errors));
    const pixels = compose({ views: built.value, land: [{ value: 1, units: [west] }, { value: 2, units: [east] }] });
    const columnsOf = (value: number): { min: number; max: number; count: number } => {
      let min = 128;
      let max = -1;
      let count = 0;
      for (let i = 0; i < pixels.length; i++) {
        if (pixels[i] !== value) continue;
        count++;
        const col = i % 128;
        if (col < min) min = col;
        if (col > max) max = col;
      }
      return { min, max, count };
    };
    const band = columnsOf(1);
    // the band exists and is narrow and western (the broken ring paints ~124 columns, a 358-degree stripe)
    expect(band.count).toBeGreaterThan(0);
    expect(band.max - band.min).toBeLessThan(24);
    expect(band.min).toBeLessThan(32);
    // the east unit keeps its own ground: the stripe would have swallowed it
    expect(columnsOf(2).count).toBeGreaterThan(0);
  });
});
