import { describe, expect, it } from 'vitest';
import type { Rgb } from '@mbrg/shared';
import { MAX_SCALE } from '../src/core/camera';
import { labelInk } from '../src/core/contrast';
import { drawable, instantLabels, labelAlpha, labelOpacity, labelsAt, screenBox } from '../src/core/label-frame';
import type { FactionLabelInput, LabelDraw, RoundLabels, StepLabels, TerritoryLabelInput } from '../src/core/label-frame';
import type { LabelBox } from '../src/core/label-layout';
import { LABEL_PARAMS } from '../src/core/label-params';
import { smoothstep } from '../src/core/lines';

const P = LABEL_PARAMS;
const L0 = P.fadeStart;
const L1 = P.fadeFull;

const box = (x0: number, y0: number, h: number, aspect: number): LabelBox => ({ x0, y0, h, w: h * aspect });
const draw = (role: 'faction' | 'territory', b: LabelBox, factor = 1): LabelDraw => ({
  text: 't',
  role,
  box: b,
  factor,
  ...(() => {
    const { ink, halo } = labelInk([200, 200, 200]);
    return { ink, halo };
  })(),
});

describe('FR-172 label opacity by scale', () => {
  it('FR-172 at L0 the faction label is fully opaque and the territory label invisible', () => {
    expect(labelOpacity('faction', L0, P)).toBe(1);
    expect(labelOpacity('territory', L0, P)).toBe(0);
  });

  it('FR-172 at L1 the faction label is invisible and the territory label fully opaque', () => {
    expect(labelOpacity('faction', L1, P)).toBe(0);
    expect(labelOpacity('territory', L1, P)).toBe(1);
  });

  it('FR-172 below L0 only faction labels and above L1 only territory labels, down to the fit scale and up to 32', () => {
    expect(labelOpacity('faction', 0.2, P)).toBe(1);
    expect(labelOpacity('territory', 0.2, P)).toBe(0);
    expect(labelOpacity('faction', MAX_SCALE, P)).toBe(0);
    expect(labelOpacity('territory', MAX_SCALE, P)).toBe(1);
  });

  it('FR-172 in between the opacities are smoothstep(L0, L1, s) and its complement, and they sum to 1', () => {
    for (let i = 0; i <= 40; i++) {
      const s = L0 + ((L1 - L0) * i) / 40;
      expect(labelOpacity('territory', s, P)).toBe(smoothstep(L0, L1, s));
      expect(labelOpacity('faction', s, P)).toBe(1 - smoothstep(L0, L1, s));
      expect(labelOpacity('faction', s, P) + labelOpacity('territory', s, P)).toBeCloseTo(1, 12);
    }
    expect(labelOpacity('territory', (L0 + L1) / 2, P)).toBeCloseTo(0.5, 12);
  });

  it('FR-172 the final alpha is the opacity times the opacity factor', () => {
    const s = (L0 + L1) / 2;
    expect(labelAlpha(draw('territory', box(0, 0, 10, 2), 0.4), s, P)).toBeCloseTo(0.2, 12);
    expect(labelAlpha(draw('faction', box(0, 0, 10, 2), 0.4), L0, P)).toBeCloseTo(0.4, 12);
    expect(labelAlpha(draw('faction', box(0, 0, 10, 2), 0), L0, P)).toBe(0);
  });

  it('FR-172 a label whose box height on screen is below P is not drawable, at P exactly it is', () => {
    const s = 2;
    const at = (h: number): LabelDraw => draw('territory', box(0, 0, h, 3));
    expect(drawable(at(P.minPx / s), s, P)).toBe(true);
    expect(drawable(at(P.minPx / s - 0.01), s, P)).toBe(false);
    expect(drawable(at(100), s, P)).toBe(true);
  });

  it('FR-172 a fractional interpolated height is compared with P as it is', () => {
    expect(drawable(draw('territory', { x0: 0, y0: 0, h: 4.49, w: 10 }), 2, P)).toBe(false);
    expect(drawable(draw('territory', { x0: 0, y0: 0, h: 4.5, w: 10 }), 2, P)).toBe(true);
  });

  it('FR-172 a label with opacity times factor of 0 is not drawable even when tall', () => {
    expect(drawable(draw('faction', box(0, 0, 100, 3)), L1 + 1, P)).toBe(false);
    expect(drawable(draw('faction', box(0, 0, 100, 3), 0), L0, P)).toBe(false);
    expect(drawable(draw('faction', box(0, 0, 100, 3), 0.01), L0, P)).toBe(true);
  });
});

describe('FR-175 the screen box is the label box times the scale', () => {
  const vp = { width: 800, height: 600 };

  it('FR-175 position, width and height follow the camera and the scale', () => {
    const cam = { x: 100, y: 50, scale: 4 };
    expect(screenBox(box(110, 60, 5, 3), cam, vp)).toStrictEqual({ x: (110 - 100) * 4 + 400, y: (60 - 50) * 4 + 300, w: 15 * 4, h: 5 * 4 });
  });

  it('FR-175 the box size is exactly the box times the scale at every scale from 0.25 to 32', () => {
    const b = box(7, 9, 11, 2.5);
    for (const scale of [0.25, 0.527, 1, 1.25, 2, 3.7, 8, 32]) {
      const sb = screenBox(b, { x: 1024, y: 1024, scale }, vp);
      expect(sb.w).toBeCloseTo(b.w * scale, 9);
      expect(sb.h).toBeCloseTo(b.h * scale, 9);
    }
  });

  it('FR-175 moving the camera by d map units moves the box by d x scale screen pixels the other way', () => {
    const b = box(300, 400, 20, 2);
    const a = screenBox(b, { x: 500, y: 500, scale: 3 }, vp);
    const c = screenBox(b, { x: 510, y: 495, scale: 3 }, vp);
    expect(c.x - a.x).toBeCloseTo(-30, 9);
    expect(c.y - a.y).toBeCloseTo(15, 9);
    expect(c.w).toBe(a.w);
    expect(c.h).toBe(a.h);
  });

  it('FR-175 a box centred on the camera is centred on the viewport', () => {
    const b = { x0: 90, y0: 40, h: 20, w: 20 };
    const sb = screenBox(b, { x: 100, y: 50, scale: 5 }, vp);
    expect(sb.x + sb.w / 2).toBe(400);
    expect(sb.y + sb.h / 2).toBe(300);
  });
});

// A step from an earlier to a later state. Factions: 1 = eliminated, 2 = absorber, 3 = bystander.
const RED: Rgb = [220, 40, 40];
const NAVY: Rgb = [20, 30, 120];
const PALE: Rgb = [235, 235, 200];
const F1 = (b: LabelBox | undefined): FactionLabelInput => ({ faction: 1, text: 'Uno', box: b, aspect: 3, fill: RED });
const F2 = (b: LabelBox | undefined): FactionLabelInput => ({ faction: 2, text: 'Dos', box: b, aspect: 2.5, fill: NAVY });
const F3: FactionLabelInput = { faction: 3, text: 'Tres', box: box(500, 500, 30, 4), aspect: 4, fill: PALE };
const T = (entry: number, fill: Rgb, b: LabelBox | undefined = box(entry * 10, 5, 8, 3)): TerritoryLabelInput => ({ entry, text: `T${String(entry)}`, box: b, fill });

function stepOf(over: {
  e1?: LabelBox | undefined;
  a0?: LabelBox | undefined;
  a1?: LabelBox | undefined;
}): StepLabels {
  const e1 = 'e1' in over ? over.e1 : box(100, 100, 20, 3);
  const a0 = 'a0' in over ? over.a0 : box(300, 300, 10, 2.5);
  const a1 = 'a1' in over ? over.a1 : box(200, 220, 50, 2.5);
  return {
    earlier: { factions: [F1(e1), F2(a0), F3], territories: [T(1, RED), T(2, RED), T(3, NAVY), T(4, PALE)] },
    later: { factions: [F2(a1), F3], territories: [T(1, PALE), T(2, NAVY), T(3, NAVY), T(4, PALE)] },
    eliminated: 1,
    absorber: 2,
    transferred: new Set([1, 2]),
  };
}

const byText = (labels: readonly LabelDraw[], text: string): LabelDraw => {
  const found = labels.find((l) => l.text === text);
  if (found === undefined) throw new Error(`no label ${text}`);
  return found;
};

describe('FR-181 labels during a step', () => {
  it('FR-181 the eliminated faction keeps its earlier box with the factor 1 - f', () => {
    for (const f of [0, 0.3, 0.5, 0.9]) {
      const l = byText(labelsAt(stepOf({}), f), 'Uno');
      expect(l.box).toStrictEqual(box(100, 100, 20, 3));
      expect(l.factor).toBeCloseTo(1 - f, 12);
      expect(l.role).toBe('faction');
    }
  });

  it('FR-181 the eliminated faction has no label at f = 1 (factor 0 is not listed)', () => {
    expect(labelsAt(stepOf({}), 1).some((l) => l.text === 'Uno')).toBe(false);
  });

  it('FR-181 an eliminated faction with no earlier box draws nothing', () => {
    for (const f of [0, 0.3, 0.5, 1]) expect(labelsAt(stepOf({ e1: undefined }), f).some((l) => l.text === 'Uno')).toBe(false);
  });

  it('FR-181 the absorber with a box at both rounds interpolates x0, y0 and h linearly, w = h x aspect, factor 1', () => {
    const input = stepOf({});
    const l0 = byText(labelsAt(input, 0), 'Dos');
    expect(l0.box).toStrictEqual(box(300, 300, 10, 2.5));
    const l3 = byText(labelsAt(input, 0.3), 'Dos');
    expect(l3.box.x0).toBeCloseTo(300 + (200 - 300) * 0.3, 12);
    expect(l3.box.y0).toBeCloseTo(300 + (220 - 300) * 0.3, 12);
    expect(l3.box.h).toBeCloseTo(10 + (50 - 10) * 0.3, 12);
    expect(l3.box.w).toBe(l3.box.h * 2.5);
    expect(l3.factor).toBe(1);
    const l5 = byText(labelsAt(input, 0.5), 'Dos');
    expect(l5.box).toStrictEqual({ x0: 250, y0: 260, h: 30, w: 75 });
    expect(byText(labelsAt(input, 1), 'Dos').box).toStrictEqual(box(200, 220, 50, 2.5));
  });

  it('FR-181 the absorber with a box at the later round only keeps that box and fades in with the factor f', () => {
    for (const f of [0.3, 0.5, 1]) {
      const l = byText(labelsAt(stepOf({ a0: undefined }), f), 'Dos');
      expect(l.box).toStrictEqual(box(200, 220, 50, 2.5));
      expect(l.factor).toBe(f);
    }
    expect(labelsAt(stepOf({ a0: undefined }), 0).some((l) => l.text === 'Dos')).toBe(false);
  });

  it('FR-181 the absorber with a box at the earlier round only keeps that box and fades out with the factor 1 - f', () => {
    for (const f of [0, 0.3, 0.5]) {
      const l = byText(labelsAt(stepOf({ a1: undefined }), f), 'Dos');
      expect(l.box).toStrictEqual(box(300, 300, 10, 2.5));
      expect(l.factor).toBeCloseTo(1 - f, 12);
    }
    expect(labelsAt(stepOf({ a1: undefined }), 1).some((l) => l.text === 'Dos')).toBe(false);
  });

  it('FR-181 the absorber with no box at either round draws nothing', () => {
    for (const f of [0, 0.5, 1]) expect(labelsAt(stepOf({ a0: undefined, a1: undefined }), f).some((l) => l.text === 'Dos')).toBe(false);
  });

  it('FR-181 a transferred territory label uses the ink of the earlier owner below f = 0.5 and of the later owner from 0.5', () => {
    const input = stepOf({});
    const early = labelInk(RED);
    const late = labelInk(PALE);
    expect(early).not.toStrictEqual(late);
    for (const f of [0, 0.3, 0.4999]) {
      const l = byText(labelsAt(input, f), 'T1');
      expect({ ink: l.ink, halo: l.halo }).toStrictEqual(early);
    }
    for (const f of [0.5, 0.7, 1]) {
      const l = byText(labelsAt(input, f), 'T1');
      expect({ ink: l.ink, halo: l.halo }).toStrictEqual(late);
    }
  });

  it('FR-181 a transferred territory label keeps its box and the factor 1 at every f', () => {
    for (const f of [0, 0.3, 0.5, 1]) {
      const l = byText(labelsAt(stepOf({}), f), 'T2');
      expect(l.box).toStrictEqual(box(20, 5, 8, 3));
      expect(l.factor).toBe(1);
      expect(l.role).toBe('territory');
    }
  });

  it('FR-181 every other label is drawn as at both rounds with the factor 1', () => {
    const input = stepOf({});
    for (const f of [0, 0.3, 0.5, 1]) {
      const labels = labelsAt(input, f);
      const tres = byText(labels, 'Tres');
      expect(tres.box).toStrictEqual(F3.box);
      expect(tres.factor).toBe(1);
      expect(byText(labels, 'T3').factor).toBe(1);
      expect(byText(labels, 'T4').box).toStrictEqual(box(40, 5, 8, 3));
    }
  });

  it('FR-181 at f = 0 the labels equal the instant labels of the earlier round and at f = 1 those of the later round', () => {
    const input = stepOf({});
    expect(labelsAt(input, 0)).toStrictEqual(instantLabels(input.earlier));
    expect(labelsAt(input, 1)).toStrictEqual(instantLabels(input.later));
    for (const v of [{ e1: undefined }, { a0: undefined }, { a1: undefined }, { a0: undefined, a1: undefined }]) {
      const s = stepOf(v);
      expect(labelsAt(s, 0)).toStrictEqual(instantLabels(s.earlier));
      expect(labelsAt(s, 1)).toStrictEqual(instantLabels(s.later));
    }
  });

  it('FR-181 a backward step is the forward step with f mirrored: the frames for p are the forward frames at 1 - p', () => {
    const input = stepOf({});
    const ps = [0, 0.125, 0.25, 0.75, 0.875, 1]; // symmetric and exact in binary, so 1 - p is exact
    const forward = ps.map((p) => labelsAt(input, p));
    const backward = ps.map((p) => labelsAt(input, 1 - p));
    expect(backward).toStrictEqual([...forward].reverse());
  });

  it('FR-181 the labels of one step are in a stable order: factions by index, then territories by entry', () => {
    const texts = labelsAt(stepOf({}), 0.3).map((l) => l.text);
    expect(texts).toStrictEqual(['Uno', 'Dos', 'Tres', 'T1', 'T2', 'T3', 'T4']);
  });
});

describe('FR-189 instant labels and purity of the frame data', () => {
  const round: RoundLabels = {
    factions: [F3, F2(box(1, 2, 3, 2.5))],
    territories: [T(5, PALE), { ...T(4, NAVY), box: undefined }],
  };

  it('FR-189 an instant label has the factor 1, the ink of its owner fill, and labels without a box are left out', () => {
    const labels = instantLabels(round);
    expect(labels.map((l) => l.text)).toStrictEqual(['Dos', 'Tres', 'T5']);
    expect(labels.every((l) => l.factor === 1)).toBe(true);
    const tres = byText(labels, 'Tres');
    expect({ ink: tres.ink, halo: tres.halo }).toStrictEqual(labelInk(PALE));
  });

  it('FR-189 the same inputs give the same labels and the inputs are not changed', () => {
    const input = stepOf({});
    const snapshot = JSON.stringify([input.earlier, input.later, [...input.transferred]]);
    expect(labelsAt(input, 0.37)).toStrictEqual(labelsAt(input, 0.37));
    expect(JSON.stringify([input.earlier, input.later, [...input.transferred]])).toBe(snapshot);
    expect(instantLabels(round)).toStrictEqual(instantLabels(round));
  });
});
