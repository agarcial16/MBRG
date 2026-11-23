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

describe('spec 032 FR-621 screen-space size bounds per role', () => {
  it('FR-621 clamps faction height to 48 px and territory height to 28 px, and returns 0 below minPx (9 px)', () => {
    expect(READABLE_PARAMS.minPx).toBe(9);
    expect(READABLE_PARAMS.maxPx.faction).toBe(48);
    expect(READABLE_PARAMS.maxPx.territory).toBe(28);

    expect(clampScreenHeight(8.9, 'faction')).toBe(0);
    expect(clampScreenHeight(9, 'faction')).toBe(9);
    expect(clampScreenHeight(32, 'faction')).toBe(32);
    expect(clampScreenHeight(120, 'faction')).toBe(48);

    expect(clampScreenHeight(8.9, 'territory')).toBe(0);
    expect(clampScreenHeight(9, 'territory')).toBe(9);
    expect(clampScreenHeight(20, 'territory')).toBe(20);
    expect(clampScreenHeight(80, 'territory')).toBe(28);
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

  it('FR-620 FR-621 accounts for maxPx capping when testing screen overlap on rotated frames', () => {
    // At scale 4, raw h = 25 -> 100 px, but capped to 48 px (0.48x). Two labels 100 px apart vertically overlap uncapped, clear once capped!
    const top = straightLabel('Norte', 500, 480, 25, 60, 15, 'faction');
    const bot = straightLabel('Sur', 500, 505, 25, 60, 15, 'faction');
    // Distance between centres at scale 4 is 80 px; capped heights are 48 px each (half = 24, sum = 48 < 80 - gap)
    const resolved = resolveFrameLabels([top, bot], cam(4), VP, READABLE_PARAMS);
    expect(resolved.map((d) => d.text)).toStrictEqual(['Norte', 'Sur']);
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

  it('FR-621 caps faction labels at 48 px and territory labels at 28 px when zoomed in', () => {
    // Faction horizontal box: h=50 at scale 1.4 -> raw 70 px, capped to 48 px (scale 1.4 < fadeStart 1.5 so faction visible)
    const facBox = boxLabel('España', 450, 475, 50, 150, 'faction');
    const facStraight = straightLabel('Aragón', 500, 500, 50, 150, 15, 'faction');
    const facArc: ShapedDraw = {
      text: 'Italia',
      role: 'faction',
      frame: { shape: 'arc', cx: 500, cy: 500, angle: 0, h: 50, w: 150, bend: 30, radius: 300 },
      factor: 1,
      ink: LABEL_INK,
      halo: LABEL_HALO,
    };
    const facDraws = recordFonts([facBox, facStraight, facArc], 1.4);
    expect(facDraws.length).toBeGreaterThan(0);
    for (const d of facDraws) expect(d.fontPx).toBeLessThanOrEqual(48);
    expect(facDraws[0]!.fontPx).toBeCloseTo(48, 6);

    // Territory labels at scale 4 (> fadeFull 2): h=20 -> raw 80 px, capped to 28 px
    const terBox = boxLabel('Zuera', 480, 490, 20, 60, 'territory');
    const terStraight = straightLabel('Huesca', 500, 500, 20, 60, 30, 'territory');
    const terDraws = recordFonts([terBox, terStraight], 4);
    expect(terDraws).toHaveLength(2);
    for (const d of terDraws) expect(d.fontPx).toBeCloseTo(28, 6);
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
});

describe('spec 032 FR-620 FR-626 real maps in maps/ (zero overlaps at fit scale, uniform across every map)', () => {
  const mapsRoot = fileURLToPath(new URL('../../../maps', import.meta.url));
  const mapDirs = readdirSync(mapsRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();

  const syntheticAspects = (names: readonly string[]): Map<string, number> =>
    new Map(names.map((n) => [n, Math.max(0.6, Array.from(n).length * 0.58)]));

  const screenBoxOf = (d: AnyLabelDraw, c: Camera, vp: Viewport) => {
    const f = frameOf(d);
    const rawH = f.h * c.scale;
    const h = clampScreenHeight(rawH, d.role, READABLE_PARAMS);
    const w = f.w * c.scale * (h / rawH);
    const sx = (f.cx - c.x) * c.scale + vp.width / 2;
    const sy = (f.cy - c.y) * c.scale + vp.height / 2;
    const rad = (Math.abs(f.angle) * Math.PI) / 180;
    const hw = (w * Math.cos(rad) + h * Math.sin(rad)) / 2;
    const hh = (w * Math.sin(rad) + h * Math.cos(rad)) / 2;
    return { minX: sx - hw, minY: sy - hh, maxX: sx + hw, maxY: sy + hh };
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
    const rects = resolved.map((d) => screenBoxOf(d, fit, vp));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const overlap = a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
        expect(overlap, `${resolved[i]!.text} vs ${resolved[j]!.text}`).toBe(false);
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
