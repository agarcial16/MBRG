import { describe, expect, it } from 'vitest';
import { entryKind, isSeaZone } from '../src/kinds';
import type { LandTerritory, MapEntry, SeaZone } from '../src/types';

describe('entry kind rule', () => {
  it('FR-58 no own kind field means land', () => {
    expect(entryKind({ id: 1, owner: 1, neighbors: [] })).toBe('land');
    expect(entryKind({})).toBe('land');
  });

  it('FR-58 the text land is land and the text sea is sea', () => {
    expect(entryKind({ kind: 'land' })).toBe('land');
    expect(entryKind({ kind: 'sea' })).toBe('sea');
  });

  it.each([
    ['own undefined', undefined],
    ['null', null],
    ['empty text', ''],
    ['Sea', 'Sea'],
    ['LAND', 'LAND'],
    ['neutral', 'neutral'],
    ['number', 1],
    ['boolean', true],
    ['list', []],
    ['object', {}],
  ])('FR-58 a present kind of %s is invalid', (_name, value) => {
    expect(entryKind({ kind: value })).toBe('invalid');
  });

  it('FR-58 an inherited kind is ignored and the entry is land', () => {
    const entry = Object.create({ kind: 'sea' }) as object;
    expect(entryKind(entry)).toBe('land');
    const bad = Object.create({ kind: 7 }) as object;
    expect(entryKind(bad)).toBe('land');
  });

  it('FR-57 isSeaZone narrows the entry union', () => {
    const land: LandTerritory = { id: 1, owner: 5, neighbors: [2] };
    const landTagged: LandTerritory = { id: 3, owner: 6, neighbors: [], kind: 'land' };
    const sea: SeaZone = { id: 2, neighbors: [1], kind: 'sea' };
    const entries: MapEntry[] = [land, landTagged, sea];
    expect(entries.map(isSeaZone)).toStrictEqual([false, false, true]);
    const owners = entries.map((e) => (isSeaZone(e) ? null : e.owner));
    expect(owners).toStrictEqual([5, 6, null]);
  });
});
