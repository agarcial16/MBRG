import { describe, expect, it } from 'vitest';

import { detectScale, MAX_DETECT_EDGE } from './decode.js';

describe('detectScale', () => {
  it('leaves a small image alone', () => {
    expect(detectScale(800, 600)).toBeNull();
    expect(detectScale(MAX_DETECT_EDGE, MAX_DETECT_EDGE)).toBeNull();
  });

  it('brings a big image down to the cap on its longest side', () => {
    // A 4000x3000 photo: the point of the exercise, since 12M pixels is what
    // makes every slider move freeze the page.
    const scale = detectScale(4000, 3000);
    expect(scale).toBeCloseTo(MAX_DETECT_EDGE / 4000, 10);
    expect(Math.round(4000 * scale!)).toBe(MAX_DETECT_EDGE);
    expect(Math.round(3000 * scale!)).toBeLessThanOrEqual(MAX_DETECT_EDGE);
  });

  it('uses the longest side, whichever axis that is', () => {
    expect(detectScale(3000, 4000)).toBe(detectScale(4000, 3000));
    // Portrait maps are common, and the cap has to apply to the height too.
    expect(Math.round(4000 * detectScale(3000, 4000)!)).toBe(MAX_DETECT_EDGE);
  });

  it('scales an extreme panorama down', () => {
    const scale = detectScale(12000, 1000)!;
    expect(Math.round(12000 * scale)).toBe(MAX_DETECT_EDGE);
    expect(Math.round(1000 * scale)).toBeGreaterThan(0);
  });

  it('is deterministic and takes a custom cap', () => {
    expect(detectScale(2000, 1000, 500)).toBe(detectScale(2000, 1000, 500));
    expect(detectScale(2000, 1000, 500)).toBeCloseTo(0.25, 10);
  });
});