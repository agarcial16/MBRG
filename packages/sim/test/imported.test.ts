import { createRaster, setPixel } from '@mbrg/map-tools';
import { assembleMap, detectAdjacency, detectFlatColorRegions, traceContours } from '@mbrg/map-tools';
import { validateMap, type MapFormatV1 } from '@mbrg/shared';
import { describe, expect, it } from 'vitest';

import { createInitialMatch, simulate } from '../src/engine.js';

/**
 * End-to-end: an image goes in, a playable map comes out.
 *
 * The engine is the strictest consumer of a map, so running a simulated match
 * on an imported one is the test that matters. The image here is drawn with
 * ASCII art — one letter per flat colour — because a real bitmap does not
 * belong in a test: it would be a binary nobody can review in a diff.
 */
function rasterFromArt(art: string[], palette: Record<string, string | null>) {
  const width = art[0].length;
  const img = createRaster(width, art.length);
  for (let y = 0; y < art.length; y++) {
    for (let x = 0; x < width; x++) {
      const hex = palette[art[y][x]];
      if (hex === null) continue; // stays transparent
      const n = parseInt(hex.replace('#', ''), 16);
      setPixel(img, x, y, n, 255);
    }
  }
  return img;
}

function importMap(art: string[], palette: Record<string, string | null>, name = 'imported'): MapFormatV1 {
  const img = rasterFromArt(art, palette);
  const flat = detectFlatColorRegions(img, { minRegionArea: 1, tolerance: 16 });
  const adjacency = detectAdjacency(flat);
  const contours = traceContours(flat);
  const { map, errors } = assembleMap(flat, adjacency, contours, { name });
  expect(errors).toEqual([]);
  return map;
}

/**
 * Red with a lake inside it, green below, a blue enclave cut into the green,
 * and a yellow island out at sea. Covers every shape the importer has to get
 * right: a hole that is water, a hole that is another province, and a region
 * with no land border at all.
 */
const ART = [
  '..RRRR.....',
  '.RRRRRR....',
  'RRRRLLRR...',
  'RRRRLLRR...',
  'RRRRRRRR...',
  'GGGGGGGG...',
  'GBBBBGGG...',
  'GBBBBGGG...',
  'GGGGGG..Y..',
];
const PALETTE = {
  R: '#c0392b',
  G: '#27ae60',
  B: '#2980b9',
  Y: '#f1c40f',
  L: null, // the lake: transparent, like open sea
  '.': null,
};

describe('imported maps are playable', () => {
  const map = importMap(ART, PALETTE);

  it('produces a map that passes validation', () => {
    const { errors, warnings } = validateMap(map);
    expect(errors).toEqual([]);
    // The island is expected to be reported; anything else is a surprise.
    expect(warnings.every((w) => w.includes('no connections'))).toBe(true);
  });

  it('finds every region, with a lake hole and an enclave', () => {
    expect(map.territories).toHaveLength(4);
    // Red holds the lake (water) and green holds the blue enclave (land).
    const withHoles = map.territories.filter((t) => t.holes);
    expect(withHoles).toHaveLength(2);
  });

  it('an enclave hole is the same geometry as the enclave polygon', () => {
    // The whole point of tracing shared loops: green's hole and blue's outline
    // are the same corners, so the renderer draws no seam between them.
    const key = (ring: readonly (readonly [number, number])[]) =>
      [...ring].map((p) => p.join(',')).sort().join(' ');
    const green = map.territories.find((t) => t.id === 'p1')!;
    const blue = map.territories.find((t) => t.id === 'p2')!;
    expect(green.holes).toHaveLength(1);
    expect(key(green.holes![0])).toBe(key(blue.polygon));

    // The lake, on the other hand, belongs to no territory at all.
    const red = map.territories.find((t) => t.id === 'p0')!;
    expect(red.holes).toHaveLength(1);
    const lake = key(red.holes![0]);
    expect(map.territories.some((t) => key(t.polygon) === lake)).toBe(false);
  });

  it('starts a match and runs it to a single winner', () => {
    const match = createInitialMatch(map, { seed: 7 });
    expect(match.factions).toHaveLength(4);
    const finished = simulate(map, { seed: 7 });
    expect(finished.winner).not.toBeNull();
    // One round per faction lost.
    expect(finished.log).toHaveLength(3);
    const owners = Object.values(finished.log[finished.log.length - 1].owners);
    expect(new Set(owners).size).toBe(1);
  });

  it('is deterministic end to end: same image, same match', () => {
    const a = simulate(importMap(ART, PALETTE), { seed: 99 });
    const b = simulate(importMap(ART, PALETTE), { seed: 99 });
    expect(a.log).toEqual(b.log);
    expect(a.winner).toBe(b.winner);
  });

  it('gives neighbouring regions a symmetric, walkable graph', () => {
    for (const t of map.territories) {
      for (const n of t.neighbors) {
        const other = map.territories.find((x) => x.id === n);
        expect(other, `${t.id} → ${n} missing`).toBeDefined();
        expect(other!.neighbors).toContain(t.id);
      }
    }
  });

  it('never has two provinces of the same colour touching by a shared edge twice', () => {
    // Shared borders must appear exactly once per side, or the renderer would
    // stroke a seam where nothing changed hands.
    const shared = new Map<string, number>();
    for (const t of map.territories) {
      const rings = [t.polygon, ...(t.holes ?? [])];
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          const key = [a, b]
            .map((p) => p.join(','))
            .sort()
            .join('|');
          shared.set(key, (shared.get(key) ?? 0) + 1);
        }
      }
    }
    // Any edge may appear at most twice (once per side); three would be a
    // duplicate vertex in a polygon.
    for (const [key, count] of shared) {
      expect(count, `${key} appears ${count} times`).toBeLessThanOrEqual(2);
    }
  });
});
