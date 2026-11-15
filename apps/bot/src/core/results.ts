// Who guessed right (spec 012 FR-456; the leaderboard is in board.ts, spec 017). Pure. Only the right guesses of a scored phase come in: a
// wrong guess, a choice or a count of guesses has no field here, so no message can carry one (008 P12).
import { STRINGS, fill } from './strings';

export const MAX_MENTIONS = 10;
const DISCORD_PLAYER = /^discord:([0-9]{1,25})$/;

/** The Discord user id of a player id of the `discord` namespace; undefined for any other player. */
export function userIdOf(playerId: string): string | undefined {
  const found = DISCORD_PLAYER.exec(playerId);
  return found === null ? undefined : (found[1] as string);
}

export const mentionOf = (userId: string): string => `<@${userId}>`;

/** The members who guessed right: at most ten ids, then how many more there were. */
export interface Winners {
  readonly userIds: readonly string[];
  readonly more: number;
}

/** From the ids of the players who guessed right (any order given is kept): the first ten and the rest as a count. */
export function summarizeWinners(correctPlayerIds: readonly string[]): Winners {
  const ids = correctPlayerIds.map(userIdOf).filter((id): id is string => id !== undefined);
  return { userIds: ids.slice(0, MAX_MENTIONS), more: Math.max(0, ids.length - MAX_MENTIONS) };
}

/** The line of a scored phase: the mentions and "and N more", or that nobody guessed. */
export function winnersText(phase: 1 | 2, winners: Winners): string {
  if (winners.userIds.length === 0) return phase === 1 ? STRINGS.winnersNoneVictim : STRINGS.winnersNoneAbsorber;
  const list = winners.userIds.map(mentionOf).join(', ');
  const mentions = winners.more > 0 ? fill(STRINGS.winnersMore, { list, n: winners.more }) : list;
  return fill(phase === 1 ? STRINGS.winnersVictim : STRINGS.winnersAbsorber, { mentions });
}
