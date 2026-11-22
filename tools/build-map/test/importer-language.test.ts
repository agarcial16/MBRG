import { describe, expect, it } from 'vitest';
import { readBounded, runImport, type ImportFs } from '../src/cli/import';
import { CURATION_KIND_ORDER } from '../src/importer/errors';
import { extractGeo } from '../src/importer/extract-geo';
import { groupFactions, groupTerritories } from '../src/importer/grouping';
import { assignSea } from '../src/importer/sea-sources';
import { buildViews, insetHidesLand } from '../src/importer/views';
import { parseCuration } from '../src/importer/curation';
import { inspectSource, VALUE_TYPES } from '../src/importer/inspect';
import { readSource, readSources } from '../src/importer/read-source';
import { selectUnits } from '../src/importer/select';
import { buildUnits } from '../src/importer/units';
import type { ImportFeature, ShpGeometry } from '../src/importer/types';
import { realImportFs } from '../src/cli/import';
import { dbfRaw } from './helpers/dbf-fixture';
import { bytesOf, collection, crsOf, feat, polygon, ring, textBytes } from './helpers/geo-fixture';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The language of the importer (the builder's language test is never edited): literal lists, not imported from src.
const SOURCE_KINDS = ['invalid-source', 'unsupported-geometry', 'unsupported-crs', 'coordinates-not-degrees', 'source-too-large'];
const EXTRACT_KINDS = ['unknown-dbf-encoding', 'unknown-field', 'invalid-dbf-text', 'projected-crs', 'invalid-input'];
const CURATION_KINDS = ['invalid-curation'];
const UNIT_KINDS = ['missing-unit-key', 'invalid-unit-key', 'conflicting-unit-property', 'sea-with-faction'];
const SELECT_KINDS = ['unknown-unit', 'empty-selection'];
const GROUP_KINDS = ['invalid-key', 'missing-group-value', 'mixed-territory-kind', 'conflicting-group-name', 'missing-territory-name'];
const FACTION_KINDS = ['invalid-name', 'invalid-color', 'duplicate-faction-key', 'missing-faction', 'split-territory-faction', 'missing-faction-name', 'faction-without-territory', 'too-many-factions'];
const VIEW_KINDS = ['selection-too-wide', 'antimeridian-edge', 'unit-in-two-insets', 'empty-inset', 'inset-outside-image', 'insets-overlap', 'inset-hides-land'];
const SEA_KINDS = ['seed-outside-frame', 'seed-not-water', 'duplicate-seed-pixel'];
const COMMAND_KINDS = ['usage-error'];
const IMPORTER_KINDS = [...SOURCE_KINDS, ...EXTRACT_KINDS, ...CURATION_KINDS, ...UNIT_KINDS, ...SELECT_KINDS, ...GROUP_KINDS, ...FACTION_KINDS, ...VIEW_KINDS, ...SEA_KINDS, ...COMMAND_KINDS];
/** Data fields of the importer errors (the kind is always present). */
const DATA_FIELDS = [
  'file',
  'feature',
  'type',
  'crs',
  'reason',
  'what',
  'cap',
  'found',
  'property',
  'encoding',
  'field',
  'record',
  'path',
  'unit',
  'draft',
  'territory',
  'faction',
  'factions',
  'count',
  'inset',
  'insets',
  'seed',
  'seeds',
  'name',
  'x',
  'y',
];
const ALLOWED_KEYS = ['kind', ...DATA_FIELDS];
const INVALID_SOURCE_REASONS = ['not-utf8', 'not-json', 'not-feature-collection', 'bad-feature', 'bad-geometry', 'unreadable'];
const CAP_NAMES = ['bytes', 'features', 'positions', 'properties', 'value'];
/** The labels of the inspect summary, in order, and of each property block. */
const SUMMARY_LABELS = ['features', 'skippedNullGeometries', 'positions', 'longitude', 'latitude', 'properties'];
const PROPERTY_LABELS = ['property', 'features', 'types', 'distinctValues', 'unique', 'firstValues'];
const VALUE_TYPE_NAMES = ['string', 'integer', 'number', 'boolean', 'null', 'object', 'array'];

type Err = Record<string, unknown>;
const errs = (r: { ok: boolean; errors?: unknown[] }): Err[] => (r.ok ? [] : (r.errors as Err[]));

const MIB = 1024 * 1024;
const read = (value: unknown, usedProperties: string[] = [], caps = {}) =>
  readSources([{ file: 'a.geojson', bytes: bytesOf(value) }], { usedProperties, caps });

function sourceErrors(): Err[] {
  const bad = (f: unknown) => errs(read(collection([f])));
  return [
    ...errs(readSource({ file: 'a', bytes: Uint8Array.of(0xff) }, { usedProperties: [] })),
    ...errs(readSource({ file: 'a', bytes: textBytes('{') }, { usedProperties: [] })),
    ...errs(read({})),
    ...bad({ type: 'Point' }),
    ...bad(feat({}, 'x')),
    ...bad(feat({}, { type: 'Point', coordinates: [0, 0] })),
    ...errs(read(collection([feat({}, polygon(0, 0))], crsOf('EPSG:3857')))),
    ...bad(feat({}, { type: 'Polygon', coordinates: [[[500000, 4000000], [500001, 4000000], [500001, 4000001], [500000, 4000000]]] })),
    ...errs(readSources([{ file: 'a', bytes: new Uint8Array(20) }], { usedProperties: [], caps: { bytes: 10 } })),
    ...errs(read(collection([feat({}, null), feat({}, null)]), [], { features: 1 })),
    ...errs(read(collection([feat({}, polygon(0, 0))]), [], { positions: 3 })),
    ...errs(read(collection([feat({ a: 1, b: 2 }, polygon(0, 0))]), [], { properties: 1 })),
    ...errs(read(collection([feat({ a: 'long' }, polygon(0, 0))]), ['a'], { value: 2 })),
    ...errs(
      readBounded({ ...realImportFs, size: () => 1 }, '/nowhere/x', 'x', 0),
    ),
    ...errs(
      readBounded(
        {
          ...realImportFs,
          size: () => {
            throw new Error('gone');
          },
        },
        '/nowhere/x',
        'x',
        10,
      ),
    ),
  ];
}

function extractErrors(): Err[] {
  const geometries: ShpGeometry[] = [{ type: 'Polygon', coordinates: [ring(0, 0) as [number, number][]] }];
  const dbf = dbfRaw([{ name: 'NAME', type: 'C', length: 6 }], [['abc']]);
  const cut = dbf.subarray(0, dbf.length - 3);
  const cell = new Uint8Array(6).fill(0x20);
  cell[0] = 0xff;
  return [
    ...errs(extractGeo({ geometries, dbf })),
    ...errs(extractGeo({ geometries, dbf, cpg: 'utf-8', keep: ['NOPE'] })),
    ...errs(extractGeo({ geometries, dbf: dbfRaw([{ name: 'NAME', type: 'C', length: 6 }], [[cell]]), cpg: 'utf-8' })),
    ...errs(extractGeo({ geometries, dbf, cpg: 'utf-8', prj: 'PROJCS["x"]' })),
    ...errs(extractGeo({ geometries: [], dbf, cpg: 'utf-8' })),
    ...errs(extractGeo({ geometries, dbf: cut, cpg: 'utf-8' })),
    ...errs(extractGeo({ geometries, dbf: dbf.subarray(0, 10), cpg: 'utf-8' })),
  ];
}

const curationText = (change: (c: Record<string, any>) => void = () => undefined): Uint8Array => {
  const c: Record<string, any> = {
    primary: 'p',
    columns: { key: 'code', name: ['name'] },
    params: { side: 128, margin: 0.1, minPieceSize: 2, projection: 'laea' },
  };
  change(c);
  return textBytes(JSON.stringify(c));
};

function curationErrors(): Err[] {
  return [
    ...errs(parseCuration(curationText((c) => (c.params.side = 1)), 'c.json')),
    ...errs(parseCuration(textBytes('['), 'c.json')),
    ...errs(parseCuration(new Uint8Array(17 * MIB), 'c.json')),
  ];
}

function feature(index: number, props: Record<string, unknown>): ImportFeature {
  return { index, props, polygons: [{ outer: { coords: ring(index * 2, 0) as [number, number][] }, holes: [] }] };
}

function unitErrors(): Err[] {
  const c = parseCuration(
    curationText((x) => {
      x.select = [{ property: 'n', gte: 1 }];
      x.units = { S: { kind: 'sea', faction: 'f' }, NOPE: { name: 'x' } };
      x.exclude = ['GONE'];
    }),
    'c.json',
  );
  if (!c.ok) throw new Error('the curation should parse');
  const features = [
    feature(0, { code: 'A', name: 'a', n: 1 }),
    feature(1, { code: 'A', name: 'b', n: 1 }),
    feature(2, {}),
    feature(3, { code: null }),
    feature(4, { code: 'S', n: 1 }),
  ];
  const units = buildUnits(features, c.value);
  const ok = buildUnits([feature(0, { code: 'A', n: 1 })], c.value);
  if (!ok.ok) throw new Error('one unit should form');
  const empty = selectUnits([], c.value);
  return [...errs(units), ...errs(selectUnits(ok.value, c.value)), ...errs(empty)];
}

function factionErrors(): Err[] {
  const c = parseCuration(
    curationText((x) => {
      x.factionBy = { property: 'c', nameProperty: 'cn' };
      x.factions = [
        { key: 'a', name: '', color: '#ABCDEF' },
        { key: 'a', name: 'Again' },
        { key: 'idle', name: 'Idle' },
        { key: 'f'.repeat(300), name: 'Long' },
      ];
      x.units = { M: { faction: 'a' } };
    }),
    'c.json',
  );
  if (!c.ok) throw new Error('the curation should parse');
  const units = buildUnits(
    [
      feature(0, { code: 'A', name: 'a', c: 'p', cn: 'One' }),
      feature(1, { code: 'B', name: 'b', c: 'p', cn: 'Two' }),
      feature(2, { code: 'C', name: 'c', c: 'q' }),
      feature(3, { code: 'D', name: 'd' }),
      feature(4, { code: 'M', name: 'm' }),
      feature(5, { code: 'N', name: 'n' }),
    ],
    c.value,
  );
  if (!units.ok) throw new Error('the units should form');
  const territories = groupTerritories(units.value, c.value);
  if (!territories.ok) throw new Error('the territories should form');
  const split = parseCuration(curationText((x) => ((x.territoryBy = { property: 'g' }), (x.territoryNames = { t: 'T' }), (x.factionBy = { property: 'c', nameProperty: 'c' }))), 'c.json');
  if (!split.ok) throw new Error('the curation should parse');
  const joined = buildUnits([feature(0, { code: 'A', name: 'a', g: 't', c: 'p' }), feature(1, { code: 'B', name: 'b', g: 't', c: 'q' })], split.value);
  if (!joined.ok) throw new Error('the units should form');
  const together = groupTerritories(joined.value, split.value);
  if (!together.ok) throw new Error('the territories should form');
  const many = parseCuration(curationText((x) => (x.factionBy = { property: 'f', nameProperty: 'f' })), 'c.json');
  if (!many.ok) throw new Error('the curation should parse');
  const crowd = buildUnits(Array.from({ length: 10000 }, (_, i) => feature(i, { code: 'u' + i, name: 'u' + i, f: 'f' + i })), many.value);
  if (!crowd.ok) throw new Error('the units should form');
  const crowded = groupTerritories(crowd.value, many.value);
  if (!crowded.ok) throw new Error('the territories should form');
  return [...errs(groupFactions(territories.value, c.value)), ...errs(groupFactions(together.value, split.value)), ...errs(groupFactions(crowded.value, many.value))];
}

function viewErrors(): Err[] {
  const square = (key: string, west: number, east: number) => ({
    key,
    features: [],
    firstFeature: 0,
    polygons: [{ outer: { coords: [[west, 0], [east, 0], [east, 1], [west, 1], [west, 0]] as [number, number][] }, holes: [] }],
    sourceName: key,
    name: key,
    kind: 'land' as const,
    territory: undefined,
    faction: undefined,
    layer: undefined,
  });
  const params = { side: 128, margin: 0.1, minPieceSize: 2, projection: 'laea' as const };
  const wide = buildViews({ selected: [square('W', -100, -99), square('E', 99, 100)], params, insets: [] });
  const fiji = buildViews({
    selected: [square('FJ', 178, -178)],
    insets: [],
    others: [{ origin: { file: 'ctx.geojson', feature: 3 }, polygons: square('X', 178, -178).polygons }],
    params: { ...params, projection: 'equal-earth' as const },
  });
  const withProps = (key: string, region: string, west: number, east: number) => {
    const u = square(key, west, east);
    return { ...u, features: [{ index: 0, props: { region }, polygons: u.polygons }] };
  };
  const a = withProps('A', 'x', 0, 4);
  const b = withProps('B', 'y', 5, 9);
  const pick = (region: string, at: [number, number]) => ({ select: [{ property: 'region', eq: region }], at });
  const wrong = buildViews({
    selected: [a, b, withProps('M', 'm', 20, 30)],
    params: { ...params, side: 64 },
    insets: [pick('x', [0, 0]), pick('x', [1, 1]), pick('none', [0, 0]), pick('y', [60, 60])],
  });
  const overlapping = buildViews({ selected: [a, b, withProps('M', 'm', 20, 30)], params: { ...params, side: 256 }, insets: [pick('x', [0, 0]), pick('y', [1, 1])] });
  const fine = buildViews({ selected: [a, withProps('M', 'm', 20, 30)], params: { ...params, side: 256 }, insets: [pick('x', [0, 0])] });
  if (!fine.ok) throw new Error('the views should build');
  const hidden = insetHidesLand(fine.value, new Uint32Array(256 * 256).fill(1), () => true);
  return [...errs(wide), ...errs(fiji), ...errs(wrong), ...errs(overlapping), ...hidden];
}

function seaErrors(): Err[] {
  const set = buildViews({ selected: [], params: { side: 4, margin: 0.1, minPieceSize: 2, projection: 'equal-earth' }, insets: [] });
  if (!set.ok) throw new Error('the views should build');
  const pixels = new Uint32Array(16).fill(0xffffffff);
  pixels[5] = 3;
  const seed = (name: string, lon: number, lat: number) => ({ id: 9, seed: { name, lon, lat } });
  const r = assignSea({ views: { ...set.value, main: { ...set.value.main, toUV: (lon: number, lat: number) => [lon, lat] as [number, number] } }, pixels, zones: [seed('Outside', 40, 40), seed('Land', 1.5, 1.5), seed('Here', 0.5, 0.5), seed('Again', 0.5, 0.5)] });
  return errs(r);
}

function groupErrors(): Err[] {
  const c = parseCuration(
    curationText((x) => {
      x.territoryBy = { property: 'g', nameProperty: 'gname' };
      x.territoryNames = { m: 'Mixed' };
      x.units = { S: { kind: 'sea', territory: 'm' }, L: { territory: 'm' } };
    }),
    'c.json',
  );
  if (!c.ok) throw new Error('the curation should parse');
  const units = buildUnits(
    [
      feature(0, { code: 'A', name: 'a', g: 'x', gname: 'One' }),
      feature(1, { code: 'B', name: 'b', g: 'x', gname: 'Two' }),
      feature(2, { code: 'C', name: 'c' }),
      feature(3, { code: 'D', g: 'y' }),
      feature(4, { code: 'E', g: 'y' }),
      feature(5, { code: 'F', name: 'f', g: 'k'.repeat(300) }),
      feature(6, { code: 'S', name: 's', g: 'q' }),
      feature(7, { code: 'L', name: 'l', g: 'q' }),
    ],
    c.value,
  );
  if (!units.ok) throw new Error('the units should form');
  return errs(groupTerritories(units.value, c.value));
}

async function commandErrors(): Promise<Err[]> {
  const dir = mkdtempSync(join(tmpdir(), 'mbrg-language-'));
  try {
    mkdirSync(join(dir, 'pkg'));
    writeFileSync(join(dir, 'pkg', 'map.json'), '{}');
    writeFileSync(join(dir, 's.geojson'), bytesOf(collection([feat({ a: 1 }, polygon(0, 0))])));
    let stderr = '';
    await runImport(['inspect', `--source=${join(dir, 's.geojson')}`, `--draft=${join(dir, 'pkg', 'c.json')}`], {
      fs: realImportFs,
      root: dir,
      stdout: () => undefined,
      stderr: (s) => (stderr += s),
    });
    const lines = stderr.split('\n').filter((l) => l.startsWith('{'));
    return lines.map((l) => JSON.parse(l) as Err);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function allErrors(): Promise<Err[]> {
  return [...sourceErrors(), ...extractErrors(), ...curationErrors(), ...unitErrors(), ...groupErrors(), ...factionErrors(), ...viewErrors(), ...seaErrors(), ...(await commandErrors())];
}

const sources = import.meta.glob('../src/importer/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('the language of the importer', () => {
  it('the curation kind order in the source equals the literal list', () => {
    expect(CURATION_KIND_ORDER[0]).toBe('invalid-curation');
    expect(CURATION_KIND_ORDER).toHaveLength(20);
  });

  it('every importer error kind produced is in the literal list, and every listed kind is produced', async () => {
    const kinds = new Set((await allErrors()).map((e) => e.kind as string));
    for (const k of kinds) expect(IMPORTER_KINDS).toContain(k);
    // 'invalid-input' is the builder's own kind, reused by the extract mode with English reasons
    expect([...kinds].sort()).toStrictEqual([...IMPORTER_KINDS].sort());
  });

  it('every key of every produced error is a listed data field, and every listed field is produced', async () => {
    const produced = new Set<string>();
    for (const e of await allErrors()) for (const k of Object.keys(e)) produced.add(k);
    for (const k of produced) expect(ALLOWED_KEYS, k).toContain(k);
    expect([...produced].sort()).toStrictEqual([...ALLOWED_KEYS].sort());
  });

  it('every reason, cap name and error text is English ASCII, and the source reasons and cap names are the listed ones', async () => {
    const all = await allErrors();
    const reasons = new Set(all.filter((e) => e.kind === 'invalid-source').map((e) => e.reason as string));
    expect([...reasons].sort()).toStrictEqual([...INVALID_SOURCE_REASONS].sort());
    const caps = new Set(all.filter((e) => e.kind === 'source-too-large').map((e) => e.what as string));
    expect([...caps].sort()).toStrictEqual([...CAP_NAMES].sort());
    for (const e of all) {
      for (const field of ['reason', 'what', 'kind', 'type']) {
        if (typeof e[field] === 'string') expect(e[field] as string, `${field} of ${JSON.stringify(e)}`).toMatch(/^[\x20-\x7e]+$/);
      }
    }
    // the reasons of the builder's own kind used by the extract mode are plain English sentences
    const inputReasons = all.filter((e) => e.kind === 'invalid-input').map((e) => e.reason as string);
    expect(inputReasons.length).toBeGreaterThanOrEqual(3);
    for (const reason of inputReasons) expect(reason).toMatch(/^[a-z][a-z ]+$/);
  });

  it('the inspect summary uses the listed English labels and the listed value type names', () => {
    const r = readSource({ file: 's', bytes: bytesOf(collection([feat({ a: 'x' }, polygon(0, 0))])) }, { usedProperties: [] });
    if (!r.ok) throw new Error('the source should read');
    const { summary } = inspectSource(r.value, 's.geojson');
    const lines = summary.split('\n').filter((l) => l !== '');
    const top = lines.filter((l) => !l.startsWith(' ') && !l.startsWith('property:')).map((l) => l.slice(0, l.indexOf(':')));
    expect(top).toStrictEqual(SUMMARY_LABELS);
    const block = lines.slice(lines.findIndex((l) => l.startsWith('property:'))).map((l) => l.trim().slice(0, l.trim().indexOf(':')));
    expect(block).toStrictEqual(PROPERTY_LABELS);
    expect([...VALUE_TYPES]).toStrictEqual(VALUE_TYPE_NAMES);
  });

  it('the US spelling color is used and colour appears in no importer kind, field, label or source', async () => {
    expect([...IMPORTER_KINDS, ...DATA_FIELDS, ...SUMMARY_LABELS, ...PROPERTY_LABELS, ...CURATION_KIND_ORDER].some((s) => /colour/i.test(s))).toBe(false);
    expect(CURATION_KIND_ORDER).toContain('invalid-color');
    expect(JSON.stringify(await allErrors())).not.toMatch(/colour/i);
    for (const [file, src] of Object.entries(sources)) expect(/colour/i.test(src), file).toBe(false);
  });

  it('every importer source is ASCII-only', () => {
    const files = Object.keys(sources);
    expect(files.length).toBeGreaterThanOrEqual(9);
    const offenders = files.filter((f) => /[^\x00-\x7f]/.test(sources[f]!));
    expect(offenders).toStrictEqual([]);
  });

  it('the fake file system type used by the tests is the command one', () => {
    const fs: ImportFs = realImportFs;
    expect(typeof fs.size).toBe('function');
  });
});
