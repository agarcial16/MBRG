// The label layer (FR-172 to FR-175; spec 006 FR-200 to FR-202, FR-207): map and territory names drawn with the
// Canvas 2D API on a canvas that lies over the map canvas, so every label is above every fill and border line
// (FR-173). Text is drawn again at its displayed size on every call, in device pixels, so no bitmap is ever
// enlarged (FR-175). It receives finished label data and the view, and nothing else (FR-188, FR-212).
// Pass 1 draws the leader lines of the drawable labels; pass 2 draws the texts in the order given: a box label
// as 005 did, a straight label along its reading direction, an arc label glyph by glyph.
import type { Camera, Viewport } from '../core/camera';
import { GLYPH_REFERENCE_PX, arcGlyphs, glyphOffsets, straightMatrix } from '../core/glyph-layout';
import { scaledFade } from '../core/detail-scale';
import { drawable, frameOf, labelAlpha, screenBox } from '../core/label-frame';
import type { AnyLabelDraw, LabelDraw, ShapedDraw } from '../core/label-frame';
import { LABEL_PARAMS, fontString } from '../core/label-params';
import { clampScreenHeight } from '../core/label-readable';
import type { Indicator, Marker } from '../core/tour-frame';
import { TOUR_PARAMS } from '../core/tour-params';
import { deviceSize } from './map-scene';
import type { MapView } from './map-scene';

/** What a reveal tour adds over the labels (spec 009 FR-329, FR-333): the marker ring and the edge triangle. */
export interface TourOverlay {
  readonly marker?: Marker;
  readonly indicator?: Indicator;
}

export interface LabelLayer {
  /** Sizes the canvas for a drawing area in CSS pixels and a device pixel ratio. */
  resize(vp: Viewport, dpr: number): void;
  /**
   * Clears the layer and draws the labels in the order given, skipping those that are not drawable; the tour overlay,
   * when given, is drawn after every text and never with a label opacity (FR-329, FR-333).
   */
  draw(labels: readonly AnyLabelDraw[], view: MapView, overlay?: TourOverlay): void;
}

/** Halo width in CSS pixels: the stroke is centred on the outline, so 2 gives 1 pixel outside the glyph. */
const HALO_WIDTH = 2;
/** Leader line widths in CSS pixels (P12): a black line 3 wide under a white line 1 wide, 1 pixel of black on each side. */
const LEADER_BLACK = 3;
const LEADER_WHITE = 1;
const LEADER_BLACK_RGB = 'rgb(0, 0, 0)';
const LEADER_WHITE_RGB = 'rgb(255, 255, 255)';

const css = (c: readonly [number, number, number]): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

const isBox = (d: AnyLabelDraw): d is LabelDraw => 'box' in d;

/** Screen position (CSS pixels) of a map point. */
const toScreen = (cam: Camera, vp: Viewport, x: number, y: number): [number, number] => [
  (x - cam.x) * cam.scale + vp.width / 2,
  (y - cam.y) * cam.scale + vp.height / 2,
];

/** Quantized sprite heights in CSS pixels (always >= drawnH so no sprite is ever enlarged, FR-175). */
const SPRITE_BUCKETS = [12, 16, 22, 30, 40, 48] as const;
const ATLAS_SIZE = 2048;
const SPRITE_PAD = Math.ceil(HALO_WIDTH + 4);

interface TextSprite {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly cssW: number;
  readonly cssH: number;
  readonly textW: number;
  readonly bucket: number;
}

const bucketFor = (drawnH: number): number => {
  for (const b of SPRITE_BUCKETS) if (drawnH <= b) return b;
  return SPRITE_BUCKETS[SPRITE_BUCKETS.length - 1]!;
};

/** Attaches the layer to its canvas. Throws when the browser gives no 2D context. */
export function attachLabelLayer(canvas: HTMLCanvasElement): LabelLayer {
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2D context for the label layer');
  const base = LABEL_PARAMS;
  /** The fade thresholds of the drawing in progress (scaled by the view's detail factor). */
  let params = base;
  /** Glyph advances of each arc text at the reference size, measured once per text. */
  const advances = new Map<string, readonly number[]>();
  /** Single shelf-packed sprite atlas (browser contexts with drawImage; avoids per-frame strokeText & texture stalls). */
  const canSprite = typeof document !== 'undefined' && typeof ctx.drawImage === 'function';
  let atlasCanvas: HTMLCanvasElement | undefined;
  let atlasCtx: CanvasRenderingContext2D | null = null;
  const sprites = new Map<string, TextSprite>();
  let curX = 0;
  let curY = 0;
  let rowH = 0;
  let measuredAt: number | undefined;
  let spriteDpr = 0;

  const ensureAtlas = (): CanvasRenderingContext2D | null => {
    if (atlasCtx !== null) return atlasCtx;
    atlasCanvas = document.createElement('canvas');
    atlasCanvas.width = ATLAS_SIZE;
    atlasCanvas.height = ATLAS_SIZE;
    atlasCtx = atlasCanvas.getContext('2d');
    return atlasCtx;
  };

  const resetAtlas = (): void => {
    sprites.clear();
    curX = 0;
    curY = 0;
    rowH = 0;
    if (atlasCtx !== null) {
      atlasCtx.setTransform(1, 0, 0, 1, 0, 0);
      atlasCtx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    }
  };

  const advancesOf = (text: string): readonly number[] => {
    let a = advances.get(text);
    if (a === undefined) {
      ctx.font = fontString(GLYPH_REFERENCE_PX);
      a = Array.from(text).map((g) => ctx.measureText(g).width);
      advances.set(text, a);
    }
    return a;
  };

  const getSprite = (text: string, bucket: number, d: AnyLabelDraw, dpr: number): TextSprite | undefined => {
    const ink = css(d.ink);
    const halo = css(d.halo);
    const key = `${text}|${bucket}|${ink}|${halo}`;
    const hit = sprites.get(key);
    if (hit !== undefined) return hit;
    const sctx = ensureAtlas();
    if (sctx === null) return undefined;
    const font = fontString(bucket);
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.font = font;
    const textW = sctx.measureText(text).width;
    if (!(textW > 0)) return undefined;
    const cssW = Math.ceil(textW + SPRITE_PAD * 2);
    const cssH = Math.ceil(bucket * 1.5 + SPRITE_PAD * 2);
    const sw = Math.max(1, Math.ceil(cssW * dpr));
    const sh = Math.max(1, Math.ceil(cssH * dpr));
    if (sw > ATLAS_SIZE || sh > ATLAS_SIZE) return undefined;
    if (curX + sw > ATLAS_SIZE) {
      curX = 0;
      curY += rowH + 1;
      rowH = 0;
    }
    if (curY + sh > ATLAS_SIZE) resetAtlas();
    const sx = curX;
    const sy = curY;
    sctx.setTransform(dpr, 0, 0, dpr, sx, sy);
    sctx.font = font;
    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    sctx.lineJoin = 'round';
    sctx.lineWidth = HALO_WIDTH;
    sctx.strokeStyle = halo;
    sctx.strokeText(text, cssW / 2, cssH / 2);
    sctx.fillStyle = ink;
    sctx.fillText(text, cssW / 2, cssH / 2);
    curX += sw + 1;
    if (sh > rowH) rowH = sh;
    const entry: TextSprite = { sx, sy, sw, sh, cssW, cssH, textW, bucket };
    sprites.set(key, entry);
    return entry;
  };

  const paint = (d: AnyLabelDraw, text: string, x: number, y: number): void => {
    ctx.strokeStyle = css(d.halo);
    ctx.strokeText(text, x, y);
    ctx.fillStyle = css(d.ink);
    ctx.fillText(text, x, y);
  };

  const drawBox = (d: LabelDraw, view: MapView): void => {
    const { camera, viewport, dpr } = view;
    const box = screenBox(d.box, camera, viewport);
    const drawnH = clampScreenHeight(box.h, d.role);
    if (drawnH <= 0) return;
    const k = drawnH / box.h;
    const drawnW = box.w * k;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    if (cx + drawnW / 2 < 0 || cy + drawnH / 2 < 0 || cx - drawnW / 2 > viewport.width || cy - drawnH / 2 > viewport.height) return;
    if (canSprite) {
      const sprite = getSprite(d.text, bucketFor(drawnH), d, dpr);
      if (sprite !== undefined && atlasCanvas !== undefined) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(drawnW / sprite.textW, drawnH / sprite.bucket);
        ctx.globalAlpha = labelAlpha(d, camera.scale, params);
        ctx.drawImage(atlasCanvas, sprite.sx, sprite.sy, sprite.sw, sprite.sh, -sprite.cssW / 2, -sprite.cssH / 2, sprite.cssW, sprite.cssH);
        ctx.restore();
        return;
      }
    }
    // The font size is the clamped box height; the horizontal factor makes the advance width match drawnW exactly.
    ctx.font = fontString(drawnH);
    const measured = ctx.measureText(d.text).width;
    if (!(measured > 0)) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(drawnW / measured, 1);
    ctx.globalAlpha = labelAlpha(d, camera.scale, params);
    paint(d, d.text, 0, 0);
    ctx.restore();
  };

  const drawShaped = (d: ShapedDraw, view: MapView): void => {
    const { camera, viewport, dpr } = view;
    const f = frameOf(d);
    const [sx, sy] = toScreen(camera, viewport, f.cx, f.cy);
    const rawH = f.h * camera.scale;
    const drawnH = clampScreenHeight(rawH, d.role);
    if (drawnH <= 0) return;
    const k = drawnH / rawH;
    // Bounding circle of the capped frame: half its length plus its height, on screen.
    const reach = (f.w * camera.scale * k) / 2 + drawnH;
    if (sx + reach < 0 || sy + reach < 0 || sx - reach > viewport.width || sy - reach > viewport.height) return;
    const alpha = labelAlpha(d, camera.scale, params);
    if (d.frame.shape === 'straight') {
      const w = f.w * camera.scale * k;
      if (canSprite) {
        const sprite = getSprite(d.text, bucketFor(drawnH), d, dpr);
        if (sprite !== undefined && atlasCanvas !== undefined) {
          const m = straightMatrix({ cx: sx, cy: sy, angle: f.angle }, w, sprite.textW);
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
          ctx.scale(1, drawnH / sprite.bucket);
          ctx.drawImage(atlasCanvas, sprite.sx, sprite.sy, sprite.sw, sprite.sh, -sprite.cssW / 2, -sprite.cssH / 2, sprite.cssW, sprite.cssH);
          ctx.restore();
          return;
        }
      }
      ctx.font = fontString(drawnH);
      ctx.globalAlpha = alpha;
      const measured = ctx.measureText(d.text).width;
      if (!(measured > 0)) return;
      const m = straightMatrix({ cx: sx, cy: sy, angle: f.angle }, w, measured);
      ctx.save();
      ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
      paint(d, d.text, 0, 0);
      ctx.restore();
      return;
    }
    const glyphs = Array.from(d.text);
    const arcW = d.frame.w * k;
    const arcFrame = k === 1 ? d.frame : { ...d.frame, w: arcW };
    const places = arcGlyphs(arcFrame, glyphOffsets(advancesOf(d.text), arcW));
    if (canSprite) {
      const bucket = bucketFor(drawnH);
      const scale = drawnH / bucket;
      ctx.globalAlpha = alpha;
      glyphs.forEach((g, i) => {
        const p = places[i];
        if (p === undefined || g === ' ') return;
        const sprite = getSprite(g, bucket, d, dpr);
        if (sprite === undefined || atlasCanvas === undefined) return;
        const [gx, gy] = toScreen(camera, viewport, p.x, p.y);
        ctx.save();
        ctx.translate(gx, gy);
        ctx.rotate((-p.angle * Math.PI) / 180);
        ctx.drawImage(
          atlasCanvas,
          sprite.sx,
          sprite.sy,
          sprite.sw,
          sprite.sh,
          (-sprite.cssW * scale) / 2,
          (-sprite.cssH * scale) / 2,
          sprite.cssW * scale,
          sprite.cssH * scale,
        );
        ctx.restore();
      });
      return;
    }
    // advancesOf set the reference font; the glyphs are drawn at the clamped displayed size.
    ctx.font = fontString(drawnH);
    ctx.globalAlpha = alpha;
    glyphs.forEach((g, i) => {
      const p = places[i];
      if (p === undefined) return;
      const [gx, gy] = toScreen(camera, viewport, p.x, p.y);
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate((-p.angle * Math.PI) / 180);
      paint(d, g, 0, 0);
      ctx.restore();
    });
  };

  const drawLeader = (d: LabelDraw, view: MapView): void => {
    const l = d.leader;
    if (l === undefined) return;
    const { camera, viewport } = view;
    const [x1, y1] = toScreen(camera, viewport, l.x1, l.y1);
    const [x2, y2] = toScreen(camera, viewport, l.x2, l.y2);
    ctx.globalAlpha = labelAlpha(d, camera.scale, params);
    for (const [width, style] of [[LEADER_BLACK, LEADER_BLACK_RGB], [LEADER_WHITE, LEADER_WHITE_RGB]] as const) {
      ctx.lineWidth = width;
      ctx.strokeStyle = style;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  };

  // Marker ring: white 2 px over black 4 px (a 1 px black halo). Edge triangle: filled white with a 1 px black halo.
  const drawOverlay = (overlay: TourOverlay): void => {
    ctx.globalAlpha = 1;
    ctx.lineJoin = 'round';
    const marker = overlay.marker;
    if (marker !== undefined) {
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, marker.r, 0, 2 * Math.PI);
      ctx.lineWidth = TOUR_PARAMS.markerWidthPx + 2;
      ctx.strokeStyle = LEADER_BLACK_RGB;
      ctx.stroke();
      ctx.lineWidth = TOUR_PARAMS.markerWidthPx;
      ctx.strokeStyle = LEADER_WHITE_RGB;
      ctx.stroke();
    }
    const indicator = overlay.indicator;
    if (indicator !== undefined) {
      const size = TOUR_PARAMS.indicatorPx;
      const dx = Math.cos(indicator.angle);
      const dy = Math.sin(indicator.angle);
      // The tip is on the border (inset by the size) and points along the angle; the base lies behind it.
      const bx = indicator.x - dx * size;
      const by = indicator.y - dy * size;
      const nx = (-dy * size) / 2;
      const ny = (dx * size) / 2;
      ctx.beginPath();
      ctx.moveTo(indicator.x, indicator.y);
      ctx.lineTo(bx + nx, by + ny);
      ctx.lineTo(bx - nx, by - ny);
      ctx.closePath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = LEADER_BLACK_RGB;
      ctx.stroke();
      ctx.fillStyle = LEADER_WHITE_RGB;
      ctx.fill();
    }
  };

  return {
    resize(vp: Viewport, dpr: number): void {
      const size = deviceSize(vp, dpr);
      // Setting the size also resets the context state; every draw sets its own.
      canvas.width = size.width;
      canvas.height = size.height;
    },
    draw(labels: readonly AnyLabelDraw[], view: MapView, overlay?: TourOverlay): void {
      const { camera, viewport, dpr } = view;
      params = scaledFade(base, view.detail ?? 1);
      // The font may arrive after a first measurement (fallback glyphs): measure again then (FR-437).
      if (view.fonts !== measuredAt) {
        advances.clear();
        resetAtlas();
        measuredAt = view.fonts;
      }
      if (dpr !== spriteDpr) {
        resetAtlas();
        spriteDpr = dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, viewport.width, viewport.height);
      ctx.lineCap = 'butt';
      const shown = labels.filter((label) => drawable(label, camera.scale, params));
      // Pass 1: leader lines, under every text of either role (FR-207).
      for (const label of shown) if (isBox(label)) drawLeader(label, view);
      // Pass 2: texts in the order given.
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = HALO_WIDTH;
      for (const label of shown) {
        if (isBox(label)) drawBox(label, view);
        else drawShaped(label, view);
      }
      if (overlay !== undefined) drawOverlay(overlay);
    },
  };
}
