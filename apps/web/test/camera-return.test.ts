import { describe, expect, it } from 'vitest';
import { initialCamera } from '../src/core/camera';
import { cameraReturn, movedByUser, roundBegan, watchStart } from '../src/core/camera-return';

const IMAGE = { w: 1000, h: 600 };
const VIEWPORT = { width: 800, height: 500 };

describe('FR-410 the camera returns to the default view at the end of a round', () => {
  it('FR-410 the user has not moved the camera since the round began: the default view', () => {
    expect(cameraReturn(watchStart, IMAGE, VIEWPORT)).toStrictEqual(initialCamera(IMAGE, VIEWPORT));
  });

  it('FR-410 a drag, wheel, pinch or minimap move leaves the camera where the user put it', () => {
    expect(cameraReturn(movedByUser(watchStart), IMAGE, VIEWPORT)).toBeUndefined();
  });

  it('FR-410 a new round begins: the next end returns again', () => {
    const moved = movedByUser(watchStart);
    expect(cameraReturn(roundBegan(moved), IMAGE, VIEWPORT)).toStrictEqual(initialCamera(IMAGE, VIEWPORT));
  });

  it('FR-410 a camera taken from the address (a shared view) counts as moved from the start', () => {
    expect(watchStart.moved).toBe(false);
    expect(movedByUser(watchStart).moved).toBe(true);
  });
});
