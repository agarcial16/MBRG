import { describe, expect, it } from 'vitest';
import { previewColors, previewRgb } from '../src/core/preview';
import { WATER } from '../src/core/rasterize';
import type { PreviewSource } from '../src/core/types';

const SEA = '#3c6e9e';
const BACKGROUND = '#cdc6b4';

function channels(color: string): [number, number, number] {
  return [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
  ];
}

function half(color: string): [number, number, number] {
  const [r, g, b] = channels(color);
  return [Math.floor(r / 2), Math.floor(g / 2), Math.floor(b / 2)];
}

function at(rgb: Uint8Array, width: number, x: number, y: number): [number, number, number] {
  const i = 3 * (y * width + x);
  return [rgb[i]!, rgb[i + 1]!, rgb[i + 2]!];
}

/** A source with land 1 and 2 (factions 1 and 2), land 3 (faction 1) and sea 4; `rows` are values. */
function source(rows: number[][], colors: (string | undefined)[] = [undefined, undefined]): PreviewSource {
  const width = rows.length;
  const pixels = new Uint32Array(width * width);
  rows.forEach((row, y) => row.forEach((v, x) => (pixels[y * width + x] = v)));
  return {
    width,
    pixels,
    factions: colors.map((color, i) => (color === undefined ? { id: i + 1 } : { id: i + 1, color })),
    entries: [
      { id: 1, kind: 'land', owner: 1 },
      { id: 2, kind: 'land', owner: 2 },
      { id: 3, kind: 'land', owner: 1 },
      { id: 4, kind: 'sea' },
    ],
  };
}

function distinct(values: string[]): boolean {
  return new Set(values).size === values.length;
}

describe('FR-126 preview base colours', () => {
  it('FR-126 a faction with a preferred colour keeps it', () => {
    const colors = previewColors(source([[1]], ['#aa0011', '#00bb22']));
    expect(colors.factions).toStrictEqual(['#aa0011', '#00bb22']);
  });

  it('FR-126 a faction without a colour gets one distinct from every other base colour', () => {
    const colors = previewColors(source([[1]], ['#aa0011', undefined]));
    expect(colors.factions[0]).toBe('#aa0011');
    expect(distinct([...colors.factions, colors.sea, colors.background])).toBe(true);
  });

  it('FR-126 sea zones share one colour and background has another, all pairwise distinct', () => {
    const colors = previewColors(source([[1]]));
    expect(colors.sea).toBe(SEA);
    expect(colors.background).toBe(BACKGROUND);
    expect(distinct([...colors.factions, colors.sea, colors.background])).toBe(true);
  });

  it('FR-126 base colours stay pairwise distinct when preferred colours equal the sea and background defaults', () => {
    const colors = previewColors(source([[1]], [SEA, BACKGROUND]));
    expect(colors.factions).toStrictEqual([SEA, BACKGROUND]);
    expect(distinct([...colors.factions, colors.sea, colors.background])).toBe(true);
  });

  it('FR-126 a colourless faction never takes a colour that a later faction prefers', () => {
    const first = previewColors(source([[1]], [undefined, '#e6194b']));
    expect(first.factions[1]).toBe('#e6194b');
    expect(first.factions[0]).not.toBe('#e6194b');
    expect(distinct([...first.factions, first.sea, first.background])).toBe(true);
  });

  it('FR-126 a repeated preferred colour is skipped for the later faction so the colours stay distinct', () => {
    const colors = previewColors(source([[1]], ['#aa0011', '#aa0011']));
    expect(colors.factions[0]).toBe('#aa0011');
    expect(distinct([...colors.factions, colors.sea, colors.background])).toBe(true);
  });

  it('FR-126 many factions without colours still get pairwise distinct base colours', () => {
    const many = source([[1]], new Array<string | undefined>(40).fill(undefined));
    const colors = previewColors(many);
    expect(colors.factions).toHaveLength(40);
    expect(distinct([...colors.factions, colors.sea, colors.background])).toBe(true);
    for (const c of [...colors.factions, colors.sea, colors.background]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('FR-126 preview pixels and darkened borders', () => {
  const colors = ['#aa0011', '#00bb22'];

  it('FR-126 a pixel with no differing 4-neighbour is drawn in exactly its base colour', () => {
    const src = source(
      [
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
      ],
      colors,
    );
    const rgb = previewRgb(src);
    expect(rgb).toHaveLength(27);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) expect(at(rgb, 3, x, y)).toStrictEqual(channels('#aa0011'));
  });

  it('FR-126 every pixel with a 4-adjacent pixel of another value is darkened to floor(c / 2) per channel', () => {
    // Odd channels on purpose: 0xaa = 170, 0x11 = 17 -> 85 and 8.
    const src = source(
      [
        [1, 1, 2, 2],
        [1, 1, 2, 2],
        [1, 1, 2, 2],
        [1, 1, 2, 2],
      ],
      colors,
    );
    const rgb = previewRgb(src);
    for (let y = 0; y < 4; y++) {
      expect(at(rgb, 4, 0, y)).toStrictEqual(channels('#aa0011'));
      expect(at(rgb, 4, 1, y)).toStrictEqual(half('#aa0011'));
      expect(at(rgb, 4, 2, y)).toStrictEqual(half('#00bb22'));
      expect(at(rgb, 4, 3, y)).toStrictEqual(channels('#00bb22'));
    }
    expect(half('#aa0011')).toStrictEqual([85, 0, 8]);
  });

  it('FR-126 a diagonal neighbour alone makes no border and the image edge is not a border', () => {
    const src = source(
      [
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 2],
      ],
      colors,
    );
    const rgb = previewRgb(src);
    expect(at(rgb, 3, 1, 1)).toStrictEqual(channels('#aa0011'));
    expect(at(rgb, 3, 0, 0)).toStrictEqual(channels('#aa0011'));
    expect(at(rgb, 3, 2, 2)).toStrictEqual(half('#00bb22'));
    expect(at(rgb, 3, 1, 2)).toStrictEqual(half('#aa0011'));
    expect(at(rgb, 3, 2, 1)).toStrictEqual(half('#aa0011'));
  });

  it('FR-126 two territories of one faction share its colour but are separated by a darkened border', () => {
    const src = source(
      [
        [1, 1, 3, 3],
        [1, 1, 3, 3],
        [1, 1, 3, 3],
        [1, 1, 3, 3],
      ],
      colors,
    );
    const rgb = previewRgb(src);
    expect(at(rgb, 4, 0, 0)).toStrictEqual(channels('#aa0011'));
    expect(at(rgb, 4, 1, 0)).toStrictEqual(half('#aa0011'));
    expect(at(rgb, 4, 2, 0)).toStrictEqual(half('#aa0011'));
    expect(at(rgb, 4, 3, 0)).toStrictEqual(channels('#aa0011'));
  });

  it('FR-126 sea zones draw in the shared sea colour, background in its colour, and unassigned water as sea', () => {
    const src = source(
      [
        [4, 4, 0, 0],
        [4, 4, 0, 0],
        [WATER, WATER, 4, 4],
        [WATER, WATER, 4, 4],
      ],
      colors,
    );
    const rgb = previewRgb(src);
    expect(at(rgb, 4, 0, 0)).toStrictEqual(channels(SEA));
    expect(at(rgb, 4, 3, 0)).toStrictEqual(channels(BACKGROUND));
    expect(at(rgb, 4, 0, 3)).toStrictEqual(channels(SEA));
    expect(at(rgb, 4, 3, 3)).toStrictEqual(channels(SEA));
    expect(at(rgb, 4, 1, 1)).toStrictEqual(half(SEA));
    expect(at(rgb, 4, 2, 0)).toStrictEqual(half(BACKGROUND));
  });

  it('FR-126 the preview is a pure function of its source: same source, same bytes', () => {
    const src = source(
      [
        [1, 2],
        [4, 0],
      ],
      colors,
    );
    expect(previewRgb(src)).toStrictEqual(previewRgb(src));
  });
});
