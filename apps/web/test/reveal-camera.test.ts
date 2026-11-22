// Camera composition around the reveal duel callout (spec 031): pure geometry tests.
// Pins the math and border cases: callout on each side, front wider than the visible area,
// front already centred (with and without occlusion), aspect-driven side vs below choice,
// near-edge map clamping, sidebar-cropped available rect, and degenerate occlusion inputs.
import { describe, expect, it } from 'vitest';
import { clampCamera, fitScale, mapToScreen, MAX_SCALE, type ImageSize, type Viewport } from '../src/core/camera';
import type { Box } from '../src/core/tour-camera';
import { composeRevealCamera, freeRects, frontBoxOf, REVEAL_EASE_MS, type ScreenRect } from '../src/core/reveal-camera';

const IMAGE: ImageSize = { w: 1000, h: 1000 };
const VP: Viewport = { width: 1000, height: 600 };

/** Projects a map Box to a screen rect [x0, x1] x [y0, y1] using the exact viewer camera projection. */
function projectBox(box: Box, cam: { x: number; y: number; scale: number }, vp: Viewport): { x0: number; y0: number; x1: number; y1: number } {
  const a = mapToScreen(cam, { x: box.x0, y: box.y0 }, vp);
  const b = mapToScreen(cam, { x: box.x1, y: box.y1 }, vp);
  return { x0: a.sx, y0: a.sy, x1: b.sx, y1: b.sy };
}

/** Exact overlap area between a projected box and a ScreenRect (0 when disjoint or touching edges). */
function overlapWith(proj: { x0: number; y0: number; x1: number; y1: number }, rect: ScreenRect): number {
  const w = Math.max(0, Math.min(proj.x1, rect.x + rect.w) - Math.max(proj.x0, rect.x));
  const h = Math.max(0, Math.min(proj.y1, rect.y + rect.h) - Math.max(proj.y0, rect.y));
  return w * h;
}

describe('spec 031 reveal camera composition (pure geometry)', () => {
  it('freeRects partitions the available area around an intersecting occlusion rect and returns [available] when disjoint', () => {
    const avail: ScreenRect = { x: 0, y: 0, w: 1000, h: 600 };
    expect(freeRects(avail, { x: 0, y: 0, w: 0, h: 0 })).toStrictEqual([avail]);
    expect(freeRects(avail, { x: 1100, y: 0, w: 200, h: 100 })).toStrictEqual([avail]);
    expect(freeRects(avail, { x: 0, y: 0, w: 1000, h: 600 })).toStrictEqual([]);

    const parts = freeRects(avail, { x: 200, y: 100, w: 400, h: 150 });
    expect(parts).toContainEqual({ x: 0, y: 250, w: 1000, h: 350 }); // below
    expect(parts).toContainEqual({ x: 0, y: 0, w: 1000, h: 100 }); // above
    expect(parts).toContainEqual({ x: 600, y: 0, w: 400, h: 600 }); // right
    expect(parts).toContainEqual({ x: 0, y: 0, w: 200, h: 600 }); // left
    expect(parts).toHaveLength(4);
  });

  it('callout on each side (top, bottom, left, right): front stays 100% visible and unoccluded in the remaining space', () => {
    const front: Box = { x0: 420, y0: 420, x1: 580, y1: 540 }; // 160 x 120 map units

    // Top callout spanning full width
    const topOcc: ScreenRect = { x: 0, y: 0, w: 1000, h: 200 };
    const topRes = composeRevealCamera({ front, occlusion: topOcc, viewport: VP, image: IMAGE });
    const topProj = projectBox(front, topRes.camera, VP);
    expect(topRes.occludedFraction).toBe(0);
    expect(topRes.visibleFraction).toBeCloseTo(1, 6);
    expect(overlapWith(topProj, topOcc)).toBe(0);
    expect(topProj.y0).toBeGreaterThanOrEqual(200 - 1e-6);
    expect(topProj.y1).toBeLessThanOrEqual(600 + 1e-6);
    expect(topRes.camera).toStrictEqual(clampCamera(topRes.camera, IMAGE, VP));

    // Bottom callout spanning full width
    const botOcc: ScreenRect = { x: 0, y: 400, w: 1000, h: 200 };
    const botRes = composeRevealCamera({ front, occlusion: botOcc, viewport: VP, image: IMAGE });
    const botProj = projectBox(front, botRes.camera, VP);
    expect(botRes.occludedFraction).toBe(0);
    expect(botRes.visibleFraction).toBeCloseTo(1, 6);
    expect(overlapWith(botProj, botOcc)).toBe(0);
    expect(botProj.y1).toBeLessThanOrEqual(400 + 1e-6);
    expect(botProj.y0).toBeGreaterThanOrEqual(-1e-6);

    // Left callout spanning full height
    const leftOcc: ScreenRect = { x: 0, y: 0, w: 360, h: 600 };
    const leftRes = composeRevealCamera({ front, occlusion: leftOcc, viewport: VP, image: IMAGE });
    const leftProj = projectBox(front, leftRes.camera, VP);
    expect(leftRes.occludedFraction).toBe(0);
    expect(leftRes.visibleFraction).toBeCloseTo(1, 6);
    expect(overlapWith(leftProj, leftOcc)).toBe(0);
    expect(leftProj.x0).toBeGreaterThanOrEqual(360 - 1e-6);
    expect(leftProj.x1).toBeLessThanOrEqual(1000 + 1e-6);

    // Right callout spanning full height
    const rightOcc: ScreenRect = { x: 640, y: 0, w: 360, h: 600 };
    const rightRes = composeRevealCamera({ front, occlusion: rightOcc, viewport: VP, image: IMAGE });
    const rightProj = projectBox(front, rightRes.camera, VP);
    expect(rightRes.occludedFraction).toBe(0);
    expect(rightRes.visibleFraction).toBeCloseTo(1, 6);
    expect(overlapWith(rightProj, rightOcc)).toBe(0);
    expect(rightProj.x1).toBeLessThanOrEqual(640 + 1e-6);
    expect(rightProj.x0).toBeGreaterThanOrEqual(-1e-6);
  });

  it('front wider than the visible area: clamps scale to fitScale, never returns NaN, and maximises unoccluded visibility', () => {
    const img: ImageSize = { w: 1200, h: 800 };
    const vp: Viewport = { width: 600, height: 600 }; // fitScale = 0.5
    const fit = fitScale(img, vp);
    expect(fit).toBe(0.5);

    // Wide horizontal front spanning the full image width (1200 map units -> 600 px at fitScale)
    const wideFront: Box = { x0: 0, y0: 350, x1: 1200, y1: 500 };

    // Top callout leaves full 600 px width below it -> front fits cleanly below at fitScale with 0 occlusion
    const topOcc: ScreenRect = { x: 0, y: 0, w: 600, h: 180 };
    const below = composeRevealCamera({ front: wideFront, occlusion: topOcc, viewport: vp, image: img });
    expect(below.camera.scale).toBeCloseTo(fit, 10);
    expect(below.occludedFraction).toBe(0);
    expect(below.visibleFraction).toBeCloseTo(1, 6);
    expect(overlapWith(projectBox(wideFront, below.camera, vp), topOcc)).toBe(0);

    // Left callout narrows the remaining width to 350 px while the front is 600 px wide at fitScale:
    // cannot zoom below fitScale, must stay finite, clamped, and shift the front right to reduce occlusion.
    const sideOcc: ScreenRect = { x: 0, y: 0, w: 250, h: 600 };
    const beside = composeRevealCamera({ front: wideFront, occlusion: sideOcc, viewport: vp, image: img });
    expect(Number.isFinite(beside.camera.x)).toBe(true);
    expect(Number.isFinite(beside.camera.y)).toBe(true);
    expect(beside.camera.scale).toBeGreaterThanOrEqual(fit - 1e-9);
    expect(beside.camera).toStrictEqual(clampCamera(beside.camera, img, vp));
    // Compared to naive centering at (600, 425), panning right (smaller cam.x) reduces occlusion behind sideOcc.
    expect(beside.camera.x).toBeLessThan(600);
    expect(beside.visibleFraction).toBeGreaterThan(0.5);
  });

  it('front already centred: zero pan drift without occlusion, and clean shift out from under an overlapping top-centre callout', () => {
    const centredFront: Box = { x0: 440, y0: 440, x1: 560, y1: 560 }; // centred at (500, 500)

    // No occlusion -> camera centres directly on (500, 500) with zero drift
    const plain = composeRevealCamera({ front: centredFront, occlusion: { x: 0, y: 0, w: 0, h: 0 }, viewport: VP, image: IMAGE });
    expect(plain.camera.x).toBeCloseTo(500, 6);
    expect(plain.camera.y).toBeCloseTo(500, 6);
    expect(plain.occludedFraction).toBe(0);
    expect(plain.visibleFraction).toBeCloseTo(1, 6);

    // Top-centre callout covering y = 60..220 -> below region is [0, 1000] x [220, 600], centre (500, 410):
    // horizontal centre stays at 500 (no lateral drift) while camera pans up (y < 500) to push the front down into [220, 600].
    const topCentre: ScreenRect = { x: 280, y: 60, w: 440, h: 160 };
    const shifted = composeRevealCamera({ front: centredFront, occlusion: topCentre, viewport: VP, image: IMAGE });
    const proj = projectBox(centredFront, shifted.camera, VP);
    expect(shifted.occludedFraction).toBe(0);
    expect(shifted.visibleFraction).toBeCloseTo(1, 6);
    expect(overlapWith(proj, topCentre)).toBe(0);
    // Exact check: the front centre projects into the chosen free region centre
    const cx = (proj.x0 + proj.x1) / 2;
    const cy = (proj.y0 + proj.y1) / 2;
    expect(cx).toBeCloseTo(shifted.region.x + shifted.region.w / 2, 4);
    expect(cy).toBeCloseTo(shifted.region.y + shifted.region.h / 2, 4);

    // Dead-centre callout overlapping (500, 500) -> front moves cleanly beside or below, never behind it
    const deadCentre: ScreenRect = { x: 350, y: 200, w: 300, h: 200 };
    const dodged = composeRevealCamera({ front: centredFront, occlusion: deadCentre, viewport: VP, image: IMAGE });
    expect(dodged.occludedFraction).toBe(0);
    expect(dodged.visibleFraction).toBeCloseTo(1, 6);
    expect(overlapWith(projectBox(centredFront, dodged.camera, VP), deadCentre)).toBe(0);
  });

  it('automatically chooses beside vs below based on front aspect ratio around a top-left duel callout', () => {
    const vp: Viewport = { width: 1280, height: 800 };
    const available: ScreenRect = { x: 296, y: 52, w: 760, h: 600 }; // between desktop sidebars, top bar and bottom hub
    const callout: ScreenRect = { x: 312, y: 68, w: 380, h: 160 }; // top-left of available map area

    // Tall vertical front -> fits at a larger scale to the right of the callout (tall column)
    const tallFront: Box = { x0: 500, y0: 250, x1: 620, y1: 650 }; // 120 x 400
    const tallRes = composeRevealCamera({ front: tallFront, occlusion: callout, available, viewport: vp, image: IMAGE });
    expect(tallRes.occludedFraction).toBe(0);
    expect(tallRes.visibleFraction).toBeCloseTo(1, 6);
    // Right of callout: x >= 692
    expect(tallRes.region.x).toBeGreaterThanOrEqual(callout.x + callout.w - 1e-6);

    // Wide horizontal front -> fits at a larger scale below the callout (wide strip)
    const wideFront: Box = { x0: 200, y0: 450, x1: 750, y1: 580 }; // 550 x 130
    const wideRes = composeRevealCamera({ front: wideFront, occlusion: callout, available, viewport: vp, image: IMAGE });
    expect(wideRes.occludedFraction).toBe(0);
    expect(wideRes.visibleFraction).toBeCloseTo(1, 6);
    // Below callout: y >= 228
    expect(wideRes.region.y).toBeGreaterThanOrEqual(callout.y + callout.h - 1e-6);
  });

  it('near-edge fronts obey clampCamera and still avoid occlusion behind the callout', () => {
    const cornerFront: Box = { x0: 5, y0: 5, x1: 120, y1: 100 };
    const callout: ScreenRect = { x: 20, y: 20, w: 420, h: 160 };
    const res = composeRevealCamera({ front: cornerFront, occlusion: callout, viewport: VP, image: IMAGE });
    expect(res.camera).toStrictEqual(clampCamera(res.camera, IMAGE, VP));
    expect(res.occludedFraction).toBe(0);
    expect(res.visibleFraction).toBeCloseTo(1, 6);
    expect(overlapWith(projectBox(cornerFront, res.camera, VP), callout)).toBe(0);
  });

  it('respects scale ceiling (maxFitMultiplier and MAX_SCALE) for tiny fronts and handles full-screen occlusion gracefully', () => {
    const tinyFront: Box = { x0: 500, y0: 500, x1: 504, y1: 504 };
    const fit = fitScale(IMAGE, VP);
    const tinyRes = composeRevealCamera({ front: tinyFront, occlusion: { x: 0, y: 0, w: 0, h: 0 }, viewport: VP, image: IMAGE });
    expect(tinyRes.camera.scale).toBeLessThanOrEqual(Math.min(MAX_SCALE, fit * 4) + 1e-9);
    expect(tinyRes.camera.scale).toBeGreaterThanOrEqual(fit - 1e-9);

    // Full-screen occlusion: falls back safely with finite clamped camera
    const fullOcc: ScreenRect = { x: 0, y: 0, w: 1000, h: 600 };
    const fallback = composeRevealCamera({ front: { x0: 300, y0: 300, x1: 500, y1: 500 }, occlusion: fullOcc, viewport: VP, image: IMAGE });
    expect(Number.isFinite(fallback.camera.x)).toBe(true);
    expect(Number.isFinite(fallback.camera.y)).toBe(true);
    expect(Number.isFinite(fallback.camera.scale)).toBe(true);
    expect(fallback.camera).toStrictEqual(clampCamera(fallback.camera, IMAGE, VP));
  });

  it('frontBoxOf converts FrontField bounds to a half-open Box and rejects empty fields; ease duration is positive', () => {
    expect(frontBoxOf({ x0: 10, y0: 20, width: 35, height: 45 })).toStrictEqual({ x0: 10, y0: 20, x1: 45, y1: 65 });
    expect(frontBoxOf({ x0: 0, y0: 0, width: 0, height: 10 })).toBeUndefined();
    expect(frontBoxOf({ x0: 0, y0: 0, width: 10, height: 0 })).toBeUndefined();
    expect(REVEAL_EASE_MS).toBeGreaterThan(0);
  });
});
