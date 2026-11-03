// What the player may predict now (spec 013 FR-401 to FR-405). Pure: the live model, the player and the tour state in; the offer, the
// choices in order, the sent book, the body of a submission and the sentence of a refusal out. No DOM, no network, no token here:
// the body names the LOCAL player id (the server builds the namespaced one from the credential).
import type { OwnPrediction, PredictionReply, SubmissionBody } from '@mbrg/protocol';
import type { LiveModel } from './live-model';
import type { Owners } from './live-rounds';
import { STRINGS, fillTemplate } from './strings';

/** Why nothing can be chosen now. */
export type NoOffer = 'not-joined' | 'loading' | 'behind' | 'closed' | 'revealing';

/** What the player may choose: the victim among the living, the absorber among the candidates, nothing, or a forced absorber. */
export type Offer =
  | { readonly type: 'none'; readonly reason: NoOffer }
  | { readonly type: 'victim'; readonly round: number; readonly choices: readonly number[] }
  | { readonly type: 'absorber'; readonly round: number; readonly choices: readonly number[] }
  | { readonly type: 'forced'; readonly round: number; readonly faction: number };

/** The territories each faction holds in `owners`. */
export function territoryCounts(owners: Owners | undefined): Map<number, number> {
  const counts = new Map<number, number>();
  for (const faction of owners?.values() ?? []) counts.set(faction, (counts.get(faction) ?? 0) + 1);
  return counts;
}

/** FR-402: the largest first, ties by faction id. */
export function orderByTerritories(factions: readonly number[], counts: ReadonlyMap<number, number>): number[] {
  return [...factions].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a - b);
}

/**
 * FR-401 to FR-403, FR-405: the offer of the screen. Phase 1 offers the factions living at N (round N + 1); phase 2 offers the
 * candidates of the revealed victim, or a forced absorber; a replay, any other stage, a viewer who did not join and the moments
 * before the victim is revealed offer nothing. The victim stays hidden while its reveal tour runs (`revealing`, FR-409).
 */
export function offerOf(model: LiveModel, input: { readonly joined: boolean; readonly revealing: boolean }): Offer {
  if (!input.joined) return { type: 'none', reason: 'not-joined' };
  if (model.displayed === undefined) return { type: 'none', reason: 'loading' };
  if (model.displayed < model.applied) return { type: 'none', reason: 'behind' };
  const held = model.held.get(model.applied);
  if (held === undefined) return { type: 'none', reason: 'loading' };
  const counts = territoryCounts(held);
  const round = model.applied + 1;
  if (model.stage === 'phase-1') {
    const living = [...counts.entries()].filter(([, n]) => n > 0).map(([id]) => id);
    return { type: 'victim', round, choices: orderByTerritories(living, counts) };
  }
  if (model.stage === 'phase-2') {
    const victim = model.victim;
    if (victim === undefined || victim.round !== round) return { type: 'none', reason: 'closed' };
    if (input.revealing) return { type: 'none', reason: 'revealing' };
    if (victim.forced === true && victim.candidates.length === 1) return { type: 'forced', round, faction: victim.candidates[0] as number };
    return { type: 'absorber', round, choices: orderByTerritories(victim.candidates, counts) };
  }
  return { type: 'none', reason: 'closed' };
}

/** A choice the server stored and the version it answered with. */
export interface Sent {
  readonly choice: number;
  readonly version: number;
}

/** The player's stored choices by kind and round. */
export type Book = ReadonlyMap<string, Sent>;
export const emptyBook: Book = new Map();

export const bookKey = (what: 'victim' | 'absorber', round: number): string => `${what}:${round}`;

function bookWith(book: Book, key: string, sent: Sent): Book {
  const old = book.get(key);
  return old !== undefined && old.version >= sent.version ? book : new Map(book).set(key, sent);
}

/** The own predictions read: the victim and absorber ones; the highest version of a key wins. */
export function bookFromOwn(items: readonly OwnPrediction[]): Book {
  let book: Book = emptyBook;
  for (const item of items) {
    if ((item.kind === 'victim' || item.kind === 'absorber') && item.round !== undefined) book = bookWith(book, bookKey(item.kind, item.round), { choice: item.choice, version: item.version });
  }
  return book;
}

/** The book after the server accepted a submission; a reply older than the stored version changes nothing. */
export function bookAfterReply(book: Book, reply: PredictionReply): Book {
  if ((reply.kind !== 'victim' && reply.kind !== 'absorber') || reply.round === undefined) return book;
  return bookWith(book, bookKey(reply.kind, reply.round), { choice: reply.choice, version: reply.version });
}

/** The choice already sent for what the offer asks, or undefined. */
export function sentFor(book: Book, offer: Offer): number | undefined {
  if (offer.type === 'victim' || offer.type === 'absorber') return book.get(bookKey(offer.type, offer.round))?.choice;
  return undefined;
}

/** A submission on its way to the server. */
export interface InFlight {
  readonly type: 'victim' | 'absorber';
  readonly round: number;
  readonly faction: number;
}

/** True when a tap only repeats a submission already in flight or already confirmed for this phase (a different choice is never a repeat). */
export function repeatsPick(offer: Offer, faction: number | undefined, book: Book, inFlight: InFlight | undefined): boolean {
  if (faction === undefined || (offer.type !== 'victim' && offer.type !== 'absorber')) return false;
  if (inFlight !== undefined && inFlight.type === offer.type && inFlight.round === offer.round && inFlight.faction === faction) return true;
  return sentFor(book, offer) === faction;
}

/** The local part of a namespaced player id (`player:<local>`); the server derives the namespaced id from the credential. */
export const localIdOf = (playerId: string): string => playerId.slice(playerId.indexOf(':') + 1);

export type Pick = { readonly ok: true; readonly body: SubmissionBody } | { readonly ok: false; readonly sentence: string };

/** FR-401, FR-402, FR-404: the submission for a chosen faction, or the sentence saying why it cannot be sent. */
export function pickFor(offer: Offer, faction: number | undefined, playerId: string, requestId: string): Pick {
  if (offer.type === 'none') return { ok: false, sentence: noOfferText(offer.reason) };
  if (offer.type === 'forced') return { ok: false, sentence: STRINGS.predictForcedNote };
  if (faction === undefined || !offer.choices.includes(faction)) return { ok: false, sentence: STRINGS.predictNotChoosable };
  return { ok: true, body: { kind: offer.type, round: offer.round, faction, playerId: localIdOf(playerId), requestId } };
}

/** FR-404: the reason a tap or a click does nothing. */
export function noOfferText(reason: NoOffer): string {
  switch (reason) {
    case 'not-joined':
      return STRINGS.predictNoneNotJoined;
    case 'loading':
      return STRINGS.predictNoneLoading;
    case 'behind':
      return STRINGS.predictNoneBehind;
    case 'revealing':
      return STRINGS.predictNoneRevealing;
    case 'closed':
      return STRINGS.predictNoneClosed;
  }
}

/** The title and the prompt of an offer, or the sentence that explains why there is none. */
export function offerText(offer: Offer, nameOf: (faction: number) => string): { readonly title: string; readonly line: string } {
  switch (offer.type) {
    case 'none':
      return { title: STRINGS.predictTitle, line: noOfferText(offer.reason) };
    case 'victim':
      return { title: STRINGS.predictTitle, line: fillTemplate(STRINGS.predictVictimPrompt, { round: offer.round }) };
    case 'absorber':
      return { title: STRINGS.predictTitle, line: fillTemplate(STRINGS.predictAbsorberPrompt, { round: offer.round }) };
    case 'forced':
      return { title: STRINGS.predictTitle, line: fillTemplate(STRINGS.predictForced, { name: nameOf(offer.faction) }) };
  }
}

/** FR-404: the sentence for a refused or failed submission (the previous choice stays). */
export function submitFailure(outcome: string, retryAfter?: number): string {
  switch (outcome) {
    case 'prediction-closed':
      return STRINGS.predictClosed;
    case 'forced-absorber':
      return STRINGS.predictForcedNote;
    case 'invalid-choice':
      return STRINGS.predictNotChoosable;
    case 'forbidden':
    case 'unknown-match':
    case 'invalid-player-id':
      return STRINGS.predictForbidden;
    case 'match-finished':
    case 'match-halted':
      return STRINGS.joinFinished;
    case 'rate-limited':
      return retryAfter === undefined ? STRINGS.createRateLimited : fillTemplate(STRINGS.createRateLimitedWait, { value: retryAfter });
    case 'network':
      return STRINGS.createNetwork;
    default:
      return STRINGS.predictFailed;
  }
}

/** The text of a sent choice: "Enviada: name". */
export const sentText = (name: string): string => fillTemplate(STRINGS.predictSent, { name });

/** FR-401: which faction a tap at a map point names: the owner of the territory under it, or undefined (outside, sea, unowned). */
export function factionAt(
  point: { readonly x: number; readonly y: number },
  grid: { readonly width: number; readonly height: number; readonly cells: ArrayLike<number>; readonly ids: readonly number[] },
  owners: Owners | undefined,
): number | undefined {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (owners === undefined || x < 0 || y < 0 || x >= grid.width || y >= grid.height) return undefined;
  const entry = grid.cells[y * grid.width + x];
  if (entry === undefined || entry === 0) return undefined;
  const territory = grid.ids[entry];
  return territory === undefined ? undefined : owners.get(territory);
}

/** A press and release that is a tap (not a drag): it moved at most `slop` pixels and lasted at most `maxMs`. */
export function isTap(
  down: { readonly sx: number; readonly sy: number; readonly at: number },
  up: { readonly sx: number; readonly sy: number; readonly at: number },
  slop = 6,
  maxMs = 600,
): boolean {
  return Math.hypot(up.sx - down.sx, up.sy - down.sy) <= slop && up.at - down.at <= maxMs;
}
