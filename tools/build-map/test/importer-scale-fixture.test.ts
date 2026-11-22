import { describe, expect, it } from 'vitest';
import { parseCuration, usedProperties } from '../src/importer/curation';
import { readSources } from '../src/importer/read-source';
import { selectUnits } from '../src/importer/select';
import { NFR_136, generateScaleFixture, type ScaleOptions } from '../src/importer/scale-fixture';
import { buildUnits } from '../src/importer/units';

/** A small fixture of the same shape: a few cells, a handful of vertices a side. */
const SMALL: ScaleOptions = {
  units: 40,
  islandUnits: 6,
  columns: 6,
  factions: 5,
  seas: 6,
  verticesPerSide: 5,
  side: 256,
  minPieceSize: 2,
  insetAt: [4, 200],
};

const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

describe('the scale fixture generator (the full 8,132-unit fixture runs in the opt-in prototype)', () => {
  it('the fixture of the spec is 8,132 land units in 52 factions, 59 sea zones, side 4,096 and S = 8, with at least 5,000,000 positions', () => {
    expect(NFR_136).toStrictEqual({
      units: 8132,
      islandUnits: 88,
      columns: 116,
      factions: 52,
      seas: 59,
      verticesPerSide: 154,
      side: 4096,
      minPieceSize: 8,
      insetAt: [20, 3570],
    });
    // a ring has four sides of vertices and the closing one
    expect(NFR_136.units * (4 * NFR_136.verticesPerSide + 1)).toBeGreaterThanOrEqual(5_000_000);
    // entries: land units plus sea zones
    expect(NFR_136.units + NFR_136.seas).toBe(8191);
  });

  it('gives the same bytes twice, for the sources and for the curation', () => {
    const a = generateScaleFixture(SMALL);
    const b = generateScaleFixture(SMALL);
    expect(same(a.primary, b.primary)).toBe(true);
    expect(same(a.context, b.context)).toBe(true);
    expect(same(a.curationBytes, b.curationBytes)).toBe(true);
    expect(a.counts).toStrictEqual(b.counts);
    // a different option gives different bytes
    expect(same(generateScaleFixture({ ...SMALL, verticesPerSide: 6 }).primary, a.primary)).toBe(false);
  });

  it('writes sources the reader accepts: every unit once, closed rings, positions in degrees, the counts it reports', () => {
    const fixture = generateScaleFixture(SMALL);
    const read = readSources(
      [
        { file: 'primary.geojson', bytes: fixture.primary },
        { file: 'context.geojson', bytes: fixture.context },
      ],
      { usedProperties: ['code', 'name', 'prov', 'region'] },
    );
    if (!read.ok) throw new Error(`the fixture should read: ${JSON.stringify(read.errors)}`);
    const [primary, context] = read.value;
    expect(primary!.features).toHaveLength(SMALL.units);
    expect(primary!.skippedNull).toBe(0);
    expect(context!.features).toHaveLength(3);
    expect(primary!.positions + context!.positions).toBe(fixture.counts.positions);
    expect(primary!.positions).toBe(SMALL.units * (4 * SMALL.verticesPerSide + 1));
    for (const feature of primary!.features) {
      const ring = feature.polygons[0]!.outer.coords;
      expect(ring[0]).toStrictEqual(ring[ring.length - 1]);
      expect(ring).toHaveLength(4 * SMALL.verticesPerSide + 1);
    }
  });

  it('draws neighbouring cells with the same vertices on the border they share', () => {
    const read = readSources([{ file: 'p', bytes: generateScaleFixture(SMALL).primary }], { usedProperties: [] });
    if (!read.ok) throw new Error('the fixture should read');
    const n = SMALL.verticesPerSide;
    const first = read.value[0]!.features[0]!.polygons[0]!.outer.coords; // column 0, row 0
    const second = read.value[0]!.features[1]!.polygons[0]!.outer.coords; // column 1, row 0
    // the east side of the first cell is the west side of the second, walked the other way
    for (let k = 0; k < n; k++) {
      expect(first[n + k], 'vertex ' + k).toStrictEqual(k === 0 ? second[0] : second[3 * n + (n - k)]);
    }
    // the north-east corner of the first is the north-west corner of the second
    expect(first[2 * n]).toStrictEqual(second[3 * n]);
  });

  it('writes a curation that parses and uses every property of its columns, rules and inset', () => {
    const fixture = generateScaleFixture(SMALL);
    const curation = parseCuration(fixture.curationBytes, 'curation.json');
    if (!curation.ok) throw new Error(`the curation should parse: ${JSON.stringify(curation.errors)}`);
    expect(curation.value.params).toStrictEqual({ side: 256, margin: 0.02, minPieceSize: 2, projection: 'laea' });
    expect(curation.value.seas).toHaveLength(SMALL.seas);
    expect(curation.value.context).toStrictEqual(['context.geojson']);
    expect(curation.value.insets).toHaveLength(1);
    expect(usedProperties(curation.value)).toStrictEqual(['code', 'name', 'region', 'prov']);
  });

  it('forms one unit per feature, in the factions the province column names, and selects the island group for the inset', () => {
    const fixture = generateScaleFixture(SMALL);
    const read = readSources([{ file: 'p', bytes: fixture.primary }], { usedProperties: ['code', 'name', 'prov', 'region'] });
    const curation = parseCuration(fixture.curationBytes, 'c');
    if (!read.ok || !curation.ok) throw new Error('inputs should read');
    const units = buildUnits(read.value[0]!.features, curation.value);
    if (!units.ok) throw new Error(`units should form: ${JSON.stringify(units.errors)}`);
    expect(units.value).toHaveLength(SMALL.units);
    const provinces = new Set(units.value.flatMap((u) => u.features.map((f) => f.props['prov'])));
    expect(provinces.size).toBe(SMALL.factions);
    const selection = selectUnits(units.value, curation.value);
    expect(selection.ok && selection.value.selected).toHaveLength(SMALL.units);
    const island = units.value.filter((u) => u.features[0]!.props['region'] === 'IC');
    expect(island).toHaveLength(SMALL.islandUnits);
  });

  it('puts the sea seeds in water: north of the mainland rows and south of its south edge', () => {
    const fixture = generateScaleFixture(SMALL);
    const seas = (fixture.curation['seas'] as { name: string; lon: number; lat: number }[]) ?? [];
    expect(seas.map((s) => s.name)).toStrictEqual(['Sea 01', 'Sea 02', 'Sea 03', 'Sea 04', 'Sea 05', 'Sea 06']);
    const rows = Math.ceil((SMALL.units - SMALL.islandUnits) / SMALL.columns);
    const north = seas.filter((s) => s.lat > 36 + rows * 0.113);
    const south = seas.filter((s) => s.lat < 36);
    expect(north.length + south.length).toBe(SMALL.seas);
    expect(north.length).toBe(3);
  });
});
