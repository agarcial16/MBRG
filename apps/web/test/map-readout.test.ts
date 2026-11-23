import { describe, expect, it } from 'vitest';
import type { FactionId, TerritoryId } from '@mbrg/shared';
import { buildEntryIndex } from '../src/core/entries';
import { mapReadout } from '../src/core/map-readout';
import { DEV_MAP, DEV_PRESENTATION } from './helpers/dev-map';

describe('spec 032 FR-625 FR-627 map hover/tap full-name readout', () => {
  const landA = DEV_MAP.territories.find((t) => t.kind !== 'sea')!;
  const landB = DEV_MAP.territories.find((t) => t.kind !== 'sea' && t.id !== landA.id)!;
  const sea = DEV_MAP.territories.find((t) => t.kind === 'sea');
  const facA = DEV_PRESENTATION.factions[0]!;
  const facB = DEV_PRESENTATION.factions[1]!;

  const grid = [
    0, landA.id, landB.id, sea ? sea.id : 0,
    0, landA.id, landB.id, 0,
  ];
  const index = buildEntryIndex(DEV_MAP, 4, 2, grid);
  const owners = new Map<TerritoryId, FactionId>([
    [landA.id, facA.id],
    [landB.id, facB.id],
  ]);

  it('FR-625 returns both full territory name and full faction name for any owned land territory', () => {
    const info = mapReadout(index, owners, DEV_PRESENTATION, { x: 1.5, y: 0.5 });
    const terName = DEV_PRESENTATION.territories.find((t) => t.id === landA.id)!.name;
    expect(info).toStrictEqual({ territory: terName, faction: facA.name });
  });

  it('FR-625 returns undefined outside the map, on background, or on sea', () => {
    expect(mapReadout(index, owners, DEV_PRESENTATION, { x: -1, y: 0.5 })).toBeUndefined();
    expect(mapReadout(index, owners, DEV_PRESENTATION, { x: 0.5, y: 0.5 })).toBeUndefined();
    expect(mapReadout(index, owners, DEV_PRESENTATION, { x: 3.5, y: 0.5 })).toBeUndefined();
    expect(mapReadout(index, owners, DEV_PRESENTATION, { x: 10, y: 10 })).toBeUndefined();
  });

  it('FR-627 returns undefined when owners are absent or while a reveal hides the state', () => {
    expect(mapReadout(index, undefined, DEV_PRESENTATION, { x: 1.5, y: 0.5 })).toBeUndefined();
    expect(mapReadout(index, owners, DEV_PRESENTATION, { x: 1.5, y: 0.5 }, true)).toBeUndefined();
  });
});
