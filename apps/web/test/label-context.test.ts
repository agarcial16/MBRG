import { describe, expect, it } from 'vitest';
import {
  LABEL_CONTEXT_PARAMS,
  applyLabelContext,
  isSubordinateTerritory,
  subordinateAlphaFactor,
} from '../src/core/label-context';
import { LABEL_HALO, LABEL_INK, labelAlpha } from '../src/core/label-frame';
import type { AnyLabelDraw } from '../src/core/label-frame';
import type { LabelTexts } from '../src/core/label-input';
import { LABEL_PARAMS } from '../src/core/label-params';
import type { ReadableDraw } from '../src/core/label-readable';

const makeBoxDraw = (text: string, role: 'faction' | 'territory', id: number, factor = 1): ReadableDraw => ({
  id,
  text,
  role,
  box: { x0: 10, y0: 10, w: 40, h: 12 },
  factor,
  ink: LABEL_INK,
  halo: LABEL_HALO,
});

describe('spec 039 subordinate territory label context (FR-727, NFR-192)', () => {
  const texts: LabelTexts = {
    factions: new Map([
      [1, 'Kazajistán'],
      [2, 'Francia'],
      [3, 'Imperio'],
    ]),
    territories: [undefined, 'Kazajistán', 'Uzbekistán', 'Francia', 'Norte', 'Sur'],
  };
  // Entry 1 (Kazajistán) -> faction 1; Entry 2 (Uzbekistán) -> faction 1 (conquered);
  // Entry 3 (Francia) -> faction 2 (independent); Entry 4/5 (Norte/Sur) -> faction 3 (sub-provinces).
  const table = new Uint16Array([0, 1, 1, 2, 3, 3]);

  it('FR-727 identifies subordinate territories whose name differs from their owning faction', () => {
    expect(isSubordinateTerritory(1, table, texts)).toBe(false); // homeland matching faction name
    expect(isSubordinateTerritory(2, table, texts)).toBe(true);  // conquered province
    expect(isSubordinateTerritory(3, table, texts)).toBe(false); // independent single-territory country
    expect(isSubordinateTerritory(4, table, texts)).toBe(true);  // multi-province faction sub-territory
    expect(isSubordinateTerritory(5, table, texts)).toBe(true);
    expect(isSubordinateTerritory(0, table, texts)).toBe(false); // non-land
  });

  it('FR-727 ramps subordinate opacity from 45% at province zoom to 100% at close zoom, scaled by detailFactor', () => {
    expect(subordinateAlphaFactor(1.5, 1)).toBeCloseTo(LABEL_CONTEXT_PARAMS.subordinateMinAlpha, 6);
    expect(subordinateAlphaFactor(LABEL_CONTEXT_PARAMS.closeDetailStart, 1)).toBeCloseTo(LABEL_CONTEXT_PARAMS.subordinateMinAlpha, 6);
    const mid = (LABEL_CONTEXT_PARAMS.closeDetailStart + LABEL_CONTEXT_PARAMS.closeDetailFull) / 2;
    expect(subordinateAlphaFactor(mid, 1)).toBeCloseTo((LABEL_CONTEXT_PARAMS.subordinateMinAlpha + 1) / 2, 6);
    expect(subordinateAlphaFactor(LABEL_CONTEXT_PARAMS.closeDetailFull, 1)).toBeCloseTo(1, 6);
    expect(subordinateAlphaFactor(8, 1)).toBeCloseTo(1, 6);

    // Detail factor 0.5 halves the zoom thresholds proportionally.
    expect(subordinateAlphaFactor(LABEL_CONTEXT_PARAMS.closeDetailStart * 0.5, 0.5)).toBeCloseTo(LABEL_CONTEXT_PARAMS.subordinateMinAlpha, 6);
    expect(subordinateAlphaFactor(LABEL_CONTEXT_PARAMS.closeDetailFull * 0.5, 0.5)).toBeCloseTo(1, 6);
  });

  it('FR-727 applies reduced opacity only to subordinate territories in the regular viewer', () => {
    const draws: ReadableDraw[] = [
      makeBoxDraw('Kazajistán', 'faction', 1),
      makeBoxDraw('Kazajistán', 'territory', 1),
      makeBoxDraw('Uzbekistán', 'territory', 2),
      makeBoxDraw('Francia', 'territory', 3),
    ];
    const atProvince = applyLabelContext(draws, { table, texts, scale: 2.2, detail: 1 });
    const byKey = new Map(atProvince.map((d) => [`${d.role}:${d.text}`, d]));
    expect(byKey.get('faction:Kazajistán')?.factor).toBeCloseTo(1, 6);
    expect(byKey.get('territory:Kazajistán')?.factor).toBeCloseTo(1, 6);
    expect(byKey.get('territory:Uzbekistán')?.factor).toBeCloseTo(LABEL_CONTEXT_PARAMS.subordinateMinAlpha, 6);
    expect(byKey.get('territory:Francia')?.factor).toBeCloseTo(1, 6);

    const atClose = applyLabelContext(draws, { table, texts, scale: 5.0, detail: 1 });
    const closeUzb = atClose.find((d) => d.role === 'territory' && d.text === 'Uzbekistán');
    expect(closeUzb?.factor).toBeCloseTo(1, 6);
  });

  it('FR-728 in round capture dims non-absorber labels, pins absorber faction label at 100%, and avoids duplicate homeland label', () => {
    const draws: ReadableDraw[] = [
      makeBoxDraw('Kazajistán', 'faction', 1),
      makeBoxDraw('Francia', 'faction', 2),
      makeBoxDraw('Kazajistán', 'territory', 1),
      makeBoxDraw('Uzbekistán', 'territory', 2),
      makeBoxDraw('Francia', 'territory', 3),
    ];
    const focused = applyLabelContext(draws, {
      table,
      texts,
      scale: 2.4,
      detail: 1,
      captureLit: new Set([1]),
    });
    const kazFac = focused.find((d) => d.role === 'faction' && d.text === 'Kazajistán');
    const fraFac = focused.find((d) => d.role === 'faction' && d.text === 'Francia');
    const kazTer = focused.find((d) => d.role === 'territory' && d.text === 'Kazajistán');
    const uzbTer = focused.find((d) => d.role === 'territory' && d.text === 'Uzbekistán');
    const fraTer = focused.find((d) => d.role === 'territory' && d.text === 'Francia');

    expect(kazFac?.factor).toBeCloseTo(1, 6);
    expect(kazFac?.pinned).toBe(true);
    // Even at scale 2.4 (> fadeFull = 2.0), a pinned faction label keeps full alpha 1.
    expect(labelAlpha(kazFac as AnyLabelDraw, 2.4, LABEL_PARAMS)).toBeCloseTo(1, 6);
    // Homeland territory label is suppressed when absorber faction label is pinned visible to avoid duplicate text.
    expect(kazTer).toBeUndefined();
    // Conquered province of absorber stays at subordinate opacity (45%), not double-dimmed.
    expect(uzbTer?.factor).toBeCloseTo(LABEL_CONTEXT_PARAMS.subordinateMinAlpha, 6);
    // Non-absorber labels are attenuated to captureDimAlpha.
    expect(fraFac?.factor).toBeCloseTo(LABEL_CONTEXT_PARAMS.captureDimAlpha, 6);
    expect(fraTer?.factor).toBeCloseTo(LABEL_CONTEXT_PARAMS.captureDimAlpha, 6);
  });
});
