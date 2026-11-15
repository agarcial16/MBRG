import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

function readJson(...parts: string[]): any {
  return JSON.parse(readFileSync(join(repo, ...parts), 'utf8'));
}

const APPROVED = ['@types/node', '@types/pngjs', 'pngjs', 'shapefile', 'tsx'];
const DEV_ONLY = ['@types/node', '@types/pngjs', 'tsx'];
const ALLOWED_LICENCES = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'Unlicense', 'CC0-1.0'];
const EXACT = /^\d+\.\d+\.\d+$/;

const manifest = readJson('tools', 'build-map', 'package.json');
const lock = readJson('package-lock.json');

function thirdParty(deps: Record<string, string> | undefined): string[] {
  return Object.keys(deps ?? {}).filter((n) => !n.startsWith('@mbrg/'));
}

/** Specifiers a source imports, requires or dynamically imports. */
export function importedSpecifiers(src: string): string[] {
  const out: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"`])([^'"`]+)\1/g;
  for (const m of src.matchAll(re)) out.push(m[2]!);
  return out;
}

function importsLibrary(src: string): boolean {
  return importedSpecifiers(src).some((s) => APPROVED.some((a) => s === a || s.startsWith(`${a}/`)));
}

const packageSources = import.meta.glob(
  ['../../../packages/*/src/**/*.ts', '../../../apps/*/src/**/*.ts'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const builderSources = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('NFR-20 libraries', () => {
  it('NFR-20 the builder dependencies are exactly the approved list', () => {
    const all = [...thirdParty(manifest.dependencies), ...thirdParty(manifest.devDependencies)];
    expect([...all].sort()).toStrictEqual([...APPROVED].sort());
  });

  it('NFR-20 each approved library is pinned to an exact version equal to the lockfile', () => {
    const declared = { ...manifest.dependencies, ...manifest.devDependencies } as Record<string, string>;
    for (const name of APPROVED) {
      expect(declared[name], name).toMatch(EXACT);
      expect(lock.packages[`tools/build-map/node_modules/${name}`]?.version ?? lock.packages[`node_modules/${name}`]?.version, name).toBe(declared[name]);
    }
    expect(declared['pngjs']).toBe('7.0.0');
    expect(declared['shapefile']).toBe('0.6.6');
  });

  it('NFR-20 the launcher and the type declarations are development dependencies only', () => {
    for (const name of DEV_ONLY) {
      expect(manifest.devDependencies?.[name], name).toBeDefined();
      expect(manifest.dependencies?.[name], name).toBeUndefined();
    }
    expect(manifest.dependencies?.['pngjs']).toBeDefined();
    expect(manifest.dependencies?.['shapefile']).toBeDefined();
    expect(manifest.devDependencies?.['shapefile']).toBeUndefined();
  });

  it('NFR-20 no type declaration package for shapefile is declared or installed (own minimal declaration)', () => {
    const declared = { ...manifest.dependencies, ...manifest.devDependencies } as Record<string, string>;
    expect(Object.keys(declared)).not.toContain('@types/shapefile');
    expect(existsSync(join(repo, 'node_modules', '@types', 'shapefile'))).toBe(false);
    expect(existsSync(join(repo, 'tools', 'build-map', 'src', 'extract', 'shapefile.d.ts'))).toBe(true);
  });

  it('NFR-20 every package installed for shapefile, transitive ones included, has a licence in the allowed list', () => {
    const seen = new Set<string>();
    const walk = (name: string): void => {
      if (seen.has(name)) return;
      seen.add(name);
      const file = [join(repo, 'tools', 'build-map', 'node_modules', name), join(repo, 'node_modules', name)]
        .map((d) => join(d, 'package.json'))
        .find((p) => existsSync(p));
      expect(file, `${name} is installed`).toBeDefined();
      const pkg = JSON.parse(readFileSync(file!, 'utf8'));
      expect(ALLOWED_LICENCES, `${name}: ${String(pkg.license)}`).toContain(pkg.license);
      for (const dep of Object.keys(pkg.dependencies ?? {})) walk(dep);
    };
    walk('shapefile');
    expect([...seen].sort()).toStrictEqual([
      'array-source',
      'commander',
      'file-source',
      'path-source',
      'shapefile',
      'slice-source',
      'stream-source',
      'text-encoding',
    ]);
  });

  it('NFR-20 the type declarations of node match the pinned runtime major', () => {
    expect(manifest.devDependencies['@types/node']).toMatch(/^24\./);
  });

  it('NFR-20 the installed licence of each approved library is in the allowed list', () => {
    for (const name of APPROVED) {
      const candidates = [
        join(repo, 'tools', 'build-map', 'node_modules', name, 'package.json'),
        join(repo, 'node_modules', name, 'package.json'),
      ];
      const found = candidates.find((p) => existsSync(p));
      expect(found, `${name} is installed`).toBeDefined();
      const licence = JSON.parse(readFileSync(found!, 'utf8')).license;
      expect(ALLOWED_LICENCES, `${name}: ${String(licence)}`).toContain(licence);
    }
  });

  it('NFR-20 shared and sim have no third-party dependency', () => {
    for (const pkg of ['shared', 'sim']) {
      const m = readJson('packages', pkg, 'package.json');
      expect(thirdParty(m.dependencies), pkg).toStrictEqual([]);
      expect(thirdParty(m.devDependencies), pkg).toStrictEqual([]);
      expect(thirdParty(m.peerDependencies), pkg).toStrictEqual([]);
      expect(thirdParty(m.optionalDependencies), pkg).toStrictEqual([]);
    }
  });

  it('NFR-20 the root manifest adds no approved library', () => {
    const root = readJson('package.json');
    for (const name of APPROVED) {
      expect(root.dependencies?.[name], name).toBeUndefined();
      expect(root.devDependencies?.[name], name).toBeUndefined();
    }
  });

  it('NFR-20 the viewer manifest declares none of the builder libraries', () => {
    const viewer = readJson('apps', 'web', 'package.json');
    for (const name of APPROVED) {
      for (const kind of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        expect(viewer[kind]?.[name], `${kind}.${name}`).toBeUndefined();
      }
    }
  });

  it('NFR-20 no source of shared, sim or the viewer imports an approved library', () => {
    expect(Object.keys(packageSources).length).toBeGreaterThan(5);
    expect(Object.keys(packageSources).some((p) => p.includes('/apps/web/src/'))).toBe(true);
    const offenders = Object.entries(packageSources)
      .filter(([, src]) => importsLibrary(src))
      .map(([p]) => p);
    expect(offenders).toStrictEqual([]);
  });

  it('NFR-20 the import detector flags planted imports of an approved library', () => {
    expect(importsLibrary("import { PNG } from 'pngjs';")).toBe(true);
    expect(importsLibrary("import 'tsx';")).toBe(true);
    expect(importsLibrary("const p = require('pngjs/browser');")).toBe(true);
    expect(importsLibrary("const p = await import('pngjs');")).toBe(true);
    expect(importsLibrary("import { a } from './pngjs-helper';")).toBe(false);
  });

  it('NFR-20 pngjs is imported only from the PNG adapter', () => {
    const importers = Object.entries(builderSources)
      .filter(([, src]) => importedSpecifiers(src).some((s) => s === 'pngjs' || s.startsWith('pngjs/')))
      .map(([p]) => p);
    expect(importers).toContain('../src/io/png-codec.ts');
    expect(importers.every((p) => p === '../src/io/png-codec.ts')).toBe(true);
  });

  it('NFR-20 shapefile is imported only from the shapefile adapter, and nothing else in extract imports it', () => {
    const importers = Object.entries(builderSources)
      .filter(([, src]) => importedSpecifiers(src).some((s) => s === 'shapefile' || s.startsWith('shapefile/')))
      .map(([p]) => p);
    expect(importers).toStrictEqual(['../src/extract/read-shapefile.ts']);
    expect(importsLibrary("import * as shapefile from 'shapefile';")).toBe(true);
    // no builder source other than the adapter names a file-capable shapefile source either
    const others = Object.entries(builderSources).filter(([p]) => p !== '../src/extract/read-shapefile.ts');
    expect(others.some(([, src]) => /\b(?:path-source|stream-source|file-source)\b/.test(src))).toBe(false);
  });
});
