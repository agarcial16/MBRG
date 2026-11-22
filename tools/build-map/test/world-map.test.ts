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
import type { BuildInputs, InputName } from '../src/core/types';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const data = join(root, 'tools', 'build-map', 'data', 'world-countries');
const committed = join(root, 'maps', 'world-countries');

/** One world build is a full 4096 x 4096 raster of 242 admin-0 features; measured at ~16 s. */
const BUILD_LIMIT_MS = 180_000;
const TEST_TIMEOUT_MS = 600_000;

const tempA = mkdtempSync(join(tmpdir(), 'mbrg-world-a-'));
const tempB = mkdtempSync(join(tmpdir(), 'mbrg-world-b-'));
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

/** Faction codes in the builder's numbering order (code-unit order of the country code). */
function factionCodes(): string[] {
  const inputs = loadInputs();
  return [...new Set(inputs.grouping.countries.map((c) => c.country))].sort();
}

describe('the committed world map package: contents', () => {
  it('holds exactly 193 land territories, one per faction, and 7 sea zones', () => {
    const m = map();
    const land = m.territories.filter((e) => !isSea(e));
    const sea = m.territories.filter(isSea);
    expect(land.length).toBe(193);
    expect(sea.length).toBe(7);
    const owners = land.map((e) => (e as { owner: number }).owner);
    expect([...new Set(owners)].sort((a, b) => a - b)).toStrictEqual(
      Array.from({ length: 193 }, (_, i) => i + 1),
    );
    // Every faction owns exactly one territory and every land entry has a neighbor.
    expect(land.every((t) => t.neighbors.length > 0)).toBe(true);
  });

  it('has the 193 factions with Spanish names and the 7 world sea zones', () => {
    const p = presentation() as { factions: { id: number; name: string }[]; territories: { id: number; name: string }[] };
    expect(p.factions.map((f) => f.id)).toStrictEqual(Array.from({ length: 193 }, (_, i) => i + 1));
    expect(p.factions.every((f) => f.name.length > 0)).toBe(true);
    expect(new Set(p.factions.map((f) => f.name)).size).toBe(193);
    expect(p.factions[0]!.name).toBe('Afganistán');
    expect(p.factions[192]!.name).toBe('Zimbabue');
    const m = map();
    const seaNames = m.territories.filter(isSea).map((s) =>
      (p.territories.find((t) => t.id === s.id) as { name: string }).name,
    );
    expect(seaNames).toStrictEqual([
      'Océano Pacífico',
      'Océano Atlántico Norte',
      'Océano Atlántico Sur',
      'Océano Índico',
      'Océano Ártico',
      'Océano Antártico',
      'Mar Mediterráneo',
    ]);
  });

  it('is 4096 x 4096 with width 4096, margin 2% and S = 1 (no piece is ever removed)', { timeout: 60_000 }, () => {
    const image = decode(join(committed, 'ids.png'));
    expect([image.width, image.height]).toStrictEqual([4096, 4096]);
    expect(loadInputs().params).toStrictEqual({ width: 4096, margin: 0.02, minPieceSize: 1 });
  });

  it('is authored from one admin-0 feature per sovereign country, with documented exceptions', () => {
    const inputs = loadInputs();
    // The grouping selects 193 countries and assigns every province exactly once.
    expect(inputs.grouping.excluded).toStrictEqual([]);
    const listed = inputs.grouping.territories.flatMap((t) => t.provinces);
    expect(new Set(listed).size).toBe(listed.length);
    // Every country feature is its own province (the Spain trick in reverse), except the two
    // micro-state enclaves merged into the country that surrounds them.
    const byCode = new Map(inputs.provinces.map((f) => [String(f.props['adm1_code']), f]));
    for (const f of inputs.provinces) {
      const code = String(f.props['adm1_code']);
      const country = String(f.props['adm0_a3']);
      const expected = code === 'VAT' ? 'ITA' : code === 'MCO' ? 'FRA' : code;
      expect(country).toBe(expected);
    }
    expect(inputs.grouping.territories.find((t) => t.country === 'ITA')!.provinces).toStrictEqual(['ITA', 'VAT']);
    expect(inputs.grouping.territories.find((t) => t.country === 'FRA')!.provinces).toStrictEqual(['FRA', 'MCO']);
    // The two merged enclaves and the two omitted island micro-states are not factions.
    const codes = factionCodes();
    expect(codes.length).toBe(193);
    for (const code of ['VAT', 'MCO', 'NRU', 'TUV']) expect(codes.includes(code)).toBe(false);
    // The membership rule's edge cases: Israel, Palestine, Taiwan and Kosovo are factions;
    // Natural Earth's Somaliland and Northern Cyprus are background land, not factions.
    for (const code of ['ISR', 'PSX', 'TWN', 'KOS']) expect(codes.includes(code)).toBe(true);
    for (const code of ['SOL', 'CYN']) expect(codes.includes(code)).toBe(false);
    const background = new Set(inputs.otherLand.map((f) => String(f.props['adm0_a3'])));
    for (const code of ['NRU', 'TUV', 'SOL', 'CYN', 'ATA', 'GRL']) expect(background.has(code)).toBe(true);
    // The name records cover exactly the factions.
    const records = new Set(inputs.countries.map((r) => r.adm0_a3));
    expect([...records].sort()).toStrictEqual(codes);
  });

  it('keeps every country that rasterizes to at least one pixel (Maldives is the smallest kept)', { timeout: 60_000 }, () => {
    const image = decode(join(committed, 'ids.png'));
    const m = map();
    const codes = factionCodes();
    const maldives = codes.indexOf('MDV') + 1;
    let maldivesPixels = 0;
    for (const v of image.pixels) if (v === maldives) maldivesPixels++;
    expect(maldivesPixels).toBeGreaterThanOrEqual(1);
    expect(m.territories.filter((e) => !isSea(e)).length).toBe(193);
  });
});

describe('the committed world map package stays valid', () => {
  it('passes map validation', () => {
    expect(validateMap(map())).toMatchObject({ ok: true });
  });

  it('passes the presentation check', () => {
    expect(checkPresentation(map(), presentation())).toMatchObject({ ok: true });
  });

  it('is read without invalid-png and passes the id image check', { timeout: 60_000 }, () => {
    const image = decode(join(committed, 'ids.png'));
    expect(checkIdImage(map(), image.width, image.height, image.pixels)).toMatchObject({ ok: true });
  });

  it('is one connected map: every entry reachable through neighbors', () => {
    const m = map();
    const byId = new Map(m.territories.map((e) => [e.id, e]));
    const seen = new Set<number>([m.territories[0]!.id]);
    const queue = [m.territories[0]!.id];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const n of byId.get(id)!.neighbors) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    expect(seen.size).toBe(m.territories.length);
  });
});

describe('the committed world map package: planet shape', () => {
  const image = decode(join(committed, 'ids.png'));
  const m = map();
  const byId = new Map(m.territories.map((e) => [e.id, e]));
  const land = m.territories.filter((e) => !isSea(e)) as { id: number; owner: number; neighbors: number[] }[];
  const sea = m.territories.filter(isSea);
  const landNeighbors = (id: number): number[] => byId.get(id)!.neighbors.filter((n) => !isSea(byId.get(n)!));
  const seaNeighbors = (id: number): number[] => byId.get(id)!.neighbors.filter((n) => isSea(byId.get(n)!));

  it('has the square corners and edge midpoints as sea (the whole planet disk fits the frame)', { timeout: 60_000 }, () => {
    const width = image.width;
    const seaIds = new Set(sea.map((s) => s.id));
    const points: [number, number][] = [
      [0, 0], [width - 1, 0], [0, width - 1], [width - 1, width - 1],
      [Math.floor(width / 2), 0], [Math.floor(width / 2), width - 1],
      [0, Math.floor(width / 2)], [width - 1, Math.floor(width / 2)],
      [3, 3], [width - 4, 3], [3, width - 4], [width - 4, width - 4],
    ];
    for (const [x, y] of points) {
      expect(seaIds.has(image.pixels[y * width + x]!)).toBe(true);
    }
  });

  it('has island countries linked to the sea only and landlocked countries linked to land only', { timeout: 60_000 }, () => {
    const islands = land.filter((t) => landNeighbors(t.id).length === 0 && seaNeighbors(t.id).length >= 1);
    expect(islands.length).toBeGreaterThanOrEqual(20);
    const landlocked = land.filter((t) => seaNeighbors(t.id).length === 0);
    expect(landlocked.length).toBeGreaterThanOrEqual(20);
  });

  it('has sea zones linked to other sea zones and touched by many countries', () => {
    expect(sea.some((s) => seaNeighbors(s.id).length >= 1)).toBe(true);
    const touching = sea.filter((s) => land.some((t) => t.neighbors.includes(s.id)));
    expect(touching.length).toBe(7);
  });
});

describe('the world map rebuild is deterministic', () => {
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
        expect(readFileSync(join(tempA, name)).equals(read(name))).toBe(true);
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

describe('the frame covers the whole planet', () => {
  it('every outermost pixel centre is either outside the sphere or inside the world box', () => {
    const inputs = loadInputs();
    const box = JSON.parse(readFileSync(join(data, 'dev-map', 'extraction-box.json'), 'utf8')) as {
      west: number;
      south: number;
      east: number;
      north: number;
    };
    expect(box).toStrictEqual({ west: -180, south: -90, east: 180, north: 90 });

    const byCode = new Map(inputs.provinces.map((f) => [String(f.props['adm1_code']), f]));
    const vertices: [number, number][] = [];
    for (const t of inputs.grouping.territories) {
      for (const province of t.provinces) {
        const feature = byCode.get(province)!;
        for (const polygon of feature.polygons) {
          vertices.push(...polygon.outer.coords);
          for (const hole of polygon.holes) vertices.push(...hole.coords);
        }
      }
    }
    const { width, margin } = inputs.params;
    const center = projectionCenter(vertices);
    const frame = frameFor(
      vertices.map(([lon, lat]) => project(center, lon, lat)),
      margin,
    );
    const pixel = pixelSide(frame, width);
    let insideDisk = 0;
    for (let i = 0; i < width; i++) {
      for (const [x, y] of [
        [i, 0],
        [i, width - 1],
        [0, i],
        [width - 1, i],
      ] as const) {
        const px = frame.west + (x + 0.5) * pixel;
        const py = frame.north - (y + 0.5) * pixel;
        if (Math.hypot(px, py) > 2) continue; // outside the projected sphere: sea background
        insideDisk++;
        const [lon, lat] = unproject(center, px, py);
        expect(Number.isFinite(lon)).toBe(true);
        expect(Number.isFinite(lat)).toBe(true);
        expect(lon).toBeGreaterThanOrEqual(box.west);
        expect(lon).toBeLessThanOrEqual(box.east);
        expect(lat).toBeGreaterThanOrEqual(box.south);
        expect(lat).toBeLessThanOrEqual(box.north);
      }
    }
    // The frame border is nearly all outside the sphere (sea background); only the central
    // segment of the north edge stays on the planet, and those centres sit inside the box.
    expect(insideDisk).toBeGreaterThan(0);
    expect(insideDisk).toBeLessThan(width / 2);
  });
});

describe('the world map files stay within the size limits', () => {
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

  it('documents source, version, licence and the micro-country decisions next to the data', () => {
    const note = readFileSync(join(data, 'README.md'), 'utf8');
    const meta = JSON.parse(readFileSync(join(data, 'natural-earth', 'source-meta.json'), 'utf8')) as {
      version: string;
    };
    expect(note).toContain(meta.version);
    for (const text of ['Natural Earth', 'public domain', 'Made with Natural Earth', 'ne_50m_admin_0_countries']) {
      expect(note).toContain(text);
    }
    for (const text of ['Vatican', 'Monaco', 'Nauru', 'Tuvalu']) {
      expect(note).toContain(text);
    }
  });
});
