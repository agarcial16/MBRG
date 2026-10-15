import type { ValidationError } from './errors';
import { isValidId } from './ids';
import { isValidColor, isValidName } from './names';
import { PRESENTATION_KIND_ORDER } from './package-errors';
import type { PresentationError, PresentationLocation } from './package-errors';
import type { PresentationData, PresentationList } from './package-types';
import type { Result } from './types';
import { validateMap } from './validate';

/** Definitions "Object": non-null, object type, not a list. */
const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const ENTRY_FIELDS: Record<PresentationList, readonly string[]> = {
  factions: ['id', 'name', 'color'],
  territories: ['id', 'name'],
};

/** Structural phase, FR-95..FR-99. Errors in emission order; `blocking` per FR-92 table. */
function structuralErrors(data: Record<string, unknown>): {
  errors: PresentationError[];
  blocking: boolean;
} {
  const errors: PresentationError[] = [];
  let blocking = false;
  const block = (e: PresentationError): void => {
    errors.push(e);
    blocking = true;
  };

  // FR-89, FR-99: own keys in code-unit order.
  for (const field of Object.keys(data).sort()) {
    if (field !== 'factions' && field !== 'territories') {
      errors.push({ kind: 'presentation-unknown-field', location: { at: 'presentation' }, field });
    }
  }

  for (const list of ['factions', 'territories'] as const) {
    const v: unknown = Object.hasOwn(data, list) ? data[list] : undefined;
    if (!Array.isArray(v)) {
      block({ kind: 'invalid-presentation-list', list });
      continue;
    }
    const firstPositions = new Map<number, number[]>();
    for (let position = 0; position < v.length; position++) {
      const e: unknown = v[position];
      if (!isObject(e)) {
        block({ kind: 'invalid-presentation-entry', list, position });
        continue;
      }
      const rawId: unknown = Object.hasOwn(e, 'id') ? e.id : undefined;
      const idData: { id?: number } = {};
      if (isValidId(rawId)) {
        idData.id = rawId;
        const seen = firstPositions.get(rawId);
        if (seen) seen.push(position);
        else firstPositions.set(rawId, [position]);
      } else {
        block({ kind: 'invalid-presentation-id', list, position });
      }
      if (!(Object.hasOwn(e, 'name') && isValidName(e.name))) {
        errors.push({ kind: 'invalid-name', list, position, ...idData });
      }
      if (list === 'factions' && Object.hasOwn(e, 'color') && !isValidColor(e.color)) {
        errors.push({ kind: 'invalid-color', list, position, ...idData });
      }
      const allowed = ENTRY_FIELDS[list];
      for (const field of Object.keys(e).sort()) {
        if (!allowed.includes(field)) {
          const location: PresentationLocation = { at: 'entry', list, position, ...idData };
          errors.push({ kind: 'presentation-unknown-field', location, field });
        }
      }
    }
    for (const [id, positions] of firstPositions) {
      if (positions.length > 1) block({ kind: 'duplicate-presentation-id', list, id, positions });
    }
  }
  return { errors, blocking };
}

/** FR-94: stable sort by kind rank only; emission order carries the rest. */
function sortByKind(errors: readonly PresentationError[]): PresentationError[] {
  const rank = (e: PresentationError): number => PRESENTATION_KIND_ORDER.indexOf(e.kind);
  return [...errors].sort((a, b) => rank(a) - rank(b));
}

/**
 * FR-89..FR-104. Only reads its inputs; on success `value` is the same object as `data`.
 * An invalid map returns exactly the map errors (FR-91).
 */
export function checkPresentation(
  map: unknown,
  data: unknown,
): Result<PresentationData, ValidationError | PresentationError> {
  const m = validateMap(map);
  if (!m.ok) return m;
  if (!isObject(data)) return { ok: false, errors: [{ kind: 'invalid-presentation' }] };
  const structural = structuralErrors(data);
  const errors = [...structural.errors];
  // Relational phase (FR-93, T3): skipped when blocking; nothing to report yet.
  if (errors.length > 0) return { ok: false, errors: sortByKind(errors) };
  return { ok: true, value: data as unknown as PresentationData };
}
