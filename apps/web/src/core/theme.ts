// Theme constants (FR-139, FR-142, FR-143). Pure data: values proposed in plan section 6,
// confirmed at the screenshot review (NFR-27); the territory line values are tuned in T9.
import type { Rgb } from '@mbrg/shared';

export type FillClass = 'land' | 'sea' | 'outside';
export type BorderClass = 'faction' | 'territory' | 'coast' | 'sea-zone' | 'outer' | 'shore';

/** Territory line parameters (spec Definitions): S0, S1, Amax, D. */
export interface TerritoryLineParams {
  fadeStart: number;
  fadeFull: number;
  maxOpacity: number;
  darken: number;
}

export interface Theme {
  palette: readonly Rgb[];
  sea: Rgb;
  background: Rgb;
  /** Opaque colour of every class except `territory` (its colour comes from the owner). */
  border: Readonly<Record<Exclude<BorderClass, 'territory'>, Rgb>>;
  /** Width in screen (CSS) pixels. */
  width: Readonly<Record<BorderClass, 1 | 2>>;
  territoryLine: TerritoryLineParams;
}

/** Colour from a `#rrggbb` literal. */
function hex(text: string): Rgb {
  return [parseInt(text.slice(1, 3), 16), parseInt(text.slice(3, 5), 16), parseInt(text.slice(5, 7), 16)];
}

/** Viewer palette, in assignment order (FR-141, FR-142). */
export const PALETTE: readonly Rgb[] = [
  hex('#c0504d'), // red
  hex('#e8b04b'), // ochre
  hex('#6aa84f'), // green
  hex('#8e6bbf'), // purple
  hex('#e07b39'), // orange
  hex('#4bb3a7'), // teal
  hex('#d16fa6'), // pink
  hex('#a3c24a'), // lime
  hex('#8b5a3c'), // brown
  hex('#f2d65c'), // yellow
  hex('#c98fd6'), // lilac
  hex('#d4a373'), // tan
];

export const SEA: Rgb = hex('#9cc0dc');
/** Outside the image, other land and lakes (FR-143): a warm grey, not a water colour. */
export const BACKGROUND: Rgb = hex('#bdb8aa');

export const BORDER_COLORS: Readonly<Record<Exclude<BorderClass, 'territory'>, Rgb>> = {
  faction: hex('#4a3b2c'),
  outer: hex('#6b655a'),
  coast: hex('#2f5573'),
  shore: hex('#46708f'),
  'sea-zone': hex('#7fa6c6'),
};

export const BORDER_WIDTHS: Readonly<Record<BorderClass, 1 | 2>> = {
  faction: 2,
  outer: 2,
  coast: 1,
  'sea-zone': 1,
  shore: 1,
  territory: 1,
};

/** Initial territory line values (tuned in T9). */
export const TERRITORY_LINE: TerritoryLineParams = { fadeStart: 4, fadeFull: 12, maxOpacity: 0.3, darken: 0.65 };

export const THEME: Theme = {
  palette: PALETTE,
  sea: SEA,
  background: BACKGROUND,
  border: BORDER_COLORS,
  width: BORDER_WIDTHS,
  territoryLine: TERRITORY_LINE,
};
