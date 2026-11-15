// The lobby decisions of a match (spec 011 FR-371, FR-372, FR-374, FR-375). Pure: instants and the reported time are parameters;
// nothing here reads a clock, a timer or a random source. Who may start (the host token) is decided by the shell.

import { errorReply } from '@mbrg/protocol';
import type { ErrorReply, MatchEvent } from '@mbrg/protocol';
import { anchorsFrom, effectiveInstant } from './time';
import type { CoreMatch } from './view';

/** The new view and the one event to store and publish with it, or a closed error with nothing to store. */
export type LobbyDecision =
  | { readonly ok: true; readonly view: CoreMatch; readonly events: readonly MatchEvent[] }
  | { readonly ok: false; readonly error: ErrorReply };

/** What a non-lobby stage answers: an expired lobby `match-expired`, any other stage (it has started) `match-started`. */
const refusal = (view: CoreMatch): LobbyDecision => ({ ok: false, error: errorReply(view.stage === 'expired' ? 'match-expired' : 'match-started') });

/** An accepted join: the view with the next sequence number, and that number for the `player-joined` event the shell builds. */
export type JoinDecision =
  | { readonly ok: true; readonly view: CoreMatch; readonly seq: number }
  | { readonly ok: false; readonly error: ErrorReply };

/**
 * A join (FR-377, FR-380): accepted in a lobby and in a running match (`phase-1`, `phase-2`, `locked`). The stage errors come
 * first (`match-finished`, `match-halted`, `match-expired`), then the cap: with `count` players and a cap of `max`, a join is
 * `match-full` from `count >= max`. The name rule is the shell's (it needs the stored names). Nothing is drawn or stored here.
 */
export function joinDecision(view: CoreMatch, count: number, max: number): JoinDecision {
  if (view.stage === 'finished') return { ok: false, error: errorReply('match-finished') };
  if (view.stage === 'halted') return { ok: false, error: errorReply('match-halted') };
  if (view.stage === 'expired') return { ok: false, error: errorReply('match-expired') };
  if (count >= max) return { ok: false, error: errorReply('match-full') };
  const seq = view.lastSeq + 1;
  return { ok: true, view: { ...view, lastSeq: seq }, seq };
}

/**
 * The start of a lobby: stage `phase-1` of round 1, `lastStepMs` and the clock anchored at the start instant (the effective
 * instant, never below the last step instant, FR-249), none for timing `manual` (the host then advances, FR-375). One
 * `schedule` event with the next sequence number carries the anchors and the reported time. A start at or after `expiresMs`
 * (the lobby expiry instant) is refused `match-expired`; the expiry itself is performed by its own decision.
 */
export function startDecision(view: CoreMatch, now: number, reportedTime: number, expiresMs: number = Infinity): LobbyDecision {
  if (view.stage !== 'lobby') return refusal(view);
  const instant = effectiveInstant(now, view.lastStepMs);
  // FR-372: at or after the expiry instant the lobby is expired by its own rule, whether or not the wake-up has run yet.
  if (instant >= expiresMs) return { ok: false, error: errorReply('match-expired') };
  const anchors = anchorsFrom(instant, view.timing);
  const seq = view.lastSeq + 1;
  const event: MatchEvent = {
    type: 'schedule',
    seq,
    stage: 'phase-1',
    ...(anchors === null ? {} : { schedule: { c1: anchors.c1, c2: anchors.c2, a: anchors.a } }),
    reportedTime,
  };
  return { ok: true, view: { ...view, stage: 'phase-1', lastStepMs: instant, anchors, lastSeq: seq }, events: [event] };
}

/**
 * The expiry of a lobby that was not started in time: stage `expired` and one `schedule` event of that stage, with no anchors.
 * The shell decides when (the setting) and passes the reported time; the rest of the view stays.
 */
export function expireDecision(view: CoreMatch, reportedTime: number): LobbyDecision {
  if (view.stage !== 'lobby') return refusal(view);
  const seq = view.lastSeq + 1;
  return { ok: true, view: { ...view, stage: 'expired', lastSeq: seq }, events: [{ type: 'schedule', seq, stage: 'expired', reportedTime }] };
}
