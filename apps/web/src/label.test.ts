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
      // Every centerline point is inside some piece of the faction.
      type Zone = (typeof l.zones)[number];
      const owningZone = (p: Coord): Zone | undefined =>
        l.zones.find((z) => z.outers.some((o) => pointInPolygon(p, o)));
      for (const p of l.curve.pts) {
        expect(owningZone(p), `${l.text}: ${p} fuera`).toBeDefined();
        for (const h of owningZone(p)?.holes ?? []) {
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

describe('provincia con varias piezas', () => {
  // A mainland and an island: one province, one label, one anchor. The island
  // must not drag the anchor — nor the corridor — out over open water.
  const archipelago: MapFormatV1 = {
    version: 1,
    name: 'archipelago',
    width: 400,
    height: 100,
    territories: [
      {
        id: 'M',
        name: 'Maritima',
        neighbors: [],
        polygons: [
          [
            [0, 30],
            [60, 30],
            [60, 70],
            [0, 70],
          ],
          [
            [300, 40],
            [320, 40],
            [320, 60],
            [300, 60],
          ],
        ],
      },
    ],
  };

  it('la etiqueta se ancla en la pieza grande, no en el mar', () => {
    const [label] = layoutOf(archipelago, { M: 'M' });
    expect(label.text).toBe('Maritima');
    expect(pointInPolygon([label.x, label.y], archipelago.territories[0].polygons[0])).toBe(true);
    // The centreline stays on the mainland instead of spanning mainland→island.
    for (const p of label.curve.pts) {
      expect(pointInPolygon(p, archipelago.territories[0].polygons[0])).toBe(true);
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
          polygons: [[
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 100],
          ]],
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
          polygons: [[
            [30, 30],
            [70, 30],
            [70, 70],
            [30, 70],
          ]],
        },
      ],
    };
    const labels = layoutOf(frame, { R: 'R', L: 'L' });
    const ring = labels.find((l) => l.faction === 'R')!;
    expect(ring.text).toBe('Ring');
    // The ring's centerline runs through the border band, never through the hole.
    for (const p of ring.curve.pts) {
      expect(pointInPolygon(p, frame.territories[0].polygons[0])).toBe(true);
      expect(pointInPolygon(p, frame.territories[0].holes![0]), `${p} dentro del hueco`).toBe(false);
    }
  });
});

/** Single-territory map, to exercise the shape of a block in isolation. */
function oneTerritory(polygon: Coord[], name: string): MapFormatV1 {
  return {
    version: 1,
    name: 'fixture',
    width: 400,
    height: 400,
    territories: [{ id: 'X', name, neighbors: [], polygons: [polygon] }],
  };
}

/** Thick band following a circular arc: a "banana" (the crescent case). */
function banana(ro: number, ri: number, from: number, to: number): Coord[] {
  const pts: Coord[] = [];
  for (let a = from; a <= to; a += Math.PI / 60) pts.push([ro * Math.cos(a), ro * Math.sin(a)]);
  for (let a = to; a >= from; a -= Math.PI / 60) pts.push([ri * Math.cos(a), ri * Math.sin(a)]);
  return pts;
}

describe('sentido de lectura', () => {
  const owners: Ownership = Object.fromEntries(handmadeMap.territories.map((t) => [t.id, t.id]));
  const labels = layoutOf(handmadeMap, owners);

  it('la curva avanza en el eje de lectura y no se inclina demasiado', () => {
    for (const l of labels) {
      const ax = Math.cos(l.angle);
      const ay = Math.sin(l.angle);
      // Whole line: it must advance along the label's axis (never backwards).
      const last = l.curve.pts[l.curve.pts.length - 1];
      const first = l.curve.pts[0];
      const span = Math.hypot(last[0] - first[0], last[1] - first[1]);
      expect(span).toBeGreaterThan(0);
      expect(((last[0] - first[0]) * ax + (last[1] - first[1]) * ay) / span).toBeGreaterThan(0);
      // Every step reads forward and tilts at most 60° from the axis.
      for (let i = 1; i < l.curve.pts.length; i++) {
        const dx = l.curve.pts[i][0] - l.curve.pts[i - 1][0];
        const dy = l.curve.pts[i][1] - l.curve.pts[i - 1][1];
        const len = Math.hypot(dx, dy);
        if (len <= 1e-9) continue;
        expect((dx * ax + dy * ay) / len).toBeGreaterThan(0);
        expect(Math.abs(dy * ax - dx * ay) / len).toBeLessThanOrEqual(Math.sin((60 * Math.PI) / 180) + 1e-9);
      }
    }
  });

  it('el ángulo base es canónico (nunca boca abajo)', () => {
    for (const l of labels) {
      expect(l.angle).toBeGreaterThan(-Math.PI / 2 - 1e-9);
      expect(l.angle).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    }
  });
});

describe('recto por defecto, semiluna solo si hace falta', () => {
  // An L: the straight corridor along an arm already fits, so no crescent.
  const L: Coord[] = [
    [0, 0],
    [200, 0],
    [200, 60],
    [60, 60],
    [60, 200],
    [0, 200],
  ];

  it('un bloque en L se etiqueta recto', () => {
    const label = layoutOf(oneTerritory(L, 'Imperio'), { X: 'X' })[0];
    expect(label.curve.pts).toHaveLength(2);
    for (const p of label.curve.pts) expect(pointInPolygon(p, L)).toBe(true);
  });

  it('una banda curva se etiqueta con un arco, y el arco es un solo giro', () => {
    const band = banana(120, 80, 0.35, 1.95);
    const curved = layoutOf(oneTerritory(band, 'Imperio del Norte'), { X: 'X' })[0];
    expect(curved.curve.pts.length).toBeGreaterThan(2);
    for (const p of curved.curve.pts) expect(pointInPolygon(p, band), `${p} fuera`).toBe(true);
    // One smooth bend = the tangent always turns the *same* way. A serpentine
    // would flip the sign of the cross product from segment to segment.
    const cross: number[] = [];
    for (let i = 1; i < curved.curve.pts.length - 1; i++) {
      const a = curved.curve.pts[i - 1];
      const b = curved.curve.pts[i];
      const c = curved.curve.pts[i + 1];
      cross.push((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]));
    }
    const signs = new Set(cross.filter((v) => Math.abs(v) > 1e-9).map((v) => Math.sign(v)));
    expect(signs.size).toBeLessThanOrEqual(1);
    expect(signs.size).toBe(1); // it really is a bend, not a straight line
  });

  it('el arco nunca se sale del bloque ni se lee del revés', () => {
    const band = banana(120, 80, 0.35, 1.95);
    const label = layoutOf(oneTerritory(band, 'Imperio del Norte'), { X: 'X' })[0];
    const ax = Math.cos(label.angle);
    const ay = Math.sin(label.angle);
    for (let i = 1; i < label.curve.pts.length; i++) {
      const dx = label.curve.pts[i][0] - label.curve.pts[i - 1][0];
      const dy = label.curve.pts[i][1] - label.curve.pts[i - 1][1];
      const len = Math.hypot(dx, dy);
      if (len <= 1e-9) continue;
      expect((dx * ax + dy * ay) / len).toBeGreaterThan(0);
    }
  });
});
