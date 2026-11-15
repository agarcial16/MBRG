// The camera at the end of a round (spec 013 FR-410). Pure: a flag the shell raises when the user moves the camera (drag, wheel, pinch,
// minimap, a shared address) and the default view the camera returns to when the flag is down. A tour moving the camera is not the user.
import { initialCamera } from './camera';
import type { Camera, ImageSize, Viewport } from './camera';

export interface CameraWatch {
  /** The user moved the camera since the round began. */
  readonly moved: boolean;
}

export const watchStart: CameraWatch = { moved: false };

/** The user moved the camera: it is theirs until the next round begins. */
export const movedByUser = (_watch: CameraWatch): CameraWatch => ({ moved: true });

/** A new round began: the camera is nobody's again. */
export const roundBegan = (_watch: CameraWatch): CameraWatch => ({ moved: false });

/** FR-410: the default view when the round ends and the user did not move the camera; none when they did. */
export function cameraReturn(watch: CameraWatch, image: ImageSize, viewport: Viewport): Camera | undefined {
  return watch.moved ? undefined : initialCamera(image, viewport);
}
