// Creation check of a match (spec 008 FR-237): a map that validates and has at least 2 factions gives the round-0 view.
// Pure: the map and the SHA-256 function are parameters; ids, secrets and instants are decided by the caller.

import { stateText } from '@mbrg/protocol';
import type { MatchEvent, Timing } from '@mbrg/protocol';
import { validateMap } from '@mbrg/shared';
import type { ValidationError } from '@mbrg/shared';
import { getState, livingFactions } from '@mbrg/sim';
import { anchorsFrom, wholeMs } from './time';
import type { CoreMatch } from './view';

export interface CreateInput {
  readonly matchId: string;
  readonly mapId: string;
  /** The map digest computed by the caller from the stored files. */
  readonly mapDigest: string;
  readonly timing: Timing;
  /** The commitment computed by the caller from the secret (the secret never enters the core). */
  readonly commitment: string;
  /** The creation instant: the clock reading, in ms. */
  readonly now: number;
}

export interface CreateDeps {
  /** The map as read from the store (unknown: it is validated here). */
  readonly map: unknown;
  /** SHA-256 of an ASCII text, as 64 lowercase hexadecimal characters. */
  readonly sha256: (text: string) => string;
}

export type CreateError = ValidationError | { readonly kind: 'too-few-factions' };
export type CreateResult = { readonly ok: true; readonly view: CoreMatch } | { readonly ok: false; readonly errors: readonly CreateError[] };

/** FR-237: map errors are reported as they are (a one-faction map is `too-few-factions`); T = factions - 1 >= 1. */
export function createMatch(input: CreateInput, deps: CreateDeps): CreateResult {
  const valid = validateMap(deps.map);
  if (!valid.ok) return { ok: false, errors: valid.errors };
  const start = getState(valid.value, 0, 0);
  if (!start.ok) return { ok: false, errors: start.errors as CreateError[] };
  const living = livingFactions(valid.value, start.value);
  if (!living.ok) return { ok: false, errors: living.errors as CreateError[] };
  const totalRounds = living.value.length - 1;
  if (totalRounds < 1) return { ok: false, errors: [{ kind: 'too-few-factions' }] };
  const at = wholeMs(input.now);
  const state = { mode: 'classic' as const, round: 0, owners: start.value.owners.map(([t, f]) => [t, f] as const) };
  return {
    ok: true,
    view: {
      matchId: input.matchId,
      mapId: input.mapId,
      mapDigest: input.mapDigest,
      totalRounds,
      timing: input.timing,
      commitment: input.commitment,
      stage: 'phase-1',
      appliedRounds: 0,
      state,
      stateDigest: deps.sha256(stateText(state)),
      lastSeq: 0,
      createdAt: at,
      lastStepMs: at,
      anchors: anchorsFrom(at, input.timing),
    },
  };
}

/**
 * FR-289 (c): the first event of a match is a `schedule` event, sequence number 1, stage `phase-1`, with the anchors
 * when the clock runs (none with timing `manual`). The view returned has `lastSeq` 1, as the public data requires in
 * every stage (FR-289 (b)). The shell stores the event with the creation, before replying (FR-231).
 */
export function creationEvents(view: CoreMatch, reportedTime: number): { readonly view: CoreMatch; readonly events: readonly MatchEvent[] } {
  if (view.lastSeq !== 0) throw new RangeError('the creation event is the first event of a match');
  const event: MatchEvent = {
    type: 'schedule',
    seq: 1,
    stage: 'phase-1',
    ...(view.anchors === null ? {} : { schedule: { c1: view.anchors.c1, c2: view.anchors.c2, a: view.anchors.a } }),
    reportedTime,
  };
  return { view: { ...view, lastSeq: 1 }, events: [event] };
}
