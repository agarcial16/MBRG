import type { ValidationError } from './errors';
import { isValidId } from './ids';

export interface StructuralResult {
  /** Errors in emission order (not yet sorted by FR-11). */
  errors: ValidationError[];
  /** True if any blocking error (FR-10) was found: relational checks must be skipped (FR-9). */
  blocking: boolean;
}

const TERRITORY_FIELDS = ['id', 'owner', 'neighbors'];

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** True if every index holds a valid id; an empty slot is not valid. */
function allValidIds(list: unknown[]): boolean {
  for (let i = 0; i < list.length; i++) if (!isValidId(list[i])) return false;
  return true;
}

/** Field names sorted by code-unit order (never localeCompare), FR-11. */
const sortedKeys = (o: Record<string, unknown>): string[] => Object.keys(o).sort();

/** FR-12..FR-20. Only reads the input. */
export function validateStructural(input: unknown): StructuralResult {
  const errors: ValidationError[] = [];
  let blocking = false;
  const block = (e: ValidationError): void => {
    errors.push(e);
    blocking = true;
  };

  if (!isPlainObject(input)) return { errors: [{ kind: 'invalid-map' }], blocking: true };

  for (const field of sortedKeys(input)) {
    if (field !== 'territories') {
      errors.push({ kind: 'unknown-field', location: { at: 'map' }, field });
    }
  }

  const list = Object.hasOwn(input, 'territories') ? input.territories : undefined;
  if (!Array.isArray(list)) {
    block({ kind: 'invalid-territories' });
    return { errors, blocking };
  }

  const positionsById = new Map<number, number[]>();

  // Walk by index: forEach/every/for...of skip or mishandle the empty slots of a sparse array.
  for (let position = 0; position < list.length; position++) {
    const t: unknown = list[position];
    if (!isPlainObject(t)) {
      block({ kind: 'invalid-territory', position });
      continue;
    }

    const id = Object.hasOwn(t, 'id') && isValidId(t.id) ? t.id : undefined;
    const idData: { id?: number } = {};
    if (id === undefined) {
      block({ kind: 'invalid-territory-id', position });
    } else {
      idData.id = id;
      const seen = positionsById.get(id);
      if (seen) seen.push(position);
      else positionsById.set(id, [position]);
    }

    const neighbors = Object.hasOwn(t, 'neighbors') ? t.neighbors : undefined;
    if (!Array.isArray(neighbors) || !allValidIds(neighbors)) {
      block({ kind: 'invalid-neighbors', position, ...idData });
    }

    const owner = Object.hasOwn(t, 'owner') ? t.owner : null;
    if (owner === null) errors.push({ kind: 'missing-owner', position, ...idData });
    else if (!isValidId(owner)) errors.push({ kind: 'invalid-owner', position, ...idData });

    for (const field of sortedKeys(t)) {
      if (!TERRITORY_FIELDS.includes(field)) {
        errors.push({
          kind: 'unknown-field',
          location: { at: 'territory', position, ...idData },
          field,
        });
      }
    }
  }

  for (const [id, positions] of positionsById) {
    if (positions.length > 1) block({ kind: 'duplicate-territory-id', id, positions });
  }

  return { errors, blocking };
}
