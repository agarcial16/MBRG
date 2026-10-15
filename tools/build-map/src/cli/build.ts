import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildInMemory } from '../core/build';
import { parseBuildInputs } from '../core/parse-inputs';
import { previewRgb } from '../core/preview';
import type { InputName, PngCodec, PreviewSource } from '../core/types';
import { realFs, type FsOps } from '../io/fs-ops';
import { pngCodec } from '../io/png-codec';
import { readInputTexts } from '../io/read-inputs';
import { writePackage } from '../io/write-package';

/** What `runBuild` needs from its environment; tests pass a temporary root and a faulty file system. */
export interface BuildDeps {
  fs: FsOps;
  codec: PngCodec;
  /** Repository root: the default directories and relative option paths resolve against it. */
  root: string;
  stdout(text: string): void;
  stderr(text: string): void;
}

const USAGE = 'usage: build-map [--data=<dir>] [--out=<dir>] [--preview[=<file>]]';

/** FR-111, FR-126: the default input directory, package directory and preview file under the root. */
const DEFAULT_DATA = join('tools', 'build-map', 'data');
const DEFAULT_OUT = join('maps', 'dev');
const DEFAULT_PREVIEW = join('tools', 'build-map', 'out', 'preview.png');

interface Options {
  data: string;
  out: string;
  preview?: string;
}

function parseArgs(args: string[], root: string): Options | string {
  const options: Options = { data: resolve(root, DEFAULT_DATA), out: resolve(root, DEFAULT_OUT) };
  for (const arg of args) {
    const value = (flag: string): string | undefined =>
      arg.startsWith(flag + '=') && arg.length > flag.length + 1 ? arg.slice(flag.length + 1) : undefined;
    if (arg === '--preview') options.preview = resolve(root, DEFAULT_PREVIEW);
    else if (value('--preview') !== undefined) options.preview = resolve(root, value('--preview')!);
    else if (value('--data') !== undefined) options.data = resolve(root, value('--data')!);
    else if (value('--out') !== undefined) options.out = resolve(root, value('--out')!);
    else return `unknown option: ${arg}`;
  }
  return options;
}

/** FR-126: writes the preview image (outside the package); false when it could not be written. */
function writePreview(file: string, source: PreviewSource, deps: BuildDeps): boolean {
  try {
    const png = deps.codec.encode(source.width, source.width, previewRgb(source));
    deps.fs.mkdir(dirname(file));
    deps.fs.writeFile(file, png);
    return true;
  } catch {
    try {
      deps.fs.unlink(file);
    } catch {
      // nothing half written to remove
    }
    deps.stderr(`preview could not be written: ${file}\n`);
    return false;
  }
}

/**
 * FR-111: the one build command. Reads the local input files, builds in memory, then writes the
 * package (FR-123) and, when asked, the preview (FR-126). Errors are printed one JSON object per
 * line on stderr; the report goes to stdout. Exit status: 0 success, 1 build or write failure,
 * 2 usage error. A failed build creates, modifies and deletes no package artifact.
 */
export function runBuild(args: string[], deps: BuildDeps): number {
  const options = parseArgs(args, deps.root);
  if (typeof options === 'string') {
    deps.stderr(`${options}\n${USAGE}\n`);
    return 2;
  }
  const printErrors = (errors: readonly unknown[]): void => {
    for (const error of errors) deps.stderr(JSON.stringify(error) + '\n');
  };

  const texts = readInputTexts(options.data, deps.fs);
  const parsed = parseBuildInputs(texts as Record<InputName, string>);
  if (!parsed.ok) {
    printErrors(parsed.errors);
    return 1;
  }

  const outcome = buildInMemory(parsed.value, deps.codec);
  if (!outcome.ok) {
    printErrors(outcome.errors);
    if (options.preview !== undefined && outcome.preview !== undefined) {
      writePreview(options.preview, outcome.preview, deps);
    }
    return 1;
  }

  // The preview is outside the package; a requested preview that fails stops the build before the package changes.
  if (options.preview !== undefined && !writePreview(options.preview, outcome.preview, deps)) return 1;
  const written = writePackage(options.out, outcome.files, deps.fs);
  if (!written.ok) {
    printErrors(written.errors);
    return 1;
  }
  deps.stdout(outcome.report);
  return 0;
}

/** The real command: repository root from this file's location (tools/build-map/src/cli). */
function main(): number {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  return runBuild(process.argv.slice(2), {
    fs: realFs,
    codec: pngCodec,
    root,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}

// Run only as a script, never when a test imports `runBuild`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
