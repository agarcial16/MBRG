// Layout digest (NFR-39; plan D11). Pure: a 64-bit FNV-1a hash over the IEEE-754 bits of numbers, so a layout
// can be compared bit for bit between Node and a browser. Hand-written, no dependency (NFR-42).
import type { CentredFactionLayout, CentredTerritoryLayout } from './label-centred-place';
import type { LabelBox } from './label-layout';
import type { FactionLayout, Placed, TerritoryLayout } from './label-place';
import type { InLandFrame } from './label-shape';

const OFFSET =0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;

/**
 * FNV-1a (64 bit) over the float64 bits of the numbers, each as 8 big-endian bytes, in iteration order.
 * Returns 16 lower-case hexadecimal digits. -0 and 0 differ, as their bits do.
 */
export function digestNumbers(values: Iterable<number>): string {
  const view = new DataView(new ArrayBuffer(8));
  let hash = OFFSET;
  for (const value of values) {
    view.setFloat64(0, value, false);
    for (let i = 0; i < 8; i++) {
      hash = BigInt.asUintN(64, (hash ^ BigInt(view.getUint8(i))) * PRIME);
    }
  }
  return hash.toString(16).padStart(16, '0');
}

type Frame = InLandFrame | Placed | undefined;

/** The numbers of one frame: a tag, then every field in declaration order (undefined is a lone -1). */
function frameNumbers(frame: Frame, out: number[]): void {
  if (frame === undefined) {
    out.push(-1);
  } else if (frame.shape === 'horizontal') {
    out.push(1, frame.box.x0, frame.box.y0, frame.box.h, frame.box.w);
  } else if (frame.shape === 'straight') {
    out.push(2, frame.cx, frame.cy, frame.angle, frame.h, frame.w);
  } else if (frame.shape === 'arc') {
    out.push(3, frame.cx, frame.cy, frame.angle, frame.h, frame.w, frame.bend, frame.radius);
  } else {
    out.push(4, frame.box.x0, frame.box.y0, frame.box.h, frame.box.w, frame.gap2, frame.anchor);
    if (frame.leader === undefined) out.push(0);
    else out.push(1, frame.leader.x1, frame.leader.y1, frame.leader.x2, frame.leader.y2);
  }
}

const boxNumbers = (box: LabelBox | undefined, out: number[]): void => {
  if (box === undefined) out.push(-1);
  else out.push(box.x0, box.y0, box.h, box.w);
};

/**
 * The digest of a placement (plan D11): the territory layout (every eligible entry: candidate box, in-land frame,
 * placed frame) and then, per state in the given order, the factions with the same three items.
 */
export function layoutDigest(territories: TerritoryLayout, factions: readonly FactionLayout[]): string {
  const numbers: number[] = [];
  for (let entry = 0; entry < territories.eligible.length; entry++) {
    if (territories.eligible[entry] !== 1) continue;
    numbers.push(entry);
    boxNumbers(territories.boxes[entry], numbers);
    frameNumbers(territories.inLand[entry], numbers);
    frameNumbers(territories.placed[entry], numbers);
  }
  numbers.push(-2, factions.length);
  for (const state of factions) {
    numbers.push(-3, state.boxes.labels.size);
    for (const [faction, label] of state.boxes.labels) {
      numbers.push(faction);
      boxNumbers(label.box, numbers);
      frameNumbers(state.inLand.get(faction), numbers);
      frameNumbers(state.placed.get(faction), numbers);
    }
  }
  return digestNumbers(numbers);
}

/**
 * The digest of a 007 placement (spec 007 NFR-44): the same items as `layoutDigest` (the `boxes` are the 007 horizontal
 * frames) plus the widening step of every in-land frame. A separate export: `layoutDigest` and its pin are unchanged.
 */
export function centredLayoutDigest(territories: CentredTerritoryLayout, factions: readonly CentredFactionLayout[]): string {
  const numbers: number[] = [];
  for (let entry = 0; entry < territories.eligible.length; entry++) {
    if (territories.eligible[entry] !== 1) continue;
    numbers.push(entry, territories.steps[entry] ?? -1);
    boxNumbers(territories.boxes[entry], numbers);
    frameNumbers(territories.inLand[entry], numbers);
    frameNumbers(territories.placed[entry], numbers);
  }
  numbers.push(-2, factions.length);
  for (const state of factions) {
    numbers.push(-3, state.boxes.labels.size);
    for (const [faction, label] of state.boxes.labels) {
      numbers.push(faction, state.steps.get(faction) ?? -1);
      boxNumbers(label.box, numbers);
      frameNumbers(state.inLand.get(faction), numbers);
      frameNumbers(state.placed.get(faction), numbers);
    }
  }
  return digestNumbers(numbers);
}
