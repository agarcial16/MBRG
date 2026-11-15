// Regenerates golden/protected-files.json (spec 011 NFR-74, FR-392: the sim package, the shared package with the map format and
// `MatchState`, the sim goldens, the dev map, the dev secrets and the 009 tour goldens are never edited by spec 011). A
// separate, reviewed, HAND-RUN step; the test never writes the golden. Run from the repository root:
//   npx tsx apps/server/test/golden/generate-protected-files.ts [ref]      (default ref: rewrite)
// It reads the files of `ref` with `git ls-tree` and `git show` (not the working tree) and writes the SHA-256 of each one, line
// endings normalised to LF for text files (the repository is `eol=lf`; a checkout on Windows must hash the same).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PROTECTED_ROOTS = [
  'packages/sim/src',
  'packages/shared/src',
  'packages/sim/test/golden',
  'maps/dev',
  'apps/server/test/golden/dev-secrets.json',
  'apps/web/test/golden/tours.json',
  'apps/web/test/golden/tour-frame-pins.json',
  'apps/web/test/golden/tour-frame-pins-debug.json',
] as const;

const ref = process.argv[2] ?? 'rewrite';
const git = (...args: string[]): Buffer => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
const commit = git('rev-parse', ref).toString('utf8').trim();
const names = git('ls-tree', '-r', '--name-only', commit, '--', ...PROTECTED_ROOTS).toString('utf8').split('\n').filter((n) => n !== '').sort();

const binary = (name: string): boolean => /\.(png|bin)$/.test(name);
const files: Record<string, string> = {};
for (const name of names) {
  const bytes = git('show', `${commit}:${name}`);
  const body = binary(name) ? bytes : Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  files[name] = createHash('sha256').update(body).digest('hex');
}
const out = {
  note: `SHA-256 of every file under the protected paths of spec 011 as they are at ${ref} (${commit}); text files with LF line endings. Written by generate-protected-files.ts.`,
  commit,
  roots: PROTECTED_ROOTS,
  count: names.length,
  files,
};
writeFileSync(fileURLToPath(new URL('./protected-files.json', import.meta.url)), `${JSON.stringify(out, null, 1)}\n`);
console.log(`written ${out.count} hashes of ${commit}`);
