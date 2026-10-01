import { createRaster, parseHex, setPixel, type RasterImage, type RGB } from '../../src/raster.js';

/**
 * Synthetic images for the importer tests, drawn as ASCII art so a failing
 * test shows the actual map in the diff.
 *
 * Each character is a colour key; `.` (or any key mapped to `null`) is left
 * transparent, which is how sea/background shows up in real PNGs.
 */
export function rasterFromArt(
  art: readonly string[],
  palette: Readonly<Record<string, string | null>>,
): RasterImage {
  const height = art.length;
  const width = art[0]?.length ?? 0;
  if (width === 0) throw new Error('art must have at least one row');
  for (const [i, row] of art.entries()) {
    if (row.length !== width) throw new Error(`row ${i} is ${row.length} wide, expected ${width}`);
  }

  const img = createRaster(width, height, 0x000000);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const key = art[y][x];
      const hex = palette[key];
      if (hex === null || hex === undefined) {
        setPixel(img, x, y, 0x000000, 0); // transparent
      } else {
        setPixel(img, x, y, parseHex(hex) as RGB);
      }
    }
  }
  return img;
}

/** Paint a filled rectangle of `hex` into an existing image. */
export function fillRect(img: RasterImage, x0: number, y0: number, w: number, h: number, hex: string): void {
  const rgb = parseHex(hex);
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x >= 0 && y >= 0 && x < img.width && y < img.height) setPixel(img, x, y, rgb);
    }
  }
}

/** A 1-pixel frame of `hex` around the image, like a map's outer border. */
export function strokeBorder(img: RasterImage, hex: string): void {
  fillRect(img, 0, 0, img.width, 1, hex);
  fillRect(img, 0, img.height - 1, img.width, 1, hex);
  fillRect(img, 0, 0, 1, img.height, hex);
  fillRect(img, img.width - 1, 0, 1, img.height, hex);
}

/** Count pixels matching a packed colour — handy to assert on fixtures. */
export function countColor(img: RasterImage, hex: string): number {
  const rgb = parseHex(hex);
  let n = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] === 0) continue;
      if (((img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]) === rgb) n++;
    }
  }
  return n;
}
