import type { Result } from '@mbrg/shared';
import { statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openShpGeometry } from '../extract/read-shapefile';
import { extractGeo, MAX_ROUND, MIN_ROUND } from '../importer/extract-geo';
import { inspectSource } from '../importer/inspect';
import { readSource, SOURCE_CAPS } from '../importer/read-source';
import type { ExtractGeoError, SourceError } from '../importer/types';
import { realFs, type FsOps } from '../io/fs-ops';

/** The file operations of the import command: those of the builder plus the size of a file (`stat`, never a read). */
export interface ImportFs extends FsOps {
  size(path: string): number;
}

export const realImportFs: ImportFs = { ...realFs, size: (path) => statSync(path).size };

/**
 * FR-588, NFR-135, PD10: the bytes of a file within `cap`. The size comes from `stat` first, so an oversized file is
 * never read; the bytes are checked again once read (the file may have grown). `label` names the file in errors.
 */
export function readBounded(fs: ImportFs, path: string, label: string, cap: number): Result<Uint8Array, SourceError> {
  const tooLarge = (found: number): Result<Uint8Array, SourceError> => ({
    ok: false,
    errors: [{ kind: 'source-too-large', file: label, what: 'bytes', cap, found }],
  });
  let size: number;
  try {
    size = fs.size(path);
  } catch {
    return { ok: false, errors: [{ kind: 'invalid-source', file: label, reason: 'unreadable' }] };
  }
  if (size > cap) return tooLarge(size);
  let bytes: Uint8Array;
  try {
    bytes = fs.readFile(path);
  } catch {
    return { ok: false, errors: [{ kind: 'invalid-source', file: label, reason: 'unreadable' }] };
  }
  return bytes.length > cap ? tooLarge(bytes.length) : { ok: true, value: bytes };
}

/** What `runImport` needs from its environment; tests pass a temporary root and a faulty file system. */
export interface ImportDeps {
  fs: ImportFs;
  /** Repository root: relative option paths resolve against it. */
  root: string;
  stdout(text: string): void;
  stderr(text: string): void;
}

/** FR-586: the three modes of the one command. */
export const IMPORT_MODES = ['extract', 'inspect', 'import'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

export const IMPORT_USAGE = `usage: import-map ${IMPORT_MODES.join('|')} [options]`;

const EXTRACT_USAGE =
  'usage: import-map extract --shp=<file.shp> --out=<file.geojson> [--keep=<name,...>] ' +
  '[--encoding=<utf-8|windows-1252|iso-8859-1>] [--round=<6..15>]';

interface ExtractOptions {
  shp: string;
  out: string;
  keep?: string[];
  encoding?: string;
  round?: number;
}

/** Every option needs a non-empty value after `=`, and none may be given twice. */
function parseExtractArgs(args: string[], root: string): ExtractOptions | string {
  const seen = new Map<string, string>();
  for (const arg of args) {
    const at = arg.indexOf('=');
    const flag = at < 0 ? arg : arg.slice(0, at);
    if (!['--shp', '--out', '--keep', '--encoding', '--round'].includes(flag)) return `unknown option: ${arg}`;
    const value = at < 0 ? '' : arg.slice(at + 1);
    if (value === '') return `missing value for ${flag}`;
    if (seen.has(flag)) return `duplicate option: ${flag}`;
    seen.set(flag, value);
  }
  const shp = seen.get('--shp');
  const out = seen.get('--out');
  if (shp === undefined) return 'the --shp file is required';
  if (out === undefined) return 'the --out file is required';
  const options: ExtractOptions = { shp: resolve(root, shp), out: resolve(root, out) };
  const keep = seen.get('--keep');
  if (keep !== undefined) {
    options.keep = keep.split(',');
    if (options.keep.some((name) => name === '')) return 'empty name in --keep';
  }
  const encoding = seen.get('--encoding');
  if (encoding !== undefined) options.encoding = encoding;
  const round = seen.get('--round');
  if (round !== undefined) {
    if (!/^\d+$/.test(round)) return `--round must be a whole number: ${round}`;
    options.round = Number(round);
    if (options.round < MIN_ROUND || options.round > MAX_ROUND) return `--round must be ${MIN_ROUND} to ${MAX_ROUND}`;
  }
  return options;
}

const arrayBufferOf = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const invalidInput = (reason: string): ExtractGeoError => ({ kind: 'invalid-input', reason });

/**
 * The bytes of the first of `paths` that exists and can be read, or undefined when none can (an optional file that is
 * absent). Each file gets the size check before it is read (PD10): an oversized one is an error, never read.
 */
function firstReadable(fs: ImportFs, paths: readonly string[], cap: number): Result<Uint8Array | undefined, SourceError> {
  for (const path of paths) {
    const read = readBounded(fs, path, basename(path), cap);
    if (read.ok) return read;
    if (read.errors.some((e) => e.kind === 'source-too-large')) return read;
    // absent or unreadable: try the next spelling
  }
  return { ok: true, value: undefined };
}

/**
 * FR-590: the extract mode. Reads `--shp` and the files next to it (`.dbf` required; `.cpg` and `.prj` optional), writes
 * the source to `--out`. Errors are JSON lines on stderr; exit 0 success, 1 failure (nothing written), 2 usage error.
 */
export async function runExtractMode(args: string[], deps: ImportDeps): Promise<number> {
  const options = parseExtractArgs(args, deps.root);
  if (typeof options === 'string') {
    deps.stderr(`${options}\n${EXTRACT_USAGE}\n`);
    return 2;
  }
  const fail = (errors: readonly (ExtractGeoError | SourceError)[]): number => {
    for (const error of errors) deps.stderr(JSON.stringify(error) + '\n');
    return 1;
  };
  const stem = options.shp.replace(/\.shp$/i, '');
  const readRequired = (path: string): Result<Uint8Array, ExtractGeoError | SourceError> => {
    const read = readBounded(deps.fs, path, basename(path), SOURCE_CAPS.bytes);
    if (read.ok) return read;
    return { ok: false, errors: read.errors.map((e) => (e.kind === 'invalid-source' ? invalidInput(`${e.file} cannot be read`) : e)) };
  };
  const shp = readRequired(options.shp);
  if (!shp.ok) return fail(shp.errors);
  const dbf = readRequired(stem + '.dbf');
  if (!dbf.ok) return fail(dbf.errors);
  const optionalText = (...extensions: string[]): Result<string | undefined, SourceError> => {
    const read = firstReadable(deps.fs, extensions.map((x) => stem + x), SOURCE_CAPS.bytes);
    if (!read.ok) return read;
    return { ok: true, value: read.value === undefined ? undefined : new TextDecoder().decode(read.value) };
  };
  const cpgRead = optionalText('.cpg', '.CPG');
  if (!cpgRead.ok) return fail(cpgRead.errors);
  const prjRead = optionalText('.prj', '.PRJ');
  if (!prjRead.ok) return fail(prjRead.errors);
  const cpg = cpgRead.value;
  const prj = prjRead.value;

  let geometries;
  try {
    geometries = await openShpGeometry(arrayBufferOf(shp.value));
  } catch {
    return fail([invalidInput(`${basename(options.shp)} is not a readable polygon shapefile`)]);
  }
  const result = extractGeo({
    geometries,
    dbf: dbf.value,
    ...(cpg === undefined ? {} : { cpg }),
    ...(prj === undefined ? {} : { prj }),
    ...(options.encoding === undefined ? {} : { encoding: options.encoding }),
    ...(options.keep === undefined ? {} : { keep: options.keep }),
    ...(options.round === undefined ? {} : { round: options.round }),
  });
  if (!result.ok) return fail(result.errors);

  const temp = options.out + '.tmp';
  try {
    deps.fs.mkdir(dirname(options.out));
    deps.fs.writeFile(temp, result.value);
    deps.fs.rename(temp, options.out);
  } catch {
    try {
      deps.fs.unlink(temp);
    } catch {
      // no temporary file to remove
    }
    return fail([invalidInput(`${basename(options.out)} cannot be written`)]);
  }
  deps.stdout(`extracted ${geometries.length} features to ${basename(options.out)}\n`);
  return 0;
}

const INSPECT_USAGE = 'usage: import-map inspect --source=<file.geojson> [--draft=<file.json>]';

/** The path from `from` (a folder) to `to`, with forward slashes, as a curation file wants its paths. */
function relativeText(from: string, to: string): string {
  return relative(from, to).split(sep).join('/');
}

/** True when the file or folder exists (a `stat` that succeeds). */
function exists(fs: ImportFs, path: string): boolean {
  try {
    fs.size(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * FR-591: the inspect mode. Reads a source (`--source`), prints its summary on stdout and, when asked, writes the
 * draft curation to `--draft` (never into a folder that holds a `map.json`, PD7). Errors are JSON lines on stderr;
 * exit 0 success, 1 failure (nothing written), 2 usage error.
 */
export function runInspectMode(args: string[], deps: ImportDeps): number {
  const seen = new Map<string, string>();
  for (const arg of args) {
    const at = arg.indexOf('=');
    const flag = at < 0 ? arg : arg.slice(0, at);
    const value = at < 0 ? '' : arg.slice(at + 1);
    const problem = !['--source', '--draft'].includes(flag)
      ? `unknown option: ${arg}`
      : value === ''
        ? `missing value for ${flag}`
        : seen.has(flag)
          ? `duplicate option: ${flag}`
          : undefined;
    if (problem !== undefined) {
      deps.stderr(`${problem}\n${INSPECT_USAGE}\n`);
      return 2;
    }
    seen.set(flag, value);
  }
  const sourceArg = seen.get('--source');
  if (sourceArg === undefined) {
    deps.stderr(`the --source file is required\n${INSPECT_USAGE}\n`);
    return 2;
  }
  const source = resolve(deps.root, sourceArg);
  const draftArg = seen.get('--draft');
  const draft = draftArg === undefined ? undefined : resolve(deps.root, draftArg);
  if (draft !== undefined && exists(deps.fs, join(dirname(draft), 'map.json'))) {
    deps.stderr(JSON.stringify({ kind: 'usage-error', reason: 'draft-inside-package', draft }) + '\n');
    deps.stderr(`${INSPECT_USAGE}\n`);
    return 2;
  }
  // An existing file is never replaced: an edited curation, or the source itself, would be lost.
  if (draft !== undefined && exists(deps.fs, draft)) {
    deps.stderr(JSON.stringify({ kind: 'usage-error', reason: 'draft-exists', draft }) + '\n');
    deps.stderr(`${INSPECT_USAGE}\n`);
    return 2;
  }

  const fail = (errors: readonly SourceError[]): number => {
    for (const error of errors) deps.stderr(JSON.stringify(error) + '\n');
    return 1;
  };
  const label = basename(source);
  const bytes = readBounded(deps.fs, source, label, SOURCE_CAPS.bytes);
  if (!bytes.ok) return fail(bytes.errors);
  const read = readSource({ file: label, bytes: bytes.value }, { usedProperties: [] });
  if (!read.ok) return fail(read.errors);

  const result = inspectSource(read.value, draft === undefined ? label : relativeText(dirname(draft), source));
  if (draft !== undefined) {
    const temp = draft + '.tmp';
    try {
      deps.fs.mkdir(dirname(draft));
      deps.fs.writeFile(temp, result.draft);
      deps.fs.rename(temp, draft);
    } catch {
      try {
        deps.fs.unlink(temp);
      } catch {
        // no temporary file to remove
      }
      deps.stderr(JSON.stringify({ kind: 'invalid-input', reason: `${basename(draft)} cannot be written` }) + '\n');
      return 1;
    }
  }
  deps.stdout(result.summary);
  return 0;
}

/** The part of a mode that runs it; later tasks register extract, inspect and import here. */
export type ModeHandler = (args: string[], deps: ImportDeps) => number | Promise<number>;
export const MODE_HANDLERS: Partial<Record<ImportMode, ModeHandler>> = { extract: runExtractMode, inspect: runInspectMode };

/** FR-586: the mode word is the first argument, exactly one of the three (case-sensitive); the rest is the mode's own. */
export function parseMode(args: string[]): { mode: ImportMode; rest: string[] } | string {
  const word = args[0];
  if (word === undefined) return 'a mode is required';
  const mode = IMPORT_MODES.find((m) => m === word);
  if (mode === undefined) return `unknown mode: ${word}`;
  return { mode, rest: args.slice(1) };
}

/**
 * FR-586: the import command. Exit status: 0 success, 1 failure, 2 usage error (the message and the usage
 * line go to stderr). Only the mode dispatch lives here; each mode is registered in `MODE_HANDLERS`.
 */
export async function runImport(args: string[], deps: ImportDeps): Promise<number> {
  const parsed = parseMode(args);
  if (typeof parsed === 'string') {
    deps.stderr(`${parsed}\n${IMPORT_USAGE}\n`);
    return 2;
  }
  const handler = MODE_HANDLERS[parsed.mode];
  if (handler === undefined) {
    deps.stderr(`the ${parsed.mode} mode is not available yet\n`);
    return 1;
  }
  return handler(parsed.rest, deps);
}

/** The real command: repository root from this file's location (tools/build-map/src/cli). */
async function main(): Promise<number> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  return runImport(process.argv.slice(2), {
    fs: realImportFs,
    root,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}

// Run only as a script, never when a test imports `runImport`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
