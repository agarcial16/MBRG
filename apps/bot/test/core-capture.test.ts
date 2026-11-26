import { describe, expect, it } from 'vitest';
import { CACHE_ENTRIES, ROUND_SIZE, cacheKey, captureSize, captureUrl, createLru, halfSize, pngSize } from '../src/core/capture';

describe('spec 038 capture sizes (FR-723)', () => {
  it('FR-723 the round image is 1600 x 900 whatever the map', () => {
    expect(captureSize('round', undefined)).toStrictEqual({ width: 1600, height: 900 });
    expect(captureSize('round', { width: 100, height: 100 })).toStrictEqual(ROUND_SIZE);
    expect(captureSize('round', { width: 9000, height: 5000 })).toStrictEqual(ROUND_SIZE);
  });

  it('FR-723 the full map keeps the aspect and its longer side is min(map longer side, 4096)', () => {
    expect(captureSize('full', { width: 4096, height: 2179 })).toStrictEqual({ width: 4096, height: 2179 });
    expect(captureSize('full', { width: 2048, height: 2048 })).toStrictEqual({ width: 2048, height: 2048 });
    expect(captureSize('full', { width: 1536, height: 1536 })).toStrictEqual({ width: 1536, height: 1536 });
    expect(captureSize('full', { width: 8192, height: 4096 })).toStrictEqual({ width: 4096, height: 2048 });
    expect(captureSize('full', { width: 3000, height: 6000 })).toStrictEqual({ width: 2048, height: 4096 });
  });

  it('FR-723 a full map of unknown size has no size; the half size halves both sides', () => {
    expect(captureSize('full', undefined)).toBeUndefined();
    expect(captureSize('full', { width: 0, height: 10 })).toBeUndefined();
    expect(halfSize({ width: 4096, height: 2179 })).toStrictEqual({ width: 2048, height: 1089 });
    expect(halfSize({ width: 1, height: 1 })).toStrictEqual({ width: 1, height: 1 });
  });

  it('FR-723 the size of a map comes from the header of its PNG', () => {
    const header = new Uint8Array(33);
    header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const view = new DataView(header.buffer);
    view.setUint32(16, 4096);
    view.setUint32(20, 2179);
    expect(pngSize(header)).toStrictEqual({ width: 4096, height: 2179 });
    expect(pngSize(new Uint8Array(10))).toBeUndefined();
    header[1] = 0;
    expect(pngSize(header)).toBeUndefined();
  });
});

describe('spec 038 capture address (FR-713, NFR-191)', () => {
  it('FR-713 the address holds only the capture, the match, the round and the frame kind; the viewer query and fragment are dropped', () => {
    const url = captureUrl('https://viewer.example/play/?x=1&spectate=1#frag', { matchId: 'AbCdEfGhIjKlMnOp', round: 4, frame: 'round' });
    expect(url).toBe('https://viewer.example/play/?capture=1&match=AbCdEfGhIjKlMnOp&round=4&frame=round');
    expect(captureUrl('http://127.0.0.1:5173', { matchId: 'AbCdEfGhIjKlMnOp', round: 0, frame: 'full' })).toBe('http://127.0.0.1:5173/?capture=1&match=AbCdEfGhIjKlMnOp&round=0&frame=full');
  });

  it('FR-726 a viewer address that is not an address gives none', () => {
    expect(captureUrl('not a url', { matchId: 'AbCdEfGhIjKlMnOp', round: 1, frame: 'full' })).toBeUndefined();
  });

  it('NFR-191 the cache key holds match, round and kind only', () => {
    expect(cacheKey({ matchId: 'M', round: 3, frame: 'full' })).toBe('M:3:full');
  });
});

describe('spec 038 cache (FR-724)', () => {
  it('FR-724 holds at most 32 entries and drops the least recently used first', () => {
    expect(CACHE_ENTRIES).toBe(32);
    const cache = createLru<number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBe(1); // a is now the most recent
    cache.set('d', 4); // b is the least recent
    expect(cache.get('b')).toBeUndefined();
    expect([cache.get('a'), cache.get('c'), cache.get('d')]).toStrictEqual([1, 3, 4]);
    expect(cache.size).toBe(3);
  });

  it('FR-724 setting an existing key renews it and never grows the cache', () => {
    const cache = createLru<number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10);
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(10);
    expect(cache.size).toBe(2);
  });
});
