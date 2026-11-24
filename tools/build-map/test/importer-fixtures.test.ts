import { describe, expect, it } from 'vitest';
import { WATER } from '../src/core/rasterize';
import { buildViews, type InsetView, type View, type ViewSet } from '../src/importer/views';
import { extractGeo } from '../src/importer/extract-geo';
import { makeGapFill } from '../src/importer/gap-fill';
import { assignWater, type SeaZone } from '../src/importer/sea-sources';
import { readSource } from '../src/importer/read-source';
import { buildUnits } from '../src/importer/units';
import { parseCuration, type Curation } from '../src/importer/curation';
import { composePixels } from '../src/importer/pixels';
import type { ImportFeature, ShpGeometry } from '../src/importer/types';
import type { Unit } from '../src/importer/units';
import type { SourcePolygon } from '../src/core/types';
import { dbfRaw } from './helpers/dbf-fixture';
import { bytesOf, collection, feat, polygon, ring, textBytes } from './helpers/geo-fixture';

/**
 * NFR-138: the spec's fixture checklist, each item exercised directly here (and pinned by the tests named in
 * the comments, which hold the committed fixtures): a Windows-1252 DBF with a `.cpg`, a DBF without one, a
 * `.prj` in UTM, NUL-padded text, integer codes, a `null` geometry, overlapping and gapped polygons, a
 * property present on only some features, and a world source split at the antimeridian.
 */
describe('NFR-138 the fixtures mimic real sources', () => {
  const geometries: ShpGeometry[] = [{ type: 'Polygon', coordinates: [ring(0, 0) as [number, number][]] }];

  it('NFR-138 holds a Windows-1252 DBF with a .cpg, and decodes its euro sign (extract-geo.test.ts pins the reader)', () => {
    const dbf = dbfRaw([{ name: 'NAME', type: 'C', length: 12 }], [['Alfa€']], { enc: 'cp1252' });
    const r = extractGeo({ geometries, dbf, cpg: 'windows-1252' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(new TextDecoder().decode(r.value)).toContain('"NAME":"Alfa\u20ac"');
  });

  it('NFR-138 holds a DBF without a .cpg or an encoding, and refuses it (unknown-dbf-encoding)', () => {
    const dbf = dbfRaw([{ name: 'NAME', type: 'C', length: 6 }], [['abc']]);
    const r = extractGeo({ geometries, dbf });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toStrictEqual([{ kind: 'unknown-dbf-encoding', encoding: '' }]);
  });

  it('NFR-138 holds a .prj in UTM, and refuses a projected source (projected-crs)', () => {
    const dbf = dbfRaw([{ name: 'NAME', type: 'C', length: 6 }], [['abc']]);
    const r = extractGeo({ geometries, dbf, cpg: 'utf-8', prj: 'PROJCS["WGS 84 / UTM zone 30N",GEOGCS["WGS 84"]]' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toStrictEqual([{ kind: 'projected-crs' }]);
  });

  it('NFR-138 holds NUL-padded DBF text, and reads it without the padding (the Natural Earth quirk)', () => {
    const dbf = dbfRaw([{ name: 'NAME', type: 'C', length: 12 }], [['Alfa']], { pad: 0x00 });
    const r = extractGeo({ geometries, dbf, cpg: 'utf-8' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(new TextDecoder().decode(r.value)).toContain('"NAME":"Alfa"');
  });

  it('NFR-138 holds integer codes, and reads one as its shortest decimal text (units and select tests)', () => {
    const curation = parseCuration(
      textBytes(JSON.stringify({ primary: 'p', columns: { key: 'code', name: ['name'] }, params: { side: 64, margin: 0.02, minPieceSize: 1, projection: 'laea' } })),
      'c.json',
    );
    if (!curation.ok) throw new Error('the curation should parse');
    const feature = (index: number, props: Record<string, unknown>): ImportFeature => ({
      index,
      props,
      polygons: [{ outer: { coords: ring(index * 2, 0) as [number, number][] }, holes: [] }],
    });
    const r = buildUnits([feature(0, { code: 8019, name: 'a' }), feature(1, { code: '8019', name: 'a' })], curation.value);
    if (!r.ok) throw new Error('the units should form');
    // the integer 8019 and the text "8019" are one key
    expect(r.value.map((u) => u.key)).toStrictEqual(['8019']);
  });

  it('NFR-138 holds a null geometry, and skips and counts it (the source reader)', () => {
    const r = readSource({ file: 'a', bytes: bytesOf(collection([feat({ code: 'A' }, polygon(0, 0)), feat({ code: 'B' }, null)])) }, { usedProperties: [] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.features).toHaveLength(1);
      expect(r.value.skippedNull).toBe(1);
    }
  });

  it('NFR-138 holds overlapping polygons, and the first in map order wins every shared pixel (the pixel tests)', () => {
    // a view whose pixel coordinates are the longitude and latitude themselves
    const identity = (side: number): View => ({ kind: 'main', projection: 'laea', lon0: 0, lat0: 0, frame: { west: 0, north: 0, side }, side, plane: () => [0, 0], toUV: (lon, lat) => [lon, lat] });
    const rect = (a: number, b: number, c: number, d: number): SourcePolygon => ({ outer: { coords: [[a, b], [c, b], [c, d], [a, d], [a, b]] as [number, number][] }, holes: [] });
    const unit = (key: string, polygons: SourcePolygon[]): Unit => ({ key, features: [], firstFeature: 0, polygons, sourceName: key, name: key, kind: 'land', territory: undefined, faction: undefined, layer: undefined });
    const a = unit('A', [rect(1, 1, 5, 5)]);
    const b = unit('B', [rect(3, 3, 7, 7)]);
    const views: ViewSet = { width: 8, main: identity(8), mainUnits: [a, b], insets: [] };
    const r = composePixels({ views, land: [{ value: 1, units: [a] }, { value: 2, units: [b] }], seas: [], context: [], other: [] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const at = (x: number, y: number): number => r.value[y * 8 + x]!;
      // the overlap (3..4, 3..4) is the first territory's, never a blend
      expect(at(3, 3)).toBe(1);
      expect(at(4, 4)).toBe(1);
      expect(at(6, 6)).toBe(2);
    }
  });

  it('NFR-138 holds gapped polygons, and the gap fill gives a small enclosed gap to the land around it (the cleanup tests)', () => {
    // a one-pixel water gap between two land pieces, and no zone at all: the gap fill takes it
    const rows = ['11W11', '11W11', '11111'];
    const width = 5;
    const pixels = new Uint32Array(width * width);
    rows.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        pixels[y * width + x] = ch === 'W' ? WATER : ch === '1' ? 1 : 0;
      });
    });
    const gap = makeGapFill(width, 5, (value) => value === 1);
    const zones: SeaZone[] = [];
    const r = assignWater(width, pixels, zones, gap.between);
    expect(gap.filled).toStrictEqual([{ pixels: 2, territory: 1 }]);
    expect(r.pixels.filter((v) => v === WATER).length).toBe(0);
    expect(r.pixels[2]).toBe(1);
    expect(r.pixels[7]).toBe(1);
  });

  it('NFR-138 holds a property present on only some features, and a missing value is never compared (the units tests)', () => {
    const curation = parseCuration(
      textBytes(
        JSON.stringify({
          primary: 'p',
          columns: { key: 'code', name: ['name'] },
          select: [{ property: 'n', gte: 1 }],
          params: { side: 64, margin: 0.02, minPieceSize: 1, projection: 'laea' },
        }),
      ),
      'c.json',
    );
    if (!curation.ok) throw new Error('the curation should parse');
    const feature = (index: number, props: Record<string, unknown>): ImportFeature => ({
      index,
      props,
      polygons: [{ outer: { coords: ring(index * 2, 0) as [number, number][] }, holes: [] }],
    });
    // the first feature has n, the second does not: no conflict, and the value is read from the first that has it
    const r = buildUnits([feature(0, { code: 'A', name: 'a', n: 1 }), feature(1, { code: 'A', name: 'a' })], curation.value);
    expect(r.ok).toBe(true);
  });

  it('NFR-138 holds a world source split at the antimeridian, and takes the split ring as the band it covers (the view tests)', () => {
    const box = (west: number, south: number, east: number, north: number): SourcePolygon => ({
      outer: { coords: [[west, south], [east, south], [east, north], [west, north], [west, south]] as [number, number][] },
      holes: [],
    });
    const unit = (key: string, polygons: SourcePolygon[]): Unit => ({ key, features: [], firstFeature: 0, polygons, sourceName: key, name: key, kind: 'land', territory: undefined, faction: undefined, layer: undefined });
    const west = unit('W', [box(-180, -17, -178, -16)]);
    const east = unit('E', [box(20, -10, 30, 0)]);
    const r = buildViews({
      selected: [west, east],
      params: { side: 128, margin: 0.02, minPieceSize: 1, projection: 'equal-earth' },
      insets: [],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // the antimeridian vertex sits in the west: the frame spans -180 to +30, never a 358-degree stripe
      expect(r.value.main.frame.side).toBeLessThan(3.5);
    }
  });
});
