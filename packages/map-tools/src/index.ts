export type { ColorRegion, FlatColorOptions, FlatColorResult } from './flatColors.js';
export { DEFAULT_FLAT_COLOR_OPTIONS, detectFlatColorRegions } from './flatColors.js';
export type { RasterImage, RGB } from './raster.js';
export {
  alphaAt,
  assertRasterSize,
  BYTES_PER_PIXEL,
  colorDistance,
  createRaster,
  inBounds,
  luminance,
  offsetOf,
  packRGB,
  parseHex,
  rgbAt,
  setPixel,
} from './raster.js';
