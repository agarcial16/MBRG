import { describe, expect, it } from 'vitest';
import type { Camera, Viewport } from '../src/core/camera';
import { LABEL_HALO, LABEL_INK } from '../src/core/label-frame';
import type { AnyLabelDraw, LabelDraw, ShapedDraw } from '../src/core/label-frame';
import {
  READABLE_PARAMS,
  clampScreenHeight,
  resolveFrameLabels,
  selectTier,
  tierDraws,
} from '../src/core/label-readable';
import type { LabelTier } from '../src/core/label-readable';

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
