import { describe, expect, it } from 'vitest';
import type { Camera, Viewport } from '../src/core/camera';
import { GLYPH_REFERENCE_PX, arcGlyphs, glyphOffsets } from '../src/core/glyph-layout';
import { labelAlpha } from '../src/core/label-frame';
import type { AnyLabelDraw, LabelDraw, ShapedDraw } from '../src/core/label-frame';
import { LABEL_PARAMS } from '../src/core/label-params';
import type { MapView } from '../src/render/map-scene';
import { attachLabelLayer } from '../src/render/labels-layer';

// Spec 006 FR-200, FR-201, FR-202, FR-207, FR-208, FR-212: what the label layer asks of the 2D context for
// rotated, arc and off-land labels and for leader lines. The recording context keeps a full affine matrix.

type M = [number, number, number, number, number, number];
const mul = (p: M, q: M): M => [
  p[0] * q[0] + p[2] * q[1],
  p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3],
  p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4],
  p[1] * q[4] + p[3] * q[5] + p[5],
];

interface TextOp {
  op: 'stroke' | 'fill';
  text: string;
  m: M;
  alpha: number;
  fontPx: number;
  lineWidth: number;
  style: string;
  index: number;
}
interface LineOp {
  op: 'line';
  from: [number, number];
  to: [number, number];
  m: M;
  alpha: number;
  lineWidth: number;
  style: string;
  index: number;
}

function fakeContext() {
  const ops: (TextOp | LineOp)[] = [];
  const calls: string[] = [];
  let m: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  let path: { from: [number, number]; to: [number, number] } | undefined;
  let counter = 0;
  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
      calls.push('setTransform');
      m = [a, b, c, d, e, f];
    },
    clearRect() {
      calls.push('clearRect');
    },
    save() {
      calls.push('save');
      stack.push([...m]);
    },
    restore() {
      calls.push('restore');
      m = stack.pop()!;
    },
    translate(x: number, y: number) {
      calls.push('translate');
      m = mul(m, [1, 0, 0, 1, x, y]);
    },
    rotate(r: number) {
      calls.push('rotate');
      m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
    },
    scale(x: number, y: number) {
      calls.push('scale');
      m = mul(m, [x, 0, 0, y, 0, 0]);
    },
    transform(a: number, b: number, c: number, d: number, e: number, f: number) {
      calls.push('transform');
      m = mul(m, [a, b, c, d, e, f]);
    },
    measureText(text: string) {
      calls.push('measureText');
      return { width: text.length * 0.6 * ctx.fontPx() };
    },
    fontPx() {
      return Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)![1]);
    },
    beginPath() {
      calls.push('beginPath');
      path = undefined;
    },
    moveTo(x: number, y: number) {
      calls.push('moveTo');
      path = { from: [x, y], to: [x, y] };
    },
    lineTo(x: number, y: number) {
      calls.push('lineTo');
      path!.to = [x, y];
    },
    stroke() {
      calls.push('stroke');
      ops.push({ op: 'line', from: path!.from, to: path!.to, m: [...m], alpha: ctx.globalAlpha, lineWidth: ctx.lineWidth, style: ctx.strokeStyle, index: counter++ });
    },
    strokeText(text: string) {
      calls.push('strokeText');
      ops.push({ op: 'stroke', text, m: [...m], alpha: ctx.globalAlpha, fontPx: ctx.fontPx(), lineWidth: ctx.lineWidth, style: ctx.strokeStyle, index: counter++ });
    },
    fillText(text: string) {
      calls.push('fillText');
      ops.push({ op: 'fill', text, m: [...m], alpha: ctx.globalAlpha, fontPx: ctx.fontPx(), lineWidth: ctx.lineWidth, style: ctx.fillStyle, index: counter++ });
    },
  };
  const canvas = { width: 0, height: 0, getContext: (kind: string) => (kind === '2d' ? ctx : null) } as unknown as HTMLCanvasElement;
  return { canvas, ops, calls };
}

const VP: Viewport = { width: 400, height: 300 };
const view = (scale: number, dpr = 1, x = 100, y = 100): MapView => ({ camera: { x, y, scale } satisfies Camera, viewport: VP, dpr });
const text = (ops: (TextOp | LineOp)[]): TextOp[] => ops.filter((o): o is TextOp => o.op !== 'line');
const lines = (ops: (TextOp | LineOp)[]): LineOp[] => ops.filter((o): o is LineOp => o.op === 'line');

const straight = (over: Partial<ShapedDraw['frame']> & { angle?: number } = {}, extra: Partial<ShapedDraw> = {}): ShapedDraw => ({
  text: 'Francia',
  role: 'faction',
  frame: { shape: 'straight', cx: 100, cy: 100, angle: 0, h: 10, w: 40, ...over } as ShapedDraw['frame'],
  factor: 1,
  ink: [255, 255, 255],
  halo: [0, 0, 0],
  ...extra,
});
const arc = (angle = 0, bend = 30): ShapedDraw =>
  straight({}, { text: 'Bretana', frame: { shape: 'arc', cx: 100, cy: 100, angle, h: 10, w: 56, bend, radius: 70 } });
const box = (over: Partial<LabelDraw> = {}): LabelDraw => ({
  text: 'Alemania',
  role: 'faction',
  box: { x0: 80, y0: 90, h: 20, w: 80 },
  factor: 1,
  ink: [255, 255, 255],
  halo: [0, 0, 0],
  ...over,
});

const draw = (labels: readonly AnyLabelDraw[], v: MapView = view(1)) => {
  const f = fakeContext();
  const layer = attachLabelLayer(f.canvas);
  layer.resize(VP, v.dpr);
  layer.draw(labels, v);
  return f;
};
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const along = (m: M): number => Math.hypot(m[0], m[1]);
const across = (m: M): number => Math.hypot(m[2], m[3]);

describe('FR-200 FR-202 a straight label is drawn rotated by -theta, stretched only along the reading direction', () => {
  it('FR-200 the text centre is the screen centre and the text axis reads along (cos theta, -sin theta)', () => {
    for (const theta of [0, 30, 90, -75, 180]) {
      const { ops } = draw([straight({ angle: theta })], view(1.2));
      const fill = text(ops).find((o) => o.op === 'fill')!;
      const c = apply(fill.m, 0, 0);
      expect(c[0]).toBeCloseTo((100 - 100) * 1.2 + 200, 6);
      expect(c[1]).toBeCloseTo((100 - 100) * 1.2 + 150, 6);
      const e = apply(fill.m, 1, 0);
      const ux = (e[0] - c[0]) / along(fill.m);
      const uy = (e[1] - c[1]) / along(fill.m);
      expect(ux).toBeCloseTo(Math.cos((theta * Math.PI) / 180), 9);
      expect(uy).toBeCloseTo(-Math.sin((theta * Math.PI) / 180), 9);
    }
  });

  it('FR-200 a frame at +90 degrees reads from bottom to top', () => {
    const { ops } = draw([straight({ angle: 90 })], view(1));
    const fill = text(ops).find((o) => o.op === 'fill')!;
    const a = apply(fill.m, -10, 0);
    const b = apply(fill.m, 10, 0);
    expect(b[1]).toBeLessThan(a[1]);
    expect(b[0]).toBeCloseTo(a[0], 6);
  });

  it('FR-202 the drawn length equals the on-screen frame length and the font size is the frame height, at any dpr', () => {
    for (const [scale, dpr, theta] of [[1, 1, 30], [1.4, 2, -60], [0.9, 1.25, 90]] as const) {
      const { ops } = draw([straight({ angle: theta })], view(scale, dpr));
      const fill = text(ops).find((o) => o.op === 'fill')!;
      expect(fill.fontPx).toBeCloseTo(10 * scale, 9);
      const measured = 'Francia'.length * 0.6 * fill.fontPx;
      expect((measured * along(fill.m)) / dpr).toBeCloseTo(40 * scale, 6);
      // across the reading direction only the device pixel ratio acts
      expect(across(fill.m)).toBeCloseTo(dpr, 9);
    }
  });

  it('FR-202 the halo is a 2 CSS pixel stroke under the same transform, drawn before the fill, in the halo colour', () => {
    const { ops } = draw([straight({ angle: 40 })], view(1.5, 2));
    const t = text(ops);
    expect(t.map((o) => o.op)).toStrictEqual(['stroke', 'fill']);
    expect(t[0]!.lineWidth).toBe(2);
    expect(t[0]!.style).toBe('rgb(0, 0, 0)');
    expect(t[1]!.style).toBe('rgb(255, 255, 255)');
    expect(t[0]!.m).toStrictEqual(t[1]!.m);
    // the stroke width in device pixels across the reading direction is lineWidth x dpr
    expect(t[0]!.lineWidth * across(t[0]!.m)).toBeCloseTo(2 * 2, 9);
  });

  it('FR-208 the alpha is the role opacity at the scale times the factor', () => {
    const s = straight({}, { factor: 0.5 });
    const { ops } = draw([s], view(1));
    expect(text(ops)[0]!.alpha).toBeCloseTo(labelAlpha(s, 1, LABEL_PARAMS), 12);
  });

  it('FR-208 a label under P screen pixels high, or with alpha 0, is skipped', () => {
    expect(text(draw([straight({ h: 1 })], view(1)).ops)).toHaveLength(0);
    expect(text(draw([straight({}, { factor: 0 })], view(1)).ops)).toHaveLength(0);
    expect(text(draw([straight({ cx: 5000 })], view(1)).ops)).toHaveLength(0);
  });
});

describe('FR-201 FR-202 an arc label is drawn glyph by glyph without stretch', () => {
  it('FR-201 each glyph is drawn at the point of the reference glyph layout, rotated to the tangent', () => {
    const a = arc(20, 60);
    const scale = 1.5;
    const v = view(scale, 1);
    const { ops } = draw([a], v);
    const fills = text(ops).filter((o) => o.op === 'fill');
    expect(fills.map((o) => o.text).join('')).toBe('Bretana');
    // reference layout: advances at the reference size (the fake measures 0.6 x size per glyph)
    const advances = Array.from('Bretana').map(() => 0.6 * GLYPH_REFERENCE_PX);
    const pts = arcGlyphs(a.frame as Extract<ShapedDraw['frame'], { shape: 'arc' }>, glyphOffsets(advances, a.frame.w));
    fills.forEach((f, i) => {
      const c = apply(f.m, 0, 0);
      expect(c[0]).toBeCloseTo((pts[i]!.x - v.camera.x) * scale + VP.width / 2, 6);
      expect(c[1]).toBeCloseTo((pts[i]!.y - v.camera.y) * scale + VP.height / 2, 6);
      // the glyph x axis reads along the tangent: screen angle pts[i].angle
      const e = apply(f.m, 1, 0);
      const ang = Math.atan2(-(e[1] - c[1]), e[0] - c[0]) / (Math.PI / 180);
      expect(ang).toBeCloseTo(pts[i]!.angle, 6);
    });
  });

  it('FR-202 arc glyphs are not stretched: the matrix is a rotation times the device pixel ratio, font size = h x scale', () => {
    for (const dpr of [1, 2]) {
      const { ops } = draw([arc(-30, -30)], view(1.4, dpr));
      for (const o of text(ops)) {
        expect(along(o.m)).toBeCloseTo(dpr, 9);
        expect(across(o.m)).toBeCloseTo(dpr, 9);
        expect(o.m[0] * o.m[2] + o.m[1] * o.m[3]).toBeCloseTo(0, 9);
        expect(o.fontPx).toBeCloseTo(14, 9);
      }
    }
  });

  it('FR-202 the halo (2 CSS px) is stroked before the fill of every glyph, with the same transform', () => {
    const { ops } = draw([arc()], view(1));
    const t = text(ops);
    expect(t).toHaveLength(14);
    for (let i = 0; i < t.length; i += 2) {
      expect(t[i]!.op).toBe('stroke');
      expect(t[i + 1]!.op).toBe('fill');
      expect(t[i]!.text).toBe(t[i + 1]!.text);
      expect(t[i]!.m).toStrictEqual(t[i + 1]!.m);
      expect(t[i]!.lineWidth).toBe(2);
    }
  });

  it('FR-202 the glyph advances are measured once per text at the reference size and cached', () => {
    const f = fakeContext();
    const layer = attachLabelLayer(f.canvas);
    layer.resize(VP, 1);
    layer.draw([arc()], view(1));
    const first = f.calls.filter((c) => c === 'measureText').length;
    expect(first).toBe(7);
    layer.draw([arc()], view(1.2));
    expect(f.calls.filter((c) => c === 'measureText').length).toBe(7);
  });

  it('FR-208 an arc label off the screen is culled by its bounding circle and a near one is drawn', () => {
    expect(text(draw([straight({ cx: 100 + 1000 })], view(1)).ops)).toHaveLength(0);
    const far = { ...arc(), frame: { ...arc().frame, cx: 100 + 200 + 28 + 10 } } as ShapedDraw;
    expect(text(draw([far], view(1)).ops).length).toBeGreaterThan(0);
  });
});

describe('FR-207 FR-208 off-land labels and leader lines', () => {
  const leader = { x1: 100, y1: 100, x2: 140, y2: 130 };

  it('FR-207 a leader is a 3 px black line then a 1 px white line on the segment, at the label alpha', () => {
    const d = box({ leader, factor: 0.5 });
    const v = view(1.2, 2);
    const { ops } = draw([d], v);
    const l = lines(ops);
    expect(l).toHaveLength(2);
    expect([l[0]!.lineWidth, l[1]!.lineWidth]).toStrictEqual([3, 1]);
    expect([l[0]!.style, l[1]!.style]).toStrictEqual(['rgb(0, 0, 0)', 'rgb(255, 255, 255)']);
    const alpha = labelAlpha(d, 1.2, LABEL_PARAMS);
    expect(l[0]!.alpha).toBeCloseTo(alpha, 12);
    expect(l[1]!.alpha).toBeCloseTo(alpha, 12);
    for (const o of l) {
      const a = apply(o.m, ...o.from);
      const b = apply(o.m, ...o.to);
      expect(a[0] / 2).toBeCloseTo((100 - 100) * 1.2 + 200, 6);
      expect(a[1] / 2).toBeCloseTo((100 - 100) * 1.2 + 150, 6);
      expect(b[0] / 2).toBeCloseTo((140 - 100) * 1.2 + 200, 6);
      expect(b[1] / 2).toBeCloseTo((130 - 100) * 1.2 + 150, 6);
    }
  });

  it('FR-207 the leader lines of all labels come before every text', () => {
    const { ops } = draw([box({ text: 'Uno', leader }), straight({ angle: 20 }), box({ text: 'Dos', leader: { ...leader, x2: 90 } })], view(1));
    const lastLine = Math.max(...lines(ops).map((o) => o.index));
    const firstText = Math.min(...text(ops).map((o) => o.index));
    expect(lines(ops)).toHaveLength(4);
    expect(lastLine).toBeLessThan(firstText);
  });

  it('FR-207 a leader is drawn only while its label is drawn', () => {
    expect(lines(draw([box({ leader, factor: 0 })], view(1)).ops)).toHaveLength(0);
    expect(lines(draw([box({ leader, box: { x0: 80, y0: 90, h: 1, w: 4 } })], view(1)).ops)).toHaveLength(0);
    expect(lines(draw([box({ role: 'territory', leader })], view(LABEL_PARAMS.fadeStart * 0.5)).ops)).toHaveLength(0);
  });

  it('FR-208 an off-land label is a box label: drawn like the 005 horizontal text', () => {
    const { ops } = draw([box({ leader })], view(1));
    const fill = text(ops).find((o) => o.op === 'fill')!;
    expect(fill.text).toBe('Alemania');
    expect(fill.fontPx).toBeCloseTo(20, 9);
    expect(along(fill.m)).toBeCloseTo((80) / ('Alemania'.length * 0.6 * 20), 9);
    expect(across(fill.m)).toBeCloseTo(1, 9);
  });

  it('FR-207 the leader state does not leak: the text stroke is 2 CSS px after the 3 px and 1 px lines', () => {
    const { ops } = draw([box({ leader })], view(1));
    expect(text(ops)[0]!.lineWidth).toBe(2);
  });
});

describe('FR-212 box labels produce exactly the 005 call log', () => {
  it('FR-212 a box label without a leader makes no call that 005 did not make', () => {
    const { calls } = draw([box()], view(1));
    expect(calls).toStrictEqual(['setTransform', 'clearRect', 'measureText', 'save', 'translate', 'scale', 'strokeText', 'fillText', 'restore']);
  });

  it('FR-212 the same box label gives the same log whatever other shaped labels follow it', () => {
    const { calls } = draw([box(), straight()], view(1));
    expect(calls.slice(0, 9)).toStrictEqual(['setTransform', 'clearRect', 'measureText', 'save', 'translate', 'scale', 'strokeText', 'fillText', 'restore']);
  });
});
