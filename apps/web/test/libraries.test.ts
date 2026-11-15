import { describe, expect, it } from 'vitest';
import webManifestRaw from '../package.json?raw';
import rootManifestRaw from '../../../package.json?raw';
import sharedManifestRaw from '../../../packages/shared/package.json?raw';
import simManifestRaw from '../../../packages/sim/package.json?raw';
import lockRaw from '../../../package-lock.json?raw';

// Exact versions confirmed by the user (plan section 1, decisions U1, U2, Q6).
const RUNTIME = { three: '0.186.1' };
const DEV = { vite: '8.3.4', '@types/three': '0.186.0' };
const APPROVED = [...Object.keys(RUNTIME), ...Object.keys(DEV)];
const BUILDER_LIBRARIES = ['pngjs', '@types/pngjs', 'shapefile', 'tsx', '@types/node', '@types/shapefile'];
const ALLOWED_LICENCES = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'Unlicense', 'CC0-1.0'];
const EXACT = /^\d+\.\d+\.\d+$/;

const manifest = JSON.parse(webManifestRaw) as any;
const lock = JSON.parse(lockRaw) as any;

function thirdParty(deps: Record<string, string> | undefined): string[] {
  return Object.keys(deps ?? {}).filter((n) => !n.startsWith('@mbrg/'));
}

/** Specifiers a source imports, requires or dynamically imports. */
function importedSpecifiers(src: string): string[] {
  const out: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"`])([^'"`]+)\1/g;
  for (const m of src.matchAll(re)) out.push(m[2]!);
  return out;
}

function importsPackage(src: string, name: string): boolean {
  return importedSpecifiers(src).some((s) => s === name || s.startsWith(`${name}/`));
}

const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;
const configs = import.meta.glob('../vite.config.ts', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

/** Locked entry of an installed package (the lockfile records the installed licence and dependencies). */
function lockedEntry(name: string): any | undefined {
  return lock.packages[`apps/web/node_modules/${name}`] ?? lock.packages[`node_modules/${name}`];
}

describe('NFR-26 libraries', () => {
  it('NFR-26 the viewer third-party dependencies are exactly three, vite and the three type declarations', () => {
    expect(thirdParty(manifest.dependencies).sort()).toStrictEqual(['three']);
    expect(thirdParty(manifest.devDependencies).sort()).toStrictEqual(['@types/three', 'vite']);
    expect(thirdParty(manifest.peerDependencies)).toStrictEqual([]);
    expect(thirdParty(manifest.optionalDependencies)).toStrictEqual([]);
  });

  it('NFR-26 each approved library is pinned to the confirmed exact version, equal to the lockfile', () => {
    const declared = { ...manifest.dependencies, ...manifest.devDependencies } as Record<string, string>;
    const confirmed = { ...RUNTIME, ...DEV } as Record<string, string>;
    for (const name of APPROVED) {
      expect(declared[name], name).toMatch(EXACT);
      expect(declared[name], name).toBe(confirmed[name]);
      const locked = lockedEntry(name);
      expect(locked?.version, name).toBe(declared[name]);
    }
  });

  it('NFR-26 three is a runtime dependency; vite and the type declarations are development dependencies only', () => {
    expect(manifest.dependencies?.['three']).toBeDefined();
    expect(manifest.devDependencies?.['three']).toBeUndefined();
    for (const name of ['vite', '@types/three']) {
      expect(manifest.devDependencies?.[name], name).toBeDefined();
      expect(manifest.dependencies?.[name], name).toBeUndefined();
    }
  });

  it('NFR-26 vite stays the single copy already locked by the test runner (no second Vite)', () => {
    const copies = Object.keys(lock.packages).filter((k) => k.endsWith('node_modules/vite'));
    expect(copies).toStrictEqual(['node_modules/vite']);
  });

  it('NFR-26 vite, three, the type declarations and every package they bring have a licence in the allowed list (vite transitives are the test runner ones already locked since 001)', () => {
    const seen = new Set<string>();
    const walk = (name: string): void => {
      if (seen.has(name)) return;
      seen.add(name);
      const pkg = lockedEntry(name);
      expect(pkg, `${name} is locked`).toBeDefined();
      expect(ALLOWED_LICENCES, `${name}: ${String(pkg.license)}`).toContain(pkg.license);
      // vite's own dependencies were locked by the test runner before this spec (plan section 1): not walked.
      if (name === 'vite') return;
      for (const dep of Object.keys(pkg.dependencies ?? {})) walk(dep);
    };
    for (const name of APPROVED) walk(name);
    expect(seen.size).toBeGreaterThanOrEqual(APPROVED.length);
    for (const name of [
      '@dimforge/rapier3d-compat',
      '@tweenjs/tween.js',
      '@types/stats.js',
      '@types/webxr',
      'fflate',
      'meshoptimizer',
    ]) {
      expect(seen.has(name), name).toBe(true);
    }
  });

  it('NFR-26 three is imported only from the render part (or the T1 stub in the UI until it exists)', () => {
    const importers = Object.entries(sources)
      .filter(([, src]) => importsPackage(src, 'three'))
      .map(([p]) => p);
    const hasRender = Object.keys(sources).some((p) => p.startsWith('../src/render/'));
    if (hasRender) {
      expect(importers.every((p) => p.startsWith('../src/render/')), importers.join(', ')).toBe(true);
    } else {
      expect(importers.every((p) => p === '../src/ui/main.ts'), importers.join(', ')).toBe(true);
    }
    expect(importsPackage("import * as THREE from 'three';", 'three')).toBe(true);
    expect(importsPackage("import { Mesh } from 'three/src/objects/Mesh.js';", 'three')).toBe(true);
    expect(importsPackage("import x from './three-helper';", 'three')).toBe(false);
  });

  it('NFR-26 vite is imported only from vite.config.ts', () => {
    expect(Object.keys(configs)).toStrictEqual(['../vite.config.ts']);
    expect(importsPackage(configs['../vite.config.ts']!, 'vite')).toBe(true);
    const offenders = Object.entries(sources)
      .filter(([, src]) => importsPackage(src, 'vite'))
      .map(([p]) => p);
    expect(offenders).toStrictEqual([]);
    expect(importsPackage("const v = await import('vite');", 'vite')).toBe(true);
  });

  it('NFR-26 no builder library is declared by the viewer, the root manifest or imported by viewer sources', () => {
    const declared = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
    });
    const root = JSON.parse(rootManifestRaw) as any;
    const rootDeclared = Object.keys({ ...root.dependencies, ...root.devDependencies });
    for (const name of BUILDER_LIBRARIES) {
      expect(declared, name).not.toContain(name);
      expect(rootDeclared, name).not.toContain(name);
    }
    expect(Object.keys(sources).length).toBeGreaterThan(0);
    const offenders = Object.entries(sources)
      .filter(([, src]) => BUILDER_LIBRARIES.some((b) => importsPackage(src, b)))
      .map(([p]) => p);
    expect(offenders).toStrictEqual([]);
    expect(importsPackage("import { PNG } from 'pngjs';", 'pngjs')).toBe(true);
  });

  it('NFR-26 shared and sim still have no third-party dependency', () => {
    for (const [pkg, raw] of [
      ['shared', sharedManifestRaw],
      ['sim', simManifestRaw],
    ] as const) {
      const m = JSON.parse(raw) as any;
      expect(thirdParty(m.dependencies), pkg).toStrictEqual([]);
      expect(thirdParty(m.devDependencies), pkg).toStrictEqual([]);
      expect(thirdParty(m.peerDependencies), pkg).toStrictEqual([]);
      expect(thirdParty(m.optionalDependencies), pkg).toStrictEqual([]);
    }
  });
});
