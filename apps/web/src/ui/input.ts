// Pointer, wheel and keyboard input (FR-145, FR-146, FR-154). Thin: the maths lives in core/camera and
// core/navigation; this file only turns DOM events into calls.
import { wheelSteps, zoomAt } from '../core/camera';
import type { Camera, ImageSize, ScreenPoint, Viewport } from '../core/camera';
import { keyAction, shortcutApplies } from '../core/navigation';
import type { NavAction } from '../core/navigation';
import { gestureDown, gestureMove, gestureUp, idleGesture } from '../core/pointer-gesture';
import type { Gesture } from '../core/pointer-gesture';
import { isTap } from '../core/predict-model';

export interface InputTarget {
  image: ImageSize;
  viewport(): Viewport;
  camera(): Camera;
  setCamera(camera: Camera): void;
  /** The pointer position over the drawing area in CSS pixels, or undefined when it left. */
  pointerMoved(point: ScreenPoint | undefined): void;
  navigate(action: NavAction): void;
  /** The skip key of the reveal tours (spec 009 FR-341): Escape. */
  onSkip?(): void;
  /** A press and release that did not drag (spec 013 FR-401): the point over the drawing area in CSS pixels. */
  onTap?(point: ScreenPoint): void;
}

/** Wires drag, wheel, pointer readout and shortcuts to a target. */
export function attachInput(canvas: HTMLCanvasElement, target: InputTarget): void {
  const local = (e: MouseEvent): ScreenPoint => {
    const rect = canvas.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  };
  // FR-434: every pointer that is down; one pans, two pinch (core/pointer-gesture).
  let gesture: Gesture = idleGesture;
  let pressed: { sx: number; sy: number; at: number } | undefined;

  canvas.style.touchAction = 'none';
  // Safari has its own two-finger page zoom (gesture events): the map takes the gesture.
  for (const name of ['gesturestart', 'gesturechange']) canvas.addEventListener(name, (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    gesture = gestureDown(gesture, e.pointerId, local(e), target.camera(), target.viewport());
    // A second finger turns the press into a gesture: it is no tap.
    pressed = gesture.multi ? undefined : { ...local(e), at: e.timeStamp };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured: the gesture simply ends with its release.
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const point = local(e);
    target.pointerMoved(point);
    const moved = gestureMove(gesture, e.pointerId, point, target.camera(), target.image, target.viewport());
    gesture = moved.gesture;
    if (moved.camera !== undefined) target.setCamera(moved.camera);
  });
  const release = (e: PointerEvent): void => {
    gesture = gestureUp(gesture, e.pointerId, target.camera(), target.viewport());
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', (e) => {
    const down = pressed;
    pressed = undefined;
    if (down !== undefined && !gesture.multi && e.button === 0 && isTap(down, { ...local(e), at: e.timeStamp })) target.onTap?.(local(e));
    release(e);
  });
  canvas.addEventListener('pointercancel', (e) => {
    pressed = undefined;
    release(e);
  });
  canvas.addEventListener('pointerleave', () => {
    if (gesture.fingers.size === 0) target.pointerMoved(undefined);
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const steps = wheelSteps(e.deltaY, e.deltaMode);
      if (steps === 0) return;
      target.setCamera(zoomAt(target.camera(), local(e), steps, target.image, target.viewport()));
    },
    { passive: false },
  );
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    if (e.key === 'Escape') {
      target.onSkip?.();
      return;
    }
    const action = keyAction(e.key);
    if (action === undefined) return;
    if (!shortcutApplies((e.target as Element | null)?.tagName)) return;
    e.preventDefault();
    target.navigate(action);
  });
}
