import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GROUPING_KIND_ORDER, SEED_KIND_ORDER } from '../src/core/errors';
import { runBuild } from '../src/cli/build';
import { buildInMemory } from '../src/core/build';
import { extract } from '../src/extract/extract';
import { checkGrouping } from '../src/core/grouping';
import { parseBuildInputs } from '../src/core/parse-inputs';
import { checkPngFile } from '../src/core/png-check';
import type { BuildInputs, PngCodec } from '../src/core/types';
import { realFs, type FsOps } from '../src/io/fs-ops';
import { pngCodec } from '../src/io/png-codec';
import { INPUT_FILES } from '../src/io/read-inputs';
import { writePackage } from '../src/io/write-package';
import { inputTexts, miniInputs, province } from './helpers/fixtures';

// NFR-18 (003a) applied to the builder: literal lists copied from the spec, not imported from src.
const INPUT_KINDS = ['invalid-input'];
const PNG_KINDS = ['invalid-png'];
const GROUPING_KINDS = [
  'duplicate-country',
  'unknown-country',
  'duplicate-territory-key',
  'invalid-territory-country',
  'territory-color',
  'empty-territory',
  'missing-territory-name',
  'unknown-province',
  'duplicate-province-assignment',
  'province-country-mismatch',
  'unassigned-province',
  'empty-country',
];
const SEED_KINDS = ['no-sea-seeds', 'seed-outside-frame', 'seed-not-water', 'duplicate-seed-pixel'];
const BUILD_KINDS = ['vanished-entry', 'png-round-trip-mismatch'];
const WRITE_KINDS = ['write-failed', 'partial-write'];
const COMMAND_KINDS = ['preview-write-failed', 'usage-error'];
const EXTRACT_KINDS = ['invalid-source-version'];
const BUILDER_KINDS = [
  ...EXTRACT_KINDS,
  ...INPUT_KINDS,
  ...PNG_KINDS,
  ...GROUPING_KINDS,
  ...SEED_KINDS,
  ...BUILD_KINDS,
  ...WRITE_KINDS,
  ...COMMAND_KINDS,
];
/** Data fields of the builder errors (the kind is always present). */
const DATA_FIELDS = [
  'reason',
  'country',
  'territory',
  'province',
  'seed',
  'name',
  'seeds',
  'x',
  'y',
  'artifact',
  'replaced',
  'notReplaced',
  'preview',
  'files',
];
const ALLOWED_KEYS = ['kind', ...DATA_FIELDS];
/** Labels of the report, in order, and the keys of its indented item lines (FR-124). */
const REPORT_LABELS = [
  'sourceVersion',
  'width',
  'height',
  'projectionCenter',
  'frame',
  'factions',
  'landTerritories',
  'seaZones',
  'smallestPiece',
  'reassignedPieces',
  'excludedProvinces',
  'multiPieceEntries',
];
const REPORT_ITEM_KEYS = ['entry', 'pixels', 'to', 'pieces'];

type Err = Record<string, unknown>;

function mini(change: (inputs: BuildInputs) => void): BuildInputs {
  const inputs = structuredClone(miniInputs());
  change(inputs);
  return inputs;
}

function failed(inputs: BuildInputs, codec: PngCodec = pngCodec): Err[] {
  const outcome = buildInMemory(inputs, codec);
  if (outcome.ok) throw new Error('the build should fail');
  return outcome.errors as unknown as Err[];
}

/** FR-113 inputs that make every grouping kind appear (as in the grouping tests). */
function groupingErrors(): Err[] {
  return checkGrouping(
    {
      countries: [
        { country: 'DEU' },
        { country: 'FRA' },
        { country: 'ESP' },
        { country: 'DEU' },
        { country: 'QQQ' },
      ],
      territories: [
        { key: 'bayern', country: 'DEU', provinces: ['DE-BY', 'FR-IDF'], name: 'Baviera', color: '#111111' },
        { key: 'bayern', country: 'DEU', provinces: ['DE-BW'], color: '#222222' },
        { key: 'x-no-country', provinces: ['FR-D'] },
        { key: 'x-bad-country', country: 'ITA', provinces: ['FR-C'] },
        { key: 'vacio', country: 'FRA', provinces: [] },
        { key: 'multi', country: 'FRA', provinces: ['FR-A', 'FR-B'] },
        { key: 'dos', country: 'FRA', provinces: ['FR-A', 'B-2', 'A-1', 'a-1', 'B-2'], name: 'Dos' },
      ],
      excluded: ['ES-MD', 'Z-9'],
    },
    [
      province('DE-BY', 'DEU'),
      province('DE-BW', 'DEU'),
      province('DE-TT', 'DEU'),
      province('FR-IDF', 'FRA'),
      province('FR-A', 'FRA'),
      province('FR-B', 'FRA'),
      province('FR-C', 'FRA'),
      province('FR-D', 'FRA'),
      province('FR-U', 'FRA'),
      province('ES-MD', 'ESP'),
    ],
    [
      { adm0_a3: 'DEU', name: 'Germany' },
      { adm0_a3: 'ESP', name: 'Spain' },
      { adm0_a3: 'FRA', name: 'France' },
    ],
  ) as unknown as Err[];
}

function inputErrors(): Err[] {
  const texts = { ...inputTexts(miniInputs()), provinces: '{', params: '[]' };
  const result = parseBuildInputs(texts);
  if (result.ok) throw new Error('the inputs should be rejected');
  return result.errors as unknown as Err[];
}

function seedErrors(): Err[] {
  return [
    ...failed(mini((i) => (i.seeds = []))),
    ...failed(mini((i) => i.seeds.push({ name: 'Fuera', lon: 100, lat: 1 }))),
    ...failed(mini((i) => i.seeds.push({ name: 'En tierra', lon: 1.5, lat: 1.5 }))),
    ...failed(mini((i) => i.seeds.push({ name: 'Repetido', lon: 1, lat: 7.5 }))),
  ];
}

function buildErrors(): Err[] {
  const altering: PngCodec = {
    encode: pngCodec.encode,
    decode(bytes) {
      const decoded = pngCodec.decode(bytes);
      if (!decoded.ok) return decoded;
      const rgb = decoded.value.rgb.slice();
      rgb[0] = (rgb[0]! + 1) % 256;
      return { ok: true, value: { ...decoded.value, rgb } };
    },
  };
  return [
    ...failed(
      mini((i) => {
        i.seeds.push({ name: 'Lago', lon: 4.5, lat: 4.5 });
        i.params.minPieceSize = 40;
      }),
    ),
    ...failed(miniInputs(), altering),
  ];
}

function pngErrors(): Err[] {
  const result = checkPngFile(Uint8Array.from([1, 2, 3]));
  if (result.ok) throw new Error('the file should be rejected');
  return result.errors as unknown as Err[];
}

/** An in-memory file system whose n-th write or rename (1-based) throws. */
function failingFs(fault: { write?: number; rename?: number }): FsOps {
  let writes = 0;
  let renames = 0;
  return {
    readFile: () => new Uint8Array(0),
    mkdir: () => undefined,
    unlink: () => undefined,
    writeFile: () => {
      writes++;
      if (writes === fault.write) throw new Error('disk full');
    },
    rename: () => {
      renames++;
      if (renames === fault.rename) throw new Error('locked');
    },
  };
}

function writeErrors(): Err[] {
  const files = { map: new Uint8Array(1), presentation: new Uint8Array(1), image: new Uint8Array(1) };
  const out: Err[] = [];
  for (const fault of [{ write: 2 }, { rename: 2 }]) {
    const result = writePackage('out', files, failingFs(fault));
    if (result.ok) throw new Error('the write should fail');
    out.push(...(result.errors as unknown as Err[]));
  }
  return out;
}

/** The command's own errors, from real runs on a temporary root: a preview inside the package, a preview that cannot be written. */
function commandErrors(): Err[] {
  const root = mkdtempSync(join(tmpdir(), 'mbrg-lang-'));
  try {
    const texts = inputTexts(miniInputs());
    for (const name of Object.keys(INPUT_FILES) as (keyof typeof INPUT_FILES)[]) {
      const file = join(root, 'tools', 'build-map', 'data', INPUT_FILES[name]);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, texts[name]);
    }
    const out: Err[] = [];
    const collect = (args: string[], fs: FsOps = realFs): void => {
      let stderr = '';
      runBuild(args, { fs, codec: pngCodec, root, stdout: () => undefined, stderr: (s) => (stderr += s) });
      for (const line of stderr.split(String.fromCharCode(10))) if (line.startsWith('{')) out.push(JSON.parse(line) as Err);
    };
    collect(['--preview=maps/dev/preview.png']);
    collect(['--preview'], {
      ...realFs,
      writeFile: () => {
        throw new Error('disk full');
      },
    });
    return out;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** FR-131: the extraction's own error, from a dataset with a missing version text. */
function extractErrors(): Err[] {
  const result = extract({ admin1: [], admin0: [], versionTexts: {} }, [], { west: 0, south: 0, east: 1, north: 1 });
  if (result.ok) throw new Error('the extraction should fail');
  return result.errors as unknown as Err[];
}

function allErrors(): Err[] {
  return [
    ...extractErrors(),
    ...inputErrors(),
    ...pngErrors(),
    ...groupingErrors(),
    ...seedErrors(),
    ...buildErrors(),
    ...writeErrors(),
    ...commandErrors(),
  ];
}

const sources = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('NFR-18 language of the builder', () => {
  it('NFR-18 the kind lists in the source equal the literal spec lists, in table order', () => {
    expect([...GROUPING_KIND_ORDER]).toStrictEqual(GROUPING_KINDS);
    expect([...SEED_KIND_ORDER]).toStrictEqual(SEED_KINDS);
  });

  it('NFR-18 every builder error kind produced is in the literal list, and all are produced', () => {
    const kinds = new Set(allErrors().map((e) => e.kind as string));
    for (const k of kinds) expect(BUILDER_KINDS).toContain(k);
    expect([...kinds].sort()).toStrictEqual([...BUILDER_KINDS].sort());
  });

  it('NFR-18 each group of kinds is produced by its own bad input, and only by it', () => {
    const kinds = (errors: Err[]): string[] => [...new Set(errors.map((e) => e.kind as string))].sort();
    expect(kinds(extractErrors())).toStrictEqual(EXTRACT_KINDS);
    expect(kinds(inputErrors())).toStrictEqual(INPUT_KINDS);
    expect(kinds(pngErrors())).toStrictEqual(PNG_KINDS);
    expect(kinds(groupingErrors())).toStrictEqual([...GROUPING_KINDS].sort());
    expect(kinds(seedErrors())).toStrictEqual([...SEED_KINDS].sort());
    expect(kinds(buildErrors())).toStrictEqual([...BUILD_KINDS].sort());
    expect(kinds(writeErrors())).toStrictEqual([...WRITE_KINDS].sort());
    expect(kinds(commandErrors())).toStrictEqual([...COMMAND_KINDS].sort());
  });

  it('NFR-18 every key of every produced error is a listed data field, and every listed field is produced', () => {
    const produced = new Set<string>();
    for (const e of allErrors()) for (const k of Object.keys(e)) produced.add(k);
    for (const k of produced) expect(ALLOWED_KEYS, k).toContain(k);
    expect([...produced].sort()).toStrictEqual([...ALLOWED_KEYS].sort());
  });

  it('NFR-18 an invalid input names its field reason and the reason is English ASCII text', () => {
    const errors = inputErrors();
    expect(errors.length).toBeGreaterThanOrEqual(2);
    for (const e of errors) {
      expect(Object.keys(e).sort()).toStrictEqual(['kind', 'reason']);
      expect(typeof e.reason).toBe('string');
      expect(e.reason as string).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it('NFR-18 the report labels are the listed English labels, in order, with the listed item keys', () => {
    const outcome = buildInMemory(miniInputs(), pngCodec);
    if (!outcome.ok) throw new Error('the mini build should succeed');
    const lines = outcome.report.split('\n').filter((l) => l !== '');
    const labels = lines.filter((l) => !l.startsWith(' ')).map((l) => l.slice(0, l.indexOf(':')));
    expect(labels).toStrictEqual(REPORT_LABELS);
    const itemKeys = new Set<string>();
    for (const l of lines.filter((x) => x.startsWith('  - '))) {
      for (const m of l.matchAll(/(\w+)=/g)) itemKeys.add(m[1]!);
    }
    for (const k of itemKeys) expect(REPORT_ITEM_KEYS, k).toContain(k);
    expect(itemKeys.size).toBeGreaterThan(0);
  });

  it('NFR-18 the US spelling color is used and colour appears in no builder kind, field, report or error', () => {
    expect([...BUILDER_KINDS, ...DATA_FIELDS, ...REPORT_LABELS].some((s) => /colour/i.test(s))).toBe(false);
    expect(GROUPING_KINDS).toContain('territory-color');
    const outcome = buildInMemory(miniInputs(), pngCodec);
    if (!outcome.ok) throw new Error('the mini build should succeed');
    expect(outcome.report).not.toMatch(/colour/i);
    expect(JSON.stringify(allErrors())).not.toMatch(/colour/i);
  });

  it('NFR-18 every source of the builder workspace is ASCII-only', () => {
    const files = Object.keys(sources);
    expect(files.length).toBeGreaterThanOrEqual(20);
    const offenders = files.filter((f) => /[^\x00-\x7f]/.test(sources[f]!));
    expect(offenders).toStrictEqual([]);
    // the check is not vacuous: a planted non-ASCII letter is detected
    expect(/[^\x00-\x7f]/.test('Espa\u00f1a')).toBe(true);
  });
});
