import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkIdImage, checkPresentation, validateMap } from '@mbrg/shared';
import type { MapData } from '@mbrg/shared';
import { describe, expect, it } from 'vitest';
import { frameFor, pixelSide, project, projectionCenter, unproject } from '../src/core/projection';
import { fromRgb } from '../src/core/png-check';
import type { BuildInputs, InputName, SourceFeature } from '../src/core/types';
import { parseBuildInputs } from '../src/core/parse-inputs';
import { realFs } from '../src/io/fs-ops';
import { pngCodec } from '../src/io/png-codec';
import { readInputTexts } from '../src/io/read-inputs';

const here = dirname(fileURLToPath(import.meta.url));
const builderData = join(here, '..', 'data');
const devMap = join(here, '..', '..', '..', 'maps', 'dev');

const read = (name: string): Buffer => readFileSync(join(devMap, name));
const map = (): MapData => JSON.parse(read('map.json').toString('utf8')) as MapData;
const presentation = (): unknown => JSON.parse(read('presentation.json').toString('utf8'));

function loadInputs(): BuildInputs {
  const texts = readInputTexts(builderData, realFs) as Record<InputName, string>;
  const parsed = parseBuildInputs(texts);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.value;
}

function decodeImage(): { width: number; height: number; pixels: Uint32Array } {
  const decoded = pngCodec.decode(new Uint8Array(read('ids.png')));
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.errors));
  return { width: decoded.value.width, height: decoded.value.height, pixels: fromRgb(decoded.value.rgb) };
}

const isSea = (e: { kind?: string }): boolean => e.kind === 'sea';

describe('FR-127 the committed dev map package: contents', () => {
  it('FR-127 the package has exactly 70 land territories in 5 factions and 10 to 20 sea zones', () => {
    const m = map();
    const land = m.territories.filter((e) => !isSea(e));
    const sea = m.territories.filter(isSea);
    expect(land.length).toBe(70);
    expect(sea.length).toBeGreaterThanOrEqual(10);
    expect(sea.length).toBeLessThanOrEqual(20);
    const owners = new Set(land.map((e) => (e as { owner: number }).owner));
    expect([...owners].sort((a, b) => a - b)).toStrictEqual([1, 2, 3, 4, 5]);
  });

  it('FR-127 the factions are DEU, ESP, FRA, ITA, PRT with ids 1..5 and no preferred colour', () => {
    const p = presentation() as { factions: { id: number; name: string; color?: string }[] };
    expect(p.factions.map((f) => f.id)).toStrictEqual([1, 2, 3, 4, 5]);
    expect(p.factions.every((f) => f.color === undefined)).toBe(true);
    const inputs = loadInputs();
    expect(inputs.grouping.countries.map((c) => c.country)).toStrictEqual(['DEU', 'ESP', 'FRA', 'ITA', 'PRT']);
  });

  it('FR-127 the image is 2048 x 2048 and the parameters are width 2048, margin 2%, S = 40', () => {
    const image = decodeImage();
    expect([image.width, image.height]).toStrictEqual([2048, 2048]);
    expect(loadInputs().params).toStrictEqual({ width: 2048, margin: 0.02, minPieceSize: 40 });
  });

  it('FR-127 the territory names of the presentation data are non-empty and the lists match the map', () => {
    const p = presentation() as { territories: { id: number; name: string }[] };
    const ids = map().territories.map((e) => e.id);
    expect(p.territories.map((t) => t.id)).toStrictEqual(ids);
    expect(p.territories.every((t) => t.name.length > 0)).toBe(true);
  });
});

describe('FR-128 the committed dev map package stays valid', () => {
  it('FR-128 map validation reports no error', () => {
    expect(validateMap(map())).toMatchObject({ ok: true });
  });

  it('FR-128 the presentation data passes the presentation check', () => {
    expect(checkPresentation(map(), presentation())).toMatchObject({ ok: true });
  });

  it('FR-128 the committed PNG is read without invalid-png and passes the id image check', () => {
    const image = decodeImage();
    expect(checkIdImage(map(), image.width, image.height, image.pixels)).toMatchObject({ ok: true });
  });
});

describe('FR-129 the dev map exercises spec 002', () => {
  const m = map();
  const byId = new Map(m.territories.map((e) => [e.id, e]));
  const land = m.territories.filter((e) => !isSea(e)) as { id: number; owner: number; neighbors: number[] }[];
  const sea = m.territories.filter(isSea);
  const landNeighbors = (id: number): number[] => byId.get(id)!.neighbors.filter((n) => !isSea(byId.get(n)!));
  const seaNeighbors = (id: number): number[] => byId.get(id)!.neighbors.filter((n) => isSea(byId.get(n)!));

  it('FR-129 at least one island: no land link and at least one sea zone link', () => {
    expect(land.some((t) => landNeighbors(t.id).length === 0 && seaNeighbors(t.id).length >= 1)).toBe(true);
  });

  it('FR-129 at least one faction whose land territories are not all connected through its own land', () => {
    const owners = [...new Set(land.map((t) => t.owner))];
    const split = owners.some((owner) => {
      const own = land.filter((t) => t.owner === owner).map((t) => t.id);
      const seen = new Set<number>([own[0]!]);
      const stack = [own[0]!];
      while (stack.length > 0) {
        for (const n of landNeighbors(stack.pop()!)) {
          if (own.includes(n) && !seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
      }
      return seen.size < own.length;
    });
    expect(split).toBe(true);
  });

  it('FR-129 at least one landlocked land territory (no sea zone link)', () => {
    expect(land.some((t) => seaNeighbors(t.id).length === 0)).toBe(true);
  });

  it('FR-129 at least one sea zone touched by 2 or more factions', () => {
    const touched = sea.some(
      (s) => new Set(land.filter((t) => t.neighbors.includes(s.id)).map((t) => t.owner)).size >= 2,
    );
    expect(touched).toBe(true);
  });

  it('FR-129 at least one sea zone linked to another sea zone', () => {
    expect(sea.some((s) => seaNeighbors(s.id).length >= 1)).toBe(true);
  });
});

describe('FR-131 the extraction box covers the dev map frame', () => {
  it('FR-131 every pixel centre of the outermost rows and columns lies inside the extraction box', () => {
    const inputs = loadInputs();
    const box = JSON.parse(readFileSync(join(builderData, 'dev-map', 'extraction-box.json'), 'utf8')) as {
      west: number;
      south: number;
      east: number;
      north: number;
    };
    const byCode = new Map<string, SourceFeature>();
    for (const f of inputs.provinces) {
      const code = f.props['adm1_code'];
      if (typeof code === 'string' && !byCode.has(code)) byCode.set(code, f);
    }
    // The same vertices as the builder frame: the provinces of the land territories.
    const vertices: [number, number][] = [];
    for (const t of inputs.grouping.territories) {
      for (const code of t.provinces) {
        for (const polygon of byCode.get(code)!.polygons) {
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
    let checked = 0;
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
        checked++;
      }
    }
    expect(checked).toBe(4 * width);
  });
});

describe('NFR-17 the committed files stay within the size limits', () => {
  const size = (file: string): number => statSync(file).size;

  it('NFR-17 the id image is at most 2 MB', () => {
    expect(size(join(devMap, 'ids.png'))).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('NFR-17 the map and presentation data together are at most 500 KB', () => {
    expect(size(join(devMap, 'map.json')) + size(join(devMap, 'presentation.json'))).toBeLessThanOrEqual(500 * 1000);
  });

  it('NFR-17 the committed source data is at most 10 MB', () => {
    const files = ['provinces.json', 'countries.json', 'other-land.json', 'source-meta.json'];
    const total = files.reduce((sum, f) => sum + size(join(builderData, 'natural-earth', f)), 0);
    expect(total).toBeLessThanOrEqual(10 * 1000 * 1000);
  });

  it('NFR-17 the package directory holds exactly the three package files (no preview)', () => {
    const names = ['map.json', 'presentation.json', 'ids.png'];
    for (const n of names) expect(size(join(devMap, n))).toBeGreaterThan(0);
    expect(readdirSync(devMap).slice().sort()).toStrictEqual([...names].sort());
  });
});

describe('NFR-21 the provenance note', () => {
  const note = readFileSync(join(builderData, 'natural-earth', 'PROVENANCE.md'), 'utf8');

  it('NFR-21 the note contains the version string of the committed source metadata record', () => {
    const meta = JSON.parse(readFileSync(join(builderData, 'natural-earth', 'source-meta.json'), 'utf8')) as {
      version: string;
    };
    expect(meta.version.length).toBeGreaterThan(0);
    expect(note).toContain(meta.version);
  });

  it('NFR-21 the note states source, box, rounding, extraction command, Portugal approximation and licence', () => {
    for (const text of [
      'Natural Earth',
      'extraction box',
      'rounding',
      'npm run extract',
      'Portugal',
      'Made with Natural Earth',
    ]) {
      expect(note.toLowerCase()).toContain(text.toLowerCase());
    }
  });

  it('NFR-21 the build report prints the same version as the committed metadata record', () => {
    expect(loadInputs().meta.version).toBe(
      (JSON.parse(readFileSync(join(builderData, 'natural-earth', 'source-meta.json'), 'utf8')) as { version: string }).version,
    );
  });
});
