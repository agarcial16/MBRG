import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateMap } from '@mbrg/shared';
import { getRounds, getState, totalRounds } from '../src/index';
import { gridMap } from './helpers/maps';

const sources = {
  ...import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../shared/src/**/*.ts', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;

const STRING_LITERAL = /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/;
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/.*$/;
// One pass: a string literal is matched before a comment can start inside it, so `'a//b'` stays intact.
const TOKENS = new RegExp(`(${STRING_LITERAL.source})|${COMMENT.source}`, 'gm');

/** Removes real comments only; string literals (and any `//` inside them) are kept. */
function stripComments(src: string): string {
  return src.replace(TOKENS, (_m, str: string | undefined) => str ?? '');
}

/** Removes comments and string literals so the scan sees code only. */
export function codeOnly(src: string): string {
  return src.replace(TOKENS, (_m, str: string | undefined) => (str === undefined ? '' : '""'));
}

const FORBIDDEN_MODULES = new Set([
  'fs', 'path', 'http', 'https', 'http2', 'child_process', 'os', 'net', 'tls', 'dgram', 'dns', 'cluster',
  'crypto', 'worker_threads', 'vm', 'stream', 'zlib', 'readline', 'perf_hooks', 'process', 'timers', 'url',
]);
const isForbiddenModule = (spec: string): boolean => {
  const bare = spec.replace(/^node:/, '');
  return spec.startsWith('node:') || FORBIDDEN_MODULES.has(bare.split('/')[0] as string);
};
const IMPORT_SPECIFIERS = [
  /\b(?:import|export)\b[^;'"`()]*?\bfrom\s*(['"`])([^'"`]*)\1/g, // static import / export ... from
  /\bimport\s*(['"`])([^'"`]*)\1/g, // side-effect import
  /\bimport\s*\(\s*(['"`])([^'"`]*)\1/g, // dynamic import with a literal
];

/** Import specifiers naming I/O modules, or dynamic imports that are not a plain literal. Run before strings are stripped. */
export function importViolations(src: string): string[] {
  const text = stripComments(src);
  const found: string[] = [];
  for (const re of IMPORT_SPECIFIERS) {
    for (const m of text.matchAll(re)) if (isForbiddenModule(m[2] as string)) found.push(m[2] as string);
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('NFR-1 purity', () => {
  it('NFR-1 FR-52 validation and a full match run with clock and randomness throwing', () => {
    const boom = () => {
      throw new Error('impure access');
    };
    vi.spyOn(Math, 'random').mockImplementation(boom);
    vi.spyOn(Date, 'now').mockImplementation(boom);
    vi.stubGlobal('performance', { now: boom });
    vi.stubGlobal('crypto', { getRandomValues: boom, randomUUID: boom });

    const map = gridMap(5, 5);
    expect(validateMap(map).ok).toBe(true);
    const t = totalRounds(map);
    expect(t.ok && t.value).toBe(24);
    const r = getRounds(map, 99, 24);
    const s = getState(map, 99, 24);
    expect(r.ok && s.ok).toBe(true);
  });

  it('NFR-1 the source scan covers shared and sim sources', () => {
    const files = Object.keys(sources);
    expect(files.some((f) => f.endsWith('/shared/src/validate.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('/src/match.ts') && !f.includes('shared'))).toBe(true);
    expect(files.length).toBeGreaterThanOrEqual(12);
  });

  it('NFR-1 the scan strips comments and strings but catches real code', () => {
    expect(FORBIDDEN.some(([, re]) => re.test(codeOnly('const x = Math.random();')))).toBe(true);
    expect(FORBIDDEN.some(([, re]) => re.test(codeOnly('// Date.now()\nconst s = "process";')))).toBe(false);
  });

  it('NFR-1 the scan catches I/O module imports before strings are stripped', () => {
    for (const code of [
      "import x from 'node:fs';",
      "import x from 'fs';",
      "import 'fs';",
      "import 'node:fs';",
      "import 'fs'; // side effect",
      "import x from 'node:fs'; // a // b",
      "import { y } from \"path\";",
      "export * from 'node:os';",
      "const m = import('node:fs');",
      "const m = await import('fs');",
    ]) {
      expect(importViolations(code).length, code).toBeGreaterThan(0);
    }
    // `//` inside a specifier is not a comment: the import after it must still be seen.
    expect(importViolations("import a from 'https://x.test/a'; import b from 'fs';")).toContain('fs');
    expect(importViolations("import a from './a//b';\nimport 'fs';")).toContain('fs');
    expect(importViolations("import { a } from './ids';\nimport type { B } from '@mbrg/shared';")).toStrictEqual([]);
  });

  it('NFR-1 shared/src and sim/src reference no I/O, DOM, clock or randomness API', () => {
    const violations: string[] = [];
    for (const [file, raw] of Object.entries(sources)) {
      for (const spec of importViolations(raw)) violations.push(`${file}: import ${spec}`);
      const code = codeOnly(raw);
      for (const [name, re] of FORBIDDEN) if (re.test(code)) violations.push(`${file}: ${name}`);
    }
    expect(violations).toStrictEqual([]);
  });
});
