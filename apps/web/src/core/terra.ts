// Terra incognita (spec 010 FR-368, ground changed by spec 015 FR-422): the table that shows where the map does not cover the screen.
// Pure geometry: the screen rectangles that lie outside the image. The colours and the edge fade are in `table.ts`.
import { mapToScreen } from './camera';
import type { Camera, ImageSize, Viewport } from './camera';

export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * The parts of the viewport that the image does not cover, as at most four rectangles of screen pixels that do not overlap: above
 * the map, below it, and left and right of it between those two. A viewport wholly inside the map has none; a map that is not on
 * screen at all gives the whole viewport as one band.
 */
export function terraBands(camera: Camera, viewport: Viewport, image: ImageSize): ScreenRect[] {
  const a = mapToScreen(camera, { x: 0, y: 0 }, viewport);
  const b = mapToScreen(camera, { x: image.w, y: image.h }, viewport);
  const left = Math.max(0, a.sx);
  const top = Math.max(0, a.sy);
  const right = Math.min(viewport.width, b.sx);
  const bottom = Math.min(viewport.height, b.sy);
  const whole: ScreenRect = { x: 0, y: 0, w: viewport.width, h: viewport.height };
  if (right <= left || bottom <= top) return [whole];
  const bands: ScreenRect[] = [
    { x: 0, y: 0, w: viewport.width, h: top },
    { x: 0, y: bottom, w: viewport.width, h: viewport.height - bottom },
    { x: 0, y: top, w: left, h: bottom - top },
    { x: right, y: top, w: viewport.width - right, h: bottom - top },
  ];
  return bands.filter((band) => band.w > 0 && band.h > 0);
}
