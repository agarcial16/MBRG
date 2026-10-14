import { VALIDATION_KIND_ORDER } from './errors';
import type { ValidationError } from './errors';
import type { MapData, Result } from './types';
import { validateRelational } from './validate-relational';
import { validateStructural } from './validate-structural';

/** Position of the first territory an error names; -1 for top-level errors (FR-11). */
function firstPosition(e: ValidationError): number {
  switch (e.kind) {
    case 'invalid-territory':
    case 'invalid-territory-id':
    case 'invalid-neighbors':
    case 'missing-owner':
    case 'invalid-owner':
      return e.position;
    case 'duplicate-territory-id':
      return e.positions[0] ?? -1;
    case 'unknown-field':
      return e.location.at === 'map' ? -1 : e.location.position;
    default:
      // Relational kinds are emitted in map order, which the stable sort preserves within a kind.
      return -1;
  }
}

/** FR-11: stable sort by kind (FR-10 table order), then by position. Returns a new array. */
export function sortErrors(errors: readonly ValidationError[]): ValidationError[] {
  const rank = (e: ValidationError): number => VALIDATION_KIND_ORDER.indexOf(e.kind);
  return [...errors].sort((a, b) => rank(a) - rank(b) || firstPosition(a) - firstPosition(b));
}

/** FR-9, FR-11, FR-28. Only reads the input; on success `value` is the same object. */
export function validateMap(input: unknown): Result<MapData, ValidationError> {
  const structural = validateStructural(input);
  const errors = [...structural.errors];
  if (!structural.blocking) errors.push(...validateRelational(input as MapData));
  if (errors.length > 0) return { ok: false, errors: sortErrors(errors) };
  return { ok: true, value: input as MapData };
}
