import type { MapFormatV1 } from '@mbrg/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { handmadeMap } from './maps/handmade.js';
import { HANDMADE_ID, deleteMap, listMaps, resolveMap, saveMap, suggestMapName } from './library.js';

/** A minimal store, so the tests do not depend on a real browser's quota. */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const STORAGE_KEY = 'mbrg.maps';

/** A second hand-made style map, so saved entries are distinguishable. */
const other: MapFormatV1 = {
  version: 1,
  name: 'Two blocks',
  width: 80,
  height: 40,
  territories: [
    { id: 'a', name: 'a', neighbors: ['b'], polygons: [[[0, 0], [40, 0], [40, 40], [0, 40]]] },
    { id: 'b', name: 'b', neighbors: ['a'], polygons: [[[40, 0], [80, 0], [80, 40], [40, 40]]] },
  ],
};

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: globalThis.localStorage },
    configurable: true,
  });
});

describe('map library', () => {
  it('always offers the built-in map', () => {
    const maps = listMaps();
    expect(maps).toHaveLength(1);
    expect(maps[0].id).toBe(HANDMADE_ID);
    expect(maps[0].builtIn).toBe(true);
    expect(maps[0].map).toBe(handmadeMap);
  });

  it('resolves no id, the built-in id and an unknown id to the built-in map', () => {
    expect(resolveMap(null).id).toBe(HANDMADE_ID);
    expect(resolveMap(undefined).id).toBe(HANDMADE_ID);
    expect(resolveMap(HANDMADE_ID).id).toBe(HANDMADE_ID);
    expect(resolveMap('does-not-exist').id).toBe(HANDMADE_ID);
  });

  it('saves an imported map and finds it back', () => {
    const id = saveMap('Two blocks', other, '80×40');
    expect(listMaps().map((m) => m.id)).toEqual([HANDMADE_ID, id]);
    const found = resolveMap(id);
    expect(found.name).toBe('Two blocks');
    expect(found.map.territories).toHaveLength(2);
    expect(found.size).toBe('80×40');
  });

  it('refuses a map that does not validate', () => {
    const broken = { ...other, territories: [] } as MapFormatV1;
    expect(() => saveMap('broken', broken)).toThrow(/not valid/);
    expect(listMaps()).toHaveLength(1);
  });

  it('ignores stored entries that are corrupt or invalid', () => {
    // A map that lost a territory, a non-array, and plain noise.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: 'x', name: 'x', map: { version: 1, name: 'x', territories: [] } },
        'not an entry',
        null,
      ]),
    );
    expect(listMaps().map((m) => m.id)).toEqual([HANDMADE_ID]);
  });

  it('survives unreadable storage instead of throwing', () => {
    window.localStorage.setItem(STORAGE_KEY, '{{{ not json');
    expect(listMaps().map((m) => m.id)).toEqual([HANDMADE_ID]);
  });

  it('deletes an imported map but never the built-in one', () => {
    const id = saveMap('Two blocks', other);
    deleteMap(id);
    expect(listMaps().map((m) => m.id)).toEqual([HANDMADE_ID]);
    deleteMap(HANDMADE_ID);
    expect(listMaps().map((m) => m.id)).toEqual([HANDMADE_ID]);
  });

  it('keeps the store small, dropping the oldest', () => {
    for (let i = 0; i < 12; i++) saveMap(`map ${i}`, { ...other, name: `map ${i}` });
    const stored = listMaps().filter((m) => !m.builtIn);
    expect(stored).toHaveLength(8);
    // The most recent import is still there.
    expect(stored[0].name).toBe('map 11');
  });

  it('suggests a name from the file name', () => {
    expect(suggestMapName('europa.png')).toBe('europa');
    expect(suggestMapName('my.map.jpeg')).toBe('my.map');
    expect(suggestMapName('.png')).toBe('imported map');
  });
});
