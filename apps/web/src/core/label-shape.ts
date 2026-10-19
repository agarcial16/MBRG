// Shaped label frames: membership of unit centres in the grown footprints (spec 006 FR-199, NFR-39; plan section 5).
// Pure. Every formula is the spec "Number reference" in the written order, in IEEE-754 doubles, with only
// + - * / Math.sqrt Math.abs Math.min Math.max Math.floor Math.ceil Math.PI. Squares are products x * x.
import type { LabelBox } from './label-layout';
import { cs } from './shape-params';

/** A straight frame: a rectangle of length w along the reading direction `angle` (degrees) and height h across it. */
export interface StraightFrame {
  shape: 'straight';
  cx: number;
  cy: number;
  angle: number;
  h: number;
  w: number;
}

/**
 * An arc frame: the middle line is a circular arc of length w and radius R whose midpoint is (cx, cy) and whose
 * tangent there has the screen angle `angle`; `bend` is the signed turn over the axis extent L, R = L / |bend|.
 */
export interface ArcFrame {
  shape: 'arc';
  cx: number;
  cy: number;
  angle: number;
  h: number;
  w: number;
  bend: number;
  radius: number;
}

export type ShapedFrame = StraightFrame | ArcFrame;

/** The in-land frame of a label: the 005 box (horizontal) or a shaped frame (FR-198). */
export type InLandFrame = { shape: 'horizontal'; box: LabelBox } | ShapedFrame;

/**
 * Spec: "dx = px - cx, dy = py - cy; u = (dx * C) - (dy * S); v = (dx * S) + (dy * C); inside the grown rectangle
 * iff Math.abs(u) <= ((h * a) / 2) + M and Math.abs(v) <= (h / 2) + M". `f.w` is h * a.
 */
export function inStraight(f: StraightFrame, margin: number, px: number, py: number): boolean {
  const { c, s } = cs(f.angle);
  const dx = px - f.cx;
  const dy = py - f.cy;
  const u = dx * c - dy * s;
  const v = dx * s + dy * c;
  return Math.abs(u) <= f.w / 2 + margin && Math.abs(v) <= f.h / 2 + margin;
}

/** Spec: "R = L / b" with "b = (|bend| * Math.PI) / 180". */
export function arcRadius(extent: number, bend: number): number {
  const b = (Math.abs(bend) * Math.PI) / 180;
  return extent / b;
}

/**
 * Spec: an arc frame exists iff "R - (h / 2) - M > 0" and, with "alpha = ((h * a) * |bend|) / (2 * L)" (degrees),
 * "theta - alpha > -90" and "theta + alpha <= 90". No arc frame exists when L = 0.
 */
export function arcExists(f: ArcFrame, extent: number, margin: number): boolean {
  if (!(extent > 0)) return false;
  if (!(f.radius - f.h / 2 - margin > 0)) return false;
  const alpha = (f.w * Math.abs(f.bend)) / (2 * extent);
  return f.angle - alpha > -90 && f.angle + alpha <= 90;
}

/**
 * The cosine polynomial K(phi) = 1 - (z / 2) * (1 - (z / 12) * (1 - (z / 30) * (... * (1 - z / 552)))), z = phi * phi,
 * the denominators (2k - 1)(2k) for k = 1 to 12, evaluated from the innermost bracket outwards.
 */
export function cosK(phi: number): number {
  const z = phi * phi;
  let t = 1 - z / 552;
  for (let k = 11; k >= 1; k--) t = 1 - (z / ((2 * k - 1) * (2 * k))) * t;
  return t;
}

/**
 * Spec: circle centre "Ox = cx - sigma * (R * S), Oy = cy - sigma * (R * C)"; with "vx = px - Ox, vy = py - Oy,
 * r2 = (vx * vx) + (vy * vy)": radial "(R - (h / 2) - M)^2 <= r2 <= (R + (h / 2) + M)^2", angular
 * "sigma * ((vx * S) + (vy * C)) >= K(phi) * sqrt(r2)" with "phi = ((h * a) + (2 * M)) / (2 * R)".
 */
export function inArc(f: ArcFrame, margin: number, px: number, py: number): boolean {
  const { c, s } = cs(f.angle);
  const sigma = f.bend > 0 ? 1 : -1;
  const r = f.radius;
  const ox = f.cx - sigma * (r * s);
  const oy = f.cy - sigma * (r * c);
  const vx = px - ox;
  const vy = py - oy;
  const r2 = vx * vx + vy * vy;
  const inner = r - f.h / 2 - margin;
  const outer = r + f.h / 2 + margin;
  if (!(inner * inner <= r2 && r2 <= outer * outer)) return false;
  const phi = (f.w + 2 * margin) / (2 * r);
  return sigma * (vx * s + vy * c) >= cosK(phi) * Math.sqrt(r2);
}
