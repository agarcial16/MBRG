import * as zlib from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { buildInMemory } from '../src/core/build';
import { pngCodec } from '../src/io/png-codec';
import { miniInputs } from './helpers/fixtures';
import { ZLIB_EXEMPT, codeOnly, scanSource } from './helpers/scan';

describe('NFR-14 the in-memory build is deterministic and touches no clock or randomness', () => {
  it('NFR-14 and NFR-23 the in-memory build with the real PNG library runs while clock and randomness throw', () => {
    const boom = (name: string) => () => {
      throw new Error(`${name} was called during the build`);
    };
    const RealDate = Date;
    class ThrowingDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) throw new Error('new Date() was called during the build');
        super(...(args as [number]));
      }
      static override now(): number {
        throw new Error('Date.now was called during the build');
      }
    }
    const spies = [
      vi.spyOn(Math, 'random').mockImplementation(boom('Math.random')),
      vi.spyOn(performance, 'now').mockImplementation(boom('performance.now')),
      vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(boom('crypto.getRandomValues')),
      vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(boom('crypto.randomUUID')),
      vi.spyOn(process, 'hrtime').mockImplementation(boom('process.hrtime')),
    ];
    vi.stubGlobal('Date', ThrowingDate);
    let first: ReturnType<typeof buildInMemory>;
    let second: ReturnType<typeof buildInMemory>;
    try {
      // The guards really throw while installed.
      expect(() => Math.random()).toThrow();
      expect(() => Date.now()).toThrow();
      expect(() => new Date()).toThrow();
      expect(() => performance.now()).toThrow();
      for (const spy of spies) spy.mockClear();
      first = buildInMemory(miniInputs(), pngCodec);
      second = buildInMemory(miniInputs(), pngCodec);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      for (const spy of spies) spy.mockRestore();
    }
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(Buffer.from(first.files.image).equals(Buffer.from(second.files.image))).toBe(true);
      expect(Buffer.from(first.files.map).equals(Buffer.from(second.files.map))).toBe(true);
    }
  });
});

const coreSources = {
  ...import.meta.glob('../src/core/**/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../src/extract/extract.ts', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;

describe('NFR-14 the source scan of the builder core', () => {
  it('NFR-14 the scan covers the core sources and not the io adapters', () => {
    const files = Object.keys(coreSources);
    expect(files.length).toBeGreaterThanOrEqual(15);
    expect(files.some((f) => f.endsWith('/core/png-check.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('/core/build.ts'))).toBe(true);
    expect(files.some((f) => f.includes('/io/') || f.includes('/cli/'))).toBe(false);
  });

  it('NFR-14 the scan covers the pure extraction step and not its shapefile adapter', () => {
    const files = Object.keys(coreSources);
    expect(files.filter((f) => f.includes('/extract/'))).toStrictEqual(['../src/extract/extract.ts']);
    // the adapter really is outside the pure scan: it imports the file-capable library
    expect(scanSource("import * as shapefile from 'shapefile';").length).toBeGreaterThan(0);
  });

  it('NFR-14 the core uses no I/O, clock, randomness, network or other built-in module', () => {
    const violations: string[] = [];
    for (const [file, src] of Object.entries(coreSources)) {
      for (const v of scanSource(src)) violations.push(`${file}: ${v}`);
    }
    expect(violations).toStrictEqual([]);
  });

  it('NFR-14 the exemption list is exactly the two node:zlib functions deflateSync and inflateSync', () => {
    expect([...ZLIB_EXEMPT].sort()).toStrictEqual(['deflateSync', 'inflateSync']);
    for (const name of ZLIB_EXEMPT) {
      expect(scanSource(`import { ${name} } from 'node:zlib';\nexport const f = ${name};`)).toStrictEqual([]);
    }
    expect(scanSource("import { deflateSync, inflateSync } from 'node:zlib';")).toStrictEqual([]);
    // NFR-14 names node:zlib: the bare specifier is not exempt.
    expect(scanSource("import { inflateSync } from 'zlib';").length).toBeGreaterThan(0);
    // Every other synchronous function of node:zlib is flagged.
    const others = Object.keys(zlib).filter(
      (k) => typeof (zlib as Record<string, unknown>)[k] === 'function' && !ZLIB_EXEMPT.includes(k),
    );
    expect(others).toContain('gzipSync');
    expect(others.length).toBeGreaterThanOrEqual(10);
    for (const name of others) {
      expect(scanSource(`import { ${name} } from 'node:zlib';`).length, name).toBeGreaterThan(0);
    }
  });

  it('NFR-14 planted node:fs, other zlib functions and other imports are flagged', () => {
    const planted: Record<string, string> = {
      'node:fs named': "import { readFileSync } from 'node:fs';",
      'node:fs default': "import fs from 'node:fs';",
      'fs bare': "import { readFileSync } from 'fs';",
      'node:fs side effect': "import 'node:fs';",
      'node:fs re-export': "export * from 'node:fs';",
      'node:path': "import { join } from 'node:path';",
      'node:crypto': "import { randomBytes } from 'node:crypto';",
      'gzipSync': "import { gzipSync } from 'node:zlib';",
      'exempt plus another': "import { inflateSync, gzipSync } from 'node:zlib';",
      'zlib namespace': "import * as z from 'node:zlib';",
      'zlib default': "import zlib from 'node:zlib';",
      'zlib side effect': "import 'node:zlib';",
      'zlib re-export': "export { gzipSync } from 'node:zlib';",
      'require': "const fs = require('node:fs');",
      'dynamic import literal': "const m = await import('node:fs');",
      'dynamic import computed': 'const m = await import(name);',
      'pngjs import': "import { PNG } from 'pngjs';",
      'shapefile import': "import * as shapefile from 'shapefile';",
      'Date.now': 'export const t = Date.now();',
      'new Date': 'export const t = new Date();',
      'Math.random': 'export const r = Math.random();',
      'performance': 'export const t = performance.now();',
      'fetch': "export const r = fetch('x');",
      'process': 'export const e = process.env;',
    };
    for (const [name, src] of Object.entries(planted)) {
      expect(scanSource(src).length, name).toBeGreaterThan(0);
    }
  });

  it('NFR-14 the scan ignores comments and strings and accepts relative and shared imports', () => {
    const clean = [
      "import { a } from './a';",
      "import type { B } from '../b';",
      "import { validateMap } from '@mbrg/shared';",
      "// import fs from 'node:fs'; Date.now() Math.random()",
      '/* require("fs") */',
      "export const s = 'Date.now() and import(\"fs\")';",
    ].join('\n');
    expect(scanSource(clean)).toStrictEqual([]);
    expect(codeOnly("const x = 'Date';")).not.toMatch(/Date/);
    // A // inside a specifier is not a comment: the import after it is still seen.
    expect(scanSource("import a from './a//b';\nimport 'fs';").length).toBeGreaterThan(0);
  });
});
