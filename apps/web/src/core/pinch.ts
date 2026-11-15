// Two-finger pinch on the phone minimap (spec 013 FR-412). Pure: the ratio of the finger distances in, the zoomed camera out.
import { WHEEL_BASE } from './camera';
import type { Camera, ImageSize, Viewport } from './camera';
import { cameraZoomed } from './minimap';

/** The distance between two touch points. */
export const pinchDistance = (a: { readonly x: number; readonly y: number }, b: { readonly x: number; readonly y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The camera after fingers moved apart by `ratio` (new distance over old): zoomed about the centre of the view by that ratio, inside
 * the limits of every camera. A ratio that is not a positive finite number changes nothing.
 */
export function pinchCamera(camera: Camera, ratio: number, viewport: Viewport, image: ImageSize): Camera {
  if (!(ratio > 0) || !Number.isFinite(ratio)) return camera;
  return cameraZoomed(camera, Math.log(ratio) / Math.log(WHEEL_BASE), viewport, image);
}
