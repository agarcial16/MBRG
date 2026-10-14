import { describe, expect, it } from 'vitest';
import { validateMap } from '../src/validate';
import type { MapData, Territory } from '../src/types';

const territory: Territory = { id: 1, owner: 1, neighbors: [2] };
const map: MapData = {
  territories: [territory, { id: 2, owner: 2, neighbors: [1] }],
};

describe('map shape', () => {
  it('FR-1 a map is exactly one field, territories, holding a list', () => {
    expect(Object.keys(map)).toStrictEqual(['territories']);
    expect(Array.isArray(map.territories)).toBe(true);
    expect(validateMap(map)).toStrictEqual({ ok: true, value: map });
    expect(validateMap({ territories: map.territories, extra: 1 })).toMatchObject({ ok: false });
  });

  it('FR-1 a map without territories is rejected', () => {
    expect(validateMap({})).toMatchObject({ ok: false });
  });

  it('FR-2 a territory is exactly id, owner and neighbors', () => {
    expect(Object.keys(territory).sort()).toStrictEqual(['id', 'neighbors', 'owner']);
    expect(validateMap(map)).toMatchObject({ ok: true });
  });

  it('FR-2 dropping any of the three fields invalidates the map', () => {
    for (const field of ['id', 'owner', 'neighbors'] as const) {
      const { [field]: _dropped, ...rest } = territory;
      const result = validateMap({ territories: [rest, map.territories[1]] });
      expect(result.ok, `without ${field}`).toBe(false);
    }
  });
});
