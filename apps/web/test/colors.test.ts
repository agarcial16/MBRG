import { describe, expect, it } from 'vitest';
import type { MapData, PresentationData, Rgb } from '@mbrg/shared';
import { assignFactionColors, directCandidates } from '../src/core/colors';
import { BACKGROUND, BORDER_COLORS, PALETTE, SEA, THEME, type BorderClass } from '../src/core/theme';
import devMapRaw from '../../../maps/dev/map.json?raw';
import devPresentationRaw from '../../../maps/dev/presentation.json?raw';

const DEV_MAP = JSON.parse(devMapRaw) as MapData;
const DEV_PRESENTATION = JSON.parse(devPresentationRaw) as PresentationData;

/** Palette hex values proposed in plan section 6, copied here on purpose (not derived from src). */
const PLAN_PALETTE = [
  '#c0504d',
  '#e8b04b',
  '#6aa84f',
  '#8e6bbf',
  '#e07b39',
  '#4bb3a7',
  '#d16fa6',
  '#a3c24a',
  '#8b5a3c',
  '#f2d65c',
  '#c98fd6',
  '#d4a373',
];

function rgb(hex: string): Rgb {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
const key = (c: Rgb): string => c.join(',');

/** Map from land entries [id, faction], sea ids and undirected links; links are written on both ends. */
function mapFrom(land: [number, number][], sea: number[], edges: [number, number][]): MapData {
  const neighbors = new Map<number, number[]>();
  for (const [id] of land) neighbors.set(id, []);
  for (const id of sea) neighbors.set(id, []);
  for (const [a, b] of edges) {
    neighbors.get(a)!.push(b);
    neighbors.get(b)!.push(a);
  }
  return {
    territories: [
      ...land.map(([id, owner]) => ({ id, owner, neighbors: neighbors.get(id)! })),
      ...sea.map((id) => ({ id, kind: 'sea' as const, neighbors: neighbors.get(id)! })),
    ],
  };
}

function presentationFor(map: MapData, preferred: Record<number, string> = {}): PresentationData {
  const owners = [...new Set(map.territories.flatMap((t) => ('owner' in t ? [t.owner] : [])))];
  return {
    factions: owners.map((id) => ({ id, name: `F${id}`, ...(preferred[id] === undefined ? {} : { color: preferred[id] }) })),
    territories: map.territories.map((t) => ({ id: t.id, name: `T${t.id}` })),
  };
}

/** Faction f owns territory f (ids 1..n). Chain: 1-2-...-n. */
function chainMap(n: number): MapData {
  const land: [number, number][] = [];
  const edges: [number, number][] = [];
  for (let i = 1; i <= n; i++) land.push([i, i]);
  for (let i = 1; i < n; i++) edges.push([i, i + 1]);
  return mapFrom(land, [], edges);
}

function colors(map: MapData, preferred: Record<number, string> = {}) {
  const result = assignFactionColors(map, presentationFor(map, preferred), THEME);
  if (!result.ok) throw new Error(`unexpected ${JSON.stringify(result.errors)}`);
  return result.value;
}

describe('FR-141 colour assignment on the dev map', () => {
  it('FR-141 the dev map gets the first five palette colours in faction order: DEU red, ESP ochre, FRA green, ITA purple, PRT orange', () => {
    const result = colors(DEV_MAP);
    expect([...result.keys()]).toStrictEqual([1, 2, 3, 4, 5]);
    expect(result.get(1)).toStrictEqual(rgb('#c0504d'));
    expect(result.get(2)).toStrictEqual(rgb('#e8b04b'));
    expect(result.get(3)).toStrictEqual(rgb('#6aa84f'));
    expect(result.get(4)).toStrictEqual(rgb('#8e6bbf'));
    expect(result.get(5)).toStrictEqual(rgb('#e07b39'));
  });

  it('FR-141 the dev map presentation names the five factions as the plan says (DEU, ESP, FRA, ITA, PRT order)', () => {
    expect(DEV_PRESENTATION.factions.map((f) => f.id)).toStrictEqual([1, 2, 3, 4, 5]);
  });

  it('FR-141 the assignment is identical on every run and takes no seed, round or camera', () => {
    const a = colors(DEV_MAP);
    const b = colors(DEV_MAP);
    expect([...a.entries()]).toStrictEqual([...b.entries()]);
    expect(assignFactionColors.length).toBe(3);
  });

});

describe('FR-141 preferred colours', () => {
  it('FR-141 a preferred colour is used exactly as given', () => {
    const map = chainMap(3);
    const result = colors(map, { 2: '#123456' });
    expect(result.get(2)).toStrictEqual([0x12, 0x34, 0x56]);
  });

  it('FR-141 a preferred colour equal to a palette colour is skipped by every other faction', () => {
    const map = chainMap(3);
    const result = colors(map, { 1: PLAN_PALETTE[0]! });
    expect(result.get(1)).toStrictEqual(rgb(PLAN_PALETTE[0]!));
    expect(result.get(2)).toStrictEqual(rgb(PLAN_PALETTE[1]!));
    expect(result.get(3)).toStrictEqual(rgb(PLAN_PALETTE[2]!));
  });

  it('FR-141 a preferred colour of a later faction is skipped by an earlier one', () => {
    const map = chainMap(3);
    const result = colors(map, { 3: PLAN_PALETTE[0]! });
    expect(result.get(1)).toStrictEqual(rgb(PLAN_PALETTE[1]!));
    expect(result.get(2)).toStrictEqual(rgb(PLAN_PALETTE[2]!));
    expect(result.get(3)).toStrictEqual(rgb(PLAN_PALETTE[0]!));
  });

  it('FR-141 a preferred colour equal to the sea or background colour is used as given', () => {
    const map = chainMap(2);
    const sea = `#${SEA.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    const background = `#${BACKGROUND.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    const result = colors(map, { 1: sea, 2: background });
    expect(result.get(1)).toStrictEqual(SEA);
    expect(result.get(2)).toStrictEqual(BACKGROUND);
  });
});

describe('FR-141 step 2: colours reused by factions that cannot be direct candidates', () => {
  it('FR-141 the 13th faction reuses the first colour when only a far faction has it', () => {
    const result = colors(chainMap(13));
    for (let i = 1; i <= 12; i++) expect(result.get(i), `faction ${i}`).toStrictEqual(rgb(PLAN_PALETTE[i - 1]!));
    // Its only direct candidate is faction 12 (last palette colour): the first colour is free.
    expect(result.get(13)).toStrictEqual(rgb(PLAN_PALETTE[0]!));
  });

  it('FR-141 step 2 skips the preferred colour of a direct candidate but not of a far faction', () => {
    // Faction 1 prefers palette colour 0: factions 2..13 compete for the 11 remaining colours.
    const preferred = { 1: PLAN_PALETTE[0]! };
    const far = colors(chainMap(13), preferred);
    expect(far.get(13)).toStrictEqual(rgb(PLAN_PALETTE[0]!));

    // Now faction 13 also touches faction 1: that preferred colour is out, the next free one is used.
    const map = mapFrom(
      Array.from({ length: 13 }, (_, i): [number, number] => [i + 1, i + 1]),
      [],
      [...Array.from({ length: 12 }, (_, i): [number, number] => [i + 1, i + 2]), [13, 1]],
    );
    const near = colors(map, preferred);
    expect(near.get(13)).toStrictEqual(rgb(PLAN_PALETTE[1]!));
  });

  it('FR-141 step 2 also respects a candidate reached through a shared sea zone', () => {
    // Faction 13 touches only the sea zone 100; faction 12 and faction 11 touch it too.
    const land = Array.from({ length: 13 }, (_, i): [number, number] => [i + 1, i + 1]);
    const edges: [number, number][] = [
      [13, 100],
      [12, 100],
      [11, 100],
    ];
    const result = colors(mapFrom(land, [100], edges));
    // Colours of 11 and 12 are palette 10 and 11; the first free colour is palette 0.
    expect(result.get(13)).toStrictEqual(rgb(PLAN_PALETTE[0]!));
    // Faction 1 is not a candidate of 13, so touching 1 as well removes palette 0.
    const withOne = colors(mapFrom(land, [100], [...edges, [1, 100]]));
    expect(withOne.get(13)).toStrictEqual(rgb(PLAN_PALETTE[1]!));
  });

  it('FR-141 a faction two sea hops away is not a direct candidate, so its colour may be reused', () => {
    const land = Array.from({ length: 13 }, (_, i): [number, number] => [i + 1, i + 1]);
    // 13 -- 100 -- 101 -- 1: faction 1 is reached by widening only.
    const edges: [number, number][] = [
      [13, 100],
      [100, 101],
      [101, 1],
    ];
    const result = colors(mapFrom(land, [100, 101], edges));
    expect(result.get(13)).toStrictEqual(rgb(PLAN_PALETTE[0]!));
  });

  it('FR-141 palette-exhausted names the faction whose land neighbours use every palette colour', () => {
    const land = Array.from({ length: 13 }, (_, i): [number, number] => [i + 1, i + 1]);
    const edges = Array.from({ length: 12 }, (_, i): [number, number] => [13, i + 1]);
    const map = mapFrom(land, [], edges);
    const result = assignFactionColors(map, presentationFor(map), THEME);
    expect(result).toStrictEqual({ ok: false, errors: [{ kind: 'palette-exhausted', faction: 13 }] });
  });

  it('FR-141 palette-exhausted also happens when the neighbours are reached through one shared sea zone', () => {
    const land = Array.from({ length: 13 }, (_, i): [number, number] => [i + 1, i + 1]);
    const edges = Array.from({ length: 13 }, (_, i): [number, number] => [i + 1, 100]);
    const map = mapFrom(land, [100], edges);
    const result = assignFactionColors(map, presentationFor(map), THEME);
    expect(result).toStrictEqual({ ok: false, errors: [{ kind: 'palette-exhausted', faction: 13 }] });
  });

  it('FR-141 the first faction without a free colour is the one reported (faction order)', () => {
    const land = Array.from({ length: 14 }, (_, i): [number, number] => [i + 1, i + 1]);
    // Everybody touches everybody through one sea zone: faction 13 is the first without a colour.
    const edges = Array.from({ length: 14 }, (_, i): [number, number] => [i + 1, 100]);
    const map = mapFrom(land, [100], edges);
    const result = assignFactionColors(map, presentationFor(map), THEME);
    expect(result).toStrictEqual({ ok: false, errors: [{ kind: 'palette-exhausted', faction: 13 }] });
  });
});

describe('FR-141 direct candidates at round 0 (002 definition)', () => {
  it('FR-141 land neighbours of another owner and owners of land touching a shared sea zone are candidates', () => {
    // 1(f1) - 2(f2); 3(f3) touches sea 100 with 1(f1); 4(f4) is isolated.
    const map = mapFrom(
      [
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
      ],
      [100],
      [
        [1, 2],
        [1, 100],
        [3, 100],
      ],
    );
    const found = directCandidates(map);
    expect([...found.get(1)!].sort()).toStrictEqual([2, 3]);
    expect([...found.get(2)!]).toStrictEqual([1]);
    expect([...found.get(3)!]).toStrictEqual([1]);
    expect([...found.get(4)!]).toStrictEqual([]);
  });

  it('FR-141 two territories of the same faction never make the faction its own candidate', () => {
    const map = mapFrom(
      [
        [1, 1],
        [2, 1],
        [3, 2],
      ],
      [100],
      [
        [1, 2],
        [1, 100],
        [2, 100],
        [2, 3],
      ],
    );
    const found = directCandidates(map);
    expect([...found.get(1)!]).toStrictEqual([2]);
  });

  it('FR-141 a link written on one side only does not count (002 mutual links)', () => {
    const map: MapData = {
      territories: [
        { id: 1, owner: 1, neighbors: [2] },
        { id: 2, owner: 2, neighbors: [] },
      ],
    };
    const found = directCandidates(map);
    expect([...found.get(1)!]).toStrictEqual([]);
    expect([...found.get(2)!]).toStrictEqual([]);
  });
});

describe('FR-142 palette, sea, background and border colours', () => {
  const borderList = (Object.keys(BORDER_COLORS) as Exclude<BorderClass, 'territory'>[]).map((k) => BORDER_COLORS[k]);

  it('FR-142 the palette has at least 12 colours, pairwise distinct, in the order of the plan', () => {
    expect(PALETTE.length).toBeGreaterThanOrEqual(12);
    expect(new Set(PALETTE.map(key)).size).toBe(PALETTE.length);
    expect(PALETTE.slice(0, 12)).toStrictEqual(PLAN_PALETTE.map(rgb));
  });

  it('FR-142 each palette colour differs from the sea, the background and every border class colour', () => {
    const others = new Set([SEA, BACKGROUND, ...borderList].map(key));
    for (const c of PALETTE) expect(others.has(key(c)), key(c)).toBe(false);
  });

  it('FR-142 the sea colour, the background colour and the border class colours are pairwise distinct', () => {
    const all = [SEA, BACKGROUND, ...borderList];
    expect(borderList.length).toBe(5);
    expect(new Set(all.map(key)).size).toBe(all.length);
  });

  it('FR-142 every colour channel is a whole number from 0 to 255', () => {
    for (const c of [...PALETTE, SEA, BACKGROUND, ...borderList]) {
      expect(c.length).toBe(3);
      for (const v of c) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });

  it('FR-142 the theme object holds exactly these constants', () => {
    expect(THEME.palette).toBe(PALETTE);
    expect(THEME.sea).toBe(SEA);
    expect(THEME.background).toBe(BACKGROUND);
    expect(THEME.border).toBe(BORDER_COLORS);
  });
});

describe('FR-143 sea, background and near-black colours', () => {
  it('FR-143 no fill or border colour is black or near-black (channel sum above 120)', () => {
    const borders = Object.values(BORDER_COLORS);
    for (const c of [...PALETTE, SEA, BACKGROUND, ...borders]) {
      expect(c[0] + c[1] + c[2], key(c)).toBeGreaterThan(120);
    }
  });

  it('FR-143 the background is not a water colour: it is not bluish like the sea', () => {
    // Water reads as blue: blue is the largest channel. The background must not.
    expect(SEA[2]).toBeGreaterThan(SEA[0]);
    expect(SEA[2]).toBeGreaterThan(SEA[1]);
    expect(BACKGROUND[2]).toBeLessThan(Math.max(BACKGROUND[0], BACKGROUND[1]));
  });

  it('FR-143 the sea colour and background colour have the values of plan section 6', () => {
    expect(SEA).toStrictEqual(rgb('#9cc0dc'));
    expect(BACKGROUND).toStrictEqual(rgb('#bdb8aa'));
  });

  it('FR-143 the border class colours have the values of plan section 6', () => {
    expect(BORDER_COLORS).toStrictEqual({
      faction: rgb('#4a3b2c'),
      outer: rgb('#6b655a'),
      coast: rgb('#2f5573'),
      shore: rgb('#46708f'),
      'sea-zone': rgb('#7fa6c6'),
    });
  });
});
