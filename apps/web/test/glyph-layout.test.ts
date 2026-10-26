import { describe, expect, it } from 'vitest';
import type { ArcFrame } from '../src/core/label-shape';
import { GLYPH_REFERENCE_PX, arcGlyphs, glyphOffsets, straightMatrix } from '../src/core/glyph-layout';
import { REFERENCE_PX } from '../src/ui/text-metrics';
import glyphLayoutSrc from '../src/core/glyph-layout.ts?raw';
import { codeOnly } from './helpers/scan';

// Spec 006 FR-200, FR-201, FR-202: the reference glyph layout and the per-glyph transform, pure (drawing side).

const RAD = Math.PI / 180;
const arc = (over: Partial<ArcFrame> = {}): ArcFrame => ({ shape: 'arc', cx: 100, cy: 50, angle: 0, h: 10, w: 60, bend: 30, radius: 80, ...over });

describe('FR-202 the reference glyph layout', () => {
  it('FR-202 GLYPH_REFERENCE_PX equals the reference size of the text aspect ratios', () => {
    expect(GLYPH_REFERENCE_PX).toBe(REFERENCE_PX);
  });

  it('FR-202 the offsets sum to w, keep the measured proportions and start at the sum of the earlier advances', () => {
    const adv = [10, 30, 20, 40];
    const offs = glyphOffsets(adv, 250);
    expect(offs).toHaveLength(4);
    const k = 250 / 100;
    let start = 0;
    adv.forEach((a, i) => {
      expect(offs[i]!.advance).toBeCloseTo(a * k, 9);
      expect(offs[i]!.start).toBeCloseTo(start, 9);
      start += a * k;
    });
    expect(start).toBeCloseTo(250, 9);
    expect(offs[3]!.start + offs[3]!.advance).toBeCloseTo(250, 9);
  });

  it('FR-202 no glyphs, or advances that do not sum above 0, give no offsets', () => {
    expect(glyphOffsets([], 10)).toStrictEqual([]);
    expect(glyphOffsets([0, 0], 10)).toStrictEqual([]);
  });
});

describe('FR-201 the arc glyph points', () => {
  const offs = glyphOffsets([1, 1, 1, 1, 1], 60);

  it('FR-201 every glyph point is at distance R from the circle centre and the middle glyph is at c with tangent theta', () => {
    for (const [angle, bend] of [[0, 30], [0, -30], [37, 60], [-80, -60], [90, 30], [180, -60]] as const) {
      const f = arc({ angle, bend });
      const sign = bend > 0 ? 1 : -1;
      const pts = arcGlyphs(f, offs);
      expect(pts).toHaveLength(5);
      // circle centre: c moved by R along the normal on the side of the bend (up for angle 0, bend > 0)
      const ox = f.cx + sign * f.radius * -Math.sin(angle * RAD);
      const oy = f.cy + sign * f.radius * -Math.cos(angle * RAD);
      for (const p of pts) expect(Math.hypot(p.x - ox, p.y - oy)).toBeCloseTo(f.radius, 6);
      expect(pts[2]!.x).toBeCloseTo(f.cx, 6);
      expect(pts[2]!.y).toBeCloseTo(f.cy, 6);
      expect(pts[2]!.angle).toBeCloseTo(angle, 9);
    }
  });

  it('FR-201 the tangent turns by sign(bend) x s / R and glyph arc positions are the advance midpoints from the centre', () => {
    const f = arc({ angle: 10, bend: 30, radius: 90 });
    const pts = arcGlyphs(f, offs);
    // glyph midpoints at s = -24, -12, 0, 12, 24
    [-24, -12, 0, 12, 24].forEach((s, i) => expect(pts[i]!.angle).toBeCloseTo(10 + (s / 90) / RAD, 9));
    const g = arc({ angle: 10, bend: -30, radius: 90 });
    const q = arcGlyphs(g, offs);
    [-24, -12, 0, 12, 24].forEach((s, i) => expect(q[i]!.angle).toBeCloseTo(10 - (s / 90) / RAD, 9));
  });

  it('FR-201 at theta 0 the ends are above the middle for bend > 0 (cup) and below for bend < 0 (screen y grows downwards)', () => {
    const up = arcGlyphs(arc({ bend: 30 }), offs);
    expect(up[0]!.y).toBeLessThan(up[2]!.y);
    expect(up[4]!.y).toBeLessThan(up[2]!.y);
    const down = arcGlyphs(arc({ bend: -30 }), offs);
    expect(down[0]!.y).toBeGreaterThan(down[2]!.y);
    expect(down[4]!.y).toBeGreaterThan(down[2]!.y);
    // the left end is left of the middle at theta 0
    expect(up[0]!.x).toBeLessThan(up[2]!.x);
    expect(up[4]!.x).toBeGreaterThan(up[2]!.x);
  });

  it('FR-202 the reference points lie on the middle line: arc length from c is within 1 px or 1 % of the layout position', () => {
    const f = arc({ angle: -20, bend: 60, radius: 70, w: 90 });
    const o = glyphOffsets([3, 5, 2, 7, 4, 6], f.w);
    const pts = arcGlyphs(f, o);
    o.forEach((g, i) => {
      const s = g.start + g.advance / 2 - f.w / 2;
      // chord from the middle point to the glyph point on a circle of radius R: 2 R sin(|s| / 2R)
      const chord = Math.hypot(pts[i]!.x - f.cx, pts[i]!.y - f.cy);
      const expected = 2 * f.radius * Math.sin(Math.abs(s) / (2 * f.radius));
      expect(Math.abs(chord - expected)).toBeLessThanOrEqual(Math.max(1, 0.01 * f.w));
    });
  });

  it('FR-201 no offsets give no points', () => {
    expect(arcGlyphs(arc(), [])).toStrictEqual([]);
  });
});

describe('FR-200 FR-202 the straight label matrix', () => {
  const apply = (m: { a: number; b: number; c: number; d: number; e: number; f: number }, x: number, y: number) => ({
    x: m.a * x + m.c * y + m.e,
    y: m.b * x + m.d * y + m.f,
  });

  it('FR-200 translate x rotate by -theta x stretch: the origin goes to c and the text axis points along the reading direction', () => {
    for (const theta of [0, 30, 90, -75, 180, 45]) {
      const m = straightMatrix({ cx: 40, cy: 70, angle: theta }, 120, 60);
      const o = apply(m, 0, 0);
      expect([o.x, o.y]).toStrictEqual([40, 70]);
      const t = theta * RAD;
      const ex = apply(m, 1, 0);
      // the text x axis, stretched by 120 / 60 = 2, reads along (cos theta, -sin theta) on screen
      expect(ex.x - 40).toBeCloseTo(2 * Math.cos(t), 9);
      expect(ex.y - 70).toBeCloseTo(-2 * Math.sin(t), 9);
    }
  });

  it('FR-200 a frame at +90 degrees reads from bottom to top', () => {
    const m = straightMatrix({ cx: 0, cy: 0, angle: 90 }, 10, 10);
    const end = apply(m, 5, 0);
    expect(end.x).toBeCloseTo(0, 9);
    expect(end.y).toBeCloseTo(-5, 9);
  });

  it('FR-202 the stretch acts only along the reading direction: the across axis keeps unit length and is perpendicular', () => {
    for (const theta of [0, 25, 90, -60, 135]) {
      const m = straightMatrix({ cx: 0, cy: 0, angle: theta }, 90, 30);
      const along = Math.hypot(m.a, m.b);
      const across = Math.hypot(m.c, m.d);
      expect(along).toBeCloseTo(3, 9);
      expect(across).toBeCloseTo(1, 9);
      expect(m.a * m.c + m.b * m.d).toBeCloseTo(0, 9);
    }
  });

  it('FR-202 the stretch makes the drawn text length equal the frame length', () => {
    const m = straightMatrix({ cx: 5, cy: 5, angle: 33 }, 200, 80);
    const a = apply(m, -40, 0);
    const b = apply(m, 40, 0);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(200, 9);
  });
});

describe('FR-213 the glyph layout is on the drawing side', () => {
  it('FR-213 glyph-layout.ts names no DOM, clock or randomness', () => {
    const code = codeOnly(glyphLayoutSrc);
    for (const word of ['document', 'window', 'Math.random', 'Date.now', 'performance']) expect(code.includes(word), word).toBe(false);
  });
});

describe('FR-213 no number-reference file imports the glyph layout', () => {
  const sources = import.meta.glob('../src/core/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  it('FR-213 no file under src/core imports glyph-layout', () => {
    const users = Object.entries(sources).filter(([p, s]) => !p.endsWith('/glyph-layout.ts') && /glyph-layout/.test(s));
    expect(users.map(([p]) => p)).toStrictEqual([]);
  });
});
