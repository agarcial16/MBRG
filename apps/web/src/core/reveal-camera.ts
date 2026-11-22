// Camera composition around the reveal duel callout (spec 031).
// Pure geometry: given the annexation front bounds in map units, the callout occlusion rectangle
// in CSS pixels, the unobstructed map area, the viewport and the image dimensions, returns the
// clamped Camera that keeps the annexation front visible in the remaining free area.
import { clampCamera, mapToScreen, scaleLimits } from './camera';
import type { Camera, ImageSize, Viewport } from './camera';
import type { Box } from './tour-camera';

/** An axis-aligned screen rectangle in CSS pixels: [x, x + w] x [y, y + h]. */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface RevealComposeInput {
  /** Bounding box of the annexation front in map units: [x0, x1) x [y0, y1). */
  readonly front: Box;
  /** Screen rectangle covered by the reveal duel callout, in CSS pixels. */
  readonly occlusion: ScreenRect;
  /** Drawing viewport (with optional top/bottom bar insets). */
  readonly viewport: Viewport;
  /** Map image size in map units. */
  readonly image: ImageSize;
  /** Unobstructed map area inside the viewport (e.g. excluding sidebars and bars); defaults to the viewport minus top/bottom insets. */
  readonly available?: ScreenRect;
  /** Breathing room around the front inside the chosen free rectangle, in CSS pixels (default 24). */
  readonly padding?: number;
  /** Maximum zoom relative to fitScale (default 4, also bounded by MAX_SCALE). */
  readonly maxFitMultiplier?: number;
}

export interface RevealComposition {
  readonly camera: Camera;
  /** The chosen occlusion-free screen sub-rectangle (or `available` on fallback). */
  readonly region: ScreenRect;
  /** Share of the projected front area strictly inside `available` and outside `occlusion` (0..1). */
  readonly visibleFraction: number;
  /** Share of the projected front area covered by `occlusion` (0..1). */
  readonly occludedFraction: number;
}

/** Smooth easing duration for reveal camera composition, in milliseconds. */
export const REVEAL_EASE_MS = 520;

const DEFAULT_PADDING = 24;
const DEFAULT_MAX_FIT_MULTIPLIER = 4;
const EPS = 1e-5;

const rectArea = (r: ScreenRect): number => Math.max(0, r.w) * Math.max(0, r.h);

function intersectRect(a: ScreenRect, b: ScreenRect): ScreenRect | undefined {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined;
}

/** Converts a FrontField bounding box to a half-open Box, or undefined when empty. */
export function frontBoxOf(field: { readonly x0: number; readonly y0: number; readonly width: number; readonly height: number }): Box | undefined {
  if (field.width <= 0 || field.height <= 0) return undefined;
  return { x0: field.x0, y0: field.y0, x1: field.x0 + field.width, y1: field.y0 + field.height };
}

/**
 * The maximal axis-aligned sub-rectangles of `available` that do not overlap `occlusion`
 * (below, above, right, left). Returns `[available]` when `occlusion` is empty or disjoint,
 * and `[]` when `occlusion` covers the whole `available` area.
 */
export function freeRects(available: ScreenRect, occlusion: ScreenRect): ScreenRect[] {
  if (available.w <= 0 || available.h <= 0) return [];
  const cut = intersectRect(available, occlusion);
  if (cut === undefined) return [available];
  const ax0 = available.x;
  const ay0 = available.y;
  const ax1 = available.x + available.w;
  const ay1 = available.y + available.h;
  const ox0 = cut.x;
  const oy0 = cut.y;
  const ox1 = cut.x + cut.w;
  const oy1 = cut.y + cut.h;
  const out: ScreenRect[] = [];
  if (ay1 > oy1) out.push({ x: ax0, y: oy1, w: ax1 - ax0, h: ay1 - oy1 });
  if (oy0 > ay0) out.push({ x: ax0, y: ay0, w: ax1 - ax0, h: oy0 - ay0 });
  if (ax1 > ox1) out.push({ x: ox1, y: ay0, w: ax1 - ox1, h: ay1 - ay0 });
  if (ox0 > ax0) out.push({ x: ax0, y: ay0, w: ox0 - ax0, h: ay1 - ay0 });
  return out;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function defaultAvailable(vp: Viewport): ScreenRect {
  const top = vp.top ?? 0;
  const bottom = vp.bottom ?? 0;
  return { x: 0, y: top, w: Math.max(1, vp.width), h: Math.max(1, vp.height - top - bottom) };
}

function evaluateCandidate(
  front: Box,
  region: ScreenRect,
  scale: number,
  available: ScreenRect,
  occlusion: ScreenRect,
  viewport: Viewport,
  image: ImageSize,
): RevealComposition {
  const fcx = (front.x0 + front.x1) / 2;
  const fcy = (front.y0 + front.y1) / 2;
  const rcx = region.x + region.w / 2;
  const rcy = region.y + region.h / 2;
  const raw: Camera = {
    x: fcx - (rcx - viewport.width / 2) / scale,
    y: fcy - (rcy - viewport.height / 2) / scale,
    scale,
  };
  const camera = clampCamera(raw, image, viewport);
  const p0 = mapToScreen(camera, { x: front.x0, y: front.y0 }, viewport);
  const p1 = mapToScreen(camera, { x: front.x1, y: front.y1 }, viewport);
  const proj: ScreenRect = { x: p0.sx, y: p0.sy, w: Math.max(1e-6, p1.sx - p0.sx), h: Math.max(1e-6, p1.sy - p0.sy) };
  const projArea = rectArea(proj);
  const inAvail = intersectRect(proj, available);
  const occInAvail = inAvail === undefined ? undefined : intersectRect(inAvail, occlusion);
  const occTotal = intersectRect(proj, occlusion);
  const visibleArea = (inAvail === undefined ? 0 : rectArea(inAvail)) - (occInAvail === undefined ? 0 : rectArea(occInAvail));
  const occludedArea = occTotal === undefined ? 0 : rectArea(occTotal);
  return {
    camera,
    region,
    visibleFraction: clamp01(visibleArea / projArea),
    occludedFraction: clamp01(occludedArea / projArea),
  };
}

function isBetter(a: RevealComposition, b: RevealComposition): boolean {
  if (Math.abs(a.visibleFraction - b.visibleFraction) > EPS) return a.visibleFraction > b.visibleFraction;
  if (Math.abs(a.occludedFraction - b.occludedFraction) > EPS) return a.occludedFraction < b.occludedFraction;
  if (Math.abs(a.camera.scale - b.camera.scale) > EPS) return a.camera.scale > b.camera.scale;
  return rectArea(a.region) > rectArea(b.region);
}

/**
 * Computes the camera target and zoom that frames `front` inside the best occlusion-free region
 * around `occlusion` within `available`, always clamped to valid camera bounds.
 */
export function composeRevealCamera(input: RevealComposeInput): RevealComposition {
  const { front, occlusion, viewport, image } = input;
  const available = input.available ?? defaultAvailable(viewport);
  const padding = Math.max(0, input.padding ?? DEFAULT_PADDING);
  const maxFitMultiplier = Math.max(1, input.maxFitMultiplier ?? DEFAULT_MAX_FIT_MULTIPLIER);
  const { min: minScale, max: absMax } = scaleLimits(image, viewport);
  const maxScale = Math.min(absMax, Math.max(minScale, minScale * maxFitMultiplier));
  const frontW = Math.max(1, front.x1 - front.x0);
  const frontH = Math.max(1, front.y1 - front.y0);

  const rects = freeRects(available, occlusion);
  const regions = rects.length > 0 ? rects : [available];
  let best: RevealComposition | undefined;

  for (const region of regions) {
    const padX = Math.min(padding, region.w * 0.15);
    const padY = Math.min(padding, region.h * 0.15);
    const usableW = Math.max(1, region.w - 2 * padX);
    const usableH = Math.max(1, region.h - 2 * padY);
    const wanted = Math.min(usableW / frontW, usableH / frontH);
    const scale = Math.min(Math.max(wanted, minScale), maxScale);
    const primary = evaluateCandidate(front, region, scale, available, occlusion, viewport, image);
    if (best === undefined || isBetter(primary, best)) best = primary;
    if (primary.visibleFraction < 1 - EPS && scale > minScale + EPS) {
      const zoomedOut = evaluateCandidate(front, region, minScale, available, occlusion, viewport, image);
      if (isBetter(zoomedOut, best)) best = zoomedOut;
    }
  }

  return best!;
}
