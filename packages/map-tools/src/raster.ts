/**
 * Raster images for the map importer.
 *
 * The core is pure on purpose: it consumes *pixels*, never a file. Decoding
 * (canvas in the browser, a PNG decoder in a future CLI) happens in the
 * adapter, which hands over a `RasterImage` and gets regions back. That keeps
 * the whole importer testable in Node with synthetic images a few pixels wide.
 *
 * Coordinates: pixels are `(x, y)` with **y growing downwards**, and map
 * coordinates are the same space — no flip anywhere, so a pixel at (10, 20)
 * is map point (10, 20).
 */

/** A decoded image: RGBA8, row-major, 4 bytes per pixel. */
export interface RasterImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** Packed 24-bit colour (`0xRRGGBB`). Alpha is dropped: it lives in `alphaAt`. */
export type RGB = number;

export const BYTES_PER_PIXEL = 4;

/** Byte offset of the pixel at `(x, y)`. */
export function offsetOf(x: number, y: number, width: number): number {
  return (y * width + x) * BYTES_PER_PIXEL;
}

/** Is `(x, y)` inside the image? */
export function inBounds(img: RasterImage, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < img.width && y < img.height;
}

/** Alpha of a pixel, 0–255. */
export function alphaAt(img: RasterImage, x: number, y: number): number {
  if (!inBounds(img, x, y)) return 0;
  return img.data[offsetOf(x, y, img.width) + 3];
}

/** Packed RGB of a pixel, ignoring alpha. Out-of-bounds reads are opaque black. */
export function rgbAt(img: RasterImage, x: number, y: number): RGB {
  if (!inBounds(img, x, y)) return 0x000000;
  const i = offsetOf(x, y, img.width);
  return (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
}

/** Perceived brightness of a packed colour, 0–255. Used by mode B. */
export function luminance(rgb: RGB): number {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/**
 * Euclidean distance between two packed colours, 0–441.
 *
 * Weighted the way luminance is perceived (green counts most), so a border
 * that a human calls "black" is treated as black regardless of a slight tint.
 */
export function colorDistance(a: RGB, b: RGB): number {
  const dr = ((a >> 16) & 0xff) - ((b >> 16) & 0xff);
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff);
  const db = (a & 0xff) - (b & 0xff);
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}

/** Pack a colour from components. */
export function packRGB(r: number, g: number, b: number): RGB {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

/** Parse `#rgb` / `#rrggbb` into a packed colour. */
export function parseHex(hex: string): RGB {
  const h = hex.replace('#', '').trim();
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  return parseInt(full, 16) & 0xffffff;
}

/** Allocate an image, optionally pre-filled with a colour. */
export function createRaster(width: number, height: number, fill: RGB = 0x000000): RasterImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`invalid raster size: ${width}x${height}`);
  }
  const data = new Uint8ClampedArray(width * height * BYTES_PER_PIXEL);
  const r = (fill >> 16) & 0xff;
  const g = (fill >> 8) & 0xff;
  const b = fill & 0xff;
  for (let i = 0; i < data.length; i += BYTES_PER_PIXEL) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

/** Set one pixel (alpha included). No bounds check: hot path, caller is careful. */
export function setPixel(img: RasterImage, x: number, y: number, rgb: RGB, alpha = 255): void {
  const i = offsetOf(x, y, img.width);
  img.data[i] = (rgb >> 16) & 0xff;
  img.data[i + 1] = (rgb >> 8) & 0xff;
  img.data[i + 2] = rgb & 0xff;
  img.data[i + 3] = alpha;
}

/** Fail fast on a buffer whose length doesn't match the declared size. */
export function assertRasterSize(img: RasterImage): void {
  const expected = img.width * img.height * BYTES_PER_PIXEL;
  if (img.data.length !== expected) {
    throw new Error(`raster data length ${img.data.length} does not match ${img.width}x${img.height}`);
  }
}
