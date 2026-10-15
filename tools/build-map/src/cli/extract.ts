import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extract, VERSION_FILES, type ExtractBox } from '../extract/extract';
import { readShapefile } from '../extract/read-shapefile';
import { realFs, type FsOps } from '../io/fs-ops';

/** What `runExtract` needs from its environment; tests pass a temporary root. */
export interface ExtractDeps {
  fs: FsOps;
  /** Repository root: the default data directory resolves against it. */
  root: string;
  stdout(text: string): void;
  stderr(text: string): void;
}

const USAGE = 'usage: extract --ne <dir> [--data=<dir>]';
const DEFAULT_DATA = join('tools', 'build-map', 'data');

/** The local Natural Earth file names (1:10m), fixed; the developer supplies the directory. */
const ADMIN1 = 'ne_10m_admin_1_states_provinces';
const ADMIN0 = 'ne_10m_admin_0_countries';

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

function invalidInput(reason: string): string {
  return JSON.stringify({ kind: 'invalid-input', reason }) + '\n';
}

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function readJson(fs: FsOps, file: string, what: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fs.readFile(file)));
  } catch {
    throw new Error(`${what} cannot be read as JSON`);
  }
}

/** The selected country codes: the grouping table's `countries[].country`. */
function selectedCountries(root: unknown): string[] {
  const list = isObject(root) && Array.isArray(root['countries']) ? (root['countries'] as unknown[]) : undefined;
  if (list === undefined) throw new Error('grouping.json must hold a countries list');
  return list.map((c, i) => {
    const code = isObject(c) ? c['country'] : undefined;
    if (typeof code !== 'string') throw new Error(`grouping.json countries[${i}].country must be text`);
    return code;
  });
}

function boxOf(root: unknown): ExtractBox {
  const read = (key: string): number => {
    const value = isObject(root) ? root[key] : undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`extraction-box.json ${key} must be a finite number`);
    }
    return value;
  };
  const box = { west: read('west'), south: read('south'), east: read('east'), north: read('north') };
  if (box.west > box.east || box.south > box.north) {
    throw new Error('extraction-box.json must have west <= east and south <= north');
  }
  return box;
}

function parseArgs(args: string[], root: string): { ne: string; data: string } | string {
  let ne: string | undefined;
  let data = resolve(root, DEFAULT_DATA);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--ne') {
      const next = args[++i];
      if (next === undefined || next.startsWith('--')) return 'missing value for --ne';
      ne = next;
    } else if (arg.startsWith('--ne=') && arg.length > 5) ne = arg.slice(5);
    else if (arg.startsWith('--data=') && arg.length > 7) data = resolve(root, arg.slice(7));
    else return `unknown option: ${arg}`;
  }
  return ne === undefined ? 'the --ne directory is required' : { ne: resolve(root, ne), data };
}

/**
 * FR-131: the one extraction command. Reads the local Natural Earth 1:10m files from `--ne`
 * (no network), the selected countries from `dev-map/grouping.json` and the box from
 * `dev-map/extraction-box.json` under the data directory, and writes the four source files to
 * `natural-earth/` there. Errors are JSON lines on stderr. Exit status: 0 success, 1 failure
 * (nothing written), 2 usage error.
 */
export async function runExtract(args: string[], deps: ExtractDeps): Promise<number> {
  const options = parseArgs(args, deps.root);
  if (typeof options === 'string') {
    deps.stderr(`${options}\n${USAGE}\n`);
    return 2;
  }
  try {
    const selected = selectedCountries(readJson(deps.fs, join(options.data, 'dev-map', 'grouping.json'), 'grouping.json'));
    const box = boxOf(readJson(deps.fs, join(options.data, 'dev-map', 'extraction-box.json'), 'extraction-box.json'));

    const read = (name: string): Uint8Array => {
      try {
        return deps.fs.readFile(join(options.ne, name));
      } catch {
        throw new Error(`${name} cannot be read`);
      }
    };
    const readText = (name: string): string | undefined => {
      try {
        return new TextDecoder('utf-8').decode(deps.fs.readFile(join(options.ne, name)));
      } catch {
        return undefined;
      }
    };
    const dataset = async (base: string) => {
      const shp = arrayBufferOf(read(`${base}.shp`));
      const dbf = arrayBufferOf(read(`${base}.dbf`));
      try {
        return await readShapefile(shp, dbf);
      } catch {
        throw new Error(`${base} is not a readable polygon shapefile`);
      }
    };
    const admin1 = await dataset(ADMIN1);
    const admin0 = await dataset(ADMIN0);
    const versionTexts = {
      [VERSION_FILES.admin1]: readText(VERSION_FILES.admin1),
      [VERSION_FILES.admin0]: readText(VERSION_FILES.admin0),
    };

    const result = extract({ admin1, admin0, versionTexts }, selected, box);
    if (!result.ok) {
      for (const error of result.errors) deps.stderr(JSON.stringify(error) + '\n');
      return 1;
    }
    const out = join(options.data, 'natural-earth');
    deps.fs.mkdir(out);
    deps.fs.writeFile(join(out, 'provinces.json'), result.value.provinces);
    deps.fs.writeFile(join(out, 'countries.json'), result.value.countries);
    deps.fs.writeFile(join(out, 'other-land.json'), result.value.otherLand);
    deps.fs.writeFile(join(out, 'source-meta.json'), result.value.meta);
    const meta = JSON.parse(new TextDecoder().decode(result.value.meta)) as { version: string };
    deps.stdout(`extracted from Natural Earth ${meta.version}\n`);
    return 0;
  } catch (error) {
    deps.stderr(invalidInput(error instanceof Error ? error.message : 'unreadable input'));
    return 1;
  }
}

/** The real command: repository root from this file's location (tools/build-map/src/cli). */
async function main(): Promise<number> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  return runExtract(process.argv.slice(2), {
    fs: realFs,
    root,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}

// Run only as a script, never when a test imports `runExtract`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
