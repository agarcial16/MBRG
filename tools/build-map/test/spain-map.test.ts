import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkIdImage, checkPresentation, validateMap } from '@mbrg/shared';
import type { MapData } from '@mbrg/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { runBuild } from '../src/cli/build';
import { fromRgb } from '../src/core/png-check';
import { frameFor, pixelSide, project, projectionCenter, unproject } from '../src/core/projection';
import { parseBuildInputs } from '../src/core/parse-inputs';
import { realFs } from '../src/io/fs-ops';
import { pngCodec } from '../src/io/png-codec';
import { readInputTexts } from '../src/io/read-inputs';
import type { BuildInputs, InputName, SourceFeature } from '../src/core/types';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const data = join(root, 'tools', 'build-map', 'data', 'spain-provinces');
const committed = join(root, 'maps', 'spain-provinces');
const devSource = join(root, 'tools', 'build-map', 'data', 'natural-earth');

/** One Spain build is allowed to take as long as one dev map build; the timeout is above that. */
const BUILD_LIMIT_MS = 60_000;
const TEST_TIMEOUT_MS = 180_000;

const tempA = mkdtempSync(join(tmpdir(), 'mbrg-spain-a-'));
const tempB = mkdtempSync(join(tmpdir(), 'mbrg-spain-b-'));
afterAll(() => {
  rmSync(tempA, { recursive: true, force: true });
  rmSync(tempB, { recursive: true, force: true });
});

interface Rebuild {
  status: number;
  stderr: string;
  buildMs: number;
}

const cache = new Map<string, Rebuild>();

/** One full rebuild from the committed inputs into `dir` (done once per test run). */
function rebuild(dir: string): Rebuild {
  const cached = cache.get(dir);
  if (cached !== undefined) return cached;
  let stderr = '';
  const started = performance.now();
  const status = runBuild([`--data=${data}`, `--out=${dir}`], {
    fs: realFs,
    codec: pngCodec,
    root,
    stdout: () => undefined,
    stderr: (s) => (stderr += s),
  });
  const result = { status, stderr, buildMs: performance.now() - started };
  cache.set(dir, result);
  return result;
}

function decode(file: string): { width: number; height: number; pixels: Uint32Array } {
  const decoded = pngCodec.decode(new Uint8Array(readFileSync(file)));
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.errors));
  return { width: decoded.value.width, height: decoded.value.height, pixels: fromRgb(decoded.value.rgb) };
}

function loadInputs(): BuildInputs {
  const texts = readInputTexts(data, realFs) as Record<InputName, string>;
  const parsed = parseBuildInputs(texts);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.value;
}

const read = (name: string): Buffer => readFileSync(join(committed, name));
const map = (): MapData => JSON.parse(read('map.json').toString('utf8')) as MapData;
const presentation = (): unknown => JSON.parse(read('presentation.json').toString('utf8'));
const isSea = (e: { kind?: string }): boolean => e.kind === 'sea';

describe('the committed Spain map package: contents', () => {
  it('holds exactly 52 land territories, one per faction, and 7 sea zones', () => {
    const m = map();
    const land = m.territories.filter((e) => !isSea(e));
    const sea = m.territories.filter(isSea);
    expect(land.length).toBe(52);
    expect(sea.length).toBe(7);
    const owners = land.map((e) => (e as { owner: number }).owner);
    expect([...new Set(owners)].sort((a, b) => a - b)).toStrictEqual(
      Array.from({ length: 52 }, (_, i) => i + 1),
    );
    // Every faction owns exactly one territory and every land entry has a neighbor.
    expect(land.every((t) => t.neighbors.length > 0)).toBe(true);
  });

  it('has the 52 factions with Spanish names and the 7 Spanish-named sea zones', () => {
    const p = presentation() as { factions: { id: number; name: string }[]; territories: { id: number; name: string }[] };
    expect(p.factions.map((f) => f.id)).toStrictEqual(Array.from({ length: 52 }, (_, i) => i + 1));
    expect(p.factions.every((f) => f.name.length > 0)).toBe(true);
    expect(new Set(p.factions.map((f) => f.name)).size).toBe(52);
    expect(p.factions[0]!.name).toBe('Álava');
    expect(p.factions[25]!.name).toBe('A Coruña');
    expect(p.factions[51]!.name).toBe('Zaragoza');
    const m = map();
    const seaNames = m.territories.filter(isSea).map((s) =>
      (p.territories.find((t) => t.id === s.id) as { name: string }).name,
    );
    expect(seaNames).toStrictEqual([
      'Mar Cantábrico',
      'Océano Atlántico',
      'Mar de Canarias',
      'Golfo de Cádiz',
      'Mar de Alborán',
      'Mar Balear',
      'Mar Mediterráneo',
    ]);
  });

  it('is 1536 x 1536 with width 1536, margin 2% and S = 4', () => {
    const image = decode(join(committed, 'ids.png'));
    expect([image.width, image.height]).toStrictEqual([1536, 1536]);
    expect(loadInputs().params).toStrictEqual({ width: 1536, margin: 0.02, minPieceSize: 4 });
  });

  it('reuses the dev map Spain geometry: every province matches the dev-map subset feature', () => {
    // Raw GeoJSON on both sides (the builder's parsed shape is not what is committed).
    interface RawFeature {
      type: 'Feature';
      properties: Record<string, unknown>;
      geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
    }
    const own = (
      JSON.parse(readFileSync(join(data, 'natural-earth', 'provinces.json'), 'utf8')) as {
        features: RawFeature[];
      }
    ).features;
    const devEsp = (
      JSON.parse(readFileSync(join(devSource, 'provinces.json'), 'utf8')) as {
        features: RawFeature[];
      }
    ).features.filter((f) => f.properties['adm0_a3'] === 'ESP');
    expect(devEsp.length).toBe(52);
    expect(own.length).toBe(52);
    const byCode = new Map<string, RawFeature>();
    for (const f of own) byCode.set(f.properties['adm1_code'] as string, f);
    expect(byCode.size).toBe(52);
    for (const dev of devEsp) {
      const spain = byCode.get(dev.properties['adm1_code'] as string)!;
      // Only `adm0_a3` was rewritten (to the province's own code); the rest is verbatim.
      expect(spain.properties['adm0_a3']).toBe(dev.properties['adm1_code']);
      expect(spain.properties['name']).toStrictEqual(dev.properties['name']);
      expect(spain.properties['name_es']).toStrictEqual(dev.properties['name_es']);
      expect(spain.geometry).toStrictEqual(dev.geometry);
    }
    // The grouping assigns every province exactly once and excludes nothing.
    const inputs = loadInputs();
    expect(inputs.grouping.excluded).toStrictEqual([]);
    const listed = inputs.grouping.territories.flatMap((t) => t.provinces);
    expect(listed.length).toBe(52);
    expect(new Set(listed).size).toBe(52);
  });
});

describe('the committed Spain map package stays valid', () => {
  it('passes map validation', () => {
    expect(validateMap(map())).toMatchObject({ ok: true });
  });

  it('passes the presentation check', () => {
    expect(checkPresentation(map(), presentation())).toMatchObject({ ok: true });
  });

  it('is read without invalid-png and passes the id image check', () => {
    const image = decode(join(committed, 'ids.png'));
    expect(checkIdImage(map(), image.width, image.height, image.pixels)).toMatchObject({ ok: true });
  });
});

describe('the committed Spain map package: gameplay shape', () => {
  const m = map();
  const byId = new Map(m.territories.map((e) => [e.id, e]));
  const land = m.territories.filter((e) => !isSea(e)) as { id: number; owner: number; neighbors: number[] }[];
  const sea = m.territories.filter(isSea);
  const landNeighbors = (id: number): number[] => byId.get(id)!.neighbors.filter((n) => !isSea(byId.get(n)!));
  const seaNeighbors = (id: number): number[] => byId.get(id)!.neighbors.filter((n) => isSea(byId.get(n)!));

  it('has island provinces (Baleares, the Canaries, Ceuta and Melilla) linked to sea only', () => {
    const islands = land.filter((t) => landNeighbors(t.id).length === 0 && seaNeighbors(t.id).length >= 1);
    expect(islands.length).toBeGreaterThanOrEqual(5);
  });

  it('has landlocked provinces (for example Madrid) with land links only', () => {
    expect(land.some((t) => seaNeighbors(t.id).length === 0)).toBe(true);
  });

  it('has sea zones linked to other sea zones and touched by many provinces', () => {
    expect(sea.some((s) => seaNeighbors(s.id).length >= 1)).toBe(true);
    const touching = sea.filter((s) => land.some((t) => t.neighbors.includes(s.id)));
    expect(touching.length).toBe(7);
  });
});

describe('the Spain map rebuild is deterministic', () => {
  it(
    'succeeds twice from the committed inputs and writes the three artifacts each time',
    { timeout: TEST_TIMEOUT_MS },
    () => {
      const a = rebuild(tempA);
      const b = rebuild(tempB);
      expect(a.stderr).toBe('');
      expect(b.stderr).toBe('');
      expect(a.status).toBe(0);
      expect(b.status).toBe(0);
      expect(readdirSync(tempA).sort()).toStrictEqual(['ids.png', 'map.json', 'presentation.json']);
      expect(readdirSync(tempB).sort()).toStrictEqual(['ids.png', 'map.json', 'presentation.json']);
      expect(a.buildMs).toBeLessThan(BUILD_LIMIT_MS);
    },
  );

  it(
    'is byte-identical between the two builds',
    { timeout: TEST_TIMEOUT_MS },
    () => {
      expect(rebuild(tempA).status).toBe(0);
      expect(rebuild(tempB).status).toBe(0);
      for (const name of ['map.json', 'presentation.json', 'ids.png']) {
        expect(readFileSync(join(tempA, name)).equals(readFileSync(join(tempB, name)))).toBe(true);
      }
    },
  );

  it(
    'reproduces the committed map and presentation data byte for byte',
    { timeout: TEST_TIMEOUT_MS },
    () => {
      expect(rebuild(tempA).status).toBe(0);
      for (const name of ['map.json', 'presentation.json']) {
        expect(readFileSync(join(tempA, name)).equals(read(join(name)))).toBe(true);
      }
    },
  );

  it(
    'reproduces the committed id image pixel for pixel',
    { timeout: TEST_TIMEOUT_MS },
    () => {
      expect(rebuild(tempA).status).toBe(0);
      const fresh = decode(join(tempA, 'ids.png'));
      const stored = decode(join(committed, 'ids.png'));
      expect([fresh.width, fresh.height]).toStrictEqual([stored.width, stored.height]);
      expect(fresh.pixels.every((value, i) => value === stored.pixels[i])).toBe(true);
    },
  );
});

describe('the extraction box covers the Spain map frame', () => {
  it('every pixel centre of the outermost rows and columns lies inside the box', () => {
    const inputs = loadInputs();
    const box = JSON.parse(readFileSync(join(data, 'dev-map', 'extraction-box.json'), 'utf8')) as {
      west: number;
      south: number;
      east: number;
      north: number;
    };
    const byCode = new Map<string, SourceFeature>();
    for (const f of inputs.provinces) byCode.set(f.props['adm1_code'] as string, f);
    const vertices: [number, number][] = [];
    for (const t of inputs.grouping.territories) {
      for (const polygon of byCode.get(t.provinces[0]!)!.polygons) {
        vertices.push(...polygon.outer.coords);
        for (const hole of polygon.holes) vertices.push(...hole.coords);
      }
    }
    const { width, margin } = inputs.params;
    const center = projectionCenter(vertices);
    const frame = frameFor(
      vertices.map(([lon, lat]) => project(center, lon, lat)),
      margin,
    );
    const pixel = pixelSide(frame, width);
    for (let i = 0; i < width; i++) {
      for (const [x, y] of [
        [i, 0],
        [i, width - 1],
        [0, i],
        [width - 1, i],
      ] as const) {
        const [lon, lat] = unproject(center, frame.west + (x + 0.5) * pixel, frame.north - (y + 0.5) * pixel);
        expect(lon).toBeGreaterThanOrEqual(box.west);
        expect(lon).toBeLessThanOrEqual(box.east);
        expect(lat).toBeGreaterThanOrEqual(box.south);
        expect(lat).toBeLessThanOrEqual(box.north);
      }
    }
  });
});

describe('the Spain map files stay within the size limits', () => {
  const size = (file: string): number => statSync(file).size;

  it('keeps the id image at most 2 MB and the map and presentation data at most 500 KB together', () => {
    expect(size(join(committed, 'ids.png'))).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(size(join(committed, 'map.json')) + size(join(committed, 'presentation.json'))).toBeLessThanOrEqual(
      500 * 1000,
    );
  });

  it('keeps the committed source subset at most 10 MB', () => {
    const files = ['provinces.json', 'countries.json', 'other-land.json', 'source-meta.json'];
    const total = files.reduce((sum, f) => sum + size(join(data, 'natural-earth', f)), 0);
    expect(total).toBeLessThanOrEqual(10 * 1000 * 1000);
  });

  it('holds exactly the three package files (no preview)', () => {
    expect(readdirSync(committed).sort()).toStrictEqual(['ids.png', 'map.json', 'presentation.json']);
  });

  it('documents source, version and licence next to the data', () => {
    const note = readFileSync(join(data, 'README.md'), 'utf8');
    const meta = JSON.parse(readFileSync(join(data, 'natural-earth', 'source-meta.json'), 'utf8')) as {
      version: string;
    };
    expect(note).toContain(meta.version);
    for (const text of ['Natural Earth', 'public domain', 'Made with Natural Earth']) {
      expect(note).toContain(text);
    }
  });
});
