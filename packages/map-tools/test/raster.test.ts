import { describe, expect, it } from 'vitest';

import {
  alphaAt,
  assertRasterSize,
  colorDistance,
  createRaster,
  inBounds,
  luminance,
  packRGB,
  parseHex,
  rgbAt,
} from '../src/raster.js';
import { rasterFromArt } from './fixtures/raster.js';

describe('createRaster', () => {
  it('allocates RGBA data of the right size', () => {
    const img = createRaster(4, 3, packRGB(0x33, 0x66, 0x99));
    expect(img.width).toBe(4);
    expect(img.height).toBe(3);
    expect(img.data).toHaveLength(4 * 3 * 4);
    expect(() => assertRasterSize(img)).not.toThrow();
    // Fill colour on every pixel.
    expect(rgbAt(img, 0, 0)).toBe(0x336699);
    expect(rgbAt(img, 3, 2)).toBe(0x336699);
    expect(alphaAt(img, 2, 1)).toBe(255);
  });

  it('rejects nonsense sizes instead of allocating something unusable', () => {
    expect(() => createRaster(0, 4)).toThrow();
    expect(() => createRaster(4, -1)).toThrow();
    expect(() => createRaster(2.5, 4)).toThrow();
  });
});

describe('assertRasterSize', () => {
  it('catches a buffer that does not match the declared size', () => {
    const img = createRaster(3, 3);
    expect(() => assertRasterSize({ ...img, data: img.data.slice(0, 10) })).toThrow(/length/);
  });
});

describe('pixel access', () => {
  const img = rasterFromArt(['RG', '.B'], { R: '#ff0000', G: '#00ff00', B: '#0000ff', '.': null });

  it('reads colours and alpha', () => {
    expect(rgbAt(img, 0, 0)).toBe(0xff0000);
    expect(rgbAt(img, 1, 0)).toBe(0x00ff00);
    expect(rgbAt(img, 1, 1)).toBe(0x0000ff);
    expect(alphaAt(img, 0, 1)).toBe(0); // transparent background
  });

  it('treats out-of-bounds reads as opaque black, never throwing', () => {
    expect(rgbAt(img, -1, 0)).toBe(0x000000);
    expect(rgbAt(img, 2, 0)).toBe(0x000000);
    expect(alphaAt(img, 0, 2)).toBe(0);
    expect(inBounds(img, 1, 1)).toBe(true);
    expect(inBounds(img, 2, 1)).toBe(false);
  });
});

describe('parseHex', () => {
  it('reads both #rgb and #rrggbb', () => {
    expect(parseHex('#ff0000')).toBe(0xff0000);
    expect(parseHex('ff0000')).toBe(0xff0000);
    expect(parseHex('#f00')).toBe(0xff0000);
    expect(parseHex('  #0a0B0c ')).toBe(0x0a0b0c);
  });
});

describe('luminance and colorDistance', () => {
  it('luminance follows perceived brightness', () => {
    expect(luminance(0x000000)).toBe(0);
    expect(luminance(0xffffff)).toBe(255);
    expect(luminance(0x00ff00)).toBeGreaterThan(luminance(0xff0000)); // green > red
  });

  it('distance is zero for the same colour and grows with difference', () => {
    expect(colorDistance(0x336699, 0x336699)).toBe(0);
    expect(colorDistance(0x000000, 0x010101)).toBeGreaterThan(0);
    expect(colorDistance(0x000000, 0xffffff)).toBeGreaterThan(colorDistance(0x000000, 0x808080));
  });

  it('weights green the most, matching how the eye sees brightness', () => {
    // Same 16-step deviation in one channel each: green counts more than red.
    expect(colorDistance(0x000000, 0x001000)).toBeGreaterThan(colorDistance(0x000000, 0x100000));
    // And blue sits in between.
    expect(colorDistance(0x000000, 0x000010)).toBeGreaterThan(colorDistance(0x000000, 0x100000));
  });
});
