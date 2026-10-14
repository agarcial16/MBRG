import { describe, expect, it } from 'vitest';
import { validateMap } from '@mbrg/shared';
import type { MapEntry } from '@mbrg/shared';
import { getRounds, getState, totalRounds } from '../src/index';

// Plan section 8: land i = 0..499 has id i+1 and owner i+1; sea k = 0..99 has id 501+k.
const LAND = 500;
const seaId = (k: number): number => LAND + 1 + k;

function seaScaleMap() {
  const territories: MapEntry[] = [];
  for (let i = 0; i < LAND; i++) territories.push({ id: i + 1, owner: i + 1, neighbors: [seaId(Math.floor(i / 5))] });
  for (let k = 0; k < 100; k++) {
    const row = Math.floor(k / 10);
    const col = k % 10;
    const neighbors: number[] = [];
    if (row > 0) neighbors.push(seaId(k - 10));
    if (col > 0) neighbors.push(seaId(k - 1));
    if (col < 9) neighbors.push(seaId(k + 1));
    if (row < 9) neighbors.push(seaId(k + 10));
    for (let i = 5 * k; i < 5 * k + 5; i++) neighbors.push(i + 1);
    territories.push({ id: seaId(k), kind: 'sea', neighbors });
  }
  return { territories };
}

describe('NFR-11 scale with sea', () => {
  it('NFR-11 the 500-land 100-zone map is valid and has no land-to-land link', () => {
    const map = seaScaleMap();
    expect(map.territories).toHaveLength(600);
    expect(validateMap(map).ok).toBe(true);
    for (const t of map.territories.slice(0, LAND)) {
      expect(t.neighbors).toHaveLength(1);
      expect(t.neighbors[0]).toBeGreaterThan(LAND);
    }
  });

  it('NFR-11 validating and playing the full match takes under 1000 ms', () => {
    const map = seaScaleMap();
    const start = performance.now();
    const v = validateMap(map);
    const t = totalRounds(map);
    const rounds = getRounds(map, 12345, 499);
    const state = getState(map, 12345, 499);
    const elapsed = performance.now() - start;
    console.log(`NFR-11 elapsed ${elapsed.toFixed(1)} ms`);
    expect(v.ok).toBe(true);
    expect(t.ok && t.value).toBe(499);
    expect(rounds.ok && rounds.value).toHaveLength(499);
    expect(state.ok && new Set(state.value.owners.map(([, f]) => f)).size).toBe(1);
    expect(elapsed).toBeLessThan(1000);
  });
});
