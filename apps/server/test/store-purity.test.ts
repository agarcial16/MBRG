import { describe, expect, it } from 'vitest';

// FR-291: `node:sqlite` is imported only under apps/server/src/store/; the pure core (apps/server/src/core) and the
// protocol package never import the store or the service. The fault seam has no production reachability.

const server = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const protocol = import.meta.glob('../../../packages/protocol/src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const STRING_LITERAL = /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/;
const TOKENS = new RegExp(`(${STRING_LITERAL.source})|\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*$`, 'gm');
const stripComments = (src: string): string => src.replace(TOKENS, (_m, s: string | undefined) => s ?? '');

const SPECIFIERS = [
  /\b(?:import|export)\b[^;'"`()]*?\bfrom\s*(['"`])([^'"`]*)\1/g,
  /\bimport\s*(['"`])([^'"`]*)\1/g,
  /\bimport\s*\(\s*(['"`])([^'"`]*)\1/g,
];
const specifiersOf = (src: string): string[] => {
  const text = stripComments(src);
  return SPECIFIERS.flatMap((re) => [...text.matchAll(re)].map((m) => m[2] as string));
};
const shortName = (file: string): string => file.replace(/^.*\/src\//, '');

const sqliteImporters = (files: Record<string, string>): string[] =>
  Object.entries(files)
    .filter(([, raw]) => specifiersOf(raw).some((s) => s === 'node:sqlite' || s === 'sqlite'))
    .map(([f]) => shortName(f))
    .sort();

const STORE_OR_SERVICE = /(^|\/)(store|service)(\/|$)/;
/** Files whose imports reach the store or the service (a path segment `store` or `service`, or a store file name). */
const reachersOf = (files: Record<string, string>): string[] =>
  Object.entries(files)
    .filter(([, raw]) => specifiersOf(raw).some((s) => STORE_OR_SERVICE.test(s) || /(^|\/)(sqlite|faults|schema)$/.test(s)))
    .map(([f]) => shortName(f))
    .sort();

/** Files outside the store directory that import the fault seam. */
const faultImporters = (files: Record<string, string>): string[] =>
  Object.entries(files)
    .filter(([f]) => !/\/src\/store\//.test(f))
    .filter(([, raw]) => specifiersOf(raw).some((s) => /(^|\/)faults$/.test(s)))
    .map(([f]) => shortName(f))
    .sort();

const core = Object.fromEntries(Object.entries(server).filter(([f]) => /\/src\/core\//.test(f)));

describe('store purity and boundaries', () => {
  it('FR-291 the scan sees the store and the core sources', () => {
    const names = Object.keys(server).map(shortName);
    for (const expectedFile of ['store/store.ts', 'store/sqlite.ts', 'store/schema.ts', 'store/faults.ts', 'core/time.ts']) {
      expect(names, expectedFile).toContain(expectedFile);
    }
    expect(Object.keys(protocol).length).toBeGreaterThan(3);
  });

  it('FR-291 node:sqlite is imported only under src/store', () => {
    for (const file of sqliteImporters(server)) expect(file.startsWith('store/'), file).toBe(true);
    expect(sqliteImporters(server)).toContain('store/sqlite.ts');
  });

  it('FR-291 the scan catches planted sqlite and store imports and ignores comments and strings', () => {
    const planted = {
      '../src/core/a.ts': "import { DatabaseSync } from 'node:sqlite';",
      '../src/core/b.ts': "import { openStore } from '../store/sqlite';",
      '../src/core/c.ts': "const m = await import('../service/matches');",
      '../src/core/d.ts': "// import 'node:sqlite'\nconst s = \"from '../store/store'\";",
      '../src/http/e.ts': "import { withFaults } from '../store/faults';",
      '../src/store/f.ts': "import { withFaults } from './faults';",
    };
    expect(sqliteImporters(planted)).toStrictEqual(['core/a.ts']);
    expect(reachersOf(planted)).toStrictEqual(['core/b.ts', 'core/c.ts', 'http/e.ts', 'store/f.ts']);
    expect(faultImporters(planted)).toStrictEqual(['http/e.ts']);
  });

  it('FR-291 apps/server/src/core and packages/protocol/src import neither the store nor the service', () => {
    expect(reachersOf(core)).toStrictEqual([]);
    expect(reachersOf(protocol)).toStrictEqual([]);
    expect(sqliteImporters(protocol)).toStrictEqual([]);
  });

  it('FR-291 the fault seam is imported by nothing outside the store directory', () => {
    expect(faultImporters(server)).toStrictEqual([]);
  });
});
