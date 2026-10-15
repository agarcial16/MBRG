import type { ValidationError } from './errors';
import { factionOrder } from './faction-order';
import { isValidId } from './ids';
import { isValidColor, isValidName } from './names';
import { PRESENTATION_KIND_ORDER } from './package-errors';
import type { PresentationError, PresentationLocation } from './package-errors';
import type { PresentationData, PresentationList } from './package-types';
import type { MapData, Result } from './types';
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

/** Entries of a validated list with a valid own id, in position order (structural phase passed). */
function listEntries(data: Record<string, unknown>, list: PresentationList): Record<string, unknown>[] {
  const v = data[list] as unknown[];
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < v.length; i++) out.push(v[i] as Record<string, unknown>);
  return out;
}

/** Groups of >= 2 faction ids per equal value, in faction order of the first faction (FR-102, FR-103). */
function repeated(
  order: readonly number[],
  entries: readonly Record<string, unknown>[],
  read: (e: Record<string, unknown>) => string | undefined,
): Array<{ value: string; factions: number[] }> {
  const byId = new Map<number, string>();
  for (const e of entries) {
    const value = read(e);
    if (value !== undefined && order.includes(e.id as number)) byId.set(e.id as number, value);
  }
  const groups = new Map<string, number[]>();
  for (const id of order) {
    const value = byId.get(id);
    if (value === undefined) continue;
    const g = groups.get(value);
    if (g) g.push(id);
    else groups.set(value, [id]);
  }
  const out: Array<{ value: string; factions: number[] }> = [];
  for (const [value, factions] of groups) if (factions.length > 1) out.push({ value, factions });
  return out;
}

/** Relational phase, FR-90, FR-100..FR-103. Errors in emission order. */
function relationalErrors(map: MapData, data: Record<string, unknown>): PresentationError[] {
  const errors: PresentationError[] = [];
  const order = factionOrder(map);
  const entryIds: number[] = [];
  for (const entry of map.territories) entryIds.push(entry.id);
  const factions = listEntries(data, 'factions');
  const territories = listEntries(data, 'territories');

  for (const e of factions) {
    if (!order.includes(e.id as number)) {
      errors.push({ kind: 'unknown-presentation-id', list: 'factions', id: e.id as number });
    }
  }
  for (const e of territories) {
    if (!entryIds.includes(e.id as number)) {
      errors.push({ kind: 'unknown-presentation-id', list: 'territories', id: e.id as number });
    }
  }
  const listedFactions = new Set(factions.map((e) => e.id));
  for (const id of order) {
    if (!listedFactions.has(id)) errors.push({ kind: 'missing-presentation', list: 'factions', id });
  }
  const listedTerritories = new Set(territories.map((e) => e.id));
  for (const id of entryIds) {
    if (!listedTerritories.has(id)) {
      errors.push({ kind: 'missing-presentation', list: 'territories', id });
    }
  }
  const validName = (e: Record<string, unknown>): string | undefined =>
    Object.hasOwn(e, 'name') && isValidName(e.name) ? (e.name as string) : undefined;
  const validColor = (e: Record<string, unknown>): string | undefined =>
    Object.hasOwn(e, 'color') && isValidColor(e.color) ? (e.color as string) : undefined;
  for (const g of repeated(order, factions, validName)) {
    errors.push({ kind: 'duplicate-faction-name', name: g.value, factions: g.factions });
  }
  for (const g of repeated(order, factions, validColor)) {
    errors.push({ kind: 'duplicate-color', color: g.value, factions: g.factions });
  }
  return errors;
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
  // FR-93: the relational phase runs only when no blocking error was found.
  if (!structural.blocking) errors.push(...relationalErrors(m.value, data));
  if (errors.length > 0) return { ok: false, errors: sortByKind(errors) };
  return { ok: true, value: data as unknown as PresentationData };
}
