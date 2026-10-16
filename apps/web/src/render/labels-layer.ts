// The label layer (FR-172 to FR-175): map and territory names drawn with the Canvas 2D API on a canvas that
// lies over the map canvas, so every label is above every fill and border line (FR-173). Text is drawn again
// at its displayed size on every call, in device pixels, so no bitmap is ever enlarged (FR-175). It receives
// finished label data and the view, and nothing else (FR-188).
import type { Viewport } from '../core/camera';
import { drawable, labelAlpha, screenBox } from '../core/label-frame';
import type { LabelDraw } from '../core/label-frame';
import { LABEL_PARAMS, fontString } from '../core/label-params';
import { deviceSize } from './map-scene';
import type { MapView } from './map-scene';

export interface LabelLayer {
  /** Sizes the canvas for a drawing area in CSS pixels and a device pixel ratio. */
  resize(vp: Viewport, dpr: number): void;
  /** Clears the layer and draws the labels in the order given, skipping those that are not drawable. */
  draw(labels: readonly LabelDraw[], view: MapView): void;
}

/** Halo width in CSS pixels: the stroke is centred on the outline, so 2 gives 1 pixel outside the glyph. */
const HALO_WIDTH = 2;

const css = (c: readonly [number, number, number]): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/** Attaches the layer to its canvas. Throws when the browser gives no 2D context. */
export function attachLabelLayer(canvas: HTMLCanvasElement): LabelLayer {
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2D context for the label layer');
  const params = LABEL_PARAMS;
  return {
    resize(vp: Viewport, dpr: number): void {
      const size = deviceSize(vp, dpr);
      // Setting the size also resets the context state; every draw sets its own.
      canvas.width = size.width;
      canvas.height = size.height;
    },
    draw(labels: readonly LabelDraw[], view: MapView): void {
      const { camera, viewport, dpr } = view;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, viewport.width, viewport.height);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = HALO_WIDTH;
      for (const label of labels) {
        if (!drawable(label, camera.scale, params)) continue;
        const box = screenBox(label.box, camera, viewport);
        if (box.x + box.w < 0 || box.y + box.h < 0 || box.x > viewport.width || box.y > viewport.height) continue;
        // The font size is the box height; the horizontal factor makes the advance width the box width exactly.
        ctx.font = fontString(box.h);
        const measured = ctx.measureText(label.text).width;
        if (!(measured > 0)) continue;
        ctx.save();
        ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
        ctx.scale(box.w / measured, 1);
        ctx.globalAlpha = labelAlpha(label, camera.scale, params);
        ctx.strokeStyle = css(label.halo);
        ctx.strokeText(label.text, 0, 0);
        ctx.fillStyle = css(label.ink);
        ctx.fillText(label.text, 0, 0);
        ctx.restore();
      }
    },
  };
}
