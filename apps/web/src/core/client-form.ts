// The web test client form (FR-310, development only): what a submission holds, which factions the form offers, the paths with
// the namespaced player id written as is, and the Spanish lines of the replies. Pure: the model, the ids and the replies come in
// as parameters. The form offers only what the live model holds (rounds up to N and the FR-288 fields while revealed), so it
// can never offer the absorber of a round that has not been applied.
import { isLocalId, playerIdOf } from '@mbrg/protocol';
import type { LeaderboardRow, OwnPrediction, PlayerResult, PredictionKind, PredictionReply, SubmissionBody } from '@mbrg/protocol';
import type { LiveModel } from './live-model';
import { fillTemplate, STRINGS } from './strings';

/** The namespace of the development credential (`MBRG_CLIENTS` lists a client with this namespace). */
export const CLIENT_NAMESPACE = 'web';

export const KINDS: readonly PredictionKind[] = ['victim', 'absorber', 'winner'];

/** The round a prediction of `kind` names: the round being played, N + 1; none for the winner. */
export const roundOf = (model: Pick<LiveModel, 'applied'>, kind: PredictionKind): number | undefined => (kind === 'winner' ? undefined : model.applied + 1);

/** The factions living at N, in id order. */
export function livingAt(model: Pick<LiveModel, 'applied' | 'held'>): number[] {
  const owners = model.held.get(model.applied);
  return [...new Set(owners === undefined ? [] : owners.values())].sort((a, b) => a - b);
}

/**
 * The factions the form offers: `victim` the living ones at N; `absorber` the revealed victim's candidates (none before the
 * reveal); `winner` the living ones without the revealed victim.
 */
export function factionChoices(model: Pick<LiveModel, 'applied' | 'held' | 'victim'>, kind: PredictionKind): number[] {
  if (kind === 'absorber') return [...(model.victim?.candidates ?? [])];
  const living = livingAt(model);
  if (kind === 'winner') return living.filter((faction) => faction !== model.victim?.victim);
  return living;
}

/** The body of a submission: `round` is present exactly for `victim` and `absorber`. */
export function submissionBody(input: {
  kind: PredictionKind;
  round: number | undefined;
  faction: number;
  playerId: string;
  requestId: string;
}): SubmissionBody {
  const { kind, faction, playerId, requestId } = input;
  return kind === 'winner' || input.round === undefined ? { kind, faction, playerId, requestId } : { kind, round: input.round, faction, playerId, requestId };
}

/** What identifies one submission: a retry of it reuses its request id (FR-282). */
export interface Draft {
  readonly key: string;
  readonly requestId: string;
}

export const draftKey = (b: Pick<SubmissionBody, 'kind' | 'round' | 'faction' | 'playerId'>): string => `${b.kind}|${b.round ?? ''}|${b.faction}|${b.playerId}`;

/** The request id of a submission: the previous draft's when the submission is the same one, a new one otherwise. */
export function draftFor(previous: Draft | undefined, key: string, make: () => string): Draft {
  return previous !== undefined && previous.key === key ? previous : { key, requestId: make() };
}

/** The own-predictions read (credentialed); none for a local id outside FR-297: nothing is sent. */
export const ownPredictionsPath = (matchId: string, local: string): string | undefined =>
  isLocalId(local) ? `/matches/${matchId}/predictions?playerId=${local}` : undefined;

/** The player-results path: the namespaced id with its `:` written as is, never percent-encoded (the server does not decode). */
export const playerResultsPath = (matchId: string, local: string): string | undefined =>
  isLocalId(local) ? `/matches/${matchId}/players/${playerIdOf(CLIENT_NAMESPACE, local)}/results` : undefined;

type NameOf = (faction: number) => string;

export function submittedLine(reply: PredictionReply, nameOf: NameOf): string {
  const values = { kind: reply.kind, round: reply.round ?? '', faction: nameOf(reply.choice), value: reply.version };
  return fillTemplate(reply.round === undefined ? STRINGS.clientSubmittedWinner : STRINGS.clientSubmitted, values);
}

export const refusedLine = (outcome: string): string => fillTemplate(STRINGS.clientRefused, { kind: outcome });

export const readFailedLine = (outcome: string): string => fillTemplate(STRINGS.clientReadFailed, { kind: outcome });

export function ownLine(p: OwnPrediction, nameOf: NameOf): string {
  const values = { kind: p.kind, round: p.round ?? '', faction: nameOf(p.choice), value: p.version };
  return fillTemplate(p.round === undefined ? STRINGS.clientOwnLineWinner : STRINGS.clientOwnLine, values);
}

export function resultLine(r: PlayerResult, nameOf: NameOf): string {
  const values = { kind: r.kind, round: r.round ?? '', faction: nameOf(r.choice), state: r.correct ? STRINGS.clientCorrect : STRINGS.clientWrong, value: r.points };
  return fillTemplate(r.round === undefined ? STRINGS.clientResultLineWinner : STRINGS.clientResultLine, values);
}

export const totalLine = (total: number): string => fillTemplate(STRINGS.clientResultsTotal, { total });

export const leaderboardLine = (row: LeaderboardRow): string => fillTemplate(STRINGS.clientLeaderboardRow, { value: row.rank, name: row.playerId, total: row.total });
