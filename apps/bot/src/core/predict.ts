// The prediction flow without Discord (spec 012 FR-454, FR-455, NFR-88): which phase is open and who the candidates are, what a
// member is offered, how typed text resolves, and the plain sentence of each refusal. Pure; the candidates come from the public
// data of the match only (the state at N, or the revealed victim's candidates).
import type { ErrorReply, PublicMatch } from '@mbrg/protocol';
import { findId, pickId } from './custom-ids';
import { DISCORD, clip } from './limits';
import type { PhaseKind, Reply } from './model';
import type { NameBook } from './names';
import { STRINGS, fill } from './strings';
import { matchCandidates } from './text';
import type { Named } from './text';

export type ClosedReason = 'not-started' | 'closed' | 'finished' | 'halted' | 'forced' | 'expired';

export type OpenPhase =
  | { readonly open: true; readonly kind: PhaseKind; readonly round: number; readonly candidates: readonly number[] }
  | { readonly open: false; readonly reason: ClosedReason };

/** The factions living now: those that own a territory in the public state, ascending. */
const livingOf = (match: PublicMatch): number[] => [...new Set(match.state.owners.map(([, faction]) => faction))].sort((a, b) => a - b);

/** The phase a member can predict in now, from the public data of the match (stage, state, revealed victim). */
export function openPhaseOf(match: PublicMatch): OpenPhase {
  const round = match.appliedRounds + 1;
  switch (match.stage) {
    case 'phase-1':
      return { open: true, kind: 'victim', round, candidates: livingOf(match) };
    case 'phase-2':
      if (match.victim === undefined) return { open: false, reason: 'closed' };
      return match.victim.forced === true || match.victim.candidates.length < 2
        ? { open: false, reason: 'forced' }
        : { open: true, kind: 'absorber', round, candidates: match.victim.candidates };
    case 'lobby':
      return { open: false, reason: 'not-started' };
    case 'finished':
      return { open: false, reason: 'finished' };
    case 'halted':
      return { open: false, reason: 'halted' };
    case 'expired':
      return { open: false, reason: 'expired' };
    default:
      return { open: false, reason: 'closed' };
  }
}

const REASONS: Readonly<Record<ClosedReason, string>> = {
  'not-started': STRINGS.notStarted,
  closed: STRINGS.phaseClosed,
  finished: STRINGS.errFinished,
  halted: STRINGS.errHalted,
  forced: STRINGS.errForced,
  expired: STRINGS.expired,
};

export const closedSentence = (reason: ClosedReason): string => REASONS[reason];

/** The sentence of a server refusal (FR-455): the closed phase gets the server's reason, the others a plain sentence. */
export function errorSentence(error: ErrorReply): string {
  switch (error.kind) {
    case 'prediction-closed':
      return STRINGS.errClosed;
    case 'forced-absorber':
      return STRINGS.errForced;
    case 'rate-limited':
      return fill(STRINGS.errRate, { n: error.retryAfter ?? 1 });
    case 'match-finished':
      return STRINGS.errFinished;
    case 'match-halted':
      return STRINGS.errHalted;
    case 'invalid-choice':
      return STRINGS.errChoice;
    case 'unknown-match':
      return STRINGS.errUnknownMatch;
    case 'unavailable':
      return STRINGS.serverDown;
    default:
      return STRINGS.errOther;
  }
}

const phaseSentence = (kind: PhaseKind): string => (kind === 'victim' ? STRINGS.pickVictim : STRINGS.pickAbsorber);

const optionsOf = (candidates: readonly Named[]) => candidates.map((c) => ({ label: clip(c.name, DISCORD.labelChars), value: String(c.id) }));

/** What a member is offered: a select menu for 25 candidates or fewer, otherwise the text window (FR-454). */
export function offerFor(open: Extract<OpenPhase, { open: true }>, names: NameBook): Reply {
  if (open.candidates.length <= DISCORD.optionsPerMenu) {
    return { type: 'select', text: phaseSentence(open.kind), customId: pickId(open.kind, open.round), placeholder: STRINGS.pickPlaceholder, options: optionsOf(names.named(open.candidates)) };
  }
  return { type: 'modal', customId: findId(open.kind, open.round), title: STRINGS.findTitle, label: STRINGS.findLabel };
}

export type Resolution =
  | { readonly type: 'none'; readonly reply: Reply }
  | { readonly type: 'one'; readonly faction: number }
  | { readonly type: 'many'; readonly reply: Reply };

/**
 * Typed text against the candidates: none matching says so, a single match is chosen at once, several are offered as a select
 * menu of at most 25 (FR-454). An exact number naming a candidate is that candidate (the autocomplete value).
 */
export function resolveText(open: Extract<OpenPhase, { open: true }>, names: NameBook, text: string): Resolution {
  const trimmed = text.trim();
  if (/^[0-9]{1,16}$/.test(trimmed) && open.candidates.includes(Number(trimmed))) return { type: 'one', faction: Number(trimmed) };
  const found = matchCandidates(text, names.named(open.candidates));
  const only = found[0];
  if (only !== undefined && found.length === 1) return { type: 'one', faction: only.id };
  if (only === undefined) return { type: 'none', reply: { type: 'text', text: fill(STRINGS.findNone, { text: clip(text, 40) }) } };
  return {
    type: 'many',
    reply: { type: 'select', text: fill(STRINGS.findPick, { text: clip(text, 40) }), customId: pickId(open.kind, open.round), placeholder: STRINGS.pickPlaceholder, options: optionsOf(found) },
  };
}

/** The autocomplete suggestions: up to 25 candidates filtered by the typed text, the value being the faction number. */
export function suggestionsFor(candidates: readonly number[], names: NameBook, text: string): Reply {
  const found = matchCandidates(text, names.named(candidates));
  return { type: 'suggest', choices: found.map((c) => ({ name: clip(c.name, DISCORD.labelChars), value: String(c.id) })) };
}

/** The "Chosen: X" answer, only to the member. */
export const chosenText = (names: NameBook, faction: number): string => fill(STRINGS.chosen, { name: names.nameOf(faction) });
