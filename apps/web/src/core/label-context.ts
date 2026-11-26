// Subordinate territory label opacity ramp and round-capture label focus (spec 039 FR-727, FR-728, NFR-192).
// Pure, deterministic, no DOM or clock. Does not touch the label placement/layout algorithm.
import type { LabelTexts } from './label-input';
import { LABEL_PARAMS } from './label-params';
import type { ReadableDraw } from './label-readable';
import { smoothstep } from './lines';

export interface LabelContextParams {
  /** Base opacity factor for subordinate (conquered/sub-province) territory labels at province zoom (FR-727). */
  readonly subordinateMinAlpha: number;
  /** Scale (at detail = 1) where subordinate territory labels begin ramping toward 100% opacity (FR-727). */
  readonly closeDetailStart: number;
  /** Scale (at detail = 1) where subordinate territory labels reach 100% opacity (FR-727). */
  readonly closeDetailFull: number;
  /** Opacity factor for dimmed (non-absorber) labels in round-capture mode (FR-728). */
  readonly captureDimAlpha: number;
}

export const LABEL_CONTEXT_PARAMS: LabelContextParams = {
  subordinateMinAlpha: 0.45,
  closeDetailStart: 3.0,
  closeDetailFull: 4.5,
  captureDimAlpha: 0.35,
};

/**
 * True when land territory `entry` is subordinate to its owning faction: its territory name differs from
 * its owning faction's name (conquered former country or named sub-province inside an empire, FR-727).
 */
export function isSubordinateTerritory(entry: number, table: ArrayLike<number>, texts: LabelTexts): boolean {
  if (entry <= 0) return false;
  const owner = table[entry] ?? 0;
  if (owner <= 0) return false;
  const territoryName = texts.territories[entry];
  const factionName = texts.factions.get(owner);
  if (territoryName === undefined || factionName === undefined) return false;
  return territoryName !== factionName;
}

/**
 * Opacity multiplier in [subordinateMinAlpha, 1] for a subordinate territory label at `scale` and screen `detail`
 * factor (FR-727): stays softened at province zoom and ramps smoothly to 100% only when zoomed in close.
 */
export function subordinateAlphaFactor(
  scale: number,
  detail = 1,
  params: LabelContextParams = LABEL_CONTEXT_PARAMS,
): number {
  const t = smoothstep(params.closeDetailStart * detail, params.closeDetailFull * detail, scale);
  return params.subordinateMinAlpha + (1 - params.subordinateMinAlpha) * t;
}

export interface LabelContextInput {
  readonly table: ArrayLike<number>;
  readonly texts: LabelTexts;
  readonly scale: number;
  readonly detail?: number;
  /** Non-empty set of lit faction indices during round-capture mode (FR-728); absent in the regular viewer. */
  readonly captureLit?: ReadonlySet<number>;
  readonly fadeStart?: number;
}

/**
 * Applies Spec 039 opacity and focus rules to resolved or round label draws (FR-727, FR-728):
 * - Subordinate territories soften at province zoom and ramp to 100% at close zoom (viewer + capture).
 * - In round-capture mode, dimmed (non-absorber) labels attenuate to `captureDimAlpha`, the absorber's faction label
 *   is pinned visible at 100% even above `fadeStart`, and its homeland territory label is suppressed when pinned so
 *   the absorber name is never drawn twice.
 */
export function applyLabelContext(
  draws: readonly ReadableDraw[],
  ctx: LabelContextInput,
  params: LabelContextParams = LABEL_CONTEXT_PARAMS,
): ReadableDraw[] {
  const detail = ctx.detail ?? 1;
  const subFactor = subordinateAlphaFactor(ctx.scale, detail, params);
  const captureActive = ctx.captureLit !== undefined && ctx.captureLit.size > 0;
  const fadeStart = (ctx.fadeStart ?? LABEL_PARAMS.fadeStart) * detail;
  const pinAbsorber = captureActive && ctx.scale >= fadeStart;

  const out: ReadableDraw[] = [];
  for (const d of draws) {
    if (d.role === 'faction') {
      if (!captureActive) {
        out.push(d);
        continue;
      }
      const lit = d.id !== undefined && ctx.captureLit!.has(d.id);
      if (lit) {
        out.push(pinAbsorber ? { ...d, pinned: true } : d);
      } else {
        out.push({ ...d, factor: d.factor * params.captureDimAlpha });
      }
      continue;
    }

    const entry = d.id;
    const owner = entry !== undefined && entry > 0 ? (ctx.table[entry] ?? 0) : 0;
    const subordinate = entry !== undefined && isSubordinateTerritory(entry, ctx.table, ctx.texts);

    if (captureActive) {
      const lit = owner > 0 && ctx.captureLit!.has(owner);
      if (lit) {
        if (pinAbsorber && !subordinate) continue;
        out.push(subordinate ? { ...d, factor: d.factor * subFactor } : d);
      } else {
        out.push({ ...d, factor: d.factor * params.captureDimAlpha });
      }
      continue;
    }

    out.push(subordinate ? { ...d, factor: d.factor * subFactor } : d);
  }
  return out;
}
