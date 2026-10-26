import { describe, expect, it } from 'vitest';

// NFR-51 (server core): apps/server/src/core is pure: no I/O module, clock, randomness, crypto or global access, and it
// never imports clock.ts, secret.ts or any module outside the core except the workspace packages.
// FR-314: clock.ts is the only server source reading the system clock; secret.ts the only one drawing random bytes.

const core = import.meta.glob('../src/core/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const server = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const STRING_LITERAL = /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/;
const TOKENS = new RegExp(`(${STRING_LITERAL.source})|\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*$`, 'gm');
const stripComments = (src: string): string => src.replace(TOKENS, (_m, s: string | undefined) => s ?? '');
const codeOnly = (src: string): string => src.replace(TOKENS, (_m, s: string | undefined) => (s === undefined ? '' : '""'));

const ALLOWED_PACKAGES = new Set(['@mbrg/protocol', '@mbrg/shared', '@mbrg/sim']);
const SPECIFIERS = [
  /\b(?:import|export)\b[^;'"`()]*?\bfrom\s*(['"`])([^'"`]*)\1/g,
  /\bimport\s*(['"`])([^'"`]*)\1/g,
  /\bimport\s*\(\s*(['"`])([^'"`]*)\1/g,
];
/** Specifiers that are not `./x` (inside the core) and not an allowed workspace package, plus non-literal dynamic imports. */
function importViolations(src: string): string[] {
  const text = stripComments(src);
  const found: string[] = [];
  for (const re of SPECIFIERS) {
    for (const m of text.matchAll(re)) {
      const spec = m[2] as string;
      if ((!spec.startsWith('./') || spec.includes('..')) && !ALLOWED_PACKAGES.has(spec)) found.push(spec);
    }
  }
  for (const m of text.matchAll(/\bimport\s*\(\s*(?!['"`][^'"`]*['"`]\s*\))/g)) found.push(`dynamic import: ${m[0]}`);
  return found;
}

const FORBIDDEN: [string, RegExp][] = [
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['Date', /\bDate\b/],
  ['performance', /\bperformance\b/],
  ['hrtime', /\bhrtime\b/],
  ['crypto', /\bcrypto\b/],
  ['fetch', /\bfetch\b/],
  ['document', /\bdocument\b/],
  ['window', /\bwindow\b/],
  ['localStorage', /\blocalStorage\b/],
  ['process', /\bprocess\b/],
  ['require(', /\brequire\s*\(/],
  ['node: import', /\bnode:/],
  ['setTimeout', /\bsetTimeout\b/],
  ['setInterval', /\bsetInterval\b/],
  ['globalThis', /\bglobalThis\b/],
];
const violationsOf = (raw: string): string[] => [
  ...importViolations(raw).map((s) => `import ${s}`),
  ...FORBIDDEN.filter(([, re]) => re.test(codeOnly(raw))).map(([n]) => n),
];

// FR-314 patterns, over the whole server source.
const CLOCK_READS = /\bDate\b|\bperformance\b|\bhrtime\b|\bprocess\s*\.\s*uptime\b/;
const RANDOM_READS = /\bMath\s*\.\s*random\b|\bgetRandomValues\b|\brandomBytes\b|\brandomUUID\b|\brandomInt\b|\brandomFill(?:Sync)?\b/;
const readersOf = (files: Record<string, string>, re: RegExp): string[] =>
  Object.entries(files)
    .filter(([, raw]) => re.test(codeOnly(raw)))
    .map(([f]) => f.replace(/^.*\/src\//, ''))
    .sort();

describe('server core purity', () => {
  it('NFR-51 (server core) the scan sees the core sources', () => {
    const files = Object.keys(core);
    expect(files.some((f) => f.endsWith('/core/time.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('/core/view.ts'))).toBe(true);
  });

  it('NFR-51 (server core) planted violations are caught and comments and strings are not', () => {
    for (const [code, name] of [
      ['const t = Date.now();', 'Date'],
      ['const r = Math.random();', 'Math.random'],
      ["import { readFileSync } from 'node:fs';", 'import node:fs'],
      ["import { systemClock } from '../clock';", 'import ../clock'],
      ["import { newSecret } from '../secret';", 'import ../secret'],
      ["import { roundSeed } from './../secret';", 'import ./../secret'],
      ["const m = await import('node:fs');", 'import node:fs'],
      ['const h = crypto.subtle;', 'crypto'],
      ['const p = process.env;', 'process'],
      ['const g = globalThis;', 'globalThis'],
      ['const n = performance.now();', 'performance'],
    ] as const) {
      expect(violationsOf(code), code).toContain(name);
    }
    expect(violationsOf("import { a } from './time';\nimport type { B } from '@mbrg/protocol';\n// Date.now()\nconst s = 'process';")).toStrictEqual([]);
  });

  it('NFR-51 (server core) apps/server/src/core uses no I/O, clock, randomness or crypto and imports only the core and workspace packages', () => {
    const violations: string[] = [];
    for (const [file, raw] of Object.entries(core)) {
      for (const v of violationsOf(raw)) violations.push(`${file}: ${v}`);
    }
    expect(violations).toStrictEqual([]);
  });

  it('FR-314 clock.ts is the only server source reading the system clock', () => {
    expect(readersOf(server, CLOCK_READS)).toStrictEqual(['clock.ts']);
  });

  it('FR-314 secret.ts is the only server source drawing random bytes', () => {
    expect(readersOf(server, RANDOM_READS)).toStrictEqual(['secret.ts']);
  });

  it('FR-314 the source scan catches planted clock and random reads and ignores comments', () => {
    const planted = { '../src/a.ts': 'const t = Date.now();', '../src/b.ts': '// Date.now()\nconst s = "Math.random";', '../src/c.ts': 'const r = crypto.randomUUID();' };
    expect(readersOf(planted, CLOCK_READS)).toStrictEqual(['a.ts']);
    expect(readersOf(planted, RANDOM_READS)).toStrictEqual(['c.ts']);
    expect(readersOf({ '../src/d.ts': 'const x = Math.random();', '../src/e.ts': 'performance.now()' }, RANDOM_READS)).toStrictEqual(['d.ts']);
    expect(readersOf({ '../src/e.ts': 'performance.now()' }, CLOCK_READS)).toStrictEqual(['e.ts']);
  });
});
