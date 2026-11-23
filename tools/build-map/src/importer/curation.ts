import type { Result } from '@mbrg/shared';
import { own } from '../core/errors';
import type { CurationError, SourceError } from './types';

/**
 * FR-592: the curation file. This module reads and checks its schema only: types, members, ranges and the caps on
 * list lengths. What a value means against the data (an unknown unit, a key of the wrong length, a bad color) is
 * checked in the curation stage (FR-599), never here; in particular a territory or faction key outside 1 to 256 code
 * units is `invalid-key` there, not `invalid-curation` here.
 */

/** NFR-135: the size cap of a curation file, checked before parsing. */
export const CURATION_MAX_BYTES = 16 * 1024 * 1024;

/** A property value the filters compare: a text or an integer (FR-593 "usable value"). */
export type Usable = string | number;

/** FR-594: one filter of `select` (also of an inset's `select`). */
export type Filter =
  | { property: string; eq: Usable }
  | { property: string; in: Usable[] }
  | { property: string; gte: Usable }
  | { property: string; lte: Usable }
  | { bbox: [number, number, number, number]; mode: 'within' | 'intersects' };

/** FR-600: the parameters. */
export interface Params {
  side: number;
  margin: number;
  minPieceSize: number;
  projection: 'laea' | 'equal-earth';
  gapFill?: number;
  /** FR-602: the widest strip of water between a land territory and other land that becomes other land (0 to 16). */
  contextGap?: number;
  /** FR-602: how far (pixels) an exclave group looks for territories to link to (0 to 1,024; 0 turns it off). */
  exclaveReach?: number;
}

/** FR-595: one entry of the per-unit layer. */
export interface UnitEntry {
  name?: string;
  kind?: 'land' | 'sea' | 'exclude';
  territory?: string;
  faction?: string;
}

/** FR-596, FR-597: a column rule. */
export interface GroupBy {
  property: string;
  nameProperty?: string;
}

export interface FactionEntry {
  key: string;
  name: string;
  color?: string;
}

export interface SeaEntry {
  name: string;
  lon: number;
  lat: number;
}

export interface InsetEntry {
  select: Filter[];
  at: [number, number];
  /** FR-601: the name of an entry of `seas`: all the water inside the rectangle belongs to that zone. */
  sea?: string;
}

/** FR-592: a checked curation; optional members are given empty when absent. Paths are the text as written. */
export interface Curation {
  primary: string;
  context: string[];
  columns: { key: string; name: string[] };
  select: Filter[];
  exclude: string[];
  params: Params;
  units: Map<string, UnitEntry>;
  territoryBy?: GroupBy;
  territoryNames: Map<string, string>;
  factions: FactionEntry[];
  factionBy?: GroupBy;
  seas: SeaEntry[];
  insets: InsetEntry[];
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isUsable = (x: unknown): x is Usable => typeof x === 'string' || (typeof x === 'number' && Number.isSafeInteger(x));
const isInteger = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x);
const isFinite_ = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

const at = (parent: string, member: string): string => (parent === '' ? member : `${parent}.${member}`);
const item = (parent: string, index: number): string => `${parent}[${index}]`;

/** Collects the paths of every schema problem, in the order they are found. */
class Problems {
  readonly paths: string[] = [];
  add(path: string): void {
    this.paths.push(path);
  }
}

/** Flags every member of `object` that is not in `known`, in the order they appear in the file. */
function noUnknown(object: Record<string, unknown>, known: readonly string[], path: string, problems: Problems): void {
  for (const member of Object.keys(object)) if (!known.includes(member)) problems.add(at(path, member));
}

/** A required text member, or undefined (after recording the problem). */
function text(object: Record<string, unknown>, member: string, path: string, problems: Problems): string | undefined {
  const value = own(object, member);
  if (typeof value === 'string') return value;
  problems.add(at(path, member));
  return undefined;
}

/** An optional text member: absent is fine, any other type is a problem. */
function optionalText(object: Record<string, unknown>, member: string, path: string, problems: Problems): string | undefined {
  if (!Object.hasOwn(object, member)) return undefined;
  return text(object, member, path, problems);
}

/** A list of texts within `max` entries; the problem is the list's path when it is too long, the entry's when one is no text. */
function textList(value: unknown, path: string, problems: Problems, min: number, max: number): string[] | undefined {
  if (!Array.isArray(value)) {
    problems.add(path);
    return undefined;
  }
  if (value.length < min || value.length > max) problems.add(path);
  const out: string[] = [];
  value.forEach((entry: unknown, i) => {
    if (typeof entry === 'string') out.push(entry);
    else problems.add(item(path, i));
  });
  return out;
}

function readFilter(value: unknown, path: string, problems: Problems): Filter | undefined {
  if (!isObject(value)) {
    problems.add(path);
    return undefined;
  }
  const before = problems.paths.length;
  if (Object.hasOwn(value, 'bbox')) {
    noUnknown(value, ['bbox', 'mode'], path, problems);
    const box = own(value, 'bbox');
    let bbox: [number, number, number, number] | undefined;
    if (!Array.isArray(box) || box.length !== 4) problems.add(at(path, 'bbox'));
    else {
      box.forEach((n: unknown, i) => {
        if (!isFinite_(n)) problems.add(item(at(path, 'bbox'), i));
      });
      bbox = box as [number, number, number, number];
    }
    const mode = own(value, 'mode');
    if (mode !== 'within' && mode !== 'intersects') problems.add(at(path, 'mode'));
    return problems.paths.length === before ? ({ bbox: bbox!, mode: mode as 'within' | 'intersects' } as Filter) : undefined;
  }
  noUnknown(value, ['property', 'eq', 'in', 'gte', 'lte'], path, problems);
  const property = text(value, 'property', path, problems);
  // Exactly one operator; each one past the first is a problem of its own.
  const operators = (['eq', 'in', 'gte', 'lte'] as const).filter((op) => Object.hasOwn(value, op));
  if (operators.length === 0) problems.add(path);
  operators.slice(1).forEach((op) => problems.add(at(path, op)));
  const op = operators[0];
  let filter: Filter | undefined;
  if (op !== undefined) {
    const operand = own(value, op);
    if (op === 'in') {
      if (!Array.isArray(operand)) problems.add(at(path, op));
      else {
        operand.forEach((v: unknown, i) => {
          if (!isUsable(v)) problems.add(item(at(path, op), i));
        });
        filter = { property: property ?? '', in: operand as Usable[] };
      }
    } else if (!isUsable(operand)) problems.add(at(path, op));
    else filter = { property: property ?? '', [op]: operand } as Filter;
  }
  return problems.paths.length === before ? filter : undefined;
}

function readFilters(value: unknown, path: string, problems: Problems): Filter[] {
  if (!Array.isArray(value)) {
    problems.add(path);
    return [];
  }
  const out: Filter[] = [];
  value.forEach((entry: unknown, i) => {
    const filter = readFilter(entry, item(path, i), problems);
    if (filter !== undefined) out.push(filter);
  });
  return out;
}

function readGroupBy(value: unknown, path: string, problems: Problems): GroupBy | undefined {
  if (!isObject(value)) {
    problems.add(path);
    return undefined;
  }
  noUnknown(value, ['property', 'nameProperty'], path, problems);
  const property = text(value, 'property', path, problems);
  // An empty property names no column: refuse it here, so a draft filled in on its columns only fails cleanly.
  if (property === '') problems.add(at(path, 'property'));
  const nameProperty = optionalText(value, 'nameProperty', path, problems);
  if (property === undefined || property === '' || (Object.hasOwn(value, 'nameProperty') && nameProperty === undefined)) return undefined;
  return nameProperty === undefined ? { property } : { property, nameProperty };
}

function readRange(params: Record<string, unknown>, member: string, min: number, max: number, integer: boolean, problems: Problems): number | undefined {
  const value = own(params, member);
  const ok = integer ? isInteger(value) : isFinite_(value);
  if (!ok || (value as number) < min || (value as number) > max) {
    problems.add(at('params', member));
    return undefined;
  }
  return value as number;
}

function readParams(value: unknown, problems: Problems): Params | undefined {
  if (!isObject(value)) {
    problems.add('params');
    return undefined;
  }
  noUnknown(value, ['side', 'margin', 'minPieceSize', 'projection', 'gapFill', 'contextGap', 'exclaveReach'], 'params', problems);
  const side = readRange(value, 'side', 64, 16384, true, problems);
  const margin = readRange(value, 'margin', 0, 0.5, false, problems);
  const minPieceSize = readRange(value, 'minPieceSize', 1, 10000, true, problems);
  const projection = own(value, 'projection');
  if (projection !== 'laea' && projection !== 'equal-earth') problems.add('params.projection');
  const gapFill = Object.hasOwn(value, 'gapFill') ? readRange(value, 'gapFill', 1, 10000, true, problems) : undefined;
  const contextGap = Object.hasOwn(value, 'contextGap') ? readRange(value, 'contextGap', 0, 16, true, problems) : undefined;
  if (side === undefined || margin === undefined || minPieceSize === undefined) return undefined;
  if (projection !== 'laea' && projection !== 'equal-earth') return undefined;
  if (Object.hasOwn(value, 'gapFill') && gapFill === undefined) return undefined;
  const exclaveReach = Object.hasOwn(value, 'exclaveReach') ? readRange(value, 'exclaveReach', 0, 1024, true, problems) : undefined;
  if (Object.hasOwn(value, 'contextGap') && contextGap === undefined) return undefined;
  if (Object.hasOwn(value, 'exclaveReach') && exclaveReach === undefined) return undefined;
  return {
    side,
    margin,
    minPieceSize,
    projection,
    ...(gapFill === undefined ? {} : { gapFill }),
    ...(contextGap === undefined ? {} : { contextGap }),
    ...(exclaveReach === undefined ? {} : { exclaveReach }),
  };
}

/**
 * FR-592: reads and checks a curation file. The size is checked first, before any decoding or parsing (NFR-135); then
 * every schema problem of the file is reported together as `invalid-curation` with the member path (the empty text
 * for the file as a whole), known members in the order of the spec first, unknown members after. Pure; every read of
 * untrusted data uses the own-property rule.
 */
export function parseCuration(bytes: Uint8Array, file: string): Result<Curation, CurationError | SourceError> {
  if (bytes.length > CURATION_MAX_BYTES) {
    return { ok: false, errors: [{ kind: 'source-too-large', file, what: 'bytes', cap: CURATION_MAX_BYTES, found: bytes.length }] };
  }
  const whole: Result<Curation, CurationError> = { ok: false, errors: [{ kind: 'invalid-curation', path: '' }] };
  let root: unknown;
  try {
    root = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return whole;
  }
  if (!isObject(root)) return whole;

  const problems = new Problems();
  noUnknown(root, ['primary', 'context', 'columns', 'select', 'exclude', 'params', 'units', 'territoryBy', 'territoryNames', 'factions', 'factionBy', 'seas', 'insets'], '', problems);
  const primary = text(root, 'primary', '', problems);
  const context = Object.hasOwn(root, 'context') ? textList(own(root, 'context'), 'context', problems, 0, 8) : [];

  let columns: Curation['columns'] | undefined;
  const rawColumns = own(root, 'columns');
  if (!isObject(rawColumns)) problems.add('columns');
  else {
    noUnknown(rawColumns, ['key', 'name'], 'columns', problems);
    const key = text(rawColumns, 'key', 'columns', problems);
    if (key === '') problems.add('columns.key');
    const name = textList(own(rawColumns, 'name'), 'columns.name', problems, 1, 3);
    if (key !== undefined && key !== '' && name !== undefined) columns = { key, name };
  }

  const select = Object.hasOwn(root, 'select') ? readFilters(own(root, 'select'), 'select', problems) : [];
  const exclude = Object.hasOwn(root, 'exclude') ? textList(own(root, 'exclude'), 'exclude', problems, 0, Infinity) : [];
  const params = readParams(own(root, 'params'), problems);

  const units = new Map<string, UnitEntry>();
  if (Object.hasOwn(root, 'units')) {
    const raw = own(root, 'units');
    if (!isObject(raw)) problems.add('units');
    else {
      for (const key of Object.keys(raw)) {
        const path = at('units', key);
        const entry = raw[key];
        if (!isObject(entry)) {
          problems.add(path);
          continue;
        }
        noUnknown(entry, ['name', 'kind', 'territory', 'faction'], path, problems);
        const out: UnitEntry = {};
        const name = optionalText(entry, 'name', path, problems);
        if (name !== undefined) out.name = name;
        if (Object.hasOwn(entry, 'kind')) {
          const kind = own(entry, 'kind');
          if (kind === 'land' || kind === 'sea' || kind === 'exclude') out.kind = kind;
          else problems.add(at(path, 'kind'));
        }
        const territory = optionalText(entry, 'territory', path, problems);
        if (territory !== undefined) out.territory = territory;
        const faction = optionalText(entry, 'faction', path, problems);
        if (faction !== undefined) out.faction = faction;
        units.set(key, out);
      }
    }
  }

  const territoryBy = Object.hasOwn(root, 'territoryBy') ? readGroupBy(own(root, 'territoryBy'), 'territoryBy', problems) : undefined;
  const territoryNames = new Map<string, string>();
  if (Object.hasOwn(root, 'territoryNames')) {
    const raw = own(root, 'territoryNames');
    if (!isObject(raw)) problems.add('territoryNames');
    else {
      for (const key of Object.keys(raw)) {
        const value = raw[key];
        if (typeof value === 'string') territoryNames.set(key, value);
        else problems.add(at('territoryNames', key));
      }
    }
  }

  const factions: FactionEntry[] = [];
  if (Object.hasOwn(root, 'factions')) {
    const raw = own(root, 'factions');
    if (!Array.isArray(raw)) problems.add('factions');
    else {
      if (raw.length > 9999) problems.add('factions');
      raw.forEach((entry: unknown, i) => {
        const path = item('factions', i);
        if (!isObject(entry)) {
          problems.add(path);
          return;
        }
        const before = problems.paths.length;
        noUnknown(entry, ['key', 'name', 'color'], path, problems);
        const key = text(entry, 'key', path, problems);
        const name = text(entry, 'name', path, problems);
        const color = optionalText(entry, 'color', path, problems);
        if (problems.paths.length === before && key !== undefined && name !== undefined) {
          factions.push(color === undefined ? { key, name } : { key, name, color });
        }
      });
    }
  }
  const factionBy = Object.hasOwn(root, 'factionBy') ? readGroupBy(own(root, 'factionBy'), 'factionBy', problems) : undefined;

  const seas: SeaEntry[] = [];
  if (Object.hasOwn(root, 'seas')) {
    const raw = own(root, 'seas');
    if (!Array.isArray(raw)) problems.add('seas');
    else {
      if (raw.length > 1024) problems.add('seas');
      raw.forEach((entry: unknown, i) => {
        const path = item('seas', i);
        if (!isObject(entry)) {
          problems.add(path);
          return;
        }
        const before = problems.paths.length;
        noUnknown(entry, ['name', 'lon', 'lat'], path, problems);
        const name = text(entry, 'name', path, problems);
        const lon = own(entry, 'lon');
        const lat = own(entry, 'lat');
        if (!isFinite_(lon)) problems.add(at(path, 'lon'));
        if (!isFinite_(lat)) problems.add(at(path, 'lat'));
        if (problems.paths.length === before) seas.push({ name: name!, lon: lon as number, lat: lat as number });
      });
    }
  }

  const insets: InsetEntry[] = [];
  if (Object.hasOwn(root, 'insets')) {
    const raw = own(root, 'insets');
    if (!Array.isArray(raw)) problems.add('insets');
    else {
      raw.forEach((entry: unknown, i) => {
        const path = item('insets', i);
        if (!isObject(entry)) {
          problems.add(path);
          return;
        }
        const before = problems.paths.length;
        noUnknown(entry, ['select', 'at', 'sea'], path, problems);
        const filters = Object.hasOwn(entry, 'select') ? readFilters(own(entry, 'select'), at(path, 'select'), problems) : (problems.add(at(path, 'select')), []);
        const position = own(entry, 'at');
        if (!Array.isArray(position) || position.length !== 2) problems.add(at(path, 'at'));
        else
          position.forEach((n: unknown, j) => {
            if (!isInteger(n)) problems.add(item(at(path, 'at'), j));
          });
        const sea = Object.hasOwn(entry, 'sea') ? own(entry, 'sea') : undefined;
        if (Object.hasOwn(entry, 'sea') && (typeof sea !== 'string' || !seas.some((s) => s.name === sea))) problems.add(at(path, 'sea'));
        if (problems.paths.length === before) insets.push({ select: filters, at: position as [number, number], ...(typeof sea === 'string' ? { sea } : {}) });
      });
    }
  }

  if (problems.paths.length > 0 || primary === undefined || context === undefined || columns === undefined || exclude === undefined || params === undefined) {
    return { ok: false, errors: problems.paths.map((path) => ({ kind: 'invalid-curation' as const, path })) };
  }
  const curation: Curation = { primary, context, columns, select, exclude, params, units, territoryNames, factions, seas, insets };
  if (territoryBy !== undefined) curation.territoryBy = territoryBy;
  if (factionBy !== undefined) curation.factionBy = factionBy;
  return { ok: true, value: curation };
}

/**
 * FR-588: the names of the properties a curation reads from the sources, in the order of first mention: the key and
 * name columns, every filter of `select` and of the insets, and both column rules with their name properties.
 */
export function usedProperties(curation: Curation): string[] {
  const names: string[] = [curation.columns.key, ...curation.columns.name];
  const filters = [...curation.select, ...curation.insets.flatMap((inset) => inset.select)];
  for (const filter of filters) if ('property' in filter) names.push(filter.property);
  for (const rule of [curation.territoryBy, curation.factionBy]) {
    if (rule === undefined) continue;
    names.push(rule.property);
    if (rule.nameProperty !== undefined) names.push(rule.nameProperty);
  }
  return [...new Set(names)];
}
