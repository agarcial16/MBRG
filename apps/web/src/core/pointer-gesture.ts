// Pan and pinch on the map (spec 013 FR-434). Pure: the pointers that are down in, the camera out. Every change in the number of
// fingers (one lands, one lifts) takes a new anchor from the camera on screen, so the camera never jumps; one finger pans, two
// zoom about their midpoint and pan with it.
import { clampCamera, panTo, scaleLimits, screenToMap } from './camera';
import type { Camera, ImageSize, MapPoint, ScreenPoint, Viewport } from './camera';

/** What the fingers held when the last one landed or lifted: the map point under their midpoint, their distance and the scale. */
interface Anchor {
  readonly map: MapPoint;
  /** 0 with a single finger. */
  readonly distance: number;
  readonly scale: number;
}

export interface Gesture {
  readonly fingers: ReadonlyMap<number, ScreenPoint>;
  readonly anchor: Anchor | undefined;
  /** More than one finger was down at some point of this press: it is not a tap. */
  readonly multi: boolean;
}

export const idleGesture: Gesture = { fingers: new Map(), anchor: undefined, multi: false };

const midpoint = (points: readonly ScreenPoint[]): ScreenPoint => ({
  sx: points.reduce((sum, p) => sum + p.sx, 0) / points.length,
  sy: points.reduce((sum, p) => sum + p.sy, 0) / points.length,
});

// Only the first two fingers count; a third one is ignored by the maths.
const firstTwo = (fingers: ReadonlyMap<number, ScreenPoint>): ScreenPoint[] => [...fingers.values()].slice(0, 2);

function anchorOf(fingers: ReadonlyMap<number, ScreenPoint>, camera: Camera, viewport: Viewport): Anchor | undefined {
  const points = firstTwo(fingers);
  if (points.length === 0) return undefined;
  const distance = points.length < 2 ? 0 : Math.hypot(points[0]!.sx - points[1]!.sx, points[0]!.sy - points[1]!.sy);
  return { map: screenToMap(camera, midpoint(points), viewport), distance, scale: camera.scale };
}

/** A finger landed at `point`, with `camera` on screen. */
export function gestureDown(gesture: Gesture, id: number, point: ScreenPoint, camera: Camera, viewport: Viewport): Gesture {
  const fingers = new Map(gesture.fingers).set(id, point);
  return { fingers, anchor: anchorOf(fingers, camera, viewport), multi: gesture.multi || fingers.size > 1 };
}

/** A finger lifted (or the browser cancelled it); the last one ends the press. */
export function gestureUp(gesture: Gesture, id: number, camera: Camera, viewport: Viewport): Gesture {
  if (!gesture.fingers.has(id)) return gesture;
  const fingers = new Map(gesture.fingers);
  fingers.delete(id);
  if (fingers.size === 0) return idleGesture;
  return { fingers, anchor: anchorOf(fingers, camera, viewport), multi: gesture.multi };
}

/** A finger moved: the new gesture and the camera it asks for (undefined when the pointer is not down). */
export function gestureMove(
  gesture: Gesture,
  id: number,
  point: ScreenPoint,
  camera: Camera,
  image: ImageSize,
  viewport: Viewport,
): { readonly gesture: Gesture; readonly camera: Camera | undefined } {
  const anchor = gesture.anchor;
  if (!gesture.fingers.has(id) || anchor === undefined) return { gesture, camera: undefined };
  const fingers = new Map(gesture.fingers).set(id, point);
  const next: Gesture = { ...gesture, fingers };
  const points = firstTwo(fingers);
  if (points.length < 2 || anchor.distance <= 0) return { gesture: next, camera: panTo(camera, anchor.map, points[0]!, image, viewport) };
  const distance = Math.hypot(points[0]!.sx - points[1]!.sx, points[0]!.sy - points[1]!.sy);
  const { min, max } = scaleLimits(image, viewport);
  const scale = Math.min(Math.max(anchor.scale * (distance / anchor.distance), min), max);
  const mid = midpoint(points);
  const moved = clampCamera(
    { x: anchor.map.x - (mid.sx - viewport.width / 2) / scale, y: anchor.map.y - (mid.sy - viewport.height / 2) / scale, scale },
    image,
    viewport,
  );
  return { gesture: next, camera: moved };
}
