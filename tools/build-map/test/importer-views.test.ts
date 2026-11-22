import { describe, expect, it } from 'vitest';
import { frameFor, project, projectionCenter, toPixel } from '../src/core/projection';
import type { SourcePolygon } from '../src/core/types';
import type { Params } from '../src/importer/curation';
import { equalEarth } from '../src/importer/equal-earth';
import { antimeridianErrors, buildMainView, visiblePolygons, type ViewItem } from '../src/importer/views';
import type { Unit } from '../src/importer/units';

const RAD = Math.PI / 180;
const params = (change: Partial<Params> = {}): Params => ({ side: 512, margin: 0.02, minPieceSize: 4, projection: 'laea', ...change });

/** A polygon from an outer ring and holes (open lists of [lon, lat]; the rings are closed here, as GeoJSON does). */
function polygon(outer: [number, number][], ...holes: [number, number][][]): SourcePolygon {
  const close = (r: [number, number][]): { coords: [number, number][] } => ({ coords: [...r, r[0]!] });
  return { outer: close(outer), holes: holes.map(close) };
}
const box = (west: number, south: number, east: number, north: number): [number, number][] => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
];

/** The ring of a box with a vertex at least every 85 degrees along its sides. */
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

function unit(key: string, polygons: SourcePolygon[], kind: 'land' | 'sea' = 'land'): Unit {
  return { key, features: [], firstFeature: 0, polygons, sourceName: key, name: key, kind, territory: undefined, faction: undefined, layer: undefined };
}

const vertices = (units: Unit[]): [number, number][] =>
  units.flatMap((u) => u.polygons.flatMap((p) => [...p.outer.coords, ...p.holes.flatMap((h) => h.coords)]));

function main(units: Unit[], change: Partial<Params> = {}, others: ViewItem[] = []) {
  const r = buildMainView({ units, others, params: params(change) });
  if (!r.ok) throw new Error(`expected a view, got ${JSON.stringify(r.errors)}`);
  return r.value;
}
function mainErrors(units: Unit[], change: Partial<Params> = {}, others: ViewItem[] = []) {
  const r = buildMainView({ units, others, params: params(change) });
  if (r.ok) throw new Error('expected errors');
  return r.errors;
}

describe('FR-600 the main view with laea', () => {
  // Raw vertices as 003b build.ts consumes them: a hole, a repeated vertex, and a zero-area ring far away.
  const spain = unit('ES', [
    polygon(box(-9, 36, 3, 44), box(-4, 39, -3, 40)),
    { outer: { coords: [[5, 40], [5, 40], [6, 41], [6, 40], [5, 40]] }, holes: [] },
  ]);
  const far = unit('FR', [polygon(box(-4, 42, 8, 51))]);
  // zero area (a segment): normalisation would drop it, the centre and frame still see its vertices
  const sliver = unit('SL', [{ outer: { coords: [[-20, 30], [-19, 30], [-20, 30]] }, holes: [] }]);

  it('FR-600 reuses core/projection: the centre is the FR-114 midpoint of the raw outer and hole vertices of the land units', () => {
    const units = [spain, far, sliver];
    const view = main(units);
    const raw = vertices(units);
    const center = projectionCenter(raw);
    expect(view.projection).toBe('laea');
    expect({ lon0: view.lon0, lat0: view.lat0 }).toStrictEqual(center);
    // the zero-area ring at lon -20 counts: the centre longitude is the midpoint of -20 and 8
    expect(center.lon0).toBe(-6);
    expect(view.frame).toStrictEqual(frameFor(raw.map(([lon, lat]) => project(center, lon, lat)), 0.02));
    expect(view.side).toBe(512);
  });

  it('FR-600 maps a point to pixels exactly as 003b does: project, then toPixel on the frame', () => {
    const units = [spain, far];
    const view = main(units);
    const center = projectionCenter(vertices(units));
    for (const [lon, lat] of [[-3.7, 40.4], [0, 45], [7.9, 50.9], [-9, 36]] as const) {
      const [px, py] = project(center, lon, lat);
      const at = toPixel(view.frame, 512, px, py);
      expect(view.toUV(lon, lat)).toStrictEqual([at.u, at.v]);
    }
  });

  it('FR-600 takes the centre and the frame from the land units only: a sea unit never widens them', () => {
    const wet = unit('SEA', [polygon(box(-30, 20, 20, 60))], 'sea');
    const a = main([spain, far, wet]);
    const b = main([spain, far]);
    expect(a.frame).toStrictEqual(b.frame);
    expect(a.lon0).toBe(b.lon0);
  });

  it('FR-600 fails with selection-too-wide for each unit with a vertex more than 90 degrees of arc from the centre', () => {
    const west = unit('W', [polygon(box(-100, -1, -99, 1))]);
    const east = unit('E', [polygon(box(99, -1, 100, 1))]);
    expect(mainErrors([west, east])).toStrictEqual([
      { kind: 'selection-too-wide', unit: 'E' },
      { kind: 'selection-too-wide', unit: 'W' },
    ]);
    // a sea unit is a selected unit too
    const wet = unit('SEA', [polygon(box(-170, -1, 170, 1))], 'sea');
    expect(mainErrors([spain, wet]).map((e) => e.kind)).toStrictEqual(['selection-too-wide']);
  });

  it('FR-600 accepts a vertex at exactly 90 degrees of arc and refuses one beyond it', () => {
    // centre (0, 0): the vertices at longitude +-90 lie on the horizon, at exactly 90 degrees
    expect(main([unit('B', [polygon([[-90, -10], [90, -10], [90, 10], [-90, 10]])])]).side).toBe(512);
    // centre (0, 30): the vertices (+-180, 60) lie on the horizon, and the float cosine of their arc is -2e-16
    expect(main([unit('H', [polygon([[-180, 60], [180, 60], [0, 0]])])]).side).toBe(512);
    expect(mainErrors([unit('C', [polygon([[-90.001, -10], [90.001, -10], [90.001, 10], [-90.001, 10]])])])).toStrictEqual([{ kind: 'selection-too-wide', unit: 'C' }]);
  });

  it('FR-600 drops a context or other-land polygon with any vertex beyond 90 degrees, polygon by polygon, and never fails for it', () => {
    const view = main([spain, far]);
    const near = polygon(box(0, 40, 2, 42));
    const beyond = polygon(box(120, 10, 125, 12));
    const straddling = polygon([[0, 41], [1, 42], [-179, 0]]);
    expect(visiblePolygons(view, [near, beyond, straddling])).toStrictEqual([near]);
    expect(buildMainView({ units: [spain, far], others: [{ origin: { file: 'ctx.geojson', feature: 0 }, polygons: [beyond] }], params: params() }).ok).toBe(true);
  });

  it('FR-600 gives an empty main view a frame of its own: the vertices of any unit it has, else the whole projected disc', () => {
    const wet = unit('SEA', [polygon(box(0, 40, 4, 44))], 'sea');
    const view = main([wet]);
    expect({ lon0: view.lon0, lat0: view.lat0 }).toStrictEqual({ lon0: 2, lat0: 42 });
    const empty = main([]);
    expect(empty.frame).toStrictEqual({ west: -2, north: 2, side: 4 });
    expect({ lon0: empty.lon0, lat0: empty.lat0 }).toStrictEqual({ lon0: 0, lat0: 0 });
  });

  it('FR-600 gives the same view for the same units', () => {
    const a = main([spain, far, sliver]);
    const b = main([spain, far, sliver]);
    expect(a.frame).toStrictEqual(b.frame);
    expect(a.toUV(2, 41)).toStrictEqual(b.toUV(2, 41));
  });
});

describe('FR-600 the main view with equal-earth', () => {
  // a ring of a real source: a vertex at least every 85 degrees, so no edge spans half the globe
  const world = unit('W', [polygon(denseBox(-170, -60, 170, 70))]);

  it('FR-600 keeps the central meridian at 0 degrees for the main map and frames the projected vertices', () => {
    const view = main([world], { projection: 'equal-earth' });
    expect(view.projection).toBe('equal-earth');
    expect(view.lon0).toBe(0);
    const projected = vertices([world]).map(([lon, lat]) => equalEarth(lon * RAD, lat * RAD));
    expect(view.frame).toStrictEqual(frameFor(projected, 0.02));
    const [px, py] = equalEarth(30 * RAD, 20 * RAD);
    const at = toPixel(view.frame, 512, px, py);
    expect(view.toUV(30, 20)).toStrictEqual([at.u, at.v]);
  });

  it('FR-600 projects longitudes as lon minus lon0 wrapped into (-180, 180]: 190 degrees is -170 and -180 is 180', () => {
    const view = main([world], { projection: 'equal-earth' });
    expect(view.plane(190, 10)).toStrictEqual(view.plane(-170, 10));
    expect(view.plane(-180, 10)).toStrictEqual(view.plane(180, 10));
    expect(view.plane(180, 10)[0]).toBeGreaterThan(0);
  });

  it('FR-600 never fails selection-too-wide with equal-earth: it draws a selection spanning more than a hemisphere', () => {
    const west = unit('W', [polygon(box(-100, -1, -99, 1))]);
    const east = unit('E', [polygon(box(99, -1, 100, 1))]);
    expect(main([west, east], { projection: 'equal-earth' }).side).toBe(512);
  });

  it('FR-600 fails antimeridian-edge for a ring edge whose wrapped ends differ by more than 180 degrees, naming the unit or the context feature', () => {
    const fiji = unit('FJ', [polygon([[178, -17], [-178, -17], [-178, -16], [178, -16]])]);
    expect(mainErrors([world, fiji], { projection: 'equal-earth' })).toStrictEqual([{ kind: 'antimeridian-edge', unit: 'FJ' }]);
    const ctx: ViewItem = { origin: { file: 'ctx.geojson', feature: 3 }, polygons: [fiji.polygons[0]!] };
    expect(mainErrors([world], { projection: 'equal-earth' }, [ctx])).toStrictEqual([{ kind: 'antimeridian-edge', file: 'ctx.geojson', feature: 3 }]);
    // the same ring split at the antimeridian is fine, and so is an edge of exactly 180 degrees
    const split = unit('FJ2', [polygon(box(178, -17, 180, -16)), polygon(box(-180, -17, -178, -16))]);
    expect(main([world, split], { projection: 'equal-earth' }).side).toBe(512);
    const half = unit('HALF', [polygon([[-90, 0], [90, 0], [90, 10], [-90, 10]])]);
    expect(main([half], { projection: 'equal-earth' }).side).toBe(512);
  });

  it('FR-600 takes a vertex exactly on the antimeridian of the view to either side: only the other end of the edge decides', () => {
    const edge = (a: number, b: number) => unit('E', [polygon([[a, 0], [b, 0], [b, 1], [a, 1]])]);
    for (const [a, b] of [[178, 180], [-180, -178], [180, -178], [-178, 180], [-180, 178], [180, 180], [-180, 180]] as const) {
      expect(buildMainView({ units: [edge(a, b)], params: params({ projection: 'equal-earth' }) }).ok, `${a} to ${b}`).toBe(true);
    }
    // a real crossing stays an error, whatever the sign of the vertex on the line
    expect(mainErrors([edge(-179, 178)], { projection: 'equal-earth' })).toStrictEqual([{ kind: 'antimeridian-edge', unit: 'E' }]);
  });

  it('FR-600 judges a hole on its own, and the closing edge of a ring that does not repeat its first vertex', () => {
    const holeOnly = unit('HO', [polygon(box(-10, -10, 10, 10), [[178, 0], [-178, 0], [-178, 1]])]);
    expect(mainErrors([holeOnly], { projection: 'equal-earth' })).toStrictEqual([{ kind: 'antimeridian-edge', unit: 'HO' }]);
    // only the edge from the last vertex back to the first crosses
    const open = unit('OP', [{ outer: { coords: [[-170, 0], [0, 10], [170, 0]] }, holes: [] }]);
    expect(mainErrors([open], { projection: 'equal-earth' })).toStrictEqual([{ kind: 'antimeridian-edge', unit: 'OP' }]);
  });

  it('FR-600 judges the edge of a hole and of every polygon of a multipart unit, once per unit', () => {
    const fiji = polygon([[178, -17], [-178, -17], [-178, -16], [178, -16]]);
    const holed = unit('H', [polygon(box(-10, -10, 10, 10), [[178, 0], [-178, 0], [-178, 1]]), fiji]);
    expect(mainErrors([holed], { projection: 'equal-earth' })).toStrictEqual([{ kind: 'antimeridian-edge', unit: 'H' }]);
  });

  it('FR-600 judges an edge against the central meridian of the view it is given', () => {
    const fiji = unit('FJ', [polygon([[178, -17], [-178, -17], [-178, -16], [178, -16]])]);
    const view = main([world], { projection: 'equal-earth' });
    const items: ViewItem[] = [{ origin: { unit: 'FJ' }, polygons: fiji.polygons }];
    expect(antimeridianErrors(view, items)).toStrictEqual([{ kind: 'antimeridian-edge', unit: 'FJ' }]);
    // a view centred on the antimeridian takes the same ring
    expect(antimeridianErrors({ ...view, lon0: 180 }, items)).toStrictEqual([]);
    // the Lambert view has no such rule
    expect(antimeridianErrors({ ...view, projection: 'laea' }, items)).toStrictEqual([]);
  });
});
