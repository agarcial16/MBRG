import { describe, expect, it } from 'vitest';

// NFR-51 (protocol): the protocol package is pure: no I/O module, clock, randomness, crypto or global access.
const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const STRING_LITERAL = /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/;
const TOKENS = new RegExp(`(${STRING_LITERAL.source})|\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*$`, 'gm');
const stripComments = (src: string): string => src.replace(TOKENS, (_m, s: string | undefined) => s ?? '');
const codeOnly = (src: string): string => src.replace(TOKENS, (_m, s: string | undefined) => (s === undefined ? '' : '""'));

const ALLOWED_PACKAGES = new Set(['@mbrg/shared', '@mbrg/sim']);
const SPECIFIERS = [
  /\b(?:import|export)\b[^;'"`()]*?\bfrom\s*(['"`])([^'"`]*)\1/g,
  /\bimport\s*(['"`])([^'"`]*)\1/g,
  /\bimport\s*\(\s*(['"`])([^'"`]*)\1/g,
];
/** Specifiers that are not relative and not an allowed workspace package, plus non-literal dynamic imports. */
function importViolations(src: string): string[] {
  const text = stripComments(src);
  const found: string[] = [];
  for (const re of SPECIFIERS) {
    for (const m of text.matchAll(re)) {
      const spec = m[2] as string;
      if (!spec.startsWith('./') && !spec.startsWith('../') && !ALLOWED_PACKAGES.has(spec)) found.push(spec);
    }
  }
  for (const m of text.matchAll(/\bimport\s*\(\s*(?!['"`][^'"`]*['"`]\s*\))/g)) found.push(`dynamic import: ${m[0]}`);
  return found;
}

const FORBIDDEN: [string, RegExp][] = [
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['Date', /\bDate\b/],
  ['performance', /\bperformance\b/],
  ['crypto', /\bcrypto\b/],
  ['fetch', /\bfetch\b/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
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

describe('protocol purity', () => {
  it('NFR-51 (protocol) the scan sees the protocol sources', () => {
    const files = Object.keys(sources);
    expect(files.some((f) => f.endsWith('/src/errors.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('/src/index.ts'))).toBe(true);
  });

  it('FR-384 the name module is scanned and uses no locale-dependent call', () => {
    const entry = Object.entries(sources).find(([f]) => f.endsWith('/src/names.ts'));
    expect(entry).toBeDefined();
    expect(codeOnly(entry?.[1] ?? '')).not.toMatch(/toLocale|localeCompare|Intl\b/);
  });

  it('NFR-51 (protocol) planted violations are caught and comments and strings are not', () => {
    for (const [code, name] of [
      ['const t = Date.now();', 'Date'],
      ['const r = Math.random();', 'Math.random'],
      ["import { readFileSync } from 'node:fs';", 'import node:fs'],
      ["import { createHash } from 'crypto';", 'import crypto'],
      ["const m = await import('node:fs');", 'import node:fs'],
      ['const h = crypto.subtle;', 'crypto'],
      ['const p = process.env;', 'process'],
      ['const g = globalThis;', 'globalThis'],
    ] as const) {
      expect(violationsOf(code), code).toContain(name);
    }
    expect(violationsOf("import { a } from './ids';\nimport type { B } from '@mbrg/shared';\n// Date.now()\nconst s = 'process';")).toStrictEqual([]);
  });

  it('NFR-51 (protocol) packages/protocol/src uses no I/O, clock, randomness or crypto and imports only workspace packages', () => {
    const violations: string[] = [];
    for (const [file, raw] of Object.entries(sources)) for (const v of violationsOf(raw)) violations.push(`${file}: ${v}`);
    expect(violations).toStrictEqual([]);
  });
});
