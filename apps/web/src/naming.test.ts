import { describe, expect, it } from 'vitest';

import type { MapFormatV1, Territory } from '@mbrg/shared';
import { applyNames, cleanName, MAX_NAME_LENGTH } from '../src/naming.js';

function mapOf(...ids: string[]): MapFormatV1 {
  const territories: Territory[] = ids.map((id) => ({
    id,
    // What the importer writes: the id doubles as the placeholder name, so
    // "has a name" is just "name differs from id".
    name: id,
    polygon: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    neighbors: ids.filter((other) => other !== id).sort(),
  }));
  return { version: 1, name: 'test', width: 100, height: 100, territories };
}

describe('cleanName', () => {
  it('trims and collapses whitespace, so pasted text does not break a label', () => {
    expect(cleanName('  Castilla \n la  Nueva ')).toBe('Castilla la Nueva');
    expect(cleanName('A\t\tB')).toBe('A B');
  });

  it('returns null for nothing, so the caller falls back to the id', () => {
    expect(cleanName('')).toBeNull();
    expect(cleanName('    ')).toBeNull();
    expect(cleanName('\n\t')).toBeNull();
  });

  it('caps the length: a name longer than its province is a wall of letters', () => {
    const long = 'Supercalifragilisticoespialidoso';
    expect(cleanName(long)).toHaveLength(MAX_NAME_LENGTH);
  });
});

describe('applyNames', () => {
  it('writes names into the territories and leaves the rest of the map alone', () => {
    const before = mapOf('a', 'b');
    const { map, kept } = applyNames(before, new Map([['a', 'Aurelia']]));
    expect(map.territories.map((t) => t.name)).toEqual(['Aurelia', 'b']);
    expect(map.width).toBe(before.width);
    expect(map.territories[0].polygon).toEqual(before.territories[0].polygon);
    expect(kept).toBe(1);
  });

  it('does not mutate the input: detection re-runs under the names', () => {
    const before = mapOf('a', 'b');
    applyNames(before, new Map([['a', 'Aurelia']]));
    expect(before.territories[0].name).toBe('a');
  });

  it('reports the names whose province disappeared after a parameter change', () => {
    const { map, kept, dropped } = applyNames(mapOf('a'), new Map([['a', 'A'], ['z', 'Z']]));
    expect(map.territories[0].name).toBe('A');
    expect(kept).toBe(1);
    expect(dropped).toEqual(['z']);
  });

  it('clears a name when the entry is removed', () => {
    const named = applyNames(mapOf('a'), new Map([['a', 'Aurelia']])).map;
    expect(named.territories[0].name).toBe('Aurelia');
    // The names map is the whole truth: an emptied field means "no name".
    expect(applyNames(named, new Map()).map.territories[0].name).toBe('a');
  });

  it('keeps holes and other territory fields while renaming', () => {
    const withHole: MapFormatV1 = {
      ...mapOf('a'),
      territories: [{ ...mapOf('a').territories[0], holes: [[[2, 2]]] }],
    };
    const { map } = applyNames(withHole, new Map([['a', 'Lago']]));
    expect(map.territories[0].holes).toEqual([[[2, 2]]]);
    expect(map.territories[0].name).toBe('Lago');
  });
});