// The only user of the animation frame API (FR-182, NFR-33; plan decision D9). It turns requests into at most
// one frame per display frame and keeps asking for frames while the drawing says a step is running.
import { now } from './clock';

export interface FrameLoop {
  /** Asks for a frame; many requests before the frame give one frame. */
  request(): void;
}

/**
 * `onFrame` draws one frame at the given clock reading (milliseconds) and returns true when another frame
 * must follow (a step is running).
 */
export function createFrameLoop(onFrame: (nowMs: number) => boolean): FrameLoop {
  let pending = false;
  const schedule = (): void => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (onFrame(now())) schedule();
    });
  };
  return { request: schedule };
}
