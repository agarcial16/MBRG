import { describe, expect, it } from 'vitest';
import { clampCamera, fitScale, MAX_SCALE, scaleLimits, screenToMap } from '../src/core/camera';
import type { Camera } from '../src/core/camera';
import { gestureDown, gestureMove, gestureUp, idleGesture } from '../src/core/pointer-gesture';
import type { Gesture } from '../src/core/pointer-gesture';

const IMAGE = { w: 1000, h: 600 };
const VP = { width: 400, height: 300 };
const CAMERA: Camera = { x: 500, y: 300, scale: 1 };
const at = (sx: number, sy: number) => ({ sx, sy });

const two = (cam: Camera): Gesture => gestureDown(gestureDown(idleGesture, 1, at(150, 150), cam, VP), 2, at(250, 150), cam, VP);

describe('FR-434 two-pointer gesture on the map', () => {
  it('FR-434 one finger pans: the map point under it stays under it', () => {
    const down = gestureDown(idleGesture, 1, at(200, 150), CAMERA, VP);
    const moved = gestureMove(down, 1, at(150, 120), CAMERA, IMAGE, VP);
    expect(moved.camera).toBeDefined();
    const under = screenToMap(moved.camera!, at(150, 120), VP);
    expect(under.x).toBeCloseTo(500, 6);
    expect(under.y).toBeCloseTo(300, 6);
  });

  it('FR-434 fingers spreading to twice the distance double the scale about the midpoint', () => {
    const cam = { x: 500, y: 300, scale: 0.5 };
    const g = two(cam);
    const before = screenToMap(cam, at(200, 150), VP);
    const moved = gestureMove(gestureMove(g, 1, at(100, 150), cam, IMAGE, VP).gesture, 2, at(300, 150), cam, IMAGE, VP);
    expect(moved.camera!.scale).toBeCloseTo(1, 6);
    const after = screenToMap(moved.camera!, at(200, 150), VP);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('FR-434 fingers closing zoom out, never below the fit scale', () => {
    const cam = { x: 500, y: 300, scale: 0.5 };
    const g = two(cam);
    const moved = gestureMove(gestureMove(g, 1, at(199, 150), cam, IMAGE, VP).gesture, 2, at(201, 150), cam, IMAGE, VP);
    expect(moved.camera!.scale).toBeCloseTo(scaleLimits(IMAGE, VP).min, 9);
    expect(scaleLimits(IMAGE, VP).min).toBeCloseTo(fitScale(IMAGE, VP), 9);
  });

  it('FR-434 spreading is capped at the largest scale', () => {
    const cam = { x: 500, y: 300, scale: 20 };
    const g = two(cam);
    const moved = gestureMove(gestureMove(g, 1, at(0, 150), cam, IMAGE, VP).gesture, 2, at(400, 150), cam, IMAGE, VP);
    expect(moved.camera!.scale).toBe(MAX_SCALE);
  });

  it('FR-434 moving both fingers together pans by the midpoint', () => {
    const g = two(CAMERA);
    const a = gestureMove(g, 1, at(130, 150), CAMERA, IMAGE, VP);
    const b = gestureMove(a.gesture, 2, at(230, 150), a.camera ?? CAMERA, IMAGE, VP);
    expect(b.camera!.scale).toBeCloseTo(1, 6);
    const under = screenToMap(b.camera!, at(180, 150), VP);
    expect(under.x).toBeCloseTo(500 + 0, 6);
  });

  it('FR-434 the result stays inside the camera limits', () => {
    const g = two(CAMERA);
    const moved = gestureMove(g, 1, at(1000, 1000), CAMERA, IMAGE, VP);
    const camera = moved.camera!;
    expect(camera).toStrictEqual(clampCamera(camera, IMAGE, VP));
  });

  it('FR-434 a second finger landing changes nothing by itself (no jump)', () => {
    const cam = { x: 400, y: 250, scale: 2 };
    const one = gestureDown(idleGesture, 1, at(100, 100), cam, VP);
    const g = gestureDown(one, 2, at(300, 200), cam, VP);
    // The next move of an unmoved finger gives back the same camera.
    const moved = gestureMove(g, 1, at(100, 100), cam, IMAGE, VP);
    expect(moved.camera!.x).toBeCloseTo(cam.x, 9);
    expect(moved.camera!.y).toBeCloseTo(cam.y, 9);
    expect(moved.camera!.scale).toBeCloseTo(cam.scale, 9);
  });

  it('FR-434 a finger lifting leaves the other one panning from where it is (no jump)', () => {
    const cam = { x: 400, y: 250, scale: 2 };
    const g = gestureUp(two(cam), 2, cam, VP);
    const moved = gestureMove(g, 1, at(150, 150), cam, IMAGE, VP);
    expect(moved.camera!.x).toBeCloseTo(cam.x, 9);
    expect(moved.camera!.y).toBeCloseTo(cam.y, 9);
    const further = gestureMove(moved.gesture, 1, at(170, 150), moved.camera!, IMAGE, VP);
    expect(further.camera!.x).toBeLessThan(cam.x);
  });

  it('FR-434 a press that had two fingers is never a tap, also after one lifts and the last one lifts', () => {
    let g = gestureUp(two(CAMERA), 2, CAMERA, VP);
    expect(g.multi).toBe(true);
    g = gestureUp(g, 1, CAMERA, VP);
    expect(g.fingers.size).toBe(0);
    expect(g.multi).toBe(false);
    const single = gestureDown(idleGesture, 1, at(1, 1), CAMERA, VP);
    expect(single.multi).toBe(false);
  });

  it('FR-434 an unknown pointer moves nothing and lifting it is harmless', () => {
    const g = gestureDown(idleGesture, 1, at(1, 1), CAMERA, VP);
    expect(gestureMove(g, 9, at(50, 50), CAMERA, IMAGE, VP).camera).toBeUndefined();
    expect(gestureUp(g, 9, CAMERA, VP).fingers.size).toBe(1);
  });

  it('FR-434 two fingers on the same spot do not blow the scale up', () => {
    const cam = { x: 500, y: 300, scale: 1 };
    const g = gestureDown(gestureDown(idleGesture, 1, at(200, 150), cam, VP), 2, at(200, 150), cam, VP);
    const moved = gestureMove(g, 2, at(260, 150), cam, IMAGE, VP);
    expect(Number.isFinite(moved.camera!.scale)).toBe(true);
  });
});
