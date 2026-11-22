import { describe, expect, it } from 'vitest';
import { readBounded, type ImportFs } from '../src/cli/import';
import { SOURCE_CAPS, readSource, readSources } from '../src/importer/read-source';
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

const MIB = 1024 * 1024;
const NULL_FEATURE = '{"type":"Feature","properties":null,"geometry":null}';
const nullFeatures = (n: number): Uint8Array =>
  textBytes(`{"type":"FeatureCollection","features":[${Array.from({ length: n }, () => NULL_FEATURE).join(',')}]}`);
const readAll = (inputs: { file: string; bytes: Uint8Array }[], usedProperties: string[] = [], caps = {}) =>
  readSources(inputs, { usedProperties, caps });
const capErrors = (r: ReturnType<typeof readAll>): Record<string, unknown>[] =>
  r.ok ? [] : (r.errors as unknown as Record<string, unknown>[]);

function fakeFs(size: number, bytes: Uint8Array, onRead: () => void = () => undefined): ImportFs {
  return {
    readFile: () => {
      onRead();
      return bytes;
    },
    writeFile: () => undefined,
    rename: () => undefined,
    unlink: () => undefined,
    mkdir: () => undefined,
    size: () => size,
  };
}

describe('FR-588 the source caps', () => {
  it('FR-588 the caps are 256 MiB, 100,000 features, 20,000,000 positions, 256 properties and 1,024 code units', () => {
    expect(SOURCE_CAPS).toStrictEqual({ bytes: 256 * MIB, features: 100_000, positions: 20_000_000, properties: 256, value: 1024 });
  });

  it('FR-588 a source over 256 MiB fails before parsing: no byte of it is read, decoded or parsed', () => {
    const trap = new Proxy(
      {},
      {
        get(_t, key) {
          if (key === 'length') return 300 * MIB;
          throw new Error(`the bytes were touched: ${String(key)}`);
        },
      },
    ) as unknown as Uint8Array;
    const r = readAll([{ file: 'big.geojson', bytes: trap }]);
    expect(capErrors(r)).toStrictEqual([
      { kind: 'source-too-large', file: 'big.geojson', what: 'bytes', cap: 256 * MIB, found: 300 * MIB },
    ]);
  });

  it('FR-588 every oversized file is named and none is parsed, a file at the cap passes the size check', () => {
    const limit = 500;
    const small = bytesOf(collection([feat({}, polygon(0, 0))]));
    const r = readAll(
      [
        { file: 'a', bytes: new Uint8Array(limit + 1) },
        { file: 'b', bytes: small },
        { file: 'c', bytes: new Uint8Array(limit + 5) },
      ],
      [],
      { bytes: limit },
    );
    expect(capErrors(r)).toStrictEqual([
      { kind: 'source-too-large', file: 'a', what: 'bytes', cap: limit, found: limit + 1 },
      { kind: 'source-too-large', file: 'c', what: 'bytes', cap: limit, found: limit + 5 },
    ]);
    expect(readAll([{ file: 'ok', bytes: small }], [], { bytes: small.length }).ok).toBe(true);
    expect(capErrors(readAll([{ file: 'ok', bytes: small }], [], { bytes: small.length - 1 }))).toHaveLength(1);
  });

  it('FR-588 the stat of the command refuses a 300 MiB file before any read, over a fake file system', () => {
    let reads = 0;
    const r = readBounded(
      fakeFs(300 * MIB, new Uint8Array(0), () => reads++),
      '/x/big.geojson',
      'big.geojson',
      256 * MIB,
    );
    expect(r).toStrictEqual({
      ok: false,
      errors: [{ kind: 'source-too-large', file: 'big.geojson', what: 'bytes', cap: 256 * MIB, found: 300 * MIB }],
    });
    expect(reads).toBe(0);
  });

  it('FR-588 the byte length is checked again on the bytes read, and a file within the cap is returned', () => {
    // the file grew between the stat and the read
    const grown = readBounded(fakeFs(5, new Uint8Array(50)), 'p', 'a', 10);
    expect(grown).toStrictEqual({ ok: false, errors: [{ kind: 'source-too-large', file: 'a', what: 'bytes', cap: 10, found: 50 }] });
    const fine = readBounded(fakeFs(10, new Uint8Array(10)), 'p', 'a', 10);
    expect(fine.ok && fine.value.length).toBe(10);
    const broken: ImportFs = {
      ...fakeFs(1, new Uint8Array(1)),
      readFile: () => {
        throw new Error('no');
      },
    };
    expect(readBounded(broken, 'p', 'a', 10)).toStrictEqual({
      ok: false,
      errors: [{ kind: 'invalid-source', file: 'a', reason: 'unreadable' }],
    });
  });

  it('FR-588 100,000 features pass and 100,001 fail, counting features with a null geometry too', () => {
    expect(readAll([{ file: 'f', bytes: nullFeatures(100_000) }]).ok).toBe(true);
    expect(capErrors(readAll([{ file: 'f', bytes: nullFeatures(100_001) }]))).toStrictEqual([
      { kind: 'source-too-large', file: 'f', what: 'features', cap: 100_000, found: 100_001 },
    ]);
  });

  it('FR-588 the feature cap holds over the primary and the context sources together', () => {
    const r = readAll([
      { file: 'primary', bytes: nullFeatures(60_000) },
      { file: 'context', bytes: nullFeatures(40_001) },
    ]);
    expect(capErrors(r)).toStrictEqual([
      { kind: 'source-too-large', file: 'context', what: 'features', cap: 100_000, found: 100_001 },
    ]);
    expect(readAll([{ file: 'p', bytes: nullFeatures(60_000) }, { file: 'c', bytes: nullFeatures(40_000) }]).ok).toBe(true);
  });

  it('FR-588 the position cap counts every position of every feature and of every source, and stops at the offending feature', () => {
    // five positions a feature (a closed square), a cap of 12: the third feature crosses it
    const three = bytesOf(
      collection([
        feat({}, polygon(0, 0)),
        feat({}, polygon(2, 0)),
        feat({}, polygon(4, 0)),
        feat({}, { type: 'Point', coordinates: [0, 0] }),
      ]),
    );
    const r = readAll([{ file: 'f', bytes: three }], [], { positions: 12 });
    expect(capErrors(r)).toStrictEqual([{ kind: 'source-too-large', file: 'f', what: 'positions', cap: 12, found: 15, feature: 2 }]);
    const two = bytesOf(collection([feat({}, polygon(0, 0)), feat({}, polygon(2, 0))]));
    expect(readAll([{ file: 'f', bytes: two }], [], { positions: 10 }).ok).toBe(true);
    expect(readAll([{ file: 'f', bytes: two }], [], { positions: 9 }).ok).toBe(false);
    // jointly: each source alone is within the cap, the two together are not
    const joint = readAll([{ file: 'p', bytes: two }, { file: 'c', bytes: two }], [], { positions: 15 });
    expect(capErrors(joint)).toStrictEqual([{ kind: 'source-too-large', file: 'c', what: 'positions', cap: 15, found: 20, feature: 1 }]);
  });

  it('FR-588 a feature with 256 properties passes and one with 257 fails, naming the feature', () => {
    const props = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, i]));
    expect(readAll([{ file: 'f', bytes: bytesOf(collection([feat(props(256), polygon(0, 0))])) }]).ok).toBe(true);
    const r = readAll([{ file: 'f', bytes: bytesOf(collection([feat({}, polygon(0, 0)), feat(props(257), polygon(2, 0))])) }]);
    expect(capErrors(r)).toStrictEqual([{ kind: 'source-too-large', file: 'f', what: 'properties', cap: 256, found: 257, feature: 1 }]);
  });

  it('FR-588 a value of a used property over 1,024 code units fails, and a value of an unused property never does', () => {
    const long = (n: number) => 'x'.repeat(n);
    const at = (v: unknown, used: string[]) =>
      readAll(
        [{ file: 'f', bytes: bytesOf(collection([feat({ a: 'ok' }, polygon(0, 0)), feat({ name: v, other: long(5000) }, polygon(2, 0))])) }],
        used,
      );
    expect(at(long(1024), ['name']).ok).toBe(true);
    expect(capErrors(at(long(1025), ['name']))).toStrictEqual([
      { kind: 'source-too-large', file: 'f', what: 'value', cap: 1024, found: 1025, feature: 1, property: 'name' },
    ]);
    // the same value is read when no rule names the property, and numbers are never capped
    expect(at(long(5000), []).ok).toBe(true);
    expect(at(long(5000), ['other2']).ok).toBe(true);
    expect(at(123456789012345, ['name']).ok).toBe(true);
    // the cap counts code units, not characters: 512 surrogate pairs are 1,024, 513 are 1,026
    expect(at('\u{1F600}'.repeat(512), ['name']).ok).toBe(true);
    expect(capErrors(at('\u{1F600}'.repeat(513), ['name']))[0]).toMatchObject({ what: 'value', found: 1026 });
  });

  it('FR-588 the read stops at the offending record: errors before it are kept, later ones are never looked for', () => {
    const bytes = bytesOf(
      collection([
        feat({}, { type: 'Point', coordinates: [0, 0] }),
        feat({ name: 'y'.repeat(2000) }, polygon(0, 0)),
        feat({}, { type: 'LineString', coordinates: [] }),
        feat({}, polygon(500, 500)),
      ]),
    );
    const r = readAll([{ file: 'f', bytes }], ['name']);
    expect(capErrors(r)).toStrictEqual([
      { kind: 'unsupported-geometry', file: 'f', feature: 0, type: 'Point' },
      { kind: 'source-too-large', file: 'f', what: 'value', cap: 1024, found: 2000, feature: 1, property: 'name' },
    ]);
  });

  it('FR-588 the single-source reader applies the same caps, and a used name on the prototype is never read', () => {
    const r = readSource(
      { file: 'f', bytes: bytesOf(collection([feat({ name: 'z'.repeat(1025) }, polygon(0, 0))])) },
      { usedProperties: ['name'] },
    );
    expect(r.ok).toBe(false);
    Object.defineProperty(Object.prototype, 'inheritedName', { value: 'q'.repeat(5000), configurable: true, writable: true });
    try {
      const ok = readSource({ file: 'f', bytes: bytesOf(collection([feat({}, polygon(0, 0))])) }, { usedProperties: ['inheritedName'] });
      expect(ok.ok).toBe(true);
    } finally {
      delete (Object.prototype as Record<string, unknown>)['inheritedName'];
    }
  });
});
