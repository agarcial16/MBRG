// The embeds of the announcements (spec 017 FR-472, FR-473). Pure: each takes only the data of its own event, so no embed can carry a
// future round, a wrong guess or a guess count (NFR-92). Titles, field names and sentences come from the strings module (FR-484).
import type { EmbedSpec } from './model';
import type { Winners } from './results';
import { mentionOf } from './results';
import { STRINGS, fill } from './strings';

/** One color per message type: round opened, victim revealed, round applied, scored phase, match finished, match halted. */
export const EMBED_COLORS = Object.freeze({ opened: 0x3498db, victim: 0xe67e22, applied: 0xe74c3c, scored: 0x2ecc71, finished: 0xf1c40f, halted: 0x95a5a6 });

const bold = (name: string): string => `**${name}**`;

export const openedEmbed = (round: number): EmbedSpec => ({
  color: EMBED_COLORS.opened,
  title: fill(STRINGS.embedOpenedTitle, { round }),
  description: STRINGS.embedOpenedText,
  fields: [],
});

export const victimEmbed = (round: number, victim: string): EmbedSpec => ({
  color: EMBED_COLORS.victim,
  title: fill(STRINGS.embedVictimTitle, { round }),
  description: STRINGS.embedVictimText,
  fields: [{ name: STRINGS.fieldVictim, value: bold(victim) }],
});

export const forcedEmbed = (round: number, victim: string, absorber: string | undefined): EmbedSpec => ({
  color: EMBED_COLORS.victim,
  title: fill(STRINGS.embedForcedTitle, { round }),
  description: STRINGS.embedForcedText,
  fields: [{ name: STRINGS.fieldVictim, value: bold(victim) }, ...(absorber === undefined ? [] : [{ name: STRINGS.fieldAbsorber, value: bold(absorber) }])],
});

export const appliedEmbed = (round: number, victim: string, absorber: string, left: number | undefined): EmbedSpec => ({
  color: EMBED_COLORS.applied,
  title: fill(STRINGS.embedAppliedTitle, { round }),
  fields: [
    { name: STRINGS.fieldVictim, value: bold(victim) },
    { name: STRINGS.fieldAbsorber, value: bold(absorber) },
    ...(left === undefined ? [] : [{ name: STRINGS.fieldLeft, value: left === 1 ? STRINGS.leftOne : fill(STRINGS.leftMany, { n: left }) }]),
  ],
});

/** Who guessed right: the mentions (at most 10 then "y N mas" in the Spanish text, already cut by `summarizeWinners`), or that nobody did. */
export function scoredEmbed(round: number, phase: 1 | 2, winners: Winners): EmbedSpec {
  const list = winners.userIds.map(mentionOf).join(', ');
  const none = phase === 1 ? STRINGS.winnersNoneVictim : STRINGS.winnersNoneAbsorber;
  const value = winners.userIds.length === 0 ? none : winners.more > 0 ? fill(STRINGS.winnersMore, { list, n: winners.more }) : list;
  return {
    color: EMBED_COLORS.scored,
    title: fill(phase === 1 ? STRINGS.embedScoredVictimTitle : STRINGS.embedScoredAbsorberTitle, { round }),
    fields: [{ name: STRINGS.fieldRight, value }],
  };
}

export const finishedEmbed = (winner: string): EmbedSpec => ({ color: EMBED_COLORS.finished, title: STRINGS.embedFinishedTitle, fields: [{ name: STRINGS.fieldWinner, value: bold(winner) }] });

export const haltedEmbed = (round: number): EmbedSpec => ({ color: EMBED_COLORS.halted, title: STRINGS.embedHaltedTitle, description: fill(STRINGS.embedHaltedText, { round }), fields: [] });
