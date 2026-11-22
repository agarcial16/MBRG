import { describe, expect, it } from 'vitest';
import { frameFor, project, projectionCenter, toPixel } from '../src/core/projection';
import type { SourcePolygon } from '../src/core/types';
import type { Params } from '../src/importer/curation';
import { equalEarth } from '../src/importer/equal-earth';
import { antimeridianErrors, buildMainView, buildViews, centerLongitude, insetHidesLand, locateSeed, visiblePolygons, type ViewItem, type ViewSet, type ViewsInput } from '../src/importer/views';
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

function unit(key: string, polygons: SourcePolygon[], kind: 'land' | 'sea' = 'land', props: Record<string, unknown> = {}): Unit {
  return { key, features: [{ index: 0, props, polygons }], firstFeature: 0, polygons, sourceName: key, name: key, kind, territory: undefined, faction: undefined, layer: undefined };
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

describe('FR-601 the insets', () => {
  const W = 512;
  const spain = unit('ES', [polygon(box(-9, 36, 3, 44))], 'land', { region: 'M' });
  const canaries = unit('IC', [polygon(box(-18, 27.5, -13.5, 29.5))], 'land', { region: 'IC' });
  const isCanaries = [{ property: 'region', eq: 'IC' }];

  function views(change: Partial<ViewsInput> = {}) {
    const r = buildViews({
      selected: [spain, canaries],
      params: params({ side: W }),
      insets: [{ select: isCanaries, at: [10, 300] }],
      ...change,
    });
    if (!r.ok) throw new Error(`expected views, got ${JSON.stringify(r.errors)}`);
    return r.value;
  }
  function viewErrors(change: Partial<ViewsInput> = {}) {
    const r = buildViews({ selected: [spain, canaries], params: params({ side: W }), insets: [{ select: isCanaries, at: [10, 300] }], ...change });
    if (r.ok) throw new Error('expected errors');
    return r.errors;
  }

  it('FR-601 gives each inset the selected units matching its filters and builds the main view from the rest', () => {
    const set = views();
    expect(set.insets.map((v) => v.units.map((u) => u.key))).toStrictEqual([['IC']]);
    expect(set.mainUnits.map((u) => u.key)).toStrictEqual(['ES']);
    const alone = main([spain], { side: W });
    // the centre and the frame of the main map ignore the units of the insets
    expect(set.main.frame).toStrictEqual(alone.frame);
    expect({ lon0: set.main.lon0, lat0: set.main.lat0 }).toStrictEqual({ lon0: alone.lon0, lat0: alone.lat0 });
    // a sea unit that matches goes to the inset as well
    const gulf = unit('GULF', [polygon(box(-17, 28, -15, 29))], 'sea', { region: 'IC' });
    expect(views({ selected: [spain, canaries, gulf] }).insets[0]!.units.map((u) => u.key)).toStrictEqual(['IC', 'GULF']);
  });

  it('FR-601 centres the inset on the midpoint of its own longitude and latitude ranges, at the main pixel scale', () => {
    const set = views();
    const inset = set.insets[0]!;
    expect(inset.kind).toBe('inset');
    expect({ lon0: inset.lon0, lat0: inset.lat0 }).toStrictEqual({ lon0: -15.75, lat0: 28.5 });
    // the same Lambert projection as the main map, re-centred: its centre point projects to the origin
    const [cx, cy] = inset.plane(-15.75, 28.5);
    expect(Math.abs(cx) + Math.abs(cy)).toBeLessThan(1e-12);
    // one pixel of the inset is one pixel of the main map: the same plane distance per pixel
    const pixel = set.main.frame.side / W;
    const [a, b] = [inset.plane(-17, 28), inset.plane(-14, 29)];
    const [ua, va] = inset.toUV(-17, 28);
    const [ub, vb] = inset.toUV(-14, 29);
    expect((ub - ua) * pixel).toBeCloseTo(b[0] - a[0], 12);
    expect((va - vb) * pixel).toBeCloseTo(b[1] - a[1], 12);
    expect(inset.frame.side).toBeCloseTo(set.main.frame.side, 12);
  });

  it('FR-601 sizes the rectangle as the projected bounding box plus margin x main frame side per side, rounded outward, at (x, y)', () => {
    const set = views();
    const inset = set.insets[0]!;
    const pixel = set.main.frame.side / W;
    const m = 0.02 * set.main.frame.side;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [lon, lat] of vertices([canaries])) {
      const [x, y] = inset.plane(lon, lat);
      xs.push(x);
      ys.push(y);
    }
    const width = Math.max(...xs) - Math.min(...xs) + 2 * m;
    const height = Math.max(...ys) - Math.min(...ys) + 2 * m;
    expect(inset.rect).toStrictEqual({ x: 10, y: 300, w: Math.ceil(width / pixel), h: Math.ceil(height / pixel) });
    // a bigger margin makes a bigger rectangle, and a margin of 0 hugs the vertices
    const at = [{ select: isCanaries, at: [10, 10] as [number, number] }];
    expect(views({ params: params({ side: W, margin: 0.2 }), insets: at }).insets[0]!.rect.w).toBeGreaterThan(inset.rect.w);
    const tight = views({ params: params({ side: W, margin: 0 }), insets: at }).insets[0]!;
    expect(tight.rect.w).toBeLessThan(inset.rect.w);
    // the corners of the bounding box land in the rectangle, the margin around them
    const [u, v] = inset.toUV(-18, 29.5);
    expect(u).toBeGreaterThan(0);
    expect(v).toBeGreaterThan(0);
    expect(u).toBeLessThan(inset.rect.w);
    expect(v).toBeLessThan(inset.rect.h);
  });

  it('FR-601 gives the inset its own square raster of side max(w, h), never a second W x W image', () => {
    const inset = views().insets[0]!;
    expect(inset.side).toBe(Math.max(inset.rect.w, inset.rect.h));
    expect(inset.side).toBeLessThan(W / 2);
    // the main view keeps W
    expect(views().main.side).toBe(W);
  });

  it('FR-601 wraps every longitude of a view as lon minus lon0 into (-180, 180]', () => {
    const inset = views().insets[0]!;
    const sea = views({ params: params({ side: W, projection: 'equal-earth' }) });
    for (const view of [sea.main, ...sea.insets]) {
      expect(view.plane(view.lon0 + 370, 10)[0]).toBeCloseTo(view.plane(view.lon0 + 10, 10)[0], 12);
      expect(view.plane(view.lon0 + 180, 10)).toStrictEqual(view.plane(view.lon0 - 180, 10));
    }
    expect(sea.insets[0]!.lon0).toBe(-15.75);
    expect(inset.projection).toBe('laea');
  });

  it('FR-601 centres on the antimeridian a set that straddles it, and on the plain midpoint of any other set', () => {
    expect(centerLongitude(-178, 178, 178, 182)).toBe(180);
    expect(centerLongitude(-170, 170, 170, 190)).toBe(180);
    expect(centerLongitude(-18, -13.5, 342, 346.5)).toBe(-15.75);
    expect(centerLongitude(-180, 180, 0, 360)).toBe(0);
    expect(centerLongitude(-100, 100, 0, 360)).toBe(0);
    expect(centerLongitude(10, 30, 10, 30)).toBe(20);
    // a straddling set whose shifted midpoint is past 180 is wrapped back: -175, not 185
    expect(centerLongitude(-165, 175, 175, 195)).toBe(-175);
  });

  it('FR-601 imports inside an inset an unsplit antimeridian ring that the main map refuses', () => {
    const fiji = unit('FJ', [polygon([[178, -17], [-178, -17], [-178, -16], [178, -16]])], 'land', { region: 'FJ' });
    const earth = params({ side: W, projection: 'equal-earth' });
    expect(viewErrors({ selected: [spain, fiji], params: earth, insets: [] })).toStrictEqual([{ kind: 'antimeridian-edge', unit: 'FJ' }]);
    const set = views({ selected: [spain, fiji], params: earth, insets: [{ select: [{ property: 'region', eq: 'FJ' }], at: [20, 20] }] });
    expect(set.insets[0]!.lon0).toBe(180);
    expect(set.mainUnits.map((u) => u.key)).toStrictEqual(['ES']);
    // the ring is drawn as a small shape around the middle of the inset, not as a band across the globe
    const us = [178, -178].map((lon) => set.insets[0]!.toUV(lon, -16.5)[0]);
    expect(Math.abs(us[0]! - us[1]!)).toBeLessThan(set.insets[0]!.rect.w);
  });

  it('FR-601 judges the context items against the meridian of the inset, only on the rows its raster covers', () => {
    const earth = params({ side: W, projection: 'equal-earth' });
    // the antimeridian of an inset centred on -15.75 is at 164.25: an edge from 164 to 165 crosses it
    const crossing = (lat: number): ViewItem => ({ origin: { file: 'ctx.geojson', feature: 7 }, polygons: [polygon(box(164, lat, 165, lat + 1))] });
    const far = viewErrors({ params: earth, others: [crossing(28)] });
    expect(far).toStrictEqual([{ kind: 'antimeridian-edge', file: 'ctx.geojson', feature: 7 }]);
    // the same edge far to the north is never drawn in the inset (and the main map has no problem with it)
    expect(views({ params: earth, others: [crossing(60)] }).insets.length).toBe(1);
    // and so is one far to the south: below every row of the raster
    expect(views({ params: earth, others: [crossing(-40)] }).insets.length).toBe(1);
  });

  it('FR-601 judges the units of an inset against the inset: too wide for its Lambert centre, an edge over its own antimeridian', () => {
    const band = unit('BAND', [polygon([[-120, 0], [120, 0], [0, 1]])], 'land', { region: 'BAND' });
    const pick = [{ select: [{ property: 'region', eq: 'BAND' }], at: [10, 10] as [number, number] }];
    expect(viewErrors({ selected: [spain, band], insets: pick })).toContainEqual({ kind: 'selection-too-wide', unit: 'BAND' });
    expect(viewErrors({ selected: [spain, band], params: params({ side: W, projection: 'equal-earth' }), insets: pick })).toContainEqual({ kind: 'antimeridian-edge', unit: 'BAND' });
  });

  it('FR-601 fails unit-in-two-insets and empty-inset', () => {
    const both = viewErrors({ insets: [{ select: isCanaries, at: [10, 10] }, { select: isCanaries, at: [10, 200] }] });
    expect(both).toStrictEqual([{ kind: 'unit-in-two-insets', unit: 'IC' }]);
    const none = viewErrors({ insets: [{ select: [{ property: 'region', eq: 'NOWHERE' }], at: [10, 300] }] });
    expect(none).toStrictEqual([{ kind: 'empty-inset', inset: 0 }]);
    // an inset that takes every unit leaves the main view nothing, and is not an error of its own
    expect(views({ insets: [{ select: [], at: [10, 300] }] }).mainUnits).toStrictEqual([]);
  });

  it('FR-601 fails inset-outside-image for a rectangle that leaves the image, and accepts one that fits exactly', () => {
    const w = views().insets[0]!.rect.w;
    const h = views().insets[0]!.rect.h;
    for (const at of [[-1, 0], [0, -1], [W - w + 1, 0], [0, W - h + 1], [W, W]] as [number, number][]) {
      expect(viewErrors({ insets: [{ select: isCanaries, at }] }), at.join(',')).toStrictEqual([{ kind: 'inset-outside-image', inset: 0 }]);
    }
    expect(views({ insets: [{ select: isCanaries, at: [W - w, W - h] }] }).insets[0]!.rect).toStrictEqual({ x: W - w, y: W - h, w, h });
  });

  it('FR-601 fails insets-overlap for two rectangles that share a pixel, and accepts two that only touch', () => {
    const azores = unit('AZ', [polygon(box(-31, 36.5, -25, 40))], 'land', { region: 'AZ' });
    const selected = [spain, canaries, azores];
    const insetsAt = (a: [number, number], b: [number, number]) => [
      { select: isCanaries, at: a },
      { select: [{ property: 'region', eq: 'AZ' }], at: b },
    ];
    const first = views({ selected, insets: insetsAt([10, 10], [10, 250]) }).insets;
    const { w, h } = first[0]!.rect;
    expect(viewErrors({ selected, insets: insetsAt([10, 10], [10 + w - 1, 10]) })).toStrictEqual([{ kind: 'insets-overlap', insets: [0, 1] }]);
    expect(viewErrors({ selected, insets: insetsAt([10, 10], [10, 10 + h - 1]) })).toStrictEqual([{ kind: 'insets-overlap', insets: [0, 1] }]);
    expect(views({ selected, insets: insetsAt([10, 10], [10 + w, 10]) }).insets.length).toBe(2);
    expect(views({ selected, insets: insetsAt([10, 10], [10, 10 + h]) }).insets.length).toBe(2);
  });

  it('FR-601 fails inset-hides-land when the rectangle covers a pixel the main projection gives to a selected land unit', () => {
    const set = views();
    const { x, y, w, h } = set.insets[0]!.rect;
    const land = (value: number) => value >= 1 && value <= 5;
    const raster = new Uint32Array(W * W).fill(0xffffffff);
    expect(insetHidesLand(set, raster, land)).toStrictEqual([]);
    raster[(y + h - 1) * W + (x + w - 1)] = 3;
    expect(insetHidesLand(set, raster, land)).toStrictEqual([{ kind: 'inset-hides-land', inset: 0 }]);
    // land at any corner of the rectangle is hidden land
    for (const [cx, cy] of [[x, y], [x + w - 1, y], [x, y + h - 1], [x + w - 1, y + h - 1]]) {
      const corner = new Uint32Array(W * W).fill(0xffffffff);
      corner[cy! * W + cx!] = 2;
      expect(insetHidesLand(set, corner, land), `${cx},${cy}`).toStrictEqual([{ kind: 'inset-hides-land', inset: 0 }]);
    }
    // other land, a sea zone and a pixel just outside the rectangle are no land hidden
    const quiet = new Uint32Array(W * W).fill(0xffffffff);
    quiet[y * W + x] = 0;
    quiet[(y + h) * W + x] = 3;
    quiet[y * W + x + w] = 3;
    quiet[(y - 1) * W + x] = 3;
    expect(insetHidesLand(set, quiet, land)).toStrictEqual([]);
    quiet[y * W + x] = 9;
    expect(insetHidesLand(set, quiet, land)).toStrictEqual([]);
  });

  it('FR-601 puts a seed in the first inset whose projection lands it inside the rectangle, else in the main view', () => {
    const set = views();
    const inset = set.insets[0]!;
    const inIsland = locateSeed(set, -16, 28.3)!;
    expect(inIsland.view).toBe(inset);
    const [u, v] = inset.toUV(-16, 28.3);
    expect({ x: inIsland.x, y: inIsland.y }).toStrictEqual({ x: 10 + Math.floor(u), y: 300 + Math.floor(v) });
    const onMainland = locateSeed(set, 0, 40)!;
    expect(onMainland.view).toBe(set.main);
    const [mu, mv] = set.main.toUV(0, 40);
    expect({ x: onMainland.x, y: onMainland.y }).toStrictEqual({ x: Math.floor(mu), y: Math.floor(mv) });
    // outside every view
    expect(locateSeed(set, 80, 10)).toBeNull();
    expect(locateSeed(set, 170, -40)).toBeNull();
  });

  it('FR-601 holds a seed on the left and top edge of the rectangle and not on its right and bottom edge', () => {
    const set = views();
    const inset = set.insets[0]!;
    const at = (u: number, v: number): ViewSet => ({ ...set, insets: [{ ...inset, toUV: () => [u, v] }] });
    const { w, h } = inset.rect;
    expect(locateSeed(at(0, 0), 0, 40)!.view.kind).toBe('inset');
    expect(locateSeed(at(w - 0.5, h - 0.5), 0, 40)!.view.kind).toBe('inset');
    expect(locateSeed(at(w, 1), 0, 40)!.view.kind).toBe('main');
    expect(locateSeed(at(1, h), 0, 40)!.view.kind).toBe('main');
    expect(locateSeed(at(-0.5, 1), 0, 40)!.view.kind).toBe('main');
    expect(locateSeed(at(1, -0.5), 0, 40)!.view.kind).toBe('main');
  });

  it('FR-601 takes the first inset when two projections would hold a seed', () => {
    const near = unit('N', [polygon(box(-16, 28, -15, 29))], 'land', { region: 'N' });
    const set = views({
      selected: [spain, canaries, near],
      insets: [{ select: isCanaries, at: [10, 300] }, { select: [{ property: 'region', eq: 'N' }], at: [300, 300] }],
    });
    expect(locateSeed(set, -15.5, 28.5)!.view).toBe(set.insets[0]);
    expect(locateSeed(set, -16.5, 28.5)!.view).toBe(set.insets[0]);
  });

  it('FR-601 gives the same views for the same input', () => {
    const a = views();
    const b = views();
    expect(a.insets[0]!.rect).toStrictEqual(b.insets[0]!.rect);
    expect(a.insets[0]!.toUV(-16, 28)).toStrictEqual(b.insets[0]!.toUV(-16, 28));
  });
});
