import { describe, expect, it } from 'vitest';
import { smoothstep, territoryLineColor, territoryOpacity } from '../src/core/lines';
import { THEME, TERRITORY_LINE } from '../src/core/theme';
import { MAX_SCALE } from '../src/core/camera';

const P = TERRITORY_LINE;

describe('FR-138 smoothstep and territory line opacity', () => {
  it('FR-138 smoothstep is 0 at and below a, 1 at and above b, and 3t^2 - 2t^3 between', () => {
    expect(smoothstep(4, 12, 0)).toBe(0);
    expect(smoothstep(4, 12, 4)).toBe(0);
    expect(smoothstep(4, 12, 12)).toBe(1);
    expect(smoothstep(4, 12, 99)).toBe(1);
    expect(smoothstep(4, 12, 8)).toBe(0.5);
    const t = (6 - 4) / 8;
    expect(smoothstep(4, 12, 6)).toBe(3 * t * t - 2 * t * t * t);
  });

  it('FR-138 the opacity is 0 at the fade start and below it', () => {
    expect(territoryOpacity(P.fadeStart, P)).toBe(0);
    expect(territoryOpacity(P.fadeStart / 2, P)).toBe(0);
    expect(territoryOpacity(0.5, P)).toBe(0);
    expect(territoryOpacity(0, P)).toBe(0);
  });

  it('FR-138 the opacity is exactly the maximum at the fade-full scale and at scale 32', () => {
    expect(territoryOpacity(P.fadeFull, P)).toBe(P.maxOpacity);
    expect(territoryOpacity(MAX_SCALE, P)).toBe(P.maxOpacity);
    expect(territoryOpacity(1000, P)).toBe(P.maxOpacity);
  });

  it('FR-138 the opacity at the middle of the fade range is half the maximum', () => {
    const params = { fadeStart: 4, fadeFull: 12, maxOpacity: 0.3, darken: 0.65 };
    expect(territoryOpacity(8, params)).toBe(0.15);
  });

  it('FR-138 the opacity is strictly between 0 and the maximum inside the fade range', () => {
    const mid = (P.fadeStart + P.fadeFull) / 2;
    expect(territoryOpacity(mid, P)).toBeGreaterThan(0);
    expect(territoryOpacity(mid, P)).toBeLessThan(P.maxOpacity);
  });
});

describe('FR-140 the opacity depends on the scale only and never decreases', () => {
  it('FR-140 the opacity does not decrease when the scale increases (grid of scales 0..40)', () => {
    let previous = -1;
    for (let s = 0; s <= 40; s += 0.125) {
      const o = territoryOpacity(s, P);
      expect(o, `scale ${s}`).toBeGreaterThanOrEqual(previous);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(P.maxOpacity);
      previous = o;
    }
  });

  it('FR-140 the opacity function takes only a scale and the parameters', () => {
    expect(territoryOpacity.length).toBe(2);
  });
});

describe('FR-138 territory line colour', () => {
  it('FR-138 each channel becomes floor(c * D)', () => {
    expect(territoryLineColor([200, 100, 51], 0.65)).toStrictEqual([130, 65, 33]);
    expect(territoryLineColor([255, 255, 255], 0.5)).toStrictEqual([127, 127, 127]);
  });

  it('FR-138 a black colour stays black, so its territory line equals the fill', () => {
    expect(territoryLineColor([0, 0, 0], 0.65)).toStrictEqual([0, 0, 0]);
  });
});

describe('FR-138 territory line parameters are inside the spec ranges', () => {
  it('FR-138 the theme parameters are in the Definitions ranges', () => {
    expect(THEME.territoryLine).toBe(TERRITORY_LINE);
    expect(P.fadeStart).toBeGreaterThanOrEqual(2);
    expect(P.fadeStart).toBeLessThanOrEqual(8);
    expect(P.fadeFull).toBeGreaterThan(P.fadeStart);
    expect(P.fadeFull).toBeLessThanOrEqual(16);
    expect(P.maxOpacity).toBeGreaterThanOrEqual(0.25);
    expect(P.maxOpacity).toBeLessThanOrEqual(0.35);
    expect(P.darken).toBeGreaterThanOrEqual(0.5);
    expect(P.darken).toBeLessThanOrEqual(0.8);
  });

  it('FR-138 the initial values are the ones of plan section 6', () => {
    expect(P).toStrictEqual({ fadeStart: 4, fadeFull: 12, maxOpacity: 0.3, darken: 0.65 });
  });
});
