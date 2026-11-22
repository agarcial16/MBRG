import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripComments } from './helpers/scan';

// NFR-133: the importer adds no dependency. The 003b libraries test (NFR-20) is never edited; this file pins the
// importer's own side: the builder manifest as it was approved, and the importer sources' imports.
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const readJson = (...parts: string[]): any => JSON.parse(readFileSync(join(repo, ...parts), 'utf8'));

const importerSources = import.meta.glob('../src/importer/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const cliSources = import.meta.glob(['../src/cli/import.ts', '../src/cli/scale-prototype.ts', '../src/cli/scale-import.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** The module specifiers a source imports, re-exports, requires or imports dynamically (comments stripped first). */
function specifiers(src: string): string[] {
  const code = stripComments(src);
  const found = [...code.matchAll(/^\s*(?:import|export)\b[^;'"`]*?\bfrom\s*(['"`])([^'"`]+)\1/gm)].map((m) => m[2]!);
  for (const m of code.matchAll(/(?:^\s*import\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"`])([^'"`]+)\1/gm)) found.push(m[2]!);
  return found;
}

describe('NFR-133 the importer adds no dependency', () => {
  it('NFR-133 the builder manifest holds exactly the dependencies approved in 003b, at the same exact versions, plus the protocol workspace dependency of T3.5 (PD3)', () => {
    const manifest = readJson('tools', 'build-map', 'package.json');
    expect(manifest.dependencies).toStrictEqual({ '@mbrg/protocol': '*', '@mbrg/shared': '*', pngjs: '7.0.0', shapefile: '0.6.6' });
    expect(manifest.devDependencies).toStrictEqual({ '@types/node': '24.19.2', '@types/pngjs': '6.0.5', tsx: '4.23.15' });
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();
  });

  it('NFR-133 the root manifest and the lockfile name no package the builder did not already have', () => {
    const root = readJson('package.json');
    for (const kind of ['dependencies', 'devDependencies']) {
      for (const name of ['equal-earth', 'd3-geo', 'proj4', 'geojson', 'turf', 'jszip', 'sha.js', 'js-sha256']) {
        expect(root[kind]?.[name], `${kind}.${name}`).toBeUndefined();
      }
    }
    const lock = readJson('package-lock.json');
    const forbidden = ['d3-geo', 'proj4', '@turf/turf', 'js-sha256', 'sha.js', 'geojson-equal-earth'];
    for (const name of forbidden) expect(lock.packages[`node_modules/${name}`], name).toBeUndefined();
  });

  it('NFR-133 the importer sources import only relative files, the shared package and the node:zlib exemption', () => {
    expect(Object.keys(importerSources)).toHaveLength(22);
    expect(Object.keys(cliSources)).toHaveLength(3);
    const offenders: string[] = [];
    for (const [file, src] of Object.entries(importerSources)) {
      for (const spec of specifiers(src)) {
        if (spec.startsWith('./') || spec.startsWith('../') || spec === '@mbrg/shared' || spec === 'node:zlib') continue;
        offenders.push(`${file}: ${spec}`);
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('NFR-133 the import command adds no import of a library either: the shapefile library stays in its adapter and the PNG library in its own', () => {
    for (const [file, src] of Object.entries(cliSources)) {
      for (const spec of specifiers(src)) {
        expect(spec === 'pngjs' || spec === 'shapefile' || spec.startsWith('pngjs/') || spec.startsWith('shapefile/'), `${file}: ${spec}`).toBe(false);
      }
    }
  });

  it('NFR-133 the specifier scan finds planted imports and ignores comments', () => {
    expect(specifiers("import { geoEqualEarth } from 'd3-geo';")).toStrictEqual(['d3-geo']);
    expect(specifiers("export * from 'proj4';")).toStrictEqual(['proj4']);
    expect(specifiers("import 'side-effect';")).toStrictEqual(['side-effect']);
    expect(specifiers("const m = await import('lazy');")).toStrictEqual(['lazy']);
    expect(specifiers("const m = require('old');")).toStrictEqual(['old']);
    expect(specifiers("// import x from 'commented';\n/* from 'also' */\nimport type { A } from '../a';")).toStrictEqual(['../a']);
  });

  it('NFR-133 Equal Earth is own code: its module has no import and the projection is not read from a package', () => {
    const own = importerSources['../src/importer/equal-earth.ts']!;
    expect(specifiers(own)).toStrictEqual([]);
    expect(own).toContain('1.340264');
  });
});
