// FR-443 (spec 013): on the phone the camera works on the VISIBLE map area, between the top bar and the dock. Pure maths.
import { describe, expect, it } from 'vitest';
import {
  areaCentre,
  clampCamera,
  fitScale,
  initialCamera,
  isDefaultCamera,
  mapToScreen,
  panTo,
  screenToMap,
  withInset,
  zoomAt,
  type Viewport,
} from '../src/core/camera';
import { INSET_MS, insetAt } from '../src/core/inset';
import { PHONE, dockHeight, mapInset } from '../src/core/hud-layout';
import { cameraAtPoint, cameraZoomed, viewRect } from '../src/core/minimap';
import { pinchCamera } from '../src/core/pinch';
import { framing } from '../src/core/tour-camera';
import liveMain from '../src/ui/live-main.ts?raw';
import mapViewSource from '../src/ui/map-view.ts?raw';
import panelSource from '../src/ui/live-panel.ts?raw';

const IMAGE = { w: 1000, h: 800 };
const FULL = { width: 390, height: 844 };
const INSET = { top: 50, bottom: 337 };
const VP: Viewport = withInset(FULL, INSET);
// The visible area is 390 x 457, from y = 50 to y = 507; its centre is at y = 278.5.
const AREA_CENTRE_Y = 50 + 457 / 2;

describe('FR-443 the visible area', () => {
  it('FR-443 withInset adds the two margins and a zero inset is the plain viewport', () => {
    expect(VP).toStrictEqual({ width: 390, height: 844, top: 50, bottom: 337 });
    expect(withInset(FULL, { top: 0, bottom: 0 })).toStrictEqual(FULL);
  });

  it('FR-443 areaCentre is the middle of what is between the bars (the full middle without insets)', () => {
    expect(areaCentre(VP)).toStrictEqual({ sx: 195, sy: AREA_CENTRE_Y });
    expect(areaCentre(FULL)).toStrictEqual({ sx: 195, sy: 422 });
  });

  it('FR-443 the fit scale is that of the visible area, not of the whole canvas', () => {
    expect(fitScale(IMAGE, FULL)).toBeCloseTo(0.39, 10);
    expect(fitScale(IMAGE, VP)).toBeCloseTo(Math.min(390 / 1000, 457 / 800), 10);
    const tall = withInset({ width: 390, height: 844 }, { top: 50, bottom: 600 });
    expect(fitScale({ w: 100, h: 100 }, tall)).toBeCloseTo(194 / 100, 10);
  });

  it('FR-443 the default camera draws the middle of the map at the middle of the visible area, whole map inside it', () => {
    const cam = initialCamera(IMAGE, VP);
    const middle = mapToScreen(cam, { x: 500, y: 400 }, VP);
    expect(middle.sx).toBeCloseTo(195, 6);
    expect(middle.sy).toBeCloseTo(AREA_CENTRE_Y, 6);
    const top = mapToScreen(cam, { x: 500, y: 0 }, VP).sy;
    const bottom = mapToScreen(cam, { x: 500, y: 800 }, VP).sy;
    expect(top).toBeGreaterThanOrEqual(50 - 1e-6);
    expect(bottom).toBeLessThanOrEqual(507 + 1e-6);
  });

  it('FR-443 with no inset nothing changes for the desk', () => {
    expect(initialCamera(IMAGE, FULL)).toStrictEqual({ x: 500, y: 400, scale: fitScale(IMAGE, FULL) });
    expect(clampCamera({ x: -5, y: 900, scale: 1 }, IMAGE, FULL)).toStrictEqual({ x: 0, y: 800, scale: 1 });
  });

  it('FR-443 the clamp keeps the middle of the visible area inside the image (the canvas middle may leave it)', () => {
    const scale = 1;
    const low = clampCamera({ x: 500, y: -1000, scale }, IMAGE, VP);
    expect(screenToMap(low, areaCentre(VP), VP).y).toBeCloseTo(0, 6);
    const high = clampCamera({ x: 500, y: 5000, scale }, IMAGE, VP);
    expect(screenToMap(high, areaCentre(VP), VP).y).toBeCloseTo(800, 6);
    const side = clampCamera({ x: -50, y: 400, scale }, IMAGE, VP);
    expect(side.x).toBe(0);
  });

  it('FR-443 the scale floor is the fit scale of the visible area', () => {
    const cam = clampCamera({ x: 500, y: 400, scale: 0.01 }, IMAGE, VP);
    expect(cam.scale).toBeCloseTo(fitScale(IMAGE, VP), 10);
  });

  it('FR-443 isDefaultCamera tells the default view (so a dock change can move it) from a view the player chose', () => {
    expect(isDefaultCamera(initialCamera(IMAGE, VP), IMAGE, VP)).toBe(true);
    expect(isDefaultCamera(initialCamera(IMAGE, FULL), IMAGE, VP)).toBe(false);
    expect(isDefaultCamera({ ...initialCamera(IMAGE, VP), x: 510 }, IMAGE, VP)).toBe(false);
  });
});

describe('FR-443 dragging and zooming with the inset', () => {
  it('FR-443 panTo keeps the grabbed point under the pointer', () => {
    const cam = { x: 500, y: 400, scale: 1.5 };
    const grabbed = screenToMap(cam, { sx: 200, sy: 300 }, VP);
    const moved = panTo(cam, grabbed, { sx: 170, sy: 280 }, IMAGE, VP);
    const s = mapToScreen(moved, grabbed, VP);
    expect(s.sx).toBeCloseTo(170, 6);
    expect(s.sy).toBeCloseTo(280, 6);
  });

  it('FR-443 zoomAt keeps the point under the pointer', () => {
    const cam = { x: 500, y: 400, scale: 1.5 };
    const p = { sx: 100, sy: 200 };
    const at = screenToMap(cam, p, VP);
    const zoomed = zoomAt(cam, p, 2, IMAGE, VP);
    const s = mapToScreen(zoomed, at, VP);
    expect(s.sx).toBeCloseTo(100, 6);
    expect(s.sy).toBeCloseTo(200, 6);
  });
});

describe('FR-443 the minimap with the inset', () => {
  it('FR-443 the rectangle is what the visible area shows', () => {
    const cam = { x: 500, y: 400, scale: 1 };
    const full = viewRect(cam, { width: 200, height: 200 }, IMAGE);
    expect(full.h).toBeCloseTo(0.25, 10);
    const inset = viewRect(cam, withInset({ width: 200, height: 300 }, { top: 50, bottom: 50 }), IMAGE);
    expect(inset.y).toBeCloseTo(0.375, 10);
    expect(inset.h).toBeCloseTo(0.25, 10);
  });

  it('FR-443 the rectangle moves with the offset of the visible area', () => {
    const cam = { x: 500, y: 400, scale: 1 };
    const rect = viewRect(cam, withInset({ width: 200, height: 300 }, { top: 0, bottom: 100 }), IMAGE);
    // the visible area (200 high) is centred 50 px above the canvas middle: it shows y 250..450 of the map
    expect(rect.y).toBeCloseTo(250 / 800, 10);
    expect(rect.h).toBeCloseTo(200 / 800, 10);
  });

  it('FR-443 a tap on the minimap centres the visible area on the point', () => {
    const cam = cameraAtPoint({ x: 0.5, y: 0.5 }, { x: 0, y: 0, scale: 1 }, VP, IMAGE);
    const at = screenToMap(cam, areaCentre(VP), VP);
    expect(at.x).toBeCloseTo(500, 6);
    expect(at.y).toBeCloseTo(400, 6);
  });

  it('FR-443 the wheel and the pinch zoom about the middle of the visible area', () => {
    const cam = { x: 500, y: 400, scale: 1 };
    const before = screenToMap(cam, areaCentre(VP), VP);
    for (const zoomed of [cameraZoomed(cam, 3, VP, IMAGE), pinchCamera(cam, 2, VP, IMAGE)]) {
      expect(zoomed.scale).toBeGreaterThan(1);
      const after = screenToMap(zoomed, areaCentre(VP), VP);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
  });
});

describe('FR-443 the framing of a tour with the inset', () => {
  it('FR-443 a framed box is centred in the visible area and sized by it', () => {
    const box = { x0: 400, y0: 300, x1: 500, y1: 400 };
    const cam = framing(box, IMAGE, VP);
    const centre = mapToScreen(cam, { x: 450, y: 350 }, VP);
    expect(centre.sx).toBeCloseTo(195, 6);
    expect(centre.sy).toBeCloseTo(AREA_CENTRE_Y, 6);
    // half the visible area bounds the scale, not half the canvas
    const full = framing(box, IMAGE, FULL);
    expect(cam.scale).toBeLessThanOrEqual(full.scale + 1e-9);
  });
});

describe('FR-443 the dock sets the inset', () => {
  it('FR-443 desk: no inset; phone: the top bar and the dock as it stands now', () => {
    expect(mapInset(1280, 720, false)).toStrictEqual({ top: 0, bottom: 0 });
    expect(mapInset(390, 844, false)).toStrictEqual({ top: PHONE.topBar, bottom: dockHeight(844, false) });
    expect(mapInset(390, 844, true)).toStrictEqual({ top: PHONE.topBar, bottom: PHONE.dockFolded });
    expect(mapInset(390, 844, false).bottom).toBe(337);
  });
});

describe('FR-443 the inset eases when the dock folds, so the map does not jump', () => {
  const open = { top: 50, bottom: 337 };
  const folded = { top: 50, bottom: 72 };
  it('FR-443 it starts at the old value, ends at the new one and moves monotonically between', () => {
    expect(insetAt(open, folded, 0)).toStrictEqual(open);
    expect(insetAt(open, folded, INSET_MS)).toStrictEqual(folded);
    expect(insetAt(open, folded, INSET_MS * 5)).toStrictEqual(folded);
    let last = 337;
    for (let t = 20; t < INSET_MS; t += 20) {
      const now = insetAt(open, folded, t).bottom;
      expect(now).toBeLessThanOrEqual(last);
      expect(now).toBeGreaterThanOrEqual(72);
      last = now;
    }
    expect(insetAt(open, folded, INSET_MS / 2).bottom).toBeGreaterThan(72);
    expect(insetAt(open, folded, INSET_MS / 2).bottom).toBeLessThan(337);
  });
});

describe('FR-443 the shell hands the dock to the camera', () => {
  const mapView = mapViewSource;
  it('FR-443 the live scene builds its viewport with the inset, tells the view when the dock changes and on every resize', () => {
    expect(liveMain).toMatch(/mapInset\(window\.innerWidth, window\.innerHeight, dockFolded\)/);
    expect(liveMain).toMatch(/onDock: \(folded\) => \{\s*dockFolded = folded;\s*view\?\.setInset\(insetNow\(\)\);/);
    expect(liveMain).toMatch(/onResize: \(\) => \{\s*created\.setInset\(insetNow\(\)\);/);
    expect(liveMain).toMatch(/viewport: canvasViewport\(\)/);
  });

  it('FR-443 the view glides the margins with the frame loop (a default view follows, another keeps what it shows)', () => {
    expect(mapView).toMatch(/const gliding = stepInset\(t\);/);
    expect(mapView).toMatch(/isDefaultCamera\(camera, image, viewport\)/);
    expect(mapView).toMatch(/insetAt\(glide\.from, glide\.to,/);
    expect(mapView).toMatch(/resize', \(\) => \{\s*viewport = withInset\(/);
  });

  it('FR-443 the panel reports the dock with every repaint', () => {
    expect(panelSource).toMatch(/handlers\.onDock\?\.\(dockNow\.folded\)/);
  });
});
