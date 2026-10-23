import { describe, expect, it } from 'vitest';

// Purity of the HTTP decision modules (plan PD15, M3a rules): `http/{limits,identity,cors,status}.ts` take the clock
// reading and the settings as parameters; they import no platform module, read no clock, arm no timer and draw no random
// value. Only the other HTTP files (log, body, router, respond, server, shutdown, as plan 18.1 lists them) and main.ts
// may touch the platform; `node:http` is imported nowhere else. FR-299 (d): the limiter keeps its state in memory only.

const server = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** The pure decision modules of plan 18.1 (each marked "pure"). */
const PURE = ['http/cors.ts', 'http/identity.ts', 'http/limits.ts', 'http/status.ts'];
/** The other HTTP files plan 18.1 lists (later tasks); they may use the platform. */
const PLATFORM = ['http/body.ts', 'http/log.ts', 'http/respond.ts', 'http/router.ts', 'http/server.ts', 'http/shutdown.ts'];
/** What a pure module may import: the other pure modules, the digest helpers, the settings types and the protocol. */
const ALLOWED_IMPORTS = new Set(['./cors', './identity', './limits', './status', '../service/ids', '../service/settings', '@mbrg/protocol']);

const STRING_LITERAL = /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/;
const TOKENS = new RegExp(`(${STRING_LITERAL.source})|\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*$`, 'gm');
const stripComments = (src: string): string => src.replace(TOKENS, (_m, s: string | undefined) => s ?? '');
const codeOnly = (src: string): string => src.replace(TOKENS, (_m, s: string | undefined) => (s === undefined ? '' : '""'));
const shortName = (file: string): string => file.replace(/^.*\/src\//, '');

const SPECIFIERS = [
  /\b(?:import|export)\b[^;'"`()]*?\bfrom\s*(['"`])([^'"`]*)\1/g,
  /\bimport\s*(['"`])([^'"`]*)\1/g,
  /\bimport\s*\(\s*(['"`])([^'"`]*)\1/g,
];
const specifiersOf = (src: string): string[] => {
  const text = stripComments(src);
  return SPECIFIERS.flatMap((re) => [...text.matchAll(re)].map((m) => m[2] as string));
};

const FORBIDDEN: [string, RegExp][] = [
  ['Date', /\bDate\b/],
  ['performance', /\bperformance\b/],
  ['hrtime', /\bhrtime\b/],
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['crypto', /\bcrypto\b/],
  ['setTimeout', /\bsetTimeout\b/],
  ['setInterval', /\bsetInterval\b/],
  ['setImmediate', /\bsetImmediate\b/],
  ['queueMicrotask', /\bqueueMicrotask\b/],
  ['process', /\bprocess\b/],
  ['globalThis', /\bglobalThis\b/],
  ['require(', /\brequire\s*\(/],
  ['fetch', /\bfetch\b/],
  ['node:', /\bnode:/],
];

function violationsOf(raw: string): string[] {
  const found = specifiersOf(raw)
    .filter((s) => !ALLOWED_IMPORTS.has(s))
    .map((s) => `import ${s}`);
  for (const m of stripComments(raw).matchAll(/\bimport\s*\(\s*(?!['"`][^'"`]*['"`]\s*\))/g)) found.push(`dynamic import: ${m[0]}`);
  return [...found, ...FORBIDDEN.filter(([, re]) => re.test(codeOnly(raw))).map(([n]) => n)];
}

const httpImporters = (files: Record<string, string>): string[] =>
  Object.entries(files)
    .filter(([, raw]) => specifiersOf(raw).some((s) => s === 'node:http' || s === 'http' || s === 'node:https' || s === 'node:net'))
    .map(([f]) => shortName(f))
    .sort();

describe('http purity', () => {
  it('NFR-51 (http modules) the scan sees the four pure http modules', () => {
    const names = Object.keys(server).map(shortName);
    for (const file of PURE) expect(names, file).toContain(file);
  });

  it('NFR-51 (http modules) the platform files exist as the tasks deliver them (shutdown.ts is delivered by T4’ and tolerated until then)', () => {
    const names = Object.keys(server).map(shortName);
    for (const file of PLATFORM.filter((f) => f !== 'http/shutdown.ts')) expect(names, file).toContain(file);
    // T4' removes this exception: then all six platform files must exist.
  });

  it('NFR-51 (http modules) every file under src/http is classified: one of the pure modules or a platform file of plan 18.1', () => {
    const http = Object.keys(server).map(shortName).filter((f) => f.startsWith('http/'));
    for (const file of http) expect([...PURE, ...PLATFORM], file).toContain(file);
  });

  it('NFR-51 (http modules) the purity scan catches planted violations and ignores comments and strings', () => {
    for (const [code, name] of [
      ['const t = Date.now();', 'Date'],
      ['const r = Math.random();', 'Math.random'],
      ["import { createServer } from 'node:http';", 'import node:http'],
      ["import { readFileSync } from 'node:fs';", 'import node:fs'],
      ["import { systemClock } from '../clock';", 'import ../clock'],
      ["import { openStore } from '../store/sqlite';", 'import ../store/sqlite'],
      ["import { createMatchService } from '../service/matches';", 'import ../service/matches'],
      ["const m = await import('node:crypto');", 'import node:crypto'],
      ['const id = setTimeout(f, 1);', 'setTimeout'],
      ['const id = setInterval(f, 1);', 'setInterval'],
      ['setImmediate(f);', 'setImmediate'],
      ['const n = performance.now();', 'performance'],
      ['const h = crypto.randomUUID();', 'crypto'],
      ['const p = process.hrtime();', 'process'],
      ['const g = globalThis;', 'globalThis'],
      ['const s = "x" + node:fs;', 'node:'],
    ] as const) {
      expect(violationsOf(code), code).toContain(name);
    }
    expect(
      violationsOf("import { a } from './limits';\nimport type { B } from '@mbrg/protocol';\nimport { sameDigest } from '../service/ids';\n// Date.now() setTimeout\nconst s = 'process';"),
    ).toStrictEqual([]);
  });

  it('NFR-51 (http modules) FR-299 (d) http/{limits,identity,cors,status}.ts read no clock, arm no timer, draw nothing random and import no platform module', () => {
    const violations: string[] = [];
    for (const [file, raw] of Object.entries(server)) {
      if (!PURE.includes(shortName(file))) continue;
      for (const v of violationsOf(raw)) violations.push(`${shortName(file)}: ${v}`);
    }
    expect(violations).toStrictEqual([]);
  });

  it('NFR-51 (http modules) node:http and node:net are imported only by the platform files of src/http and by main.ts', () => {
    for (const file of httpImporters(server)) expect([...PLATFORM, 'main.ts'], file).toContain(file);
    const planted = {
      '../src/http/limits.ts': "import { createServer } from 'node:http';",
      '../src/http/server.ts': "import { createServer } from 'node:http';",
      '../src/service/x.ts': "import * as net from 'node:net';",
      '../src/main.ts': "// import 'node:http'\nconst s = \"from 'node:http'\";",
    };
    expect(httpImporters(planted)).toStrictEqual(['http/limits.ts', 'http/server.ts', 'service/x.ts']);
  });
});
