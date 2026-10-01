import { describe, expect, it } from 'vitest';

import { closeGaps } from '../src/morphology.js';
import { createRaster, setPixel } from '../src/raster.js';
import { detectFlatColorRegions } from '../src/flatColors.js';

const SEA = 0x0a2a4a;
const RED = 0xc0392b;
const BLUE = 0x2980b9;

/**
 * Two provinces separated by a strip of `gap` px of sea colour, which is what
 * an outline in the source image looks like to the detector.
 */
function outlined(width: number, gap: number): Int32Array {
  const img = createRaster(width, 5, SEA);
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < width; x++) {
      const left = x < width / 2 - gap / 2;
      const right = x >= width / 2 + gap / 2;
      setPixel(img, x, y, left ? RED : right ? BLUE : SEA);
    }
  }
  const flat = detectFlatColorRegions(img, { sea: 'picked', seaColor: SEA, minRegionArea: 1 });
  return flat.labels;
}

/** True where the two labels sit side by side, i.e. share an edge. */
function shareAnEdge(labels: Int32Array, width: number, height: number): boolean {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const here = labels[p];
      if (here < 0) continue;
      if (x < width - 1 && labels[p + 1] >= 0 && labels[p + 1] !== here) return true;
      if (y < height - 1 && labels[p + width] >= 0 && labels[p + width] !== here) return true;
    }
  }
  return false;
}

describe('cerrar el hueco entre dos provincias', () => {
  it('sin puente, dos provincias separadas por un contorno no se tocan', () => {
    // The state the renderer mishandles: neighbours in the graph, but no shared
    // geometry, so the edge is drawn by both sides and never disappears.
    const labels = outlined(20, 2);
    expect(shareAnEdge(labels, 20, 5)).toBe(false);
  });

  it('con puente, el hueco se cierra y las provincias se tocan', () => {
    const labels = closeGaps(outlined(20, 2), 20, 5, 3);
    expect(shareAnEdge(labels, 20, 5)).toBe(true);
  });

  it('un hueco mas ancho que el puente se queda abierto', () => {
    const labels = closeGaps(outlined(40, 8), 40, 5, 3);
    expect(shareAnEdge(labels, 40, 5)).toBe(false);
  });

  it('con maxGap 0 no hace nada y devuelve las mismas etiquetas', () => {
    const before = outlined(20, 2);
    expect(closeGaps(before, 20, 5, 0)).toBe(before);
  });

  it('la costa no se toca: solo se rellena lo que dos provincias se disputan', () => {
    // An island with sea all around: every sea pixel next to it is reachable
    // from that island alone, so none of them is filled and the coastline stays
    // exactly where the image put it.
    const img = createRaster(20, 20, SEA);
    for (let y = 5; y < 15; y++) {
      for (let x = 5; x < 15; x++) setPixel(img, x, y, RED);
    }
    const flat = detectFlatColorRegions(img, { sea: 'picked', seaColor: SEA, minRegionArea: 1 });
    const before = flat.labels.filter((l) => l >= 0).length;
    const closed = closeGaps(flat.labels, 20, 20, 3);
    expect(closed.filter((l) => l >= 0).length).toBe(before);
  });

  it('un lago dentro de una provincia sobrevive, se closing de cerca lo que sea', () => {
    // Every lake pixel is reachable from the surrounding province alone, so it
    // is uncontested and stays sea. A "fill every gap" would have erased it.
    const img = createRaster(30, 30, SEA);
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 30; x++) setPixel(img, x, y, RED);
    }
    for (let y = 10; y < 20; y++) {
      for (let x = 10; x < 20; x++) setPixel(img, x, y, SEA);
    }
    const flat = detectFlatColorRegions(img, { sea: 'picked', seaColor: SEA, minRegionArea: 1 });
    const closed = closeGaps(flat.labels, 30, 30, 6);
    // The 10x10 hole is still sea.
    expect(closed[15 * 30 + 15]).toBe(-1);
    expect(closed[2 * 30 + 2]).toBeGreaterThanOrEqual(0);
  });

  it('un lago diminuto pegado al borde de la provincia tampoco se llena', () => {
    const img = createRaster(20, 20, SEA);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) setPixel(img, x, y, RED);
    }
    for (let y = 9; y < 11; y++) {
      for (let x = 9; x < 11; x++) setPixel(img, x, y, SEA);
    }
    const flat = detectFlatColorRegions(img, { sea: 'picked', seaColor: SEA, minRegionArea: 1 });
    expect(closeGaps(flat.labels, 20, 20, 3)[10 * 20 + 10]).toBe(-1);
  });

  it('es determinista: la misma entrada da la misma salida', () => {
    const before = outlined(30, 3);
    expect([...closeGaps(before, 30, 5, 4)]).toEqual([...closeGaps(before, 30, 5, 4)]);
  });

  it('no inventa tierra donde el mapa es todo mar', () => {
    const img = createRaster(10, 10, SEA);
    const flat = detectFlatColorRegions(img, { sea: 'picked', seaColor: SEA });
    expect(closeGaps(flat.labels, 10, 10, 5).filter((l) => l >= 0)).toHaveLength(0);
  });
});