import { describe, expect, it } from 'vitest';
import type { PieceEntry } from '../src/core/pieces';
import { WATER } from '../src/core/rasterize';
import { makeGapFill } from '../src/importer/gap-fill';
import { belowMinSize, cleanPieces, type TerritoryInfo } from '../src/importer/min-size';
import { assignSea } from '../src/importer/sea-sources';
import type { View, ViewSet } from '../src/importer/views';
import { cleanupDirect } from './helpers/cleanup-direct';

/** A raster from rows of text: W water, . other land, digits entries (1..9), letters sea zones a=11, b=12, ... */
function grid(rows: string[]): { width: number; pixels: Uint32Array } {
  const width = rows.length;
  const pixels = new Uint32Array(width * width);
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error('the fixture must be square');
    [...row].forEach((ch, x) => {
      pixels[y * width + x] = ch === 'W' ? WATER : ch === '.' ? 0 : /\d/.test(ch) ? Number(ch) : 11 + ch.charCodeAt(0) - 97;
    });
  });
  return { width, pixels };
}
function show(pixels: Uint32Array, width: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < width; y++) {
    rows.push([...pixels.subarray(y * width, (y + 1) * width)].map((v) => (v === WATER ? 'W' : v === 0 ? '.' : v >= 11 ? String.fromCharCode(97 + v - 11) : String(v))).join(''));
  }
  return rows;
}

const identity = (width: number): ViewSet => {
  const main: View = { kind: 'main', projection: 'equal-earth', lon0: 0, lat0: 0, frame: { west: 0, north: 0, side: width }, side: width, plane: () => [0, 0], toUV: (lon, lat) => [lon, lat] };
  return { width, main, mainUnits: [], insets: [] };
};
const isLand = (value: number): boolean => value >= 1 && value <= 9;

/** The sea pass (one zone, 'a' pixels are its sources) with the gap fill wired between the isolation and the zones. */
function sea(rows: string[], gapFill: number | undefined) {
  const { width, pixels } = grid(rows);
  const fill = gapFill === undefined ? undefined : makeGapFill(width, gapFill, isLand);
  const r = assignSea({ views: identity(width), pixels, zones: [{ id: 11 }], ...(fill === undefined ? {} : { between: fill.between }) });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return { rows: show(r.value.pixels, width), enclosed: r.value.enclosed, filled: fill?.filled ?? [] };
}

describe('FR-603 the gap fill', () => {
  // lake A: one pixel at (2, 2) inside land 2; lake B: 2 x 2 at (5..6, 4..5), mostly touching land 3
  const fixed = ['aWWWWWWWW', 'W2222222W', 'W2W22222W', 'W2222332W', 'W2222WW3W', 'W2222WW3W', 'W2222333W', 'W2222222W', 'WWWWWWWWW'];

  it('FR-603 gives each enclosed set of fewer than G pixels that touches land, whole, to the land with the highest contact count', () => {
    const r = sea(fixed, 5);
    expect(r.rows).toStrictEqual(['aaaaaaaaa', 'a2222222a', 'a2222222a', 'a2222332a', 'a2222333a', 'a2222333a', 'a2222333a', 'a2222222a', 'aaaaaaaaa']);
    // sets are found in row-major order of their first pixel; lake B has 6 contacts with 3 and 2 with 2
    expect(r.filled).toStrictEqual([{ pixels: 1, territory: 2 }, { pixels: 4, territory: 3 }]);
    expect(r.enclosed).toStrictEqual([]);
  });

  it('FR-603 leaves a set of G pixels or more to the sea pass: fewer than G fills, exactly G does not', () => {
    const r = sea(fixed, 4);
    // lake A has 1 pixel and is filled; lake B has 4 pixels, not fewer than G = 4, and joins the zone
    expect(r.rows).toStrictEqual(['aaaaaaaaa', 'a2222222a', 'a2222222a', 'a2222332a', 'a2222aa3a', 'a2222aa3a', 'a2222333a', 'a2222222a', 'aaaaaaaaa']);
    expect(r.filled).toStrictEqual([{ pixels: 1, territory: 2 }]);
    expect(r.enclosed).toStrictEqual([{ pixels: 4, zone: 11 }]);
  });

  it('FR-603 never fills without a gap fill: no water becomes land, as in 003b', () => {
    const r = sea(fixed, undefined);
    expect(r.rows).toStrictEqual(['aaaaaaaaa', 'a2222222a', 'a2a22222a', 'a2222332a', 'a2222aa3a', 'a2222aa3a', 'a2222333a', 'a2222222a', 'aaaaaaaaa']);
    expect(r.filled).toStrictEqual([]);
    expect(r.enclosed).toStrictEqual([{ pixels: 1, zone: 11 }, { pixels: 4, zone: 11 }]);
  });

  it('FR-603 fills only what touches a land territory: a set that touches only other land stays water for the sea pass', () => {
    const only = ['aWWWWW', 'W....W', 'W.W..W', 'W....W', 'WWWWWW', 'WWWWWW'];
    const r = sea(only, 10);
    expect(r.rows[2]).toBe('a.a..a');
    expect(r.filled).toStrictEqual([]);
    // one land pixel among the other land is enough
    const some = ['aWWWWW', 'W....W', 'W.W4.W', 'W....W', 'WWWWWW', 'WWWWWW'];
    const filled = sea(some, 10);
    expect(filled.rows[2]).toBe('a.44.a');
    expect(filled.filled).toStrictEqual([{ pixels: 1, territory: 4 }]);
  });

  it('FR-603 counts the contact from every side of a set: land only above, only below, only left, only right', () => {
    const lake = (up: string, down: string, left: string, right: string) => [
      'aWWWWW',
      `WW.${up}.W`,
      `WW${left}W${right}W`,
      `WW.${down}.W`,
      'WWWWWW',
      'WWWWWW',
    ];
    expect(sea(lake('4', '.', '.', '.'), 10).filled).toStrictEqual([{ pixels: 1, territory: 4 }]);
    expect(sea(lake('.', '4', '.', '.'), 10).filled).toStrictEqual([{ pixels: 1, territory: 4 }]);
    expect(sea(lake('.', '.', '4', '.'), 10).filled).toStrictEqual([{ pixels: 1, territory: 4 }]);
    expect(sea(lake('.', '.', '.', '4'), 10).filled).toStrictEqual([{ pixels: 1, territory: 4 }]);
  });

  it('FR-603 gives a set to the first territory in map order when the contact counts tie', () => {
    const tie = (left: string, right: string) => ['aWWWWW', 'WW...W', `WW${left}W${right}W`, 'WW...W', 'WWWWWW', 'WWWWWW'];
    expect(sea(tie('5', '4'), 10).rows[2]).toBe('aa544a');
    expect(sea(tie('4', '5'), 10).rows[2]).toBe('aa445a');
  });

  it('FR-603 fills before any zone is assigned: a filled set is land, never water of a zone, and is not an enclosed set', () => {
    const r = sea(fixed, 2);
    expect(r.rows[2]).toBe('a2222222a');
    expect(r.filled.map((f) => f.pixels)).toStrictEqual([1]);
    expect(r.enclosed.map((e) => e.pixels)).toStrictEqual([4]);
  });
});

describe('FR-604 the minimum piece', () => {
  const territories: TerritoryInfo[] = [
    { id: 1, key: 'A', name: 'Alfa' },
    { id: 2, key: 'B', name: 'Beta' },
    { id: 3, key: 'C', name: 'Gamma' },
    { id: 11, key: 'S', name: 'Gulf' },
  ];
  const rows = ['111..2', '111...', '111.22', '......', 'aa....', '......'];

  it('FR-604 lists every territory with no piece of S pixels, with its pixels and largest piece, all at once, in map order', () => {
    const { width, pixels } = grid(rows);
    expect(belowMinSize(width, pixels, territories, 3)).toStrictEqual([
      { kind: 'territory-below-min-size', territory: 'B', name: 'Beta', pixels: 3, largest: 2 },
      { kind: 'territory-below-min-size', territory: 'C', name: 'Gamma', pixels: 0, largest: 0 },
      { kind: 'territory-below-min-size', territory: 'S', name: 'Gulf', pixels: 2, largest: 2 },
    ]);
    // a piece of exactly S is enough
    expect(belowMinSize(width, pixels, territories, 2).map((e) => e.territory)).toStrictEqual(['C']);
    expect(belowMinSize(width, pixels, territories, 1).map((e) => e.territory)).toStrictEqual(['C']);
    expect(belowMinSize(width, pixels, territories, 10).map((e) => e.territory)).toStrictEqual(['A', 'B', 'C', 'S']);
  });

  it('FR-604 fails before any cleanup: the whole result is the list, and the raster is untouched', () => {
    const { width, pixels } = grid(rows);
    const before = pixels.slice();
    const entries: PieceEntry[] = [{ id: 1, kind: 'land', owner: 1 }, { id: 2, kind: 'land', owner: 1 }, { id: 3, kind: 'land', owner: 2 }, { id: 11, kind: 'sea' }];
    const r = cleanPieces(width, pixels, entries, territories, 3);
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.errors.map((e) => e.kind)).toStrictEqual(['territory-below-min-size', 'territory-below-min-size', 'territory-below-min-size']);
    expect(pixels).toStrictEqual(before);
  });

  it('FR-604 counts the pieces of a territory by 4-connection, never its pixels together', () => {
    const { width, pixels } = grid(['11.11', '.....', '.....', '.....', '.....'].map((r) => r.padEnd(5, '.')));
    const info: TerritoryInfo[] = [{ id: 1, key: 'A', name: 'Alfa' }];
    expect(belowMinSize(width, pixels, info, 3)).toStrictEqual([{ kind: 'territory-below-min-size', territory: 'A', name: 'Alfa', pixels: 4, largest: 2 }]);
  });
});

describe('FR-604 the cleanup of small pieces after the check', () => {
  const entries: PieceEntry[] = [{ id: 1, kind: 'land', owner: 1 }, { id: 2, kind: 'land', owner: 1 }, { id: 3, kind: 'land', owner: 2 }];
  const info: TerritoryInfo[] = [{ id: 1, key: 'A', name: 'Alfa' }, { id: 2, key: 'B', name: 'Beta' }, { id: 3, key: 'C', name: 'Gamma' }];
  const base = ['11112222', '11112122', '11312222', '11112222', '11112222', '33333333', '33333333', '33333333'];

  it('FR-117 reassigns every piece below S, smallest first, to the neighbour with the most contact', () => {
    const { width, pixels } = grid(base);
    const r = cleanPieces(width, pixels, entries, info, 3);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(show(r.value.pixels, width)).toStrictEqual(['11112222', '11112222', '11112222', '11112222', '11112222', '33333333', '33333333', '33333333']);
    expect(r.value.reassigned).toStrictEqual([{ entry: 1, pixels: 1, to: 2 }, { entry: 3, pixels: 1, to: 1 }]);
  });

  it('FR-117 gives a tie to the first entry in map order', () => {
    // the speck at (3, 2) has 1 on its left and above, 2 on its right and below
    const rows = ['11112222', '11112222', '11132222', '11122222', '11112222', '33333333', '33333333', '33333333'];
    const { width, pixels } = grid(rows);
    const first = cleanPieces(width, pixels, entries, info, 3);
    const second = cleanPieces(width, pixels, [entries[1]!, entries[0]!, entries[2]!], info, 3);
    expect(first.ok && show(first.value.pixels, width)[2]).toBe('11112222');
    expect(second.ok && show(second.value.pixels, width)[2]).toBe('11122222');
  });

  it('FR-117 gives results identical to the literal loop of the 003b reference, on fixtures with ties and cascades', () => {
    const fixtures: { rows: string[]; size: number }[] = [
      { rows: base, size: 3 },
      { rows: ['11112222', '11112222', '11132222', '11122222', '11112222', '33333333', '33333333', '33333333'], size: 3 },
      // a piece of 2 pixels of entry 2 inside entry 1 beside a speck of entry 3: both go to 1, one after the other
      { rows: ['11111222', '11221222', '11321222', '11111222', '11111222', '33333333', '33333333', '33333333'], size: 3 },
      { rows: ['11111111', '11111111', '11122111', '11122111', '11111111', '33333333', '33333333', '22222222'], size: 5 },
    ];
    for (const { rows, size } of fixtures) {
      const { width, pixels } = grid(rows);
      const mine = cleanPieces(width, pixels, entries, info, size);
      const direct = cleanupDirect(width, pixels, entries, size);
      expect(mine.ok).toBe(true);
      expect(direct.ok).toBe(true);
      if (mine.ok && direct.ok) {
        expect(mine.value.pixels).toStrictEqual(direct.value.pixels);
        expect(mine.value.reassigned).toStrictEqual(direct.value.reassigned);
      }
    }
  });

  it('FR-117 gives results identical to the reference on generated fields with many specks', () => {
    for (const salt of [1, 2, 3, 4, 5, 6]) {
      const width = 24;
      const pixels = new Uint32Array(width * width);
      for (let y = 0; y < width; y++) {
        for (let x = 0; x < width; x++) {
          const block = (y < 12 ? 0 : 2) + (x < 12 ? 0 : 1) + 1;
          const h = ((x * 73856093) ^ (y * 19349663) ^ (salt * 83492791)) >>> 0;
          pixels[y * width + x] = (h >>> 5) % 9 === 0 ? 1 + ((h >>> 11) % 4) : block;
        }
      }
      const four: PieceEntry[] = [1, 2, 3, 4].map((id) => ({ id, kind: 'land', owner: id }));
      const names: TerritoryInfo[] = [1, 2, 3, 4].map((id) => ({ id, key: `T${id}`, name: `N${id}` }));
      const mine = cleanPieces(width, pixels, four, names, 4);
      const direct = cleanupDirect(width, pixels, four, 4);
      expect(mine.ok && direct.ok, `salt ${salt}`).toBe(true);
      if (mine.ok && direct.ok) {
        expect(mine.value.pixels).toStrictEqual(direct.value.pixels);
        expect(mine.value.reassigned).toStrictEqual(direct.value.reassigned);
        expect(mine.value.reassigned.length).toBeGreaterThan(5);
      }
    }
  });

  it('FR-117 keeps background and returns a new raster', () => {
    const { width, pixels } = grid(['111...', '111...', '111...', '......', '......', '......']);
    const before = pixels.slice();
    const r = cleanPieces(width, pixels, [{ id: 1, kind: 'land', owner: 1 }], [{ id: 1, key: 'A', name: 'Alfa' }], 3);
    expect(r.ok && r.value.pixels).toStrictEqual(before);
    expect(r.ok && r.value.pixels === pixels).toBe(false);
  });
});
