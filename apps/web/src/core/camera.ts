// Camera mathematics (FR-144 to FR-149). Pure: no DOM, no clock, no randomness (NFR-25).
// Units: map units for positions, CSS pixels for the screen, "scale" = screen pixels per map unit.

/** View centre in map units and scale. */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}
/** Drawing area in CSS pixels. `top` and `bottom` are the bars that cover the canvas (the phone's top bar and dock, FR-443). */
export interface Viewport {
  width: number;
  height: number;
  top?: number;
  bottom?: number;
}
/** The margins of the canvas that the HUD covers. */
export interface Inset {
  top: number;
  bottom: number;
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

/** The viewport with these margins (a zero inset gives the plain viewport). */
export function withInset(vp: Viewport, inset: Inset): Viewport {
  const { width, height } = vp;
  return inset.top === 0 && inset.bottom === 0 ? { width, height } : { width, height, top: inset.top, bottom: inset.bottom };
}

/** Height of the part of the canvas no bar covers, never below 1 px. */
function visibleHeight(vp: Viewport): number {
  return Math.max(1, vp.height - (vp.top ?? 0) - (vp.bottom ?? 0));
}

/** Where the middle of the visible area is on screen: the middle of the canvas, moved by half the difference of the margins. */
export function areaCentre(vp: Viewport): ScreenPoint {
  return { sx: vp.width / 2, sy: vp.height / 2 + ((vp.top ?? 0) - (vp.bottom ?? 0)) / 2 };
}

/** Screen offset (px) of the visible middle from the canvas middle; the camera sits this far from the point it looks at. */
function offsetY(vp: Viewport): number {
  return ((vp.top ?? 0) - (vp.bottom ?? 0)) / 2;
}

/** Largest scale at which the whole image is visible in the visible area (FR-443). */
export function fitScale(image: ImageSize, vp: Viewport): number {
  return Math.min(vp.width / image.w, visibleHeight(vp) / image.h);
}

/** Scale limits: from the fit scale to 32; when the fit scale is above 32 both limits are 32. */
export function scaleLimits(image: ImageSize, vp: Viewport): { min: number; max: number } {
  return { min: Math.min(fitScale(image, vp), MAX_SCALE), max: MAX_SCALE };
}

/** The view of FR-144: whole image at fit scale, centred in the visible area (FR-443). */
export function initialCamera(image: ImageSize, vp: Viewport): Camera {
  const scale = scaleLimits(image, vp).min;
  return { x: image.w / 2, y: image.h / 2 - offsetY(vp) / scale, scale };
}

/** Whether `cam` is the default view of this viewport (a dock change may then move it; a view the player chose stays). */
export function isDefaultCamera(cam: Camera, image: ImageSize, vp: Viewport): boolean {
  const d = initialCamera(image, vp);
  return Math.abs(cam.x - d.x) < 1e-6 * image.w && Math.abs(cam.y - d.y) < 1e-6 * image.h && Math.abs(cam.scale - d.scale) < 1e-9 * d.scale;
}

export function screenToMap(cam: Camera, p: ScreenPoint, vp: Viewport): MapPoint {
  return { x: cam.x + (p.sx - vp.width / 2) / cam.scale, y: cam.y + (p.sy - vp.height / 2) / cam.scale };
}

export function mapToScreen(cam: Camera, m: MapPoint, vp: Viewport): ScreenPoint {
  return { sx: (m.x - cam.x) * cam.scale + vp.width / 2, sy: (m.y - cam.y) * cam.scale + vp.height / 2 };
}

/** Scale inside its limits and the middle of the visible area inside the image rectangle (FR-146, FR-147, FR-443). */
export function clampCamera(cam: Camera, image: ImageSize, vp: Viewport): Camera {
  const { min, max } = scaleLimits(image, vp);
  const scale = Math.min(Math.max(cam.scale, min), max);
  const shift = offsetY(vp) / scale;
  return {
    x: Math.min(Math.max(cam.x, 0), image.w),
    y: Math.min(Math.max(cam.y, 0 - shift), image.h - shift),
    scale,
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
