import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MapData, PresentationData } from '@mbrg/shared';
import { getRounds, getState, ownerOf, totalRounds } from '@mbrg/sim';
import type { Camera, Viewport } from '../src/core/camera';
import { initialCamera } from '../src/core/camera';
import { CENTRE_PARAMS } from '../src/core/centre-params';
import { buildEntryIndex, factionIndexOf, ownerTable } from '../src/core/entries';
import { LABEL_HALO, LABEL_INK, frameOf } from '../src/core/label-frame';
import type { AnyLabelDraw, LabelDraw, ShapedDraw } from '../src/core/label-frame';
import { labelTexts } from '../src/core/label-input';
import { LABEL_PARAMS } from '../src/core/label-params';
import {
  READABLE_PARAMS,
  allCandidateTexts,
  clampScreenHeight,
  placeReadableFactions,
  placeReadableTerritories,
  readableRoundLabels,
  resolveFrameLabels,
  selectTier,
  stepReadableLabels,
  tierDraws,
  upgradeTourDraws,
} from '../src/core/label-readable';
import type { LabelTier, ReadableDraw } from '../src/core/label-readable';
import { parsePackage } from '../src/core/package';
import { buildPieceIndex } from '../src/core/regions';
import { sceneAt } from '../src/core/scene';
import { SHAPE_PARAMS } from '../src/core/shape-params';
import { attachLabelLayer } from '../src/render/labels-layer';
import { inflateStream } from '../src/ui/load';

const VP: Viewport = { width: 1280, height: 720 };
const cam = (scale: number, x = 500, y = 500): Camera => ({ x, y, scale });

const boxLabel = (text: string, x0: number, y0: number, h: number, w: number, role: 'faction' | 'territory' = 'faction', factor = 1): LabelDraw => ({
  text,
  role,
  box: { x0, y0, h, w },
  factor,
  ink: LABEL_INK,
  halo: LABEL_HALO,
});

const straightLabel = (text: string, cx: number, cy: number, h: number, w: number, angle: number, role: 'faction' | 'territory' = 'faction'): ShapedDraw => ({
  text,
  role,
  frame: { shape: 'straight', cx, cy, angle, h, w },
  factor: 1,
  ink: LABEL_INK,
  halo: LABEL_HALO,
});

describe('spec 032 FR-621 (amended) anchored zoom scaling and viewport-relative ceiling', () => {
  it('FR-621 hides below minPx (9 px), scales 1:1 past 48/28 px, and caps at 25% of viewport height', () => {
    expect(READABLE_PARAMS.minPx).toBe(9);
    expect(READABLE_PARAMS.maxViewportFraction).toBe(0.25);

    expect(clampScreenHeight(8.9, 720)).toBe(0);
    expect(clampScreenHeight(9, 720)).toBe(9);
    expect(clampScreenHeight(32, 720)).toBe(32);
    expect(clampScreenHeight(64, 720)).toBe(64);
    expect(clampScreenHeight(120, 720)).toBe(120);
    expect(clampScreenHeight(240, 720)).toBe(180);
    expect(clampScreenHeight(300, 1080)).toBe(270);
    // Tiny viewport floors ceiling at minPx so readable labels are never suppressed.
    expect(clampScreenHeight(15, 20)).toBe(9);
  });
});

describe('spec 032 FR-623 FR-624 zoom-in tier selection and hiding unreadable labels', () => {
  const tiers: LabelTier[] = [
    { text: 'Santa Cruz de Tenerife', box: { x0: 100, y0: 100, h: 8, w: 80 }, height: 8 },
    { text: 'S. C. Tenerife', box: { x0: 100, y0: 100, h: 14, w: 70 }, height: 14 },
    { text: 'SCT', box: { x0: 100, y0: 100, h: 24, w: 36 }, height: 24 },
  ];

  it('FR-623 picks the fullest tier whose on-screen height reaches minPx, expanding as scale increases', () => {
    // scale 0.5 -> heights 4, 7, 12 -> picks SCT
    expect(selectTier(tiers, 0.5)?.text).toBe('SCT');
    // scale 0.7 -> heights 5.6, 9.8, 16.8 -> expands to S. C. Tenerife
    expect(selectTier(tiers, 0.7)?.text).toBe('S. C. Tenerife');
    // scale 1.2 -> heights 9.6, 16.8, 28.8 -> expands to full name
    expect(selectTier(tiers, 1.2)?.text).toBe('Santa Cruz de Tenerife');
  });

  it('FR-624 hides the label when even the shortest tier is below minPx', () => {
    // scale 0.3 -> max height 7.2 < 9 -> hidden
    expect(selectTier(tiers, 0.3)).toBeUndefined();
    expect(selectTier([], 2)).toBeUndefined();
  });

  it('FR-623 tierDraws converts active tier to a standard AnyLabelDraw with no leader line', () => {
    const draw = tierDraws(tiers, 'faction', 1, 0.5);
    expect(draw).toBeDefined();
    expect(draw!.text).toBe('SCT');
    expect('leader' in draw!).toBe(false);
  });
});

describe('spec 032 FR-620 no overlapping on-screen footprints within the same role', () => {
  it('FR-620 drops lower-priority colliding labels of the same role and enforces minimum visual gap', () => {
    // Two faction labels overlapping on screen at scale 1
    const big = boxLabel('Madrid', 480, 490, 24, 96, 'faction');
    const small = boxLabel('Ávila', 490, 495, 14, 56, 'faction');
    const far = boxLabel('Cuenca', 620, 490, 18, 72, 'faction');
    const resolved = resolveFrameLabels([small, big, far], cam(1), VP, READABLE_PARAMS);
    expect(resolved.map((d) => d.text)).toStrictEqual(['Madrid', 'Cuenca']);
  });

  it('FR-620 keeps labels of different roles independent (faction/territory crossfade allowed)', () => {
    const fac = boxLabel('Madrid', 480, 490, 24, 96, 'faction');
    const ter = boxLabel('Madrid', 480, 490, 16, 64, 'territory');
    const resolved = resolveFrameLabels([fac, ter], cam(1), VP, READABLE_PARAMS);
    expect(resolved.map((d) => `${d.role}:${d.text}`)).toStrictEqual(['faction:Madrid', 'territory:Madrid']);
  });

  it('FR-620 rejects two adjacent labels whose gap is smaller than minGapPx', () => {
    // First ends at x = 500, second starts at x = 501 (gap 1 px < minGapPx 4 px)
    const a = boxLabel('Uno', 460, 490, 16, 40, 'faction');
    const b = boxLabel('Dos', 501, 490, 14, 40, 'faction');
    const resolved = resolveFrameLabels([a, b], cam(1), VP, READABLE_PARAMS);
    expect(resolved.map((d) => d.text)).toStrictEqual(['Uno']);

    // Gap 6 px >= minGapPx 4 px -> both kept
    const c = boxLabel('Dos', 506, 490, 14, 40, 'faction');
    const resolved2 = resolveFrameLabels([a, c], cam(1), VP, READABLE_PARAMS);
    expect(resolved2.map((d) => d.text)).toStrictEqual(['Uno', 'Dos']);
  });

  it('FR-620 FR-621 accounts for viewport-ceiling capping when testing screen overlap on rotated frames', () => {
    // At scale 4 on 720p (ceiling 180 px), raw h = 80 -> 320 px, capped to 180 px (k=0.5625).
    // Two labels 220 px apart vertically (55 map units at scale 4) overlap uncapped (320 > 220), clear once capped (180 + gap < 220)!
    const top = straightLabel('Norte', 500, 472, 80, 120, 0, 'faction');
    const bot = straightLabel('Sur', 500, 528, 80, 120, 0, 'faction');
    const resolved = resolveFrameLabels([top, bot], cam(4), VP, READABLE_PARAMS);
    expect(resolved.map((d) => d.text)).toStrictEqual(['Norte', 'Sur']);
  });

  it('FR-620 uses oriented bounding boxes so parallel diagonal labels do not falsely collide in empty AABB corners', () => {
    // Two parallel 45° labels separated by 60 px perpendicular to their reading axis: their AABBs overlap heavily,
    // but their actual rotated text footprints are well separated.
    const a = straightLabel('Daimiel', 500, 500, 24, 140, 45, 'territory');
    const b = straightLabel('Torralba', 545, 545, 16, 100, 45, 'territory');
    const resolved = resolveFrameLabels([a, b], cam(1), VP, READABLE_PARAMS);
    expect(resolved.map((d) => d.text)).toStrictEqual(['Daimiel', 'Torralba']);
  });

  it('FR-620 tries a shorter tier of a colliding label before hiding it', () => {
    const big: AnyLabelDraw = boxLabel('Madrid', 480, 490, 24, 80, 'faction');
    // Full name 'Guadalajara' spans x=555..655 (overlaps big which ends at 560), while short 'Gua.' spans x=575..615 (clear!)
    const guada: LabelDraw & { tiers?: readonly LabelTier[] } = {
      ...boxLabel('Guadalajara', 555, 492, 16, 100, 'faction'),
      tiers: [
        { text: 'Guadalajara', box: { x0: 555, y0: 492, h: 16, w: 100 }, height: 16 },
        { text: 'Gua.', box: { x0: 575, y0: 492, h: 16, w: 40 }, height: 16 },
      ],
    };
    const resolved = resolveFrameLabels([big, guada], cam(1), VP, READABLE_PARAMS);
    expect(resolved.map((d) => d.text)).toStrictEqual(['Madrid', 'Gua.']);
  });
});

describe('spec 032 FR-621 label layer enforces maxPx cap on screen for horizontal, straight and arc frames', () => {
  function recordFonts(draws: readonly AnyLabelDraw[], scale: number): { text: string; fontPx: number }[] {
    const out: { text: string; fontPx: number }[] = [];
    const ctx = {
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineJoin: 'miter',
      lineCap: 'butt',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      globalAlpha: 1,
      setTransform() {},
      clearRect() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      transform() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      measureText(t: string) {
        const px = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? '10');
        return { width: t.length * 0.6 * px };
      },
      strokeText() {},
      fillText(t: string) {
        out.push({ text: t, fontPx: Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? '0') });
      },
    };
    const canvas = { width: 0, height: 0, getContext: (k: string) => (k === '2d' ? ctx : null) } as unknown as HTMLCanvasElement;
    const layer = attachLabelLayer(canvas);
    layer.resize(VP, 1);
    layer.draw(draws, { camera: cam(scale), viewport: VP, dpr: 1 });
    return out;
  }

  it('FR-621 scales faction and territory labels 1:1 past 48/28 px and caps at 25% of viewport height (180 px on 720p)', () => {
    // Faction labels at scale 1.4: h=50 -> 70 px (anchored, NOT capped at 48 px); h=160 -> 224 px capped to 180 px.
    const facAnchored = boxLabel('Ciudad Real', 450, 475, 50, 150, 'faction');
    const facAnchoredDraws = recordFonts([facAnchored], 1.4);
    expect(facAnchoredDraws).toHaveLength(1);
    expect(facAnchoredDraws[0]!.fontPx).toBeCloseTo(70, 6);

    const facBox = boxLabel('España', 450, 475, 160, 480, 'faction');
    const facStraight = straightLabel('Aragón', 500, 500, 160, 480, 15, 'faction');
    const facArc: ShapedDraw = {
      text: 'Italia',
      role: 'faction',
      frame: { shape: 'arc', cx: 500, cy: 500, angle: 0, h: 160, w: 480, bend: 30, radius: 600 },
      factor: 1,
      ink: LABEL_INK,
      halo: LABEL_HALO,
    };
    const facDraws = recordFonts([facBox, facStraight, facArc], 1.4);
    expect(facDraws.length).toBeGreaterThan(0);
    for (const d of facDraws) expect(d.fontPx).toBeCloseTo(180, 6);

    // Territory labels at scale 4 (> fadeFull 2): h=20 -> 80 px (anchored, NOT capped at 28 px); h=60 -> 240 px capped to 180 px.
    const terBox = boxLabel('Zuera', 480, 490, 20, 60, 'territory');
    const terStraight = straightLabel('Huesca', 500, 500, 60, 180, 30, 'territory');
    const terDraws = recordFonts([terBox, terStraight], 4);
    expect(terDraws).toHaveLength(2);
    expect(terDraws[0]!.fontPx).toBeCloseTo(80, 6);
    expect(terDraws[1]!.fontPx).toBeCloseTo(180, 6);
  });

  it('FR-621 FR-623 scales labels monotonically 1:1 with zoom up to the viewport ceiling and keeps capped arc labels centred', () => {
    // Territory with h=16: across scales 2.0, 4.0, 8.0, 16.0 -> 32, 64, 128, 180 px (never decreases, anchored until 180 px ceiling).
    const terBox = boxLabel('Amurrio', 480, 490, 16, 96, 'territory');
    const terStraight = straightLabel('Aramaio', 500, 500, 16, 96, 15, 'territory');
    const terArc: ShapedDraw = {
      text: 'Bernedo',
      role: 'territory',
      frame: { shape: 'arc', cx: 500, cy: 500, angle: 0, h: 16, w: 112, bend: 20, radius: 400 },
      factor: 1,
      ink: LABEL_INK,
      halo: LABEL_HALO,
    };
    let prev = 0;
    for (const s of [2.0, 4.0, 8.0, 16.0]) {
      const drawn = recordFonts([terBox, terStraight, terArc], s);
      const expected = Math.min(16 * s, VP.height * READABLE_PARAMS.maxViewportFraction);
      expect(drawn.length).toBeGreaterThan(2);
      for (const d of drawn) {
        expect(d.fontPx).toBeCloseTo(expected, 6);
        expect(d.fontPx).toBeGreaterThanOrEqual(prev);
      }
      prev = expected;
    }

    // Capped arc label (h=60 at scale 4 -> raw 240 px, capped to 180 px, k=0.75) must remain centred around sx=640!
    const xs: number[] = [];
    let curX = 0;
    const ctx = {
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineJoin: 'miter',
      lineCap: 'butt',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      globalAlpha: 1,
      setTransform() {},
      clearRect() {},
      save() {},
      restore() { curX = 0; },
      translate(x: number) { curX = x; },
      rotate() {},
      scale() {},
      transform() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      measureText(t: string) {
        const px = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? '10');
        return { width: t.length * 0.6 * px };
      },
      strokeText() {},
      fillText() { xs.push(curX); },
    };
    const canvas = { width: 0, height: 0, getContext: (k: string) => (k === '2d' ? ctx : null) } as unknown as HTMLCanvasElement;
    const layer = attachLabelLayer(canvas);
    layer.resize(VP, 1);
    const cappedArc: ShapedDraw = {
      text: 'ABBA',
      role: 'territory',
      frame: { shape: 'arc', cx: 500, cy: 500, angle: 0, h: 60, w: 300, bend: 20, radius: 600 },
      factor: 1,
      ink: LABEL_INK,
      halo: LABEL_HALO,
    };
    layer.draw([cappedArc], { camera: cam(4), viewport: VP, dpr: 1 });
    expect(xs).toHaveLength(4);
    const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
    // Camera is at (500, 500) on 1280x720 -> screen centre x = 640
    expect(meanX).toBeCloseTo(640, 1);
  });
});

describe('spec 032 NFR-151 performance on 8,220-label synthetic input', () => {
  it('NFR-151 resolveFrameLabels runs in < 16 ms median on 8,220 territory labels (viewport culled + spatial grid)', () => {
    const draws: ReadableDraw[] = [];
    for (let i = 0; i < 8220; i++) {
      const gx = (i % 90) * 44;
      const gy = Math.floor(i / 90) * 44;
      const tiers: LabelTier[] = [
        { text: `Municipio Largo ${i}`, box: { x0: gx, y0: gy, h: 4, w: 36 }, height: 4 },
        { text: `Mun. ${i}`, box: { x0: gx + 4, y0: gy + 2, h: 8, w: 28 }, height: 8 },
      ];
      draws.push({
        text: tiers[0]!.text,
        role: 'territory',
        box: tiers[0]!.box!,
        factor: 1,
        ink: LABEL_INK,
        halo: LABEL_HALO,
        tiers,
      });
    }
    const zoomed = cam(4.5, 2000, 2000);
    // Warm up
    resolveFrameLabels(draws, zoomed, VP, READABLE_PARAMS);
    const times: number[] = [];
    for (let k = 0; k < 7; k++) {
      const t0 = performance.now();
      resolveFrameLabels(draws, zoomed, VP, READABLE_PARAMS);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    expect(median).toBeLessThan(16);
  });
});

describe('spec 032 FR-627 active tier preserved during round steps and reveal tours', () => {
  const sctTiers: LabelTier[] = [
    { text: 'Santa Cruz de Tenerife', box: { x0: 100, y0: 100, h: 8, w: 80 }, height: 8 },
    { text: 'SCT', box: { x0: 110, y0: 100, h: 20, w: 30 }, height: 20 },
  ];
  const grownTiers: LabelTier[] = [
    { text: 'Santa Cruz de Tenerife', box: { x0: 90, y0: 90, h: 24, w: 240 }, height: 24 },
  ];

  it('FR-627 keeps a label whose active tier is SCT visible mid-step instead of blinking out on tiers[0]', () => {
    const earlier = { tiers: new Map([[1, sctTiers]]), piecesByFaction: new Map([[1, [0]]]) };
    const later = { tiers: new Map([[1, sctTiers]]), piecesByFaction: new Map([[1, [0]]]) };
    const territories = { tiers: [undefined] };
    const table = new Uint8Array([0, 1]);
    const aspects = new Map([['Santa Cruz de Tenerife', 10], ['SCT', 1.5]]);
    // At scale 0.5, tiers[0] (h=8 -> 4px < 9) would blink out, while SCT (h=20 -> 10px >= 9) stays visible!
    const mid = stepReadableLabels(earlier, later, territories, table, { eliminated: 2, absorber: 3 }, aspects, 0.5, 0.5);
    expect(mid.map((d) => d.text)).toStrictEqual(['SCT']);
    expect(frameOf(mid[0]!).h * 0.5).toBeGreaterThanOrEqual(READABLE_PARAMS.minPx);
  });

  it('FR-627 crossfades cleanly when an absorber expands from abbreviated tier to full name across a step', () => {
    const earlier = { tiers: new Map([[1, sctTiers]]), piecesByFaction: new Map([[1, [0]]]) };
    const later = { tiers: new Map([[1, grownTiers]]), piecesByFaction: new Map([[1, [0, 1]]]) };
    const territories = { tiers: [undefined] };
    const table = new Uint8Array([0, 1]);
    const aspects = new Map([['Santa Cruz de Tenerife', 10], ['SCT', 1.5]]);
    const mid = stepReadableLabels(earlier, later, territories, table, { eliminated: 2, absorber: 1 }, aspects, 0.5, 0.4);
    expect(mid.map((d) => [d.text, Number(d.factor.toFixed(2))])).toStrictEqual([
      ['SCT', 0.6],
      ['Santa Cruz de Tenerife', 0.4],
    ]);
  });

  it('FR-627 upgradeTourDraws uses active tier at current scale while preserving tour opacity factor', () => {
    const tourDraw = boxLabel('Santa Cruz de Tenerife', 100, 100, 8, 80, 'faction', 0.35);
    const currentDraws: ReadableDraw[] = [{ ...tourDraw, factor: 1, tiers: sctTiers }];
    const upgraded = upgradeTourDraws([tourDraw], currentDraws, 0.5);
    expect(upgraded).toHaveLength(1);
    expect(upgraded[0]!.text).toBe('SCT');
    expect(upgraded[0]!.factor).toBeCloseTo(0.35, 6);
  });

  it('FR-627 upgradeTourDraws keys by territory/faction id so duplicate names do not mispair during tours', () => {
    const drawA = boxLabel('San Juan', 100, 100, 6, 48, 'territory', 0.25);
    const drawB = boxLabel('San Juan', 400, 400, 6, 48, 'territory', 0.25);
    const tiersA: LabelTier[] = [
      { text: 'San Juan', box: { x0: 100, y0: 100, h: 6, w: 48 }, height: 6 },
      { text: 'S. Juan', box: { x0: 105, y0: 100, h: 20, w: 40 }, height: 20 },
    ];
    const tiersB: LabelTier[] = [
      { text: 'San Juan', box: { x0: 400, y0: 400, h: 6, w: 48 }, height: 6 },
      { text: 'SJ', box: { x0: 415, y0: 400, h: 22, w: 22 }, height: 22 },
    ];
    const currentDraws: ReadableDraw[] = [
      { ...drawA, id: 10, factor: 1, tiers: tiersA },
      { ...drawB, id: 20, factor: 1, tiers: tiersB },
    ];
    const roundLabels = {
      factions: [],
      territories: [
        { entry: 10, text: 'San Juan', box: drawA.box },
        { entry: 20, text: 'San Juan', box: drawB.box },
      ],
    };
    const upgraded = upgradeTourDraws([drawA, drawB], currentDraws, 0.5, READABLE_PARAMS.minPx, roundLabels);
    expect(upgraded).toHaveLength(2);
    expect(upgraded[0]!.text).toBe('S. Juan');
    expect(frameOf(upgraded[0]!).cx).toBeCloseTo(125, 1);
    expect(upgraded[1]!.text).toBe('SJ');
    expect(frameOf(upgraded[1]!).cx).toBeCloseTo(426, 1);
  });
});

describe('spec 032 FR-620 FR-626 real maps in maps/ (zero overlaps at fit scale, uniform across every map)', () => {
  const mapsRoot = fileURLToPath(new URL('../../../maps', import.meta.url));
  const mapDirs = readdirSync(mapsRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();

  const syntheticAspects = (names: readonly string[]): Map<string, number> =>
    new Map(names.map((n) => [n, Math.max(0.6, Array.from(n).length * 0.58)]));

  const screenObbOf = (d: AnyLabelDraw, c: Camera, vp: Viewport) => {
    const f = frameOf(d);
    const rawH = f.h * c.scale;
    const h = clampScreenHeight(rawH, vp.height, READABLE_PARAMS);
    const w = f.w * c.scale * (h / rawH);
    const sx = (f.cx - c.x) * c.scale + vp.width / 2;
    const sy = (f.cy - c.y) * c.scale + vp.height / 2;
    const rad = (f.angle * Math.PI) / 180;
    return { sx, sy, ux: Math.cos(rad), uy: -Math.sin(rad), hw: w / 2, hh: h / 2 };
  };

  const obbOverlap = (
    a: ReturnType<typeof screenObbOf>,
    b: ReturnType<typeof screenObbOf>,
  ): boolean => {
    const dx = b.sx - a.sx;
    const dy = b.sy - a.sy;
    const dotUU = Math.abs(a.ux * b.ux + a.uy * b.uy);
    const dotUV = Math.abs(a.ux * b.uy - a.uy * b.ux);
    if (Math.abs(dx * a.ux + dy * a.uy) >= a.hw + b.hw * dotUU + b.hh * dotUV) return false;
    if (Math.abs(-dx * a.uy + dy * a.ux) >= a.hh + b.hw * dotUV + b.hh * dotUU) return false;
    if (Math.abs(dx * b.ux + dy * b.uy) >= b.hw + a.hw * dotUU + a.hh * dotUV) return false;
    if (Math.abs(-dx * b.uy + dy * b.ux) >= b.hh + a.hw * dotUV + a.hh * dotUU) return false;
    return true;
  };

  it('FR-620 maps/spain-provinces at fit scale (1920x1080) draws multiple factions with zero screen-space overlaps', async () => {
    const dir = join(mapsRoot, 'spain-provinces');
    const parsed = await parsePackage(
      {
        map: readFileSync(join(dir, 'map.json'), 'utf8'),
        presentation: readFileSync(join(dir, 'presentation.json'), 'utf8'),
        image: new Uint8Array(readFileSync(join(dir, 'ids.png'))),
      },
      inflateStream,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const pkg = parsed.value;
    const map = pkg.map as MapData;
    const presentation = pkg.presentation as PresentationData;
    const index = buildEntryIndex(map, pkg.width, pkg.height, pkg.values);
    const pieces = buildPieceIndex(index);
    const owners = factionIndexOf(map);
    const sim = { totalRounds, getState, getRounds, ownerOf };
    const sc = sceneAt(map, presentation, 1, 0, sim);
    expect(sc.ok).toBe(true);
    if (!sc.ok) return;
    const table = ownerTable(index, sc.value.owners, owners);
    const texts = labelTexts(map, presentation, owners);
    const aspects = syntheticAspects(allCandidateTexts([...texts.factions.values()]));
    const fac = placeReadableFactions(pieces, table, texts.factions, aspects, LABEL_PARAMS, SHAPE_PARAMS, CENTRE_PARAMS);
    const ter = { tiers: new Array<undefined>(pieces.entries).fill(undefined) };
    const { draws } = readableRoundLabels(texts, table, fac, ter, aspects);
    const vp: Viewport = { width: 1920, height: 1080 };
    const fit = initialCamera({ w: pkg.width, h: pkg.height }, vp);
    const resolved = resolveFrameLabels(draws, fit, vp, READABLE_PARAMS);
    expect(resolved.length).toBeGreaterThan(20);
    const obbs = resolved.map((d) => screenObbOf(d, fit, vp));
    for (let i = 0; i < obbs.length; i++) {
      for (let j = i + 1; j < obbs.length; j++) {
        expect(obbOverlap(obbs[i]!, obbs[j]!), `${resolved[i]!.text} vs ${resolved[j]!.text}`).toBe(false);
      }
    }
  }, 15000);

  it('FR-626 runs the readable-label pipeline across every map in maps/ with zero off-land leader lines', async () => {
    expect(mapDirs.length).toBeGreaterThanOrEqual(2);
    for (const name of mapDirs) {
      const dir = join(mapsRoot, name);
      const parsed = await parsePackage(
        {
          map: readFileSync(join(dir, 'map.json'), 'utf8'),
          presentation: readFileSync(join(dir, 'presentation.json'), 'utf8'),
          image: new Uint8Array(readFileSync(join(dir, 'ids.png'))),
        },
        inflateStream,
      );
      expect(parsed.ok, name).toBe(true);
      if (!parsed.ok) continue;
      const pkg = parsed.value;
      const map = pkg.map as MapData;
      const presentation = pkg.presentation as PresentationData;
      const index = buildEntryIndex(map, pkg.width, pkg.height, pkg.values);
      const pieces = buildPieceIndex(index);
      const owners = factionIndexOf(map);
      const sim = { totalRounds, getState, getRounds, ownerOf };
      const sc = sceneAt(map, presentation, 1, 0, sim);
      expect(sc.ok, name).toBe(true);
      if (!sc.ok) continue;
      const table = ownerTable(index, sc.value.owners, owners);
      const texts = labelTexts(map, presentation, owners);
      const aspects = syntheticAspects(allCandidateTexts([...texts.factions.values()]));
      const fac = placeReadableFactions(pieces, table, texts.factions, aspects, LABEL_PARAMS, SHAPE_PARAMS, CENTRE_PARAMS);
      const ter = placeReadableTerritories(pieces, texts.territories.slice(0, 1), aspects, LABEL_PARAMS, SHAPE_PARAMS, CENTRE_PARAMS);
      const { draws } = readableRoundLabels(texts, table, fac, ter, aspects);
      const vp: Viewport = { width: 1920, height: 1080 };
      const fit = initialCamera({ w: pkg.width, h: pkg.height }, vp);
      const resolved = resolveFrameLabels(draws, fit, vp, READABLE_PARAMS);
      expect(resolved.length, name).toBeGreaterThan(0);
      for (const d of resolved) expect('leader' in d, `${name}:${d.text}`).toBe(false);
    }
  }, 30000);
});
