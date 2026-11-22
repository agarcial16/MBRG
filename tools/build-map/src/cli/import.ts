import type { Result } from '@mbrg/shared';
import { statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SourceError } from '../importer/types';
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

/** The part of a mode that runs it; later tasks register extract, inspect and import here. */
export type ModeHandler = (args: string[], deps: ImportDeps) => number | Promise<number>;
export const MODE_HANDLERS: Partial<Record<ImportMode, ModeHandler>> = {};

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
