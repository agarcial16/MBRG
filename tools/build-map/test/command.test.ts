import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildInMemory } from '../src/core/build';
import { previewRgb } from '../src/core/preview';
import type { InputName } from '../src/core/types';
import { runBuild } from '../src/cli/build';
import { realFs, type FsOps } from '../src/io/fs-ops';
import { pngCodec } from '../src/io/png-codec';
import { inputTexts, miniInputs } from './helpers/fixtures';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

/** Where each input lives under the data directory (plan section 2). */
const INPUT_FILES: Record<InputName, string> = {
  provinces: 'natural-earth/provinces.json',
  countries: 'natural-earth/countries.json',
  otherLand: 'natural-earth/other-land.json',
  meta: 'natural-earth/source-meta.json',
  grouping: 'dev-map/grouping.json',
  seeds: 'dev-map/sea-seeds.json',
  params: 'dev-map/params.json',
};
const ARTIFACTS = ['map.json', 'presentation.json', 'ids.png'] as const;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mbrg-build-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const dataDir = (): string => join(root, 'tools', 'build-map', 'data');
const outDir = (): string => join(root, 'maps', 'dev');

function writeInputs(texts: Record<InputName, string> = inputTexts(miniInputs())): void {
  for (const name of Object.keys(INPUT_FILES) as InputName[]) {
    const file = join(dataDir(), INPUT_FILES[name]);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, texts[name]);
  }
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], fs: FsOps = realFs): Run {
  let stdout = '';
  let stderr = '';
  const status = runBuild(args, {
    fs,
    codec: pngCodec,
    root,
    stdout: (s) => (stdout += s),
    stderr: (s) => (stderr += s),
  });
  return { status, stdout, stderr };
}

const errorsOf = (r: Run): unknown[] =>
  r.stderr
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as unknown);

const read = (path: string): Buffer => readFileSync(path);
const listing = (dir: string): string[] => readdirSync(dir).sort();

/** Puts known old bytes in the package directory and returns them. */
function writeOldPackage(): Record<string, string> {
  mkdirSync(outDir(), { recursive: true });
  const old: Record<string, string> = {};
  for (const name of ARTIFACTS) {
    old[name] = `old ${name}`;
    writeFileSync(join(outDir(), name), old[name]);
  }
  return old;
}

function expectOld(old: Record<string, string>, except: readonly string[] = []): void {
  for (const name of ARTIFACTS) {
    if (except.includes(name)) continue;
    expect(read(join(outDir(), name)).toString(), name).toBe(old[name]);
  }
}

/** Real file system whose n-th call (1-based) of an operation throws; a failing write leaves a partial file. */
function faultyFs(fault: { write?: number; rename?: number }): FsOps & { calls: string[] } {
  const calls: string[] = [];
  let writes = 0;
  let renames = 0;
  return {
    calls,
    readFile: (p) => realFs.readFile(p),
    mkdir: (p) => realFs.mkdir(p),
    unlink: (p) => {
      calls.push(`unlink ${p}`);
      realFs.unlink(p);
    },
    writeFile: (p, bytes) => {
      writes++;
      calls.push(`write ${p}`);
      if (writes === fault.write) {
        realFs.writeFile(p, bytes.slice(0, 3)); // a half-written temporary file
        throw new Error('disk full');
      }
      realFs.writeFile(p, bytes);
    },
    rename: (from, to) => {
      renames++;
      calls.push(`rename ${from} -> ${to}`);
      if (renames === fault.rename) throw new Error('locked');
      realFs.rename(from, to);
    },
  };
}

describe('FR-111 the build command', () => {
  it('FR-111 reads the committed input files and writes the three artifacts and the report', () => {
    writeInputs();
    const outcome = buildInMemory(miniInputs(), pngCodec);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const r = run([]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe(outcome.report);
    expect(listing(outDir())).toStrictEqual(['ids.png', 'map.json', 'presentation.json']);
    expect(read(join(outDir(), 'map.json')).equals(Buffer.from(outcome.files.map))).toBe(true);
    expect(read(join(outDir(), 'presentation.json')).equals(Buffer.from(outcome.files.presentation))).toBe(true);
    expect(read(join(outDir(), 'ids.png')).equals(Buffer.from(outcome.files.image))).toBe(true);
  });

  it('FR-111 uses the default data and package directories under the root and accepts overrides', () => {
    writeInputs();
    expect(run([]).status).toBe(0);
    expect(existsSync(join(root, 'maps', 'dev', 'map.json'))).toBe(true);
    // Other directories through options, relative to the root.
    expect(run(['--data=tools/build-map/data', '--out=elsewhere/pkg']).status).toBe(0);
    expect(listing(join(root, 'elsewhere', 'pkg'))).toStrictEqual(['ids.png', 'map.json', 'presentation.json']);
  });

  it('FR-111 never touches the network: fetch throws and no source imports a network API', () => {
    writeInputs();
    const fetchSpy = vi.fn(() => {
      throw new Error('network access');
    });
    vi.stubGlobal('fetch', fetchSpy);
    expect(run([]).status).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    const sources = {
      ...import.meta.glob('../src/io/*.ts', { query: '?raw', import: 'default', eager: true }),
      ...import.meta.glob('../src/cli/*.ts', { query: '?raw', import: 'default', eager: true }),
    } as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(4);
    const network = /\b(?:node:)?(?:http|https|http2|net|tls|dgram|dns)\b['"]|\bfetch\b|XMLHttpRequest|WebSocket/;
    for (const [file, src] of Object.entries(sources)) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(network.test(code), file).toBe(false);
    }
  });

  it('FR-111 an unknown option is a usage error that writes nothing', () => {
    writeInputs();
    const r = run(['--nope']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--nope');
    expect(existsSync(outDir())).toBe(false);
  });
});

describe('FR-123 failures leave the package alone', () => {
  it('FR-123 a failed build leaves the previous artifacts byte-identical and exits with failure', () => {
    writeInputs();
    expect(run([]).status).toBe(0);
    const before = ARTIFACTS.map((n) => read(join(outDir(), n)));
    const broken = inputTexts(miniInputs());
    // A territory listing an unknown province code is a grouping error.
    const table = JSON.parse(broken.grouping) as { territories: { provinces: string[] }[] };
    table.territories[2]!.provinces.push('ZZ-NOPE');
    broken.grouping = JSON.stringify(table);
    writeInputs(broken);
    const r = run([]);
    expect(r.status).toBe(1);
    expect(errorsOf(r)).toStrictEqual([{ kind: 'unknown-province', province: 'ZZ-NOPE' }]);
    ARTIFACTS.forEach((n, i) => expect(read(join(outDir(), n)).equals(before[i]!), n).toBe(true));
    expect(listing(outDir())).toStrictEqual(['ids.png', 'map.json', 'presentation.json']);
  });

  it('FR-123 a failed build creates no artifact when there was none', () => {
    const broken = inputTexts(miniInputs());
    broken.seeds = JSON.stringify([]);
    writeInputs(broken);
    const r = run([]);
    expect(r.status).toBe(1);
    expect(errorsOf(r)).toStrictEqual([{ kind: 'no-sea-seeds' }]);
    expect(existsSync(outDir())).toBe(false);
  });

  it('FR-123 the package is written as three temporary files, then renamed in map, presentation, image order', () => {
    writeInputs();
    const fs = faultyFs({});
    expect(run([], fs).status).toBe(0);
    const ops = fs.calls.filter((c) => !c.startsWith('unlink'));
    expect(ops).toHaveLength(6);
    const temps = ops.slice(0, 3).map((c) => c.replace('write ', ''));
    expect(ops.slice(0, 3).every((c) => c.startsWith('write '))).toBe(true);
    temps.forEach((t, i) => {
      expect(dirname(t)).toBe(outDir());
      expect(t).not.toBe(join(outDir(), ARTIFACTS[i]!));
    });
    ARTIFACTS.forEach((name, i) => {
      expect(ops[3 + i]).toBe(`rename ${temps[i]} -> ${join(outDir(), name)}`);
    });
    expect(listing(outDir())).toStrictEqual(['ids.png', 'map.json', 'presentation.json']);
  });

  for (const [n, artifact] of [[1, 'map'], [2, 'presentation'], [3, 'image']] as const) {
    it(`FR-123 a failed write of the ${artifact} temporary file gives write-failed, removes the temporary files, keeps the old package`, () => {
      writeInputs();
      const old = writeOldPackage();
      const r = run([], faultyFs({ write: n }));
      expect(r.status).toBe(1);
      expect(errorsOf(r)).toStrictEqual([{ kind: 'write-failed', artifact }]);
      expect(listing(outDir())).toStrictEqual(['ids.png', 'map.json', 'presentation.json']);
      expectOld(old);
    });
  }

  it('FR-123 a failed write removes only the temporary files this run wrote, not stale ones', () => {
    writeInputs();
    const old = writeOldPackage();
    const stale = join(outDir(), 'ids.png.tmp');
    writeFileSync(stale, 'stale temp of another run');
    const r = run([], faultyFs({ write: 2 }));
    expect(r.status).toBe(1);
    expect(errorsOf(r)).toStrictEqual([{ kind: 'write-failed', artifact: 'presentation' }]);
    expect(listing(outDir())).toStrictEqual(['ids.png', 'ids.png.tmp', 'map.json', 'presentation.json']);
    expect(read(stale).toString()).toBe('stale temp of another run');
    expectOld(old);
  });

  it('FR-123 a failed first rename gives write-failed for that artifact and removes every temporary file', () => {
    writeInputs();
    const old = writeOldPackage();
    const r = run([], faultyFs({ rename: 1 }));
    expect(r.status).toBe(1);
    expect(errorsOf(r)).toStrictEqual([{ kind: 'write-failed', artifact: 'map' }]);
    expect(listing(outDir())).toStrictEqual(['ids.png', 'map.json', 'presentation.json']);
    expectOld(old);
  });

  it('FR-123 a failed rename after the map was replaced gives partial-write and removes the remaining temporary files', () => {
    writeInputs();
    const old = writeOldPackage();
    const outcome = buildInMemory(miniInputs(), pngCodec);
    if (!outcome.ok) throw new Error('fixture must build');
    const r = run([], faultyFs({ rename: 2 }));
    expect(r.status).toBe(1);
    expect(errorsOf(r)).toStrictEqual([
      { kind: 'partial-write', replaced: ['map'], notReplaced: ['presentation', 'image'] },
    ]);
    expect(listing(outDir())).toStrictEqual(['ids.png', 'map.json', 'presentation.json']);
    expect(read(join(outDir(), 'map.json')).equals(Buffer.from(outcome.files.map))).toBe(true);
    expectOld(old, ['map.json']);
  });

  it('FR-123 a failed last rename lists the two replaced artifacts and the one not replaced', () => {
    writeInputs();
    const old = writeOldPackage();
    const r = run([], faultyFs({ rename: 3 }));
    expect(r.status).toBe(1);
    expect(errorsOf(r)).toStrictEqual([
      { kind: 'partial-write', replaced: ['map', 'presentation'], notReplaced: ['image'] },
    ]);
    expect(listing(outDir())).toStrictEqual(['ids.png', 'map.json', 'presentation.json']);
    expectOld(old, ['map.json', 'presentation.json']);
  });

  it('FR-112 and FR-123 an unreadable input file gives invalid-input and no package and no preview', () => {
    const texts = inputTexts(miniInputs());
    writeInputs(texts);
    rmSync(join(dataDir(), INPUT_FILES.seeds));
    const r = run(['--preview']);
    expect(r.status).toBe(1);
    expect(errorsOf(r)).toStrictEqual([{ kind: 'invalid-input', reason: 'seeds: input is unreadable' }]);
    expect(existsSync(outDir())).toBe(false);
    expect(existsSync(join(root, 'tools', 'build-map', 'out'))).toBe(false);
  });
});

describe('FR-126 the preview files', () => {
  it('FR-126 a requested preview goes to the default location outside the package, as the preview image', () => {
    writeInputs();
    const outcome = buildInMemory(miniInputs(), pngCodec);
    if (!outcome.ok) throw new Error('fixture must build');
    expect(run(['--preview']).status).toBe(0);
    const file = join(root, 'tools', 'build-map', 'out', 'preview.png');
    const decoded = pngCodec.decode(new Uint8Array(read(file)));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.width).toBe(outcome.width);
    expect(Buffer.from(decoded.value.rgb).equals(Buffer.from(previewRgb(outcome.preview)))).toBe(true);
    expect(listing(outDir())).toStrictEqual(['ids.png', 'map.json', 'presentation.json']);
  });

  it('FR-126 no preview is written unless asked', () => {
    writeInputs();
    expect(run([]).status).toBe(0);
    expect(existsSync(join(root, 'tools'))).toBe(true);
    expect(existsSync(join(root, 'tools', 'build-map', 'out'))).toBe(false);
  });

  it('FR-126 the preview path can be given and its folder is created', () => {
    writeInputs();
    expect(run(['--preview=review/p.png']).status).toBe(0);
    expect(existsSync(join(root, 'review', 'p.png'))).toBe(true);
    expect(listing(outDir())).toStrictEqual(['ids.png', 'map.json', 'presentation.json']);
  });

  it('FR-126 the default preview location is ignored by the repository and is not in the package', () => {
    const ignore = readFileSync(join(repo, '.gitignore'), 'utf8').split(/\r?\n/);
    expect(ignore).toContain('tools/build-map/out/');
    const preview = join('tools', 'build-map', 'out', 'preview.png');
    // git itself says the default preview file is ignored (exit status 0).
    expect(() => execFileSync('git', ['check-ignore', '-q', preview], { cwd: repo })).not.toThrow();
    // ... and the package files are not.
    for (const name of ARTIFACTS) {
      expect(() => execFileSync('git', ['check-ignore', '-q', join('maps', 'dev', name)], { cwd: repo })).toThrow();
    }
    expect(preview.startsWith(join('maps', 'dev'))).toBe(false);
  });

  it('FR-123 a failure after rasterization still writes the requested preview and leaves the package alone', () => {
    const texts = inputTexts(miniInputs());
    texts.seeds = JSON.stringify([{ name: 'On land', lon: 1.5, lat: 1.5 }]);
    writeInputs(texts);
    const old = writeOldPackage();
    const r = run(['--preview']);
    expect(r.status).toBe(1);
    expect(errorsOf(r)).toStrictEqual([{ kind: 'seed-not-water', seed: 0, name: 'On land' }]);
    const file = join(root, 'tools', 'build-map', 'out', 'preview.png');
    const decoded = pngCodec.decode(new Uint8Array(read(file)));
    expect(decoded.ok && decoded.value.width).toBe(64);
    expectOld(old);
    expect(listing(outDir())).toStrictEqual(['ids.png', 'map.json', 'presentation.json']);
  });

  it('FR-123 a failure before rasterization writes no preview even when asked', () => {
    const texts = inputTexts(miniInputs());
    const table = JSON.parse(texts.grouping) as { territories: { provinces: string[] }[] };
    table.territories[2]!.provinces.push('ZZ-NOPE');
    texts.grouping = JSON.stringify(table);
    writeInputs(texts);
    const r = run(['--preview']);
    expect(r.status).toBe(1);
    expect(existsSync(join(root, 'tools', 'build-map', 'out'))).toBe(false);
    expect(existsSync(outDir())).toBe(false);
  });

  it('FR-123 and FR-126 a preview that cannot be written fails the build before the package is touched', () => {
    writeInputs();
    const old = writeOldPackage();
    const fs = faultyFs({ write: 1 }); // the preview is the first file written
    const r = run(['--preview'], fs);
    expect(r.status).toBe(1);
    expectOld(old);
    expect(listing(outDir())).toStrictEqual(['ids.png', 'map.json', 'presentation.json']);
  });
});

describe('FR-126 the preview never goes inside the package directory', () => {
  const insideCases: [string, () => string][] = [
    ['a relative path inside', () => 'maps/dev/preview.png'],
    ['an absolute path inside', () => join(outDir(), 'preview.png')],
    ['a path normalised by .. into the package', () => 'maps/other/../dev/preview.png'],
    ['a path that leaves and re-enters with ..', () => 'maps/dev/../dev/sub/preview.png'],
    ['the package directory itself', () => 'maps/dev'],
    ['a path inside a package directory given with --out', () => 'custom-out/preview.png'],
  ];
  for (const [label, path] of insideCases) {
    it(`FR-126 ${label} is a usage error: exit 2, a JSON error line, nothing written`, () => {
      writeInputs();
      const out = path().startsWith('custom-out') ? ['--out=custom-out'] : [];
      const r = run([...out, `--preview=${path()}`]);
      expect(r.status).toBe(2);
      const first = JSON.parse(r.stderr.split('\n')[0]!) as Record<string, unknown>;
      expect(first.kind).toBe('usage-error');
      expect(first.reason).toBe('preview-inside-package');
      expect(existsSync(outDir())).toBe(false);
      expect(existsSync(join(root, 'custom-out'))).toBe(false);
      expect(existsSync(join(root, 'tools', 'build-map', 'out'))).toBe(false);
    });
  }

  it('FR-126 the default preview file is rejected when --out puts the package over its folder', () => {
    writeInputs();
    const r = run(['--out=tools/build-map/out', '--preview']);
    expect(r.status).toBe(2);
    expect(existsSync(join(root, 'tools', 'build-map', 'out'))).toBe(false);
  });

  it('FR-126 a path that differs only in letter case is inside on Windows', () => {
    if (process.platform !== 'win32') return;
    writeInputs();
    const r = run(['--preview=MAPS/DEV/preview.png']);
    expect(r.status).toBe(2);
    expect(existsSync(outDir())).toBe(false);
  });

  it('FR-126 a failing build with a preview inside the package is still a usage error and writes nothing', () => {
    const texts = inputTexts(miniInputs());
    texts.seeds = JSON.stringify([{ name: 'On land', lon: 1.5, lat: 1.5 }]);
    writeInputs(texts);
    const old = writeOldPackage();
    const r = run(['--preview=maps/dev/preview.png']);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stderr.split('\n')[0]!)).toMatchObject({ kind: 'usage-error' });
    expect(listing(outDir())).toStrictEqual(['ids.png', 'map.json', 'presentation.json']);
    expectOld(old);
  });

  it('FR-126 a sibling folder whose name starts like the package directory is not inside it', () => {
    writeInputs();
    expect(run(['--preview=maps/dev2/preview.png']).status).toBe(0);
    expect(existsSync(join(root, 'maps', 'dev2', 'preview.png'))).toBe(true);
    expect(listing(outDir())).toStrictEqual(['ids.png', 'map.json', 'presentation.json']);
  });
});
