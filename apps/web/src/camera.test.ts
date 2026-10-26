import { describe, expect, it } from 'vitest';

import {
  clampCamera,
  clampScale,
  fitCamera,
  fitScale,
  panBy,
  screenToWorld,
  zoomAt,
  zoomToLimit,
  type Camera,
  type ScaleLimits,
} from './camera.js';

const VIEW = { width: 1000, height: 600 };
const MAP = { width: 2000, height: 1000 };
const LIMITS: ScaleLimits = { min: 0.25, max: 8 };

/** Where the given screen point lands in the world, at a given camera. */
function worldAt(cam: Camera, sx: number, sy: number): [number, number] {
  return screenToWorld(cam, sx, sy);
}

describe('fit', () => {
  it('el mapa entero cabe en la ventana', () => {
    const cam = fitCamera(VIEW, MAP.width, MAP.height);
    // Width is the binding constraint here: 1000/2000 = 0.5 beats 600/1000.
    expect(cam.scale).toBeCloseTo(0.5);
    expect(cam.scale * MAP.height).toBeLessThan(VIEW.height); // letterboxed
    expect(cam.ty).toBeCloseTo((VIEW.height - 500) / 2);
  });

  it('es 1 con dimensiones degeneradas en vez de NaN', () => {
    expect(fitScale({ width: 0, height: 0 }, 10, 10)).toBe(1);
    expect(fitScale(VIEW, 0, 10)).toBe(1);
  });
});

describe('clampScale', () => {
  it('deja pasar las escalas dentro del rango', () => {
    expect(clampScale(1, LIMITS)).toBe(1);
    expect(clampScale(100, LIMITS)).toBe(LIMITS.max);
    expect(clampScale(0.0001, LIMITS)).toBe(LIMITS.min);
  });
});

describe('clampCamera', () => {
  it('recorta la escala a los limites', () => {
    expect(clampCamera({ scale: 100, tx: 0, ty: 0 }, VIEW, MAP.width, MAP.height, LIMITS).scale).toBe(8);
    expect(clampCamera({ scale: 0.01, tx: 0, ty: 0 }, VIEW, MAP.width, MAP.height, LIMITS).scale).toBe(0.25);
  });

  it('al recortar la escala deja el centro del viewport donde estaba', () => {
    // The bug this guards: the translation was computed against the scale being
    // discarded, so clamping without re-anchoring moved the map under the user.
    //
    // Deep zoom, focused off-centre so the anchor has something to preserve.
    const deep: Camera = { scale: 30, tx: -4200, ty: -6100 };
    const clamped = clampCamera(deep, VIEW, MAP.width, MAP.height, LIMITS);
    expect(clamped.scale).toBe(8);

    const before = worldAt(deep, VIEW.width / 2, VIEW.height / 2);
    const after = worldAt(clamped, VIEW.width / 2, VIEW.height / 2);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
  });

  it('el zoom maximo no recorta el mapa: sigue cubriendo la ventana', () => {
    // The reported symptom: at max zoom a strip of void appeared next to the map.
    const cam = clampCamera({ scale: 500, tx: 0, ty: 0 }, VIEW, MAP.width, MAP.height, LIMITS);
    const sw = MAP.width * cam.scale;
    const sh = MAP.height * cam.scale;
    expect(sw).toBeGreaterThanOrEqual(VIEW.width);
    expect(sh).toBeGreaterThanOrEqual(VIEW.height);
    // …which means both offsets are inside the range that keeps it covered.
    expect(cam.tx).toBeLessThanOrEqual(0);
    expect(cam.ty).toBeLessThanOrEqual(0);
    expect(cam.tx + sw).toBeGreaterThanOrEqual(VIEW.width);
    expect(cam.ty + sh).toBeGreaterThanOrEqual(VIEW.height);
  });

  it('centra el mapa cuando es mas pequeno que la ventana', () => {
    const cam = clampCamera({ scale: 0.05, tx: 900, ty: 500 }, VIEW, 100, 100, LIMITS);
    expect(cam.scale).toBe(0.25);
    expect(cam.tx).toBeCloseTo((VIEW.width - 25) / 2);
    expect(cam.ty).toBeCloseTo((VIEW.height - 25) / 2);
  });

  it('no deja escapar el mapa al desplazar', () => {
    const base: Camera = { scale: 2, tx: 0, ty: 0 };
    const right = clampCamera(panBy(base, 99999, 0), VIEW, MAP.width, MAP.height, LIMITS);
    expect(right.tx).toBe(0);
    const left = clampCamera(panBy(base, -99999, 0), VIEW, MAP.width, MAP.height, LIMITS);
    expect(left.tx + MAP.width * left.scale).toBeCloseTo(VIEW.width);
  });
});

describe('zoomAt', () => {
  it('deja fijo el punto del mundo bajo el cursor', () => {
    const cam = fitCamera(VIEW, MAP.width, MAP.height);
    const [wx, wy] = worldAt(cam, 320, 480);
    const zoomed = zoomAt(cam, 2.5, 320, 480);
    const [zx, zy] = worldAt(zoomed, 320, 480);
    expect(zx).toBeCloseTo(wx, 9);
    expect(zy).toBeCloseTo(wy, 9);
  });

  it('alejar y volver a cerca recupera la camara de partida', () => {
    const cam = fitCamera(VIEW, MAP.width, MAP.height);
    const there = zoomAt(zoomAt(cam, 3, 100, 100), 1 / 3, 100, 100);
    expect(there.scale).toBeCloseTo(cam.scale, 9);
    expect(there.tx).toBeCloseTo(cam.tx, 6);
    expect(there.ty).toBeCloseTo(cam.ty, 6);
  });
});

describe('el clamp del zoom no sacude la vista al llegar al tope', () => {
  it('en el tope, un notch mas no mueve nada', () => {
    const max = clampCamera(
      { scale: LIMITS.max, tx: 0, ty: 0 },
      VIEW,
      MAP.width,
      MAP.height,
      LIMITS,
    );
    const again = zoomToLimit(max, 1.4, 640, 300, VIEW, MAP.width, MAP.height, LIMITS);
    expect(again.scale).toBeCloseTo(max.scale, 9);
    expect(again.tx).toBeCloseTo(max.tx, 9);
    expect(again.ty).toBeCloseTo(max.ty, 9);
  });

  it('al acercarse al tope, el punto bajo el cursor se queda', () => {
    // Clamping after the fact instead of before is what used to make the last
    // few notches jump: the anchor was computed at a scale that was then thrown away.
    let cam = fitCamera(VIEW, MAP.width, MAP.height);
    const sx = 640;
    const sy = 300;
    const before = worldAt(cam, sx, sy);
    for (let i = 0; i < 20; i++) {
      cam = zoomToLimit(cam, 1.4, sx, sy, VIEW, MAP.width, MAP.height, LIMITS);
    }
    const after = worldAt(cam, sx, sy);
    expect(cam.scale).toBeCloseTo(LIMITS.max, 6);
    expect(after[0]).toBeCloseTo(before[0], 3);
    expect(after[1]).toBeCloseTo(before[1], 3);
  });

  it('el tope de alejamiento tambien se respeta', () => {
    let cam = fitCamera(VIEW, MAP.width, MAP.height);
    for (let i = 0; i < 20; i++) {
      cam = zoomToLimit(cam, 1 / 1.4, 640, 300, VIEW, MAP.width, MAP.height, LIMITS);
    }
    expect(cam.scale).toBeCloseTo(LIMITS.min, 6);
  });
});
