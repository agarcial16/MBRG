import { describe, expect, it } from 'vitest';
import { thinCoastFactions } from '../src/importer/coast-check';

/** A raster from rows of text: . other land (0), digits land territories (1..9), a/b sea zone pixels (100, 101). */
function grid(rows: string[]): { width: number; pixels: Uint32Array } {
  const width = rows.length;
  const pixels = new Uint32Array(width * width);
  rows.forEach((row, y) => [...row].forEach((ch, x) => (pixels[y * width + x] = ch === '.' ? 0 : /\d/.test(ch) ? Number(ch) : 100 + ch.charCodeAt(0) - 97)));
  return { width, pixels };
}

describe('FR-609 the faction whose only sea contact is thin water', () => {
  // territory 1 (faction 10) touches a one-pixel channel of zone a that runs between it and other land; territory 2 (faction 20)
  // and territory 3 (faction 10 too) face the open sea of zone b
  const rows = ['11a.bbbbbbbb', '11a.bbbbbbbb', '11a.bbbbbbbb', '11a.bbbbbbbb', '11a.bbbbbbbb', '..a.bbbbbbbb', 'bbbbbbbbbbbb', 'bbbbbbbbbbbb', 'bbbbbbbbbbbb', 'bbbbbbbbbbbb', 'bbbbbbbbbbbb', 'bbbbbbbbbbbb'];
  const owner = new Map([[1, 10], [2, 20], [3, 10]]);
  const sea = new Set([100, 101]);

  it('FR-609 lists a faction that touches thin water and no open water, with the pixels of the thin contacts', () => {
    const { width, pixels } = grid(rows);
    expect(thinCoastFactions({ width, pixels, owner, seaIds: sea, radius: 2 })).toStrictEqual([{ faction: 10, pixels: 5, territories: [1] }]);
  });

  it('FR-609 does not list a faction that also has open water', () => {
    const { width, pixels } = grid(rows);
    // territory 3 of faction 10 on the open sea
    for (let y = 8; y < 10; y++) for (let x = 4; x < 7; x++) pixels[y * width + x] = 3;
    expect(thinCoastFactions({ width, pixels, owner, seaIds: sea, radius: 2 })).toStrictEqual([]);
  });

  it('FR-609 lists nothing when the radius is 0', () => {
    const { width, pixels } = grid(rows);
    expect(thinCoastFactions({ width, pixels, owner, seaIds: sea, radius: 0 })).toStrictEqual([]);
  });
});
