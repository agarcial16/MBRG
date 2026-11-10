import { describe, expect, it } from 'vitest';
import { fitScale } from '../src/core/camera';
import { DETAIL_REFERENCE, detailFactor, scaledFade } from '../src/core/detail-scale';
import { LABEL_PARAMS } from '../src/core/label-params';
import { labelAlpha } from '../src/core/label-frame';
import { territoryOpacity } from '../src/core/lines';
import { TERRITORY_LINE } from '../src/core/theme';

const IMAGE = { w: 1600, h: 900 };

describe('FR-438 the detail factor scales the fade thresholds with the screen', () => {
  it('FR-438 the reference is the 1280x720 desk', () => {
    expect(DETAIL_REFERENCE).toStrictEqual({ width: 1280, height: 720 });
  });

  it('FR-438 a viewport as large as the reference, or larger, has factor exactly 1', () => {
    for (const vp of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 1280, height: 2000 }]) {
      expect(detailFactor(IMAGE, vp), `${vp.width}x${vp.height}`).toBe(1);
    }
  });

  it('FR-438 a phone has fit / fit_ref', () => {
    const vp = { width: 390, height: 700 };
    const expected = fitScale(IMAGE, vp) / fitScale(IMAGE, DETAIL_REFERENCE);
    expect(detailFactor(IMAGE, vp)).toBeCloseTo(expected, 12);
    expect(detailFactor(IMAGE, vp)).toBeLessThan(0.35);
  });

  it('FR-438 a degenerate viewport or image gives 1 (no change)', () => {
    expect(detailFactor(IMAGE, { width: 0, height: 0 })).toBe(1);
    expect(detailFactor({ w: 0, h: 0 }, { width: 390, height: 700 })).toBe(1);
  });

  it('FR-438 scaledFade multiplies both thresholds and keeps the other members', () => {
    const p = scaledFade(LABEL_PARAMS, 0.4);
    expect(p.fadeStart).toBeCloseTo(0.6, 12);
    expect(p.fadeFull).toBeCloseTo(0.8, 12);
    expect(p.minPx).toBe(LABEL_PARAMS.minPx);
    expect(scaledFade(TERRITORY_LINE, 1)).toStrictEqual(TERRITORY_LINE);
  });

  it('FR-438 lines and names start fading at the same scale', () => {
    const k = 0.4;
    const lines = scaledFade(TERRITORY_LINE, k);
    const labels = scaledFade(LABEL_PARAMS, k);
    const territory = { role: 'territory' as const, factor: 1 };
    expect(territoryOpacity(lines.fadeStart, lines)).toBe(0);
    expect(labelAlpha(territory, labels.fadeStart, labels)).toBe(0);
    expect(territoryOpacity(lines.fadeFull, lines)).toBe(TERRITORY_LINE.maxOpacity);
    expect(labelAlpha(territory, labels.fadeFull, labels)).toBe(1);
    // On the phone the provinces are visible at a scale where the desk shows none.
    expect(territoryOpacity(0.7, lines)).toBeGreaterThan(0);
    expect(territoryOpacity(0.7, TERRITORY_LINE)).toBe(0);
  });
});
