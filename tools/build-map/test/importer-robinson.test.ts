import { describe, expect, it } from 'vitest';
import { frameFor, toPixel } from '../src/core/projection';
import { robinson } from '../src/core/robinson';
import type { SourcePolygon } from '../src/core/types';
import { parseCuration, type Params } from '../src/importer/curation';
import { equalEarth } from '../src/importer/equal-earth';
import { textBytes } from './helpers/geo-fixture';
import { antimeridianErrors, buildMainView, ringProjector, visiblePolygons, type ViewItem } from '../src/importer/views';
import type { Unit } from '../src/importer/units';

const RAD = Math.PI / 180;
const params = (change: Partial<Params> = {}): Params => ({ side: 512, margin: 0.02, minPieceSize: 4, projection: 'robinson', ...change });

function polygon(outer: [number, number][]): SourcePolygon {
  return { outer: { coords: [...outer, outer[0]!] }, holes: [] };
}
const box = (west: number, south: number, east: number, north: number): [number, number][] => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
];
/** The ring of a box with a vertex at least every 85 degrees along its sides (no edge spans half the globe). */
function denseBox(west: number, south: number, east: number, north: number): [number, number][] {
  const ring: [number, number][] = [];
  const line = (a: number, b: number, at: (v: number) => [number, number]): void => {
    const steps = Math.ceil(Math.abs(b - a) / 85);
    for (let i = 0; i < steps; i++) ring.push(at(a + ((b - a) * i) / steps));
  };
  line(west, east, (lon) => [lon, south]);
  line(south, north, (lat) => [east, lat]);
  line(east, west, (lon) => [lon, north]);
  line(north, south, (lat) => [west, lat]);
  return ring;
}
function unit(key: string, polygons: SourcePolygon[]): Unit {
  return { key, features: [{ index: 0, props: {}, polygons }], firstFeature: 0, polygons, sourceName: key, name: key, kind: 'land', territory: undefined, faction: undefined, layer: undefined };
}

describe('FR-698 the curation names the Robinson projection', () => {
  const base = {
    primary: 'p.geojson',
    columns: { key: 'code', name: ['name'] },
    params: { side: 2048, margin: 0.02, minPieceSize: 40, projection: 'robinson' },
  };
  const parse = (value: unknown) => parseCuration(textBytes(JSON.stringify(value)), 'c.json');

  it('FR-698 accepts robinson and keeps it as the projection, and still refuses an unknown one', () => {
    const ok = parse(base);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.params.projection).toBe('robinson');
    const bad = parse({ ...base, params: { ...base.params, projection: 'Robinson' } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(JSON.stringify(bad.errors)).toContain('params.projection');
  });
});

describe('FR-698 the main view with robinson', () => {
  const world = unit('W', [polygon(denseBox(-170, -60, 170, 70))]);

  it('FR-698 keeps the central meridian at 0, projects with Robinson and frames the projected vertices', () => {
    const r = buildMainView({ units: [world], params: params() });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const view = r.value;
    expect(view.projection).toBe('robinson');
    expect(view.lon0).toBe(0);
    const projected = world.polygons[0]!.outer.coords.map(([lon, lat]) => robinson(lon * RAD, lat * RAD));
    expect(view.frame).toStrictEqual(frameFor(projected, 0.02));
    const [px, py] = robinson(30 * RAD, 20 * RAD);
    const at = toPixel(view.frame, 512, px, py);
    expect(view.toUV(30, 20)).toStrictEqual([at.u, at.v]);
    expect(view.plane(30, 20)).toStrictEqual([px, py]);
    expect(view.plane(30, 20)).not.toStrictEqual(equalEarth(30 * RAD, 20 * RAD));
  });

  it('FR-698 wraps longitudes as lon minus lon0 into (-180, 180] and never fails selection-too-wide', () => {
    const r = buildMainView({ units: [world, unit('E', [polygon(box(99, -1, 100, 1))])], params: params() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.plane(190, 10)).toStrictEqual(r.value.plane(-170, 10));
    expect(r.value.plane(-180, 10)).toStrictEqual(r.value.plane(180, 10));
  });

  it('FR-698 fails antimeridian-edge exactly as equal-earth does, and draws a split ring and a drawn-on-the-line ring', () => {
    const fiji = unit('FJ', [polygon([[178, -17], [-178, -17], [-178, -16], [178, -16]])]);
    const r = buildMainView({ units: [world, fiji], params: params() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toStrictEqual([{ kind: 'antimeridian-edge', unit: 'FJ' }]);
    const view = buildMainView({ units: [world], params: params() });
    if (!view.ok) throw new Error('view');
    const items: ViewItem[] = [{ origin: { unit: 'FJ' }, polygons: fiji.polygons }];
    expect(antimeridianErrors(view.value, items)).toStrictEqual([{ kind: 'antimeridian-edge', unit: 'FJ' }]);
    const split = unit('FJ2', [polygon(box(178, -17, 180, -16)), polygon(box(-180, -17, -178, -16))]);
    expect(buildMainView({ units: [world, split], params: params() }).ok).toBe(true);
  });

  it('FR-698 puts a ring whose vertices sit on the antimeridian on its own side, through Robinson', () => {
    const west = ringProjector('robinson', 0, 0)([[-180, -17], [-178, -17]]);
    expect(west[0]![0]).toBeLessThan(0);
    expect(west[0]).toStrictEqual(robinson(-180 * RAD, -17 * RAD));
    const east = ringProjector('robinson', 0, 0)([[178, -17], [180, -17]]);
    expect(east[1]).toStrictEqual(robinson(180 * RAD, -17 * RAD));
  });

  it('FR-698 draws every context polygon (no horizon)', () => {
    const polygons = [polygon(box(100, -10, 120, 10)), polygon(box(-170, -10, -150, 10))];
    expect(visiblePolygons({ projection: 'robinson', lon0: 0, lat0: 0 }, polygons)).toHaveLength(2);
  });
});
