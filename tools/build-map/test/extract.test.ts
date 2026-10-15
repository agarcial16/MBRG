import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runExtract } from '../src/cli/extract';
import { formatJson } from '../src/core/json';
import { parseBuildInputs } from '../src/core/parse-inputs';
import { extract, type ExtractError, type ExtractFiles } from '../src/extract/extract';
import { readShapefile } from '../src/extract/read-shapefile';
import { realFs } from '../src/io/fs-ops';
import { inputTexts, miniInputs } from './helpers/fixtures';
import { ADMIN0, ADMIN1, FIXTURE_BOX, VERSION0, VERSION1, neFiles } from './helpers/ne-fixture';

const decoder = new TextDecoder();

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Reads a fixture dataset through the shapefile adapter and runs the pure extraction on it. */
async function run(
  files: Record<string, Uint8Array> = neFiles(),
  selected: string[] = ['AAA'],
  box = FIXTURE_BOX,
  decimals?: number,
) {
  const admin1 = await readShapefile(arrayBuffer(files[`${ADMIN1}.shp`]!), arrayBuffer(files[`${ADMIN1}.dbf`]!));
  const admin0 = await readShapefile(arrayBuffer(files[`${ADMIN0}.shp`]!), arrayBuffer(files[`${ADMIN0}.dbf`]!));
  const text = (name: string): string | undefined => (files[name] === undefined ? undefined : decoder.decode(files[name]));
  return extract(
    { admin1, admin0, versionTexts: { [VERSION1]: text(VERSION1), [VERSION0]: text(VERSION0) } },
    selected,
    box,
    decimals,
  );
}

async function succeeded(...args: Parameters<typeof run>): Promise<ExtractFiles> {
  const result = await run(...args);
  if (!result.ok) throw new Error(`extraction failed: ${JSON.stringify(result.errors)}`);
  return result.value;
}

const json = (bytes: Uint8Array): any => JSON.parse(decoder.decode(bytes));

describe('FR-131 extraction of the committed source subset', () => {
  it('FR-131 keeps the first-level divisions of the selected countries wherever they lie, and no others', async () => {
    const files = await succeeded();
    const codes = json(files.provinces).features.map((f: any) => f.properties.adm1_code);
    expect(codes).toStrictEqual(['AAA-1', 'AAA-2', 'AAA-3', 'AAA-4', 'AAA-5']);
    const both = json((await succeeded(neFiles(), ['AAA', 'BBB'])).provinces).features.map((f: any) => f.properties.adm1_code);
    expect(both).toStrictEqual(['AAA-1', 'AAA-2', 'AAA-3', 'AAA-4', 'AAA-5', 'BBB-1']);
    expect(json((await succeeded(neFiles(), [])).provinces).features).toStrictEqual([]);
  });

  it('FR-131 writes only the listed properties, in lower case, and no geometry for the country records', async () => {
    const files = await succeeded();
    const first = json(files.provinces).features[0];
    expect(first.type).toBe('Feature');
    expect(Object.keys(first.properties)).toStrictEqual(['adm1_code', 'adm0_a3', 'name', 'name_es']);
    expect(first.properties).toStrictEqual({ adm1_code: 'AAA-1', adm0_a3: 'AAA', name: 'Alpha One', name_es: 'Alfa Uno' });
    expect(json(files.countries)).toStrictEqual([{ adm0_a3: 'AAA', name: 'Alpha', name_es: 'Alfa' }]);
    expect(Object.keys(json(files.countries)[0])).toStrictEqual(['adm0_a3', 'name', 'name_es']);
    for (const feature of json(files.otherLand).features) {
      expect(Object.keys(feature.properties)).toStrictEqual(['adm0_a3']);
    }
  });

  it('FR-131 fields are matched case-insensitively whatever the case of the table field names', async () => {
    const files = await succeeded();
    expect(json(files.provinces).features).toHaveLength(5); // upper case fields in the admin-1 table
    expect(json(files.countries)).toHaveLength(1); // lower case fields in the admin-0 table
  });

  it('FR-131 keeps features and kept polygons whole: nothing is clipped to the box', async () => {
    const files = await succeeded();
    const byCode = (code: string): any => json(files.provinces).features.find((f: any) => f.properties.adm1_code === code);
    expect(byCode('AAA-4').geometry.coordinates[0]).toStrictEqual([[9, 9], [9, 12], [12, 12], [12, 9], [9, 9]]);
    expect(byCode('AAA-3').geometry.coordinates[0][0]).toStrictEqual([50, 50]);
  });

  it('FR-131 other land is chosen per polygon by its own bounding box touching the box, never per country', async () => {
    const files = await succeeded();
    const land = json(files.otherLand).features;
    const summary = land.map((f: any) => [f.properties.adm0_a3, f.geometry.type, f.geometry.coordinates.length]);
    // BBB: the near polygon only (a single polygon is written as a Polygon, its one outer ring)
    expect(summary).toStrictEqual([
      ['BBB', 'Polygon', 1],
      ['DDD', 'Polygon', 1], // bounding box touches the east edge of the box
      ['EEE', 'Polygon', 1], // bounding box contains the box
    ]);
    expect(land[0].geometry.coordinates[0]).toStrictEqual([[2, 2], [2, 3], [3, 3], [3, 2], [2, 2]]);
    const codes = land.map((f: any) => f.properties.adm0_a3);
    expect(codes).not.toContain('AAA'); // selected country: never other land
    expect(codes).not.toContain('CCC'); // all polygons far
    expect(codes).not.toContain('FFF'); // just outside the box
    // a polygon is never dropped from a kept country if its own box touches
    const wide = neFiles(
      {},
      undefined,
      [
        {
          rings: [
            [[2, 2], [2, 3], [3, 3], [3, 2], [2, 2]],
            [[6, 6], [6, 7], [7, 7], [7, 6], [6, 6]],
            [[40, 40], [40, 41], [41, 41], [41, 40], [40, 40]],
          ],
          row: { adm0_a3: 'GGG', name: 'G', name_es: 'G' },
        },
      ],
    );
    const kept = json((await succeeded(wide)).otherLand).features[0];
    expect(kept.geometry.type).toBe('MultiPolygon');
    expect(kept.geometry.coordinates).toHaveLength(2);
  });

  it('FR-131 rounds every coordinate to 5 decimals and collapses consecutive equal vertices, without simplifying', async () => {
    const files = await succeeded();
    const ring = json(files.provinces).features.find((f: any) => f.properties.adm1_code === 'AAA-5').geometry.coordinates[0];
    expect(ring).toStrictEqual([
      [1.12345, 6.1],
      [1.12345, 7.77778],
      [3.5, 7.77778],
      [3.5, 6.1],
      [2.12346, 6.1], // three source vertices round to this one and collapse; it stays although collinear
      [1.12345, 6.1],
    ]);
    // a different number of decimals is a parameter of the same rule
    const coarse = json((await succeeded(neFiles(), ['AAA'], FIXTURE_BOX, 4)).provinces).features.find((f: any) => f.properties.adm1_code === 'AAA-5');
    expect(coarse.geometry.coordinates[0][0]).toStrictEqual([1.1235, 6.1]);
  });

  it('FR-131 rounding keeps vertices shared by two polygons identical', async () => {
    const shared: [number, number] = [3.1234549, 3.9876541];
    const files = neFiles({}, [
      { rings: [[[1, 1], [1, 4], shared, [3, 1], [1, 1]]], row: { ADM1_CODE: 'AAA-1', ADM0_A3: 'AAA', NAME: 'A', NAME_ES: 'A' } },
      { rings: [[[3, 1], shared, [5, 4], [5, 1], [3, 1]]], row: { ADM1_CODE: 'AAA-2', ADM0_A3: 'AAA', NAME: 'B', NAME_ES: 'B' } },
    ]);
    const features = json((await succeeded(files)).provinces).features;
    const a = features[0].geometry.coordinates[0];
    const b = features[1].geometry.coordinates[0];
    expect(a[2]).toStrictEqual(b[1]);
  });

  it('FR-131 removes the space padding of the fixed-width fields and keeps UTF-8 text', async () => {
    const files = await succeeded();
    const second = json(files.provinces).features[1].properties;
    expect(second.name).toBe('Alpha Two');
    expect(second.name_es).toBe('España Dos');
    expect(json(files.provinces).features.every((f: any) => !/\s$/.test(f.properties.name))).toBe(true);
    expect(json(files.countries)[0].name).toBe('Alpha');
  });

  it('FR-131 reads an outer ring with its hole, and several outer rings, correctly', async () => {
    const files = await succeeded();
    const features = json(files.provinces).features;
    const holed = features[0].geometry;
    expect(holed.type).toBe('Polygon');
    expect(holed.coordinates).toHaveLength(2);
    expect(holed.coordinates[0]).toStrictEqual([[1, 1], [1, 4], [4, 4], [4, 1], [1, 1]]);
    expect(holed.coordinates[1]).toStrictEqual([[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]);
    const multi = features[1].geometry;
    expect(multi.type).toBe('MultiPolygon');
    expect(multi.coordinates).toHaveLength(2);
    expect(multi.coordinates.map((p: any) => p.length)).toStrictEqual([1, 1]);
  });

  it('FR-131 sorts the output by identifier and writes the files with the fixed builder JSON format', async () => {
    const files = await succeeded();
    for (const bytes of [files.provinces, files.countries, files.otherLand, files.meta]) {
      expect(bytes[bytes.length - 1]).toBe(0x0a);
      expect(Buffer.from(bytes).equals(Buffer.from(formatJson(json(bytes))))).toBe(true);
    }
    const codes = json((await succeeded(neFiles(), ['AAA', 'BBB'])).provinces).features.map((f: any) => f.properties.adm1_code);
    expect(codes).toStrictEqual([...codes].sort());
  });

  it('FR-131 writes the source metadata record with the version text, trailing line breaks removed', async () => {
    expect(json((await succeeded()).meta)).toStrictEqual({ version: '5.1.2' });
    const crlf = await succeeded(neFiles({ admin1: '5.1.2\r\n\r\n', admin0: '5.1.2' }));
    expect(json(crlf.meta)).toStrictEqual({ version: '5.1.2' });
  });

  it('FR-131 fails with invalid-source-version when a version text is missing, naming both files in code-unit order', async () => {
    const expectedFiles = [VERSION0, VERSION1].sort();
    for (const versions of [{ admin1: null }, { admin0: null }, { admin1: null, admin0: null }]) {
      const result = await run(neFiles(versions));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toStrictEqual<ExtractError[]>([{ kind: 'invalid-source-version', files: expectedFiles }]);
      }
    }
    expect(expectedFiles).toStrictEqual([VERSION0, VERSION1]); // ne_10m_admin_0 sorts before ne_10m_admin_1
  });

  it('FR-131 fails with invalid-source-version when the version texts differ, and ignores only trailing line breaks', async () => {
    const result = await run(neFiles({ admin1: '5.1.1\n', admin0: '5.1.2\n' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toStrictEqual([{ kind: 'invalid-source-version', files: [VERSION0, VERSION1] }]);
    const spaced = await run(neFiles({ admin1: '5.1.2 \n', admin0: '5.1.2\n' }));
    expect(spaced.ok).toBe(false);
    const blank = await run(neFiles({ admin1: '\n', admin0: '\n' }));
    expect(blank.ok).toBe(false);
  });

  it('FR-131 two runs on the same files give byte-identical output', async () => {
    const first = await succeeded();
    const second = await succeeded();
    for (const key of ['provinces', 'countries', 'otherLand', 'meta'] as const) {
      expect(Buffer.from(first[key]).equals(Buffer.from(second[key])), key).toBe(true);
    }
  });

  it('FR-131 the extracted files are accepted as builder inputs', async () => {
    const files = await succeeded();
    const base = inputTexts(miniInputs());
    const parsed = parseBuildInputs({
      ...base,
      provinces: decoder.decode(files.provinces),
      countries: decoder.decode(files.countries),
      otherLand: decoder.decode(files.otherLand),
      meta: decoder.decode(files.meta),
    });
    expect(parsed.ok).toBe(true);
  });
});

describe('FR-131 the shapefile adapter', () => {
  it('FR-131 the adapter accepts only ArrayBuffers: a path or a typed array is refused and no file is read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mbrg-shp-'));
    try {
      const files = neFiles();
      writeFileSync(join(dir, 'a.shp'), files[`${ADMIN1}.shp`]!);
      writeFileSync(join(dir, 'a.dbf'), files[`${ADMIN1}.dbf`]!);
      const shp = arrayBuffer(files[`${ADMIN1}.shp`]!);
      const dbf = arrayBuffer(files[`${ADMIN1}.dbf`]!);
      await expect(readShapefile(join(dir, 'a.shp') as unknown as ArrayBuffer, dbf)).rejects.toThrow(/ArrayBuffer/);
      await expect(readShapefile(shp, join(dir, 'a.dbf') as unknown as ArrayBuffer)).rejects.toThrow(/ArrayBuffer/);
      await expect(readShapefile(new Uint8Array(shp) as unknown as ArrayBuffer, dbf)).rejects.toThrow(/ArrayBuffer/);
      await expect(readShapefile(shp, dbf)).resolves.toHaveLength(6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('FR-131 the adapter reports a file that is not a polygon shapefile', async () => {
    const files = neFiles();
    await expect(readShapefile(new ArrayBuffer(10), arrayBuffer(files[`${ADMIN1}.dbf`]!))).rejects.toThrow();
  });
});

describe('FR-131 the extract command', () => {
  let root: string;
  let neDir: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mbrg-extract-'));
    neDir = join(root, 'ne');
    mkdirSync(neDir, { recursive: true });
    for (const [name, bytes] of Object.entries(neFiles())) writeFileSync(join(neDir, name), bytes);
    const data = join(root, 'tools', 'build-map', 'data', 'dev-map');
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'grouping.json'), JSON.stringify({ countries: [{ country: 'AAA' }], territories: [], excluded: [] }));
    writeFileSync(join(data, 'extraction-box.json'), JSON.stringify(FIXTURE_BOX));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function command(args: string[]) {
    let stdout = '';
    let stderr = '';
    const status = await runExtract(args, {
      fs: realFs,
      root,
      stdout: (s) => (stdout += s),
      stderr: (s) => (stderr += s),
    });
    return { status, stdout, stderr };
  }
  const out = (name: string): string => join(root, 'tools', 'build-map', 'data', 'natural-earth', name);

  it('FR-131 one command reads the local files and writes the four source files, the same bytes on two runs', async () => {
    const first = await command(['--ne', neDir]);
    expect(first.status).toBe(0);
    expect(first.stderr).toBe('');
    const names = ['provinces.json', 'countries.json', 'other-land.json', 'source-meta.json'];
    const bytes = names.map((n) => readFileSync(out(n)));
    const expected = await succeeded();
    expect(Buffer.from(expected.provinces).equals(bytes[0]!)).toBe(true);
    expect(Buffer.from(expected.meta).equals(bytes[3]!)).toBe(true);
    const second = await command([`--ne=${neDir}`]);
    expect(second.status).toBe(0);
    names.forEach((n, i) => expect(readFileSync(out(n)).equals(bytes[i]!), n).toBe(true));
  });

  it('FR-131 differing version texts fail with an invalid-source-version JSON line and write nothing', async () => {
    writeFileSync(join(neDir, VERSION1), '9.9.9\n');
    const result = await command(['--ne', neDir]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr.trim())).toStrictEqual({ kind: 'invalid-source-version', files: [VERSION0, VERSION1] });
    expect(existsSync(out('provinces.json'))).toBe(false);
  });

  it('FR-131 an unreadable or malformed input is an invalid-input error and nothing is written', async () => {
    rmSync(join(neDir, `${ADMIN0}.dbf`));
    const missing = await command(['--ne', neDir]);
    expect(missing.status).toBe(1);
    const error = JSON.parse(missing.stderr.trim().split('\n')[0]!);
    expect(error.kind).toBe('invalid-input');
    expect(error.reason).toMatch(/^[\x20-\x7e]+$/);
    expect(existsSync(out('provinces.json'))).toBe(false);
    writeFileSync(join(root, 'tools', 'build-map', 'data', 'dev-map', 'extraction-box.json'), '{"west":1}');
    const box = await command(['--ne', neDir]);
    expect(box.status).toBe(1);
    expect(JSON.parse(box.stderr.trim().split('\n')[0]!).kind).toBe('invalid-input');
  });

  it('FR-131 a missing --ne directory option is a usage error with status 2', async () => {
    const result = await command([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/usage/);
    expect((await command(['--ne'])).status).toBe(2);
    expect((await command(['--other'])).status).toBe(2);
    expect(existsSync(dirname(out('x')))).toBe(false);
  });
});
