// Camera mathematics (FR-144 to FR-149). Pure: no DOM, no clock, no randomness (NFR-25).
// Units: map units for positions, CSS pixels for the screen, "scale" = screen pixels per map unit.

/** View centre in map units and scale. */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}
/** Drawing area in CSS pixels. */
export interface Viewport {
  width: number;
  height: number;
}
/** Id image size in map units. */
export interface ImageSize {
  w: number;
  h: number;
}
export interface ScreenPoint {
  sx: number;
  sy: number;
}
export interface MapPoint {
  x: number;
  y: number;
}

/** Largest scale (FR-146). */
export const MAX_SCALE = 32;
/** Scale factor of one wheel step (decision U4). */
export const WHEEL_BASE = 1.2;

/** Largest scale at which the whole image is visible in the drawing area. */
export function fitScale(image: ImageSize, vp: Viewport): number {
  return Math.min(vp.width / image.w, vp.height / image.h);
}

/** Scale limits: from the fit scale to 32; when the fit scale is above 32 both limits are 32. */
export function scaleLimits(image: ImageSize, vp: Viewport): { min: number; max: number } {
  return { min: Math.min(fitScale(image, vp), MAX_SCALE), max: MAX_SCALE };
}

/** The view of FR-144: whole image at fit scale, centred. */
export function initialCamera(image: ImageSize, vp: Viewport): Camera {
  return { x: image.w / 2, y: image.h / 2, scale: scaleLimits(image, vp).min };
}

export function screenToMap(cam: Camera, p: ScreenPoint, vp: Viewport): MapPoint {
  return { x: cam.x + (p.sx - vp.width / 2) / cam.scale, y: cam.y + (p.sy - vp.height / 2) / cam.scale };
}

export function mapToScreen(cam: Camera, m: MapPoint, vp: Viewport): ScreenPoint {
  return { sx: (m.x - cam.x) * cam.scale + vp.width / 2, sy: (m.y - cam.y) * cam.scale + vp.height / 2 };
}

/** Scale inside its limits and centre inside the image rectangle (FR-146, FR-147). */
export function clampCamera(cam: Camera, image: ImageSize, vp: Viewport): Camera {
  const { min, max } = scaleLimits(image, vp);
  return {
    x: Math.min(Math.max(cam.x, 0), image.w),
    y: Math.min(Math.max(cam.y, 0), image.h),
    scale: Math.min(Math.max(cam.scale, min), max),
  };
}

/**
 * Drag (FR-145): the centre that puts map point `grabbed` under `pointer`, then clamped.
 * When the clamp moves the centre, FR-147 wins over the 1 px rule.
 */
export function panTo(cam: Camera, grabbed: MapPoint, pointer: ScreenPoint, image: ImageSize, vp: Viewport): Camera {
  return clampCamera(
    {
      x: grabbed.x - (pointer.sx - vp.width / 2) / cam.scale,
      y: grabbed.y - (pointer.sy - vp.height / 2) / cam.scale,
      scale: cam.scale,
    },
    image,
    vp,
  );
}

/** Zoom by `steps` wheel steps about a screen point (FR-146): the map point under it stays under it. */
export function zoomAt(cam: Camera, pointer: ScreenPoint, steps: number, image: ImageSize, vp: Viewport): Camera {
  const { min, max } = scaleLimits(image, vp);
  const scale = Math.min(Math.max(cam.scale * WHEEL_BASE ** steps, min), max);
  const m = screenToMap(cam, pointer, vp);
  return clampCamera(
    { x: m.x - (pointer.sx - vp.width / 2) / scale, y: m.y - (pointer.sy - vp.height / 2) / scale, scale },
    image,
    vp,
  );
}

/** Wheel steps of one event: 100 px of delta is one step; line mode counts 33 px, page mode 800 px. */
export function wheelSteps(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 800 : deltaY;
  return -px / 100 || 0;
}

/** Resize (FR-148): keep the centre and the scale, raising the scale to the new fit scale if needed. */
export function resizeCamera(cam: Camera, image: ImageSize, vp: Viewport): Camera {
  return clampCamera(cam, image, vp);
}
