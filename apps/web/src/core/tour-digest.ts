// Canonical text and digest of a tour frame (spec 009 NFR-59): the goldens and the debug panel compare frames
// through it. Pure. Floating values are written with fixed decimals (camera, marker and indicator with three,
// as plan 17 says, so a last-bit difference in the exponential easing cannot change the text).
import type { TourFrame } from './tour-frame';
import { fnv1a32 } from './tour-key';

/** A number with fixed decimals; a negative zero (and a value that rounds to it) is written as zero. */
function fixed(x: number, digits: number): string {
  const text = x.toFixed(digits);
  return /^-0(?:\.0+)?$/.test(text) ? text.slice(1) : text;
}

const triple = (a: number, b: number, c: number): string => `${fixed(a, 3)},${fixed(b, 3)},${fixed(c, 3)}`;

/** The frame data of FR-354 as one line of text; absent parts are written `-`. */
export function frameText(frame: TourFrame): string {
  const camera = frame.camera === undefined ? '-' : triple(frame.camera.x, frame.camera.y, frame.camera.scale);
  const marker = frame.marker === undefined ? '-' : triple(frame.marker.x, frame.marker.y, frame.marker.r);
  const indicator = frame.indicator === undefined ? '-' : triple(frame.indicator.x, frame.indicator.y, frame.indicator.angle);
  return [
    `lit=${frame.lit.length === 0 ? '-' : frame.lit.join(',')}`,
    `dim=${fixed(frame.dim, 6)}`,
    `other=${fixed(frame.factors.other, 6)}`,
    `camera=${camera}`,
    `marker=${marker}`,
    `indicator=${indicator}`,
    `result=${frame.resultShown ? 1 : 0}`,
    `ended=${frame.ended ? 1 : 0}`,
  ].join(';');
}

/** FNV-1a 32 bit of the frame text as eight lowercase hexadecimal digits. */
export function frameDigest(frame: TourFrame): string {
  return fnv1a32(frameText(frame)).toString(16).padStart(8, '0');
}
