import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The pins of the files spec 011 does not edit (golden/protected-files.json, taken from `rewrite` by the hand-run generator)
// and the working tree's side of the comparison: the SHA-256 of a file (text with LF endings) and the files present under the
// pinned roots.

export interface Pins {
  readonly commit: string;
  readonly roots: readonly string[];
  readonly count: number;
  readonly files: Readonly<Record<string, string>>;
}
export const PINS = JSON.parse(readFileSync(new URL('../golden/protected-files.json', import.meta.url), 'utf8')) as Pins;
export const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const binary = (name: string): boolean => /\.(png|bin)$/.test(name);
export const hashOf = (name: string): string => {
  const bytes = readFileSync(join(ROOT, name));
  const body = binary(name) ? bytes : Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return createHash('sha256').update(body).digest('hex');
};
const listFiles = (path: string): string[] => {
  const full = join(ROOT, path);
  if (statSync(full).isFile()) return [path];
  return readdirSync(full).flatMap((entry) => listFiles(`${path}/${entry}`));
};
/** Every file under the pinned roots, as a repository path, sorted. */
export const presentFiles = (): string[] => PINS.roots.flatMap((root) => listFiles(root)).map((p) => relative(ROOT, join(ROOT, p)).split(sep).join('/')).sort();
