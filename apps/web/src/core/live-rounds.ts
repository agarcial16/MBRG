// Rounds held by the live viewer (FR-303, FR-304). Pure. The state of a new round is built only from the record the
// server announced for it (a transfer of the listed territories), never by playing a round in the browser, and is
// accepted only after its digest matched. Nothing here names the engine.
import { stateText, type RecordReply } from '@mbrg/protocol';
import type { FactionId, TerritoryId } from '@mbrg/shared';
import type { StepData } from './step';

/** The owner of every land territory at one round, in the order of the map (the order of the state digest text). */
export type Owners = ReadonlyMap<TerritoryId, FactionId>;

/** The owners of a state read from the server, as pairs in map order. */
export const ownersOf = (pairs: readonly (readonly [number, number])[]): Owners => new Map(pairs);

/**
 * The owners after a record: every listed territory goes from the eliminated faction to the absorber. A listed territory
 * that the eliminated faction does not own, a territory listed twice, a territory the eliminated faction keeps, or an
 * absorber equal to the eliminated faction is a mismatch (the caller then reads the state from the server). The input is
 * never changed; the result keeps the order of the input.
 */
export function applyRecord(owners: Owners, record: RecordReply): Owners | 'mismatch' {
  if (record.absorber === record.eliminated) return 'mismatch';
  const next = new Map(owners);
  for (const territory of record.transferred) {
    if (next.get(territory) !== record.eliminated) return 'mismatch';
    next.set(territory, record.absorber);
  }
  for (const faction of next.values()) if (faction === record.eliminated) return 'mismatch';
  return next;
}

/** The factions that own at least one territory, in ascending order. */
export const livingOf = (owners: Owners): number[] => [...new Set(owners.values())].sort((a, b) => a - b);

/** The text hashed to check a state (the canonical form of the protocol). */
export const digestTextOf = (owners: Owners, round: number): string =>
  stateText({ mode: 'classic', round, owners: [...owners] as [number, number][] });

/** What the drawing of a step needs (005 FR-188): the two owner tables and the record's faction ids; no round, no seed. */
export function stepDataOf(earlier: Owners, later: Owners, record: RecordReply): StepData {
  return {
    earlier,
    later,
    eliminated: record.eliminated,
    absorber: record.absorber,
    transferred: [...record.transferred],
  };
}

/**
 * Whether the viewer may ask the server for round `round`: states 0..N, records 1..N (FR-254 client half). Every read
 * effect of the live model is built through this check.
 */
export function canRequest(applied: number, what: 'state' | 'record', round: number): boolean {
  return Number.isSafeInteger(round) && round <= applied && round >= (what === 'state' ? 0 : 1);
}
