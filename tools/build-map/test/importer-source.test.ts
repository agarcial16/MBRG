import { describe, expect, it } from 'vitest';
import { readSource } from '../src/importer/read-source';
import { bytesOf, collection, crsOf, feat, multi, polygon, ring, textBytes } from './helpers/geo-fixture';

const read = (value: unknown) => readSource({ file: 'a.geojson', bytes: bytesOf(value) }, { usedProperties: [] });
const readText = (text: string) => readSource({ file: 'a.geojson', bytes: textBytes(text) }, { usedProperties: [] });

function ok(value: unknown) {
  const r = read(value);
  if (!r.ok) throw new Error(`expected a read, got ${JSON.stringify(r.errors)}`);
  return r.value;
}
function errors(value: unknown): Record<string, unknown>[] {
  const r = read(value);
  if (r.ok) throw new Error('expected errors');
  return r.errors as unknown as Record<string, unknown>[];
}

describe('FR-587 the GeoJSON source reader: what it accepts', () => {
  it('reads a feature collection of polygons and multipolygons, keeping the file index of every feature', () => {
    const source = ok(
      collection([feat({ id: 'a', n: 1 }, polygon(0, 0)), feat({ id: 'b' }, multi([2, 0], [4, 0, 2]))]),
    );
    expect(source.file).toBe('a.geojson');
    expect(source.features.map((f) => f.index)).toStrictEqual([0, 1]);
    expect(source.features[0]!.props).toStrictEqual({ id: 'a', n: 1 });
    expect(source.features[0]!.polygons).toHaveLength(1);
    expect(source.features[0]!.polygons[0]!.outer.coords).toStrictEqual(ring(0, 0));
    expect(source.features[1]!.polygons).toHaveLength(2);
    expect(source.skippedNull).toBe(0);
    expect(source.positions).toBe(15);
  });

  it('splits the rings of a polygon into its outer ring and its holes', () => {
    const rings = [ring(0, 0, 10), ring(2, 2, 2), ring(6, 6, 2)];
    const source = ok(collection([feat({}, { type: 'Polygon', coordinates: rings })]));
    const p = source.features[0]!.polygons[0]!;
    expect(p.outer.coords).toStrictEqual(rings[0]);
    expect(p.holes.map((h) => h.coords)).toStrictEqual([rings[1], rings[2]]);
  });

  it('reads properties null as an empty object', () => {
    const source = ok(collection([feat(null, polygon(0, 0))]));
    expect(source.features[0]!.props).toStrictEqual({});
  });

  it('reads a position on its first two numbers and ignores a third or later one', () => {
    const source = ok(
      collection([feat({}, { type: 'Polygon', coordinates: [[[0, 0, 5], [1, 0, 6, 7], [1, 1, 8], [0, 0, 9]]] })]),
    );
    expect(source.features[0]!.polygons[0]!.outer.coords).toStrictEqual([[0, 0], [1, 0], [1, 1], [0, 0]]);
  });

  it('skips a feature with a null geometry, counts it and keeps the file index of the others', () => {
    const source = ok(collection([feat({ a: 1 }, null), feat({ a: 2 }, polygon(0, 0)), feat({ a: 3 }, null)]));
    expect(source.skippedNull).toBe(2);
    expect(source.features.map((f) => f.index)).toStrictEqual([1]);
  });

  it('reports the longitude and latitude range of the positions read, and none for an empty source', () => {
    const source = ok(collection([feat({}, polygon(-3, 40, 2)), feat({}, polygon(10, -5, 1))]));
    expect(source.extent).toStrictEqual({ west: -3, south: -5, east: 11, north: 42 });
    expect(ok(collection([feat({}, null)])).extent).toBeNull();
  });

  it('accepts the three coordinate reference system names and no member at all', () => {
    for (const name of ['urn:ogc:def:crs:OGC:1.3:CRS84', 'EPSG:4326', 'EPSG:4258']) {
      expect(read(collection([feat({}, polygon(0, 0))], crsOf(name))).ok, name).toBe(true);
    }
    expect(read(collection([feat({}, polygon(0, 0))])).ok).toBe(true);
  });

  it('accepts a longitude of exactly 180 and a latitude of exactly 90, on both sides', () => {
    const g = { type: 'Polygon', coordinates: [[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]] };
    expect(read(collection([feat({}, g)])).ok).toBe(true);
  });

  it('gives the same read twice on the same bytes', () => {
    const bytes = bytesOf(collection([feat({ a: 'x' }, multi([0, 0], [3, 3]))]));
    const a = readSource({ file: 'f', bytes }, { usedProperties: [] });
    const b = readSource({ file: 'f', bytes }, { usedProperties: [] });
    expect(a).toStrictEqual(b);
  });
});

describe('FR-587 the GeoJSON source reader: what it refuses', () => {
  it('refuses a geometry that is not a polygon or a multipolygon, naming the feature index and the type', () => {
    const errs = errors(
      collection([
        feat({}, polygon(0, 0)),
        feat({}, { type: 'Point', coordinates: [0, 0] }),
        feat({}, { type: 'LineString', coordinates: [[0, 0], [1, 1]] }),
        feat({}, { type: 'GeometryCollection', geometries: [] }),
        feat({}, { type: 'MultiPoint', coordinates: [] }),
        feat({}, { type: 'MultiLineString', coordinates: [] }),
        feat({}, { coordinates: [] }),
      ]),
    );
    expect(errs).toStrictEqual([
      { kind: 'unsupported-geometry', file: 'a.geojson', feature: 1, type: 'Point' },
      { kind: 'unsupported-geometry', file: 'a.geojson', feature: 2, type: 'LineString' },
      { kind: 'unsupported-geometry', file: 'a.geojson', feature: 3, type: 'GeometryCollection' },
      { kind: 'unsupported-geometry', file: 'a.geojson', feature: 4, type: 'MultiPoint' },
      { kind: 'unsupported-geometry', file: 'a.geojson', feature: 5, type: 'MultiLineString' },
      { kind: 'unsupported-geometry', file: 'a.geojson', feature: 6, type: 'unknown' },
    ]);
  });

  it('refuses any coordinate reference system other than the three named ones', () => {
    for (const name of ['EPSG:3857', 'EPSG:32630', 'urn:ogc:def:crs:EPSG::25830', 'epsg:4326', '']) {
      const errs = errors(collection([feat({}, polygon(0, 0))], crsOf(name)));
      expect(errs, name).toStrictEqual([{ kind: 'unsupported-crs', file: 'a.geojson', crs: name }]);
    }
    // a crs member that names nothing readable is refused too, with an empty name
    expect(errors(collection([feat({}, polygon(0, 0))], { crs: null }))).toStrictEqual([
      { kind: 'unsupported-crs', file: 'a.geojson', crs: '' },
    ]);
    expect(errors(collection([feat({}, polygon(0, 0))], { crs: { type: 'name', properties: {} } }))).toStrictEqual([
      { kind: 'unsupported-crs', file: 'a.geojson', crs: '' },
    ]);
  });

  it('refuses a source in projected metres (a UTM-looking fixture) and names the first feature', () => {
    const utm = (x: number, y: number) => ({
      type: 'Polygon',
      coordinates: [[[x, y], [x + 1000, y], [x + 1000, y + 1000], [x, y + 1000], [x, y]]],
    });
    const errs = errors(
      collection([feat({}, polygon(0, 0)), feat({}, utm(500000, 4649776)), feat({}, utm(510000, 4649776))]),
    );
    expect(errs).toStrictEqual([{ kind: 'coordinates-not-degrees', file: 'a.geojson', feature: 1 }]);
  });

  it('refuses a longitude outside -180..180 and a latitude outside -90..90, however slightly', () => {
    const at = (lon: number, lat: number) => ({ type: 'Polygon', coordinates: [[[lon, lat], [0, 0], [1, 1], [lon, lat]]] });
    for (const [lon, lat] of [[180.0001, 0], [-180.0001, 0], [0, 90.0001], [0, -90.0001]] as const) {
      expect(errors(collection([feat({}, at(lon, lat))])), `${lon},${lat}`).toStrictEqual([
        { kind: 'coordinates-not-degrees', file: 'a.geojson', feature: 0 },
      ]);
    }
  });

  it('refuses bytes that are not UTF-8, text that is not JSON and JSON that is not a feature collection', () => {
    const bad = readSource({ file: 'a.geojson', bytes: Uint8Array.of(0x7b, 0xff, 0xfe, 0x7d) }, { usedProperties: [] });
    expect(bad.ok ? [] : bad.errors).toStrictEqual([{ kind: 'invalid-source', file: 'a.geojson', reason: 'not-utf8' }]);
    const notJson = readText('{"type": "FeatureCollection", ');
    expect(notJson.ok ? [] : notJson.errors).toStrictEqual([{ kind: 'invalid-source', file: 'a.geojson', reason: 'not-json' }]);
    for (const value of [
      [],
      'text',
      7,
      null,
      {},
      { type: 'Feature', properties: {}, geometry: null },
      { type: 'FeatureCollection' },
      { type: 'FeatureCollection', features: {} },
    ]) {
      expect(errors(value), JSON.stringify(value)).toStrictEqual([
        { kind: 'invalid-source', file: 'a.geojson', reason: 'not-feature-collection' },
      ]);
    }
  });

  it('refuses a feature without a properties member, with properties that are no object, or that is no feature', () => {
    for (const f of [
      { type: 'Feature', geometry: polygon(0, 0) },
      { type: 'Feature', properties: [], geometry: polygon(0, 0) },
      { type: 'Feature', properties: 'x', geometry: polygon(0, 0) },
      { type: 'Feature', properties: {} },
      { type: 'Point' },
      7,
      null,
    ]) {
      expect(errors(collection([f])), JSON.stringify(f)).toStrictEqual([
        { kind: 'invalid-source', file: 'a.geojson', reason: 'bad-feature', feature: 0 },
      ]);
    }
  });

  it('refuses coordinates that are no numbers, no rings or no positions of two numbers', () => {
    for (const coordinates of ['x', [[1, 2]], [[[0, 0], [1]]], [[[0, 0], ['1', 2]]], [[[0, 0], [null, 2]]], [[[0, 0], 'p']]]) {
      expect(errors(collection([feat({}, { type: 'Polygon', coordinates })])), JSON.stringify(coordinates)).toStrictEqual([
        { kind: 'invalid-source', file: 'a.geojson', reason: 'bad-geometry', feature: 0 },
      ]);
    }
    expect(errors(collection([feat({}, { type: 'MultiPolygon', coordinates: [5] })]))).toStrictEqual([
      { kind: 'invalid-source', file: 'a.geojson', reason: 'bad-geometry', feature: 0 },
    ]);
    expect(errors(collection([feat({}, 'polygon')]))).toStrictEqual([
      { kind: 'invalid-source', file: 'a.geojson', reason: 'bad-geometry', feature: 0 },
    ]);
  });
});

describe('FR-587 the GeoJSON source reader: the own-property rule on untrusted data', () => {
  function withInherited<T>(members: Record<string, unknown>, body: () => T): T {
    for (const [k, v] of Object.entries(members)) {
      Object.defineProperty(Object.prototype, k, { value: v, configurable: true, writable: true });
    }
    try {
      return body();
    } finally {
      for (const k of Object.keys(members)) delete (Object.prototype as Record<string, unknown>)[k];
    }
  }

  it('never reads type, features, properties, geometry, coordinates or crs through the prototype chain', () => {
    const polluted = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring(0, 0)] } }],
      properties: {},
      geometry: { type: 'Polygon', coordinates: [ring(0, 0)] },
      coordinates: [ring(0, 0)],
    };
    // an empty object is no collection, even when the prototype would complete it
    const r = withInherited(polluted, () => readText('{}'));
    expect(r.ok ? [] : r.errors).toStrictEqual([{ kind: 'invalid-source', file: 'a.geojson', reason: 'not-feature-collection' }]);
    // a feature with a geometry only on the prototype has no geometry member: refused
    const r2 = withInherited(polluted, () =>
      readText('{"type":"FeatureCollection","features":[{"type":"Feature","properties":{}}]}'),
    );
    expect(r2.ok ? [] : r2.errors).toStrictEqual([
      { kind: 'invalid-source', file: 'a.geojson', reason: 'bad-feature', feature: 0 },
    ]);
    // an inherited crs member is never read
    const r3 = withInherited({ crs: { type: 'name', properties: { name: 'EPSG:3857' } } }, () =>
      readText('{"type":"FeatureCollection","features":[]}'),
    );
    expect(r3.ok).toBe(true);
  });

  it('keeps a property named __proto__ as plain data and never lets it change the prototype', () => {
    const r = readText(
      '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"__proto__":{"x":1},"a":2},"geometry":null}]}',
    );
    expect(r.ok).toBe(true);
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });
});
