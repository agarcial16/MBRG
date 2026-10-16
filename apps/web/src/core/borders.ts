// Border and fill rules (FR-136 to FR-140) and their CPU reference renderer (plan sections 6 and 8).
// `shade`/`renderReference` are the normative rule: the GLSL of T6 is a line-by-line port of them.
// Pure: decisions use entry indexes, entry kinds and owner indexes only, never a colour (FR-137).
import type { Rgb } from '@mbrg/shared';
import type { Camera, Viewport } from './camera';
import { territoryLineColor, territoryOpacity } from './lines';
import type { BorderClass, FillClass, Theme } from './theme';

/**
 * Dense entry index grid: `cells` holds, row-major, the entry index of every map unit
 * (0 = outside the map) and `fills[i]` the fill class of entry index i (`fills[0]` is `outside`).
 */
export interface IndexGrid {
  width: number;
  height: number;
  cells: ArrayLike<number>;
  fills: readonly FillClass[];
}

/** Winner order when several classes meet on one screen pixel: first wins. */
export const BORDER_PRIORITY: readonly BorderClass[] = ['faction', 'outer', 'coast', 'shore', 'sea-zone', 'territory'];

/**
 * Line widths in screen pixels, widest first; a class is tested at its own width only.
 * Single source for `shade` and for the GLSL port (amendment 2026-10-15).
 */
export const WIDTH_LEVELS = [4, 2, 1] as const;

/**
 * Tie-break, in screen pixels. A 1-pixel line on an edge that falls exactly on a pixel boundary has
 * its band limits exactly on pixel centres, where float rounding would decide between 0, 1 and 2
 * pixels. Looking forward (+x, +y) reaches b further and looking backward (-x, -y) b less, so the
 * band is [edge - w/2 - b, edge + w/2 - b): still w wide, and a pixel centre never sits on a limit.
 */
export const EDGE_BIAS = 1 / 256;

/** Entry index at a whole map position; outside the image is `outside` (0). */
export function cellAt(grid: IndexGrid, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return 0;
  return grid.cells[y * grid.width + x]!;
}

/**
 * Border class of the edge between entry indexes a and b, or null when there is none
 * (equal values, or outside next to outside). Land owners are compared by owner index.
 */
export function borderClass(
  a: number,
  b: number,
  fills: readonly FillClass[],
  owners: ArrayLike<number>,
): BorderClass | null {
  if (a === b) return null;
  const fa = fills[a]!;
  const fb = fills[b]!;
  if (fa === 'outside' && fb === 'outside') return null;
  if (fa === 'land' && fb === 'land') return owners[a] !== owners[b] ? 'faction' : 'territory';
  if (fa === 'outside') return fb === 'land' ? 'outer' : 'shore';
  if (fb === 'outside') return fa === 'land' ? 'outer' : 'shore';
  if (fa === 'sea' && fb === 'sea') return 'sea-zone';
  return 'coast';
}

export interface Shaded {
  fill: FillClass;
  border: BorderClass | null;
  color: Rgb;
}

/**
 * Colour of the screen position (fx, fy) in CSS pixels, measured from the top-left of the drawing area.
 * p = camera + (f - viewport / 2) / scale is the map point; a line of width w is the band of
 * w / 2 screen pixels on each side of the edge, found by looking w / 2 screen pixels away along
 * each axis (corner contacts are never looked at, so they draw no line of their own).
 */
export function shade(
  grid: IndexGrid,
  owners: ArrayLike<number>,
  factionColors: readonly Rgb[],
  theme: Theme,
  cam: Camera,
  vp: Viewport,
  fx: number,
  fy: number,
): Shaded {
  const px = cam.x + (fx - vp.width / 2) / cam.scale;
  const py = cam.y + (fy - vp.height / 2) / cam.scale;
  const ax = Math.floor(px);
  const ay = Math.floor(py);
  const a = cellAt(grid, ax, ay);
  const fill = grid.fills[a]!;

  let fillColor: Rgb;
  if (fill === 'land') {
    const color = factionColors[owners[a]!];
    if (color === undefined) throw new RangeError(`land entry ${a} has no owner colour`);
    fillColor = color;
  } else {
    fillColor = fill === 'sea' ? theme.sea : theme.background;
  }

  const found = new Set<BorderClass>();
  for (const w of WIDTH_LEVELS) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const o = (w / 2 + (dx + dy) * EDGE_BIAS) / cam.scale;
      const b = cellAt(grid, Math.floor(px + dx * o), Math.floor(py + dy * o));
      const c = borderClass(a, b, grid.fills, owners);
      if (c !== null && theme.width[c] === w) found.add(c);
    }
  }
  const border = BORDER_PRIORITY.find((c) => found.has(c)) ?? null;

  if (border === null) return { fill, border, color: fillColor };
  if (border === 'territory') {
    const line = territoryLineColor(fillColor, theme.territoryLine.darken);
    const alpha = territoryOpacity(cam.scale, theme.territoryLine);
    const color: Rgb = [
      Math.round(fillColor[0] * (1 - alpha) + line[0] * alpha),
      Math.round(fillColor[1] * (1 - alpha) + line[1] * alpha),
      Math.round(fillColor[2] * (1 - alpha) + line[2] * alpha),
    ];
    return { fill, border, color };
  }
  return { fill, border, color: theme.border[border] };
}

/**
 * RGBA bytes of the whole drawing surface at a device pixel ratio: the surface has
 * round(width x dpr) x round(height x dpr) device pixels, each sampled at its centre.
 */
export function renderReference(
  grid: IndexGrid,
  owners: ArrayLike<number>,
  factionColors: readonly Rgb[],
  theme: Theme,
  cam: Camera,
  vp: Viewport,
  dpr: number,
): Uint8Array {
  const width = Math.round(vp.width * dpr);
  const height = Math.round(vp.height * dpr);
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { color } = shade(grid, owners, factionColors, theme, cam, vp, (x + 0.5) / dpr, (y + 0.5) / dpr);
      const i = (y * width + x) * 4;
      out[i] = color[0];
      out[i + 1] = color[1];
      out[i + 2] = color[2];
      out[i + 3] = 255;
    }
  }
  return out;
}
