import { describe, expect, it } from 'vitest';
import { validateMap } from '../src/validate';
import type { LandTerritory, MapData, SeaZone } from '../src/types';

const territory: LandTerritory = { id: 1, owner: 1, neighbors: [2] };
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

  it('FR-2 FR-57 a land territory is exactly id, owner and neighbors (kind optional)', () => {
    expect(Object.keys(territory).sort()).toStrictEqual(['id', 'neighbors', 'owner']);
    expect(validateMap(map)).toMatchObject({ ok: true });
    const tagged: LandTerritory = { ...territory, kind: 'land' };
    expect(Object.keys(tagged).sort()).toStrictEqual(['id', 'kind', 'neighbors', 'owner']);
  });

  it('FR-2 FR-57 dropping id, owner or neighbors from a land territory is shape-invalid', () => {
    const ids = ['id', 'neighbors'] as const;
    for (const field of ids) {
      const { [field]: _dropped, ...rest } = territory;
      expect(validateMap({ territories: [rest, map.territories[1]] }).ok, `without ${field}`).toBe(false);
    }
    const { owner: _owner, ...noOwner } = territory;
    expect(validateMap({ territories: [noOwner, map.territories[1]] }).ok, 'without owner').toBe(false);
  });

  it('FR-2 FR-57 a sea zone is exactly id, neighbors and kind sea, without owner', () => {
    const sea: SeaZone = { id: 3, neighbors: [1], kind: 'sea' };
    expect(Object.keys(sea).sort()).toStrictEqual(['id', 'kind', 'neighbors']);
    // @ts-expect-error a sea zone has no owner
    const withOwner: SeaZone = { ...sea, owner: 1 };
    expect(withOwner).toBeDefined();
  });
});
