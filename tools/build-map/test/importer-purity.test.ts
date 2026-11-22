import { describe, expect, it, vi } from 'vitest';
import { extractGeo } from '../src/importer/extract-geo';
import { ErrorCollector } from '../src/importer/errors';
import { parseCuration } from '../src/importer/curation';
import { inspectSource } from '../src/importer/inspect';
import { readSource, readSources } from '../src/importer/read-source';
import { generateScaleFixture } from '../src/importer/scale-fixture';
import { selectUnits } from '../src/importer/select';
import { buildUnits } from '../src/importer/units';
import type { ShpGeometry } from '../src/importer/types';
import { dbfRaw } from './helpers/dbf-fixture';
import { bytesOf, collection, feat, multi, polygon, ring, textBytes } from './helpers/geo-fixture';
import { codeOnly, scanSource } from './helpers/scan';

// The importer sources are a scanned pure core (the same scan as the builder core, extended by this file only).
const importerSources = import.meta.glob('../src/importer/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('the source scan of the importer core', () => {
  it('the scan covers every importer source written so far and none of the adapters', () => {
    const files = Object.keys(importerSources).sort();
    expect(files).toStrictEqual([
      '../src/importer/check-curation.ts',
      '../src/importer/curation.ts',
      '../src/importer/errors.ts',
      '../src/importer/extract-geo.ts',
      '../src/importer/grouping.ts',
      '../src/importer/inspect.ts',
      '../src/importer/read-dbf.ts',
      '../src/importer/read-source.ts',
      '../src/importer/scale-fixture.ts',
      '../src/importer/select.ts',
      '../src/importer/types.ts',
      '../src/importer/units.ts',
    ]);
    expect(files.some((f) => f.includes('/cli/') || f.includes('/io/') || f.includes('/extract/'))).toBe(false);
  });

  it('the importer core uses no file, clock, randomness, network or other built-in module', () => {
    const violations: string[] = [];
    for (const [file, src] of Object.entries(importerSources)) {
      for (const v of scanSource(src)) violations.push(`${file}: ${v}`);
    }
    expect(violations).toStrictEqual([]);
  });

  it('the importer core never uses the word transition in code, and the dbf reader needs only the two decoding built-ins', () => {
    for (const [file, src] of Object.entries(importerSources)) {
      expect(/\btransition\b/i.test(codeOnly(src)), file).toBe(false);
    }
    const dbf = importerSources['../src/importer/read-dbf.ts']!;
    expect(/\bTextDecoder\b/.test(dbf)).toBe(true);
    expect(/\bDataView\b/.test(dbf)).toBe(true);
    // its only import is a type of the shared package
    expect([...dbf.matchAll(/^import .*$/gm)].map((m) => m[0])).toStrictEqual(["import type { Result } from '@mbrg/shared';"]);
  });

  it('the scan flags a planted node:fs import, Math.random, Date, fetch and process in an importer source', () => {
    const planted: Record<string, string> = {
      'node:fs import': "import { readFileSync } from 'node:fs';",
      'fs import': "import { readFileSync } from 'fs';",
      'Math.random': 'export const r = Math.random();',
      'Date.now': 'export const t = Date.now();',
      'fetch': "export const r = fetch('http://example.test');",
      'process': 'export const e = process.argv;',
      'dynamic import': 'const m = await import(path);',
      'shapefile import': "import * as shapefile from 'shapefile';",
    };
    for (const [name, src] of Object.entries(planted)) expect(scanSource(src).length, name).toBeGreaterThan(0);
    // an importer file that planted one of them would be reported by the scan above, with its name
    const planted2 = { ...importerSources, '../src/importer/planted.ts': 'export const r = Math.random();' };
    const violations = Object.entries(planted2).flatMap(([file, src]) => scanSource(src).map((v) => `${file}: ${v}`));
    expect(violations).toStrictEqual(['../src/importer/planted.ts: forbidden API Math.random']);
  });
});

/** Runs a body while the clock, randomness and every other source of change throws; the body must not touch them. */
function withoutClock<T>(body: () => T): T {
  const boom = (name: string) => () => {
    throw new Error(`${name} was called`);
  };
  const RealDate = Date;
  class ThrowingDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) throw new Error('new Date() was called');
      super(...(args as [number]));
    }
    static override now(): number {
      throw new Error('Date.now was called');
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
  try {
    expect(() => Math.random()).toThrow();
    expect(() => Date.now()).toThrow();
    expect(() => new Date()).toThrow();
    for (const spy of spies) spy.mockClear();
    const result = body();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    return result;
  } finally {
    vi.unstubAllGlobals();
    for (const spy of spies) spy.mockRestore();
  }
}

const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

describe('the importer cores take bytes in and give bytes out, whatever the clock says', () => {
  const sourceBytes = bytesOf(
    collection([feat({ code: 'A', name: 'Alfa', n: 1 }, polygon(0, 0)), feat({ code: 'B', name: 'Beta' }, multi([2, 0], [4, 0])), feat(null, null)]),
  );

  it('the extract core runs twice with byte-identical output while the clock and randomness throw', () => {
    const geometries: ShpGeometry[] = [
      { type: 'Polygon', coordinates: [ring(0, 0) as [number, number][]] },
      { type: 'MultiPolygon', coordinates: [[ring(2, 0) as [number, number][]], [ring(4, 0) as [number, number][]]] },
    ];
    const dbf = dbfRaw([{ name: 'NAME', type: 'C', length: 12 }], [['Alfa'], ['  Beta']]);
    const run = () => extractGeo({ geometries, dbf, cpg: 'UTF-8', round: 7 });
    const [a, b] = withoutClock(() => [run(), run()]);
    expect(a!.ok && b!.ok).toBe(true);
    if (a!.ok && b!.ok) expect(same(a.value, b.value)).toBe(true);
  });

  it('the inspect core runs twice with byte-identical summary and draft while the clock and randomness throw', () => {
    const read = readSource({ file: 's', bytes: sourceBytes }, { usedProperties: [] });
    if (!read.ok) throw new Error('the source should read');
    const [a, b] = withoutClock(() => [inspectSource(read.value, 's.geojson'), inspectSource(read.value, 's.geojson')]);
    expect(a!.summary).toBe(b!.summary);
    expect(same(a!.draft, b!.draft)).toBe(true);
  });

  it('the scale fixture generator runs twice with byte-identical output while the clock and randomness throw', () => {
    const options = { units: 30, islandUnits: 4, columns: 5, factions: 4, seas: 4, verticesPerSide: 4, side: 128, minPieceSize: 2, insetAt: [2, 90] as [number, number] };
    const [a, b] = withoutClock(() => [generateScaleFixture(options), generateScaleFixture(options)]);
    expect(same(a!.primary, b!.primary)).toBe(true);
    expect(same(a!.context, b!.context)).toBe(true);
    expect(same(a!.curationBytes, b!.curationBytes)).toBe(true);
  });

  it('the reader, the curation, the units and the selection run twice with identical results while the clock and randomness throw', () => {
    const curationBytes = textBytes(
      JSON.stringify({
        primary: 'p',
        columns: { key: 'code', name: ['name'] },
        select: [{ property: 'n', gte: 1 }],
        params: { side: 128, margin: 0.1, minPieceSize: 2, projection: 'laea' },
      }),
    );
    const run = () => {
      const read = readSources([{ file: 's', bytes: sourceBytes }], { usedProperties: ['code', 'name', 'n'] });
      const curation = parseCuration(curationBytes, 'c.json');
      if (!read.ok || !curation.ok) throw new Error('inputs should read');
      const units = buildUnits(read.value[0]!.features, curation.value);
      if (!units.ok) throw new Error('units should form');
      const collector = new ErrorCollector<{ kind: string }>();
      collector.add({ kind: 'unknown-unit' });
      return JSON.stringify([read, curation, units, selectUnits(units.value, curation.value), collector.list()]);
    };
    const [a, b] = withoutClock(() => [run(), run()]);
    expect(a).toBe(b);
    expect(a!.length).toBeGreaterThan(100);
  });
});
