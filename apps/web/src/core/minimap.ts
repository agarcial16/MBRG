// The minimap of the match screen (spec 010 FR-359): the size and the picture of the thumbnail, the rectangle of the current view and
// the camera a tap asks for. Pure: the shell puts the pixels on a canvas and reads the pointer.
import type { Rgb } from '@mbrg/shared';
import { clampCamera, zoomAt } from './camera';
import type { Camera, ImageSize, Viewport } from './camera';
import type { EntryIndex } from './entries';
import type { Owners } from './live-rounds';

/** The size of the thumbnail: the long side is `maxSide`, the proportion of the map is kept, each side is at least 1. */
export function minimapSize(image: ImageSize, maxSide: number): { w: number; h: number } {
  const scale = maxSide / Math.max(image.w, image.h);
  return { w: Math.max(1, Math.round(image.w * scale)), h: Math.max(1, Math.round(image.h * scale)) };
}

export interface UnitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The share of the map the viewport shows, as a rectangle of the unit square (clipped to the map). */
export function viewRect(camera: Camera, viewport: Viewport, image: ImageSize): UnitRect {
  const halfW = viewport.width / camera.scale / 2;
  const halfH = viewport.height / camera.scale / 2;
  const x0 = Math.max(0, camera.x - halfW) / image.w;
  const y0 = Math.max(0, camera.y - halfH) / image.h;
  const x1 = Math.min(image.w, camera.x + halfW) / image.w;
  const y1 = Math.min(image.h, camera.y + halfH) / image.h;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The camera centred on a point of the unit square (clamped to it), with the same scale, clamped like every camera of the viewer. */
export function cameraAtPoint(point: { x: number; y: number }, camera: Camera, viewport: Viewport, image: ImageSize): Camera {
  const x = Math.min(1, Math.max(0, point.x)) * image.w;
  const y = Math.min(1, Math.max(0, point.y)) * image.h;
  return clampCamera({ x, y, scale: camera.scale }, image, viewport);
}

/** The camera after the wheel turned over the minimap: zoomed about the centre of the view, inside the limits of every camera. */
export function cameraZoomed(camera: Camera, steps: number, viewport: Viewport, image: ImageSize): Camera {
  return zoomAt(camera, { sx: viewport.width / 2, sy: viewport.height / 2 }, steps, image, viewport);
}

/**
 * The RGBA pixels of the thumbnail: land in the colour of its owner (other land in `theme.land`), sea in `theme.sea`, and outside
 * the map transparent so the background of the screen shows. Each pixel samples the middle of its block of cells.
 */
export function minimapPixels(
  index: EntryIndex,
  size: { w: number; h: number },
  owners: Owners,
  colors: ReadonlyMap<number, Rgb>,
  theme: { readonly sea: Rgb; readonly land: Rgb },
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size.w * size.h * 4);
  for (let j = 0; j < size.h; j++) {
    const sy = Math.min(index.height - 1, Math.floor(((j + 0.5) * index.height) / size.h));
    for (let i = 0; i < size.w; i++) {
      const sx = Math.min(index.width - 1, Math.floor(((i + 0.5) * index.width) / size.w));
      const cell = index.cells[sy * index.width + sx] as number;
      const fill = index.fills[cell];
      if (fill === 'outside') continue;
      const color = fill === 'sea' ? theme.sea : (colors.get(owners.get(index.ids[cell] as number) as number) ?? theme.land);
      const o = (j * size.w + i) * 4;
      out[o] = color[0];
      out[o + 1] = color[1];
      out[o + 2] = color[2];
      out[o + 3] = 255;
    }
  }
  return out;
}
