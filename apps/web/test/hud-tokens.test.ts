// The visual tokens of the match screen (spec 010 FR-367, NFR-65): the palette is a table and every text or control pair of it
// is checked against the contrast rule with an independent computation (WCAG relative luminance, literal sRGB constants).
import { describe, expect, it } from 'vitest';
import { PAIRS, TOKENS, contrastRatio, cssVariables } from '../src/core/hud-tokens';

/** Independent reference: WCAG 2.x relative luminance of #rrggbb, written out channel by channel. */
function luminance(hex: string): number {
  const channel = (s: string): number => {
    const v = parseInt(s, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(hex.slice(1, 3)) + 0.7152 * channel(hex.slice(3, 5)) + 0.0722 * channel(hex.slice(5, 7));
}
const reference = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('NFR-65 the contrast of the visual tokens', () => {
  it('NFR-65 the contrast function matches the reference on known pairs', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.4777, 3);
    expect(contrastRatio('#c0994f', '#241b14')).toBeCloseTo(reference('#c0994f', '#241b14'), 8);
    expect(contrastRatio('#241b14', '#c0994f')).toBeCloseTo(reference('#c0994f', '#241b14'), 8);
  });

  it('NFR-65 every token is a #rrggbb colour', () => {
    for (const [name, value] of Object.entries(TOKENS)) expect(value, name).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('NFR-65 every text pair reaches 4.5:1 (3:1 for text of 24 px or more and for control outlines)', () => {
    expect(PAIRS.length).toBeGreaterThanOrEqual(10);
    for (const pair of PAIRS) {
      const need = pair.large === true || pair.outline === true ? 3 : 4.5;
      expect(contrastRatio(TOKENS[pair.fg], TOKENS[pair.bg]), `${pair.name}: ${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(need);
      expect(reference(TOKENS[pair.fg], TOKENS[pair.bg]), pair.name).toBeGreaterThanOrEqual(need);
    }
  });

  it('NFR-65 the table lists the pairs the screen really uses: body, muted, accent, button and wax seal on their grounds', () => {
    const names = PAIRS.map((p) => p.name);
    for (const wanted of ['body text', 'muted text', 'accent text', 'primary button', 'wax seal', 'vellum text', 'vellum muted text', 'timer warning', 'frame outline']) {
      expect(names, wanted).toContain(wanted);
    }
  });

  it('FR-367 the css variables carry every token under its own name, once', () => {
    const css = cssVariables();
    for (const [name, value] of Object.entries(TOKENS)) {
      const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      expect(css, name).toContain(`--hud-${kebab}:${value};`);
    }
    expect(css.match(/--hud-/g)?.length).toBe(Object.keys(TOKENS).length);
  });
});
