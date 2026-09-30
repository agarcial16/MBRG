import { describe, expect, it } from 'vitest';

import type { Coord, MapFormatV1, Ownership } from '@mbrg/shared';

import { frameAt, layoutLabels, rectInsideBlock, type FactionLabel } from './label.js';
import { handmadeMap } from './maps/handmade.js';

function pointInPolygon(p: Coord, poly: Coord[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function layoutOf(map: MapFormatV1, owners: Ownership): FactionLabel[] {
  return layoutLabels(map, owners);
}

describe('layoutLabels con nombres largos', () => {
  const owners: Ownership = Object.fromEntries(handmadeMap.territories.map((t) => [t.id, t.id]));
  const labels = layoutOf(handmadeMap, owners);

  it('usa los nombres de facción y valores finitos, ancla dentro del bloque', () => {
    expect(labels.map((l) => l.text).sort()).toEqual(['Aurelia', 'Borgoña', 'Dracoria', 'Estalia']);
    for (const l of labels) {
      expect(Number.isFinite(l.x) && Number.isFinite(l.y)).toBe(true);
      expect(Number.isFinite(l.size) && l.size > 0).toBe(true);
      expect(Number.isFinite(l.span) && l.span > 0).toBe(true);
      expect(l.angle).toBeGreaterThan(-Math.PI / 2 - 1e-9);
      expect(l.angle).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
      // The visual center (curve midpoint) must be inside the block.
      expect(rectInsideBlock(l.zones, [l.x, l.y], l.angle, -1, -1, 2, 2)).toBe(true);
    }
  });

  it('es determinista: dos cálculos dan las mismas curvas', () => {
    const again = layoutOf(handmadeMap, owners);
    expect(again.map((l) => l.curve.pts)).toEqual(labels.map((l) => l.curve.pts));
    expect(again.map((l) => l.size)).toEqual(labels.map((l) => l.size));
  });
});

describe('curvas de etiqueta', () => {
  const owners: Ownership = Object.fromEntries(handmadeMap.territories.map((t) => [t.id, t.id]));
  const labels = layoutOf(handmadeMap, owners);

  it('tablas consistentes y todos los puntos dentro del bloque', () => {
    for (const l of labels) {
      expect(l.curve.pts.length).toBeGreaterThanOrEqual(2);
      expect(l.curve.cum.length).toBe(l.curve.pts.length);
      expect(l.curve.thick.length).toBe(l.curve.pts.length);
      expect(l.curve.total).toBeGreaterThan(0);
      // Arc length strictly increases.
      for (let i = 1; i < l.curve.cum.length; i++) {
        expect(l.curve.cum[i]).toBeGreaterThan(l.curve.cum[i - 1]);
      }
      // Every centerline point is inside some zone of the faction.
      for (const p of l.curve.pts) {
        expect(l.zones.some((z) => pointInPolygon(p, z.outer)), `${l.text}: ${p} fuera`).toBe(true);
        for (const h of l.zones.find((z) => pointInPolygon(p, z.outer))?.holes ?? []) {
          expect(pointInPolygon(p, h), `${l.text}: ${p} en un hueco`).toBe(false);
        }
      }
      // Thickness measured everywhere except possibly the on-border endpoints.
      const positives = l.curve.thick.filter((t) => t > 0).length;
      expect(positives).toBeGreaterThanOrEqual(l.curve.thick.length - 2);
      // The arc is never shorter than the straight corridor it replaces.
      expect(l.span).toBeLessThanOrEqual(l.curve.total);
    }
  });

  it('frameAt mapea el arco y se sale del rango con seguridad', () => {
    for (const l of labels) {
      const mid = frameAt(l.curve, l.curve.total / 2);
      expect(mid.x).toBeCloseTo(l.x, 9);
      expect(mid.y).toBeCloseTo(l.y, 9);
      expect(Number.isFinite(frameAt(l.curve, 0).angle)).toBe(true);
      expect(Number.isFinite(frameAt(l.curve, l.curve.total).angle)).toBe(true);
      // Out-of-range offsets clamp to the endpoints.
      expect(frameAt(l.curve, -9999)).toEqual(frameAt(l.curve, 0));
      expect(frameAt(l.curve, 9999)).toEqual(frameAt(l.curve, l.curve.total));
    }
  });
});

describe('bloque en forma de anillo (hueco)', () => {
  it('el ancla y la curva evitan el hueco', () => {
    const frame: MapFormatV1 = {
      version: 1,
      name: 'anillo',
      width: 100,
      height: 100,
      territories: [
        {
          id: 'R',
          name: 'Ring',
          neighbors: ['L'],
          polygon: [
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 100],
          ],
          holes: [
            [
              [20, 20],
              [80, 20],
              [80, 80],
              [20, 80],
            ],
          ],
        },
        {
          id: 'L',
          name: 'Lake',
          neighbors: ['R'],
          polygon: [
            [30, 30],
            [70, 30],
            [70, 70],
            [30, 70],
          ],
        },
      ],
    };
    const labels = layoutOf(frame, { R: 'R', L: 'L' });
    const ring = labels.find((l) => l.faction === 'R')!;
    expect(ring.text).toBe('Ring');
    // The ring's centerline runs through the border band, never through the hole.
    for (const p of ring.curve.pts) {
      expect(pointInPolygon(p, frame.territories[0].polygon)).toBe(true);
      expect(pointInPolygon(p, frame.territories[0].holes![0]), `${p} dentro del hueco`).toBe(false);
    }
  });
});
