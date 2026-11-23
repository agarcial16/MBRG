import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkIdImage, checkPresentation, validateMap } from '@mbrg/shared';
import { rasterize } from '../src/core/rasterize';
import type { PngCodec } from '../src/core/types';
import { IMPORT_MODES, MODE_HANDLERS, realImportFs, runImport, runImportMode, type ImportFs } from '../src/cli/import';
import { parseCuration } from '../src/importer/curation';
import { buildPackage } from '../src/importer/import';
import { fromRgb } from '../src/core/png-check';
import { pngCodec } from '../src/io/png-codec';
import { bytesOf, collection, feat, textBytes } from './helpers/geo-fixture';

// The rasterizer is wrapped so a test can prove that no pixel work ran (NFR-135).
vi.mock('../src/core/rasterize', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/core/rasterize')>();
  return { ...original, rasterize: vi.fn(original.rasterize) };
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mbrg-import-'));
  vi.mocked(rasterize).mockClear();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const out = (name = 'pkg'): string => join(dir, name);
const ARTIFACTS = ['ids.png', 'map.json', 'presentation.json'];

function put(name: string, content: Uint8Array | string): string {
  const file = join(dir, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

/** A rectangle polygon of the world, in degrees. */
const rect = (x0: number, y0: number, x1: number, y1: number): unknown => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });

/** Three land units of two countries in a row, a marine region on top, a strip of context land and a seed below. */
function world() {
  const features: unknown[] = [
    feat({ code: 'A', name: 'Alfa', adm: 'X' }, rect(0, 0, 2, 2)),
    feat({ code: 'B', name: 'Beta', adm: 'X' }, rect(2, 0, 4, 2)),
    feat({ code: 'C', name: 'Gamma', adm: 'Y' }, rect(4, 0, 6, 2)),
    feat({ code: 'D', name: 'North Gulf' }, rect(0, 2, 6, 3.5)),
  ];
  const context = collection([feat({ name: 'Strip' }, rect(0, -1.5, 6, -1.2))]);
  const curation: Record<string, any> = {
    primary: 'primary.geojson',
    context: ['context.geojson'],
    columns: { key: 'code', name: ['name'] },
    params: { side: 96, margin: 0.02, minPieceSize: 4, projection: 'laea' },
    factionBy: { property: 'adm' },
    factions: [{ key: 'X', name: 'Xland' }, { key: 'Y', name: 'Yland' }],
    units: { D: { kind: 'sea' } },
    seas: [{ name: 'South Sea', lon: 3, lat: -0.7 }],
  };
  return { features, context, curation };
}

function write(w = world(), name = 'in'): string {
  put(`${name}/primary.geojson`, bytesOf(collection(w.features)));
  put(`${name}/context.geojson`, bytesOf(w.context));
  return put(`${name}/curation.json`, JSON.stringify(w.curation));
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}
function run(args: string[], fs: ImportFs = realImportFs, codec?: PngCodec): Run {
  let stdout = '';
  let stderr = '';
  const status = runImportMode(args, { fs, root: dir, stdout: (s) => (stdout += s), stderr: (s) => (stderr += s), ...(codec === undefined ? {} : { codec }) });
  return { status, stdout, stderr };
}
const errorsOf = (r: Run): Record<string, unknown>[] =>
  r.stderr
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
const kinds = (r: Run): string[] => [...new Set(errorsOf(r).map((e) => e.kind as string))];

describe('FR-586 one command with three modes', () => {
  it('FR-586 registers extract, inspect and import behind the one command, and the import mode needs its two options', async () => {
    expect([...IMPORT_MODES]).toStrictEqual(['extract', 'inspect', 'import']);
    expect(Object.keys(MODE_HANDLERS).sort()).toStrictEqual(['extract', 'import', 'inspect']);
    for (const args of [[], ['--curation=c.json'], ['--out=pkg'], ['--curation=c.json', '--out=pkg', '--bogus'], ['--curation=', '--out=pkg'], ['--curation=a', '--curation=b', '--out=p']]) {
      let stderr = '';
      const status = await runImport(['import', ...args], { fs: realImportFs, root: dir, stdout: () => undefined, stderr: (s) => (stderr += s) });
      expect(status, args.join(' ')).toBe(2);
      expect(stderr).toContain('usage: import-map import --curation=<file.json> --out=<folder>');
    }
  });
});

describe('FR-608 the stages of an import', () => {
  it('FR-608 writes the three artifacts of a sound import and exits 0', () => {
    const curation = write();
    const r = run([`--curation=${curation}`, `--out=${out()}`]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    // the report (FR-609) replaced the one-line summary of T2.10
    expect(r.stdout).toContain('landTerritories: 3');
    expect(r.stdout).toContain('factions: 2');
    expect(r.stdout).toContain('seaZones: 2');
    expect(readdirSync(out()).sort()).toStrictEqual(ARTIFACTS);
  });

  it('FR-608 refuses an output folder that exists and is not empty before any input is read, and accepts an empty one', () => {
    const curation = write();
    mkdirSync(out(), { recursive: true });
    writeFileSync(join(out(), 'map.json'), 'precious');
    let reads = 0;
    const counting: ImportFs = { ...realImportFs, size: (p) => { reads++; return realImportFs.size(p); }, readFile: (p) => { reads++; return realImportFs.readFile(p); } };
    const r = run([`--curation=${curation}`, `--out=${out()}`], counting);
    expect(r.status).toBe(1);
    expect(errorsOf(r)).toStrictEqual([{ kind: 'output-not-empty', out: out() }]);
    expect(reads).toBe(0);
    expect(readFileSync(join(out(), 'map.json'), 'utf8')).toBe('precious');
    // a file where the folder should be is no folder
    put('afile', 'x');
    expect(kinds(run([`--curation=${curation}`, `--out=${join(dir, 'afile')}`]))).toStrictEqual(['output-not-empty']);
    // an empty folder is fine
    mkdirSync(out('empty'));
    expect(run([`--curation=${curation}`, `--out=${out('empty')}`]).status).toBe(0);
  });

  it('FR-608 runs the stages in order, stops after the first with errors, and prints that stage alone', () => {
    // 1. the curation file: a schema error hides a missing source
    const bad = world();
    bad.curation.params.side = 10;
    bad.curation.primary = 'missing.geojson';
    put('in1/curation.json', JSON.stringify(bad.curation));
    expect(kinds(run([`--curation=${join(dir, 'in1', 'curation.json')}`, `--out=${out('o1')}`]))).toStrictEqual(['invalid-curation']);
    // 2. the sources: a Point hides a curation error (a land unit with no faction)
    const sources = world();
    sources.features.push(feat({ code: 'P', name: 'Point', adm: 'X' }, { type: 'Point', coordinates: [0, 0] }));
    delete (sources.features[0] as { properties: Record<string, unknown> }).properties.adm;
    expect(kinds(run([`--curation=${write(sources, 'in2')}`, `--out=${out('o2')}`]))).toStrictEqual(['unsupported-geometry']);
    // 3. the curation: a land unit with no faction hides a unit beyond the horizon
    const stage = world();
    stage.features.push(feat({ code: 'W', name: 'West', adm: 'X' }, rect(-101, 0, -100, 2)), feat({ code: 'E', name: 'East', adm: 'X' }, rect(100, 0, 101, 2)));
    delete (stage.features[0] as { properties: Record<string, unknown> }).properties.adm;
    const third = run([`--curation=${write(stage, 'in3')}`, `--out=${out('o3')}`]);
    expect(kinds(third)).toStrictEqual(['missing-faction']);
    expect(errorsOf(third)).toStrictEqual([{ kind: 'missing-faction', unit: 'A' }]);
    // 4. the projection: a unit beyond the horizon hides a territory below the minimum piece
    const projection = world();
    projection.features.push(feat({ code: 'W', name: 'West', adm: 'X' }, rect(-101, 0, -100, 2)), feat({ code: 'E', name: 'East', adm: 'X' }, rect(100, 0, 101, 2)));
    projection.curation.params.minPieceSize = 5000;
    expect(kinds(run([`--curation=${write(projection, 'in4')}`, `--out=${out('o4')}`]))).toStrictEqual(['selection-too-wide']);
    // 5. the pixel steps: territories below the minimum piece, every one of them at once
    const pixels = world();
    pixels.curation.params.minPieceSize = 5000;
    const fifth = run([`--curation=${write(pixels, 'in5')}`, `--out=${out('o5')}`]);
    expect(kinds(fifth)).toStrictEqual(['territory-below-min-size']);
    expect(errorsOf(fifth).length).toBeGreaterThanOrEqual(3);
    // nothing was created in any output folder
    for (const name of ['o1', 'o2', 'o3', 'o4', 'o5']) expect(existsSync(out(name)), name).toBe(false);
  });

  it('FR-606 reports the errors of the self-check as the package gate gives them: too few factions, a duplicate color, an invalid name', () => {
    const one = world();
    one.curation.factions = [{ key: 'X', name: 'Xland' }];
    for (const f of one.features as { properties: Record<string, unknown> }[]) if (f.properties.adm === 'Y') f.properties.adm = 'X';
    const first = run([`--curation=${write(one, 'in1')}`, `--out=${out('o1')}`]);
    expect(first.status).toBe(1);
    expect(kinds(first)).toStrictEqual(['too-few-factions']);

    const same = world();
    same.curation.factions = [{ key: 'X', name: 'Xland', color: '#ff0000' }, { key: 'Y', name: 'Yland', color: '#ff0000' }];
    expect(kinds(run([`--curation=${write(same, 'in2')}`, `--out=${out('o2')}`]))).toStrictEqual(['duplicate-color']);

    const padded = world();
    (padded.features[0] as { properties: Record<string, unknown> }).properties.name = ' Alfa';
    const third = run([`--curation=${write(padded, 'in3')}`, `--out=${out('o3')}`]);
    expect(kinds(third)).toStrictEqual(['invalid-name']);
    // the stage is the last one: the pixel steps passed
    for (const name of ['o1', 'o2', 'o3']) expect(existsSync(out(name)), name).toBe(false);
  });

  it('FR-608 prints one JSON object per error per line on stderr, each with an English kind', () => {
    const w = world();
    w.features.push(feat({ code: 'E1', name: 'e1' }, rect(0, -1.1, 0.3, -0.8)), feat({ code: 'E2', name: 'e2' }, rect(1, -1.1, 1.3, -0.8)));
    const r = run([`--curation=${write(w)}`, `--out=${out()}`]);
    expect(r.status).toBe(1);
    const lines = r.stderr.split('\n').filter((l) => l !== '');
    expect(lines.length).toBe(2);
    for (const line of lines) expect(JSON.parse(line)).toMatchObject({ kind: 'missing-faction' });
    expect(r.stdout).toBe('');
  });

  it('FR-608 reads the sources named by the curation relative to the curation file, size checks first, all problems at once', () => {
    const curation = write(world(), 'deep/er');
    const missing = world();
    missing.curation.context = ['context.geojson', 'gone.geojson'];
    missing.curation.primary = 'gone-too.geojson';
    put('deep/er2/curation.json', JSON.stringify(missing.curation));
    put('deep/er2/context.geojson', bytesOf(missing.context));
    const r = run([`--curation=${join(dir, 'deep', 'er2', 'curation.json')}`, `--out=${out('x')}`]);
    expect(errorsOf(r)).toStrictEqual([
      { kind: 'invalid-source', file: 'gone-too.geojson', reason: 'unreadable' },
      { kind: 'invalid-source', file: 'gone.geojson', reason: 'unreadable' },
    ]);
    expect(run([`--curation=${curation}`, `--out=${out('y')}`]).status).toBe(0);
  });

  it('FR-588 caps the values of the properties the curation uses on the primary source only, never on a context source', () => {
    const long = 'x'.repeat(2000);
    const ctx = world();
    ctx.context = collection([feat({ name: long }, rect(0, -1.5, 6, -1.2))]);
    expect(run([`--curation=${write(ctx, 'in1')}`, `--out=${out('o1')}`]).status).toBe(0);
    const main = world();
    (main.features[0] as { properties: Record<string, unknown> }).properties.name = long;
    const r = run([`--curation=${write(main, 'in2')}`, `--out=${out('o2')}`]);
    expect(errorsOf(r)).toStrictEqual([{ kind: 'source-too-large', file: 'primary.geojson', what: 'value', cap: 1024, found: 2000, feature: 0, property: 'name' }]);
  });
});

describe('FR-608 a failed import touches no file', () => {
  /** The real file system with the n-th write or rename failing, a failing write leaving a partial file. */
  function faulty(fault: { write?: number; rename?: number }): ImportFs {
    let writes = 0;
    let renames = 0;
    return {
      ...realImportFs,
      writeFile: (p, bytes) => {
        writes++;
        if (writes === fault.write) {
          realImportFs.writeFile(p, bytes.slice(0, 3));
          throw new Error('disk full');
        }
        realImportFs.writeFile(p, bytes);
      },
      rename: (from, to) => {
        renames++;
        if (renames === fault.rename) throw new Error('locked');
        realImportFs.rename(from, to);
      },
    };
  }

  it('FR-608 leaves no file behind when a write fails, whichever of the three it is', () => {
    const curation = write();
    for (const n of [1, 2, 3]) {
      const target = out(`w${n}`);
      const r = run([`--curation=${curation}`, `--out=${target}`], faulty({ write: n }));
      expect(r.status, `write ${n}`).toBe(1);
      expect(errorsOf(r), `write ${n}`).toStrictEqual([{ kind: 'write-failed', artifact: ['map', 'presentation', 'image'][n - 1] }]);
      expect(existsSync(target) ? readdirSync(target) : [], `write ${n}`).toStrictEqual([]);
    }
  });

  it('FR-608 reports partial-write when a later rename fails and a failed first rename leaves nothing', () => {
    const curation = write();
    const second = run([`--curation=${curation}`, `--out=${out('r2')}`], faulty({ rename: 2 }));
    expect(errorsOf(second)).toStrictEqual([{ kind: 'partial-write', replaced: ['map'], notReplaced: ['presentation', 'image'] }]);
    expect(readdirSync(out('r2'))).toStrictEqual(['map.json']);
    const first = run([`--curation=${curation}`, `--out=${out('r1')}`], faulty({ rename: 1 }));
    expect(errorsOf(first)).toStrictEqual([{ kind: 'write-failed', artifact: 'map' }]);
    expect(readdirSync(out('r1'))).toStrictEqual([]);
    expect(first.status).toBe(1);
  });

  it('FR-608 never lists, reads or writes the output folder after a failure of an earlier stage', () => {
    const w = world();
    delete (w.features[0] as { properties: Record<string, unknown> }).properties.adm;
    const curation = write(w);
    const touched: string[] = [];
    const spy: ImportFs = {
      ...realImportFs,
      writeFile: (p, b) => { touched.push(`write ${p}`); realImportFs.writeFile(p, b); },
      rename: (a, b) => { touched.push(`rename ${a}`); realImportFs.rename(a, b); },
      unlink: (p) => { touched.push(`unlink ${p}`); realImportFs.unlink(p); },
      mkdir: (p) => { touched.push(`mkdir ${p}`); realImportFs.mkdir(p); },
    };
    expect(run([`--curation=${curation}`, `--out=${out()}`], spy).status).toBe(1);
    expect(touched).toStrictEqual([]);
  });
});

describe('FR-606 the package an import writes', () => {
  it('FR-606 writes a map, a presentation and an id image that pass the checks of 001 to 003, and the same bytes the core gives', () => {
    const curation = write();
    expect(run([`--curation=${curation}`, `--out=${out()}`]).status).toBe(0);
    const map = JSON.parse(readFileSync(join(out(), 'map.json'), 'utf8'));
    const presentation = JSON.parse(readFileSync(join(out(), 'presentation.json'), 'utf8'));
    expect(validateMap(map).ok).toBe(true);
    expect(checkPresentation(map, presentation).ok).toBe(true);
    const decoded = pngCodec.decode(new Uint8Array(readFileSync(join(out(), 'ids.png'))));
    if (!decoded.ok) throw new Error('ids.png does not decode');
    expect(decoded.value.width).toBe(96);
    expect(checkIdImage(map, 96, 96, fromRgb(decoded.value.rgb)).ok).toBe(true);
    // ids: factions X=1 Y=2; land A=1 B=2 C=3; sea North Gulf=4 then the seed South Sea=5
    expect(map.territories.map((t: { id: number; kind?: string; owner?: number }) => [t.id, t.kind ?? 'land', t.owner ?? null])).toStrictEqual([
      [1, 'land', 1],
      [2, 'land', 1],
      [3, 'land', 2],
      [4, 'sea', null],
      [5, 'sea', null],
    ]);
    expect(presentation.factions).toStrictEqual([{ id: 1, name: 'Xland' }, { id: 2, name: 'Yland' }]);
    expect(presentation.territories.map((t: { name: string }) => t.name)).toStrictEqual(['Alfa', 'Beta', 'Gamma', 'North Gulf', 'South Sea']);
    // A and B touch, B and C touch: links come from pixel contact only
    expect(map.territories[0].neighbors).toContain(2);
    expect(map.territories[1].neighbors).toContain(3);
    const parsed = parseCuration(textBytes(readFileSync(curation, 'utf8')), 'curation.json');
    if (!parsed.ok) throw new Error('curation');
    const core = buildPackage({
      curation: parsed.value,
      primary: { file: 'primary.geojson', bytes: new Uint8Array(readFileSync(join(dir, 'in', 'primary.geojson'))) },
      context: [{ file: 'context.geojson', bytes: new Uint8Array(readFileSync(join(dir, 'in', 'context.geojson'))) }],
      codec: pngCodec,
    });
    if (!core.ok) throw new Error(JSON.stringify(core.errors));
    expect(Buffer.from(core.files.map).equals(readFileSync(join(out(), 'map.json')))).toBe(true);
    expect(Buffer.from(core.files.presentation).equals(readFileSync(join(out(), 'presentation.json')))).toBe(true);
    expect(Buffer.from(core.files.image).equals(readFileSync(join(out(), 'ids.png')))).toBe(true);
  });

  it('FR-606 gives the same three files for the same inputs, run after run', () => {
    const curation = write();
    expect(run([`--curation=${curation}`, `--out=${out('a')}`]).status).toBe(0);
    expect(run([`--curation=${curation}`, `--out=${out('b')}`]).status).toBe(0);
    for (const name of ARTIFACTS) expect(readFileSync(join(out('a'), name)).equals(readFileSync(join(out('b'), name))), name).toBe(true);
  });

  it('FR-586 never touches the network: fetch throws and no importer or command source names a network API', () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network access');
    });
    vi.stubGlobal('fetch', fetchSpy);
    expect(run([`--curation=${write()}`, `--out=${out()}`]).status).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    const sources = {
      ...import.meta.glob('../src/importer/*.ts', { query: '?raw', import: 'default', eager: true }),
      ...import.meta.glob('../src/cli/import.ts', { query: '?raw', import: 'default', eager: true }),
    } as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThan(15);
    const network = /\b(?:node:)?(?:http|https|http2|net|tls|dgram|dns)\b['"]|\bfetch\b|XMLHttpRequest|WebSocket/;
    for (const [file, src] of Object.entries(sources)) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(network.test(code), file).toBe(false);
    }
  });
});

describe('NFR-135 every size cap is checked before the work it bounds', () => {
  const spyCodec = (): { codec: PngCodec; encoded: () => number } => {
    let encoded = 0;
    return { codec: { ...pngCodec, encode: (w, h, rgb) => (encoded++, pngCodec.encode(w, h, rgb)) }, encoded: () => encoded };
  };

  it('NFR-135 encodes the image once, and only with the codec it is given, when every check passed', () => {
    const { codec, encoded } = spyCodec();
    expect(run([`--curation=${write()}`, `--out=${out()}`], realImportFs, codec).status).toBe(0);
    expect(encoded()).toBe(1);
    expect(vi.mocked(rasterize)).toHaveBeenCalled();
  });

  it('NFR-135 fails a 300 MiB source with source-too-large before it is read or parsed', () => {
    const curation = write();
    const reads: string[] = [];
    const big: ImportFs = {
      ...realImportFs,
      size: (p) => (p.endsWith('primary.geojson') ? 300 * 1024 * 1024 : realImportFs.size(p)),
      readFile: (p) => {
        reads.push(p);
        return realImportFs.readFile(p);
      },
    };
    const { codec, encoded } = spyCodec();
    const r = run([`--curation=${curation}`, `--out=${out()}`], big, codec);
    expect(errorsOf(r)).toStrictEqual([{ kind: 'source-too-large', file: 'primary.geojson', what: 'bytes', cap: 256 * 1024 * 1024, found: 300 * 1024 * 1024 }]);
    expect(reads.some((p) => p.endsWith('primary.geojson'))).toBe(false);
    expect(vi.mocked(rasterize)).not.toHaveBeenCalled();
    expect(encoded()).toBe(0);
  });

  it('NFR-135 fails a curation over 16 MiB before it is read or parsed', () => {
    const curation = write();
    const reads: string[] = [];
    const big: ImportFs = {
      ...realImportFs,
      size: (p) => (p.endsWith('curation.json') ? 16 * 1024 * 1024 + 1 : realImportFs.size(p)),
      readFile: (p) => {
        reads.push(p);
        return realImportFs.readFile(p);
      },
    };
    const r = run([`--curation=${curation}`, `--out=${out()}`], big);
    expect(errorsOf(r)).toStrictEqual([{ kind: 'source-too-large', file: 'curation.json', what: 'bytes', cap: 16 * 1024 * 1024, found: 16 * 1024 * 1024 + 1 }]);
    expect(reads).toStrictEqual([]);
    expect(vi.mocked(rasterize)).not.toHaveBeenCalled();
  });

  it('NFR-135 fails a side of 16,385 with invalid-curation before any pixel buffer, and accepts 16,384 as far as the schema goes', () => {
    const w = world();
    w.curation.params.side = 16385;
    const { codec, encoded } = spyCodec();
    const r = run([`--curation=${write(w)}`, `--out=${out()}`], realImportFs, codec);
    expect(errorsOf(r)).toStrictEqual([{ kind: 'invalid-curation', path: 'params.side' }]);
    expect(vi.mocked(rasterize)).not.toHaveBeenCalled();
    expect(encoded()).toBe(0);
    w.curation.params.side = 100000;
    expect(errorsOf(run([`--curation=${write(w, 'in2')}`, `--out=${out('o2')}`]))).toStrictEqual([{ kind: 'invalid-curation', path: 'params.side' }]);
    const ok = parseCuration(textBytes(JSON.stringify({ ...world().curation, params: { side: 16384, margin: 0.02, minPieceSize: 4, projection: 'laea' } })), 'c.json');
    expect(ok.ok).toBe(true);
  });

  it('NFR-135 fails a curation of 10,000 factions with too-many-factions before any pixel buffer', () => {
    const features = Array.from({ length: 10000 }, (_, i) => feat({ code: `u${i}`, name: `U${i}`, adm: `f${i}` }, rect((i % 100) * 0.1, Math.floor(i / 100) * 0.1, (i % 100) * 0.1 + 0.09, Math.floor(i / 100) * 0.1 + 0.09)));
    const w = world();
    w.features = features;
    w.curation = {
      primary: 'primary.geojson',
      columns: { key: 'code', name: ['name'] },
      params: { side: 128, margin: 0.02, minPieceSize: 1, projection: 'laea' },
      factionBy: { property: 'adm', nameProperty: 'adm' },
    };
    const { codec, encoded } = spyCodec();
    const r = run([`--curation=${write(w)}`, `--out=${out()}`], realImportFs, codec);
    expect(errorsOf(r)).toStrictEqual([{ kind: 'too-many-factions', cap: 9999, count: 10000 }]);
    expect(vi.mocked(rasterize)).not.toHaveBeenCalled();
    expect(encoded()).toBe(0);
    expect(existsSync(out())).toBe(false);
  }, 60000);
});

describe('FR-608 the pixel steps of an import, end to end', () => {
  const core = (w: ReturnType<typeof world>) => {
    const parsed = parseCuration(textBytes(JSON.stringify(w.curation)), 'curation.json');
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    return buildPackage({
      curation: parsed.value,
      primary: { file: 'primary.geojson', bytes: bytesOf(collection(w.features)) },
      context: [{ file: 'context.geojson', bytes: bytesOf(w.context) }],
      codec: pngCodec,
    });
  };

  it('FR-603 fills the small lake of a unit when a gap fill is given, and joins it to the sea otherwise', () => {
    const lake = world();
    const first = lake.features[0] as { geometry: { coordinates: number[][][] } };
    first.geometry.coordinates.push([[0.9, 0.9], [1.1, 0.9], [1.1, 1.1], [0.9, 1.1], [0.9, 0.9]]);
    const without = core(lake);
    if (!without.ok) throw new Error(JSON.stringify(without.errors));
    expect(without.details.filled).toStrictEqual([]);
    expect(without.details.enclosed.length).toBe(1);
    lake.curation.params.gapFill = 50;
    const withFill = core(lake);
    if (!withFill.ok) throw new Error(JSON.stringify(withFill.errors));
    expect(withFill.details.filled.length).toBe(1);
    expect(withFill.details.filled[0]!.territory).toBe(1);
    expect(withFill.details.enclosed).toStrictEqual([]);
    const count = (pixels: Uint32Array, id: number) => pixels.filter((v) => v === id).length;
    expect(count(withFill.pixels, 1) - count(without.pixels, 1)).toBe(withFill.details.filled[0]!.pixels);
  });

  it('FR-602 turns the strip between a unit and a context feature that does not fit it into other land, so no zone touches both', () => {
    const seaTouchesBoth = (r: ReturnType<typeof core>): number => {
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      const land = new Set(r.map.territories.filter((t) => t.kind !== 'sea').map((t) => t.id));
      const sea = new Set(r.map.territories.filter((t) => t.kind === 'sea').map((t) => t.id));
      const w = r.width;
      let n = 0;
      for (let y = 2; y < w - 2; y++) {
        for (let x = 2; x < w - 2; x++) {
          if (!sea.has(r.pixels[y * w + x]!)) continue;
          let touchesLand = false;
          let touchesOther = false;
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const v = r.pixels[(y + dy) * w + x + dx]!;
            if (land.has(v)) touchesLand = true;
            else if (v === 0) touchesOther = true;
          }
          if (touchesLand && touchesOther) n++;
        }
      }
      return n;
    };
    const near = world();
    // a context country whose north edge sits a little south of the three units (0 to 6 degrees east, 0 north): a sliver of water between
    near.context = collection([feat({ name: 'South' }, rect(-1, -1.5, 7, -0.1))]);
    near.curation.seas = [];
    near.curation.params.contextGap = 0;
    const open = core(near);
    expect(seaTouchesBoth(open), 'without the rule the sliver is sea').toBeGreaterThan(0);
    delete near.curation.params.contextGap;
    const closed = core(near);
    expect(seaTouchesBoth(closed)).toBe(0);
    if (!closed.ok) throw new Error('unreachable');
    expect(closed.details.contextGapPixels).toBeGreaterThan(0);
  });

  it('FR-602 links an exclave inside other land to its nearest territories with bridges, or fails when none is within reach', () => {
    const ex = world();
    // E belongs to Yland and lies inside a context country, a little east of Gamma (4 to 6 degrees), across a strip of water
    ex.features.push(feat({ code: 'E', name: 'Enclave', adm: 'Y' }, rect(7, 0.5, 7.5, 1)));
    ex.context = collection([feat({ name: 'Strip' }, rect(0, -1.5, 6, -1.2)), feat({ name: 'East' }, rect(6.4, -0.5, 9, 2.5))]);
    const ok = core(ex);
    if (!ok.ok) throw new Error(JSON.stringify(ok.errors));
    const entry = (id: number) => ok.map.territories.find((e) => e.id === id)!;
    expect(ok.details.bridges.length).toBeGreaterThan(0);
    expect(ok.details.bridges.every((b) => b.from === 4)).toBe(true);
    expect(ok.details.bridges.map((b) => b.to)).toContain(3);
    expect(entry(4).neighbors).toContain(3);
    // the bridge never touches a sea zone: the exclave is linked to land only
    const seaIds = new Set(ok.map.territories.filter((e) => e.kind === 'sea').map((e) => e.id));
    expect(entry(4).neighbors.some((n) => seaIds.has(n))).toBe(false);
    ex.curation.params.exclaveReach = 3;
    const far = core(ex);
    expect(far.ok ? [] : far.errors).toStrictEqual([{ kind: 'unreachable-exclave', territories: [4], reach: 3 }]);
    ex.curation.params.exclaveReach = 0;
    const off = core(ex);
    expect(off.ok ? [] : off.errors.map((e) => e.kind)).toStrictEqual(['disconnected-map']);
  });

  it('FR-601 draws a unit of an inset from its own projection at the rectangle, and the rest in the main view', () => {
    const w = world();
    // a small island of country Y far to the north-east: drawn by itself in a rectangle below the land, not at its place
    w.features.push(feat({ code: 'I', name: 'Isle', adm: 'Y' }, rect(5, 3.6, 5.6, 4.2)));
    w.curation.insets = [{ select: [{ property: 'code', eq: 'I' }], at: [4, 76] }];
    const r = core(w);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const where = r.details.views.insets[0]!.rect;
    expect(where.x).toBe(4);
    expect(where.y).toBe(76);
    let inside = 0;
    let outside = 0;
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        if (r.pixels[y * 96 + x] !== 4) continue;
        if (x >= where.x && x < where.x + where.w && y >= where.y && y < where.y + where.h) inside++;
        else outside++;
      }
    }
    expect(inside).toBeGreaterThan(40);
    expect(outside).toBe(0);
  });

  it('FR-598 imports with no sea at all: zero zones make every water pixel background', () => {
    const w = world();
    w.curation.seas = [];
    w.curation.units = {};
    w.features.pop();
    const r = core(w);
    // two factions and three land territories, and no entry beyond them
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.map.territories.length).toBe(3);
    expect(r.pixels.some((v) => v === 0)).toBe(true);
  });
});

describe('FR-608 the stages of the import core, one by one', () => {
  const parse = (w: ReturnType<typeof world>) => {
    const parsed = parseCuration(textBytes(JSON.stringify(w.curation)), 'curation.json');
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    return buildPackage({
      curation: parsed.value,
      primary: { file: 'primary.geojson', bytes: bytesOf(collection(w.features)) },
      context: [{ file: 'context.geojson', bytes: bytesOf(w.context) }],
      codec: pngCodec,
    });
  };
  const sound = (w: ReturnType<typeof world>) => {
    const r = parse(w);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r;
  };

  it('FR-589 draws a context feature, an excluded unit and an unselected unit as other land, never as water', () => {
    const w = world();
    // D is selected by its country; Q is excluded by name; R has no country and is not selected
    (w.features[3] as { properties: Record<string, unknown> }).properties.adm = 'X';
    w.features.push(feat({ code: 'Q', name: 'Excluded', adm: 'X' }, rect(1, -1.1, 2, -0.9)), feat({ code: 'R', name: 'Unselected' }, rect(4, -1.1, 5, -0.9)));
    w.curation.select = [{ property: 'adm', in: ['X', 'Y'] }];
    w.curation.exclude = ['Q'];
    const r = sound(w);
    const at = (lon: number, lat: number): number => {
      const [u, v] = r.details.views.main.toUV(lon, lat);
      return r.pixels[Math.floor(v) * r.width + Math.floor(u)]!;
    };
    expect(at(3, -1.35)).toBe(0);
    expect(at(1.5, -1)).toBe(0);
    expect(at(4.5, -1)).toBe(0);
    // the water between them is a sea zone, and a land unit keeps its own id
    expect(at(3, -0.7)).toBeGreaterThan(3);
    expect(at(1, 1)).toBe(1);
    expect(r.details.curation.selection.other.map((u) => u.key)).toStrictEqual(['Q', 'R']);
  });

  it('FR-600 refuses an unsplit antimeridian ring of a context source with Equal Earth, naming the file and the feature', () => {
    const w = world();
    w.curation.params.projection = 'equal-earth';
    w.context = collection([feat({ name: 'Strip' }, rect(0, -1.5, 6, -1.2)), feat({ name: 'Fiji' }, rect(178, -17, -178, -16))]);
    const r = parse(w);
    expect(r).toMatchObject({ ok: false, stage: 'projection' });
    expect(r.ok ? [] : r.errors).toStrictEqual([{ kind: 'antimeridian-edge', file: 'context.geojson', feature: 1 }]);
  });

  it('FR-601 fails with inset-hides-land when an inset sits over land of the main view, in the projection stage', () => {
    const w = world();
    w.features.push(feat({ code: 'I', name: 'Isle', adm: 'Y' }, rect(5, 3.6, 5.6, 4.2)));
    w.curation.insets = [{ select: [{ property: 'code', eq: 'I' }], at: [30, 30] }];
    const r = parse(w);
    expect(r).toMatchObject({ ok: false, stage: 'projection' });
    expect(r.ok ? [] : r.errors).toStrictEqual([{ kind: 'inset-hides-land', inset: 0 }]);
  });

  it('FR-603 gives a lake of the unit with the highest id to that unit', () => {
    const w = world();
    const gamma = w.features[2] as { geometry: { coordinates: number[][][] } };
    gamma.geometry.coordinates.push([[4.9, 0.9], [5.1, 0.9], [5.1, 1.1], [4.9, 1.1], [4.9, 0.9]]);
    w.curation.params.gapFill = 50;
    const r = sound(w);
    expect(r.details.filled.map((f) => f.territory)).toStrictEqual([3]);
  });

  it('FR-598 stops at a seed that lies on land, in the pixel stage', () => {
    const w = world();
    w.curation.seas = [{ name: 'On land', lon: 1, lat: 1 }];
    const r = parse(w);
    expect(r).toMatchObject({ ok: false, stage: 'pixels' });
    expect(r.ok ? [] : r.errors).toStrictEqual([{ kind: 'seed-not-water', seed: 0, name: 'On land' }]);
  });

  it('FR-604 lists a sea territory with no pixel of its own and cleans pieces below the minimum, not those of exactly S pixels', () => {
    const w = world();
    // T lies inside the marine region D, which is first in order and takes every shared pixel
    w.features.push(feat({ code: 'T', name: 'Hidden sea' }, rect(5, 2.5, 5.2, 2.7)));
    w.curation.units.T = { kind: 'sea' };
    const r = parse(w);
    expect(r.ok ? [] : r.errors).toStrictEqual([{ kind: 'territory-below-min-size', territory: 'T', name: 'Hidden sea', pixels: 0, largest: 0 }]);

    // a small island of B in the southern water is a piece of n pixels: cleaned for S = n + 1, kept for S = n
    const island = world();
    const beta = island.features[1] as { geometry: { type: string; coordinates: unknown[] } };
    beta.geometry = { type: 'MultiPolygon', coordinates: [beta.geometry.coordinates, [[[1, -1.1], [1.25, -1.1], [1.25, -0.85], [1, -0.85], [1, -1.1]]]] };
    // the smallest S that cleans the island is its size plus one: the piece is kept for S = n and cleaned for S = n + 1
    let first = 0;
    for (let s = 1; s <= 80 && first === 0; s++) {
      island.curation.params.minPieceSize = s;
      if (sound(island).details.reassigned.length > 0) first = s;
    }
    expect(first).toBeGreaterThan(4);
    island.curation.params.minPieceSize = first;
    const cleaned = sound(island).details.reassigned;
    expect(cleaned.map((x) => [x.entry, x.pixels])).toStrictEqual([[2, first - 1]]);
    expect(cleaned[0]!.to).toBeGreaterThanOrEqual(4);
    island.curation.params.minPieceSize = first - 1;
    expect(sound(island).details.reassigned).toStrictEqual([]);
  });
});
