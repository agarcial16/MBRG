// The minimap math (spec 010 FR-359): the picture, the rectangle of the current view and the camera a tap asks for. Pure.
import { describe, expect, it } from 'vitest';
import { clampCamera, type Camera } from '../src/core/camera';
import type { EntryIndex } from '../src/core/entries';
import { cameraAtPoint, cameraZoomed, minimapPixels, minimapSize, viewRect } from '../src/core/minimap';

const image = { w: 2048, h: 1024 };
const rgb = (r: number, g: number, b: number): [number, number, number] => [r, g, b];

describe('FR-359 the size of the minimap', () => {
  it('FR-359 the long side is the limit and the proportion of the map is kept', () => {
    expect(minimapSize(image, 200)).toStrictEqual({ w: 200, h: 100 });
    expect(minimapSize({ w: 1000, h: 2000 }, 200)).toStrictEqual({ w: 100, h: 200 });
    expect(minimapSize({ w: 10, h: 10_000 }, 200)).toStrictEqual({ w: 1, h: 200 });
  });
});

describe('FR-359 the rectangle of the view', () => {
  it('FR-359 it is the share of the map the viewport shows, centred on the camera', () => {
    const rect = viewRect({ x: 1024, y: 512, scale: 1 }, { width: 512, height: 256 }, image);
    expect(rect.x).toBeCloseTo(0.375, 10);
    expect(rect.y).toBeCloseTo(0.375, 10);
    expect(rect.w).toBeCloseTo(0.25, 10);
    expect(rect.h).toBeCloseTo(0.25, 10);
  });

  it('FR-359 a view wider than the map is the whole map; a view near an edge stays inside the unit square', () => {
    expect(viewRect({ x: 1024, y: 512, scale: 0.1 }, { width: 800, height: 600 }, image)).toStrictEqual({ x: 0, y: 0, w: 1, h: 1 });
    const edge = viewRect({ x: 100, y: 100, scale: 1 }, { width: 800, height: 600 }, image);
    expect(edge.x).toBe(0);
    expect(edge.y).toBe(0);
    expect(edge.x + edge.w).toBeLessThanOrEqual(1);
    expect(edge.y + edge.h).toBeLessThanOrEqual(1);
    expect(edge.w).toBeCloseTo((100 + 400) / 2048, 6);
  });
});

describe('FR-359 the wheel over the minimap zooms the map', () => {
  const viewport = { width: 512, height: 256 };

  it('FR-359 it zooms about the centre of the view: the centre stays and the scale follows the wheel steps', () => {
    const camera = { x: 900, y: 400, scale: 1 };
    const zoomed = cameraZoomed(camera, 2, viewport, image);
    expect(zoomed.x).toBeCloseTo(900, 6);
    expect(zoomed.y).toBeCloseTo(400, 6);
    expect(zoomed.scale).toBeCloseTo(1.2 ** 2, 6);
    expect(cameraZoomed(zoomed, -2, viewport, image).scale).toBeCloseTo(1, 6);
  });

  it('FR-359 it never leaves the limits of the camera: not below the fit of the whole map, not above the maximum', () => {
    const fit = clampCamera({ x: 1024, y: 512, scale: 0.0001 }, image, viewport).scale;
    expect(cameraZoomed({ x: 1024, y: 512, scale: fit }, -50, viewport, image).scale).toBeCloseTo(fit, 10);
    expect(cameraZoomed({ x: 1024, y: 512, scale: 30 }, 50, viewport, image).scale).toBe(32);
  });
});

describe('FR-359 a tap moves the camera', () => {
  const viewport = { width: 512, height: 256 };

  it('FR-359 the camera is centred on the tapped point, keeps its scale and is clamped like every camera of the viewer', () => {
    const camera: Camera = { x: 300, y: 300, scale: 1 };
    const next = cameraAtPoint({ x: 0.5, y: 0.5 }, camera, viewport, image);
    expect(next).toStrictEqual(clampCamera({ x: 1024, y: 512, scale: 1 }, image, viewport));
    expect(next.scale).toBe(1);
    const corner = cameraAtPoint({ x: 0, y: 0 }, camera, viewport, image);
    expect(corner).toStrictEqual(clampCamera({ x: 0, y: 0, scale: 1 }, image, viewport));
  });

  it('FR-359 for an interior point the new rectangle is centred on it (a tap and its rectangle agree)', () => {
    const next = cameraAtPoint({ x: 0.3, y: 0.6 }, { x: 0, y: 0, scale: 1 }, viewport, image);
    const rect = viewRect(next, viewport, image);
    expect(rect.x + rect.w / 2).toBeCloseTo(0.3, 6);
    expect(rect.y + rect.h / 2).toBeCloseTo(0.6, 6);
  });

  it('FR-359 a point outside the unit square is clamped to it', () => {
    const a = cameraAtPoint({ x: -3, y: 9 }, { x: 0, y: 0, scale: 1 }, viewport, image);
    const b = cameraAtPoint({ x: 0, y: 1 }, { x: 0, y: 0, scale: 1 }, viewport, image);
    expect(a).toStrictEqual(b);
  });
});

describe('FR-359 the picture of the minimap', () => {
  // 4 x 2 cells: row 0 = outside, land of 10, land of 10, sea; row 1 = outside, land of 10, sea, sea.
  const index: EntryIndex = {
    width: 4,
    height: 2,
    cells: Uint16Array.from([0, 1, 1, 2, 0, 1, 2, 2]),
    fills: ['outside', 'land', 'sea'],
    ids: [0, 10, 20],
    indexOf: new Map([[10, 1], [20, 2]]),
    indexPixels: new Uint8Array(16),
  };
  const colors = new Map([[1, rgb(200, 10, 20)]]);
  const theme = { sea: rgb(0, 0, 255), land: rgb(100, 100, 100) };
  const px = (data: Uint8ClampedArray, i: number): number[] => [...data.slice(i * 4, i * 4 + 4)];

  it('FR-359 land takes the colour of its owner, sea the sea colour, other land the land colour, outside the map is transparent', () => {
    const owners = new Map([[10, 1]]);
    const full = minimapPixels(index, { w: 4, h: 2 }, owners, colors, theme);
    expect(px(full, 0)).toStrictEqual([0, 0, 0, 0]);
    expect(px(full, 1)).toStrictEqual([200, 10, 20, 255]);
    expect(px(full, 3)).toStrictEqual([0, 0, 255, 255]);
    const unowned = minimapPixels(index, { w: 4, h: 2 }, new Map(), colors, theme);
    expect(px(unowned, 1)).toStrictEqual([100, 100, 100, 255]);
  });

  it('FR-359 a smaller picture samples the middle of each block of cells', () => {
    const small = minimapPixels(index, { w: 2, h: 1 }, new Map([[10, 1]]), colors, theme);
    expect(small.length).toBe(8);
    expect(px(small, 0)).toStrictEqual([200, 10, 20, 255]);
    expect(px(small, 1)).toStrictEqual([0, 0, 255, 255]);
  });

  it('FR-359 the picture follows the owners: the same cells under other owners give other colours', () => {
    const other = new Map([[10, 2]]);
    const colors2 = new Map([[1, rgb(200, 10, 20)], [2, rgb(1, 2, 3)]]);
    expect(px(minimapPixels(index, { w: 4, h: 2 }, other, colors2, theme), 1)).toStrictEqual([1, 2, 3, 255]);
  });
});
