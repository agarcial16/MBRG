import { describe, expect, it } from 'vitest';
import type { Rgb } from '@mbrg/shared';
import { blackWins, contrastRatio, labelInk, relativeLuminance } from '../src/core/contrast';
import { PALETTE, SEA } from '../src/core/theme';

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

describe('FR-174 relative luminance and contrast ratio (WCAG 2)', () => {
  it('FR-174 luminance of black is 0 and of white is 1', () => {
    expect(relativeLuminance(BLACK)).toBe(0);
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 12);
  });

  it('FR-174 luminance uses the sRGB transfer: both branches and the channel weights', () => {
    // 10/255 = 0.0392 <= 0.04045: linear branch c / 12.92
    expect(relativeLuminance([10, 0, 0])).toBeCloseTo((0.2126 * (10 / 255)) / 12.92, 12);
    // 128/255: power branch
    const c = Math.pow((128 / 255 + 0.055) / 1.055, 2.4);
    expect(relativeLuminance([128, 128, 128])).toBeCloseTo(c, 12);
    expect(relativeLuminance([255, 0, 0])).toBeCloseTo(0.2126, 12);
    expect(relativeLuminance([0, 255, 0])).toBeCloseTo(0.7152, 12);
    expect(relativeLuminance([0, 0, 255])).toBeCloseTo(0.0722, 12);
  });

  it('FR-174 the contrast ratio of black and white is 21, of a colour with itself 1, and it is symmetric', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 12);
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 12);
    expect(contrastRatio([90, 40, 200], [90, 40, 200])).toBe(1);
    expect(contrastRatio([10, 200, 30], [200, 20, 99])).toBe(contrastRatio([200, 20, 99], [10, 200, 30]));
  });
});

describe('FR-174 the ink is black or white, whichever has the higher contrast; halo is the other', () => {
  const check = (fill: Rgb): void => {
    const { ink, halo } = labelInk(fill);
    const cb = contrastRatio(BLACK, fill);
    const cw = contrastRatio(WHITE, fill);
    if (cb >= cw) {
      expect(ink).toStrictEqual(BLACK);
      expect(halo).toStrictEqual(WHITE);
    } else {
      expect(ink).toStrictEqual(WHITE);
      expect(halo).toStrictEqual(BLACK);
    }
    // the chosen ink has the higher (or an equal) contrast of the two
    expect(contrastRatio(ink, fill)).toBeGreaterThanOrEqual(contrastRatio(halo, fill));
  };

  it('FR-174 the chosen ink has the higher contrast for every colour of the palette and the sea colour', () => {
    for (const color of [...PALETTE, SEA]) check(color);
  });

  it('FR-174 the chosen ink has the higher contrast on a grid of colours', () => {
    for (let r = 0; r < 256; r += 51) {
      for (let g = 0; g < 256; g += 51) {
        for (let b = 0; b < 256; b += 51) check([r, g, b]);
      }
    }
  });

  it('FR-174 pure black gets white ink and pure white gets black ink', () => {
    expect(labelInk(BLACK)).toStrictEqual({ ink: WHITE, halo: BLACK });
    expect(labelInk(WHITE)).toStrictEqual({ ink: BLACK, halo: WHITE });
  });

  it('FR-174 a tie goes to black: equal contrast ratios choose black, only a strictly higher white ratio chooses white', () => {
    expect(blackWins(4.5, 4.5)).toBe(true);
    expect(blackWins(4.5, 4.4999)).toBe(true);
    expect(blackWins(4.5, 4.5001)).toBe(false);
  });

  it('FR-174 around the grey where the ratios cross, the ink switches from white to black exactly once', () => {
    const inks = Array.from({ length: 256 }, (_, g) => labelInk([g, g, g]).ink[0]);
    const switches = inks.filter((v, i) => i > 0 && v !== inks[i - 1]).length;
    expect(switches).toBe(1);
    expect(inks[0]).toBe(255);
    expect(inks[255]).toBe(0);
  });

  it('FR-174 the same fill always gives the same ink', () => {
    expect(labelInk([120, 60, 200])).toStrictEqual(labelInk([120, 60, 200]));
  });
});
