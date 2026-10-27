// The facts the left column of the match screen shows (spec 010 FR-360 to FR-362): the chronicle of the rounds and the factions with
// the round of their fall, their eliminations (bajas) and the territory they conquered. Pure; computed in the browser from the
// public records of rounds 1 to N (and the held state), with no server change. Nothing here can name a round above N or an
// absorber before its reveal: the caller passes the round that is drawn (`upTo`) and what the tours hide.
import type { LiveModel } from './live-model';
import type { FactionName } from './live-view';

export interface FactionRow {
  readonly id: number;
  readonly name: string;
  /** Territories owned at the round `upTo`. */
  readonly territories: number;
  readonly alive: boolean;
  /** Factions it eliminated (rounds in which it was the absorber) up to `upTo`; unknown while the history is incomplete. */
  readonly bajas: number | undefined;
  /** Territories it absorbed in total up to `upTo`; unknown while the history is incomplete. */
  readonly conq: number | undefined;
  /** The round in which it was eliminated, when the record of that round is held. */
  readonly fell: number | undefined;
}

export type SortKey = 'territories' | 'bajas' | 'conq';

/** The rounds from `upTo` down to 1 whose record is not held, newest first. */
export function missingRecords(model: LiveModel, upTo: number): number[] {
  const missing: number[] = [];
  for (let k = upTo; k >= 1; k--) if (!model.records.has(k)) missing.push(k);
  return missing;
}

/** The factions of the presentation with their facts at the round `upTo` (empty when that state is not held). */
export function factionRows(model: LiveModel, factions: readonly FactionName[], upTo: number): FactionRow[] {
  const owners = model.held.get(upTo);
  if (owners === undefined) return [];
  const counts = new Map<number, number>();
  for (const faction of owners.values()) counts.set(faction, (counts.get(faction) ?? 0) + 1);
  const complete = missingRecords(model, upTo).length === 0;
  const bajas = new Map<number, number>();
  const conq = new Map<number, number>();
  const fell = new Map<number, number>();
  for (let k = 1; k <= upTo; k++) {
    const record = model.records.get(k);
    if (record === undefined) continue;
    bajas.set(record.absorber, (bajas.get(record.absorber) ?? 0) + 1);
    conq.set(record.absorber, (conq.get(record.absorber) ?? 0) + record.transferred.length);
    fell.set(record.eliminated, k);
  }
  return factions.map((f) => {
    const territories = counts.get(f.id) ?? 0;
    return {
      id: f.id,
      name: f.name,
      territories,
      alive: territories > 0,
      bajas: complete ? (bajas.get(f.id) ?? 0) : undefined,
      conq: complete ? (conq.get(f.id) ?? 0) : undefined,
      fell: fell.get(f.id),
    };
  });
}

const byName = (a: FactionRow, b: FactionRow): number => a.name.localeCompare(b.name, 'es');

/**
 * The rows in the order of a column: the living first, the largest value first (an unknown value after the known ones), ties by
 * name; the fallen after them, the latest fall first. The input is not changed.
 */
export function sortRows(rows: readonly FactionRow[], key: SortKey): FactionRow[] {
  const value = (r: FactionRow): number | undefined => (key === 'territories' ? r.territories : key === 'bajas' ? r.bajas : r.conq);
  return [...rows].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (!a.alive) {
      const fa = a.fell ?? -1;
      const fb = b.fell ?? -1;
      return fb - fa || byName(a, b);
    }
    const va = value(a);
    const vb = value(b);
    if (va === undefined || vb === undefined) return va === vb ? byName(a, b) : va === undefined ? 1 : -1;
    return vb - va || byName(a, b);
  });
}

const plain = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** The rows that match a search: a faction name (any case, any accent) or the round of a fall ("2" or "ronda 2"). */
export function searchRows(rows: readonly FactionRow[], query: string): FactionRow[] {
  const q = plain(query);
  if (q === '') return [...rows];
  const round = /^(?:ronda\s*)?(\d+)$/.exec(q);
  if (round !== null) return rows.filter((r) => r.fell === Number(round[1]));
  return rows.filter((r) => plain(r.name).includes(q));
}

/** The first `limit` rows, or all of them when `all` is set; `hidden` is how many are left out. */
export function visibleRows(rows: readonly FactionRow[], limit: number, all: boolean): { shown: FactionRow[]; hidden: number } {
  if (all || rows.length <= limit) return { shown: [...rows], hidden: 0 };
  return { shown: rows.slice(0, limit), hidden: rows.length - limit };
}

export type ChronicleEntry =
  | { readonly status: 'applied'; readonly round: number; readonly victim: string; readonly absorber: string; readonly taken: number }
  /** The victim of a round that has no absorber yet; `victim` is undefined while its reveal tour has not stopped on it. */
  | { readonly status: 'pending'; readonly round: number; readonly victim: string | undefined };

/**
 * The chronicle at the drawn round `upTo`, newest first. The round after `upTo` appears as a pending entry with its victim when
 * the victim is public (revealed, or applied but hidden by the absorber tour); the absorber and the territories only appear once
 * the round is drawn.
 */
export function chronicle(
  model: LiveModel,
  factions: readonly FactionName[],
  upTo: number,
  tour: { readonly revealing: boolean; readonly absorbing: boolean },
): ChronicleEntry[] {
  const nameOf = (id: number): string => factions.find((f) => f.id === id)?.name ?? String(id);
  const entries: ChronicleEntry[] = [];
  const next = upTo + 1;
  const pendingVictim = model.victim !== undefined && model.victim.round === next ? model.victim.victim : tour.absorbing ? model.records.get(next)?.eliminated : undefined;
  if (pendingVictim !== undefined) entries.push({ status: 'pending', round: next, victim: tour.revealing ? undefined : nameOf(pendingVictim) });
  for (let k = upTo; k >= 1; k--) {
    const record = model.records.get(k);
    if (record !== undefined) entries.push({ status: 'applied', round: k, victim: nameOf(record.eliminated), absorber: nameOf(record.absorber), taken: record.transferred.length });
  }
  return entries;
}
