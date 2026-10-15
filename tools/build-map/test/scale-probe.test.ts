import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkIdImage, checkPresentation, validateMap } from '@mbrg/shared';
import { describe, expect, it } from 'vitest';
import { fromRgb } from '../src/core/png-check';
import type { BuildInputs, CountryRecord, InputName, SeaSeed, SourceFeature, SourcePolygon } from '../src/core/types';
import { runBuild } from '../src/cli/build';
import { realFs } from '../src/io/fs-ops';
import { pngCodec } from '../src/io/png-codec';
import { inputTexts } from './helpers/fixtures';

// Measurement only (plan section 12): one full build of a generated 2048 x 2048 map through
// `runBuild`. It asserts nothing about time; it logs buildMs and checksMs for the PR description.

const INPUT_FILES: Record<InputName, string> = {
  provinces: 'natural-earth/provinces.json',
  countries: 'natural-earth/countries.json',
  otherLand: 'natural-earth/other-land.json',
  meta: 'natural-earth/source-meta.json',
  grouping: 'dev-map/grouping.json',
  seeds: 'dev-map/sea-seeds.json',
  params: 'dev-map/params.json',
};

const COLS = 10;
const ROWS = 9;
const CELL = 4; // degrees
const WEST = -10;
const SOUTH = 35;
const POINTS_PER_EDGE = 700;

/** Deterministic hash in [0, 1). */
function hash(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

type Point = [number, number];

/**
 * The jagged polyline of one lattice edge, oriented west to east (horizontal) or south to north
 * (vertical). Both cells that share the edge use the same points, so borders have no gaps.
 */
function edge(kind: 'h' | 'v', i: number, j: number): Point[] {
  const points: Point[] = [];
  const phaseA = hash(i, j, kind === 'h' ? 1 : 2) * 6.283;
  const phaseB = hash(i, j, kind === 'h' ? 3 : 4) * 6.283;
  for (let k = 0; k <= POINTS_PER_EDGE; k++) {
    const t = k / POINTS_PER_EDGE;
    const envelope = Math.sin(Math.PI * t);
    const wobble = 0.35 * Math.sin(9 * t + phaseA) + 0.25 * Math.sin(31 * t + phaseB);
    const jitter = (hash(i * 7919 + k, j, kind === 'h' ? 5 : 6) - 0.5) * 0.04;
    const offset = envelope * (wobble + jitter);
    const x0 = WEST + i * CELL;
    const y0 = SOUTH + j * CELL;
    points.push(kind === 'h' ? [x0 + t * CELL, y0 + offset] : [x0 + offset, y0 + t * CELL]);
  }
  return points;
}

/** The closed ring of cell (i, j): south edge, east edge, north edge reversed, west edge reversed. */
function cellRing(i: number, j: number): Point[] {
  const south = edge('h', i, j);
  const east = edge('v', i + 1, j);
  const north = edge('h', i, j + 1).reverse();
  const west = edge('v', i, j).reverse();
  const ring = [...south, ...east.slice(1), ...north.slice(1), ...west.slice(1)];
  return ring; // the last point equals the first one: the ring is closed
}

function square(x: number, y: number, size: number): SourcePolygon {
  const coords: Point[] = [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y],
  ];
  return { outer: { coords }, holes: [] };
}

const EXTRA_LAKES: Point[] = [[0, 8], [9, 0], [0, 0], [9, 8], [5, 0], [9, 4]];

/** Cells left empty: they become sea zones (15 get a seed) or lakes (the rest, no seed). */
function isGap(i: number, j: number): boolean {
  if (EXTRA_LAKES.some(([a, b]) => a === i && b === j)) return true;
  return (i * 3 + j * 5) % 4 === 1 && i > 0 && j > 0 && i < COLS - 1 && j < ROWS - 1;
}

function probeInputs(): BuildInputs {
  const provinces: SourceFeature[] = [];
  const territories: BuildInputs['grouping']['territories'] = [];
  const seeds: SeaSeed[] = [];
  const gaps: Point[] = [];
  const countryCodes = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG'];
  let land = 0;
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      if (isGap(i, j)) {
        gaps.push([WEST + (i + 0.5) * CELL, SOUTH + (j + 0.5) * CELL]);
        continue;
      }
      const country = countryCodes[land % countryCodes.length]!;
      const code = `P-${String(land).padStart(3, '0')}`;
      const polygons: SourcePolygon[] = [{ outer: { coords: cellRing(i, j) }, holes: [] }];
      // every 7th province also owns an island east of the grid
      if (land % 7 === 0) polygons.push(square(WEST + COLS * CELL + 1.5, SOUTH + (land % ROWS) * 3, 1.2));
      provinces.push({ props: { adm1_code: code, adm0_a3: country, name: code, name_es: code }, polygons });
      territories.push({ key: `t${String(land).padStart(3, '0')}`, country, provinces: [code], name: `Territorio ${land}` });
      land++;
    }
  }
  // an excluded province far south of the grid, in a selected country
  provinces.push({
    props: { adm1_code: 'X-001', adm0_a3: 'AAA', name: 'X', name_es: 'X' },
    polygons: [square(WEST, SOUTH - 6, 1.5)],
  });
  gaps.slice(0, 15).forEach(([lon, lat], n) => seeds.push({ name: `Mar ${n + 1}`, lon, lat }));
  const countries: CountryRecord[] = countryCodes.map((adm0_a3) => ({ adm0_a3, name: adm0_a3, name_es: `Pais ${adm0_a3}` }));
  return {
    provinces,
    countries,
    otherLand: [
      { props: { adm0_a3: 'ZZA' }, polygons: [square(WEST - 6, SOUTH + 8, 5)] },
      { props: { adm0_a3: 'ZZB' }, polygons: [square(WEST + 5, SOUTH + ROWS * CELL + 0.5, 6)] },
      { props: { adm0_a3: 'ZZC' }, polygons: [square(WEST + COLS * CELL + 3, SOUTH + 2, 4)] },
    ],
    grouping: {
      countries: countryCodes.map((country) => ({ country })),
      territories,
      excluded: ['X-001'],
    },
    seeds,
    meta: { version: 'probe' },
    params: { width: 2048, margin: 0.02, minPieceSize: 40 },
  };
}

describe('scale probe of the builder at 2048 x 2048', () => {
  it('one full build through runBuild writes the package; timings are logged, not asserted', { timeout: 300_000 }, () => {
    const inputs = probeInputs();
    const vertices = inputs.provinces.reduce(
      (n, f) => n + f.polygons.reduce((m, p) => m + p.outer.coords.length, 0),
      0,
    );
    const root = mkdtempSync(join(tmpdir(), 'mbrg-scale-'));
    try {
      const texts = inputTexts(inputs);
      for (const name of Object.keys(INPUT_FILES) as InputName[]) {
        const file = join(root, 'tools', 'build-map', 'data', INPUT_FILES[name]);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, texts[name]);
      }

      let stdout = '';
      let stderr = '';
      const started = performance.now();
      const status = runBuild([], {
        fs: realFs,
        codec: pngCodec,
        root,
        stdout: (s) => (stdout += s),
        stderr: (s) => (stderr += s),
      });
      const buildMs = performance.now() - started;
      expect(stderr).toBe('');
      expect(status).toBe(0);

      const out = join(root, 'maps', 'dev');
      const map = JSON.parse(readFileSync(join(out, 'map.json'), 'utf8')) as unknown;
      const presentation = JSON.parse(readFileSync(join(out, 'presentation.json'), 'utf8')) as unknown;
      const decoded = pngCodec.decode(new Uint8Array(readFileSync(join(out, 'ids.png'))));
      if (!decoded.ok) throw new Error('the written PNG should decode');
      const pixels = fromRgb(decoded.value.rgb);
      const checkStarted = performance.now();
      const mapResult = validateMap(map);
      const presentationResult = mapResult.ok ? checkPresentation(map, presentation) : mapResult;
      const imageResult = mapResult.ok ? checkIdImage(map, decoded.value.width, decoded.value.height, pixels) : mapResult;
      const checksMs = performance.now() - checkStarted;
      expect(mapResult.ok).toBe(true);
      expect(presentationResult.ok).toBe(true);
      expect(imageResult.ok).toBe(true);

      const territories = (map as { territories: unknown[] }).territories.length;
      console.log(
        `scale-probe ${JSON.stringify({
          width: decoded.value.width,
          vertices,
          entries: territories,
          buildMs: Math.round(buildMs),
          checksMs: Math.round(checksMs),
          report: stdout
            .split('\n')
            .filter((l) => /^(factions|landTerritories|seaZones|reassignedPieces):/.test(l)),
        })}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
