// Colour and line rules of a round step in progress (FR-179, FR-180; plan D7, D8 and section 7), and their CPU
// reference renderer. `shadeTransition` is the normative rule for the shader port: at forward progress 0 it
// draws the earlier state, at 1 the later one, and in between the colour front of `front.ts`.
// Pure: owners, entries, front and camera in, one colour out.
import type { Rgb } from '@mbrg/shared';
import { borderClass, cellAt, EDGE_BIAS, shade, WIDTH_LEVELS } from './borders';
import type { IndexGrid } from './borders';
import type { Camera, Viewport } from './camera';
import { frontAt } from './front';
import type { FrontField } from './front';
import { territoryLineColor, territoryOpacity } from './lines';
import type { BorderClass, FillClass, Theme } from './theme';

/** `absorbed` is the edge between a moving territory and the territory of the absorber it touched. */
export type StepBorderClass = BorderClass | 'absorbed';

/**
 * Winner order when several classes meet on one screen pixel: first wins. The interpolated line has the
 * rank of `faction`, but a real `faction` line wins the pixel (plan D8), so both ends stay continuous.
 */
export const TRANSITION_PRIORITY: readonly StepBorderClass[] = ['faction', 'absorbed', 'outer', 'coast', 'shore', 'sea-zone', 'territory'];

export interface StepShaded {
  fill: FillClass;
  border: StepBorderClass | null;
  color: Rgb;
}

/** `a + (b - a) * t`: exact at t = 0 and whenever a = b. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function mix(fill: Rgb, line: Rgb, alpha: number): Rgb {
  return [
    Math.round(fill[0] * (1 - alpha) + line[0] * alpha),
    Math.round(fill[1] * (1 - alpha) + line[1] * alpha),
    Math.round(fill[2] * (1 - alpha) + line[2] * alpha),
  ];
}

/**
 * Colour of the screen position (fx, fy) in CSS pixels at forward progress `f` (0 = earlier state, 1 =
 * later state). `before` and `after` are the owner tables of the two states; an entry whose owner differs
 * is a moving one, and its map units show the absorber's colour once their front distance is below `f`
 * (compared in float32, as the shader does). At f = 1 this is the drawing of the later state.
 */
export function shadeTransition(
  grid: IndexGrid,
  before: ArrayLike<number>,
  after: ArrayLike<number>,
  factionColors: readonly Rgb[],
  theme: Theme,
  front: FrontField,
  f: number,
  cam: Camera,
  vp: Viewport,
  fx: number,
  fy: number,
): StepShaded {
  if (!(f >= 0 && f <= 1)) throw new RangeError(`forward progress ${f} is not in 0..1`);
  if (f === 1) return shade(grid, after, factionColors, theme, cam, vp, fx, fy);

  const px = cam.x + (fx - vp.width / 2) / cam.scale;
  const py = cam.y + (fy - vp.height / 2) / cam.scale;
  const ax = Math.floor(px);
  const ay = Math.floor(py);
  const a = cellAt(grid, ax, ay);
  const fill = grid.fills[a]!;
  const colorOf = (owner: number): Rgb => {
    const color = factionColors[owner];
    if (color === undefined) throw new RangeError(`land entry ${a} has no owner colour`);
    return color;
  };

  let fillColor: Rgb;
  if (fill === 'land') {
    let owner = after[a]!;
    if (before[a] !== after[a]) {
      const distance = frontAt(front, ax, ay);
      if (distance < 0) throw new RangeError(`moving map unit (${ax}, ${ay}) has no front distance`);
      if (!(distance < Math.fround(f))) owner = before[a]!;
    }
    fillColor = colorOf(owner);
  } else {
    fillColor = fill === 'sea' ? theme.sea : theme.background;
  }

  const classOf = (b: number): StepBorderClass | null => {
    if (a === b) return null;
    if (fill === 'land' && grid.fills[b] === 'land') {
      if (after[a] !== after[b]) return 'faction';
      return before[a] === before[b] ? 'territory' : 'absorbed';
    }
    return borderClass(a, b, grid.fills, after);
  };

  const found = new Set<StepBorderClass>();
  for (const w of WIDTH_LEVELS) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const o = (w / 2 + (dx + dy) * EDGE_BIAS) / cam.scale;
      const c = classOf(cellAt(grid, Math.floor(px + dx * o), Math.floor(py + dy * o)));
      if (c !== null && (c === 'absorbed' ? theme.width.faction : theme.width[c]) === w) found.add(c);
    }
  }
  const border = TRANSITION_PRIORITY.find((c) => found.has(c)) ?? null;

  if (border === null) return { fill, border, color: fillColor };
  const darken = theme.territoryLine.darken;
  const opacity = territoryOpacity(cam.scale, theme.territoryLine);
  if (border === 'absorbed') {
    const line = lerpColor(theme.border.faction, territoryLineColor(colorOf(after[a]!), darken), f);
    return { fill, border, color: mix(fillColor, line, lerp(1, opacity, f)) };
  }
  if (border === 'territory') {
    const line = lerpColor(territoryLineColor(colorOf(before[a]!), darken), territoryLineColor(colorOf(after[a]!), darken), f);
    return { fill, border, color: mix(fillColor, line, opacity) };
  }
  return { fill, border, color: theme.border[border] };
}

/** RGBA bytes of the whole drawing surface at forward progress `f`, laid out as `renderReference`. */
export function renderTransitionReference(
  grid: IndexGrid,
  before: ArrayLike<number>,
  after: ArrayLike<number>,
  factionColors: readonly Rgb[],
  theme: Theme,
  front: FrontField,
  f: number,
  cam: Camera,
  vp: Viewport,
  dpr: number,
): Uint8Array {
  const width = Math.round(vp.width * dpr);
  const height = Math.round(vp.height * dpr);
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { color } = shadeTransition(grid, before, after, factionColors, theme, front, f, cam, vp, (x + 0.5) / dpr, (y + 0.5) / dpr);
      const i = (y * width + x) * 4;
      out[i] = color[0];
      out[i + 1] = color[1];
      out[i + 2] = color[2];
      out[i + 3] = 255;
    }
  }
  return out;
}
