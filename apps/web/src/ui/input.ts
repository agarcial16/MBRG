// Pointer, wheel and keyboard input (FR-145, FR-146, FR-154). Thin: the maths lives in core/camera and
// core/navigation; this file only turns DOM events into calls.
import { panTo, screenToMap, wheelSteps, zoomAt } from '../core/camera';
import type { Camera, ImageSize, MapPoint, ScreenPoint, Viewport } from '../core/camera';
import { keyAction, shortcutApplies } from '../core/navigation';
import type { NavAction } from '../core/navigation';

export interface InputTarget {
  image: ImageSize;
  viewport(): Viewport;
  camera(): Camera;
  setCamera(camera: Camera): void;
  /** The pointer position over the drawing area in CSS pixels, or undefined when it left. */
  pointerMoved(point: ScreenPoint | undefined): void;
  navigate(action: NavAction): void;
}

/** Wires drag, wheel, pointer readout and shortcuts to a target. */
export function attachInput(canvas: HTMLCanvasElement, target: InputTarget): void {
  const local = (e: MouseEvent): ScreenPoint => {
    const rect = canvas.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  };
  let grabbed: MapPoint | undefined;

  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    grabbed = screenToMap(target.camera(), local(e), target.viewport());
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    const point = local(e);
    target.pointerMoved(point);
    if (grabbed !== undefined) {
      target.setCamera(panTo(target.camera(), grabbed, point, target.image, target.viewport()));
    }
  });
  const release = (e: PointerEvent): void => {
    grabbed = undefined;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => {
    if (grabbed === undefined) target.pointerMoved(undefined);
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
    const action = keyAction(e.key);
    if (action === undefined) return;
    if (!shortcutApplies((e.target as Element | null)?.tagName)) return;
    e.preventDefault();
    target.navigate(action);
  });
}
