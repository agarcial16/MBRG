/**
 * Test-only writer of a synthetic Natural Earth dataset in the real file formats (FR-131): a
 * polygon shapefile (.shp), a fixed-width dBASE table (.dbf) and the version text file. The real
 * data is not committed, so the extraction test runs on files built here.
 */

export type Point = [number, number];
/** A feature to write: its rings in file order (an outer ring is clockwise, a hole counter-clockwise) and its table row. */
export interface FixtureFeature {
  rings: Point[][];
  row: Record<string, string>;
}

/** A closed clockwise rectangle ring, as a shapefile stores an outer ring. */
export function outerRect(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    [x0, y0],
    [x0, y1],
    [x1, y1],
    [x1, y0],
    [x0, y0],
  ];
}

/** A closed counter-clockwise rectangle ring, as a shapefile stores a hole. */
export function holeRect(x0: number, y0: number, x1: number, y1: number): Point[] {
  return outerRect(x0, y0, x1, y1).reverse();
}

/** The .shp file of polygon records (shape type 5). */
export function shpBytes(features: readonly { rings: Point[][] }[]): Uint8Array {
  const all = features.flatMap((f) => f.rings.flat());
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const contentBytes = features.map((f) => 44 + 4 * f.rings.length + 16 * f.rings.flat().length);
  const total = 100 + contentBytes.reduce((sum, n) => sum + 8 + n, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setInt32(0, 9994, false);
  view.setInt32(24, total / 2, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, 5, true);
  bbox.forEach((v, i) => view.setFloat64(36 + 8 * i, v, true));
  let at = 100;
  features.forEach((f, index) => {
    view.setInt32(at, index + 1, false);
    view.setInt32(at + 4, contentBytes[index]! / 2, false);
    at += 8;
    const points = f.rings.flat();
    view.setInt32(at, 5, true);
    const fb = [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))];
    fb.forEach((v, i) => view.setFloat64(at + 4 + 8 * i, v, true));
    view.setInt32(at + 36, f.rings.length, true);
    view.setInt32(at + 40, points.length, true);
    let part = 0;
    f.rings.forEach((ring, i) => {
      view.setInt32(at + 44 + 4 * i, part, true);
      part += ring.length;
    });
    let p = at + 44 + 4 * f.rings.length;
    for (const [x, y] of points) {
      view.setFloat64(p, x, true);
      view.setFloat64(p + 8, y, true);
      p += 16;
    }
    at += contentBytes[index]!;
  });
  return out;
}

/** The .dbf file: every field is text, space-padded on the right to a width of at least `minWidth` bytes. */
export function dbfBytes(rows: readonly Record<string, string>[], minWidth = 24): Uint8Array {
  const encoder = new TextEncoder();
  const names = Object.keys(rows[0] ?? {});
  const widths = names.map((n) => Math.max(minWidth, ...rows.map((r) => encoder.encode(r[n] ?? '').length)));
  const headerLength = 32 + 32 * names.length + 1;
  const recordLength = 1 + widths.reduce((a, b) => a + b, 0);
  const out = new Uint8Array(headerLength + recordLength * rows.length + 1);
  const view = new DataView(out.buffer);
  out[0] = 3;
  view.setUint32(4, rows.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);
  names.forEach((name, i) => {
    const at = 32 + 32 * i;
    out.set(encoder.encode(name).subarray(0, 10), at);
    out[at + 11] = 'C'.charCodeAt(0);
    out[at + 16] = widths[i]!;
  });
  out[32 + 32 * names.length] = 0x0d;
  rows.forEach((row, r) => {
    let at = headerLength + recordLength * r;
    out[at++] = 0x20;
    names.forEach((name, i) => {
      const bytes = encoder.encode(row[name] ?? '');
      out.fill(0x20, at, at + widths[i]!);
      out.set(bytes, at);
      at += widths[i]!;
    });
  });
  out[out.length - 1] = 0x1a;
  return out;
}

export const ADMIN1 = 'ne_10m_admin_1_states_provinces';
export const ADMIN0 = 'ne_10m_admin_0_countries';
export const VERSION1 = `${ADMIN1}.VERSION.txt`;
export const VERSION0 = `${ADMIN0}.VERSION.txt`;

/** The fixture extraction box: longitude 0..10, latitude 0..10. */
export const FIXTURE_BOX = { west: 0, south: 0, east: 10, north: 10 };

/** Province features: selected country AAA (several shapes, one far and one crossing the box edge) and BBB. */
export function adminOneFeatures(): FixtureFeature[] {
  const row = (code: string, country: string, name: string, nameEs: string): Record<string, string> => ({
    ADM1_CODE: code,
    ADM0_A3: country,
    NAME: name,
    NAME_ES: nameEs,
    ISO_3166_2: `XX-${code}`,
    FEATURECLA: 'Admin-1 scale rank',
  });
  return [
    { rings: [outerRect(1, 1, 4, 4), holeRect(2, 2, 3, 3)], row: row('AAA-1', 'AAA', 'Alpha One', 'Alfa Uno') },
    {
      rings: [outerRect(5, 5, 6, 6), outerRect(7, 7, 8, 8)],
      row: row('AAA-2', 'AAA', 'Alpha Two', 'España Dos'),
    },
    { rings: [outerRect(50, 50, 51, 51)], row: row('AAA-3', 'AAA', 'Alpha Far', 'Alfa Lejos') },
    { rings: [outerRect(9, 9, 12, 12)], row: row('AAA-4', 'AAA', 'Alpha Edge', 'Alfa Borde') },
    {
      // clockwise; rounding and collapsing: the three points on the bottom edge after (3.5, 6.1)
      // round to one vertex, which stays as a collinear vertex (never simplified)
      rings: [
        [
          [1.1234549, 6.1],
          [1.1234549, 7.7777777],
          [3.5, 7.7777777],
          [3.5, 6.1],
          [2.1234563, 6.1],
          [2.12345612, 6.1000001],
          [2.1234561, 6.0999999],
          [1.1234549, 6.1],
        ],
      ],
      row: row('AAA-5', 'AAA', 'Alpha Rounded', 'Alfa Redondeado'),
    },
    { rings: [outerRect(2, 7, 3, 8)], row: row('BBB-1', 'BBB', 'Beta One', 'Beta Uno') },
  ];
}

/** Country features (lower case field names, as newer Natural Earth versions): selected AAA and other land. */
export function adminZeroFeatures(): FixtureFeature[] {
  const row = (country: string, name: string, nameEs: string): Record<string, string> => ({
    adm0_a3: country,
    name,
    name_es: nameEs,
    sovereignt: name,
    continent: 'Europe',
  });
  return [
    { rings: [outerRect(0.5, 0.5, 9.5, 9.5)], row: row('AAA', 'Alpha', 'Alfa') },
    // a near and a far polygon in one feature: only the near one is other land
    { rings: [outerRect(2, 2, 3, 3), outerRect(40, 40, 41, 41)], row: row('BBB', 'Beta', 'Beta') },
    { rings: [outerRect(20, 20, 21, 21)], row: row('CCC', 'Gamma', 'Gamma') },
    // the bounding box touches the east edge of the box: kept
    { rings: [outerRect(10, 5, 11, 6)], row: row('DDD', 'Delta', 'Delta') },
    // the bounding box contains the whole box, no vertex inside: kept
    { rings: [outerRect(-5, -5, 15, 15)], row: row('EEE', 'Epsilon', 'Epsilon') },
    // just outside: the bounding box does not touch the box
    { rings: [outerRect(10.5, 5, 11, 6)], row: row('FFF', 'Zeta', 'Zeta') },
  ];
}

/** Every file of the fixture dataset by name; `versions` overrides the two version texts (undefined removes one). */
export function neFiles(
  versions: { admin1?: string | null; admin0?: string | null } = {},
  admin1: FixtureFeature[] = adminOneFeatures(),
  admin0: FixtureFeature[] = adminZeroFeatures(),
): Record<string, Uint8Array> {
  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = {
    [`${ADMIN1}.shp`]: shpBytes(admin1),
    [`${ADMIN1}.dbf`]: dbfBytes(admin1.map((f) => f.row)),
    [`${ADMIN0}.shp`]: shpBytes(admin0),
    [`${ADMIN0}.dbf`]: dbfBytes(admin0.map((f) => f.row)),
  };
  const one = versions.admin1 === undefined ? '5.1.2\n' : versions.admin1;
  const zero = versions.admin0 === undefined ? '5.1.2\r\n' : versions.admin0;
  if (one !== null) files[VERSION1] = encoder.encode(one);
  if (zero !== null) files[VERSION0] = encoder.encode(zero);
  return files;
}
