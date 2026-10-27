// Terra incognita (spec 010 FR-368): the parchment that shows where the map does not cover the screen. Pure geometry: which screen
// rectangles lie outside the image and where the texture sits so it stays fixed to the ground when the camera moves.
import { describe, expect, it } from 'vitest';
import { mapToScreen, type Camera, type ImageSize, type Viewport } from '../src/core/camera';
import { TERRA_TILE, terraBands, terraOffset, type ScreenRect } from '../src/core/terra';

const image: ImageSize = { w: 2048, h: 1024 };

/** A small deterministic generator (no Math.random in tests that must be repeatable). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const area = (r: ScreenRect): number => r.w * r.h;
const overlap = (a: ScreenRect, b: ScreenRect): number => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** The part of the image that is on screen, from the camera maths of the viewer (independent of the module under test). */
function imageOnScreen(camera: Camera, viewport: Viewport): ScreenRect {
  const a = mapToScreen(camera, { x: 0, y: 0 }, viewport);
  const b = mapToScreen(camera, { x: image.w, y: image.h }, viewport);
  const x0 = Math.max(0, a.sx);
  const y0 = Math.max(0, a.sy);
  const x1 = Math.min(viewport.width, b.sx);
  const y1 = Math.min(viewport.height, b.sy);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

describe('FR-368 the bands outside the map', () => {
  it('FR-368 with the whole map inside the viewport there are four bands: above, below, left and right of the map', () => {
    const viewport = { width: 1000, height: 800 };
    const camera: Camera = { x: 1024, y: 512, scale: 0.25 };
    const bands = terraBands(camera, viewport, image);
    expect(bands).toHaveLength(4);
    for (const band of bands) expect(area(band)).toBeGreaterThan(0);
  });

  it('FR-368 a view that lies wholly inside the map has no band', () => {
    expect(terraBands({ x: 1024, y: 512, scale: 1 }, { width: 800, height: 600 }, image)).toStrictEqual([]);
  });

  it('FR-368 over 300 cameras the bands and the map on screen cover the viewport exactly once: no gap, no overlap, nothing outside', () => {
    const next = lcg(20261027);
    for (let i = 0; i < 300; i++) {
      const viewport = { width: 200 + Math.floor(next() * 1800), height: 200 + Math.floor(next() * 900) };
      const camera: Camera = { x: -500 + next() * 3000, y: -500 + next() * 2000, scale: 0.05 + next() * 3 };
      const bands = terraBands(camera, viewport, image);
      const visible = imageOnScreen(camera, viewport);
      const total = bands.reduce((sum, b) => sum + area(b), 0) + area(visible);
      expect(total, `camera ${i}`).toBeCloseTo(viewport.width * viewport.height, 4);
      for (const band of bands) {
        expect(band.x).toBeGreaterThanOrEqual(-1e-9);
        expect(band.y).toBeGreaterThanOrEqual(-1e-9);
        expect(band.x + band.w).toBeLessThanOrEqual(viewport.width + 1e-9);
        expect(band.y + band.h).toBeLessThanOrEqual(viewport.height + 1e-9);
        expect(area(band)).toBeGreaterThan(0);
        expect(overlap(band, visible), `camera ${i}`).toBeLessThan(1e-6);
      }
      for (let a = 0; a < bands.length; a++) for (let b = a + 1; b < bands.length; b++) expect(overlap(bands[a]!, bands[b]!), `camera ${i}`).toBeLessThan(1e-6);
    }
  });

  it('FR-368 a map that has left the screen entirely makes the whole viewport one band', () => {
    const viewport = { width: 800, height: 600 };
    const bands = terraBands({ x: 9000, y: 9000, scale: 1 }, viewport, image);
    expect(bands.reduce((sum, b) => sum + area(b), 0)).toBeCloseTo(800 * 600, 6);
    expect(bands).toHaveLength(1);
  });
});

describe('FR-368 the texture is fixed to the ground', () => {
  it('FR-368 the tile is as wide on screen as it is in map units times the scale, and one tile is one tile of the image file', () => {
    expect(TERRA_TILE).toMatchObject({ url: '/terra.webp', width: 640, height: 420 });
    const offset = terraOffset({ x: 100, y: 200, scale: 0.5 }, { width: 800, height: 600 });
    expect(offset.w).toBeCloseTo(320, 10);
    expect(offset.h).toBeCloseTo(210, 10);
  });

  it('FR-368 the origin of the tile is where the map origin is on screen, wrapped into one tile; panning by a whole tile changes nothing', () => {
    const viewport = { width: 800, height: 600 };
    const camera: Camera = { x: 100, y: 200, scale: 0.5 };
    const o = mapToScreen(camera, { x: 0, y: 0 }, viewport);
    const offset = terraOffset(camera, viewport);
    const wrap = (v: number, size: number): number => ((v % size) + size) % size;
    expect(wrap(offset.x, offset.w)).toBeCloseTo(wrap(o.sx, offset.w), 8);
    expect(wrap(offset.y, offset.h)).toBeCloseTo(wrap(o.sy, offset.h), 8);
    const shifted = terraOffset({ ...camera, x: camera.x + TERRA_TILE.width, y: camera.y + TERRA_TILE.height }, viewport);
    expect(wrap(shifted.x, offset.w)).toBeCloseTo(wrap(offset.x, offset.w), 8);
    expect(wrap(shifted.y, offset.h)).toBeCloseTo(wrap(offset.y, offset.h), 8);
  });

  it('FR-368 moving the camera to the right moves the texture to the left by the same screen distance as the map', () => {
    const viewport = { width: 800, height: 600 };
    const a = terraOffset({ x: 300, y: 300, scale: 2 }, viewport);
    const b = terraOffset({ x: 310, y: 300, scale: 2 }, viewport);
    expect(a.x - b.x).toBeCloseTo(20, 8);
    expect(a.y).toBeCloseTo(b.y, 10);
  });
});
