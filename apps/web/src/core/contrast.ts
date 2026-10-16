// Label ink choice (FR-174): black or white, whichever has the higher WCAG 2 contrast ratio with the fill. Pure.
import type { Rgb } from '@mbrg/shared';

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/** WCAG 2 relative luminance of an 8-bit sRGB colour. */
export function relativeLuminance(color: Rgb): number {
  const channel = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2]);
}

/** WCAG 2 contrast ratio, from 1 to 21; symmetric. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Black wins on a tie: only a strictly higher white ratio chooses white. */
export function blackWins(blackContrast: number, whiteContrast: number): boolean {
  return blackContrast >= whiteContrast;
}

/** The text colour (`ink`) and the colour of the 1 pixel halo (`halo`, the other one) for a fill colour. */
export function labelInk(fill: Rgb): { ink: Rgb; halo: Rgb } {
  return blackWins(contrastRatio(BLACK, fill), contrastRatio(WHITE, fill)) ? { ink: BLACK, halo: WHITE } : { ink: WHITE, halo: BLACK };
}
