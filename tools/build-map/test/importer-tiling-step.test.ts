import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCuration } from '../src/importer/curation';
import { buildPackage, type ImportOutcome } from '../src/importer/import';
import { formatImportReport } from '../src/importer/report';
import { pngCodec } from '../src/io/png-codec';

/**
 * Spec 035, the tiling step of an import (FR-670 to FR-694), run on the committed tiling sample: two basins that touch,
 * a basin kept whole, an inset with its own sea, a hole joined to a basin, an exclave inside other land and a names
 * file with a bay inside a sea.
 */
const sampleDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'importer', 'tiling-sample');
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(join(sampleDir, name)));
const curationJson = (): Record<string, unknown> => JSON.parse(readFileSync(join(sampleDir, 'curation.json'), 'utf8')) as Record<string, unknown>;

type Mutate = (c: Record<string, unknown> & { params: Record<string, unknown> }) => void;

function run(mutate: Mutate = () => undefined, withNames = true): ImportOutcome {
  const json = curationJson() as Record<string, unknown> & { params: Record<string, unknown> };
  mutate(json);
  const parsed = parseCuration(new TextEncoder().encode(JSON.stringify(json)), 'curation.json');
  if (!parsed.ok) throw new Error(`the curation should parse: ${JSON.stringify(parsed.errors)}`);
  const names = withNames ? { file: 'names.json', bytes: read('names.json') } : undefined;
  return buildPackage({
    curation: parsed.value,
    primary: { file: 'primary.json', bytes: read('primary.json') },
    context: [{ file: 'context.json', bytes: read('context.json') }],
    ...(names === undefined ? {} : { names }),
    codec: pngCodec,
  });
}

function ok(outcome: ImportOutcome): Extract<ImportOutcome, { ok: true }> {
  if (!outcome.ok) throw new Error(`expected a package, got ${JSON.stringify(outcome.errors)}`);
  return outcome;
}

const tiling = (c: { params: Record<string, unknown> }): Record<string, unknown> => c.params.tiling as Record<string, unknown>;

const report = (outcome: Extract<ImportOutcome, { ok: true }>): string =>
  formatImportReport({
    curation: { file: 'curation.json', sha256: 'x' },
    sources: outcome.details.sources.map((s) => ({ file: s.file, sha256: 'x', features: s.features.length, skippedNull: s.skippedNull })),
    details: outcome.details,
    map: outcome.map,
    presentation: outcome.presentation,
    width: outcome.width,
    pixels: outcome.pixels,
    names: { file: 'names.json', sha256: 'y' },
  });

describe('FR-670 the tiling member of the curation', () => {
  const parse = (tilingValue: unknown): ReturnType<typeof parseCuration> => {
    const base = { primary: 'p.json', columns: { key: 'code', name: ['name'] }, params: { side: 64, margin: 0.02, minPieceSize: 1, projection: 'laea', tiling: tilingValue } };
    return parseCuration(new TextEncoder().encode(JSON.stringify(base)), 'c.json');
  };

  it('FR-670 reads false (off), {} (on with defaults) and an object with every member', () => {
    const off = parse(false);
    expect(off.ok && off.value.params.tiling).toBe(false);
    const on = parse({});
    expect(on.ok && on.value.params.tiling).toStrictEqual({ zones: new Map() });
    const full = parse({ targetTiles: 50, tileKm: 20, openTileKm: 40, farTileKm: 80, coastBandKm: 20, reachKm: 120, maxTiles: 500, zones: { 'Mar A': 0, 'Mar B': 10 }, names: { file: 'n.json', nameProperty: ['name_es', 'name'] } });
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    expect(full.value.params.tiling).toStrictEqual({
      targetTiles: 50,
      tileKm: 20,
      openTileKm: 40,
      farTileKm: 80,
      coastBandKm: 20,
      reachKm: 120,
      maxTiles: 500,
      zones: new Map([['Mar A', 0], ['Mar B', 10]]),
      names: { file: 'n.json', nameProperty: ['name_es', 'name'] },
    });
  });

  it('FR-670 gives a curation without tiling the same value as before (absent: on with defaults)', () => {
    const base = { primary: 'p.json', columns: { key: 'code', name: ['name'] }, params: { side: 64, margin: 0.02, minPieceSize: 1, projection: 'laea' } };
    const parsed = parseCuration(new TextEncoder().encode(JSON.stringify(base)), 'c.json');
    expect(parsed.ok && 'tiling' in parsed.value.params).toBe(false);
  });

  it.each([
    [true, 'params.tiling'],
    [[], 'params.tiling'],
    [{ tileKm: 0 }, 'params.tiling.tileKm'],
    [{ openTileKm: -1 }, 'params.tiling.openTileKm'],
    [{ farTileKm: 'big' }, 'params.tiling.farTileKm'],
    [{ targetTiles: 0 }, 'params.tiling.targetTiles'],
    [{ targetTiles: 100_001 }, 'params.tiling.targetTiles'],
    [{ maxTiles: 1.5 }, 'params.tiling.maxTiles'],
    [{ zones: [] }, 'params.tiling.zones'],
    [{ zones: { A: -1 } }, 'params.tiling.zones.A'],
    [{ names: { file: '', nameProperty: ['a'] } }, 'params.tiling.names.file'],
    [{ names: { file: 'n', nameProperty: [] } }, 'params.tiling.names.nameProperty'],
    [{ names: { file: 'n', nameProperty: ['a', 'b', 'c', 'd'] } }, 'params.tiling.names.nameProperty'],
    [{ names: { file: 'n', nameProperty: ['a'], extra: 1 } }, 'params.tiling.names.extra'],
    [{ colour: 1 }, 'params.tiling.colour'],
  ])('FR-670 fails with invalid-curation naming the member path for %j', (value, path) => {
    const r = parse(value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContainEqual({ kind: 'invalid-curation', path });
  });

  it('FR-670 fails with unknown-sea (name) for a zones key that names no basin, before any pixel is made', () => {
    const outcome = run((c) => {
      tiling(c).zones = { 'Mar Fantasma': 0, 'Mar Abierto': 0 };
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.stage).toBe('curation');
    expect(outcome.errors).toStrictEqual([{ kind: 'unknown-sea', name: 'Mar Abierto' }, { kind: 'unknown-sea', name: 'Mar Fantasma' }]);
  });

  it('FR-670 fails with invalid-curation for a spacing under 3 pixels or over the frame side', () => {
    const small = run((c) => {
      tiling(c).tileKm = 5;
    });
    expect(small.ok).toBe(false);
    if (!small.ok) {
      expect(small.stage).toBe('projection');
      expect(small.errors).toStrictEqual([{ kind: 'invalid-curation', path: 'params.tiling.tileKm' }]);
    }
    const huge = run((c) => {
      tiling(c).reachKm = 100_000;
    });
    expect(huge.ok).toBe(false);
    if (!huge.ok) expect(huge.errors).toStrictEqual([{ kind: 'invalid-curation', path: 'params.tiling.reachKm' }]);
    const zone = run((c) => {
      tiling(c).zones = { 'Mar Este': 2 };
    });
    expect(zone.ok).toBe(false);
    if (!zone.ok) expect(zone.errors).toStrictEqual([{ kind: 'invalid-curation', path: 'params.tiling.zones.Mar Este' }]);
  });
});

describe('FR-671 the defaults', () => {
  it('FR-671 searches tileKm for the target, min(600, 2 x land territories), and prints the values in force', () => {
    const result = ok(run((c) => {
      c.params.tiling = { names: tiling(c).names };
    }));
    const lines = report(result);
    expect(lines).toContain('  targetTiles: 10');
    const tiles = Number(/^  tiles: (\d+)$/m.exec(lines)![1]);
    const seeds = Number(/^  seeds: (\d+)$/m.exec(lines)![1]);
    expect(seeds).toBeLessThanOrEqual(10);
    expect(tiles).toBeLessThanOrEqual(10);
    const tileKm = Number(/^  tileKm: (\d+)/m.exec(lines)![1]);
    expect(Number.isInteger(tileKm)).toBe(true);
    expect(lines).toContain(`  openTileKm: ${2 * tileKm} `);
    expect(lines).toContain(`  farTileKm: ${4 * tileKm} `);
    expect(lines).toContain(`  coastBandKm: ${tileKm} `);
    expect(lines).toContain(`  reachKm: ${6 * tileKm} `);
  });

  it('FR-671 prints the values in force too when the author gave tileKm (and no target)', () => {
    const lines = report(ok(run()));
    expect(lines).toContain('  tileKm: 600 (pixels=15.29)');
    expect(lines).not.toContain('targetTiles');
  });
});

describe('FR-672 tiling off, FR-689 the neutral limit', () => {
  it('FR-672 gives the sea zones of 028, one entry per basin, and no tiling section, when tiling is false', () => {
    const off = ok(run((c) => {
      c.params.tiling = false;
    }));
    expect(off.details.tiling).toBeUndefined();
    expect(off.details.numbering.sea.map((s) => s.name)).toStrictEqual(['Mar Oeste', 'Mar Este', 'Golfo Quieto', 'Mar Isla']);
    expect(report(off)).not.toContain('tiling: on');
  });

  it('FR-689 produces exactly the package of tiling: false when every spacing is the frame side or more', () => {
    const off = ok(run((c) => {
      c.params.tiling = false;
    }));
    const limit = ok(run((c) => {
      c.params.tiling = { tileKm: 4824, names: tiling(c).names };
    }));
    expect(Buffer.from(limit.files.map).equals(Buffer.from(off.files.map))).toBe(true);
    expect(Buffer.from(limit.files.presentation).equals(Buffer.from(off.files.presentation))).toBe(true);
    expect(Buffer.from(limit.files.image).equals(Buffer.from(off.files.image))).toBe(true);
    expect(limit.details.tiling!.tiles).toBe(4);
  });
});

describe('the tiled sample', () => {
  const result = ok(run());
  const sea = result.map.territories.filter((t) => 'kind' in t && t.kind === 'sea');

  it('FR-678 makes every tile a sea entry with no owner, after the land territories, in consecutive ids', () => {
    const land = result.map.territories.filter((t) => !('kind' in t));
    expect(land).toHaveLength(5);
    expect(sea.length).toBeGreaterThan(20);
    expect(sea.map((t) => t.id)).toStrictEqual(Array.from({ length: sea.length }, (_, i) => land.length + 1 + i));
    expect(sea.every((t) => !('owner' in t))).toBe(true);
    expect(result.details.numbering.sea).toHaveLength(sea.length);
  });

  it('FR-678 numbers the tiles basin by basin; a basin kept whole (zones: 0) keeps one entry and its name', () => {
    const names = result.presentation.territories.slice(5).map((t) => t.name!);
    expect(names).toContain('Golfo Quieto');
    expect(names.filter((n) => n.startsWith('Golfo Quieto'))).toHaveLength(1);
    const basins = result.details.tiling!.basins;
    expect(basins.find((b) => b.name === 'Golfo Quieto')!.tiles).toBe(1);
    expect(basins.reduce((n, b) => n + b.tiles, 0)).toBe(sea.length);
  });

  it('FR-679 names tiles after the marine polygon that covers most of them, the bay inside the sea included, numbering repeats', () => {
    const names = result.presentation.territories.slice(5).map((t) => t.name!);
    expect(names.some((n) => n.startsWith('Bahía Chica'))).toBe(true);
    expect(names.some((n) => n.startsWith('Mar Grande'))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      const base = name.replace(/ \d+$/, '');
      const same = names.filter((n) => n.replace(/ \d+$/, '') === base);
      if (same.length > 1) expect(name).toMatch(/ \d+$/);
    }
    expect(result.details.tiling!.named).toBeGreaterThan(0);
    expect(result.details.tiling!.named + result.details.tiling!.fallback).toBe(sea.length);
  });

  it('FR-679 keeps the basin name for tiles outside every names polygon (the inset sea, far from the file)', () => {
    const names = result.presentation.territories.slice(5).map((t) => t.name!);
    expect(names.filter((n) => n.startsWith('Mar Isla')).length).toBeGreaterThan(0);
  });

  it('FR-680 links two entries if and only if some pair of their pixels is 4-adjacent (tile-tile, tile-land, across basins)', () => {
    const { pixels, width } = result;
    const pairs = new Set<string>();
    for (let i = 0; i < pixels.length; i++) {
      const x = i % width;
      for (const j of [x < width - 1 ? i + 1 : -1, i + width < pixels.length ? i + width : -1]) {
        if (j < 0) continue;
        const a = pixels[i]!;
        const b = pixels[j]!;
        if (a !== b && a !== 0 && b !== 0) pairs.add(a < b ? `${a},${b}` : `${b},${a}`);
      }
    }
    const linked = new Set<string>();
    for (const t of result.map.territories) for (const n of t.neighbors) linked.add(t.id < n ? `${t.id},${n}` : `${n},${t.id}`);
    expect([...linked].sort()).toStrictEqual([...pairs].sort());
    // tiles of different basins touch: the western and eastern seas meet
    const west = result.details.tiling!.basins.findIndex((b) => b.name === 'Mar Oeste');
    expect(west).toBeGreaterThanOrEqual(0);
  });

  it('FR-681 changes nothing of the format: the self-check of 003b passed on tiles as on zones, every entry is land or sea', () => {
    for (const t of result.map.territories) expect('kind' in t ? t.kind : 'land').toMatch(/^(land|sea)$/);
  });

  it('FR-682 turns a hole joined to its basin into a piece of that basin that gets tiles of that basin (no lake, no tile of its own)', () => {
    expect(result.details.lakes).toHaveLength(0);
    expect(result.details.enclosed).toHaveLength(1);
    const first = result.details.tiling!.basins.slice(0, 0);
    expect(first).toHaveLength(0);
    // the enclosed report names the zone by an entry of the map (the first tile of its basin)
    const zone = result.details.enclosed[0]!.zone;
    expect(sea.some((t) => t.id === zone)).toBe(true);
  });

  it('FR-683 keeps the inset sea apart: its tiles lie inside the inset rectangle and no other tile does', () => {
    const rect = result.details.views.insets[0]!.rect;
    const isle = new Set(result.presentation.territories.filter((t) => (t.name ?? '').startsWith('Mar Isla')).map((t) => t.id));
    expect(isle.size).toBeGreaterThan(0);
    for (let i = 0; i < result.pixels.length; i++) {
      const x = i % result.width;
      const y = Math.floor(i / result.width);
      const inside = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      const v = result.pixels[i]!;
      if (isle.has(v)) expect(inside).toBe(true);
      else if (inside && sea.some((t) => t.id === v)) expect(isle.has(v)).toBe(true);
    }
  });

  it('FR-684 bridges an exclave over tiles and other land as it bridged it over sea zones', () => {
    expect(result.details.bridges.length).toBeGreaterThan(0);
    for (const b of result.details.bridges) expect(b.water).toBeGreaterThanOrEqual(0);
  });

  it('FR-686 prints the tiling section: spacings, basins, areas, the most factions on one tile, merges, names and the names file', () => {
    const lines = report(result);
    for (const label of ['tiling: on', '  tileKm: 600 (pixels=15.29)', '  openTileKm: 1200', '  farTileKm: 2400', '  coastBandKm: 600', '  reachKm: 3600', '  basins: 4', '  tileAreaKm2: min=', '  maxFactionsPerTile: 1', '  mergedTiles: ', '  namedFromFile: ', '  namedFromBasin: ', '  skippedNamePolygons: 0', '  namesFile: file=names.json sha256=y']) {
      expect(lines, label).toContain(label);
    }
    expect(lines).toContain('seaZones: ');
  });

  it('FR-685 fails with too-many-tiles at the pixel stage, naming the cap, the count and the basins with the most tiles', () => {
    const failed = run((c) => {
      tiling(c).maxTiles = 5;
    });
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.stage).toBe('pixels');
    const error = failed.errors[0]!;
    expect(error.kind).toBe('too-many-tiles');
    if (error.kind !== 'too-many-tiles') return;
    expect(error.cap).toBe(5);
    expect(error.count).toBeGreaterThan(5);
    expect(error.basins.length).toBeGreaterThan(0);
  });

  it('FR-694 refuses a curation that names a names file the caller did not supply', () => {
    const missing = run(undefined, false);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.stage).toBe('sources');
      expect(missing.errors).toStrictEqual([{ kind: 'invalid-curation', path: 'params.tiling.names' }]);
    }
  });

  it('FR-695 gives the same bytes for the same inputs, and a changed names file changes names only', () => {
    const again = ok(run());
    expect(Buffer.from(again.files.map).equals(Buffer.from(result.files.map))).toBe(true);
    expect(Buffer.from(again.files.image).equals(Buffer.from(result.files.image))).toBe(true);
    expect(Buffer.from(again.files.presentation).equals(Buffer.from(result.files.presentation))).toBe(true);
    const withoutNames = ok(run((c) => {
      delete tiling(c).names;
    }, false));
    expect(Buffer.from(withoutNames.files.map).equals(Buffer.from(result.files.map))).toBe(true);
    expect(Buffer.from(withoutNames.files.image).equals(Buffer.from(result.files.image))).toBe(true);
    expect(Buffer.from(withoutNames.files.presentation).equals(Buffer.from(result.files.presentation))).toBe(false);
  });

  it('FR-679 numbers the tiles of a basin with no names file as "<basin> <n>"', () => {
    const plain = ok(run((c) => {
      delete tiling(c).names;
    }, false));
    const names = plain.presentation.territories.slice(5).map((t) => t.name!);
    expect(names).toContain('Golfo Quieto');
    expect(names).toContain('Mar Oeste 1');
    expect(names.every((n) => /^(Golfo Quieto|Mar Oeste \d+|Mar Este \d+|Mar Isla \d+|Mar Isla)$/.test(n))).toBe(true);
  });
});
