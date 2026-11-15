import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

/**
 * FR-123: the file operations the command needs, behind an interface so tests can inject write and
 * rename failures on a temporary directory. Every operation throws on failure.
 */
export interface FsOps {
  readFile(path: string): Uint8Array;
  writeFile(path: string, bytes: Uint8Array): void;
  /** Renames over the target when it exists. */
  rename(from: string, to: string): void;
  unlink(path: string): void;
  /** Creates the directory and its parents; no error when it exists. */
  mkdir(path: string): void;
}

/** The real implementation over node:fs (synchronous: the build is one short offline run). */
export const realFs: FsOps = {
  readFile: (path) => new Uint8Array(readFileSync(path)),
  writeFile: (path, bytes) => writeFileSync(path, bytes),
  rename: (from, to) => renameSync(from, to),
  unlink: (path) => unlinkSync(path),
  mkdir: (path) => {
    mkdirSync(path, { recursive: true });
  },
};
