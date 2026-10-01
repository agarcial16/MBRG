export type { AdjacencyResult } from './adjacency.js';
export { detectAdjacency, islandIds, labelAt, neighborIdLists } from './adjacency.js';
export type { ColorRegion, FlatColorOptions, FlatColorResult } from './flatColors.js';
export { DEFAULT_FLAT_COLOR_OPTIONS, detectFlatColorRegions, isBorderColor } from './flatColors.js';
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
