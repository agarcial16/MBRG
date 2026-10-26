import type { RasterImage } from '@mbrg/map-tools';

/**
 * The one place the importer touches the DOM.
 *
 * The detection core takes pixels, not files, so all the browser-specific work
 * is here: ask the browser to decode the file, then hand over a `RasterImage`.
 */
export async function decodeImageFile(file: File): Promise<RasterImage> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    // A zero-sized image would make every downstream loop a no-op.
    if (image.naturalWidth === 0 || image.naturalHeight === 0) {
      throw new Error('the image has no size');
    }
    return imageToRaster(image);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('the file could not be decoded as an image'));
    image.src = url;
  });
}

/**
 * Load an image from a URL rather than a file, for `?image=` on the import
 * screen: handy for sharing a map that needs debugging, and it makes the page
 * testable end to end with a generated bitmap.
 */
export async function decodeImageUrl(url: string): Promise<RasterImage> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load the image at ${url}`));
    img.src = url;
  });
  if (image.naturalWidth === 0 || image.naturalHeight === 0) {
    throw new Error('the image has no size');
  }
  return imageToRaster(image);
}

/** Copy a decoded image into a plain RGBA buffer. */
export function imageToRaster(image: CanvasImageSource & { width: number; height: number }): RasterImage {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d is unavailable in this browser');
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // getImageData hands back a fresh buffer, so it can be kept as-is.
  return { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(data.buffer) };
}

/**
 * Longest edge of the image the detection is allowed to look at.
 *
 * A real map is a 4000x3000 bitmap, which is 12M pixels, and every pass over it —
 * the histogram, the connectivity scan, adjacency, contour tracing — is linear in
 * pixels. Sliders re-run all of them, so on a full-size image the page locks up
 * for seconds on every drag, which is what makes the controls feel broken.
 *
 * 1600 px keeps a province big enough to trace accurately (a small European
 * province is ~60 px across at this scale) and cuts the work by about seven
 * times. Nothing downstream needs the original resolution: map coordinates are
 * just the raster's own pixel space, so the exported map is the same shape at a
 * smaller size, and the simplification tolerance is in the same units.
 */
export const MAX_DETECT_EDGE = 1600;

/**
 * Scale factors to bring an image within `MAX_DETECT_EDGE`, or null to keep it as
 * it is. Separated from the DOM so the arithmetic can be tested in Node.
 */
export function detectScale(width: number, height: number, maxEdge = MAX_DETECT_EDGE): number | null {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return null;
  return maxEdge / longest;
}

/**
 * The raster the detection reads, at most `maxEdge` on its longest side.
 *
 * Scaling happens in one `drawImage` call, which is the browser's own resampler —
 * far faster than touching 12M pixels from JavaScript, and good enough: the
 * result is what every downstream pass sees.
 */
export function rasterForDetection(image: RasterImage, maxEdge = MAX_DETECT_EDGE): RasterImage {
  const scale = detectScale(image.width, image.height, maxEdge);
  if (scale === null) return image;

  const full = document.createElement('canvas');
  full.width = image.width;
  full.height = image.height;
  const fullCtx = full.getContext('2d', { willReadFrequently: true });
  if (!fullCtx) throw new Error('canvas 2d is unavailable in this browser');
  fullCtx.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );

  // Round rather than truncate, so the last row is not lost by a fraction.
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const small = document.createElement('canvas');
  small.width = width;
  small.height = height;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d is unavailable in this browser');
  ctx.drawImage(full, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { width, height, data: new Uint8ClampedArray(data.buffer) };
}