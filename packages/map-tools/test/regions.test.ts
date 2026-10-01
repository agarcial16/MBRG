import { describe, expect, it } from 'vitest';

import { detectFlatColorRegions } from '../src/flatColors.js';
import { createRaster, setPixel } from '../src/raster.js';

const SEA = 0x0a2a4a;
const RED = 0xc0392b;
const GREEN = 0x27ae60;
const BLUE = 0x2980b9;

function fill(img: ReturnType<typeof createRaster>, x0: number, y0: number, w: number, h: number, rgb: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x >= 0 && y >= 0 && x < img.width && y < img.height) setPixel(img, x, y, rgb);
    }
  }
}

describe('el mar se identifica, no se adivina por la oscuridad', () => {
  it('por defecto solo se lee la transparencia, sin adivinar el mar', () => {
    const img = createRaster(100, 100, SEA);
    fill(img, 10, 10, 30, 30, RED);
    fill(img, 50, 50, 20, 20, GREEN);

    const flat = detectFlatColorRegions(img);
    // The background is opaque, so with the default it is land like any other
    // colour: guessing would be wrong more often than right on a real map.
    expect(flat.seaColor).toBeNull();
    expect(flat.regions.map((r) => r.color).sort()).toEqual([GREEN, RED, SEA].sort());
  });

  it('en modo auto el color más frecuente es el mar y no se toca el resto', () => {
    // More sea than land, as on most maps.
    const img = createRaster(100, 100, SEA);
    fill(img, 10, 10, 30, 30, RED);
    fill(img, 50, 50, 20, 20, GREEN);

    const flat = detectFlatColorRegions(img, { sea: 'auto' });
    expect(flat.seaColor).toBe(SEA);
    expect(flat.ignored.sea).toBe(100 * 100 - 900 - 400);
    expect(flat.regions.map((r) => r.color)).toEqual([RED, GREEN]);
  });

  it('un mapa oscuro ya no pierde la tierra por ser oscura', () => {
    // The night-theme case: everything is dark, and a "dark means border" rule
    // would throw the map away.
    const img = createRaster(60, 60, 0x000000);
    fill(img, 5, 5, 20, 20, 0x0a1a10); // dark green land
    fill(img, 30, 30, 20, 20, 0x101828); // dark blue land

    const flat = detectFlatColorRegions(img, { sea: 'picked', seaColor: 0x000000 });
    // Two regions, both dark, both kept.
    expect(flat.regions).toHaveLength(2);
    expect(flat.regions.map((r) => r.color).sort()).toEqual([0x0a1a10, 0x101828].sort());
  });

  it('un mar elige a mano manda sobre el color predominante', () => {
    const img = createRaster(100, 100, SEA);
    fill(img, 10, 10, 80, 80, RED); // land bigger than water, so auto would fail
    const flat = detectFlatColorRegions(img, { sea: 'picked', seaColor: SEA });
    expect(flat.regions).toHaveLength(1);
    expect(flat.regions[0].color).toBe(RED);
  });

  it('sin mar elegido, el fondo es tierra como cualquier otro color', () => {
    const img = createRaster(40, 40, SEA);
    fill(img, 5, 5, 10, 10, RED);
    const flat = detectFlatColorRegions(img, { sea: 'transparent' });
    // Transparency reads as sea, so the opaque background counts as land.
    expect(flat.regions.map((r) => r.color).sort()).toEqual([SEA, RED].sort());
  });

  it('la transparencia siempre cuenta como mar', () => {
    const img = createRaster(40, 40, RED);
    // Punch a transparent hole: alpha 0.
    setPixel(img, 5, 5, RED, 0);
    const flat = detectFlatColorRegions(img, { sea: 'transparent', smallRegionRatio: 0 });
    expect(flat.ignored.transparent).toBe(1);
    expect(flat.seaColor).toBeNull();
  });
});

describe('una región es una pieza conectada, no un color', () => {
  it('el mismo color en dos sitios lejanos son dos regiones', () => {
    const img = createRaster(200, 60, 0xffffff);
    fill(img, 5, 5, 40, 40, RED);
    fill(img, 150, 5, 40, 40, RED);

    const flat = detectFlatColorRegions(img, { sea: 'picked', seaColor: 0xffffff });
    expect(flat.regions).toHaveLength(2);
    expect(flat.regions.every((r) => r.color === RED)).toBe(true);
    expect(flat.droppedSmallRegions).toBe(0);
  });

  it('y no se reporta como partida: son dos provincias, no una rota', () => {
    const img = createRaster(200, 60, 0xffffff);
    fill(img, 5, 5, 40, 40, RED);
    fill(img, 150, 5, 40, 40, RED);
    const flat = detectFlatColorRegions(img, { sea: 'picked', seaColor: 0xffffff });
    // Every region has exactly one outer ring, since each is one piece.
    expect(flat.regions.every((r) => r.area === 1600)).toBe(true);
  });

  it('el texto pintado, del mismo color en toda la imagen, son muchas piezas', () => {
    // The bug this fixes: 40 country names drawn in one grey became one region
    // with 126 neighbours and every province on the map was called "split".
    // With a floor of zero so the letters survive as regions and can be counted.
    const img = createRaster(300, 120, 0xffffff);
    fill(img, 10, 10, 130, 100, RED);
    fill(img, 160, 10, 130, 100, GREEN);
    for (let i = 0; i < 40; i++) {
      // Small 6x6 glyphs scattered over both provinces, all the same grey.
      fill(img, 15 + i * 7, 40, 6, 6, 0x808080);
    }

    const flat = detectFlatColorRegions(img, {
      sea: 'picked',
      seaColor: 0xffffff,
      smallRegionRatio: 0,
      minRegionArea: 1,
    });
    const grey = flat.regions.filter((r) => r.color === 0x808080);
    expect(grey).toHaveLength(40);
    expect(grey.every((r) => r.area === 36)).toBe(true);
  });

  it('una provincia partida en dos trozos sigue siendo una región partida', () => {
    // Connectivity cannot invent a join that is not there, so a genuinely split
    // province is still reported: the warning means something again.
    const img = createRaster(100, 200, 0xffffff);
    fill(img, 10, 10, 30, 60, RED);
    fill(img, 10, 120, 30, 60, RED);

    const flat = detectFlatColorRegions(img, { sea: 'picked', seaColor: 0xffffff });
    expect(flat.regions).toHaveLength(2);
    expect(flat.regions.every((r) => r.color === RED)).toBe(true);
  });

  it('la región más grande es la número 0 y el orden es estable', () => {
    const img = createRaster(120, 120, 0xffffff);
    fill(img, 10, 10, 60, 60, GREEN); // 3600
    fill(img, 80, 10, 30, 30, RED); // 900
    fill(img, 80, 60, 30, 30, BLUE); // 900

    const flat = detectFlatColorRegions(img, { sea: 'picked', seaColor: 0xffffff });
    expect(flat.regions[0].color).toBe(GREEN);
    // Ties break on the colour value, not on Map iteration order: 0x2980b9 is
    // a smaller number than 0xc0392b, so blue comes first.
    expect(flat.regions[1].color).toBe(BLUE);
    expect(flat.regions[2].color).toBe(RED);

    const again = detectFlatColorRegions(img, { sea: 'picked', seaColor: 0xffffff });
    expect(again.regions.map((r) => r.color)).toEqual(flat.regions.map((r) => r.color));
  });

  it('la etiqueta de cada píxel apunta a su propia región', () => {
    const img = createRaster(200, 60, 0xffffff);
    fill(img, 5, 5, 40, 40, RED);
    fill(img, 150, 5, 40, 40, RED);
    const flat = detectFlatColorRegions(img, { sea: 'picked', seaColor: 0xffffff });

    // Both red patches carry the same colour but different region indices.
    expect(flat.labels[10 * 200 + 10]).not.toBe(flat.labels[10 * 200 + 155]);
    expect(flat.labels[10 * 200 + 10]).toBeGreaterThanOrEqual(0);
    expect(flat.labels[0]).toBe(-1); // sea
  });
});

describe('el suelo de tamaño es relativo a las provincias vecinas', () => {
  /**
   * A grid of equal-sized provinces, which is what the median needs to stand on.
   *
   * With only two or three pieces the median is their average, which is not a
   * province size at all, so a two-region test would prove nothing about a
   * relative floor. A real map has hundreds of provinces and many letters, and
   * that is the population the floor is designed for.
   *
   * The colours step through the blue channel and the tolerance is set below
   * that step, so no two provinces can be merged into one bucket. Thirty
   * provinces cannot be packed into the RGB cube at the default tolerance of 32,
   * which is itself a reminder that the tolerance is tuned per map.
   */
  const GRID_TOLERANCE = 4;
  const TEXT = 0x808080;
  const ENCLAVE = 0x000010;

  function grid(cell: number, columns: number, rows: number) {
    const img = createRaster(columns * cell, rows * cell, 0xffffff);
    for (let ry = 0; ry < rows; ry++) {
      for (let cx = 0; cx < columns; cx++) {
        const step = (ry * columns + cx) * 8;
        fill(img, cx * cell, ry * cell, cell, cell, 0x202020 + step);
      }
    }
    return { img, cell, provinces: columns * rows };
  }

  function detect(img: ReturnType<typeof createRaster>) {
    return detectFlatColorRegions(img, {
      sea: 'picked' as const,
      seaColor: 0xffffff,
      tolerance: GRID_TOLERANCE,
    });
  }

  it('descarta las letras pintadas y conserva todas las provincias', () => {
    const { img, cell, provinces } = grid(100, 6, 5); // 30 provinces of 10000 px
    // 40 glyphs of 12x12 = 144 px, i.e. 1.4% of a province: under the floor.
    for (let i = 0; i < 40; i++) {
      fill(img, 4 + i * 14, 40, 12, 12, TEXT);
    }
    const flat = detect(img);
    expect(flat.regions).toHaveLength(provinces);
    expect(flat.droppedSmallRegions).toBe(40);
    // The floor sat on the provinces: 2% of what covers half the map.
    expect(flat.medianArea).toBe(cell * cell);
  });

  it('conserva un enclave del mismo tamaño que una letra', () => {
    // An enclave is a province, so it has to survive on size alone. 256 px
    // against provinces of 10000 px is 2.5%, just over the 2% floor — which is
    // the whole trade-off of the heuristic, and the reason the warning tells the
    // user to lower the floor if they disagree with it.
    const { img, provinces } = grid(100, 6, 5);
    fill(img, 200, 200, 16, 16, ENCLAVE);
    const flat = detect(img);
    expect(flat.regions).toHaveLength(provinces + 1);
    expect(flat.droppedSmallRegions).toBe(0);
  });

  it('el suelo no depende de la resolución: la misma proporción en dos tamaños', () => {
    // A letter is a smaller *fraction* of a bigger province, so a fixed pixel
    // count cannot work for both scales at once. This is the case that needs
    // the ratio rather than the pixel minimum.
    for (const size of [100, 400]) {
      const { img, provinces } = grid(size, 4, 4);
      // A glyph of 13% of the cell's width, so 1.7% of its area at both scales.
      const glyph = Math.round(size * 0.13);
      for (let i = 0; i < 16; i++) {
        fill(img, (i % 4) * size + 2, Math.floor(i / 4) * size + 2, glyph, glyph, TEXT);
      }
      const flat = detect(img);
      expect(flat.regions).toHaveLength(provinces);
      expect(flat.droppedSmallRegions).toBe(16);
    }
  });

  it('el punto de apoyo es el área que cubre la mitad del mapa', () => {
    const img = createRaster(200, 120, 0xffffff);
    fill(img, 10, 10, 100, 100, RED); // 10000
    fill(img, 120, 10, 20, 20, GREEN); // 400
    const flat = detectFlatColorRegions(img, { sea: 'picked', seaColor: 0xffffff });
    // Half the land is the big region, so that is what a province is worth —
    // and it takes 25000 small regions to outvote a single one of this size.
    expect(flat.medianArea).toBe(10000);
  });

  it('el texto no puede arrastrar el punto de apoyo aunque sea mayoría', () => {
    // The failure mode that makes a plain median useless: more letters than
    // provinces. Here 40 glyphs against 30 provinces, and the answer must stay
    // on the provinces.
    const { img, cell } = grid(100, 6, 5);
    for (let i = 0; i < 40; i++) fill(img, 4 + i * 14, 40, 12, 12, TEXT);
    expect(detect(img).medianArea).toBe(cell * cell);
  });

  it('con el suelo relativo a cero solo manda el mínimo absoluto', () => {
    const { img, provinces } = grid(100, 4, 4);
    fill(img, 8, 8, 6, 6, ENCLAVE); // 36 px, over the 24 px absolute floor
    const flat = detectFlatColorRegions(img, {
      sea: 'picked',
      seaColor: 0xffffff,
      tolerance: GRID_TOLERANCE,
      minRegionArea: 24,
      smallRegionRatio: 0,
    });
    expect(flat.regions).toHaveLength(provinces + 1);
    expect(flat.droppedSmallRegions).toBe(0);
  });

  it('los píxeles descartados se cuentan por categoría', () => {
    const img = createRaster(100, 100, 0xffffff);
    fill(img, 10, 10, 80, 80, RED);
    setPixel(img, 5, 5, 0x808080); // a lone pixel of speckle
    const flat = detectFlatColorRegions(img, { sea: 'picked', seaColor: 0xffffff });
    expect(flat.ignored.speckle).toBe(1);
    expect(flat.ignored.total).toBe(100 * 100);
    expect(flat.ignored.sea + flat.ignored.speckle + 6400).toBe(flat.ignored.total);
  });
});