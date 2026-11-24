import { describe, expect, it } from 'vitest';
import type { SourcePolygon } from '../src/core/types';
import { dominantFeatures, nameFeatures, numberRepeatedNames, rasterizeNames, type NameFeature } from '../src/importer/tile-names';
import type { ImportFeature, ReadSource } from '../src/importer/types';
import type { View, ViewSet } from '../src/importer/views';

/** A polygon of a rectangle in view coordinates (the identity view: lon is the column, lat the row). */
function rect(u0: number, v0: number, u1: number, v1: number): SourcePolygon {
  return { outer: { coords: [[u0, v0], [u1, v0], [u1, v1], [u0, v1], [u0, v0]] }, holes: [] };
}

function source(features: { props: Record<string, unknown>; polygons: SourcePolygon[] }[]): ReadSource {
  const kept: ImportFeature[] = features.map((f, index) => ({ index, props: f.props, polygons: f.polygons }));
  return { file: 'names.json', features: kept, skippedNull: 0, positions: 0, extent: null };
}

function identityViews(width: number): ViewSet {
  const main: View = { kind: 'main', projection: 'laea', lon0: 0, lat0: 0, frame: { west: 0, north: 0, side: width }, side: width, plane: () => [0, 0], toUV: (lon, lat) => [lon, lat] };
  return { width, main, mainUnits: [], insets: [] };
}

describe('FR-694 the names file', () => {
  it('FR-694 takes the first of the name properties that is a valid name, and skips a feature with none', () => {
    const features = nameFeatures(
      source([
        { props: { name_es: 'mar de Alborán', name: 'Alboran Sea' }, polygons: [rect(0, 0, 4, 4)] },
        { props: { name_es: null, name: 'Bay of Plenty' }, polygons: [rect(0, 0, 2, 2)] },
        { props: { name_es: ' mal ', name: 'Also bad\u0007' }, polygons: [rect(0, 0, 1, 1)] },
        { props: {}, polygons: [rect(0, 0, 1, 1)] },
      ]),
      ['name_es', 'name'],
    );
    expect(features.map((f) => f.name)).toStrictEqual(['Bay of Plenty', 'mar de Alborán']);
  });

  it('FR-694 orders the features smallest area first, ties to the file position, holes taken away', () => {
    const holed: SourcePolygon = { outer: rect(0, 0, 10, 10).outer, holes: [rect(2, 2, 8, 8).outer] };
    const features = nameFeatures(
      source([
        { props: { name: 'big' }, polygons: [rect(0, 0, 10, 10)] },
        { props: { name: 'ring' }, polygons: [holed] },
        { props: { name: 'same-1' }, polygons: [rect(0, 0, 3, 3)] },
        { props: { name: 'same-2' }, polygons: [rect(5, 5, 8, 8)] },
      ]),
      ['name'],
    );
    expect(features.map((f) => f.name)).toStrictEqual(['same-1', 'same-2', 'ring', 'big']);
  });
});

describe('FR-679 the smallest polygon wins a pixel', () => {
  const sea = source([
    { props: { name: 'Mar Grande' }, polygons: [rect(0, 0, 8, 8)] },
    { props: { name: 'Bahía Chica' }, polygons: [rect(2, 2, 5, 5)] },
  ]);

  it('FR-679 gives a pixel inside a bay to the bay and the rest of the sea to the sea', () => {
    const features = nameFeatures(sea, ['name']);
    const { ranks } = rasterizeNames(identityViews(8), features);
    const at = (x: number, y: number): string | undefined => features[ranks[y * 8 + x]! - 1]?.name;
    expect(at(3, 3)).toBe('Bahía Chica');
    expect(at(0, 0)).toBe('Mar Grande');
    expect(at(7, 7)).toBe('Mar Grande');
  });

  it('FR-679 names a tile after the polygon that covers most of its pixels, and none when nothing covers it', () => {
    const features = nameFeatures(sea, ['name']);
    const { ranks } = rasterizeNames(identityViews(8), features);
    // tile 0 = the bay's pixels plus two of the sea; tile 1 = the sea's pixels only; tile 2 = a corner outside every polygon
    const labels = new Int32Array(64).fill(-1);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) labels[y * 8 + x] = x >= 2 && x < 5 && y >= 2 && y < 5 ? 0 : x < 8 && y < 8 ? 1 : -1;
    labels[0] = 0;
    labels[1] = 0;
    const best = dominantFeatures(labels, 2, ranks, features.length);
    expect(features[best[0]!]!.name).toBe('Bahía Chica');
    expect(features[best[1]!]!.name).toBe('Mar Grande');
    const empty = dominantFeatures(new Int32Array(64).fill(0), 1, new Uint32Array(64), features.length);
    expect(empty[0]).toBe(-1);
  });

  it('FR-679 breaks a tie between two polygons to the smaller one', () => {
    const both = nameFeatures(
      source([
        { props: { name: 'large' }, polygons: [rect(0, 0, 8, 8)] },
        { props: { name: 'small' }, polygons: [rect(0, 0, 4, 8)] },
      ]),
      ['name'],
    );
    const { ranks } = rasterizeNames(identityViews(8), both);
    const labels = new Int32Array(64).fill(0);
    const best = dominantFeatures(labels, 1, ranks, both.length);
    // half the pixels are 'small', half 'large': equal counts, the smaller polygon (lower rank) wins
    expect(both[best[0]!]!.name).toBe('small');
  });
});

describe('FR-679, FR-696 numbering repeated names', () => {
  it('FR-679 numbers a name used by several tiles from 1 in tile order, and leaves a name used once alone', () => {
    expect(numberRepeatedNames(['mar Balear', 'mar de Alborán', 'mar de Alborán', 'mar Balear', 'mar de Alborán'])).toStrictEqual([
      'mar Balear 1',
      'mar de Alborán 1',
      'mar de Alborán 2',
      'mar Balear 2',
      'mar de Alborán 3',
    ]);
    expect(numberRepeatedNames(['Estrecho', 'Golfo'])).toStrictEqual(['Estrecho', 'Golfo']);
  });

  it('FR-696 skips a number that another name of the map already holds, so every name stays unique', () => {
    const names = numberRepeatedNames(['Mar 2', 'Mar', 'Mar', 'Mar']);
    expect(names).toStrictEqual(['Mar 2', 'Mar 1', 'Mar 3', 'Mar 4']);
    expect(new Set(names).size).toBe(names.length);
    const clash = numberRepeatedNames(['A', 'A', 'A 1']);
    expect(new Set(clash).size).toBe(clash.length);
  });
});

describe('FR-694 a polygon a view cannot draw', () => {
  it('FR-694 skips a feature with an antimeridian edge in an equal-earth view, never failing', () => {
    const main: View = { kind: 'main', projection: 'equal-earth', lon0: 0, lat0: 0, frame: { west: 0, north: 0, side: 8 }, side: 8, plane: () => [0, 0], toUV: (lon, lat) => [lon, lat] };
    const views: ViewSet = { width: 8, main, mainUnits: [], insets: [] };
    const wide: NameFeature[] = nameFeatures(
      source([
        { props: { name: 'across' }, polygons: [rect(-170, 0, 170, 4)] },
        { props: { name: 'inside' }, polygons: [rect(1, 1, 3, 3)] },
      ]),
      ['name'],
    );
    const out = rasterizeNames(views, wide);
    expect(out.skipped).toStrictEqual([0]);
    const names = new Set(Array.from(out.ranks).filter((r) => r > 0).map((r) => wide[r - 1]!.name));
    expect(names).toStrictEqual(new Set(['inside']));
  });
});
