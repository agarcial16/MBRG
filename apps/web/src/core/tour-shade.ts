// The dim of a reveal tour (spec 009 FR-326, FR-355; plan 4.6) and its CPU reference renderer. `shadeTour` is the
// normative rule for the shader port: the colour of `shade` first, then, only while the dim is above 0, every
// channel of a pixel whose own map unit is not lit goes to floor(c (1 - dim) + 0.5).
// Pure: grid, owners, lit faction indices, dim and camera in, one colour out.
import type { Rgb } from '@mbrg/shared';
import { cellAt, shade } from './borders';
import type { IndexGrid, Shaded } from './borders';
import type { Camera, Viewport } from './camera';
import type { FillClass, Theme } from './theme';

/** A map unit is lit when it is land owned by a lit faction (faction index; 0 is no owner and never lit). */
export function unitLit(kind: FillClass, owner: number, lit: readonly number[]): boolean {
  return kind === 'land' && owner !== 0 && lit.includes(owner);
}

/** One 8-bit channel of an unlit pixel: floor(c (1 - dim) + 0.5). */
export function dimByte(c: number, dim: number): number {
  return Math.floor(c * (1 - dim) + 0.5);
}

/**
 * Colour of the screen position (fx, fy) in CSS pixels with a tour dim. The pixel's own map unit decides: a
 * border line drawn on a pixel follows the unit the pixel is in, never its neighbour. At dim 0 this is `shade`.
 */
export function shadeTour(
  grid: IndexGrid,
  owners: ArrayLike<number>,
  factionColors: readonly Rgb[],
  theme: Theme,
  lit: readonly number[],
  dim: number,
  cam: Camera,
  vp: Viewport,
  fx: number,
  fy: number,
): Shaded {
  if (!(dim >= 0 && dim <= 1)) throw new RangeError(`dim ${dim} is not in 0..1`);
  const base = shade(grid, owners, factionColors, theme, cam, vp, fx, fy);
  if (!(dim > 0)) return base;
  const px = cam.x + (fx - vp.width / 2) / cam.scale;
  const py = cam.y + (fy - vp.height / 2) / cam.scale;
  const a = cellAt(grid, Math.floor(px), Math.floor(py));
  if (unitLit(grid.fills[a]!, owners[a]!, lit)) return base;
  const c = base.color;
  return { ...base, color: [dimByte(c[0], dim), dimByte(c[1], dim), dimByte(c[2], dim)] };
}

/** RGBA bytes of the whole drawing surface with a tour dim, laid out as `renderReference`. */
export function renderTourReference(
  grid: IndexGrid,
  owners: ArrayLike<number>,
  factionColors: readonly Rgb[],
  theme: Theme,
  lit: readonly number[],
  dim: number,
  cam: Camera,
  vp: Viewport,
  dpr: number,
): Uint8Array {
  const width = Math.round(vp.width * dpr);
  const height = Math.round(vp.height * dpr);
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { color } = shadeTour(grid, owners, factionColors, theme, lit, dim, cam, vp, (x + 0.5) / dpr, (y + 0.5) / dpr);
      const i = (y * width + x) * 4;
      out[i] = color[0];
      out[i + 1] = color[1];
      out[i + 2] = color[2];
      out[i + 3] = 255;
    }
  }
  return out;
}
