import { compareCodeUnits } from '../core/errors';

/**
 * FR-599: the order of the error kinds of the curation stages, a literal list copied from the spec. Kinds whose
 * producers come later (the curation stage of the pipeline) are listed already, so the order is fixed in one place.
 */
export const CURATION_KIND_ORDER: readonly string[] = [
  'invalid-curation',
  'missing-unit-key',
  'invalid-unit-key',
  'conflicting-unit-property',
  'unknown-unit',
  'empty-selection',
  'invalid-name',
  'invalid-color',
  'invalid-key',
  'duplicate-faction-key',
  'sea-with-faction',
  'missing-group-value',
  'mixed-territory-kind',
  'conflicting-group-name',
  'missing-territory-name',
  'missing-faction',
  'split-territory-faction',
  'missing-faction-name',
  'faction-without-territory',
  'too-many-factions',
];

/** An error of the importer: a `kind` and its data fields, listed in the order the producer builds them. */
export interface KindedError {
  kind: string;
}

/** The data fields of an error in the order the producer wrote them (the kind is not one). */
function dataOf(error: KindedError): [string, unknown][] {
  return Object.entries(error).filter(([key]) => key !== 'kind');
}

/** One text that is the same for two errors exactly when kind and every data field are the same. */
function tupleKey(error: KindedError): string {
  const fields = dataOf(error).sort(([a], [b]) => compareCodeUnits(a, b));
  return JSON.stringify([error.kind, fields]);
}

/** Two data values in order: numbers as numbers, texts by code unit, anything else by its json text. */
function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return compareCodeUnits(typeof a === 'string' ? a : JSON.stringify(a), typeof b === 'string' ? b : JSON.stringify(b));
}

/** The place of a kind in the FR-599 order; a kind outside it goes after every listed one. */
function rankOf(kind: string): number {
  const at = CURATION_KIND_ORDER.indexOf(kind);
  return at < 0 ? CURATION_KIND_ORDER.length : at;
}

/**
 * FR-599: collects the errors of a stage. Each error is kept once per distinct data tuple (the kind and every data
 * field: two errors of one unit on two properties are both kept); the list is ordered by kind in the FR-599 order,
 * then by the first data field (numbers as numbers, texts by code unit), then by the remaining fields in order, so
 * that the result never depends on the order the producers found the errors in.
 */
export class ErrorCollector<E extends KindedError> {
  private readonly seen = new Map<string, E>();

  add(error: E): void {
    const key = tupleKey(error);
    if (!this.seen.has(key)) this.seen.set(key, error);
  }

  addAll(errors: readonly E[]): void {
    for (const error of errors) this.add(error);
  }

  get size(): number {
    return this.seen.size;
  }

  /** The collected errors in report order; the collector itself is not changed. */
  list(): E[] {
    return [...this.seen.values()].sort((a, b) => {
      const kinds = rankOf(a.kind) - rankOf(b.kind);
      if (kinds !== 0) return kinds;
      if (rankOf(a.kind) === CURATION_KIND_ORDER.length && a.kind !== b.kind) return compareCodeUnits(a.kind, b.kind);
      const da = dataOf(a);
      const db = dataOf(b);
      for (let i = 0; i < Math.max(da.length, db.length); i++) {
        if (da[i] === undefined) return -1;
        if (db[i] === undefined) return 1;
        const c = compareValues(da[i]![1], db[i]![1]);
        if (c !== 0) return c;
      }
      return 0;
    });
  }
}
