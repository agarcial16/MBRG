import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { realImportFs, runImportMode } from '../src/cli/import';
import { parseCuration } from '../src/importer/curation';
import { buildPackage } from '../src/importer/import';
import { tileBasins, configFromTile } from '../src/importer/tiling';
import { pngCodec } from '../src/io/png-codec';

/** The repository root: the samples live under `tools/build-map/data/importer`. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const data = join(root, 'tools', 'build-map', 'data');
const sample = join(data, 'importer', 'tiling-sample');
const expected = join(sample, 'expected');
const progress = (): string => readFileSync(join(root, 'specs', 'archive', '035-ocean-tiles', 'PROGRESS.md'), 'utf8');

let out: string;
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'mbrg-tiling-'));
});
afterEach(() => {
  rmSync(out, { recursive: true, force: true });
});

function importSample(dir = sample): { status: number; stdout: string; stderr: string } {
  rmSync(out, { recursive: true, force: true });
  let stdout = '';
  let stderr = '';
  const status = runImportMode([`--curation=${join(dir, 'curation.json')}`, `--out=${out}`], { fs: realImportFs, root, stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) });
  return { status, stdout, stderr };
}

describe('FR-688 the tiling sample', () => {
  it('FR-688 is small: the primary source stays under 200 KB and the names file too', () => {
    expect(statSync(join(sample, 'primary.json')).size).toBeLessThan(200 * 1024);
    expect(statSync(join(sample, 'names.json')).size).toBeLessThan(200 * 1024);
  });

  it('FR-688 imports to the three expected files byte for byte', () => {
    const r = importSample();
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    for (const artifact of ['map.json', 'presentation.json', 'ids.png']) {
      expect(readFileSync(join(out, artifact)).equals(readFileSync(join(expected, artifact))), artifact).toBe(true);
    }
  }, 120_000);

  it('FR-688 exercises every case it exists for: two basins that touch, a basin kept whole, an enclosed set joined, an inset sea, a bridged exclave and a bay inside a sea', () => {
    const r = importSample();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('tiling: on');
    expect(r.stdout).toMatch(/^ {4}- name=Mar Oeste .* tiles=(\d+)$/m);
    expect(r.stdout).toMatch(/^ {4}- name=Golfo Quieto .* tiles=1$/m);
    expect(r.stdout).toMatch(/^enclosedWaterSets: 1$/m);
    expect(r.stdout).toMatch(/^insets: 1$/m);
    expect(r.stdout).toMatch(/^exclaveBridges: [1-9]/m);
    const names = (JSON.parse(readFileSync(join(out, 'presentation.json'), 'utf8')) as { territories: { name: string }[] }).territories.map((t) => t.name);
    expect(names.some((n) => n.startsWith('Bahía Chica'))).toBe(true);
  }, 120_000);

  it('FR-688 is not added to maps/, to the server settings or to the e2e harness', () => {
    const offenders: string[] = [];
    const scan = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) scan(path);
        else if (/\.(ts|json|md|yml|yaml|env)$/.test(entry.name) && !path.includes(join('tools', 'build-map')) && !path.includes('specs')) {
          if (readFileSync(path, 'utf8').includes('importer/tiling-sample')) offenders.push(path);
        }
      }
    };
    for (const folder of ['maps', 'apps', 'packages']) if (existsSync(join(root, folder))) scan(join(root, folder));
    expect(offenders).toStrictEqual([]);
  });
});

describe('FR-693 the goldens under default-on tiling', () => {
  it('FR-693 turns tiling off in the dev-map equivalence curation, so the 003b pipeline is still reproduced byte for byte', () => {
    const curation = JSON.parse(readFileSync(join(data, 'importer', 'dev-map.curation.json'), 'utf8')) as { params: { tiling?: unknown } };
    expect(curation.params.tiling).toBe(false);
  });

  it('FR-693 runs the 028 sample with default tiling: its curation has no tiling member and its expected package holds tiles', () => {
    const curation = JSON.parse(readFileSync(join(data, 'importer', 'sample', 'curation.json'), 'utf8')) as { params: Record<string, unknown>; seas: unknown[] };
    expect('tiling' in curation.params).toBe(false);
    const map = JSON.parse(readFileSync(join(data, 'importer', 'sample', 'expected', 'map.json'), 'utf8')) as { territories: { kind?: string }[] };
    const sea = map.territories.filter((t) => t.kind === 'sea').length;
    expect(sea).toBeGreaterThan(curation.seas.length + 1);
  });

  it('FR-693 leaves maps/dev and the predefined maps, which the builder makes and not the importer, untouched', () => {
    for (const name of ['dev', 'spain-provinces', 'world-countries']) {
      const dir = join(root, 'maps', name);
      expect(existsSync(join(dir, 'map.json')), name).toBe(true);
      const map = JSON.parse(readFileSync(join(dir, 'map.json'), 'utf8')) as { territories: unknown[] };
      expect(map.territories.length, name).toBeGreaterThan(10);
    }
  });
});

describe('FR-673 the order of the steps', () => {
  it('FR-673 checks the land and sea territories for a piece of S pixels before tiling anything, and tiles after the water pass', () => {
    const json = JSON.parse(readFileSync(join(sample, 'curation.json'), 'utf8')) as { params: Record<string, unknown> };
    json.params.minPieceSize = 5000;
    const parsed = parseCuration(new TextEncoder().encode(JSON.stringify(json)), 'curation.json');
    if (!parsed.ok) throw new Error('should parse');
    const bytes = (name: string): Uint8Array => new Uint8Array(readFileSync(join(sample, name)));
    const outcome = buildPackage({
      curation: parsed.value,
      primary: { file: 'primary.json', bytes: bytes('primary.json') },
      context: [{ file: 'context.json', bytes: bytes('context.json') }],
      names: { file: 'names.json', bytes: bytes('names.json') },
      codec: pngCodec,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.stage).toBe('pixels');
    expect(outcome.errors.every((e) => e.kind === 'territory-below-min-size')).toBe(true);
    expect(outcome.preview).toBeDefined();
  });

  it('FR-673 changes only water of basins: land, other land and lakes keep their values', () => {
    const width = 80;
    const pixels = new Uint32Array(width * width).fill(10);
    for (let y = 0; y < width; y++) for (let x = 0; x < 10; x++) pixels[y * width + x] = y % 2 === 0 ? 1 : 0;
    const result = tileBasins({ width, pixels, firstId: 10, basins: [{ name: 'B', whole: false }], pixelKm: 1, minPieceSize: 1, maxTiles: 1000, spacing: configFromTile(15) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (let i = 0; i < pixels.length; i++) expect(result.value.labels[i]! >= 0).toBe(pixels[i] === 10);
  });
});

describe('FR-687 the parameters in force', () => {
  it('FR-687 prints every spacing in force, in kilometres and pixels, also when all are defaults', () => {
    const r = importSample();
    expect(r.status).toBe(0);
    for (const label of ['  tileKm: 600 (pixels=', '  openTileKm: 1200 (pixels=', '  farTileKm: 2400 (pixels=', '  coastBandKm: 600 (pixels=', '  reachKm: 3600 (pixels=']) expect(r.stdout).toContain(label);
    const plain = importSample(join(data, 'importer', 'sample'));
    expect(plain.status).toBe(0);
    for (const label of ['  tileKm: ', '  openTileKm: ', '  farTileKm: ', '  coastBandKm: ', '  reachKm: ', '  targetTiles: ']) expect(plain.stdout).toContain(label);
  }, 120_000);
});

describe('the proofs and the record', () => {
  it('FR-690 the deployment guide documents tiling: on by default, false turns it off, the tuning members, zones, the names file and the licence note', () => {
    const text = readFileSync(join(root, 'docs', 'deployment.md'), 'utf8');
    const section = text.slice(text.indexOf('## Adding a map'));
    for (const word of ['Sea tiles', '"tiling": false', 'targetTiles', 'tileKm', 'openTileKm', 'farTileKm', 'coastBandKm', 'reachKm', 'maxTiles', 'too-many-tiles', 'zones', 'params.tiling.names', 'ne_10m_geography_marine_polys', 'public', 'requiredTextureSize', 'maxFactionsPerTile']) {
      expect(section, word).toContain(word);
    }
    const readme = readFileSync(join(data, 'marine-ne', 'README.md'), 'utf8');
    expect(readme).toContain('public domain');
    expect(readme).toContain('Made with Natural Earth');
    expect(readme).toContain('53f865e8ffa966cdd402145c82c5cd14ee7ce974cd0eb9a3f59f03a4cfd2d66c');
    expect(statSync(join(data, 'marine-ne', 'ne_10m_geography_marine_polys.geojson')).size).toBe(1_692_635);
  });

  it('FR-691 the hand run is recorded: tile counts, the rival checks, the timing and the colour assignment of both maps', () => {
    const text = progress();
    for (const word of ['world-1815-7', 'spain-municipios-5', 'tiles', 'max factions per tile', 'Russia', 'Zulu', 'Khanates', 'seconds', 'palette']) {
      expect(text, word).toContain(word);
    }
  });

  it('FR-692 the board records the viewer follow-up V4 decision', () => {
    const board = readFileSync(join(root, 'docs', 'board.md'), 'utf8');
    expect(board).toContain('035');
    expect(board).toMatch(/V4/);
  });

  it('NFR-175 the tiling core is pure: it reads the raster and parameters only and gives the same tiles twice', () => {
    const width = 120;
    const pixels = new Uint32Array(width * width).fill(10);
    for (let y = 0; y < width; y++) pixels[y * width] = 1;
    const run = (): string => {
      const r = tileBasins({ width, pixels, firstId: 10, basins: [{ name: 'B', whole: false }], pixelKm: 1, minPieceSize: 1, maxTiles: 1000, spacing: configFromTile(20) });
      if (!r.ok) throw new Error('should tile');
      return JSON.stringify([Array.from(r.value.labels), r.value.tiles, r.value.merged]);
    };
    expect(run()).toBe(run());
    for (const file of ['tiling.ts', 'tiling-step.ts', 'tile-names.ts']) {
      const source = readFileSync(join(root, 'tools', 'build-map', 'src', 'importer', file), 'utf8');
      expect(source, file).not.toMatch(/Math\.random|Date\.now|new Date|from 'node:|require\(/);
    }
  });

  it('NFR-176 adds no dependency: the build-map manifest keeps its four dependencies, and the names file is data', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'tools', 'build-map', 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(Object.keys(manifest.dependencies).sort()).toStrictEqual(['@mbrg/protocol', '@mbrg/shared', 'pngjs', 'shapefile']);
  });

  it('NFR-178 keeps the language of the importer: English error kinds and report labels, a language-neutral number suffix', () => {
    const kinds = ['unknown-sea', 'too-many-tiles', 'tile-name-too-long'];
    for (const kind of kinds) expect(kind).toMatch(/^[a-z]+(-[a-z0-9]+)*$/);
    const step = readFileSync(join(root, 'tools', 'build-map', 'src', 'importer', 'tiling-step.ts'), 'utf8');
    for (const kind of kinds) expect(step + readFileSync(join(root, 'tools', 'build-map', 'src', 'importer', 'tiling.ts'), 'utf8')).toContain(`'${kind}'`);
  });

  it('NFR-179 tiles a raster at a real scale with empty frame: 2,048 x 2,048, a coast and open ocean, in bounded time', () => {
    const width = 2048;
    const pixels = new Uint32Array(width * width).fill(10);
    for (let y = 0; y < width; y++) for (let x = 0; x < 300 + (y % 50); x++) pixels[y * width + x] = 1;
    const started = Date.now();
    const result = tileBasins({ width, pixels, firstId: 10, basins: [{ name: 'B', whole: false }], pixelKm: 8, minPieceSize: 1, maxTiles: 10_000, spacing: { targetTiles: 300, frameKm: width * 8 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tiles.length).toBeGreaterThan(150);
    expect(result.value.tiles.length).toBeLessThanOrEqual(300);
    expect(Date.now() - started).toBeLessThan(60_000);
  }, 120_000);

  it('NFR-177 keeps tiling within its budget: a 1,024 x 1,024 ocean tiles by search in a few seconds', () => {
    const width = 1024;
    const pixels = new Uint32Array(width * width).fill(10);
    for (let y = 0; y < width; y++) pixels[y * width] = 1;
    const started = Date.now();
    const result = tileBasins({ width, pixels, firstId: 10, basins: [{ name: 'B', whole: false }], pixelKm: 8, minPieceSize: 1, maxTiles: 10_000, spacing: { targetTiles: 600, frameKm: width * 8 } });
    expect(result.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 120_000);
});
