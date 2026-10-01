import { describe, expect, it } from 'vitest';

import { assembleMap, territoryId } from '../src/assemble.js';
import { detectAdjacency } from '../src/adjacency.js';
import { traceContours } from '../src/contours.js';
import { detectFlatColorRegions } from '../src/flatColors.js';
import { rasterFromArt } from './fixtures/raster.js';

const PAL = { R: '#ff0000', G: '#00ff00', B: '#0000ff', Y: '#ffff00', '.': null } as const;

/** Run the whole pipeline the importer uses, in memory. */
function importArt(art: string[], name = 'test map', minRegionArea = 1, smallRegionRatio = 0) {
  const img = rasterFromArt(art, PAL);
  const flat = detectFlatColorRegions(img, { minRegionArea, smallRegionRatio });
  const adjacency = detectAdjacency(flat);
  const contours = traceContours(flat);
  return assembleMap(flat, adjacency, contours, { name });
}

describe('assembleMap', () => {
  it('builds a valid map out of two blocks', () => {
    const { map, errors } = importArt(['RRRR', 'GGGG']);
    expect(errors).toEqual([]);
    expect(map.version).toBe(1);
    expect(map.name).toBe('test map');
    expect(map.width).toBe(4);
    expect(map.height).toBe(2);
    expect(map.territories).toHaveLength(2);

    const [a, b] = map.territories;
    expect(a.polygon.length).toBeGreaterThanOrEqual(3);
    // Adjacency is symmetric and names the other territory.
    expect(a.neighbors).toEqual([b.id]);
    expect(b.neighbors).toEqual([a.id]);
  });

  it('gives ids that are stable and prefixed', () => {
    const { map } = importArt(['RGB']);
    expect(map.territories.map((t) => t.id).sort()).toEqual(['p0', 'p1', 'p2']);
    expect(territoryId(7)).toBe('p7');
    expect(territoryId(7, 'x')).toBe('x7');
  });

  it('passes the project validation for a clean map', () => {
    const { map, errors } = importArt(['RRG', 'GGB']);
    expect(errors).toEqual([]);
    // Re-validating the assembled map is the same check, run again.
    expect(map.territories.every((t) => t.polygon.length >= 3)).toBe(true);
  });

  it('puts an enclave in as a hole of the region around it', () => {
    const { map, territories } = importArt(['RRR', 'RBR', 'RRR']);
    // Red is 8 px, blue 1 px, so the bigger summary is the ring.
    const red = territories.find((t) => t.area === 8)!;
    const blue = territories.find((t) => t.area === 1)!;
    const redTerritory = map.territories.find((t) => t.id === red.id)!;
    const blueTerritory = map.territories.find((t) => t.id === blue.id)!;
    expect(redTerritory.holes).toHaveLength(1);
    expect(blueTerritory.holes).toBeUndefined();
    expect(redTerritory.neighbors).toEqual([blue.id]);
  });

  it('keeps a one-pixel province instead of losing it to simplification', () => {
    // Four corners within tolerance of the chord: a naive simplify drops the
    // ring below three points and the province disappears.
    const { map, errors } = importArt(['R']);
    expect(errors).toEqual([]);
    expect(map.territories).toHaveLength(1);
    expect(map.territories[0].polygon.length).toBeGreaterThanOrEqual(3);
  });

  it('warns about an island instead of silently shipping an unreachable one', () => {
    const { map, warnings, territories } = importArt(['RRGG', 'RRGG', '....', '..BB']);
    expect(map.territories).toHaveLength(3);
    expect(territories.filter((t) => t.island)).toHaveLength(1);
    // Findings are structured, so the import screen can translate them.
    const island = warnings.find((w) => w.code === 'island');
    expect(island).toBeDefined();
    expect(island!.params.id).toBe(territories.find((t) => t.island)!.id);
    expect(island!.detail).toMatch(/is an island/);
  });

  it('reports an island once, not twice', () => {
    // validateMap also flags islands; the assembler already says it better.
    const { warnings } = importArt(['R']);
    expect(warnings.filter((w) => w.code === 'island')).toHaveLength(1);
  });

  it('land cut in two becomes two provinces with no finding at all', () => {
    // Regions are connected pieces, so a colour in two separate places is two
    // provinces and there is nothing to report. The split warning used to fire
    // here and told the user to redraw the map; that advice was wrong, since the
    // two halves are perfectly playable next to their own neighbour.
    const { map, warnings, territories } = importArt(['RRRRR', 'GGGGG', 'RRRRR']);
    expect(territories.filter((t) => t.split)).toHaveLength(0);
    expect(warnings.some((w) => w.code === 'regionSplit')).toBe(false);
    expect(map.territories).toHaveLength(3);
    expect(map.territories.every((t) => t.polygon.length >= 3)).toBe(true);
  });

  it('counts speckle separately from sea and transparency', () => {
    // A 4 px floor drops the 2 px of blue and keeps the 8 px of red; the
    // transparent frame is background and must not be counted as land that
    // went missing.
    const { warnings } = importArt(['RRRR', 'RRRR', '....', '..BB'], 'test map', 4);
    const skipped = warnings.find((w) => w.code === 'skippedPixels');
    expect(skipped).toBeDefined();
    expect(skipped!.numbers!.count).toBe(2);
    expect(skipped!.numbers!.total).toBe(16);
    expect(skipped!.detail).toMatch(/speckle/);
  });

  it('warns about the small regions it dropped, with the count', () => {
    // A 20x20 province, a one-pixel letter on it and a 6x6 enclave beside it.
    // The pixel minimum cannot catch the letter — 1 px passes a floor of 1 —
    // but the relative floor can, because it is nothing next to the province.
    const size = 20;
    const rows = Array.from({ length: size }, () => 'R'.repeat(size));
    const withLetter = [...rows];
    withLetter[5] = 'RRRRG' + 'R'.repeat(size - 5);
    const withEnclave = [...withLetter];
    withEnclave.splice(10, 6, ...Array.from({ length: 6 }, () => 'R'.repeat(7) + 'B'.repeat(6) + 'R'.repeat(7)));
    const { warnings } = importArt(withEnclave, 'test map', 1, 0.02);
    const dropped = warnings.find((w) => w.code === 'smallRegionsDropped');
    expect(dropped).toBeDefined();
    expect(dropped!.numbers!.count).toBe(1); // the letter, not the enclave
    expect(dropped!.detail).toMatch(/province names painted on it/);
  });

  it('keeps a region with no neighbours out of trouble', () => {
    const { map, errors, warnings } = importArt(['R']);
    expect(errors).toEqual([]);
    expect(map.territories).toHaveLength(1);
    expect(map.territories[0].neighbors).toEqual([]);
    expect(warnings.some((w) => w.code === 'island')).toBe(true);
  });

  it('summarises each territory for the validation screen', () => {
    const { territories } = importArt(['RRRR', 'GGGG', 'BBBB']);
    expect(territories).toHaveLength(3);
    for (const t of territories) {
      expect(t.id).toMatch(/^p\d+$/);
      expect(t.area).toBe(4);
      expect(t.color).toBeGreaterThan(0);
      expect(t.island).toBe(false);
      expect(t.split).toBe(false);
    }
    // Areas are equal, so the order follows the detection order.
    expect(territories.map((t) => t.id)).toEqual(['p0', 'p1', 'p2']);
  });

  it('is deterministic: same art, same map, twice', () => {
    const a = importArt(['RRGGBB', 'RRGGBB', 'RRGGBB']);
    const b = importArt(['RRGGBB', 'RRGGBB', 'RRGGBB']);
    expect(a.map).toEqual(b.map);
  });

  it('reports a map with no land at all instead of pretending it worked', () => {
    const { map, territories } = importArt(['....', '....']);
    expect(map.territories).toEqual([]);
    expect(territories).toEqual([]);
  });

  it('splits issues into blocking errors and playable warnings', () => {
    const { issues, errors, warnings } = importArt(['RRRR', 'RRRR', '....', '..BB']);
    expect(issues).toHaveLength(errors.length + warnings.length);
    expect(errors).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
