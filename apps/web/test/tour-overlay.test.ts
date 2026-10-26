import { describe, expect, it } from 'vitest';
import type { Camera, Viewport } from '../src/core/camera';
import type { AnyLabelDraw, LabelDraw } from '../src/core/label-frame';
import { attachLabelLayer } from '../src/render/labels-layer';
import type { TourOverlay } from '../src/render/labels-layer';
import type { MapView } from '../src/render/map-scene';

// The marker ring and the edge triangle (FR-329, FR-333): drawn by the label layer after every text, never dimmed. A fake 2D
// context logs every call and every property assignment in order, so the order and the styles can be read back.

type Entry = { call: string; args: unknown[]; style?: unknown; width?: unknown; alpha?: unknown; fill?: unknown };

function fakeLayer(): { draw: (labels: readonly AnyLabelDraw[], view: MapView, overlay?: TourOverlay) => void; log: Entry[] } {
  const log: Entry[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1, lineWidth: 1, strokeStyle: '#000', fillStyle: '#000', font: '10px x' };
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === 'measureText') return () => ({ width: 40 });
      return (...args: unknown[]) => {
        log.push({ call: prop, args, style: state.strokeStyle, fill: state.fillStyle, width: state.lineWidth, alpha: state.globalAlpha });
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  });
  const canvas = { width: 0, height: 0, getContext: (kind: string) => (kind === '2d' ? ctx : null) } as unknown as HTMLCanvasElement;
  const layer = attachLabelLayer(canvas);
  const vp: Viewport = { width: 400, height: 300 };
  layer.resize(vp, 1);
  return { draw: (labels, view, overlay) => layer.draw(labels, view, overlay), log };
}

const VP: Viewport = { width: 400, height: 300 };
const view: MapView = { camera: { x: 100, y: 100, scale: 1 } satisfies Camera, viewport: VP, dpr: 1 };
const label = (factor: number): LabelDraw => ({
  text: 'Alemania',
  role: 'faction',
  box: { x0: 80, y0: 90, h: 20, w: 80 },
  factor,
  ink: [255, 255, 255],
  halo: [0, 0, 0],
});
const WHITE = 'rgb(255, 255, 255)';
const BLACK = 'rgb(0, 0, 0)';

describe('FR-329 the marker ring: white 2 px over black 4 px, drawn after the texts', () => {
  it('FR-329 two strokes of one circle: black 4 wide, then white 2 wide, at the marker centre and radius', () => {
    const { draw, log } = fakeLayer();
    draw([], view, { marker: { x: 123.5, y: 77.25, r: 21.5 } });
    const arcs = log.filter((e) => e.call === 'arc');
    expect(arcs).toHaveLength(1);
    expect(arcs[0]!.args).toStrictEqual([123.5, 77.25, 21.5, 0, 2 * Math.PI]);
    const strokes = log.filter((e) => e.call === 'stroke');
    expect(strokes.map((e) => [e.style, e.width])).toStrictEqual([[BLACK, 4], [WHITE, 2]]);
    expect(log.findIndex((e) => e.call === 'arc')).toBeLessThan(log.findIndex((e) => e.call === 'stroke'));
  });

  it('FR-329 FR-333 the overlay is drawn after every text, and never with a label opacity', () => {
    const { draw, log } = fakeLayer();
    draw([label(0.35), label(1)], view, { marker: { x: 10, y: 10, r: 20 }, indicator: { x: 50, y: 12, angle: 0.5 } });
    const lastText = Math.max(...log.map((e, i) => (e.call === 'fillText' || e.call === 'strokeText' ? i : -1)));
    const firstOverlay = log.findIndex((e) => e.call === 'arc');
    expect(lastText).toBeGreaterThan(0);
    expect(firstOverlay).toBeGreaterThan(lastText);
    // The faded label drew at 0.35; every overlay stroke and fill is at full opacity.
    expect(log.some((e) => e.call === 'fillText' && e.alpha === 0.35)).toBe(true);
    for (const e of log.slice(firstOverlay - 1)) {
      if (['stroke', 'fill', 'arc', 'moveTo', 'lineTo'].includes(e.call)) expect(e.alpha, e.call).toBe(1);
    }
  });

  it('FR-329 nothing is drawn over the labels when no overlay is given (the 006 and 007 drawing is unchanged)', () => {
    const plain = fakeLayer();
    plain.draw([label(1)], view);
    const withNone = fakeLayer();
    withNone.draw([label(1)], view, {});
    expect(withNone.log.map((e) => e.call)).toStrictEqual(plain.log.map((e) => e.call));
    expect(plain.log.some((e) => e.call === 'arc' || e.call === 'closePath' || e.call === 'fill')).toBe(false);
  });
});

describe('FR-333 the edge triangle: filled white with a 1 px black halo, 12 px long', () => {
  it('FR-333 a closed triangle whose tip is the indicator point and whose base lies 12 px behind it along the angle', () => {
    const { draw, log } = fakeLayer();
    draw([], view, { indicator: { x: 200, y: 12, angle: -Math.PI / 2 } });
    const moves = log.filter((e) => e.call === 'moveTo');
    const lines = log.filter((e) => e.call === 'lineTo');
    expect(moves).toHaveLength(1);
    expect(lines).toHaveLength(2);
    const tip = moves[0]!.args as number[];
    expect(tip[0]).toBeCloseTo(200, 9);
    expect(tip[1]).toBeCloseTo(12, 9);
    // Pointing up (angle -90 degrees): the base is 12 px below the tip, 12 px wide.
    const [a, b] = lines.map((e) => e.args as number[]) as [number[], number[]];
    expect(a[1]).toBeCloseTo(24, 9);
    expect(b[1]).toBeCloseTo(24, 9);
    expect(Math.abs(a[0]! - b[0]!)).toBeCloseTo(12, 9);
    expect((a[0]! + b[0]!) / 2).toBeCloseTo(200, 9);
    expect(log.some((e) => e.call === 'closePath')).toBe(true);
  });

  it('FR-333 the black halo is stroked 2 wide before the white fill, so 1 px of it shows outside', () => {
    const { draw, log } = fakeLayer();
    draw([], view, { indicator: { x: 30, y: 40, angle: 1 } });
    const stroke = log.findIndex((e) => e.call === 'stroke');
    const fill = log.findIndex((e) => e.call === 'fill');
    expect(stroke).toBeGreaterThan(-1);
    expect(fill).toBeGreaterThan(stroke);
    expect([log[stroke]!.style, log[stroke]!.width]).toStrictEqual([BLACK, 2]);
    expect(log[fill]!.fill).toBe(WHITE);
  });

  it('FR-333 the triangle follows the angle: a tip pointing right has its base to the left of the tip', () => {
    const { draw, log } = fakeLayer();
    draw([], view, { indicator: { x: 388, y: 150, angle: 0 } });
    const lines = log.filter((e) => e.call === 'lineTo').map((e) => e.args as number[]);
    for (const p of lines) expect(p[0]).toBeCloseTo(376, 9);
    expect(lines.map((p) => p[1]).sort((x, y) => x! - y!)).toStrictEqual([144, 156]);
  });
});
