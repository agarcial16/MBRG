import { describe, expect, it } from 'vitest';
import { previewColors } from '../src/core/preview';
import type { PreviewSource } from '../src/core/types';
import { withPreviewColors } from '../src/importer/preview-colors';

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('FR-610 the preview colours of an import with many factions', () => {
  const source = (n: number, preferred: Record<number, string> = {}): PreviewSource => ({
    width: 1,
    pixels: new Uint32Array(1),
    factions: Array.from({ length: n }, (_, i) => (preferred[i + 1] === undefined ? { id: i + 1 } : { id: i + 1, color: preferred[i + 1]! })),
    entries: [],
  });

  it('FR-610 leaves a map of at most 16 uncoloured factions as it was: the builder palette colours them', () => {
    const s = source(16);
    expect(withPreviewColors(s.factions)).toStrictEqual(s.factions);
  });

  it('FR-610 keeps every given colour and gives each uncoloured faction beyond the palette its own light, distinct colour (no near-black)', () => {
    const preferred = { 3: '#336699', 40: '#abcdef' };
    const s = source(52, preferred);
    const colored = { ...s, factions: withPreviewColors(s.factions) };
    expect(colored.factions[2]!.color).toBe('#336699');
    expect(colored.factions[39]!.color).toBe('#abcdef');
    const base = previewColors(colored);
    // all base colours are pairwise distinct (the builder's rule) and the generated ones are never near-black
    expect(new Set([...base.factions, base.sea, base.background]).size).toBe(52 + 2);
    colored.factions.forEach((f, i) => {
      if (f.color !== undefined && preferred[(i + 1) as 3 | 40] === undefined) expect(luminance(f.color), `faction ${f.id}`).toBeGreaterThan(40);
    });
    expect(base.factions.filter((c) => luminance(c) < 20)).toStrictEqual([]);
  });

  it('FR-610 returns the same colours for the same factions', () => {
    const s = source(30);
    expect(withPreviewColors(s.factions)).toStrictEqual(withPreviewColors(s.factions));
  });
});
