/**
 * Viewport camera for the map: world → screen via `screen = world * scale + t`.
 *
 * Pure math first (fit / zoom-at-point / pan / clamp — deterministic and test
 * friendly), then a small `CameraController` that binds pointer/wheel/resize
 * events and reports back through `onChange`.
 */

export interface Camera {
  scale: number;
  tx: number;
  ty: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface ScaleLimits {
  min: number;
  max: number;
}

/** Largest scale that fits the whole map inside the viewport. */
export function fitScale(view: Size, mapW: number, mapH: number): number {
  if (mapW <= 0 || mapH <= 0 || view.width <= 0 || view.height <= 0) return 1;
  return Math.min(view.width / mapW, view.height / mapH);
}

/** Camera that shows the entire map, centered. */
export function fitCamera(view: Size, mapW: number, mapH: number): Camera {
  const scale = fitScale(view, mapW, mapH);
  return {
    scale,
    tx: (view.width - mapW * scale) / 2,
    ty: (view.height - mapH * scale) / 2,
  };
}

/**
 * Keep the camera usable: scale inside `limits`, and the map never escapes —
 * when zoomed in it must cover the viewport, when smaller it stays centered.
 */
export function clampCamera(
  cam: Camera,
  view: Size,
  mapW: number,
  mapH: number,
  limits: ScaleLimits,
): Camera {
  const scale = Math.min(Math.max(cam.scale, limits.min), limits.max);
  const sw = mapW * scale;
  const sh = mapH * scale;
  const tx = sw >= view.width ? Math.min(Math.max(cam.tx, view.width - sw), 0) : (view.width - sw) / 2;
  const ty = sh >= view.height ? Math.min(Math.max(cam.ty, view.height - sh), 0) : (view.height - sh) / 2;
  return { scale, tx, ty };
}

/** Zoom by `factor` keeping the world point under the screen cursor fixed. */
export function zoomAt(cam: Camera, factor: number, sx: number, sy: number): Camera {
  const wx = (sx - cam.tx) / cam.scale;
  const wy = (sy - cam.ty) / cam.scale;
  const scale = cam.scale * factor;
  return { scale, tx: sx - wx * scale, ty: sy - wy * scale };
}

/** Pan by a screen-space delta. */
export function panBy(cam: Camera, dx: number, dy: number): Camera {
  return { scale: cam.scale, tx: cam.tx + dx, ty: cam.ty + dy };
}

/** Screen (CSS px inside the canvas) → world coordinates. */
export function screenToWorld(cam: Camera, sx: number, sy: number): [number, number] {
  return [(sx - cam.tx) / cam.scale, (sy - cam.ty) / cam.scale];
}

export interface CameraControllerOptions {
  canvas: HTMLCanvasElement;
  mapWidth: number;
  mapHeight: number;
  /** Called after every camera change (pan/zoom/fit/resize) — redraw here. */
  onChange: () => void;
}

/** Zoom step per wheel notch / button press. */
const ZOOM_STEP = 1.4;
/** exp() factor for wheel deltas (pixels; lines are normalized to pixels). */
const WHEEL_K = 0.005;
/** Map viewport block (px) → label font clamps live here too (commit E). */
const MIN_ZOOM_FACTOR = 0.5;
const MAX_ZOOM_FACTOR = 16;

/**
 * Owns the camera state and the DOM interaction: drag to pan, wheel (and
 * trackpad pinch, which arrives as ctrl+wheel) to zoom at cursor, double-click
 * to zoom in, ResizeObserver keeps fit/clamp in sync.
 */
export class CameraController {
  private cam: Camera;
  private view: Size = { width: 0, height: 0 };
  private limits: ScaleLimits = { min: 0.0001, max: Number.MAX_VALUE };
  /** True once the user pans/zooms manually (resize then keeps their view). */
  private userAdjusted = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private readonly observer: ResizeObserver;

  constructor(private readonly options: CameraControllerOptions) {
    this.measure();
    this.cam = clampCamera(
      fitCamera(this.view, options.mapWidth, options.mapHeight),
      this.view,
      options.mapWidth,
      options.mapHeight,
      this.limits,
    );
    this.bind();
    this.observer = new ResizeObserver(() => this.onResize());
    this.observer.observe(options.canvas);
  }

  get camera(): Camera {
    return this.cam;
  }

  /** Current viewport size in CSS px (needed to project the minimap rect). */
  get viewport(): Size {
    return { ...this.view };
  }

  /** Fit the whole map (toolbar button / initial state). */
  fit(): void {
    this.userAdjusted = false;
    this.measure();
    this.apply(fitCamera(this.view, this.options.mapWidth, this.options.mapHeight));
  }

  /** Center the view on a world point (minimap click / drag). */
  centerOn(wx: number, wy: number): void {
    this.userAdjusted = true;
    this.apply({
      scale: this.cam.scale,
      tx: this.view.width / 2 - wx * this.cam.scale,
      ty: this.view.height / 2 - wy * this.cam.scale,
    });
  }

  zoomIn(): void {
    this.zoomBy(ZOOM_STEP);
  }

  zoomOut(): void {
    this.zoomBy(1 / ZOOM_STEP);
  }

  /** Exported for Phase 3 (click a province → hit test). */
  screenToWorld(sx: number, sy: number): [number, number] {
    return screenToWorld(this.cam, sx, sy);
  }

  /** Recompute viewport + limits from the canvas' current CSS size. */
  private measure(): void {
    const { canvas, mapWidth, mapHeight } = this.options;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0) return;
    this.view = { width, height };
    const fit = fitScale(this.view, mapWidth, mapHeight);
    this.limits = { min: fit * MIN_ZOOM_FACTOR, max: fit * MAX_ZOOM_FACTOR };
  }

  private apply(cam: Camera): void {
    this.cam = clampCamera(cam, this.view, this.options.mapWidth, this.options.mapHeight, this.limits);
    this.options.onChange();
  }

  private zoomBy(factor: number, sx?: number, sy?: number): void {
    this.userAdjusted = true;
    const cx = sx ?? this.view.width / 2;
    const cy = sy ?? this.view.height / 2;
    this.apply(zoomAt(this.cam, factor, cx, cy));
  }

  private onResize(): void {
    this.measure();
    // Haven't touched the camera yet? Follow the window; else keep user view.
    this.apply(this.userAdjusted ? this.cam : fitCamera(this.view, this.options.mapWidth, this.options.mapHeight));
  }

  private bind(): void {
    const { canvas } = this.options;

    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.userAdjusted = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('dragging');
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.apply(panBy(this.cam, dx, dy));
    });

    const end = (e: PointerEvent): void => {
      if (!this.dragging) return;
      this.dragging = false;
      canvas.classList.remove('dragging');
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault(); // don't scroll the page while zooming the map
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // lines → px
        this.zoomBy(Math.exp(-delta * WHEEL_K), e.offsetX, e.offsetY);
      },
      { passive: false },
    );

    canvas.addEventListener('dblclick', (e) => {
      this.zoomBy(ZOOM_STEP, e.offsetX, e.offsetY);
    });
  }
}
