import type { FactionId, MapFormatV1, Ownership, TerritoryId } from '@mbrg/shared';

import type { Camera, Size } from './camera.js';
import { screenToWorld } from './camera.js';
import { territoryColorsOf } from './render.js';

const VIEW_FILL = 'rgb(232 232 242 / 12%)';
const VIEW_STROKE = '#e8e8f2';

export interface MinimapView {
  /** Minimap scale: world → minimap px (fit, centered). */
  scale: number;
  offX: number;
  offY: number;
}

/** Fit the whole map inside the minimap box, centered. */
export function minimapView(mini: Size, mapW: number, mapH: number): MinimapView {
  const scale = Math.min(mini.width / mapW, mini.height / mapH);
  return {
    scale,
    offX: (mini.width - mapW * scale) / 2,
    offY: (mini.height - mapH * scale) / 2,
  };
}

/** Minimap px → world coordinates. */
export function minimapToWorld(mv: MinimapView, px: number, py: number): [number, number] {
  return [(px - mv.offX) / mv.scale, (py - mv.offY) / mv.scale];
}

/**
 * Draw the minimap: the whole map in miniature (fills + thin borders) with a
 * rectangle showing the current viewport. Pure draw — interaction lives in the
 * controller below.
 */
export function drawMinimap(
  canvas: HTMLCanvasElement,
  map: MapFormatV1,
  owners: Ownership,
  colors: Record<FactionId, string>,
  camera: Camera,
  view: Size,
  fills?: Record<TerritoryId, string>,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW <= 0 || cssH <= 0) return;
  const bw = Math.round(cssW * dpr);
  const bh = Math.round(cssH * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const mapW = map.width ?? 800;
  const mapH = map.height ?? 600;
  const mv = minimapView({ width: cssW, height: cssH }, mapW, mapH);

  ctx.save();
  ctx.translate(mv.offX, mv.offY);
  ctx.scale(mv.scale, mv.scale);

  // Fills (mid-animation crossfade colors included).
  const resolved = fills ?? territoryColorsOf(owners, colors);
  for (const t of map.territories) {
    const [first, ...rest] = t.polygon;
    ctx.beginPath();
    ctx.moveTo(first[0], first[1]);
    for (const [x, y] of rest) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fillStyle = resolved[t.id] ?? '#888899';
    ctx.fill();
    ctx.strokeStyle = 'rgb(13 13 21 / 70%)';
    ctx.lineWidth = 1 / mv.scale; // ~1 minimap px regardless of map size
    ctx.stroke();
  }
  ctx.restore();

  // Viewport rectangle: world rect of the visible screen area.
  const [wx0, wy0] = screenToWorld(camera, 0, 0);
  const [wx1, wy1] = screenToWorld(camera, view.width, view.height);
  const rx = mv.offX + wx0 * mv.scale;
  const ry = mv.offY + wy0 * mv.scale;
  const rw = (wx1 - wx0) * mv.scale;
  const rh = (wy1 - wy0) * mv.scale;
  ctx.fillStyle = VIEW_FILL;
  ctx.fillRect(rx, ry, rw, rh);
  ctx.strokeStyle = VIEW_STROKE;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(rx, ry, rw, rh);
}

export interface MinimapControllerOptions {
  canvas: HTMLCanvasElement;
  map: MapFormatV1;
  /** Called with world coordinates on click/drag (camera should center on it). */
  onPick: (wx: number, wy: number) => void;
}

/** Click / drag on the minimap to move the main viewport there. */
export class MinimapController {
  private dragging = false;

  constructor(options: MinimapControllerOptions) {
    const { canvas, map } = options;
    const mapW = map.width ?? 800;
    const mapH = map.height ?? 600;

    const pick = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      // Recompute per pick so resizes never desync the projection.
      const mv = minimapView({ width: rect.width, height: rect.height }, mapW, mapH);
      const [wx, wy] = minimapToWorld(mv, e.clientX - rect.left, e.clientY - rect.top);
      // Ignore picks outside the map rectangle (dead space in the box).
      if (wx < 0 || wy < 0 || wx > mapW || wy > mapH) return;
      options.onPick(wx, wy);
    };

    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      canvas.setPointerCapture(e.pointerId);
      pick(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) pick(e);
    });
    const end = (e: PointerEvent): void => {
      this.dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }
}
