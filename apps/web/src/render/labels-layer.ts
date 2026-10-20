// The label layer (FR-172 to FR-175; spec 006 FR-200 to FR-202, FR-207): map and territory names drawn with the
// Canvas 2D API on a canvas that lies over the map canvas, so every label is above every fill and border line
// (FR-173). Text is drawn again at its displayed size on every call, in device pixels, so no bitmap is ever
// enlarged (FR-175). It receives finished label data and the view, and nothing else (FR-188, FR-212).
// Pass 1 draws the leader lines of the drawable labels; pass 2 draws the texts in the order given: a box label
// as 005 did, a straight label along its reading direction, an arc label glyph by glyph.
import type { Camera, Viewport } from '../core/camera';
import { GLYPH_REFERENCE_PX, arcGlyphs, glyphOffsets, straightMatrix } from '../core/glyph-layout';
import { drawable, frameOf, labelAlpha, screenBox } from '../core/label-frame';
import type { AnyLabelDraw, LabelDraw, ShapedDraw } from '../core/label-frame';
import { LABEL_PARAMS, fontString } from '../core/label-params';
import { deviceSize } from './map-scene';
import type { MapView } from './map-scene';

export interface LabelLayer {
  /** Sizes the canvas for a drawing area in CSS pixels and a device pixel ratio. */
  resize(vp: Viewport, dpr: number): void;
  /** Clears the layer and draws the labels in the order given, skipping those that are not drawable. */
  draw(labels: readonly AnyLabelDraw[], view: MapView): void;
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

/** Attaches the layer to its canvas. Throws when the browser gives no 2D context. */
export function attachLabelLayer(canvas: HTMLCanvasElement): LabelLayer {
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2D context for the label layer');
  const params = LABEL_PARAMS;
  /** Glyph advances of each arc text at the reference size, measured once per text. */
  const advances = new Map<string, readonly number[]>();
  const advancesOf = (text: string): readonly number[] => {
    let a = advances.get(text);
    if (a === undefined) {
      ctx.font = fontString(GLYPH_REFERENCE_PX);
      a = Array.from(text).map((g) => ctx.measureText(g).width);
      advances.set(text, a);
    }
    return a;
  };

  const paint = (d: AnyLabelDraw, text: string, x: number, y: number): void => {
    ctx.strokeStyle = css(d.halo);
    ctx.strokeText(text, x, y);
    ctx.fillStyle = css(d.ink);
    ctx.fillText(text, x, y);
  };

  const drawBox = (d: LabelDraw, view: MapView): void => {
    const { camera, viewport } = view;
    const box = screenBox(d.box, camera, viewport);
    if (box.x + box.w < 0 || box.y + box.h < 0 || box.x > viewport.width || box.y > viewport.height) return;
    // The font size is the box height; the horizontal factor makes the advance width the box width exactly.
    ctx.font = fontString(box.h);
    const measured = ctx.measureText(d.text).width;
    if (!(measured > 0)) return;
    ctx.save();
    ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
    ctx.scale(box.w / measured, 1);
    ctx.globalAlpha = labelAlpha(d, camera.scale, params);
    paint(d, d.text, 0, 0);
    ctx.restore();
  };

  const drawShaped = (d: ShapedDraw, view: MapView): void => {
    const { camera, viewport } = view;
    const f = frameOf(d);
    const [sx, sy] = toScreen(camera, viewport, f.cx, f.cy);
    // Bounding circle of the frame: half its length plus its height, on screen.
    const reach = (f.w / 2 + f.h) * camera.scale;
    if (sx + reach < 0 || sy + reach < 0 || sx - reach > viewport.width || sy - reach > viewport.height) return;
    const h = f.h * camera.scale;
    ctx.font = fontString(h);
    ctx.globalAlpha = labelAlpha(d, camera.scale, params);
    if (d.frame.shape === 'straight') {
      const w = f.w * camera.scale;
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
    const places = arcGlyphs(d.frame, glyphOffsets(advancesOf(d.text), d.frame.w));
    // advancesOf set the reference font; the glyphs are drawn at the displayed size.
    ctx.font = fontString(h);
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

  return {
    resize(vp: Viewport, dpr: number): void {
      const size = deviceSize(vp, dpr);
      // Setting the size also resets the context state; every draw sets its own.
      canvas.width = size.width;
      canvas.height = size.height;
    },
    draw(labels: readonly AnyLabelDraw[], view: MapView): void {
      const { camera, viewport, dpr } = view;
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
    },
  };
}
