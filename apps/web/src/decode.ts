import { createRaster, type RasterImage } from '@mbrg/map-tools';

/**
 * The one place the importer touches the DOM.
 *
 * The detection core takes pixels, not files, so all the browser-specific work
 * is here: ask the browser to decode the file, then hand over a `RasterImage`.
 * The image is drawn at its natural size — no scaling — because every coordinate
 * downstream is a pixel of the original.
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

/** Draw a raster onto a canvas at its natural size (used for the preview). */
export function drawRaster(canvas: HTMLCanvasElement, raster: RasterImage, alpha = 1): void {
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, raster.width, raster.height);
  if (alpha >= 1) {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0);
    return;
  }
  // Partly transparent: an offscreen copy plus globalAlpha, because putImageData
  // ignores the context's alpha.
  const buffer = createRaster(raster.width, raster.height);
  buffer.data.set(raster.data);
  const off = document.createElement('canvas');
  off.width = raster.width;
  off.height = raster.height;
  const offCtx = off.getContext('2d');
  if (!offCtx) return;
  offCtx.putImageData(new ImageData(new Uint8ClampedArray(buffer.data), raster.width, raster.height), 0, 0);
  ctx.globalAlpha = alpha;
  ctx.drawImage(off, 0, 0);
  ctx.globalAlpha = 1;
}
