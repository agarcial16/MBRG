/**
 * NFR-136: the deterministic generator of the scale fixture (Spain by municipalities in shape and size): a block of
 * land units on a grid in a mainland, a small island group for the inset, a context source of neighbouring land and a
 * curation that groups the units into factions by a province column and lists the sea seeds. Fixed integer arithmetic
 * only (a mixing hash, never a random number): the same options give the same bytes on any machine. Pure.
 */

/** What the generator needs to know; `NFR_136` is the fixture of the spec. */
export interface ScaleOptions {
  /** Land units in all: the mainland grid plus the island group. */
  units: number;
  /** Units of the island group, drawn in the inset. */
  islandUnits: number;
  /** Columns of the mainland grid. */
  columns: number;
  factions: number;
  /** Sea seeds (sea zones). */
  seas: number;
  /** Vertices on each side of the ring of a unit (a ring has 4 x this + 1 positions, the last closing it). */
  verticesPerSide: number;
  /** The image side of the curation. */
  side: number;
  minPieceSize: number;
  /** Spec 035: whether the curation leaves tiling on (its default); the fixtures of 028 turn it off. */
  tiling?: boolean;
  /** Where the inset's top-left pixel goes (over the water south of the mainland). */
  insetAt: [number, number];
}

/** NFR-136: 8,132 land units in 52 factions, 59 sea zones, at least 5,000,000 positions, side 4,096, S = 8, one inset and a context source. */
export const NFR_136: ScaleOptions = {
  units: 8132,
  islandUnits: 88,
  columns: 116,
  factions: 52,
  seas: 59,
  verticesPerSide: 154,
  side: 4096,
  minPieceSize: 8,
  insetAt: [20, 3570],
};

/** The generated sources and curation, and the counts a test checks against the options. */
export interface ScaleFixture {
  options: ScaleOptions;
  /** The primary source (GeoJSON bytes). */
  primary: Uint8Array;
  /** The context source (GeoJSON bytes). */
  context: Uint8Array;
  /** The curation as a plain value and as bytes. */
  curation: Record<string, unknown>;
  curationBytes: Uint8Array;
  counts: { units: number; factions: number; seas: number; positions: number };
}

// Grid geometry in degrees (a mainland of about 13.6 by 7.9 degrees, the size of Spain's).
const LON0 = -9.5;
const LAT0 = 36;
const D_LON = 0.1172;
const D_LAT = 0.113;
const ISLAND_COLUMNS = 11;
const ISLAND_LON0 = -18.1;
const ISLAND_LAT0 = 27.7;
/** The wobble of the vertices of a border, as a share of a cell, in the direction across the border. */
const WOBBLE = 0.2;

/** An integer mixing hash of two integers, as a number in [0, 1). Same result on every engine. */
function mix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const round5 = (v: number): number => Math.round(v * 1e5) / 1e5;
const pad = (n: number, width: number): string => String(n).padStart(width, '0');

interface Grid {
  lon0: number;
  lat0: number;
  /** A seed for the wobble, so two grids never share a border by accident. */
  salt: number;
}

/**
 * The ring of the cell (column c, row r) of a grid: n vertices on each side, going east along the south side, north
 * along the east side, west along the north side and south along the west side, then the first vertex again. A vertex
 * of a border depends only on the border and the position along it, so two cells that share a border share its vertices.
 */
function cellRing(grid: Grid, c: number, r: number, n: number): [number, number][] {
  const ring: [number, number][] = [];
  // a point on the horizontal border at row boundary b, vertex i along the whole row of cells
  const onRow = (b: number, i: number, k: number, c0: number): [number, number] => {
    const wobble = k === 0 || k === n ? 0 : (mix(grid.salt + b, 7919 + i) - 0.5) * WOBBLE * D_LAT;
    return [grid.lon0 + (c0 + k / n) * D_LON, grid.lat0 + b * D_LAT + wobble];
  };
  // a point on the vertical border at column boundary b, vertex j along the whole column of cells
  const onColumn = (b: number, j: number, k: number, r0: number): [number, number] => {
    const wobble = k === 0 || k === n ? 0 : (mix(grid.salt + 31 + b, 104729 + j) - 0.5) * WOBBLE * D_LON;
    return [grid.lon0 + b * D_LON + wobble, grid.lat0 + (r0 + k / n) * D_LAT];
  };
  for (let k = 0; k < n; k++) ring.push(onRow(r, c * n + k, k, c));
  for (let k = 0; k < n; k++) ring.push(onColumn(c + 1, r * n + k, k, r));
  for (let k = n; k >= 1; k--) ring.push(onRow(r + 1, c * n + k, k, c));
  for (let k = n; k >= 1; k--) ring.push(onColumn(c, r * n + k, k, r));
  ring.push(ring[0]!);
  return ring;
}

function positionText(ring: readonly (readonly [number, number])[]): string {
  return '[' + ring.map(([x, y]) => `[${round5(x)},${round5(y)}]`).join(',') + ']';
}

/** A rectangle of `per` vertices on each side as a ring (a context polygon). */
function blockRing(west: number, south: number, east: number, north: number, per: number): [number, number][] {
  const ring: [number, number][] = [];
  for (let k = 0; k < per; k++) ring.push([west + ((east - west) * k) / per, south]);
  for (let k = 0; k < per; k++) ring.push([east, south + ((north - south) * k) / per]);
  for (let k = 0; k < per; k++) ring.push([east - ((east - west) * k) / per, north]);
  for (let k = 0; k < per; k++) ring.push([west, north - ((north - south) * k) / per]);
  ring.push(ring[0]!);
  return ring;
}

const encoder = new TextEncoder();

/** The bytes of a feature collection from one text per feature, one feature a line. */
function collectionBytes(features: readonly string[]): Uint8Array {
  const parts: Uint8Array[] = [encoder.encode('{"type":"FeatureCollection","features":[\n')];
  features.forEach((feature, i) => parts.push(encoder.encode((i === 0 ? '' : ',\n') + feature)));
  parts.push(encoder.encode('\n]}\n'));
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The text of one feature of the primary source. */
function featureText(props: Record<string, string>, ring: readonly (readonly [number, number])[]): string {
  return `{"type":"Feature","properties":${JSON.stringify(props)},"geometry":{"type":"Polygon","coordinates":[${positionText(ring)}]}}`;
}

/**
 * NFR-136: the fixture for `options`. Unit `i` of the mainland sits at column `i % columns`, row `i / columns`;
 * the island group is a small grid far to the south-west. Factions are the 52 (by default) province values `P01`..:
 * contiguous runs of the mainland units, the last two for the islands. The curation selects the island units for one
 * inset, lists the sea seeds in the water above and below the mainland and the context source as other land.
 */
export function generateScaleFixture(options: ScaleOptions = NFR_136): ScaleFixture {
  const { units, islandUnits, columns, factions, seas, verticesPerSide: n } = options;
  const mainland = units - islandUnits;
  const rows = Math.ceil(mainland / columns);
  const mainGrid: Grid = { lon0: LON0, lat0: LAT0, salt: 1000 };
  const islandGrid: Grid = { lon0: ISLAND_LON0, lat0: ISLAND_LAT0, salt: 5000 };
  const features: string[] = [];
  let positions = 0;
  const province = (u: number): string => `P${pad(1 + Math.floor((u * factions) / units), 2)}`;

  for (let u = 0; u < mainland; u++) {
    const ring = cellRing(mainGrid, u % columns, Math.floor(u / columns), n);
    positions += ring.length;
    features.push(featureText({ code: `U${pad(u + 1, 5)}`, name: `Unit ${pad(u + 1, 5)}`, prov: province(u), region: 'ES' }, ring));
  }
  for (let j = 0; j < islandUnits; j++) {
    const u = mainland + j;
    const ring = cellRing(islandGrid, j % ISLAND_COLUMNS, Math.floor(j / ISLAND_COLUMNS), n);
    positions += ring.length;
    const prov = `P${pad(factions - (j % 2), 2)}`;
    features.push(featureText({ code: `U${pad(u + 1, 5)}`, name: `Unit ${pad(u + 1, 5)}`, prov, region: 'IC' }, ring));
  }

  // Context: neighbouring land beside the mainland, drawn only as other land. Offsets are shares of the mainland's width
  // (w) and height (h), so every size of fixture keeps the same layout: a strip of water above and below the mainland.
  const w = columns * D_LON;
  const h = rows * D_LAT;
  const top = LAT0 + h;
  const east = LON0 + w;
  const per = 250;
  const contextRings = [
    blockRing(LON0 + 0.7 * w, top + 0.015 * w, east + 0.03 * w, top + 0.07 * w, per),
    blockRing(LON0 + 0.75 * w, LAT0 - 0.07 * w, east + 0.03 * w, LAT0 - 0.015 * w, per),
    blockRing(LON0 - 0.1 * w, LAT0 + 0.05 * h, LON0 - 0.01 * w, top - 0.05 * h, per),
  ];
  const contextFeatures = contextRings.map((ring, i) => {
    positions += ring.length;
    return `{"type":"Feature","properties":{"name":"Neighbour ${i + 1}"},"geometry":{"type":"Polygon","coordinates":[${positionText(ring)}]}}`;
  });

  // Sea seeds: half in the water above the mainland, half below, away from the context blocks and the inset.
  const seeds: { name: string; lon: number; lat: number }[] = [];
  const north = Math.ceil(seas / 2);
  for (let s = 0; s < seas; s++) {
    const isNorth = s < north;
    const count = isNorth ? north : seas - north;
    const at = isNorth ? s : s - north;
    const span = isNorth ? [LON0 + 0.08 * w, LON0 + 0.55 * w] : [LON0 + 0.25 * w, LON0 + 0.6 * w];
    const lon = round5(span[0]! + ((span[1]! - span[0]!) * (at + 0.5)) / count);
    const lat = round5(isNorth ? top + 0.04 * w : LAT0 - 0.04 * w);
    seeds.push({ name: `Sea ${pad(s + 1, 2)}`, lon, lat });
  }

  const curation = {
    primary: 'primary.geojson',
    context: ['context.geojson'],
    columns: { key: 'code', name: ['name'] },
    params: { side: options.side, margin: 0.02, minPieceSize: options.minPieceSize, projection: 'laea', ...(options.tiling === true ? {} : { tiling: false }) },
    factionBy: { property: 'prov' },
    seas: seeds,
    insets: [{ select: [{ property: 'region', eq: 'IC' }], at: options.insetAt }],
  };
  return {
    options,
    primary: collectionBytes(features),
    context: collectionBytes(contextFeatures),
    curation,
    curationBytes: encoder.encode(JSON.stringify(curation)),
    counts: { units, factions, seas, positions },
  };
}
