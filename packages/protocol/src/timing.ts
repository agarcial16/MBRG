import { errorReply, type ErrorReply } from './errors';
import type { Timing } from './wire';

/** The failed rules of FR-233, named by their letter. */
export type TimingRule = 'a' | 'b' | 'c' | 'd';
export const MAX_INTERVAL_SECONDS = 2_592_000; // 30 days (P24)

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const isJsonNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Shape check (FR-233, FR-296): `manual`, or an object with exactly the own fields i, l1, l2, each a JSON number.
 * Returns the first failing field name (`timing`, `timing.i`, ...) or the timing; ranges are not checked here.
 * Nothing is filled in (FR-234).
 */
export function readTimingShape(value: unknown): { ok: true; value: Timing } | { ok: false; field: string } {
  if (value === 'manual') return { ok: true, value: 'manual' };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, field: 'timing' };
  const o = value as Record<string, unknown>;
  for (const key of ['i', 'l1', 'l2']) {
    if (!hasOwn(o, key) || !isJsonNumber(o[key])) return { ok: false, field: `timing.${key}` };
  }
  const extra = Object.keys(o).filter((k) => k !== 'i' && k !== 'l1' && k !== 'l2').sort()[0];
  if (extra !== undefined) return { ok: false, field: `timing.${extra}` };
  return { ok: true, value: { i: o.i as number, l1: o.l1 as number, l2: o.l2 as number } };
}

/** Every failed rule of FR-233 in (a) to (d) order; `manual` has none. */
export function timingRuleFailures(timing: Timing): TimingRule[] {
  if (timing === 'manual') return [];
  const { i, l1, l2 } = timing;
  const failed: TimingRule[] = [];
  if (!Number.isInteger(i) || i < 1 || !Number.isInteger(l1) || l1 < 1) failed.push('a');
  if (!Number.isInteger(l2) || l2 < 0) failed.push('b');
  if (i <= l1 + l2) failed.push('c');
  if (i > MAX_INTERVAL_SECONDS) failed.push('d');
  return failed;
}

export type TimingResult = { ok: true; value: Timing } | { ok: false; error: ErrorReply };

/** Shape errors are `invalid-request` (naming the field); numeric rule failures are `invalid-timing` listing each rule. */
export function readTiming(value: unknown): TimingResult {
  const shape = readTimingShape(value);
  if (!shape.ok) return { ok: false, error: errorReply('invalid-request', [shape.field]) };
  const failed = timingRuleFailures(shape.value);
  if (failed.length > 0) return { ok: false, error: errorReply('invalid-timing', failed) };
  return { ok: true, value: shape.value };
}
