// The ranking of the members of a Discord server (spec 025 FR-569 to FR-571). Pure. The order words of the command live in the strings
// module (PD4): the wire takes the enum, only the bot speaks Spanish.
import type { RankingOrder } from '@mbrg/protocol';
import { STRINGS } from './strings';

/** A ranking page holds 10 rows (NFR-125). */
export const RANKING_PAGE_SIZE = 10;

/** The order words, in the order the command offers them, each with the wire order it asks for. */
export const ORDER_WORDS: readonly (readonly [string, RankingOrder])[] = [
  [STRINGS.orderPoints, 'points'],
  [STRINGS.orderCorrect, 'correct'],
  [STRINGS.orderWins, 'wins'],
  [STRINGS.orderAccuracy, 'accuracy'],
];

/** The wire order of a word as typed (case and surrounding spaces ignored); no word means points, a word that is not an order none. */
export function orderOf(word: string | undefined): RankingOrder | undefined {
  if (word === undefined) return 'points';
  const typed = word.trim().toLowerCase();
  return ORDER_WORDS.find(([known]) => known === typed)?.[1];
}
