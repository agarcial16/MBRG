import { describe, expect, it } from 'vitest';
import { WATER } from '../src/core/rasterize';
import { assignSeaZones, assignSeaZonesDetailed } from '../src/core/sea';

/** '.' water, 'o' background (0), a digit = land territory id. */
function grid(rows: string[]): { width: number; pixels: Uint32Array } {
  const width = rows.length;
  const pixels = new Uint32Array(width * width);
  rows.forEach((row, y) => {
    expect(row.length).toBe(width);
    [...row].forEach((ch, x) => {
      pixels[y * width + x] = ch === '.' ? WATER : ch === 'o' ? 0 : Number(ch);
    });
  });
  return { width, pixels };
}

/** A square of land with the given water pixels cut out. */
function landWith(width: number, water: [number, number][]): { width: number; pixels: Uint32Array } {
  const rows = Array.from({ length: width }, () => '1'.repeat(width).split(''));
  for (const [x, y] of water) rows[y]![x] = '.';
  return grid(rows.map((r) => r.join('')));
}

function show(pixels: Uint32Array, width: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < width; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const v = pixels[y * width + x]!;
      row += v === WATER ? '.' : v === 0 ? 'o' : String(v);
    }
    rows.push(row);
  }
  return rows;
}

/** A small deterministic generator (no Math.random: the builder tests stay reproducible). */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** FR-162 by brute force: one BFS per seed, enclosed sets by flood fill, all pairs of pixels. */
function bruteForce(width: number, pixels: Uint32Array, seeds: { x: number; y: number }[], ids: number[]): Uint32Array {
  const n = width * width;
  const near = (p: number): number[] => {
    const x = p % width;
    const out: number[] = [];
    if (p >= width) out.push(p - width);
    if (p + width < n) out.push(p + width);
    if (x > 0) out.push(p - 1);
    if (x < width - 1) out.push(p + 1);
    return out;
  };
  const dist = seeds.map((seed) => {
    const d = new Int32Array(n).fill(-1);
    const queue = [seed.y * width + seed.x];
    d[queue[0]!] = 0;
    for (let h = 0; h < queue.length; h++) {
      for (const q of near(queue[h]!)) {
        if (pixels[q] === WATER && d[q] === -1) {
          d[q] = d[queue[h]!]! + 1;
          queue.push(q);
        }
      }
    }
    return d;
  });
  const label = new Int32Array(n).fill(-1);
  for (let p = 0; p < n; p++) {
    let best = -1;
    for (let i = 0; i < seeds.length; i++) {
      const d = dist[i]![p]!;
      if (d >= 0 && (best === -1 || d < dist[best]![p]!)) best = i;
    }
    label[p] = best;
  }
  const out = pixels.slice();
  for (let p = 0; p < n; p++) if (label[p] !== -1) out[p] = ids[label[p]!]!;
  const seen = new Uint8Array(n);
  for (let start = 0; start < n; start++) {
    if (pixels[start] !== WATER || label[start] !== -1 || seen[start]) continue;
    const set = [start];
    seen[start] = 1;
    for (let h = 0; h < set.length; h++) {
      for (const q of near(set[h]!)) {
        if (pixels[q] === WATER && label[q] === -1 && !seen[q]) {
          seen[q] = 1;
          set.push(q);
        }
      }
    }
    let bestD = Infinity;
    let bestZone = -1;
    for (const p of set) {
      for (let q = 0; q < n; q++) {
        if (label[q] === -1) continue;
        const d = ((p % width) - (q % width)) ** 2 + (Math.floor(p / width) - Math.floor(q / width)) ** 2;
        if (d < bestD || (d === bestD && label[q]! < bestZone)) {
          bestD = d;
          bestZone = label[q]!;
        }
      }
    }
    for (const p of set) out[p] = ids[bestZone]!;
  }
  return out;
}

describe('FR-162 enclosed water joins the nearest sea zone', () => {
  it('FR-162 and FR-164 a lake inside land becomes sea of the nearest zone, never background', () => {
    const { width, pixels } = grid(['.1111', '.1111', '.1.11', '.1111', '.1111']);
    const out = assignSeaZones(width, pixels, [{ x: 0, y: 0 }], [7]);
    expect(show(out, width)).toStrictEqual(['71111', '71111', '71711', '71111', '71111']);
  });

  it('FR-162 the whole enclosed set goes to the zone of its closest pixel, not pixel by pixel', () => {
    // Zone A (id 7) at x=0 and zone B (id 8) at x=10 on row 5; the set spans x=3..5. Its pixel x=3 is
    // 3 from A, its pixel x=5 is 5 from B: the nearest pair is (x=3, A), so the whole set joins A.
    const { width, pixels } = landWith(11, [[0, 5], [3, 5], [4, 5], [5, 5], [10, 5]]);
    const out = assignSeaZones(width, pixels, [{ x: 0, y: 5 }, { x: 10, y: 5 }], [7, 8]);
    expect(show(out, width)[5]).toBe('71177711118');
  });

  it('FR-162 distance is straight (Euclidean), not Manhattan', () => {
    // The lake at (0,0). Zone A's pixel (3,3): squared distance 18, Manhattan 6. Zone B's pixel (0,5):
    // squared distance 25, Manhattan 5. The straight line picks A (id 7); Manhattan would pick B.
    const { width, pixels } = landWith(9, [[0, 0], [3, 3], [0, 5]]);
    const out = assignSeaZones(width, pixels, [{ x: 3, y: 3 }, { x: 0, y: 5 }], [7, 8]);
    expect(out[0]).toBe(7);
  });

  it('FR-162 a tie between two zones goes to the zone of the seed listed first, not the first in the image', () => {
    const { width, pixels } = landWith(5, [[0, 2], [2, 2], [4, 2]]);
    // The lake (2,2) is 2 from (0,2) and 2 from (4,2). Seed 0 is the right pixel, seed 1 the left one.
    const first = assignSeaZones(width, pixels, [{ x: 4, y: 2 }, { x: 0, y: 2 }], [7, 8]);
    expect(first[2 * width + 2]).toBe(7);
    expect(first[2 * width]).toBe(8);
    const second = assignSeaZones(width, pixels, [{ x: 0, y: 2 }, { x: 4, y: 2 }], [7, 8]);
    expect(second[2 * width + 2]).toBe(7);
    expect(second[2 * width + 4]).toBe(8);
  });

  it('FR-162 an enclosed set measures only to the zones of the seed search, never to another enclosed set', () => {
    // Row 5: A seed at x=0, lake L1 at x=2, lake L2 at x=6, B seed at x=9. L2 is 4 from L1 (given to A)
    // but 6 from A and 3 from B: it must join B.
    const { width, pixels } = landWith(11, [[0, 5], [2, 5], [6, 5], [9, 5]]);
    const out = assignSeaZones(width, pixels, [{ x: 0, y: 5 }, { x: 9, y: 5 }], [7, 8]);
    expect(out[5 * width + 2]).toBe(7);
    expect(out[5 * width + 6]).toBe(8);
  });

  it('FR-162 and FR-164 land, other land and background pixels are unchanged and the input is not modified', () => {
    const { width, pixels } = grid(['1o..', '.2.1', '..3.', '..1.']);
    const before = [...pixels];
    const out = assignSeaZones(width, pixels, [{ x: 3, y: 0 }], [9]);
    expect([...pixels]).toStrictEqual(before);
    for (let i = 0; i < out.length; i++) {
      if (before[i] !== WATER) expect(out[i]).toBe(before[i]);
      else expect(out[i]).toBe(9);
    }
  });

  it('FR-162 the enclosed sets are listed with their pixel count and zone id, in row-major order of their first pixel', () => {
    // Zones A (0,4) id 7 and B (8,4) id 8; a lake at (7,1) near B, two pixels at (1,7),(2,7) near A.
    const { width, pixels } = landWith(9, [[0, 4], [8, 4], [7, 1], [1, 7], [2, 7]]);
    const detailed = assignSeaZonesDetailed(width, pixels, [{ x: 0, y: 4 }, { x: 8, y: 4 }], [7, 8]);
    expect(detailed.enclosed).toStrictEqual([
      { zone: 8, pixels: 1 },
      { zone: 7, pixels: 2 },
    ]);
    expect([...detailed.pixels]).toStrictEqual([...assignSeaZones(width, pixels, [{ x: 0, y: 4 }, { x: 8, y: 4 }], [7, 8])]);
  });

  it('FR-162 a water pixel that touches the seed region only by a corner is enclosed water', () => {
    const { width, pixels } = grid(['.1...', '1.111', '11111', '11111', '11111']);
    const detailed = assignSeaZonesDetailed(width, pixels, [{ x: 0, y: 0 }], [7]);
    expect(detailed.enclosed).toStrictEqual([
      { zone: 7, pixels: 3 },
      { zone: 7, pixels: 1 },
    ]);
    expect(show(detailed.pixels, width)).toStrictEqual(['71777', '17111', '11111', '11111', '11111']);
  });

  it('FR-162 with no enclosed water the list is empty and every water pixel is the seed search result', () => {
    const { width, pixels } = grid(['....', '....', '....', '....']);
    const detailed = assignSeaZonesDetailed(width, pixels, [{ x: 0, y: 0 }], [7]);
    expect(detailed.enclosed).toStrictEqual([]);
    expect([...detailed.pixels]).toStrictEqual(new Array<number>(16).fill(7));
  });

  it('FR-162 with no seed at all the water is left as water (nothing to join)', () => {
    const { width, pixels } = grid(['..', '.1']);
    const out = assignSeaZones(width, pixels, [], []);
    expect([...out]).toStrictEqual([...pixels]);
  });

  it('FR-162 and FR-164 the search equals an all-pairs brute force on 300 random fixtures and no water stays background', () => {
    const random = lcg(20261016);
    let checkedSets = 0;
    for (let round = 0; round < 300; round++) {
      const width = 10 + Math.floor(random() * 7);
      const pixels = new Uint32Array(width * width);
      const land = 0.35 + random() * 0.3;
      for (let i = 0; i < pixels.length; i++) pixels[i] = random() < land ? 1 : random() < 0.08 ? 0 : WATER;
      const water: number[] = [];
      pixels.forEach((v, i) => {
        if (v === WATER) water.push(i);
      });
      if (water.length < 2) continue;
      const count = 1 + Math.floor(random() * Math.min(3, water.length));
      const chosen: number[] = [];
      while (chosen.length < count) {
        const p = water[Math.floor(random() * water.length)]!;
        if (!chosen.includes(p)) chosen.push(p);
      }
      const seeds = chosen.map((p) => ({ x: p % width, y: Math.floor(p / width) }));
      const ids = chosen.map((_, i) => 7 + i);
      const detailed = assignSeaZonesDetailed(width, pixels, seeds, ids);
      expect([...detailed.pixels], `fixture ${round}`).toStrictEqual([...bruteForce(width, pixels, seeds, ids)]);
      for (let i = 0; i < pixels.length; i++) {
        if (pixels[i] === WATER) expect(detailed.pixels[i], `fixture ${round} pixel ${i}`).toBeGreaterThan(0);
      }
      checkedSets += detailed.enclosed.length;
    }
    expect(checkedSets, 'the random fixtures must contain enclosed water').toBeGreaterThan(100);
  });
});
