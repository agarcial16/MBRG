import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { realImportFs, runImport, type ImportFs } from '../src/cli/import';
import { parseCuration } from '../src/importer/curation';
import { inspectSource } from '../src/importer/inspect';
import { readSource } from '../src/importer/read-source';
import { bytesOf, collection, feat, polygon, textBytes } from './helpers/geo-fixture';

function summaryOf(features: unknown[], primary = 's.geojson') {
  const read = readSource({ file: 's', bytes: bytesOf(collection(features)) }, { usedProperties: [] });
  if (!read.ok) throw new Error(`the source should read: ${JSON.stringify(read.errors)}`);
  return inspectSource(read.value, primary);
}

describe('FR-591 the inspect summary', () => {
  it('FR-591 prints the counts, the ranges and each property in order of first appearance, with English labels', () => {
    const { summary } = summaryOf([
      feat({ code: '08019', name: 'Barcelona', pop: 5 }, polygon(2, 41, 1)),
      feat({ code: '28079', name: 'Madrid', pop: 3, region: 'centro' }, polygon(-4, 40, 1)),
      feat({ code: '28079', name: 'Madrid', pop: 3.5 }, null),
      feat(null, polygon(0, 0, 1)),
    ]);
    expect(summary).toBe(
      [
        'features: 3',
        'skippedNullGeometries: 1',
        'positions: 15',
        'longitude: -4 to 3',
        'latitude: 0 to 42',
        'properties: 4',
        'property: "code"',
        '  features: 2',
        '  types: string',
        '  distinctValues: 2',
        '  unique: yes',
        '  firstValues: "08019", "28079"',
        'property: "name"',
        '  features: 2',
        '  types: string',
        '  distinctValues: 2',
        '  unique: yes',
        '  firstValues: "Barcelona", "Madrid"',
        'property: "pop"',
        '  features: 2',
        '  types: integer',
        '  distinctValues: 2',
        '  unique: yes',
        '  firstValues: 5, 3',
        'property: "region"',
        '  features: 1',
        '  types: string',
        '  distinctValues: 1',
        '  unique: yes',
        '  firstValues: "centro"',
        '',
      ].join('\n'),
    );
  });

  it('FR-591 counts a unit made of several features once per value: a repeated value is not unique', () => {
    const { summary } = summaryOf([
      feat({ code: 'A' }, polygon(0, 0)),
      feat({ code: 'A' }, polygon(2, 0)),
      feat({ code: 'B' }, polygon(4, 0)),
    ]);
    expect(summary).toContain('  features: 3\n  types: string\n  distinctValues: 2\n  unique: no\n  firstValues: "A", "B"\n');
  });

  it('FR-591 lists the value types seen in a fixed order and counts only text and integers as usable values', () => {
    const { summary } = summaryOf([
      feat({ v: 'x' }, polygon(0, 0)),
      feat({ v: 28 }, polygon(2, 0)),
      feat({ v: 28.5 }, polygon(4, 0)),
      feat({ v: true }, polygon(6, 0)),
      feat({ v: null }, polygon(8, 0)),
      feat({ v: { a: 1 } }, polygon(10, 0)),
      feat({ v: [1] }, polygon(12, 0)),
    ]);
    expect(summary).toContain(
      'property: "v"\n  features: 7\n  types: string, integer, number, boolean, null, object, array\n  distinctValues: 2\n  unique: yes\n  firstValues: "x", 28\n',
    );
  });

  it('FR-591 reads an integer as its shortest decimal: 28 and the text 28 are one value, and 28.0 is 28', () => {
    const features = [feat({ v: 28 }, polygon(0, 0)), feat({ v: '28' }, polygon(2, 0)), feat({ v: 28.0 }, polygon(4, 0))];
    const { summary } = summaryOf(features);
    expect(summary).toContain('  distinctValues: 1\n  unique: no\n  firstValues: 28\n');
    // an integer code that lost its leading zeros is shown as stored
    expect(summaryOf([feat({ v: 8019 }, polygon(0, 0))]).summary).toContain('firstValues: 8019\n');
  });

  it('FR-591 keeps the form of the first value seen and counts a number beyond 2^53 as no integer, so as no usable value', () => {
    expect(summaryOf([feat({ v: '28' }, polygon(0, 0)), feat({ v: 28 }, polygon(2, 0))]).summary).toContain(
      '  distinctValues: 1\n  unique: no\n  firstValues: "28"\n',
    );
    const big = summaryOf([feat({ v: 1e21 }, polygon(0, 0)), feat({ v: 9007199254740992 }, polygon(2, 0))]).summary;
    expect(big).toContain('  types: number\n  distinctValues: 0\n');
  });

  it('FR-591 shows the first 5 distinct values in order of first appearance, texts with their spaces', () => {
    const values = ['  lead', 'b', 'b', 'c', 'd', 'e', 'f', 'g'];
    const { summary } = summaryOf(values.map((v, i) => feat({ v }, polygon(i * 2, 0))));
    expect(summary).toContain('  distinctValues: 7\n  unique: no\n  firstValues: "  lead", "b", "c", "d", "e"\n');
  });

  it('FR-591 reports a property with no usable value and an empty source', () => {
    expect(summaryOf([feat({ v: null }, polygon(0, 0))]).summary).toContain('  types: null\n  distinctValues: 0\n  unique: no\n  firstValues: none\n');
    const empty = summaryOf([feat({ a: 1 }, null)]).summary;
    expect(empty).toBe('features: 0\nskippedNullGeometries: 1\npositions: 0\nlongitude: none\nlatitude: none\nproperties: 0\n');
  });

  it('FR-591 shows a property name as a json text, so no name can spoil the layout', () => {
    const { summary } = summaryOf([feat({ 'a\nb': 'x' }, polygon(0, 0))]);
    expect(summary).toContain('property: "a\\nb"\n');
  });

  it('FR-591 gives the same summary and the same draft bytes twice on the same source', () => {
    const features = [feat({ a: 'x', b: 1 }, polygon(0, 0)), feat({ a: 'y' }, polygon(2, 0))];
    const one = summaryOf(features);
    const two = summaryOf(features);
    expect(one.summary).toBe(two.summary);
    expect(Buffer.from(one.draft).equals(Buffer.from(two.draft))).toBe(true);
  });
});

describe('FR-591 the draft curation', () => {
  const draftOf = (primary?: string) => summaryOf([feat({ a: 'x' }, polygon(0, 0))], primary).draft;

  it('FR-591 holds every member of the schema, an empty key, empty lists and the development parameters, in the builder json format', () => {
    const text = new TextDecoder().decode(draftOf('../in/s.geojson'));
    expect(JSON.parse(text)).toStrictEqual({
      primary: '../in/s.geojson',
      context: [],
      columns: { key: '', name: [] },
      select: [],
      exclude: [],
      params: { side: 2048, margin: 0.02, minPieceSize: 40, projection: 'laea' },
      units: {},
      territoryBy: { property: '' },
      territoryNames: {},
      factions: [],
      factionBy: { property: '' },
      seas: [],
      insets: [],
    });
    expect(Object.keys(JSON.parse(text))).toStrictEqual([
      'primary', 'context', 'columns', 'select', 'exclude', 'params', 'units', 'territoryBy', 'territoryNames', 'factions', 'factionBy', 'seas', 'insets',
    ]);
    expect(text.startsWith('{\n  "primary": "../in/s.geojson",\n')).toBe(true);
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('FR-591 passes the schema except for the empty key and the empty name list, so an unedited draft always fails the import', () => {
    const r = parseCuration(draftOf(), 'c.json');
    expect(r.ok ? [] : r.errors).toStrictEqual([
      { kind: 'invalid-curation', path: 'columns.key' },
      { kind: 'invalid-curation', path: 'columns.name' },
    ]);
  });
});

describe('FR-591 the inspect mode of the import command', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mbrg-inspect-'));
    mkdirSync(join(dir, 'in'), { recursive: true });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const source = (): string => join(dir, 'in', 's.geojson');
  const put = (file: string, content: Uint8Array | string): void => {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
  };
  const good = () => put(source(), bytesOf(collection([feat({ code: 'A', n: 1 }, polygon(0, 0)), feat({ code: 'B', n: 2 }, polygon(2, 0))])));
  async function cmd(args: string[], fs: ImportFs = realImportFs): Promise<{ status: number; stdout: string; stderr: string }> {
    let stdout = '';
    let stderr = '';
    const status = await runImport(['inspect', ...args], { fs, root: dir, stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) });
    return { status, stdout, stderr };
  }

  it('FR-591 prints the summary of a source and writes nothing when --draft is absent', async () => {
    good();
    const before = readdirSync(dir).sort();
    const r = await cmd([`--source=${source()}`]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout.startsWith('features: 2\nskippedNullGeometries: 0\npositions: 10\n')).toBe(true);
    expect(r.stdout).toContain('property: "code"\n');
    expect(readdirSync(dir).sort()).toStrictEqual(before);
    expect(readdirSync(join(dir, 'in'))).toStrictEqual(['s.geojson']);
  });

  it('FR-591 writes the draft where --draft says, with the primary path relative to the draft and forward slashes', async () => {
    good();
    const draft = join(dir, 'cur', 'map', 'curation.json');
    const r = await cmd([`--source=${source()}`, `--draft=${draft}`]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('features: 2');
    const written = JSON.parse(readFileSync(draft, 'utf8'));
    expect(written.primary).toBe('../../in/s.geojson');
    expect(readdirSync(join(dir, 'cur', 'map'))).toStrictEqual(['curation.json']);
  });

  it('FR-591 two runs on the same source give the same summary and the same draft bytes', async () => {
    good();
    const a = join(dir, 'a.json');
    const b = join(dir, 'b.json');
    const one = await cmd([`--source=${source()}`, `--draft=${a}`]);
    const two = await cmd([`--source=${source()}`, `--draft=${b}`]);
    expect(one.stdout).toBe(two.stdout);
    expect(readFileSync(a).equals(readFileSync(b))).toBe(true);
  });

  it('FR-591 refuses a draft path whose folder holds a map.json: exit 2, usage-error draft-inside-package, nothing written', async () => {
    good();
    put(join(dir, 'pkg', 'map.json'), '{}');
    const draft = join(dir, 'pkg', 'curation.json');
    const r = await cmd([`--source=${source()}`, `--draft=${draft}`]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    const lines = r.stderr.trim().split('\n');
    expect(JSON.parse(lines[0]!)).toStrictEqual({ kind: 'usage-error', reason: 'draft-inside-package', draft });
    expect(lines[1]).toContain('usage: import-map inspect');
    expect(existsSync(draft)).toBe(false);
  });

  it('FR-591 refuses a source that fails the reader or the caps with exit 1 and prints no summary and no draft', async () => {
    put(source(), bytesOf(collection([feat({}, { type: 'Point', coordinates: [0, 0] })])));
    const draft = join(dir, 'c.json');
    const r = await cmd([`--source=${source()}`, `--draft=${draft}`]);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(JSON.parse(r.stderr.trim())).toStrictEqual({ kind: 'unsupported-geometry', file: 's.geojson', feature: 0, type: 'Point' });
    expect(existsSync(draft)).toBe(false);
    // a 300 MiB file is refused on its size alone
    let reads = 0;
    const fake: ImportFs = {
      ...realImportFs,
      size: () => 300 * 1024 * 1024,
      readFile: () => {
        reads++;
        return new Uint8Array(0);
      },
    };
    const big = await cmd([`--source=${source()}`], fake);
    expect(big.status).toBe(1);
    expect(JSON.parse(big.stderr.trim())).toMatchObject({ kind: 'source-too-large', what: 'bytes' });
    expect(reads).toBe(0);
    // a file that is missing
    const missing = await cmd([`--source=${join(dir, 'in', 'none.geojson')}`]);
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stderr.trim())).toStrictEqual({ kind: 'invalid-source', file: 'none.geojson', reason: 'unreadable' });
  });

  it('FR-591 exits 2 with the usage line for a missing source, an unknown option or an empty value', async () => {
    good();
    for (const args of [[], ['--draft=x.json'], [`--source=${source()}`, '--bogus'], [`--source=${source()}`, '--bogus=1'], ['--source='], [`--source=${source()}`, `--source=${source()}`]]) {
      const r = await cmd(args);
      expect(r.status, args.join(' ')).toBe(2);
      expect(r.stderr).toContain('usage: import-map inspect --source=<file.geojson> [--draft=<file.json>]');
    }
  });

  it('FR-591 takes the source of a shapefile extraction: the extract output reads back through inspect', async () => {
    put(source(), textBytes('{"type":"FeatureCollection","features":[\n{"type":"Feature","properties":{"a":"x"},"geometry":null}\n]}\n'));
    const r = await cmd([`--source=${source()}`]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('skippedNullGeometries: 1');
  });
});
