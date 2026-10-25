// Camera of the reveal tours (spec 009, plan 4.4): framing boxes, framing, easing and the camera at time t.
// Pure: the camera at t is a function of the drawing area, the image, the start camera and the tour only,
// so a resize continues at the same t with no stored state (FR-335).
import { clampCamera, fitScale, initialCamera } from './camera';
import type { Camera, ImageSize, Viewport } from './camera';
import type { FactionBoxes } from './label-layout';
import { LABEL_PARAMS } from './label-params';
import { smoothstep } from './lines';
import type { PieceIndex } from './regions';
import type { Tour } from './tour';
import { TOUR_PARAMS } from './tour-params';

/** A half-open rectangle of map units: [x0, x1) x [y0, y1). */
export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The union of boxes, or undefined when there are none. */
export function unionBox(boxes: Iterable<Box>): Box | undefined {
  let out: Box | undefined;
  for (const b of boxes) {
    out = out === undefined ? b : { x0: Math.min(out.x0, b.x0), y0: Math.min(out.y0, b.y0), x1: Math.max(out.x1, b.x1), y1: Math.max(out.y1, b.y1) };
  }
  return out;
}

/** The box of pieces: their inclusive boxes made half-open. */
function piecesBox(index: PieceIndex, pieces: Iterable<number>): Box | undefined {
  const boxes: Box[] = [];
  for (const p of pieces) {
    boxes.push({ x0: index.box[4 * p]!, y0: index.box[4 * p + 1]!, x1: index.box[4 * p + 2]! + 1, y1: index.box[4 * p + 3]! + 1 });
  }
  return unionBox(boxes);
}

/**
 * Framing box of a set of factions (P6): per faction, the union of the pieces of its label set (its main
 * region); a faction without a label entry falls back to the box of all its land. `owners` is the owner
 * table (faction index per entry). Factions with no land add nothing; no land at all gives undefined.
 */
export function framingBoxOf(boxes: FactionBoxes, owners: ArrayLike<number>, factions: readonly number[]): Box | undefined {
  const parts: Box[] = [];
  for (const faction of factions) {
    const label = boxes.labels.get(faction);
    let part: Box | undefined;
    if (label !== undefined) {
      part = piecesBox(boxes.index, label.pieces);
    } else {
      const own: number[] = [];
      for (let p = 0; p < boxes.index.entryOf.length; p++) if (owners[boxes.index.entryOf[p]!] === faction) own.push(p);
      part = piecesBox(boxes.index, own);
    }
    if (part !== undefined) parts.push(part);
  }
  return unionBox(parts);
}

/** The overview camera: the whole image at the fit scale, centred (004 FR-144). */
export function overview(image: ImageSize, area: Viewport): Camera {
  return initialCamera(image, area);
}

/**
 * Framing of a box: centred on it, scale = the smaller of half the area width over the box width and half
 * the area height over the box height, limited from the fit scale to the larger of the fit scale and
 * min(4 fit, L0), then clamped by the camera rules.
 */
export function framing(box: Box, image: ImageSize, area: Viewport): Camera {
  const fit = fitScale(image, area);
  const share = TOUR_PARAMS.framingShare;
  const wanted = Math.min((share * area.width) / (box.x1 - box.x0), (share * area.height) / (box.y1 - box.y0));
  const upper = Math.max(fit, Math.min(TOUR_PARAMS.framingMaxFit * fit, LABEL_PARAMS.fadeStart));
  const scale = Math.min(Math.max(wanted, fit), upper);
  return clampCamera({ x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, scale }, image, area);
}

/**
 * Camera `s` ms into an easing of `duration` ms from a to b: the centre moves linearly, the scale
 * geometrically (linear in its logarithm), progress smoothstep(0, duration, s). Exactly a before the start
 * and exactly b from the end.
 */
export function ease(a: Camera, b: Camera, duration: number, s: number): Camera {
  if (s <= 0) return a;
  if (s >= duration) return b;
  const p = smoothstep(0, duration, s);
  return {
    x: a.x + (b.x - a.x) * p,
    y: a.y + (b.y - a.y) * p,
    scale: a.scale === b.scale ? a.scale : Math.exp(Math.log(a.scale) + (Math.log(b.scale) - Math.log(a.scale)) * p),
  };
}

/**
 * The tour camera at elapsed time t. Each leg eases from the camera the earlier legs give at the leg's own
 * start (the first from the start camera clamped to the current area) to its target for the current area;
 * a leg whose factions have no land is skipped. After the last leg the camera stays (FR-334).
 */
export function cameraAt(tour: Tour, t: number, area: Viewport, image: ImageSize, start: Camera): Camera {
  const upTo = (k: number, at: number): Camera => {
    if (k < 0) return clampCamera(start, image, area);
    const leg = tour.legs[k]!;
    if (at < leg.from) return upTo(k - 1, at);
    let target: Camera | undefined;
    if (leg.to === 'overview') {
      target = overview(image, area);
    } else {
      const box = unionBox(leg.to.flatMap((f) => (tour.boxes.has(f) ? [tour.boxes.get(f)!] : [])));
      if (box !== undefined) target = framing(box, image, area);
    }
    if (target === undefined) return upTo(k - 1, at);
    return ease(upTo(k - 1, leg.from), target, leg.duration, at - leg.from);
  };
  return upTo(tour.legs.length - 1, t);
}
