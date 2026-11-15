// Label drawing data (FR-172, FR-174, FR-175, FR-181, FR-189; spec 006 FR-208, FR-210 to FR-213). Pure: drawn
// frames, scale and f in, draw data out; no text measuring and no drawing here. A label is drawn as a box
// (horizontal in-land or off-land, `LabelDraw`) or as a shaped frame (straight or arc, `ShapedDraw`).
import type { Rgb } from '@mbrg/shared';
import type { Camera, Viewport } from './camera';
import type { LabelBox } from './label-layout';
import type { LabelParams } from './label-params';
import type { LeaderLine } from './label-offland';
import type { ShapedFrame } from './label-shape';
import { smoothstep } from './lines';

/** Text colour of every label (FR-174): white, #FFFFFF. */
export const LABEL_INK: Rgb = [255, 255, 255];
/** Colour of the 1 pixel halo of every label (FR-174): black, #000000. */
export const LABEL_HALO: Rgb = [0, 0, 0];

export type LabelRole = 'faction' | 'territory';

/**
 * What the drawing layer needs for one box label (a horizontal in-land box or an off-land box). `factor` is the
 * opacity factor of FR-181 (1 outside a step). `leader` is present only for an off-land box with a leader line.
 */
export interface LabelDraw {
  text: string;
  role: LabelRole;
  box: LabelBox;
  factor: number;
  /** Text colour. */
  ink: Rgb;
  /** Colour of the 1 pixel halo. */
  halo: Rgb;
  leader?: LeaderLine;
}

/** What the drawing layer needs for one label drawn in a straight or arc frame (FR-212: it has no box). */
export interface ShapedDraw {
  text: string;
  role: LabelRole;
  frame: ShapedFrame;
  factor: number;
  ink: Rgb;
  halo: Rgb;
}

export type AnyLabelDraw = LabelDraw | ShapedDraw;

/**
 * How one label is drawn at one round. A horizontal in-land label has a box only; a shaped label a frame and no
 * box; an off-land label the off-land box with `offLand` and, beyond the gap Gl, a leader line. Optional fields are
 * left out, never set to undefined.
 */
interface DrawnFields {
  /** Absent when no frame fits (FR-170, FR-206) or the faction has no land. */
  box: LabelBox | undefined;
  frame?: ShapedFrame;
  offLand?: true;
  leader?: LeaderLine;
}

export interface FactionLabelInput extends DrawnFields {
  faction: number;
  text: string;
  /** Text aspect ratio, used to size an interpolated frame. */
  aspect: number;
}

export interface TerritoryLabelInput extends DrawnFields {
  entry: number;
  text: string;
}

/** The labels of one round. */
export interface RoundLabels {
  factions: readonly FactionLabelInput[];
  territories: readonly TerritoryLabelInput[];
}

/** The labels of the two rounds of a step and who is involved. */
export interface StepLabels {
  earlier: RoundLabels;
  later: RoundLabels;
  eliminated: number;
  absorber: number;
  /** Entries of the transferred territories. */
  transferred: ReadonlySet<number>;
}

type OpacityParams = Pick<LabelParams, 'fadeStart' | 'fadeFull'>;
type DrawParams = Pick<LabelParams, 'fadeStart' | 'fadeFull' | 'minPx'>;

/** Faction labels: 1 - smoothstep(L0, L1, s). Territory labels: smoothstep(L0, L1, s). */
export function labelOpacity(role: LabelRole, scale: number, params: OpacityParams): number {
  const t = smoothstep(params.fadeStart, params.fadeFull, scale);
  return role === 'territory' ? t : 1 - t;
}

/** Opacity of the scale times the opacity factor of the label. */
export function labelAlpha(label: Pick<AnyLabelDraw, 'role' | 'factor'>, scale: number, params: OpacityParams): number {
  return labelOpacity(label.role, scale, params) * label.factor;
}

/** The frame data the rendering part gets for every label (FR-212). Curvature is 1 / R with the sign of the bend. */
export interface FrameData {
  shape: 'horizontal' | 'straight' | 'arc';
  cx: number;
  cy: number;
  /** Reading angle in degrees. */
  angle: number;
  curvature: number;
  h: number;
  w: number;
}

/** Shape, centre, reading angle, curvature, height and length of any draw; a box label is horizontal. */
export function frameOf(draw: AnyLabelDraw): FrameData {
  if ('box' in draw) {
    const b = draw.box;
    return { shape: 'horizontal', cx: b.x0 + b.w / 2, cy: b.y0 + b.h / 2, angle: 0, curvature: 0, h: b.h, w: b.w };
  }
  const f = draw.frame;
  const curvature = f.shape === 'arc' ? (f.bend > 0 ? 1 : -1) / f.radius : 0;
  return { shape: f.shape, cx: f.cx, cy: f.cy, angle: f.angle, curvature, h: f.h, w: f.w };
}

/** The frame on screen (CSS pixels): the centre about the camera centre, h and w times the scale, curvature over it. */
export function screenFrame(f: FrameData, cam: Camera, vp: Viewport): FrameData {
  return {
    shape: f.shape,
    cx: (f.cx - cam.x) * cam.scale + vp.width / 2,
    cy: (f.cy - cam.y) * cam.scale + vp.height / 2,
    angle: f.angle,
    curvature: f.curvature / cam.scale,
    h: f.h * cam.scale,
    w: f.w * cam.scale,
  };
}

/** A label is drawn when its frame is at least P screen pixels high and its alpha is above 0 (FR-172, FR-208). */
export function drawable(label: AnyLabelDraw, scale: number, params: DrawParams): boolean {
  return frameOf(label).h * scale >= params.minPx && labelAlpha(label, scale, params) > 0;
}

/** The label box on screen (CSS pixels): the box times the scale about the camera centre. */
export function screenBox(box: LabelBox, cam: Camera, vp: Viewport): { x: number; y: number; w: number; h: number } {
  return {
    x: (box.x0 - cam.x) * cam.scale + vp.width / 2,
    y: (box.y0 - cam.y) * cam.scale + vp.height / 2,
    w: box.w * cam.scale,
    h: box.h * cam.scale,
  };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const byFaction = (a: FactionLabelInput, b: FactionLabelInput): number => a.faction - b.faction;
const byEntry = (a: TerritoryLabelInput, b: TerritoryLabelInput): number => a.entry - b.entry;

/** The draw of a label at an opacity factor: a shaped draw for a frame, a box label otherwise; none without either. */
function drawOf(l: DrawnFields & { text: string }, role: LabelRole, factor: number): AnyLabelDraw | undefined {
  if (l.frame !== undefined) return { text: l.text, role, frame: l.frame, factor, ink: LABEL_INK, halo: LABEL_HALO };
  if (l.box === undefined) return undefined;
  return { text: l.text, role, box: l.box, factor, ink: LABEL_INK, halo: LABEL_HALO, ...(l.leader !== undefined ? { leader: l.leader } : {}) };
}

function sameBox(a: LabelBox | undefined, b: LabelBox | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.x0 === b.x0 && a.y0 === b.y0 && a.h === b.h && a.w === b.w;
}

function sameFrame(a: ShapedFrame | undefined, b: ShapedFrame | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.shape !== b.shape || a.cx !== b.cx || a.cy !== b.cy || a.angle !== b.angle || a.h !== b.h || a.w !== b.w) return false;
  return a.shape === 'arc' && b.shape === 'arc' ? a.bend === b.bend && a.radius === b.radius : true;
}

function sameLeader(a: LeaderLine | undefined, b: LeaderLine | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
}

/** Deep comparison of two drawn frames: box, frame, off-land flag and leader line (FR-211). */
function sameDrawn(a: DrawnFields, b: DrawnFields): boolean {
  return sameBox(a.box, b.box) && sameFrame(a.frame, b.frame) && (a.offLand === true) === (b.offLand === true) && sameLeader(a.leader, b.leader);
}

const isDrawn = (l: DrawnFields | undefined): l is DrawnFields => l !== undefined && (l.frame !== undefined || l.box !== undefined);

/** The shape of a drawn in-land frame, or undefined for an off-land box or no frame. */
function inLandShape(l: DrawnFields | undefined): 'horizontal' | 'straight' | 'arc' | undefined {
  if (!isDrawn(l) || l.offLand === true) return undefined;
  return l.frame !== undefined ? l.frame.shape : 'horizontal';
}

/** Centre, height and angle of a horizontal or straight in-land frame (FR-210 b). */
function straightData(l: DrawnFields): { cx: number; cy: number; h: number; angle: number } {
  if (l.frame !== undefined) return { cx: l.frame.cx, cy: l.frame.cy, h: l.frame.h, angle: l.frame.angle };
  const b = l.box!;
  return { cx: b.x0 + b.w / 2, cy: b.y0 + b.h / 2, h: b.h, angle: 0 };
}

/** One straight frame between two frames: centre, height and angle interpolated (the angle without wrapping), w = h x aspect. */
function straightBetween(b: FactionLabelInput, a: FactionLabelInput, f: number): ShapedDraw {
  const sb = straightData(b);
  const sa = straightData(a);
  const h = lerp(sb.h, sa.h, f);
  const frame: ShapedFrame = { shape: 'straight', cx: lerp(sb.cx, sa.cx, f), cy: lerp(sb.cy, sa.cy, f), angle: lerp(sb.angle, sa.angle, f), h, w: h * a.aspect };
  return { text: a.text, role: 'faction', frame, factor: 1, ink: LABEL_INK, halo: LABEL_HALO };
}

/** The earlier draw at 1 - f and the later one at f, a factor of 0 left out (FR-210 c). */
function crossfade(
  out: AnyLabelDraw[],
  b: (DrawnFields & { text: string }) | undefined,
  a: (DrawnFields & { text: string }) | undefined,
  role: LabelRole,
  f: number,
): void {
  if (b !== undefined && 1 - f > 0) {
    const d = drawOf(b, role, 1 - f);
    if (d !== undefined) out.push(d);
  }
  if (a !== undefined && f > 0) {
    const d = drawOf(a, role, f);
    if (d !== undefined) out.push(d);
  }
}

/** The labels of one round outside a step: factions by index, then territories by entry; frameless labels left out. */
export function instantLabels(round: RoundLabels): AnyLabelDraw[] {
  const out: AnyLabelDraw[] = [];
  for (const l of [...round.factions].sort(byFaction)) {
    const d = drawOf(l, 'faction', 1);
    if (d !== undefined) out.push(d);
  }
  for (const l of [...round.territories].sort(byEntry)) {
    const d = drawOf(l, 'territory', 1);
    if (d !== undefined) out.push(d);
  }
  return out;
}

/**
 * The labels at forward progress f of a step (FR-181, FR-210, FR-211). Labels with an opacity factor of 0 are left
 * out, so f = 0 gives the instant labels of the earlier round and f = 1 those of the later round.
 */
export function labelsAt(input: StepLabels, forward: number): AnyLabelDraw[] {
  const f = forward;
  const out: AnyLabelDraw[] = [];

  const before = new Map(input.earlier.factions.map((l) => [l.faction, l]));
  const after = new Map(input.later.factions.map((l) => [l.faction, l]));
  const factions = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b);
  for (const id of factions) {
    const b = before.get(id);
    const a = after.get(id);
    if (id === input.eliminated) {
      if (b !== undefined && 1 - f > 0) {
        const d = drawOf(b, 'faction', 1 - f);
        if (d !== undefined) out.push(d);
      }
    } else if (id === input.absorber) {
      const shapeB = inLandShape(b);
      const shapeA = inLandShape(a);
      if (b !== undefined && a !== undefined && shapeB === 'horizontal' && shapeA === 'horizontal') {
        // (a) both horizontal in-land frames: the 005 interpolation.
        const boxB = b.box!;
        const boxA = a.box!;
        const h = lerp(boxB.h, boxA.h, f);
        out.push({ text: a.text, role: 'faction', box: { x0: lerp(boxB.x0, boxA.x0, f), y0: lerp(boxB.y0, boxA.y0, f), h, w: h * a.aspect }, factor: 1, ink: LABEL_INK, halo: LABEL_HALO });
      } else if (b !== undefined && a !== undefined && shapeB !== undefined && shapeA !== undefined && shapeB !== 'arc' && shapeA !== 'arc') {
        // (b) each horizontal or straight, not both horizontal: the endpoint itself, else one straight frame.
        const d = f === 0 ? drawOf(b, 'faction', 1) : f === 1 ? drawOf(a, 'faction', 1) : straightBetween(b, a, f);
        if (d !== undefined) out.push(d);
      } else {
        crossfade(out, b, a, 'faction', f);
      }
    } else if (b !== undefined && a !== undefined && isDrawn(b) && isDrawn(a) && sameDrawn(b, a)) {
      // Unchanged at both rounds: drawn once; the later round is taken from f = 0.5 on.
      const d = drawOf(f < 0.5 ? b : a, 'faction', 1);
      if (d !== undefined) out.push(d);
    } else {
      crossfade(out, b, a, 'faction', f);
    }
  }

  const tBefore = new Map(input.earlier.territories.map((l) => [l.entry, l]));
  const tAfter = new Map(input.later.territories.map((l) => [l.entry, l]));
  const entries = [...new Set([...tBefore.keys(), ...tAfter.keys()])].sort((a, b) => a - b);
  for (const entry of entries) {
    // Neither the frame nor the ink changes during a step (FR-171, FR-174, FR-209); only the text source switches at f = 0.5.
    const l = f < 0.5 ? tBefore.get(entry) : tAfter.get(entry);
    if (l !== undefined) {
      const d = drawOf(l, 'territory', 1);
      if (d !== undefined) out.push(d);
    }
  }
  return out;
}
