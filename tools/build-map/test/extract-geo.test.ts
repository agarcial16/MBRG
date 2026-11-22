import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { realImportFs, runImport, type ImportFs } from '../src/cli/import';
import { readShapefile, openShpGeometry } from '../src/extract/read-shapefile';
import { extractGeo, type ExtractGeoInput } from '../src/importer/extract-geo';
import { normalizeEncoding } from '../src/importer/read-dbf';
import { readSource } from '../src/importer/read-source';
import { dbfRaw, shpWithNulls, type Cell, type DbfOptions, type FieldSpec } from './helpers/dbf-fixture';
import { holeRect, outerRect, shpBytes } from './helpers/ne-fixture';

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

const NAME: FieldSpec = { name: 'NAME', type: 'C', length: 20 };
const CODE: FieldSpec = { name: 'CODE', type: 'C', length: 8 };
const SQUARES = [[outerRect(0, 0, 1, 1)], [outerRect(2, 0, 3, 1)], [outerRect(4, 0, 5, 1)]];

interface Spec {
  fields?: FieldSpec[];
  rows?: Cell[][];
  records?: (ReturnType<typeof outerRect>[] | null)[];
  dbfOptions?: DbfOptions;
}

/** A fixture shapefile and table read through the shapefile adapter and the pure extraction. */
async function run(spec: Spec = {}, rest: Omit<ExtractGeoInput, 'geometries' | 'dbf'> = {}) {
  const fields = spec.fields ?? [NAME, CODE];
  const rows = spec.rows ?? [['Alfa', '01'], ['Beta', '02'], ['Gamma', '03']];
  const records = spec.records ?? SQUARES;
  const geometries = await openShpGeometry(arrayBuffer(shpWithNulls(records)));
  return extractGeo({ geometries, dbf: dbfRaw(fields, rows, spec.dbfOptions), ...rest });
}

async function features(spec: Spec = {}, rest: Omit<ExtractGeoInput, 'geometries' | 'dbf'> = {}): Promise<any[]> {
  const r = await run(spec, { cpg: 'utf-8', ...rest });
  if (!r.ok) throw new Error(`extraction failed: ${JSON.stringify(r.errors)}`);
  return JSON.parse(decode(r.value)).features;
}

async function errorsOf(spec: Spec = {}, rest: Omit<ExtractGeoInput, 'geometries' | 'dbf'> = {}): Promise<unknown[]> {
  const r = await run(spec, rest);
  if (r.ok) throw new Error('the extraction should fail');
  return r.errors;
}

describe('FR-590 the extraction of any shapefile to a source', () => {
  it('FR-590 writes one feature per shapefile record, in record order, holding every property when none is kept', async () => {
    const out = await features();
    expect(out.map((f) => f.properties)).toStrictEqual([
      { NAME: 'Alfa', CODE: '01' },
      { NAME: 'Beta', CODE: '02' },
      { NAME: 'Gamma', CODE: '03' },
    ]);
    expect(out.every((f) => f.type === 'Feature')).toBe(true);
    expect(out[0].geometry).toStrictEqual({ type: 'Polygon', coordinates: [outerRect(0, 0, 1, 1)] });
    expect(out[2].geometry.coordinates[0][0]).toStrictEqual([4, 0]);
  });

  it('FR-590 reads a polygon with a hole and a multipolygon as the library classifies their rings', async () => {
    const out = await features(
      {
        rows: [['Hole'], ['Two']],
        fields: [NAME],
        records: [[outerRect(0, 0, 10, 10), holeRect(2, 2, 3, 3)], [outerRect(0, 0, 1, 1), outerRect(5, 5, 6, 6)]],
      },
    );
    expect(out[0].geometry.type).toBe('Polygon');
    expect(out[0].geometry.coordinates).toHaveLength(2);
    expect(out[1].geometry.type).toBe('MultiPolygon');
    expect(out[1].geometry.coordinates).toHaveLength(2);
  });

  it('FR-590 holds only the kept properties, in the order they are kept, and each name once', async () => {
    const out = await features({}, { keep: ['CODE', 'NAME', 'CODE'] });
    expect(Object.keys(out[0].properties)).toStrictEqual(['CODE', 'NAME']);
    expect((await features({}, { keep: ['NAME'] })).map((f) => f.properties)).toStrictEqual([{ NAME: 'Alfa' }, { NAME: 'Beta' }, { NAME: 'Gamma' }]);
  });

  it('FR-590 fails with unknown-field for every kept name that is no field of the table, case included', async () => {
    expect(await errorsOf({}, { cpg: 'utf-8', keep: ['NAME', 'name', 'POP', 'POP', 'ZED'] })).toStrictEqual([
      { kind: 'unknown-field', field: 'name' },
      { kind: 'unknown-field', field: 'POP' },
      { kind: 'unknown-field', field: 'ZED' },
    ]);
  });

  it('FR-590 decodes UTF-8, Windows-1252 and ISO-8859-1 text named by the cpg file', async () => {
    const rows = [['España'], ['Peñón']];
    const utf8 = await features({ fields: [NAME], rows, records: SQUARES.slice(0, 2) }, { cpg: 'UTF-8' });
    expect(utf8.map((f) => f.properties.NAME)).toStrictEqual(['España', 'Peñón']);
    const cp1252 = await features({ fields: [NAME], rows: [...rows, ['€ 5']], dbfOptions: { enc: 'cp1252' } }, { cpg: 'windows-1252\n' });
    expect(cp1252.map((f) => f.properties.NAME)).toStrictEqual(['España', 'Peñón', '€ 5']);
    const latin1 = await features({ fields: [NAME], rows, records: SQUARES.slice(0, 2), dbfOptions: { enc: 'latin1' } }, { cpg: 'ISO-8859-1' });
    expect(latin1.map((f) => f.properties.NAME)).toStrictEqual(['España', 'Peñón']);
  });

  it('FR-590 reads the byte 0x80 as the euro sign in Windows-1252 and as a control character in ISO-8859-1', async () => {
    const cell = new Uint8Array(20).fill(0x20);
    cell[0] = 0x80;
    const spec = { fields: [NAME], rows: [[cell]], records: [SQUARES[0]!] };
    expect((await features(spec, { cpg: 'cp1252' }))[0].properties.NAME).toBe('€');
    expect((await features(spec, { cpg: 'latin1' }))[0].properties.NAME).toBe('\u0080');
  });

  it('FR-590 decodes every byte of Windows-1252 as the standard table does, with its own table and not the runtime decoder', async () => {
    const cell = (b: number) => Uint8Array.of(b, 0x20, 0x20);
    const one: FieldSpec = { name: 'C', type: 'C', length: 3 };
    const bytes = [0x80, 0x82, 0x85, 0x8a, 0x91, 0x92, 0x93, 0x94, 0x96, 0x97, 0x99, 0x9f, 0x81, 0xa0, 0xe9, 0xff];
    const records = bytes.map((_, i) => [outerRect(i * 2, 0, i * 2 + 1, 1)]);
    const out = await features({ fields: [one], rows: bytes.map((b) => [cell(b)]), records }, { cpg: 'cp1252' });
    expect(out.map((f) => f.properties.C)).toStrictEqual([
      '€', '‚', '…', 'Š', '‘', '’', '“', '”', '–', '—', '™', 'Ÿ', '', ' ', 'é', 'ÿ',
    ]);
  });

  it('FR-590 keeps a byte order mark that is part of a value and a field named __proto__ as plain data', async () => {
    const bom = new Uint8Array(20).fill(0x20);
    bom.set([0xef, 0xbb, 0xbf, 0x41], 0);
    const fields: FieldSpec[] = [{ name: '__proto__', type: 'C', length: 20 }, { name: 'ID', type: 'N', length: 4 }];
    const out = await features({ fields, rows: [[bom, '7']], records: [SQUARES[0]!] });
    expect(Object.keys(out[0].properties)).toStrictEqual(['__proto__', 'ID']);
    expect(Object.getOwnPropertyDescriptor(out[0].properties, '__proto__')?.value).toBe('﻿A');
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });

  it('FR-590 reads the common spellings of an encoding name, and the command option overrides the cpg file', async () => {
    for (const [name, enc] of [
      ['UTF-8', 'utf-8'],
      ['utf8', 'utf-8'],
      ['65001', 'utf-8'],
      [' UTF-8\u0000', 'utf-8'],
      ['﻿UTF-8', 'utf-8'],
      ['windows-1252', 'windows-1252'],
      ['WINDOWS-1252', 'windows-1252'],
      ['CP1252', 'windows-1252'],
      ['1252', 'windows-1252'],
      ['ANSI 1252', 'windows-1252'],
      ['ISO-8859-1', 'iso-8859-1'],
      ['ISO8859-1', 'iso-8859-1'],
      ['Latin1', 'iso-8859-1'],
      ['latin-1', 'iso-8859-1'],
    ] as const) {
      expect(normalizeEncoding(name), name).toBe(enc);
    }
    for (const name of ['', 'KOI8-R', 'UTF-16', 'ISO-8859-15', 'ascii', '8859']) {
      expect(normalizeEncoding(name), name).toBeUndefined();
    }
    // a wrong cpg is overridden by the option, which wins
    const rows = [['España']];
    const out = await features({ fields: [NAME], rows, records: [SQUARES[0]!] }, { cpg: 'windows-1252', encoding: 'utf-8' });
    expect(out[0].properties.NAME).toBe('España');
  });

  it('FR-590 fails with unknown-dbf-encoding when neither the cpg file nor the command names one, or names an unknown one', async () => {
    expect(await errorsOf()).toStrictEqual([{ kind: 'unknown-dbf-encoding', encoding: '' }]);
    expect(await errorsOf({}, { cpg: 'KOI8-R' })).toStrictEqual([{ kind: 'unknown-dbf-encoding', encoding: 'KOI8-R' }]);
    expect(await errorsOf({}, { cpg: 'utf-8', encoding: 'EBCDIC' })).toStrictEqual([{ kind: 'unknown-dbf-encoding', encoding: 'EBCDIC' }]);
    // an empty cpg file names nothing
    expect(await errorsOf({}, { cpg: '  \n' })).toStrictEqual([{ kind: 'unknown-dbf-encoding', encoding: '' }]);
  });

  it('FR-590 fails with invalid-dbf-text for a value that is not valid in the named encoding', async () => {
    const cell = new Uint8Array(20).fill(0x20);
    cell[0] = 0xff;
    cell[1] = 0xfe;
    const spec = { fields: [NAME], rows: [['ok'], [cell]], records: SQUARES.slice(0, 2) };
    expect(await errorsOf(spec, { cpg: 'utf-8' })).toStrictEqual([{ kind: 'invalid-dbf-text', field: 'NAME', record: 1 }]);
    // the same bytes are valid text in a single-byte encoding
    expect((await features(spec, { cpg: 'latin1' }))[1].properties.NAME).toBe('ÿþ');
  });

  it('FR-590 removes trailing space and NUL padding, turns an empty text into null and keeps leading and inner spaces', async () => {
    const rows = [['  Madrid  '], ['a  b'], [''], ['    ']];
    for (const pad of [0x20, 0x00]) {
      const out = await features({ fields: [NAME], rows, records: [...SQUARES, [outerRect(6, 0, 7, 1)]], dbfOptions: { pad } }, { cpg: 'utf-8' });
      expect(out.map((f) => f.properties.NAME), `pad ${pad}`).toStrictEqual(['  Madrid', 'a  b', null, null]);
    }
  });

  it('FR-590 a NUL-padded table decodes as the real Natural Earth files do, and mixed padding is removed too', async () => {
    const cell = new Uint8Array(20);
    cell.set(text('Soria'), 0);
    cell.set([0x20, 0x00, 0x20, 0x00], 5);
    const out = await features({ fields: [NAME], rows: [[cell]], records: [SQUARES[0]!] }, { cpg: 'utf-8' });
    expect(out[0].properties.NAME).toBe('Soria');
  });

  it('FR-590 a value with leading spaces keeps them, which the library path (value.trim) would lose', async () => {
    const spec = { fields: [NAME], rows: [['  Spaced', ' x'], ['Beta']] as Cell[][], records: SQUARES.slice(0, 2) };
    const own = await features({ ...spec, rows: [['  Spaced'], ['Beta']] }, { cpg: 'utf-8' });
    expect(own[0].properties.NAME).toBe('  Spaced');
    const library = await readShapefile(
      arrayBuffer(shpWithNulls(SQUARES.slice(0, 2))),
      arrayBuffer(dbfRaw([NAME], [['  Spaced'], ['Beta']])),
    );
    expect(library[0]!.props['NAME']).toBe('Spaced');
  });

  it('FR-590 reads numbers, dates and logicals by their field type and text as text, keeping an integer code as stored', async () => {
    const fields: FieldSpec[] = [
      { name: 'CODE', type: 'C', length: 8 },
      { name: 'ID', type: 'N', length: 10 },
      { name: 'AREA', type: 'N', length: 12, decimals: 3 },
      { name: 'BORN', type: 'D', length: 8 },
      { name: 'ON', type: 'L', length: 1 },
    ];
    const out = await features(
      { fields, rows: [['08019', '8019', '12.500', '19140728', 'T'], ['', '', '', '        ', '?'], ['x', '-5', '28.0', '19391', 'n']], records: SQUARES },
      { cpg: 'utf-8' },
    );
    expect(out[0].properties).toStrictEqual({ CODE: '08019', ID: 8019, AREA: 12.5, BORN: '19140728', ON: true });
    expect(out[1].properties).toStrictEqual({ CODE: null, ID: null, AREA: null, BORN: null, ON: null });
    expect(out[2].properties).toStrictEqual({ CODE: 'x', ID: -5, AREA: 28, BORN: '19391', ON: false });
  });

  it('FR-590 declines a projected coordinate system named by the prj file and accepts a geographic one', async () => {
    expect(await errorsOf({}, { cpg: 'utf-8', prj: 'PROJCS["ETRS89 / UTM zone 30N",GEOGCS["ETRS89"]]' })).toStrictEqual([{ kind: 'projected-crs' }]);
    expect(await errorsOf({}, { cpg: 'utf-8', prj: '﻿  PROJCS["x"]' })).toStrictEqual([{ kind: 'projected-crs' }]);
    expect((await features({}, { cpg: 'utf-8', prj: 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984"]]' })).length).toBe(3);
    expect((await features({}, { cpg: 'utf-8', prj: '' })).length).toBe(3);
    // a projected name that is not at the start is no projected declaration
    expect((await features({}, { cpg: 'utf-8', prj: 'GEOGCS["PROJCS"]' })).length).toBe(3);
  });

  it('FR-590 reports every problem of one run together: projected, encoding and unknown fields', async () => {
    expect(await errorsOf({}, { prj: 'PROJCS["x"]', keep: ['NOPE'] })).toStrictEqual([
      { kind: 'projected-crs' },
      { kind: 'unknown-dbf-encoding', encoding: '' },
      { kind: 'unknown-field', field: 'NOPE' },
    ]);
  });

  it('FR-590 keeps the coordinates as read, with no default rounding', async () => {
    const odd = [[[0.1234567891234, 0.5], [0.1234567891234, 1.5], [1.5, 1.5], [1.5, 0.5], [0.1234567891234, 0.5]] as [number, number][]];
    const out = await features({ fields: [NAME], rows: [['x']], records: [odd] }, { cpg: 'utf-8' });
    expect(out[0].geometry.coordinates[0]).toStrictEqual(odd[0]);
  });

  it('FR-590 rounds to N decimals with round and collapses consecutive equal vertices, never removing another', async () => {
    const ring: [number, number][] = [
      [1.1234549, 6.1],
      [1.1234549, 7.7777777],
      [3.5, 7.7777777],
      [3.5, 6.1],
      [2.1234563, 6.1],
      [2.12345612, 6.1000001],
      [2.1234561, 6.0999999],
      [1.1234549, 6.1],
    ];
    const out = await features({ fields: [NAME], rows: [['x']], records: [[ring]] }, { cpg: 'utf-8', round: 6 });
    expect(out[0].geometry.coordinates[0]).toStrictEqual([
      [1.123455, 6.1],
      [1.123455, 7.777778],
      [3.5, 7.777778],
      [3.5, 6.1],
      [2.123456, 6.1],
      [1.123455, 6.1],
    ]);
  });

  it('FR-590 turns a null shape record into a feature with a null geometry, in its place', async () => {
    const out = await features({ records: [SQUARES[0]!, null, SQUARES[2]!] }, { cpg: 'utf-8' });
    expect(out.map((f) => f.properties.NAME)).toStrictEqual(['Alfa', 'Beta', 'Gamma']);
    expect(out[1].geometry).toBeNull();
    expect(out[0].geometry).not.toBeNull();
  });

  it('FR-590 refuses a table whose record count differs from the shapefile, or that is cut short or malformed', async () => {
    const geometries = await openShpGeometry(arrayBuffer(shpWithNulls(SQUARES)));
    const rows = [['a', '1'], ['b', '2'], ['c', '3']];
    const dbf = dbfRaw([NAME, CODE], rows);
    const reasons = (d: Uint8Array, g = geometries) => {
      const r = extractGeo({ geometries: g, dbf: d, cpg: 'utf-8' });
      return r.ok ? [] : r.errors;
    };
    expect(reasons(dbfRaw([NAME, CODE], rows.slice(0, 2)))).toStrictEqual([{ kind: 'invalid-input', reason: 'the table and the shapefile differ in record count' }]);
    expect(reasons(dbf.subarray(0, dbf.length - 40))).toStrictEqual([{ kind: 'invalid-input', reason: 'the table is cut short' }]);
    expect(reasons(dbf.subarray(0, 20))).toStrictEqual([{ kind: 'invalid-input', reason: 'the table has no readable header' }]);
    const noTerminator = dbf.slice();
    noTerminator[32 + 64] = 0x41; // overwrite the field list terminator
    expect(reasons(noTerminator)).toStrictEqual([{ kind: 'invalid-input', reason: 'the table has no readable header' }]);
  });

  it('FR-590 two runs on the same files give byte-identical output, written with the builder json format', async () => {
    const a = await run({}, { cpg: 'utf-8', round: 7 });
    const b = await run({}, { cpg: 'utf-8', round: 7 });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(Buffer.from(a.value).equals(Buffer.from(b.value))).toBe(true);
      const t = decode(a.value);
      // one feature a line: a big source stays small and line-oriented
      expect(t.startsWith('{"type":"FeatureCollection","features":[\n{"type":"Feature"')).toBe(true);
      expect(t.endsWith('\n]}\n')).toBe(true);
      expect(t.split('\n')).toHaveLength(6);
      expect(t).not.toContain(' ');
    }
  });

  it('FR-590 the output is a source the reader accepts, record for record', async () => {
    const r = await run({ records: [SQUARES[0]!, null, SQUARES[2]!] }, { cpg: 'utf-8' });
    if (!r.ok) throw new Error('extraction failed');
    const read = readSource({ file: 'x', bytes: r.value }, { usedProperties: ['NAME'] });
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.features.map((f) => f.index)).toStrictEqual([0, 2]);
      expect(read.value.skippedNull).toBe(1);
    }
  });
});

describe('FR-590 the shapefile adapter keeps the geometry the library reads', () => {
  it('FR-590 openShpGeometry gives one geometry per record, null for a null shape, and refuses a shapefile that is not polygons', async () => {
    const geometries = await openShpGeometry(arrayBuffer(shpBytes([{ rings: [outerRect(0, 0, 1, 1)] }, { rings: [outerRect(2, 2, 3, 3), outerRect(5, 5, 6, 6)] }])));
    expect(geometries.map((g) => g?.type)).toStrictEqual(['Polygon', 'MultiPolygon']);
    const withNull = await openShpGeometry(arrayBuffer(shpWithNulls([null, SQUARES[0]!])));
    expect(withNull[0]).toBeNull();
    // a point shapefile: shape type 1
    const points = new Uint8Array(100 + 28);
    const view = new DataView(points.buffer);
    view.setInt32(0, 9994, false);
    view.setInt32(24, points.length / 2, false);
    view.setInt32(28, 1000, true);
    view.setInt32(32, 1, true);
    view.setInt32(100, 1, false);
    view.setInt32(104, 10, false);
    view.setInt32(108, 1, true);
    view.setFloat64(112, 1, true);
    view.setFloat64(120, 2, true);
    await expect(openShpGeometry(arrayBuffer(points))).rejects.toThrow(/polygons only/);
  });
});

describe('FR-590 the extract mode of the import command', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mbrg-extract-geo-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function put(name: string, bytes: Uint8Array | string): string {
    const file = join(dir, name);
    mkdirSync(join(dir, 'in'), { recursive: true });
    writeFileSync(file, bytes);
    return file;
  }
  function shapefile(extra: { cpg?: string; prj?: string; dbf?: Uint8Array } = {}): string {
    put('in/sample.shp', shpWithNulls(SQUARES));
    put('in/sample.dbf', extra.dbf ?? dbfRaw([NAME, CODE], [['Alfa', '01'], ['Beta', '02'], ['Gamma', '03']]));
    if (extra.cpg !== undefined) put('in/sample.cpg', extra.cpg);
    if (extra.prj !== undefined) put('in/sample.prj', extra.prj);
    return join(dir, 'in', 'sample.shp');
  }
  async function cmd(args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
    let stdout = '';
    let stderr = '';
    const status = await runImport(['extract', ...args], {
      fs: realImportFs,
      root: dir,
      stdout: (s) => (stdout += s),
      stderr: (s) => (stderr += s),
    });
    return { status, stdout, stderr };
  }
  const out = (): string => join(dir, 'out', 'source.geojson');

  it('FR-590 reads the table, the cpg and the prj next to the shp and writes the source', async () => {
    const shp = shapefile({ cpg: 'UTF-8', prj: 'GEOGCS["GCS_WGS_1984"]' });
    const r = await cmd([`--shp=${shp}`, `--out=${out()}`, '--keep=CODE']);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('3 features');
    const written = JSON.parse(readFileSync(out(), 'utf8'));
    expect(written.features.map((f: any) => f.properties)).toStrictEqual([{ CODE: '01' }, { CODE: '02' }, { CODE: '03' }]);
    // nothing but the output is left behind (no temporary file)
    expect(readdirSync(join(dir, 'out'))).toStrictEqual(['source.geojson']);
  });

  it('FR-590 the encoding option names the encoding when there is no cpg file, and two runs give the same bytes', async () => {
    const shp = shapefile();
    expect((await cmd([`--shp=${shp}`, `--out=${out()}`])).status).toBe(1);
    expect(existsSync(out())).toBe(false);
    expect((await cmd([`--shp=${shp}`, `--out=${out()}`, '--encoding=windows-1252'])).status).toBe(0);
    const first = readFileSync(out());
    const again = join(dir, 'out', 'again.geojson');
    expect((await cmd([`--shp=${shp}`, `--out=${again}`, '--encoding=windows-1252'])).status).toBe(0);
    expect(readFileSync(again).equals(first)).toBe(true);
  });

  it('FR-590 a failed extraction exits 1 with one json line per error and writes no file', async () => {
    const shp = shapefile({ cpg: 'utf-8', prj: 'PROJCS["UTM"]' });
    const r = await cmd([`--shp=${shp}`, `--out=${out()}`, '--keep=NOPE']);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr.trim().split('\n').map((l) => JSON.parse(l))).toStrictEqual([
      { kind: 'projected-crs' },
      { kind: 'unknown-field', field: 'NOPE' },
    ]);
    expect(existsSync(join(dir, 'out'))).toBe(false);
  });

  it('FR-590 the cpg and prj files get the size check before they are read: an oversized one fails source-too-large and is never read', async () => {
    const shp = shapefile({ cpg: 'utf-8', prj: 'GEOGCS["GCS_WGS_1984"]' });
    for (const extension of ['.cpg', '.prj']) {
      const reads: string[] = [];
      const fake: ImportFs = {
        ...realImportFs,
        size: (path) => (path.endsWith(extension) ? 300 * 1024 * 1024 : realImportFs.size(path)),
        readFile: (path) => {
          reads.push(path);
          return realImportFs.readFile(path);
        },
      };
      let stderr = '';
      const status = await runImport(['extract', `--shp=${shp}`, `--out=${out()}`], { fs: fake, root: dir, stdout: () => undefined, stderr: (s) => (stderr += s) });
      expect(status, extension).toBe(1);
      expect(JSON.parse(stderr.trim()), extension).toMatchObject({ kind: 'source-too-large', file: `sample${extension}`, what: 'bytes', cap: 256 * 1024 * 1024 });
      expect(reads.filter((p) => p.endsWith(extension)), extension).toStrictEqual([]);
      expect(existsSync(out())).toBe(false);
    }
  });

  it('FR-590 an unreadable or broken input exits 1 with an invalid-input line', async () => {
    const missing = await cmd([`--shp=${join(dir, 'in', 'none.shp')}`, `--out=${out()}`, '--encoding=utf-8']);
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stderr.trim())).toStrictEqual({ kind: 'invalid-input', reason: 'none.shp cannot be read' });
    const shp = shapefile({ cpg: 'utf-8' });
    put('in/sample.shp', text('not a shapefile at all, not even close to one'));
    const broken = await cmd([`--shp=${shp}`, `--out=${out()}`]);
    expect(broken.status).toBe(1);
    expect(JSON.parse(broken.stderr.trim())).toStrictEqual({ kind: 'invalid-input', reason: 'sample.shp is not a readable polygon shapefile' });
  });

  it('FR-590 usage errors exit 2: a missing option, an unknown option, a round below 6 or not a number', async () => {
    const shp = shapefile({ cpg: 'utf-8' });
    for (const args of [
      [`--out=${out()}`],
      [`--shp=${shp}`],
      [`--shp=${shp}`, `--out=${out()}`, '--bogus'],
      [`--shp=${shp}`, `--out=${out()}`, '--round=5'],
      [`--shp=${shp}`, `--out=${out()}`, '--round=0'],
      [`--shp=${shp}`, `--out=${out()}`, '--round=x'],
      [`--shp=${shp}`, `--out=${out()}`, '--round=16'],
      [`--shp=${shp}`, `--out=${out()}`, '--round='],
      [`--shp=${shp}`, `--out=${out()}`, '--keep='],
    ]) {
      const r = await cmd(args);
      expect(r.status, args.join(' ')).toBe(2);
      expect(r.stderr).toContain('usage: import-map extract');
    }
    expect((await cmd([`--shp=${shp}`, `--out=${out()}`, '--round=6'])).status).toBe(0);
    expect((await cmd([`--shp=${shp}`, `--out=${out()}`, '--round=15'])).status).toBe(0);
  });
});
