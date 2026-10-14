import { describe, expect, it } from 'vitest';
import { validateMap } from '@mbrg/shared';
import { getRounds, getState, totalRounds } from '../src/index';
import { gridMap } from './helpers/maps';

describe('NFR-3 scale', () => {
  it('NFR-3 validating and playing a full 500-territory 20x25 grid match takes under 1000 ms', () => {
    const map = gridMap(20, 25);
    expect(map.territories).toHaveLength(500);
    const start = performance.now();
    const v = validateMap(map);
    const t = totalRounds(map);
    expect(v.ok).toBe(true);
    expect(t.ok && t.value).toBe(499);
    const rounds = getRounds(map, 12345, 499);
    const state = getState(map, 12345, 499);
    const elapsed = performance.now() - start;
    expect(rounds.ok && rounds.value).toHaveLength(499);
    expect(state.ok && new Set(state.value.owners.map(([, f]) => f)).size).toBe(1);
    expect(elapsed).toBeLessThan(1000);
  });
});
