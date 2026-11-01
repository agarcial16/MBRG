import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The files spec 011 must never edit (tasks.md rule): the sim and shared sources (the map format and `MatchState` live there),
// the sim goldens, the dev map, the dev secrets and the 009 tour goldens. The pins are the SHA-256 of each file at `rewrite`
// before the spec (golden/protected-files.json, taken by the hand-run generator from `git show`, not from the working tree).
// The same check as `git diff --exit-code rewrite -- <paths>`, as a test that also runs in CI with no branch to diff against.

interface Pins {
  readonly commit: string;
  readonly roots: readonly string[];
  readonly count: number;
  readonly files: Readonly<Record<string, string>>;
}
const PINS = JSON.parse(readFileSync(new URL('./golden/protected-files.json', import.meta.url), 'utf8')) as Pins;
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const binary = (name: string): boolean => /\.(png|bin)$/.test(name);
const hashOf = (name: string): string => {
  const bytes = readFileSync(join(ROOT, name));
  const body = binary(name) ? bytes : Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return createHash('sha256').update(body).digest('hex');
};
const listFiles = (path: string): string[] => {
  const full = join(ROOT, path);
  if (statSync(full).isFile()) return [path];
  return readdirSync(full).flatMap((entry) => listFiles(`${path}/${entry}`));
};
const present = PINS.roots.flatMap((root) => listFiles(root)).map((p) => relative(ROOT, join(ROOT, p)).split(sep).join('/')).sort();

describe('the files spec 011 does not edit', () => {
  it('FR-392 (protected files) the pins cover the sim and shared sources, the sim goldens, the dev map, the dev secrets and the tour goldens', () => {
    expect(PINS.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(PINS.count).toBe(Object.keys(PINS.files).length);
    for (const dir of ['packages/sim/src/', 'packages/shared/src/', 'packages/sim/test/golden/', 'maps/dev/']) {
      expect(Object.keys(PINS.files).filter((f) => f.startsWith(dir)).length, dir).toBeGreaterThan(0);
    }
    for (const file of ['apps/server/test/golden/dev-secrets.json', 'apps/web/test/golden/tours.json', 'apps/web/test/golden/tour-frame-pins.json']) {
      expect(PINS.files[file], file).toMatch(/^[0-9a-f]{64}$/);
    }
    // The map format and `MatchState`: the shared validation and the sim types are inside the pinned folders.
    expect(Object.keys(PINS.files).some((f) => f.startsWith('packages/shared/src/') && f.endsWith('validate.ts'))).toBe(true);
    expect(Object.keys(PINS.files).some((f) => f.startsWith('packages/sim/src/') && f.endsWith('index.ts'))).toBe(true);
  });

  it('FR-392 (protected files) no file of the protected paths was edited, added or removed: every SHA-256 equals the one at rewrite', () => {
    expect(present).toStrictEqual(Object.keys(PINS.files).sort());
    const changed = present.filter((name) => hashOf(name) !== PINS.files[name]);
    expect(changed).toStrictEqual([]);
  });

  it('FR-392 (protected files) a file with one byte changed is seen: the hash of a sim source differs from the same text with one more character', () => {
    const name = Object.keys(PINS.files).find((f) => f.startsWith('packages/sim/src/') && f.endsWith('.ts'))!;
    const text = readFileSync(join(ROOT, name), 'utf8');
    expect(createHash('sha256').update(Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8')).digest('hex')).toBe(PINS.files[name]);
    expect(createHash('sha256').update(Buffer.from(`${text.replace(/\r\n/g, '\n')} `, 'utf8')).digest('hex')).not.toBe(PINS.files[name]);
  });
});
