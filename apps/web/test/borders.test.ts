import { describe, expect, it } from 'vitest';
import type { Rgb } from '@mbrg/shared';
import { WIDTH_LEVELS, borderClass, renderReference, shade, type IndexGrid } from '../src/core/borders';
import { territoryOpacity } from '../src/core/lines';
import { BACKGROUND, BORDER_COLORS, BORDER_WIDTHS, SEA, THEME, type BorderClass } from '../src/core/theme';
import type { Camera, Viewport } from '../src/core/camera';
import bordersSource from '../src/core/borders.ts?raw';
import { codeOnly } from './helpers/scan';
import { gridFrom, gridOf, ownersOf, type Kinds } from './helpers/grids';

// Entries: 1, 2, 3, 6 land; 4, 5 sea. Faction indexes: 1 (entries 1 and 3), 2 (entry 2), 3 (entry 6).
const KINDS: Kinds = { 1: 'land', 2: 'land', 3: 'land', 4: 'sea', 5: 'sea', 6: 'land' };
const OWNERS = ownersOf({ 1: 1, 2: 2, 3: 1, 6: 3 }, 6);
const FACTION_COLORS: Rgb[] = [
  [0, 0, 0],
  [250, 10, 10],
  [10, 250, 10],
  [250, 250, 10],
];
const VP: Viewport = { width: 20, height: 8 };

interface Image {
  width: number;
  height: number;
  at(x: number, y: number): Rgb;
}

function render(
  grid: IndexGrid,
  owners: readonly number[],
  cam: Camera,
  dpr = 1,
  vp: Viewport = VP,
  colors: readonly Rgb[] = FACTION_COLORS,
): Image {
  const data = renderReference(grid, owners, colors, THEME, cam, vp, dpr);
  const width = Math.round(vp.width * dpr);
  const height = Math.round(vp.height * dpr);
  expect(data.length).toBe(width * height * 4);
  return {
    width,
    height,
    at: (x, y) => {
      const i = (y * width + x) * 4;
      expect(data[i + 3]).toBe(255);
      return [data[i]!, data[i + 1]!, data[i + 2]!];
    },
  };
}

const eq = (a: Rgb, b: Rgb): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const key = (c: Rgb): string => c.join(',');

function blend(fill: Rgb, line: Rgb, alpha: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(fill[i]! * (1 - alpha) + line[i]! * alpha)) as Rgb;
}

/** Pair of entry indexes for each border class. */
const PAIRS: Record<BorderClass, [number, number]> = {
  faction: [1, 2],
  territory: [1, 3],
  coast: [1, 4],
  'sea-zone': [4, 5],
  outer: [1, 0],
  shore: [4, 0],
};
const SCALES = [0.5, 1, 3, 4, 5, 7, 8, 10, 16, 32];
/** Amendment 2026-10-15: faction and territory lines are 4 px, outer 2 px, the rest 1 px. */
const WIDTHS: Record<BorderClass, number> = { faction: 4, territory: 4, coast: 1, 'sea-zone': 1, outer: 2, shore: 1 };

/** Two halves of a 64 x 64 grid split at 32 (vertical edge) or at row 32 (horizontal edge). */
function halves(a: number, b: number, vertical: boolean): IndexGrid {
  return gridOf(64, 64, (x, y) => ((vertical ? x : y) < 32 ? a : b), KINDS);
}

/** Device pixels of one row (or column) equal to a colour. */
function runOf(img: Image, colour: Rgb, line: number, vertical: boolean): number[] {
  const out: number[] = [];
  const n = vertical ? img.width : img.height;
  for (let i = 0; i < n; i++) {
    const c = vertical ? img.at(i, line) : img.at(line, i);
    if (eq(c, colour)) out.push(i);
  }
  return out;
}

describe('FR-138 border class of the edge between two values', () => {
  const fills = ['outside', 'land', 'land', 'land', 'sea', 'sea', 'land'] as const;
  const owners = OWNERS;

  it('FR-138 each pair of fill classes gives the border class of the spec table', () => {
    expect(borderClass(1, 2, fills, owners)).toBe('faction');
    expect(borderClass(1, 3, fills, owners)).toBe('territory');
    expect(borderClass(1, 4, fills, owners)).toBe('coast');
    expect(borderClass(4, 1, fills, owners)).toBe('coast');
    expect(borderClass(4, 5, fills, owners)).toBe('sea-zone');
    expect(borderClass(1, 0, fills, owners)).toBe('outer');
    expect(borderClass(0, 1, fills, owners)).toBe('outer');
    expect(borderClass(4, 0, fills, owners)).toBe('shore');
    expect(borderClass(0, 4, fills, owners)).toBe('shore');
  });

  it('FR-138 equal values have no border, and outside next to outside has none', () => {
    expect(borderClass(1, 1, fills, owners)).toBeNull();
    expect(borderClass(4, 4, fills, owners)).toBeNull();
    expect(borderClass(0, 0, fills, owners)).toBeNull();
  });

  it('FR-137 two land territories are compared by owner index, never by colour', () => {
    // Same palette colour for faction 1 and 2, different owners: still a faction border.
    const same: Rgb[] = [FACTION_COLORS[0]!, FACTION_COLORS[1]!, FACTION_COLORS[1]!, FACTION_COLORS[3]!];
    const grid = halves(1, 2, true);
    const img = render(grid, OWNERS, { x: 32, y: 32, scale: 16 }, 1, VP, same);
    expect(runOf(img, BORDER_COLORS.faction, 4, true).length).toBe(4);
    // Different colours for one faction's two territories: still a territory line, no faction line.
    const img2 = render(halves(1, 3, true), OWNERS, { x: 32, y: 32, scale: 16 }, 1, VP, same);
    expect(runOf(img2, BORDER_COLORS.faction, 4, true).length).toBe(0);
  });

  it('FR-137 shade reports the same fill and border class whatever the faction colours are', () => {
    const grid = halves(1, 4, true);
    const planted: Rgb[] = [FACTION_COLORS[0]!, SEA, FACTION_COLORS[2]!, FACTION_COLORS[3]!];
    const cam = { x: 32, y: 32, scale: 16 };
    const left = shade(grid, OWNERS, planted, THEME, cam, VP, 9.75, 4);
    expect(left.fill).toBe('land');
    expect(left.border).toBe('coast');
    const right = shade(grid, OWNERS, planted, THEME, cam, VP, 10.25, 4);
    expect(right.fill).toBe('sea');
    expect(right.border).toBe('coast');
  });

  it('FR-137 a land colour equal to a border colour still gets its border drawn by class', () => {
    const planted: Rgb[] = [FACTION_COLORS[0]!, BORDER_COLORS.coast, FACTION_COLORS[2]!, FACTION_COLORS[3]!];
    const img = render(halves(1, 4, true), OWNERS, { x: 32, y: 32, scale: 16 }, 1, VP, planted);
    // Land (coast colour by plant) on the left, sea on the right: the sea side shows the sea colour.
    expect(eq(img.at(18, 4), SEA)).toBe(true);
    expect(eq(img.at(1, 4), BORDER_COLORS.coast)).toBe(true);
    expect(shade(halves(1, 4, true), OWNERS, planted, THEME, { x: 32, y: 32, scale: 16 }, VP, 1, 4).fill).toBe('land');
  });
});

describe('FR-136 fill colours', () => {
  it('FR-136 land is drawn in its owner colour, sea in the sea colour and outside in the background colour', () => {
    const cam = { x: 32, y: 32, scale: 4 };
    expect(eq(render(halves(1, 1, true), OWNERS, cam).at(3, 3), FACTION_COLORS[1]!)).toBe(true);
    expect(eq(render(halves(2, 2, true), OWNERS, cam).at(3, 3), FACTION_COLORS[2]!)).toBe(true);
    expect(eq(render(halves(4, 4, true), OWNERS, cam).at(3, 3), SEA)).toBe(true);
    expect(eq(render(halves(0, 0, true), OWNERS, cam).at(3, 3), BACKGROUND)).toBe(true);
  });

  it('FR-136 the area of the drawing surface not covered by the image is the background colour', () => {
    const grid = gridOf(8, 8, () => 1, KINDS);
    // Camera on the image corner: the top-left quarter of the surface is off the image.
    const img = render(grid, OWNERS, { x: 0, y: 0, scale: 1 }, 1, { width: 40, height: 40 });
    expect(eq(img.at(0, 0), BACKGROUND)).toBe(true);
    expect(eq(img.at(15, 15), BACKGROUND)).toBe(true);
    expect(eq(img.at(24, 24), FACTION_COLORS[1]!)).toBe(true);
  });

  it('FR-136 no pixel blends the colours of two map units: every pixel is a fill or a border colour', () => {
    const grid = gridOf(16, 16, (x, y) => [1, 2, 4, 5, 6, 0][(Math.floor(x / 3) + Math.floor(y / 3) * 2) % 6]!, KINDS);
    const allowed = new Set<string>([
      ...FACTION_COLORS.slice(1).map(key),
      key(SEA),
      key(BACKGROUND),
      ...Object.values(BORDER_COLORS).map(key),
    ]);
    for (const scale of [1, 2, 4, 8, 16, 32]) {
      for (const dpr of [1, 2]) {
        const img = render(grid, OWNERS, { x: 8, y: 8, scale }, dpr, { width: 24, height: 24 });
        for (let y = 0; y < img.height; y++) {
          for (let x = 0; x < img.width; x++) {
            expect(allowed.has(key(img.at(x, y))), `scale ${scale} dpr ${dpr} at ${x},${y}`).toBe(true);
          }
        }
      }
    }
  });

  it('FR-136 pixels more than 2 screen pixels from every edge show exactly the fill of their map unit', () => {
    const grid = gridFrom(
      [
        [1, 2, 4],
        [6, 4, 5],
        [2, 5, 1],
      ],
      KINDS,
    );
    const [f1, f2, f3] = [FACTION_COLORS[1]!, FACTION_COLORS[2]!, FACTION_COLORS[3]!];
    const fills: Rgb[] = [f1, f2, SEA, f3, SEA, SEA, f2, SEA, f1];
    const scale = 8; // 8 css px per unit; the view shows the 3 x 3 grid in 24 x 24
    const img = render(grid, OWNERS, { x: 1.5, y: 1.5, scale }, 1, { width: 24, height: 24 });
    for (let cy = 0; cy < 3; cy++) {
      for (let cx = 0; cx < 3; cx++) {
        for (let dy = 2; dy < 6; dy++) {
          for (let dx = 2; dx < 6; dx++) {
            expect(eq(img.at(cx * 8 + dx, cy * 8 + dy), fills[cy * 3 + cx]!), `${cx},${cy}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('FR-139 border widths in screen pixels', () => {
  it('FR-139 the width settings are 4 for faction and territory, 2 for outer and 1 for coast, sea-zone and shore', () => {
    expect(BORDER_WIDTHS).toStrictEqual(WIDTHS);
    expect(BORDER_WIDTHS.faction).toBe(4);
    expect(BORDER_WIDTHS.territory).toBe(BORDER_WIDTHS.faction);
    expect(THEME.width).toBe(BORDER_WIDTHS);
  });

  it('FR-139 the width levels are 4, 2, 1 from the widest, and every theme width is one of them', () => {
    expect(WIDTH_LEVELS).toStrictEqual([4, 2, 1]);
    for (const [cls, w] of Object.entries(THEME.width)) {
      expect(WIDTH_LEVELS as readonly number[], cls).toContain(w);
    }
  });

  for (const cls of ['faction', 'coast', 'sea-zone', 'outer', 'shore'] as const) {
    it(`FR-139 a ${cls} line is ${WIDTHS[cls]} screen pixel(s) wide, centred on the edge, at scales 0.5 to 32 and DPR 1 and 2`, () => {
      const [a, b] = PAIRS[cls];
      for (const vertical of [true, false]) {
        const grid = halves(a, b, vertical);
        for (const scale of SCALES) {
          for (const dpr of [1, 2]) {
            const vp = vertical ? VP : { width: 8, height: 20 };
            const cam = { x: 32, y: 32, scale };
            const img = render(grid, OWNERS, cam, dpr, vp);
            const edge = ((vertical ? vp.width : vp.height) / 2) * dpr;
            for (const line of [0, 2, 5]) {
              const run = runOf(img, BORDER_COLORS[cls as Exclude<BorderClass, 'territory'>], line, vertical);
              const label = `${cls} ${vertical ? 'vertical' : 'horizontal'} scale ${scale} dpr ${dpr} line ${line}`;
              expect(run.length, label).toBe(WIDTHS[cls] * dpr);
              expect(run[run.length - 1]! - run[0]! + 1, `${label} contiguous`).toBe(run.length);
              // A 1 css px line on an edge exactly on a pixel boundary sits half a pixel to one side.
              const centre = (run[0]! + run[run.length - 1]! + 1) / 2;
              expect(Math.abs(centre - edge), `${label} centred`).toBeLessThanOrEqual(0.5);
            }
          }
        }
      }
    });
  }

  it('FR-139 the width stays within 0.5 screen pixel when the edge falls between device pixels', () => {
    for (const cls of ['faction', 'coast'] as const) {
      const [a, b] = PAIRS[cls];
      for (const scale of [1, 4, 16]) {
        for (const shift of [0.13, 0.37, 0.5]) {
          const img = render(halves(a, b, true), OWNERS, { x: 32 + shift, y: 32, scale });
          const run = runOf(img, BORDER_COLORS[cls], 3, true);
          expect(Math.abs(run.length - WIDTHS[cls]), `${cls} ${scale} ${shift}`).toBeLessThanOrEqual(0.5);
          const edge = 10 - shift * scale;
          expect(Math.abs((run[0]! + run[run.length - 1]! + 1) / 2 - edge), `${cls} ${scale} ${shift}`).toBeLessThanOrEqual(0.5);
        }
      }
    }
  });

  it('FR-139 a 1 pixel line on an edge exactly on a pixel boundary is still 1 pixel at scales that are not powers of two', () => {
    for (const scale of [3, 5, 6, 7, 9, 10, 12, 20, 24, 28]) {
      for (const [a, b] of [PAIRS.coast, PAIRS['sea-zone'], PAIRS.shore]) {
        for (const vertical of [true, false]) {
          const vp = vertical ? VP : { width: 8, height: 20 };
          const img = render(halves(a, b, vertical), OWNERS, { x: 32, y: 32, scale }, 1, vp);
          const cls = borderClass(a, b, halves(a, b, true).fills, OWNERS)!;
          const run = runOf(img, BORDER_COLORS[cls as Exclude<BorderClass, 'territory'>], 3, vertical);
          expect(run.length, `scale ${scale} ${a}|${b} ${vertical}`).toBe(1);
        }
      }
    }
  });

  it('FR-139 the line is continuous along a straight run of many edges (no gap in any row)', () => {
    // Left column is a mix of two entries of the same type; the edge to the right entry is one straight run.
    const grid = gridOf(64, 64, (x, y) => (x < 32 ? (y % 2 === 0 ? 1 : 3) : 2), KINDS);
    for (const scale of [1, 4, 16, 32]) {
      const img = render(grid, OWNERS, { x: 32, y: 32, scale }, 1, { width: 20, height: 16 });
      for (let line = 0; line < img.height; line++) {
        expect(runOf(img, BORDER_COLORS.faction, line, true).length, `scale ${scale} row ${line}`).toBe(4);
      }
    }
  });

  it('FR-139 the territory line is 4 screen pixels wide at the maximum scale', () => {
    const grid = halves(1, 3, true);
    const fill = FACTION_COLORS[1]!;
    const line = [0, 1, 2].map((i) => Math.floor(fill[i]! * THEME.territoryLine.darken)) as Rgb;
    const expected = blend(fill, line, THEME.territoryLine.maxOpacity);
    for (const dpr of [1, 2]) {
      const img = render(grid, OWNERS, { x: 32, y: 32, scale: 32 }, dpr);
      expect(runOf(img, expected, 4, true).length).toBe(4 * dpr);
    }
  });

  it('FR-139 faction and territory bands are 4 screen pixels, centred on the edge and continuous, at scales 1 to 32 and DPR 1 and 2', () => {
    const fill = FACTION_COLORS[1]!;
    const lineColor = [0, 1, 2].map((i) => Math.floor(fill[i]! * THEME.territoryLine.darken)) as Rgb;
    for (const [cls, b] of [['faction', 2], ['territory', 3]] as const) {
      for (const vertical of [true, false]) {
        const grid = halves(1, b, vertical);
        for (const scale of [1, 3, 4, 5, 7, 8, 10, 16, 32]) {
          // A territory line is invisible at or below the fade start: measure it where it has a colour.
          if (cls === 'territory' && scale <= THEME.territoryLine.fadeStart) continue;
          const colour = cls === 'faction' ? BORDER_COLORS.faction : blend(fill, lineColor, territoryOpacity(scale, THEME.territoryLine));
          for (const dpr of [1, 2]) {
            const vp = vertical ? VP : { width: 8, height: 20 };
            const img = render(grid, OWNERS, { x: 32, y: 32, scale }, dpr, vp);
            const edge = ((vertical ? vp.width : vp.height) / 2) * dpr;
            for (const line of [0, 3, 6]) {
              const run = runOf(img, colour, line, vertical);
              const label = `${cls} ${vertical ? 'vertical' : 'horizontal'} scale ${scale} dpr ${dpr} line ${line}`;
              expect(run.length, label).toBeGreaterThanOrEqual(4 * dpr - 0.5);
              expect(run.length, label).toBeLessThanOrEqual(4 * dpr + 0.5);
              expect(run[run.length - 1]! - run[0]! + 1, `${label} contiguous`).toBe(run.length);
              expect(Math.abs((run[0]! + run[run.length - 1]! + 1) / 2 - edge), `${label} centred`).toBeLessThanOrEqual(0.5);
            }
          }
        }
      }
    }
  });

  it('FR-139 the faction and territory lines of one render are as wide as each other', () => {
    // T layout: entries 1 and 3 (same owner) on the left, entry 2 on the right.
    const t = gridOf(64, 64, (x, y) => (x < 32 ? (y < 32 ? 1 : 3) : 2), KINDS);
    const img = render(t, OWNERS, { x: 32, y: 32, scale: 16 }, 1, { width: 20, height: 20 });
    const fill = FACTION_COLORS[1]!;
    const lineColor = [0, 1, 2].map((i) => Math.floor(fill[i]! * THEME.territoryLine.darken)) as Rgb;
    const territory = blend(fill, lineColor, territoryOpacity(16, THEME.territoryLine));
    const faction = runOf(img, BORDER_COLORS.faction, 2, true);
    const horizontal = runOf(img, territory, 2, false);
    expect(faction.length).toBe(4);
    expect(horizontal.length).toBe(4);
  });

  it('FR-139 the same border has the same width in every displayed round (owner table change)', () => {
    const grid = halves(1, 2, true);
    const round0 = render(grid, OWNERS, { x: 32, y: 32, scale: 4 });
    const swapped = ownersOf({ 1: 3, 2: 1, 3: 1, 6: 2 }, 6);
    const round1 = render(grid, swapped, { x: 32, y: 32, scale: 4 });
    expect(runOf(round0, BORDER_COLORS.faction, 3, true)).toStrictEqual(runOf(round1, BORDER_COLORS.faction, 3, true));
  });
});

describe('FR-138 territory lines and absorption', () => {
  const grid = halves(1, 3, true);
  const fill = FACTION_COLORS[1]!;
  const lineColor = [0, 1, 2].map((i) => Math.floor(fill[i]! * THEME.territoryLine.darken)) as Rgb;

  it('FR-138 a territory line is invisible at scales at or below the fade start', () => {
    for (const scale of [0.5, 1, THEME.territoryLine.fadeStart]) {
      const img = render(grid, OWNERS, { x: 32, y: 32, scale });
      for (let x = 0; x < img.width; x++) expect(eq(img.at(x, 3), fill), `scale ${scale} x ${x}`).toBe(true);
    }
  });

  it('FR-138 a territory line is the darkened owner colour blended at the territory line opacity', () => {
    for (const scale of [6, 8, 10, 12, 16, 32]) {
      const alpha = territoryOpacity(scale, THEME.territoryLine);
      const img = render(grid, OWNERS, { x: 32, y: 32, scale });
      const expected = blend(fill, lineColor, alpha);
      expect(runOf(img, expected, 3, true).length, `scale ${scale}`).toBe(4);
      // Everything else on the row is the plain fill.
      let other = 0;
      for (let x = 0; x < img.width; x++) if (!eq(img.at(x, 3), fill) && !eq(img.at(x, 3), expected)) other++;
      expect(other, `scale ${scale}`).toBe(0);
    }
  });

  it('FR-138 a territory line is partly faded strictly between the fade start and the fade full scales', () => {
    const scale = (THEME.territoryLine.fadeStart + THEME.territoryLine.fadeFull) / 2;
    const alpha = territoryOpacity(scale, THEME.territoryLine);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(THEME.territoryLine.maxOpacity);
  });

  it('FR-138 absorption turns the faction border into a territory line in the same render', () => {
    const scale = 16;
    const before = render(grid2(), OWNERS, { x: 32, y: 32, scale });
    expect(runOf(before, BORDER_COLORS.faction, 3, true).length).toBe(4);
    // Same grid and same camera: only the owner table changes, entry 2 now belongs to faction 1.
    const absorbed = ownersOf({ 1: 1, 2: 1, 3: 1, 6: 3 }, 6);
    const after = render(grid2(), absorbed, { x: 32, y: 32, scale });
    expect(runOf(after, BORDER_COLORS.faction, 3, true).length).toBe(0);
    const expected = blend(FACTION_COLORS[1]!, lineColor, territoryOpacity(scale, THEME.territoryLine));
    expect(runOf(after, expected, 3, true).length).toBe(4);
    // Fills on both sides now have the absorber colour.
    expect(eq(after.at(18, 3), FACTION_COLORS[1]!)).toBe(true);
  });

  it('FR-138 the former border is painted on exactly the same pixels after an absorption, only colour and opacity differ', () => {
    const absorbed = ownersOf({ 1: 1, 2: 1, 3: 1, 6: 3 }, 6);
    const g = grid2();
    for (const dpr of [1, 2]) {
      for (const scale of [5, 8, 16, 32]) {
        const cam = { x: 32, y: 32, scale };
        const painted = (owners: readonly number[]): string[] => {
          const out: string[] = [];
          for (let y = 0; y < VP.height * dpr; y++) {
            for (let x = 0; x < VP.width * dpr; x++) {
              const s = shade(g, owners, FACTION_COLORS, THEME, cam, VP, (x + 0.5) / dpr, (y + 0.5) / dpr);
              if (s.border !== null) out.push(`${x},${y}`);
            }
          }
          return out;
        };
        const before = painted(OWNERS);
        const after = painted(absorbed);
        expect(before.length, `scale ${scale} dpr ${dpr}`).toBe(4 * dpr * VP.height * dpr);
        expect(after, `scale ${scale} dpr ${dpr}`).toStrictEqual(before);
      }
    }
    // Opaque border colour before; the darkened owner colour at the territory opacity after.
    const scale = 16;
    const a = render(g, OWNERS, { x: 32, y: 32, scale });
    const b = render(g, absorbed, { x: 32, y: 32, scale });
    expect(eq(a.at(9, 3), BORDER_COLORS.faction)).toBe(true);
    expect(eq(b.at(9, 3), blend(FACTION_COLORS[1]!, lineColor, territoryOpacity(scale, THEME.territoryLine)))).toBe(true);
  });

  it('FR-139 a faction line over a territory line wins the overlap square and both keep their width (T-junction)', () => {
    const t = gridOf(64, 64, (x, y) => (x < 32 ? (y < 32 ? 1 : 3) : 2), KINDS);
    const img = render(t, OWNERS, { x: 32, y: 32, scale: 16 }, 1, { width: 20, height: 20 });
    const territory = blend(FACTION_COLORS[1]!, lineColor, territoryOpacity(16, THEME.territoryLine));
    // Faction band: columns 8 to 11 on every row, including the rows of the territory band.
    for (let y = 0; y < 20; y++) for (let x = 8; x < 12; x++) expect(eq(img.at(x, y), BORDER_COLORS.faction), `${x},${y}`).toBe(true);
    // Territory band: rows 8 to 11, left of the faction band only.
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 20; y++) expect(eq(img.at(x, y), territory), `${x},${y}`).toBe(y >= 8 && y < 12);
    }
  });

  it('FR-139 a faction line that ends at a coast leaves the sea pixels with the 1 pixel coast line only', () => {
    // Left half entry 1; right half entry 2 above row 32 and sea (entry 4) below it.
    const g = gridOf(64, 64, (x, y) => (x < 32 ? 1 : y < 32 ? 2 : 4), KINDS);
    const img = render(g, OWNERS, { x: 32, y: 32, scale: 16 }, 1, { width: 20, height: 20 });
    // Sea pixels (right of the vertical edge, below the horizontal one) are plain sea.
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) expect(eq(img.at(x, y), SEA), `${x},${y}`).toBe(true);
    // The land side of the coast: one pixel of the coast colour, not four.
    expect(runOf(img, BORDER_COLORS.coast, 15, true)).toStrictEqual([9]);
    expect(runOf(img, BORDER_COLORS.coast, 15, true).length).toBe(1);
    // Above the junction the faction line is still four pixels wide.
    expect(runOf(img, BORDER_COLORS.faction, 3, true).length).toBe(4);
    // The coast line along the horizontal edge (land of entry 2) is one pixel tall.
    expect(runOf(img, BORDER_COLORS.coast, 15, false)).toStrictEqual([9]);
  });

  it('FR-139 a territory line yields to a coast line where they meet', () => {
    // Left: entries 1 above and 3 below (one owner); right: sea.
    const g = gridOf(64, 64, (x, y) => (x < 32 ? (y < 32 ? 1 : 3) : 4), KINDS);
    const img = render(g, OWNERS, { x: 32, y: 32, scale: 16 }, 1, { width: 20, height: 20 });
    const territory = blend(FACTION_COLORS[1]!, lineColor, territoryOpacity(16, THEME.territoryLine));
    for (const y of [3, 8, 9, 10, 11, 15]) expect(eq(img.at(9, y), BORDER_COLORS.coast), `coast at 9,${y}`).toBe(true);
    // Away from the coast the territory band is still four rows tall.
    expect(runOf(img, territory, 4, false)).toStrictEqual([8, 9, 10, 11]);
  });

  it('FR-139 a 2 map unit wide territory at scale 0.5 is fully covered by its two lines', () => {
    // Entry 2 (faction 2) is a strip of two map units between entries 1 and 6 (different owners).
    const g = gridOf(64, 64, (x) => (x < 31 ? 1 : x < 33 ? 2 : 6), KINDS);
    const img = render(g, OWNERS, { x: 32, y: 32, scale: 0.5 });
    for (let y = 0; y < img.height; y++) {
      const row = Array.from({ length: img.width }, (_, x) => img.at(x, y));
      expect(row.some((c) => eq(c, FACTION_COLORS[2]!)), `row ${y}: the strip fill shows`).toBe(false);
      // The strip pixel (screen x 9) and the pixels around it are faction line.
      expect(eq(img.at(9, y), BORDER_COLORS.faction), `row ${y}`).toBe(true);
    }
  });

  it('FR-138 at scales at or below the fade start the absorbed border disappears completely', () => {
    const absorbed = ownersOf({ 1: 1, 2: 1, 3: 1, 6: 3 }, 6);
    for (const scale of [0.5, 1, THEME.territoryLine.fadeStart]) {
      const img = render(grid2(), absorbed, { x: 32, y: 32, scale });
      for (let x = 0; x < img.width; x++) expect(eq(img.at(x, 3), FACTION_COLORS[1]!), `scale ${scale}`).toBe(true);
    }
  });

  it('FR-138 no line is drawn between two cells of the same value', () => {
    const img = render(halves(1, 1, true), OWNERS, { x: 32, y: 32, scale: 32 });
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) expect(eq(img.at(x, y), fill)).toBe(true);
  });

  it('FR-138 a faction line next to a territory line (T-junction) stays opaque and is not lightened', () => {
    // Entries 1 and 3 (same owner) on the left, one above the other; entry 2 on the right.
    const t = gridOf(64, 64, (x, y) => (x < 32 ? (y < 32 ? 1 : 3) : 2), KINDS);
    const img = render(t, OWNERS, { x: 32, y: 32, scale: 16 }, 1, { width: 20, height: 20 });
    // Pixel just left of the vertical edge and just above the horizontal edge.
    expect(eq(img.at(9, 9), BORDER_COLORS.faction)).toBe(true);
    // On the territory edge away from the junction the territory line keeps its blend.
    const expected = blend(FACTION_COLORS[1]!, lineColor, territoryOpacity(16, THEME.territoryLine));
    expect(eq(img.at(3, 10), expected) || eq(img.at(3, 9), expected)).toBe(true);
  });

  function grid2(): IndexGrid {
    return halves(1, 2, true);
  }
});

describe('FR-138 quadripoint and image edge', () => {
  it('FR-138 a quadripoint A B / C D with A and D the same owner draws only the four 4-adjacent edges', () => {
    // Cells: A=1 (faction 1), B=2 (faction 2), C=6 (faction 3), D=3 (faction 1).
    const grid = gridFrom(
      [
        [1, 2],
        [6, 3],
      ],
      KINDS,
    );
    const fillA = FACTION_COLORS[1]!;
    const allowed = new Set<string>([
      key(fillA),
      key(FACTION_COLORS[2]!),
      key(FACTION_COLORS[3]!),
      key(BORDER_COLORS.faction),
    ]);
    const vp = { width: 20, height: 20 };
    for (const dpr of [1, 2]) {
      // Camera on the corner at the maximum scale: any A-D territory line would show as a blend.
      const img = render(grid, OWNERS, { x: 1, y: 1, scale: 32 }, dpr, vp);
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) expect(allowed.has(key(img.at(x, y))), `dpr ${dpr} ${x},${y}`).toBe(true);
      }
      // The two faction lines cross at the corner, which is faction coloured.
      expect(eq(img.at(10 * dpr, 10 * dpr), BORDER_COLORS.faction)).toBe(true);
      expect(eq(img.at(10 * dpr - 1, 10 * dpr - 1), BORDER_COLORS.faction)).toBe(true);
    }
  });

  it('FR-138 a land territory touching the image edge gets an outer line 2 pixels wide, centred on the edge', () => {
    const grid = gridOf(64, 8, () => 1, KINDS);
    const img = render(grid, OWNERS, { x: 0, y: 4, scale: 1 });
    const run = runOf(img, BORDER_COLORS.outer, 4, true);
    expect(run).toStrictEqual([9, 10]);
    expect(eq(img.at(5, 4), BACKGROUND)).toBe(true);
    expect(eq(img.at(15, 4), FACTION_COLORS[1]!)).toBe(true);
  });

  it('FR-138 a sea zone touching the image edge gets a shore line 1 pixel wide', () => {
    const grid = gridOf(64, 8, () => 4, KINDS);
    const img = render(grid, OWNERS, { x: 0, y: 4, scale: 1 });
    expect(runOf(img, BORDER_COLORS.shore, 4, true).length).toBe(1);
    expect(eq(img.at(5, 4), BACKGROUND)).toBe(true);
    expect(eq(img.at(15, 4), SEA)).toBe(true);
  });
});

describe('FR-140 classes do not depend on the camera', () => {
  const pattern = gridOf(24, 24, (x, y) => [1, 2, 3, 4, 5, 6, 0][(x * 3 + y * 5 + Math.floor(x / 4)) % 7]!, KINDS);

  it('FR-140 the fill class and border class of a map point are equal after any pan', () => {
    const vp = { width: 30, height: 20 };
    for (const scale of [1, 4, 16, 32]) {
      for (const [dx, dy] of [
        [0, 0],
        [3, 0],
        [0, -2],
        [-5, 4],
      ] as const) {
        const a: Camera = { x: 12, y: 12, scale };
        const b: Camera = { x: 12 + dx, y: 12 + dy, scale };
        for (const [fx, fy] of [
          [3.5, 4.5],
          [14.5, 9.5],
          [20.5, 12.5],
          [28.5, 1.5],
        ] as const) {
          const first = shade(pattern, OWNERS, FACTION_COLORS, THEME, a, vp, fx, fy);
          // The same map point seen through the panned camera is at the shifted screen position.
          const second = shade(pattern, OWNERS, FACTION_COLORS, THEME, b, vp, fx - dx * scale, fy - dy * scale);
          expect(second, `scale ${scale} pan ${dx},${dy} at ${fx},${fy}`).toStrictEqual(first);
        }
      }
    }
  });

  it('FR-140 the class of an edge is the same at every scale', () => {
    const grid = halves(1, 2, true);
    const vp = { width: 20, height: 8 };
    for (const scale of [0.5, 1, 4, 16, 32]) {
      // A point 0.25 screen pixel left of the edge in the middle of the view.
      const s = shade(grid, OWNERS, FACTION_COLORS, THEME, { x: 32, y: 32, scale }, vp, 9.75, 4);
      expect(s.border, `scale ${scale}`).toBe('faction');
      expect(s.fill).toBe('land');
      // 4 px line: 1.75 screen pixels from the edge is inside it, 2.25 is outside, whatever the scale.
      expect(shade(grid, OWNERS, FACTION_COLORS, THEME, { x: 32, y: 32, scale }, vp, 8.25, 4).border, `scale ${scale} inside`).toBe('faction');
      expect(shade(grid, OWNERS, FACTION_COLORS, THEME, { x: 32, y: 32, scale }, vp, 7.75, 4).border, `scale ${scale} outside`).toBeNull();
      expect(shade(grid, OWNERS, FACTION_COLORS, THEME, { x: 32, y: 32, scale }, vp, 11.75, 4).border, `scale ${scale} inside right`).toBe('faction');
      expect(shade(grid, OWNERS, FACTION_COLORS, THEME, { x: 32, y: 32, scale }, vp, 12.25, 4).border, `scale ${scale} outside right`).toBeNull();
    }
  });

  it('FR-140 only the scale changes the opacity of territory lines: round, position and time do not exist for it', () => {
    expect(renderReference.length).toBe(7);
    const grid = halves(1, 3, true);
    const a = render(grid, OWNERS, { x: 32, y: 32, scale: 16 });
    const b = render(grid, OWNERS, { x: 32.0, y: 40, scale: 16 });
    expect(runOf(a, a.at(10, 3), 3, true).length).toBe(runOf(b, b.at(10, 3), 3, true).length);
  });
});

describe('FR-137 the rules read ids and kinds only', () => {
  it('FR-137 the border module does not read pixel colours or brightness to decide a class', () => {
    const code = codeOnly(bordersSource);
    expect(code).not.toMatch(/\b(?:brightness|luminance|luma|getImageData|readPixels)\b/i);
  });
});
