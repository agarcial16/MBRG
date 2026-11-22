import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realFs, type FsOps } from '../io/fs-ops';

/** What `runImport` needs from its environment; tests pass a temporary root and a faulty file system. */
export interface ImportDeps {
  fs: FsOps;
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
    fs: realFs,
    root,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}

// Run only as a script, never when a test imports `runImport`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
