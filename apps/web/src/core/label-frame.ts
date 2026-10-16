// Label drawing data (FR-172, FR-174, FR-175, FR-181, FR-189). Pure: boxes, scale and f in, draw
// data out; no text measuring and no drawing here.
import type { Rgb } from '@mbrg/shared';
import type { Camera, Viewport } from './camera';
import type { LabelBox } from './label-layout';
import type { LabelParams } from './label-params';
import { smoothstep } from './lines';

/** Text colour of every label (FR-174): white, #FFFFFF. */
export const LABEL_INK: Rgb = [255, 255, 255];
/** Colour of the 1 pixel halo of every label (FR-174): black, #000000. */
export const LABEL_HALO: Rgb = [0, 0, 0];

export type LabelRole = 'faction' | 'territory';

/** What the drawing layer needs for one label. `factor` is the opacity factor of FR-181 (1 outside a step). */
export interface LabelDraw {
  text: string;
  role: LabelRole;
  box: LabelBox;
  factor: number;
  /** Text colour. */
  ink: Rgb;
  /** Colour of the 1 pixel halo. */
  halo: Rgb;
}

export interface FactionLabelInput {
  faction: number;
  text: string;
  /** Absent when no box fits (FR-170) or the faction has no land. */
  box: LabelBox | undefined;
  /** Text aspect ratio, used to size an interpolated box. */
  aspect: number;
}

export interface TerritoryLabelInput {
  entry: number;
  text: string;
  box: LabelBox | undefined;
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
export function labelAlpha(label: LabelDraw, scale: number, params: OpacityParams): number {
  return labelOpacity(label.role, scale, params) * label.factor;
}

/** A label is drawn when its box is at least P screen pixels high and its alpha is above 0. */
export function drawable(label: LabelDraw, scale: number, params: DrawParams): boolean {
  return label.box.h * scale >= params.minPx && labelAlpha(label, scale, params) > 0;
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

function factionDraw(l: FactionLabelInput, box: LabelBox, factor: number): LabelDraw {
  return { text: l.text, role: 'faction', box, factor, ink: LABEL_INK, halo: LABEL_HALO };
}

function territoryDraw(l: TerritoryLabelInput, box: LabelBox): LabelDraw {
  return { text: l.text, role: 'territory', box, factor: 1, ink: LABEL_INK, halo: LABEL_HALO };
}

/** The labels of one round outside a step: factions by index, then territories by entry; boxless labels left out. */
export function instantLabels(round: RoundLabels): LabelDraw[] {
  const out: LabelDraw[] = [];
  for (const l of [...round.factions].sort(byFaction)) if (l.box !== undefined) out.push(factionDraw(l, l.box, 1));
  for (const l of [...round.territories].sort(byEntry)) if (l.box !== undefined) out.push(territoryDraw(l, l.box));
  return out;
}

/**
 * The labels at forward progress f of a step (FR-181). Labels with an opacity factor of 0 are left out, so
 * f = 0 gives the instant labels of the earlier round and f = 1 those of the later round.
 */
export function labelsAt(input: StepLabels, forward: number): LabelDraw[] {
  const f = forward;
  const out: LabelDraw[] = [];

  const before = new Map(input.earlier.factions.map((l) => [l.faction, l]));
  const after = new Map(input.later.factions.map((l) => [l.faction, l]));
  const factions = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b);
  for (const id of factions) {
    const b = before.get(id);
    const a = after.get(id);
    if (id === input.eliminated) {
      if (b?.box !== undefined && 1 - f > 0) out.push(factionDraw(b, b.box, 1 - f));
    } else if (id === input.absorber) {
      const boxB = b?.box;
      const boxA = a?.box;
      if (b !== undefined && a !== undefined && boxB !== undefined && boxA !== undefined) {
        const h = lerp(boxB.h, boxA.h, f);
        out.push(factionDraw(a, { x0: lerp(boxB.x0, boxA.x0, f), y0: lerp(boxB.y0, boxA.y0, f), h, w: h * a.aspect }, 1));
      } else if (a !== undefined && boxA !== undefined) {
        if (f > 0) out.push(factionDraw(a, boxA, f));
      } else if (b !== undefined && boxB !== undefined) {
        if (1 - f > 0) out.push(factionDraw(b, boxB, 1 - f));
      }
    } else {
      // Other factions are drawn as at both rounds; the later round is taken from f = 0.5 on.
      const l = f < 0.5 ? b : a;
      if (l?.box !== undefined) out.push(factionDraw(l, l.box, 1));
    }
  }

  const tBefore = new Map(input.earlier.territories.map((l) => [l.entry, l]));
  const tAfter = new Map(input.later.territories.map((l) => [l.entry, l]));
  const entries = [...new Set([...tBefore.keys(), ...tAfter.keys()])].sort((a, b) => a - b);
  for (const entry of entries) {
    // Neither the box nor the ink changes during a step (FR-171, FR-174); only the text source switches at f = 0.5.
    const l = f < 0.5 ? tBefore.get(entry) : tAfter.get(entry);
    if (l?.box !== undefined) out.push(territoryDraw(l, l.box));
  }
  return out;
}
