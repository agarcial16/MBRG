import { FloatType, NearestFilter, NoColorSpace, RedFormat } from 'three';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Rgb } from '@mbrg/shared';
import webManifestRaw from '../package.json?raw';
import lockRaw from '../../../package-lock.json?raw';
import indexHtml from '../index.html?raw';
import { BORDER_PRIORITY } from '../src/core/borders';
import type { Camera, Viewport } from '../src/core/camera';
import { assignFactionColors } from '../src/core/colors';
import { buildEntryIndex, factionColorList } from '../src/core/entries';
import type { FrontField } from '../src/core/front';
import { labelAlpha, screenBox } from '../src/core/label-frame';
import type { AnyLabelDraw, LabelDraw } from '../src/core/label-frame';
import { LABEL_PARAMS, fontString } from '../src/core/label-params';
import { THEME, toMapTheme } from '../src/core/theme';
import { TRANSITION_PRIORITY } from '../src/core/transition-shade';
import { attachLabelLayer } from '../src/render/labels-layer';
import type { TourOverlay } from '../src/render/labels-layer';
import { createMapScene } from '../src/render/map-scene';
import type { MapFront, MapScene, MapView } from '../src/render/map-scene';
import { FRAGMENT_SHADER } from '../src/render/shader';
import { DEV_MAP, DEV_PRESENTATION } from './helpers/dev-map';

// Rendering part of spec 005: the colour front branch (FR-179, FR-180, FR-188), the label layer (FR-173,
// FR-175) and the dependency rule (NFR-36). Three.js objects work in Node; the drawing itself needs WebGL
// and is compared with the reference renderer in the browser (task T7 report).

// ---------------------------------------------------------------------------------------------------------------
// NFR-36 (spec 005 adds no dependency). The set below is the 004 set (libraries.test.ts pins versions and licences) plus the
// internal workspace @mbrg/protocol of spec 008 (M5, H4 and D30; no third-party package).
const RUNTIME = { '@mbrg/protocol': '*', '@mbrg/shared': '*', '@mbrg/sim': '*', three: '0.186.1' };
const DEV = { '@types/three': '0.186.0', vite: '8.3.4' };
/** Every spec 008 workspace entry and its link (A1): apps/server, packages/protocol and their node_modules/@mbrg links. */
const SPEC_008_ENTRY = /^(?:apps\/server|packages\/protocol|node_modules\/@mbrg\/(?:server|protocol))$/;
/** Number of entries of package-lock.json at the end of spec 004 (root, workspaces and every package). */
const LOCK_ENTRIES = 138;

const manifest = JSON.parse(webManifestRaw) as any;
const lock = JSON.parse(lockRaw) as any;

describe('NFR-36 no dependency is added for labels and transitions', () => {
  it('NFR-36 the viewer manifest declares exactly the 004 dependencies and nothing else', () => {
    expect(manifest.dependencies).toStrictEqual(RUNTIME);
    expect(manifest.devDependencies).toStrictEqual(DEV);
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();
  });

  it('NFR-36 the lockfile entry of the viewer equals its manifest and the lockfile has the 004 entries', () => {
    const entry = lock.packages['apps/web'];
    expect(entry).toBeDefined();
    expect(entry.dependencies).toStrictEqual(RUNTIME);
    expect(entry.devDependencies).toStrictEqual(DEV);
    expect(entry.peerDependencies).toBeUndefined();
    expect(entry.optionalDependencies).toBeUndefined();
    // Spec 008 adds its own workspaces and their links only (NFR-53).
    expect(Object.keys(lock.packages).filter((k) => !SPEC_008_ENTRY.test(k))).toHaveLength(LOCK_ENTRIES);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('FR-173 the label canvas lies over the map canvas and takes no pointer events', () => {
  const tag = (id: string): string => new RegExp(`<[^>]*\\bid="${id}"[^>]*>`).exec(indexHtml)?.[0] ?? '';
  const at = (id: string): number => indexHtml.search(new RegExp(`\\bid="${id}"`));

  it('FR-173 index.html has a second canvas, #labels, after #map and before #panel', () => {
    expect(indexHtml.match(/<canvas\b/g)).toHaveLength(2);
    expect(tag('labels').startsWith('<canvas')).toBe(true);
    expect(at('map')).toBeGreaterThan(-1);
    expect(at('labels')).toBeGreaterThan(at('map'));
    expect(at('panel')).toBeGreaterThan(at('labels'));
  });

  it('FR-173 the label canvas covers the map and ignores the pointer, so input still reaches the map canvas', () => {
    const t = tag('labels');
    expect(t).toMatch(/pointer-events:\s*none/);
    expect(t).toMatch(/position:\s*(absolute|fixed)/);
    expect(t).toMatch(/width:\s*100%/);
    expect(t).toMatch(/height:\s*100%/);
    expect(t).not.toMatch(/z-index/);
  });

  it('FR-173 the label layer is a source under src/render, so the FR-159 scan covers it', () => {
    const sources = import.meta.glob('../src/render/*.ts', { query: '?raw', import: 'default', eager: true });
    expect(Object.keys(sources).sort()).toStrictEqual([
      '../src/render/labels-layer.ts',
      '../src/render/map-scene.ts',
      '../src/render/renderer.ts',
      '../src/render/shader.ts',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
const colors = assignFactionColors(DEV_MAP, DEV_PRESENTATION, THEME);
if (!colors.ok) throw new Error('dev map colours');
const colorList: Rgb[] = factionColorList(DEV_MAP, colors.value);

function make(): { entries: number; scene: MapScene } {
  const ids = DEV_MAP.territories.slice(0, 3).map((e) => e.id);
  const index = buildEntryIndex(DEV_MAP, 3, 2, [0, ids[0]!, ids[1]!, ids[2]!, ids[0]!, 0]);
  return { entries: index.ids.length, scene: createMapScene(index, colorList, toMapTheme(THEME)) };
}

const versions = (s: MapScene): number[] => [s.textures.index, s.textures.kinds, s.textures.owners, s.textures.colors].map((t) => t.version);

function field(values: number[], width: number, height: number, x0 = 0, y0 = 0): FrontField {
  return { x0, y0, width, height, values: new Float32Array(values) };
}

function earlier(entries: number, fill = 0): Uint8Array {
  return new Uint8Array(entries).fill(fill);
}

describe('FR-188 setFront hands the colour front to the rendering part as data', () => {
  it('FR-188 setFront uploads the earlier owners and the front, and leaves index, kinds, owners and colours alone', () => {
    const { entries, scene } = make();
    const base = versions(scene);
    const beforeVersion = scene.textures.before.version;
    const f = field([0, 0.5, 1, -1, 0.25, 0], 3, 2);
    const table = earlier(entries, 2);
    table[1] = 4;
    scene.setFront({ before: table, field: f, forward: 0.25 });

    expect(versions(scene)).toStrictEqual(base);
    expect(scene.textures.before.version).toBe(beforeVersion + 1);
    expect([...(scene.textures.before.image.data as Uint8Array)]).toStrictEqual([...table]);
    expect(scene.textures.before.format).toBe(RedFormat);
    expect(scene.textures.before.image.width).toBe(entries);

    const t = scene.textures.front;
    expect(t.format).toBe(RedFormat);
    expect(t.type).toBe(FloatType);
    expect(t.image.width).toBe(3);
    expect(t.image.height).toBe(2);
    expect(t.image.data).toBe(f.values);
    expect(t.version).toBeGreaterThan(0);
  });

  it('FR-188 the front texture is sampled Nearest, without mipmaps, flip, premultiplication or colour space (R32F)', () => {
    const { entries, scene } = make();
    scene.setFront({ before: earlier(entries), field: field([0, 1, 0, 1, 0, 1], 3, 2), forward: 0.5 });
    for (const t of [scene.textures.front, scene.textures.before]) {
      expect(t.minFilter).toBe(NearestFilter);
      expect(t.magFilter).toBe(NearestFilter);
      expect(t.generateMipmaps).toBe(false);
      expect(t.flipY).toBe(false);
      expect(t.premultiplyAlpha).toBe(false);
      expect(t.colorSpace).toBe(NoColorSpace);
      expect(t.unpackAlignment).toBe(1);
    }
  });

  it('FR-188 the front and its box and progress reach the shader as uniforms', () => {
    const { entries, scene } = make();
    const u = scene.material.uniforms;
    expect(u.uFrontOn!.value).toBe(0);
    scene.setFront({ before: earlier(entries), field: field([0, 1, 0, 1], 2, 2, 5, 7), forward: 0.375 });
    expect(u.uFrontOn!.value).toBe(1);
    expect(u.uProgress!.value).toBe(0.375);
    const box = u.uFrontBox!.value as { x: number; y: number; z: number; w: number };
    expect([box.x, box.y, box.z, box.w]).toStrictEqual([5, 7, 2, 2]);
  });

  it('FR-188 further frames of one step only change the forward progress: nothing is uploaded again', () => {
    const { entries, scene } = make();
    const f = field([0, 0.5, 1, 0, 0.5, 1], 3, 2);
    scene.setFront({ before: earlier(entries, 1), field: f, forward: 0.1 });
    const base = [...versions(scene), scene.textures.before.version, scene.textures.front.version];
    const frontTexture = scene.textures.front;
    for (const forward of [0.2, 0.7, 0.9]) {
      scene.setFront({ before: earlier(entries, 1), field: f, forward });
      expect(scene.material.uniforms.uProgress!.value).toBe(forward);
    }
    expect([...versions(scene), scene.textures.before.version, scene.textures.front.version]).toStrictEqual(base);
    expect(scene.textures.front).toBe(frontTexture);
  });

  it('FR-188 a different earlier table uploads only that table; a different field replaces only the front texture', () => {
    const { entries, scene } = make();
    const f = field([0, 0.5, 1, 0, 0.5, 1], 3, 2);
    scene.setFront({ before: earlier(entries, 1), field: f, forward: 0.5 });
    const frontVersion = scene.textures.front.version;
    const beforeVersion = scene.textures.before.version;
    scene.setFront({ before: earlier(entries, 2), field: f, forward: 0.5 });
    expect(scene.textures.before.version).toBe(beforeVersion + 1);
    expect(scene.textures.front.version).toBe(frontVersion);

    const old = scene.textures.front;
    let disposed = false;
    old.addEventListener('dispose', () => (disposed = true));
    const g = field([0, 1, 0.5, 0.25], 2, 2);
    scene.setFront({ before: earlier(entries, 2), field: g, forward: 0.5 });
    expect(scene.textures.front).not.toBe(old);
    expect(scene.textures.front.image.data).toBe(g.values);
    expect(disposed).toBe(true);
    expect(scene.textures.before.version).toBe(beforeVersion + 1);
  });

  it('FR-188 setFront(undefined) turns the front branch off and uploads nothing', () => {
    const { entries, scene } = make();
    scene.setFront({ before: earlier(entries), field: field([0, 1, 0, 1], 2, 2), forward: 0.5 });
    const base = [...versions(scene), scene.textures.before.version, scene.textures.front.version];
    scene.setFront(undefined);
    expect(scene.material.uniforms.uFrontOn!.value).toBe(0);
    expect([...versions(scene), scene.textures.before.version, scene.textures.front.version]).toStrictEqual(base);
    scene.setFront({ before: earlier(entries), field: field([0, 1, 0, 1], 2, 2), forward: 0.5 });
    expect(scene.material.uniforms.uFrontOn!.value).toBe(1);
  });

  it('FR-179 a forward progress of 1 is the later drawing itself, so the front branch is off', () => {
    const { entries, scene } = make();
    scene.setFront({ before: earlier(entries), field: field([0, 1, 0, 1], 2, 2), forward: 1 });
    expect(scene.material.uniforms.uFrontOn!.value).toBe(0);
  });

  it('FR-188 progress outside 0..1 or not a number, and a table of the wrong size, are refused', () => {
    const { entries, scene } = make();
    const f = field([0, 1, 0, 1], 2, 2);
    for (const forward of [-0.1, 1.5, Number.NaN, Infinity]) {
      expect(() => scene.setFront({ before: earlier(entries), field: f, forward }), String(forward)).toThrow(RangeError);
    }
    expect(() => scene.setFront({ before: earlier(entries + 1), field: f, forward: 0.5 })).toThrow(RangeError);
    expect(() => scene.setFront({ before: earlier(1), field: f, forward: 0.5 })).toThrow(RangeError);
    expect(() => scene.setFront({ before: earlier(entries), field: { ...f, values: new Float32Array(3) }, forward: 0.5 })).toThrow(RangeError);
  });

  it('FR-188 an empty front field is accepted and holds no distance (the box test fails everywhere)', () => {
    const { entries, scene } = make();
    scene.setFront({ before: earlier(entries), field: field([], 0, 0), forward: 0.5 });
    const box = scene.material.uniforms.uFrontBox!.value as { z: number; w: number };
    expect([box.z, box.w]).toStrictEqual([0, 0]);
    expect(scene.textures.front.image.width).toBe(1);
    expect(scene.textures.front.image.height).toBe(1);
  });

  it('FR-188 type-level: setFront takes one MapFront or undefined and the data has no seed, round or record', () => {
    expectTypeOf<MapScene['setFront']>().parameters.toEqualTypeOf<[MapFront | undefined]>();
    expectTypeOf<keyof MapFront>().toEqualTypeOf<'before' | 'field' | 'forward'>();
    expectTypeOf<MapFront['before']>().toEqualTypeOf<Uint8Array>();
    expectTypeOf<MapFront['field']>().toEqualTypeOf<FrontField>();
    expectTypeOf<MapFront['forward']>().toEqualTypeOf<number>();
    expect(true).toBe(true);
  });

  it('FR-188 the 004 pinned members are still there (setOwners, setView), and setOwners still touches only the owners', () => {
    const { entries, scene } = make();
    expectTypeOf<MapScene['setOwners']>().parameters.toEqualTypeOf<[Uint8Array]>();
    expectTypeOf<MapScene['setView']>().parameters.toEqualTypeOf<[MapView]>();
    const base = versions(scene);
    scene.setOwners(new Uint8Array(entries).fill(1));
    expect(versions(scene).map((v, i) => v - base[i]!)).toStrictEqual([0, 0, 1, 0]);
  });
});

describe('FR-179 FR-180 the shader draws the front with the reference rules', () => {
  it('FR-180 uProgress is declared once, as the only progress uniform', () => {
    expect(FRAGMENT_SHADER.match(/\buniform\s+(?:\w+\s+)*?uProgress\s*;/g)).toHaveLength(1);
    expect(FRAGMENT_SHADER.match(/\buProgress\b/g)!.length).toBeGreaterThan(1);
  });

  it('FR-180 the step border classes are numbered in the order of TRANSITION_PRIORITY, generated from it', () => {
    TRANSITION_PRIORITY.forEach((name, i) => {
      expect(FRAGMENT_SHADER).toContain(`const int S_${name.toUpperCase().replace('-', '_')} = ${i};`);
    });
    const baseOfStep = TRANSITION_PRIORITY.map((n) => BORDER_PRIORITY.indexOf(n === 'absorbed' ? 'faction' : n));
    expect(FRAGMENT_SHADER).toContain(`const int BASE_OF_STEP[${baseOfStep.length}] = int[${baseOfStep.length}](${baseOfStep.join(', ')});`);
    const stepOfBase = BORDER_PRIORITY.map((n) => TRANSITION_PRIORITY.indexOf(n));
    expect(FRAGMENT_SHADER).toContain(`const int STEP_OF_BASE[${stepOfBase.length}] = int[${stepOfBase.length}](${stepOfBase.join(', ')});`);
    expect(baseOfStep).not.toContain(-1);
    expect(stepOfBase).not.toContain(-1);
  });

  it('FR-179 the front is read with texelFetch, compared with a strict less-than, and only for entries that change owner', () => {
    expect(FRAGMENT_SHADER).toMatch(/texelFetch\(uFront,/);
    expect(FRAGMENT_SHADER).toMatch(/uOwnersBefore/);
    expect(FRAGMENT_SHADER).toMatch(/!\(\s*d\s*<\s*uProgress\s*\)/);
    expect(FRAGMENT_SHADER).not.toMatch(/\btexture\s*\(/);
  });

  it('FR-180 the step class of a land edge: owners differ now is faction, same now but not before is absorbed', () => {
    expect(FRAGMENT_SHADER).toContain('if (byteAt(uOwners, a) != byteAt(uOwners, b)) return S_FACTION;');
    expect(FRAGMENT_SHADER).toContain('return byteAt(uOwnersBefore, a) == byteAt(uOwnersBefore, b) ? S_TERRITORY : S_ABSORBED;');
  });

  it('FR-180 a real faction line wins over the interpolated line (the D8 order is the reference order)', () => {
    expect(TRANSITION_PRIORITY.slice(0, 2)).toStrictEqual(['faction', 'absorbed']);
    expect(FRAGMENT_SHADER.indexOf('const int S_FACTION = 0;')).toBeGreaterThan(-1);
    expect(FRAGMENT_SHADER.indexOf('const int S_ABSORBED = 1;')).toBeGreaterThan(-1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
type Matrix = { sx: number; sy: number; tx: number; ty: number };
interface Drawn {
  op: 'stroke' | 'fill';
  text: string;
  style: string;
  alpha: number;
  fontPx: number;
  lineWidth: number;
  lineJoin: string;
  /** Centre of the text in CSS pixels. */
  cx: number;
  cy: number;
  /** Advance width of the text as drawn, in CSS pixels. */
  width: number;
}

/** A recording 2D context whose text is `0.6 x font size` wide per character; it tracks the transform. */
function fakeLayer() {
  const drawn: Drawn[] = [];
  const log: string[] = [];
  const transforms: number[][] = [];
  let m: Matrix = { sx: 1, sy: 1, tx: 0, ty: 0 };
  const stack: Matrix[] = [];
  let dpr = 1;
  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    setTransform(a: number, _b: number, _c: number, d: number, e: number, f: number) {
      dpr = a;
      m = { sx: a, sy: d, tx: e, ty: f };
      log.push('setTransform');
      transforms.push([a, _b, _c, d, e, f]);
    },
    clearRect() {
      log.push('clearRect');
    },
    save() {
      stack.push({ ...m });
    },
    restore() {
      m = stack.pop()!;
    },
    translate(x: number, y: number) {
      m = { ...m, tx: m.tx + m.sx * x, ty: m.ty + m.sy * y };
    },
    scale(x: number, y: number) {
      m = { ...m, sx: m.sx * x, sy: m.sy * y };
    },
    measureText(text: string) {
      return { width: text.length * 0.6 * ctx.fontPx() };
    },
    fontPx() {
      return Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)![1]);
    },
    strokeText(text: string, x: number, y: number) {
      record('stroke', text, x, y);
    },
    fillText(text: string, x: number, y: number) {
      record('fill', text, x, y);
    },
  };
  const record = (op: 'stroke' | 'fill', text: string, x: number, y: number) => {
    expect(ctx.textAlign).toBe('center');
    expect(ctx.textBaseline).toBe('middle');
    drawn.push({
      op,
      text,
      style: op === 'fill' ? ctx.fillStyle : ctx.strokeStyle,
      alpha: ctx.globalAlpha,
      fontPx: ctx.fontPx(),
      lineWidth: ctx.lineWidth,
      lineJoin: ctx.lineJoin,
      cx: (m.tx + m.sx * x) / dpr,
      cy: (m.ty + m.sy * y) / dpr,
      width: (ctx.measureText(text).width * m.sx) / dpr,
    });
  };
  const canvas = { width: 0, height: 0, getContext: (kind: string) => (kind === '2d' ? ctx : null) } as unknown as HTMLCanvasElement;
  return { canvas, drawn, log, transforms };
}

const VP: Viewport = { width: 400, height: 300 };
const label = (over: Partial<LabelDraw> = {}): LabelDraw => ({
  text: 'Francia',
  role: 'faction',
  box: { x0: 100, y0: 200, h: 20, w: 80 },
  factor: 1,
  ink: [0, 0, 0],
  halo: [255, 255, 255],
  ...over,
});
const view = (scale: number, dpr = 1, x = 130, y = 210): MapView => ({ camera: { x, y, scale } satisfies Camera, viewport: VP, dpr });

describe('FR-175 the label layer draws horizontal text in its exact box at the device resolution', () => {
  it('FR-175 resize sets the label canvas to round(width x dpr) by round(height x dpr) device pixels', () => {
    const { canvas } = fakeLayer();
    const layer = attachLabelLayer(canvas);
    layer.resize({ width: 999, height: 501 }, 1.5);
    expect([canvas.width, canvas.height]).toStrictEqual([1499, 752]);
    layer.resize(VP, 1);
    expect([canvas.width, canvas.height]).toStrictEqual([400, 300]);
  });

  it('FR-175 the text box on screen is the label box times the scale: width within 1 pixel, height as the font size', () => {
    for (const [scale, dpr] of [[0.5, 1], [1, 2], [1.1, 1.25], [0.9, 1]] as const) {
      const { canvas, drawn } = fakeLayer();
      const layer = attachLabelLayer(canvas);
      layer.resize(VP, dpr);
      const l = label({ text: 'Alemania' });
      const v = view(scale, dpr);
      layer.draw([l], v);
      const sb = screenBox(l.box, v.camera, VP);
      const fill = drawn.find((d) => d.op === 'fill')!;
      expect(fill.fontPx, `${scale}`).toBeCloseTo(sb.h, 9);
      expect(fill.width, `${scale}`).toBeCloseTo(sb.w, 9);
      expect(fill.cx).toBeCloseTo(sb.x + sb.w / 2, 9);
      expect(fill.cy).toBeCloseTo(sb.y + sb.h / 2, 9);
    }
  });

  it('FR-175 the horizontal correction fits the width exactly whatever the measured advance is', () => {
    const { canvas, drawn } = fakeLayer();
    const layer = attachLabelLayer(canvas);
    layer.resize(VP, 1);
    // 'iiiiiiiiii' is 10 characters, 'W' is 1: the fake measures by length, the box does not care.
    const boxes = [{ x0: 100, y0: 200, h: 20, w: 33.3 }, { x0: 100, y0: 200, h: 16, w: 110 }];
    for (const box of boxes) {
      drawn.length = 0;
      layer.draw([label({ text: 'iiiiiiiiii', box })], view(1));
      expect(drawn.at(-1)!.width).toBeCloseTo(box.w, 9);
      drawn.length = 0;
      layer.draw([label({ text: 'W', box })], view(1));
      expect(drawn.at(-1)!.width).toBeCloseTo(box.w, 9);
    }
  });

  it('FR-174 the halo (stroke, 2 CSS pixels wide, round join) is drawn before the text, in the halo and ink colours', () => {
    const { canvas, drawn } = fakeLayer();
    const layer = attachLabelLayer(canvas);
    layer.resize(VP, 1);
    layer.draw([label({ ink: [255, 255, 255], halo: [0, 0, 0] })], view(1));
    expect(drawn.map((d) => d.op)).toStrictEqual(['stroke', 'fill']);
    expect(drawn[0]!.style).toBe('rgb(0, 0, 0)');
    expect(drawn[0]!.lineJoin).toBe('round');
    expect(drawn[0]!.lineWidth).toBeCloseTo(2, 1);
    expect(drawn[1]!.style).toBe('rgb(255, 255, 255)');
    expect(drawn[0]!.text).toBe('Francia');
  });

  it('FR-172 the label opacity is the opacity of the scale times the factor, and fully faded labels are not drawn', () => {
    const { canvas, drawn } = fakeLayer();
    const layer = attachLabelLayer(canvas);
    layer.resize(VP, 1);
    const mid = (LABEL_PARAMS.fadeStart + LABEL_PARAMS.fadeFull) / 2;
    const l = label({ factor: 0.5, box: { x0: 100, y0: 200, h: 20, w: 80 } });
    layer.draw([l], view(mid));
    expect(drawn.length).toBe(2);
    expect(drawn[1]!.alpha).toBeCloseTo(labelAlpha(l, mid, LABEL_PARAMS), 12);
    expect(drawn[1]!.alpha).toBeGreaterThan(0);
    expect(drawn[1]!.alpha).toBeLessThan(0.5);

    drawn.length = 0;
    layer.draw([l], view(LABEL_PARAMS.fadeFull + 1));
    expect(drawn).toStrictEqual([]);
    layer.draw([label({ role: 'territory' })], view(LABEL_PARAMS.fadeStart));
    expect(drawn).toStrictEqual([]);
    layer.draw([label({ factor: 0 })], view(1));
    expect(drawn).toStrictEqual([]);
  });

  it('FR-172 a label under P screen pixels high is not drawn; exactly P is', () => {
    const { canvas, drawn } = fakeLayer();
    const layer = attachLabelLayer(canvas);
    layer.resize(VP, 1);
    const box = { x0: 100, y0: 200, h: 8, w: 40 };
    layer.draw([label({ box })], view(LABEL_PARAMS.minPx / 8 - 0.001));
    expect(drawn).toStrictEqual([]);
    layer.draw([label({ box })], view(LABEL_PARAMS.minPx / 8));
    expect(drawn.length).toBe(2);
  });

  it('FR-175 labels whose box is wholly outside the drawing area are skipped, partly visible ones are drawn', () => {
    const { canvas, drawn } = fakeLayer();
    const layer = attachLabelLayer(canvas);
    layer.resize(VP, 1);
    layer.draw([label({ text: 'Lejos', box: { x0: 5000, y0: 200, h: 20, w: 80 } })], view(1));
    expect(drawn).toStrictEqual([]);
    layer.draw([label({ text: 'Borde', box: { x0: 130 - 200 - 40, y0: 205, h: 20, w: 80 } })], view(1));
    expect(drawn.map((d) => d.text)).toStrictEqual(['Borde', 'Borde']);
  });

  it('FR-173 each frame clears the layer first, in device resolution, and draws labels in the order given', () => {
    const { canvas, drawn, log } = fakeLayer();
    const layer = attachLabelLayer(canvas);
    layer.resize(VP, 2);
    layer.draw([label({ text: 'Uno' }), label({ text: 'Dos' })], view(1, 2));
    expect(log.slice(0, 2)).toStrictEqual(['setTransform', 'clearRect']);
    expect(drawn.map((d) => `${d.op}:${d.text}`)).toStrictEqual(['stroke:Uno', 'fill:Uno', 'stroke:Dos', 'fill:Dos']);
    layer.draw([], view(1, 2));
    expect(log.filter((x) => x === 'clearRect')).toHaveLength(2);
  });

  it('FR-175 the layer draws in device pixels: the transform is the device pixel ratio, set on every frame', () => {
    const { canvas, transforms } = fakeLayer();
    const layer = attachLabelLayer(canvas);
    layer.resize(VP, 2);
    layer.draw([label()], view(1, 2));
    layer.draw([label()], view(1, 2));
    expect(transforms).toStrictEqual([[2, 0, 0, 2, 0, 0], [2, 0, 0, 2, 0, 0]]);
  });

  it('FR-175 the font is the label font at the drawn size and the layer writes no text of its own', () => {
    const { canvas, drawn } = fakeLayer();
    const layer = attachLabelLayer(canvas);
    layer.resize(VP, 1);
    layer.draw([label()], view(1.5));
    expect(drawn[0]!.fontPx).toBeCloseTo(30, 9);
    expect(fontString(30)).toContain('600 30px');
  });

  it('FR-175 type-level: attachLabelLayer takes a canvas and gives resize and draw', () => {
    expectTypeOf(attachLabelLayer).parameters.toEqualTypeOf<[HTMLCanvasElement]>();
    expectTypeOf<ReturnType<typeof attachLabelLayer>>().toHaveProperty('resize');
    expectTypeOf<ReturnType<typeof attachLabelLayer>['resize']>().parameters.toEqualTypeOf<[Viewport, number]>();
    expectTypeOf<ReturnType<typeof attachLabelLayer>['draw']>().parameters.toEqualTypeOf<[readonly AnyLabelDraw[], MapView, (TourOverlay | undefined)?]>();
    expect(true).toBe(true);
  });

  it('FR-175 a canvas without a 2D context is reported', () => {
    const none = { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => attachLabelLayer(none)).toThrow();
  });
});
