// Round navigation (FR-154). Pure: the total T and the current round are parameters; no camera is involved (FR-149).
import { STRINGS, fillTemplate } from './strings';

export type NavAction = 'first' | 'previous' | 'next' | 'last' | { to: number };

/** The round action of a keyboard key (FR-154), or undefined for any other key. */
export function keyAction(key: string): NavAction | undefined {
  if (key === 'ArrowLeft') return 'previous';
  if (key === 'ArrowRight') return 'next';
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  return undefined;
}

/** False while the key event target is a text field: the field gets the key (FR-154). */
export function shortcutApplies(targetTag: string | undefined): boolean {
  const tag = (targetTag ?? '').toUpperCase();
  return tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT';
}

/** Digits only: no sign, space, exponent or fraction (same rule as the address). */
const DIGITS = /^[0-9]+$/;

/** The round after an action, or 'invalid' when it is out of bounds (the displayed round is then kept). */
export function navigate(n: number, total: number, action: NavAction): number | 'invalid' {
  let target: number;
  if (action === 'first') target = 0;
  else if (action === 'previous') target = n - 1;
  else if (action === 'next') target = n + 1;
  else if (action === 'last') target = total;
  else target = action.to;
  return Number.isInteger(target) && target >= 0 && target <= total ? target : 'invalid';
}

/** A typed round: digits only and 0 <= round <= T, else 'invalid'. */
export function parseTypedRound(text: string, total: number): number | 'invalid' {
  if (!DIGITS.test(text)) return 'invalid';
  const value = Number(text);
  return value <= total ? value : 'invalid';
}

export interface ControlsState {
  firstDisabled: boolean;
  previousDisabled: boolean;
  nextDisabled: boolean;
  lastDisabled: boolean;
}

/** Previous and first are disabled at round 0; next and last at round T. */
export function controlsState(n: number, total: number): ControlsState {
  return { firstDisabled: n <= 0, previousDisabled: n <= 0, nextDisabled: n >= total, lastDisabled: n >= total };
}

/** The Spanish message for a typed round that is not valid. */
export function typedRoundMessage(text: string, total: number): string {
  return fillTemplate(STRINGS.typedRoundInvalid, { text, total });
}
