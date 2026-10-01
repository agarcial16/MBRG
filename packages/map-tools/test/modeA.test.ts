import { describe, expect, it } from 'vitest';

import { assembleMap } from '../src/assemble.js';
import { detectAdjacency } from '../src/adjacency.js';
import { traceContours } from '../src/contours.js';
import { detectFlatColorRegions } from '../src/flatColors.js';
import { createRaster, setPixel } from '../src/raster.js';

/**
 * A mode A image as it really looks: flat colours that *touch*, a lake, an
 * island and the province names painted on top.
 *
 * The "touching" part is the one that matters and the one that is easy to get
 * wrong. A dark outline around every province is not a border between two
 * regions, it is a strip of pixels that belong to nobody, so it breaks the
 * adjacency of everything it separates: the map becomes a pile of islands. The
 * pixel-based tests elsewhere use tiny maps with hard edges, so this one is
 * drawn at the scale and layout a real export has.
 */
const SEA = 0x101018;
const CW = 100;
const CH = 130;
const ORIGIN = 10;
const GRID: readonly number[] = [
  0xc0392b, 0x27ae60, 0x2980b9, 0xf1c40f,
  0x8e44ad, 0xd35400, 0x16a085, 0x2c3e95,
];
/** Far enough from every cell colour that the tolerance cannot merge them. */
const ISLAND = 0x00bcd4;

const GLYPHS: Record<string, string> = {
  A: '01110 10001 10001 11111 10001 10001 10001',
  E: '11111 10000 10000 11110 10000 10000 11111',
  I: '11111 00100 00100 00100 00100 00100 11111',
  L: '10000 10000 10000 10000 10000 10000 11111',
  O: '01110 10001 10001 10001 10001 10001 01110',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
};

function realisticMap() {
  const width = 480;
  const height = 320;
  const img = createRaster(width, height, SEA);
  const fill = (x0: number, y0: number, w: number, h: number, rgb: number): void => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) setPixel(img, x, y, rgb);
    }
  };

  GRID.forEach((rgb, index) => {
    const cx = index % 4;
    const cy = Math.floor(index / 4);
    fill(ORIGIN + cx * CW, ORIGIN + cy * CH, CW, CH, rgb);
  });
  fill(240, 60, 60, 40, SEA); // a real lake, inside the third cell
  fill(425, 285, 40, 25, ISLAND); // an island, a colour no cell uses

  // Painted names, 2x scale: 12x14 px glyphs inside the top row of cells.
  const label = (word: string, x0: number, y0: number): void => {
    let cursor = x0;
    for (const ch of word) {
      GLYPHS[ch]
        .split(' ')
        .forEach((row, ry) =>
          [...row].forEach((bit, rx) => {
            if (bit === '1') fill(cursor + rx * 2, y0 + ry * 2, 2, 2, SEA);
          }),
        );
      cursor += 12;
    }
  };
  label('AURELIA', 20, 110);
  label('ARTE', 120, 110);
  label('SOL', 230, 110);
  label('ESTALIA', 320, 110);

  const flat = detectFlatColorRegions(img, { minRegionArea: 64 });
  const adjacency = detectAdjacency(flat);
  const contours = traceContours(flat, { simplify: 0 });
  return { img, flat, adjacency, contours, assembled: assembleMap(flat, adjacency, contours, { name: 'real' }) };
}

describe('una imagen de modo A realista', () => {
  it('detecta las 9 regiones: 8 celdas más la isla', () => {
    const { flat } = realisticMap();
    expect(flat.regions).toHaveLength(9);
  });

  it('la isla queda aislada de verdad, no fusionada con el mar', () => {
    const { adjacency, assembled } = realisticMap();
    expect(adjacency.islands).toHaveLength(1);
    // Nothing but a sea link can reach it, and the map says so.
    const island = assembled.map.territories.find((t) => t.neighbors.length === 0)!;
    expect(island).toBeDefined();
    expect(assembled.errors).toEqual([]);
  });

  it('las provincias que se tocan son vecinas, sin necesidad de contorno', () => {
    const { flat, assembled } = realisticMap();
    const borders = (color: number): number =>
      assembled.map.territories.find((t) => t.id === `p${flat.regions.findIndex((r) => r.color === color)}`)!
        .neighbors.length;
    // Corners of the grid have 2 land borders, the middle ones 3.
    expect(borders(GRID[0])).toBe(2);
    expect(borders(GRID[1])).toBe(3);
    expect(borders(GRID[2])).toBe(3);
    expect(borders(GRID[3])).toBe(2);
    expect(borders(GRID[4])).toBe(2);
    expect(borders(GRID[7])).toBe(2); // the bottom-right cell, not the island
  });

  it('la simetría se cumple: si a linda con b, b linda con a', () => {
    const { assembled } = realisticMap();
    for (const territory of assembled.map.territories) {
      for (const neighbor of territory.neighbors) {
        expect(
          assembled.map.territories.find((t) => t.id === neighbor)!.neighbors,
        ).toContain(territory.id);
      }
    }
  });

  it('una rejilla limpia no produce cruces en diagonal', () => {
    const { assembled } = realisticMap();
    // Four colours meeting at a point on a pixel grid is the normal case, and
    // a warning about it on every grid-shaped map would be pure noise.
    expect(assembled.warnings.some((w) => w.code === 'diagonalCrossings')).toBe(false);
  });

  it('la isla avisa una vez, no convierte el aviso "todo son islas" en ruido', () => {
    const { assembled } = realisticMap();
    const islands = assembled.warnings.filter((w) => w.code === 'island');
    expect(islands).toHaveLength(1);
    expect(assembled.warnings.some((w) => w.code === 'mostlyIslands')).toBe(false);
  });

  it('descarta las letras pero conserva el lago', () => {
    const { flat, contours, assembled } = realisticMap();
    // 4 + 4 + 3 + 7 glyphs, most of them with an enclosed counter.
    expect(contours.droppedHoles).toBeGreaterThan(10);
    expect(contours.droppedHoles).toBeLessThan(40);

    const lakeRegion = flat.regions.findIndex((r) => r.color === GRID[2]);
    const withLake = assembled.map.territories.find((t) => t.id === `p${lakeRegion}`)!;
    expect(withLake.holes).toHaveLength(1);
    // 60x40 px: the lake is one loop, and no province kept a letter.
    expect(assembled.map.territories.filter((t) => t.holes && t.holes.length > 1)).toHaveLength(0);
  });

  it('el mapa assembled es jugable: sin errores y con validación de verdad', () => {
    const { assembled } = realisticMap();
    expect(assembled.errors).toEqual([]);
    // The lake survives as a hole, so the polygon needs one to be valid.
    expect(assembled.issues.every((i) => i.code !== 'invalid')).toBe(true);
  });
});