import { describe, expect, it } from 'vitest';

import { detectAdjacency } from '../src/adjacency.js';
import { detectFlatColorRegions } from '../src/flatColors.js';
import { rasterFromArt } from './fixtures/raster.js';

const PAL = { R: '#ff0000', G: '#00ff00', B: '#0000ff', '.': null } as const;

function map(art: string[], maxGap: number) {
  const img = rasterFromArt(art, PAL);
  const flat = detectFlatColorRegions(img, { minRegionArea: 1, smallRegionRatio: 0, sea: 'transparent' });
  return { flat, adjacency: detectAdjacency(flat, { maxGap }) };
}

const asColors = (flat: ReturnType<typeof detectFlatColorRegions>, index: number): string =>
  `#${(flat.regions[index]?.color ?? 0).toString(16).padStart(6, '0')}`;

/** Colour pairs the adjacency graph links, sorted so assertions are stable. */
function pairs(flat: ReturnType<typeof detectFlatColorRegions>, adjacency: ReturnType<typeof detectAdjacency>): string[] {
  const out = new Set<string>();
  for (const [index, list] of adjacency.neighbors) {
    for (const other of list) {
      if (index < other) {
        out.add(`${asColors(flat, index)}|${asColors(flat, other)}`);
      }
    }
  }
  return [...out].sort();
}

describe('el puente de contornos finos', () => {
  it('sin puente, dos provincias separadas por una línea son islas', () => {
    // The state this feature exists to fix: a dark outline between provinces is
    // not land, so without help the whole map is islands.
    const { flat, adjacency } = map(['RRR.GGG'], 0);
    expect(adjacency.islands).toHaveLength(2);
    expect(pairs(flat, adjacency)).toEqual([]);
  });

  it('con puente, una línea de 1 px las vuelve vecinas', () => {
    const { flat, adjacency } = map(['RRR.GGG'], 1);
    expect(adjacency.islands).toHaveLength(0);
    expect(pairs(flat, adjacency)).toEqual(['#00ff00|#ff0000']);
    // ...and it says the border was bridged rather than shared.
    expect(adjacency.bridged).toHaveLength(1);
  });

  it('aguanta el ancho de línea que usan los mapas de verdad', () => {
    // Three pixels of outline, bridged with the default gap.
    const { flat, adjacency } = map(['RRR...GGG'], 3);
    expect(adjacency.islands).toHaveLength(0);
    expect(pairs(flat, adjacency)).toEqual(['#00ff00|#ff0000']);
  });

  it('una franja más ancha que el máximo no se une', () => {
    // Four pixels of sea is a strait, not an outline.
    const { flat, adjacency } = map(['RRR....GGG'], 3);
    expect(adjacency.islands).toHaveLength(2);
    expect(pairs(flat, adjacency)).toEqual([]);
  });

  it('funciona también en vertical', () => {
    const { flat, adjacency } = map(['RRR', '...', 'GGG'], 3);
    expect(adjacency.islands).toHaveLength(0);
    expect(pairs(flat, adjacency)).toEqual(['#00ff00|#ff0000']);
  });

  it('una línea en diagonal también se une, porque es una escalera', () => {
    // A 45° outline is a staircase, and every step of it is a 1 px gap in some
    // direction, so the line scans find it without needing a wavefront.
    const { flat, adjacency } = map(['RR..', 'GG..', '..BB', '..BB'], 1);
    expect(pairs(flat, adjacency)).toContain('#00ff00|#ff0000');
  });

  it('no inventa fronteras a través del mar abierto', () => {
    // The rows and columns of open water are much wider than any outline, so
    // nothing links across them.
    const { flat, adjacency } = map(
      [
        'RRRRRRRR',
        '........',
        '........',
        '........',
        '........',
        '........',
        '........',
        'GGGGGGGG',
      ],
      3,
    );
    expect(adjacency.islands).toHaveLength(2);
    expect(pairs(flat, adjacency)).toEqual([]);
  });

  it('las fronteras ya compartidas no se cuentan como puenteadas', () => {
    // Touching pixels is a real border; reporting it as bridged too would make
    // the "joined across an outline" list as long as the map.
    const { adjacency } = map(['RRRGGG'], 3);
    expect(adjacency.bridged).toEqual([]);
  });

  it('une solo a la distancia exacta y no una más', () => {
    expect(map(['RRR...GGG'], 2).adjacency.islands).toHaveLength(2);
    expect(map(['RRR...GGG'], 3).adjacency.islands).toHaveLength(0);
  });

  it('mantiene la simetría y la lista ordenada', () => {
    const { flat, adjacency } = map(['RRR..GGG', 'BBB.....'], 2);
    for (const [index, list] of adjacency.neighbors) {
      expect([...list]).toEqual([...list].sort((a, b) => a - b));
      for (const other of list) {
        expect(adjacency.neighbors.get(other)).toContain(index);
      }
    }
    expect(flat.regions).toHaveLength(3);
  });

  it('una isla rodeada de mar sigue siendo isla', () => {
    const { adjacency } = map(['....', '.R..', '....'], 3);
    expect(adjacency.islands).toHaveLength(1);
  });
});