import { describe, expect, it } from 'vitest';
import { WHEEL_BASE, fitScale, initialCamera, scaleLimits } from '../src/core/camera';
import { pinchCamera, pinchDistance } from '../src/core/pinch';

const IMAGE = { w: 1000, h: 600 };
const VIEWPORT = { width: 400, height: 300 };
const camera = { x: 500, y: 300, scale: 1 };

describe('FR-412 pinch on the phone minimap', () => {
  it('FR-412 the distance between two touches', () => {
    expect(pinchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('FR-412 fingers twice as far apart zoom in by the same ratio about the centre of the view', () => {
    const next = pinchCamera(camera, 2, VIEWPORT, IMAGE);
    expect(next.scale).toBeCloseTo(2, 9);
    expect(next.x).toBeCloseTo(500, 9);
    expect(next.y).toBeCloseTo(300, 9);
  });

  it('FR-412 fingers closer together zoom out', () => {
    expect(pinchCamera({ ...camera, scale: 2 }, 0.5, VIEWPORT, IMAGE).scale).toBeCloseTo(1, 9);
  });

  it('FR-412 the scale stays inside the camera limits', () => {
    const { min, max } = scaleLimits(IMAGE, VIEWPORT);
    expect(pinchCamera(camera, 1e6, VIEWPORT, IMAGE).scale).toBe(max);
    expect(pinchCamera(camera, 1e-6, VIEWPORT, IMAGE).scale).toBe(min);
    expect(min).toBe(fitScale(IMAGE, VIEWPORT));
  });

  it('FR-412 a ratio that is not a positive finite number changes nothing', () => {
    const start = initialCamera(IMAGE, VIEWPORT);
    for (const ratio of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(pinchCamera(start, ratio, VIEWPORT, IMAGE)).toStrictEqual(start);
    expect(pinchCamera(camera, 1, VIEWPORT, IMAGE)).toStrictEqual(camera);
  });

  it('FR-412 one wheel step is the ratio of the wheel base', () => {
    expect(pinchCamera(camera, WHEEL_BASE, VIEWPORT, IMAGE).scale).toBeCloseTo(WHEEL_BASE, 9);
  });
});
