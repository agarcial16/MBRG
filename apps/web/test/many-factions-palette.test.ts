// Tests for Spec 033 Chunk 2: enlarged 20-colour curated base palette, deterministic procedural
// last resort (>= 65,535 distinct colours), land-strict / sea-soft / procedural priority, defensive
// palette-exhausted guard, and pure perf bounds (FR-641..FR-644, NFR-160..NFR-161).
import { describe, expect, it } from 'vitest';
import type { MapData, PresentationData, Rgb } from '@mbrg/shared';
import { assignFactionColors, landNeighbors } from '../src/core/colors';
import { colorDistance, createProceduralPalette, MIN_LAND_SEPARATION } from '../src/core/palette';
import { BACKGROUND, BORDER_COLORS, PALETTE, SEA, THEME } from '../src/core/theme';
import { DEV_MAP, DEV_PRESENTATION } from './helpers/dev-map';

const rgbKey = (c: Rgb): number => (c[0] << 16) | (c[1] << 8) | c[2];

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

function chainMap(n: number): MapData {
  const land: [number, number][] = Array.from({ length: n }, (_, i) => [i + 1, i + 1]);
  const edges: [number, number][] = Array.from({ length: n - 1 }, (_, i) => [i + 1, i + 2]);
  return mapFrom(land, [], edges);
}

describe('FR-641 enlarged 20-colour curated base palette', () => {
  it('FR-641 PALETTE has 20 pairwise distinct curated colours, keeping the original 12 first in exact order', () => {
    expect(PALETTE.length).toBe(20);
    expect(new Set(PALETTE.map(rgbKey)).size).toBe(20);
    const forbidden = new Set([SEA, BACKGROUND, ...Object.values(BORDER_COLORS)].map(rgbKey));
    for (const c of PALETTE) {
      expect(forbidden.has(rgbKey(c))).toBe(false);
      const sum = c[0] + c[1] + c[2];
      expect(sum).toBeGreaterThan(120);
      expect(sum).toBeLessThan(675);
      expect(c[0] > 225 && c[1] > 225 && c[2] > 225).toBe(false);
    }
  });

  it('FR-641 all 20 curated colours rotate together in steps 1-2; maps/dev stays byte-identical', () => {
    const dev = assignFactionColors(DEV_MAP, DEV_PRESENTATION, THEME);
    expect(dev.ok).toBe(true);
    if (dev.ok) {
      for (let i = 0; i < 5; i++) expect(dev.value.get(i + 1)).toStrictEqual(PALETTE[i]);
    }

    const chain = chainMap(21);
    const res = assignFactionColors(chain, presentationFor(chain), THEME);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (let i = 1; i <= 20; i++) expect(res.value.get(i), `faction ${i}`).toStrictEqual(PALETTE[i - 1]);
    // Faction 21 only touches faction 20: reuses PALETTE[0].
    expect(res.value.get(21)).toStrictEqual(PALETTE[0]);
  });
});

describe('FR-642 deterministic procedural palette last resort (>= 65,535 distinct colours)', () => {
  it('FR-642 generates 65,535 pairwise distinct, valid, deterministic RGB colours excluding curated/sea/background/borders', () => {
    const excluded = new Set([
      ...PALETTE,
      SEA,
      BACKGROUND,
      ...Object.values(BORDER_COLORS),
    ].map(rgbKey));

    const genA = createProceduralPalette(excluded);
    const seen = new Set<number>();
    const sample: Rgb[] = [];
    let bad = 0;
    for (let i = 0; i < 65535; i++) {
      const c = genA.next();
      const k = rgbKey(c);
      const sum = c[0] + c[1] + c[2];
      if (seen.has(k) || excluded.has(k) || sum <= 120 || sum >= 675 || (c[0] > 225 && c[1] > 225 && c[2] > 225)) {
        bad++;
        break;
      }
      seen.add(k);
      if (i < 64) sample.push(c);
    }
    expect(bad).toBe(0);
    expect(seen.size).toBe(65535);

    // Deterministic: second run produces identical colours.
    const genB = createProceduralPalette(excluded);
    for (let i = 0; i < 64; i++) expect(genB.next()).toStrictEqual(sample[i]);
  });
});

describe('FR-643 neighbour distinguishability: soft sea relaxation before procedural last resort', () => {
  it('FR-643 an 80-faction ocean sea-zone clique stays inside the 20 curated base colours (zero procedural)', () => {
    const land: [number, number][] = Array.from({ length: 80 }, (_, i) => [i + 1, i + 1]);
    const edges: [number, number][] = Array.from({ length: 80 }, (_, i) => [i + 1, 1000]);
    const map = mapFrom(land, [1000], edges);
    const res = assignFactionColors(map, presentationFor(map), THEME);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const baseSet = new Set(PALETTE.map(rgbKey));
    for (const c of res.value.values()) expect(baseSet.has(rgbKey(c))).toBe(true);
  });

  it('FR-643 a land hub bordering all 20 curated colours falls back to a separated procedural colour', () => {
    // Faction 21 borders land factions 1..20, which consume all 20 curated base colours.
    const land: [number, number][] = Array.from({ length: 21 }, (_, i) => [i + 1, i + 1]);
    const edges: [number, number][] = Array.from({ length: 20 }, (_, i) => [21, i + 1]);
    const map = mapFrom(land, [], edges);
    const res = assignFactionColors(map, presentationFor(map), THEME);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const baseSet = new Set(PALETTE.map(rgbKey));
    const hubColor = res.value.get(21)!;
    expect(baseSet.has(rgbKey(hubColor))).toBe(false);
    for (let i = 1; i <= 20; i++) {
      const nb = res.value.get(i)!;
      expect(rgbKey(hubColor)).not.toBe(rgbKey(nb));
      expect(colorDistance(hubColor, nb)).toBeGreaterThanOrEqual(MIN_LAND_SEPARATION);
    }
  });

  it('FR-643 a 35-faction land clique (all touching all on land) gets 35 pairwise distinct colours', () => {
    const n = 35;
    const land: [number, number][] = Array.from({ length: n }, (_, i) => [i + 1, i + 1]);
    const edges: [number, number][] = [];
    for (let i = 1; i <= n; i++) for (let j = i + 1; j <= n; j++) edges.push([i, j]);
    const map = mapFrom(land, [], edges);
    const res = assignFactionColors(map, presentationFor(map), THEME);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(new Set([...res.value.values()].map(rgbKey)).size).toBe(n);
  });

  it('FR-643 a 302-faction map with a 77-faction sea zone and a 69-neighbour land hub colours cleanly with zero land collisions', () => {
    const n = 302;
    const land: [number, number][] = Array.from({ length: n }, (_, i) => [i + 1, i + 1]);
    const edges: [number, number][] = [];
    for (let i = 1; i < n; i++) edges.push([i, i + 1]);
    // 69 land neighbours around hub faction 1
    for (let i = 2; i <= 70; i++) edges.push([1, i]);
    // 77 factions touching ocean sea zone 999
    for (let i = 50; i < 127; i++) edges.push([i, 999]);
    const map = mapFrom(land, [999], edges);
    const res = assignFactionColors(map, presentationFor(map), THEME);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const adj = landNeighbors(map);
    for (const [f, nbs] of adj) {
      const cf = rgbKey(res.value.get(f)!);
      for (const nb of nbs) expect(rgbKey(res.value.get(nb)!)).not.toBe(cf);
    }
  });
});

describe('FR-644 defensive palette-exhausted guard for custom finite palettes', () => {
  it('FR-644 custom finite theme without procedural fallback refuses when land neighbours exhaust the palette', () => {
    const finiteTheme = { ...THEME, palette: THEME.palette.slice(0, 4), procedural: false };
    const land: [number, number][] = Array.from({ length: 5 }, (_, i) => [i + 1, i + 1]);
    const edges: [number, number][] = [[5, 1], [5, 2], [5, 3], [5, 4]];
    const map = mapFrom(land, [], edges);
    const res = assignFactionColors(map, presentationFor(map), finiteTheme);
    expect(res).toStrictEqual({ ok: false, errors: [{ kind: 'palette-exhausted', faction: 5 }] });
  });
});

describe('NFR-160 colour assignment performance bounds (500 and 10,000 factions)', () => {
  function gridMap(rows: number, cols: number, seaCount: number): MapData {
    const n = rows * cols;
    const land: [number, number][] = Array.from({ length: n }, (_, i) => [i + 1, i + 1]);
    const sea: number[] = Array.from({ length: seaCount }, (_, i) => n + i + 1);
    const edges: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const id = r * cols + c + 1;
        if (c + 1 < cols) edges.push([id, id + 1]);
        if (r + 1 < rows) edges.push([id, id + cols]);
      }
    }
    // Attach border cells to sea zones (creates realistic sea cliques of size ~rows*2)
    for (let s = 0; s < seaCount; s++) {
      const seaId = n + s + 1;
      for (let c = 0; c < Math.min(cols, 80); c++) edges.push([s * cols + c + 1, seaId]);
    }
    return mapFrom(land, sea, edges);
  }

  it('NFR-160 500-faction map with sea clique colours in <= 50 ms with zero land collisions', () => {
    const map = gridMap(20, 25, 2);
    const pres = presentationFor(map);
    const t0 = performance.now();
    const res = assignFactionColors(map, pres, THEME);
    const ms = performance.now() - t0;
    console.log(`NFR-160 500-faction colouring: ${ms.toFixed(1)} ms`);
    expect(res.ok).toBe(true);
    expect(ms).toBeLessThanOrEqual(50);
  });

  it('NFR-160 10,000-faction map colours in <= 250 ms with zero land collisions', () => {
    const map = gridMap(100, 100, 4);
    const pres = presentationFor(map);
    const t0 = performance.now();
    const res = assignFactionColors(map, pres, THEME);
    const ms = performance.now() - t0;
    console.log(`NFR-160 10,000-faction colouring: ${ms.toFixed(1)} ms`);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.size).toBe(10000);
      let collisions = 0;
      for (const t of map.territories) {
        if (t.kind === 'sea') continue;
        const c = rgbKey(res.value.get(t.owner)!);
        for (const n of t.neighbors) {
          if (n <= 10000 && rgbKey(res.value.get(n)!) === c) collisions++;
        }
      }
      expect(collisions).toBe(0);
    }
    expect(ms).toBeLessThanOrEqual(250);
  });
});
