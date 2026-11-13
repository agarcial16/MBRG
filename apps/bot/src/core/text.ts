// Candidate text matching (spec 012 FR-454). Pure: no locale, no clock, no chance.
import { DISCORD } from './limits';

export interface Named {
  readonly id: number;
  readonly name: string;
}

/** Lower case, accents removed, spaces collapsed: "  EspAna " and "espana" are the same text. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * The candidates whose name contains the typed text (case and accents ignored), prefix matches first, then the others, each
 * group in the order given; at most `max` (Discord shows 25). An empty text matches everything (the first `max`).
 */
export function matchCandidates(text: string, candidates: readonly Named[], max: number = DISCORD.optionsPerMenu): Named[] {
  const query = normalizeText(text);
  const prefix: Named[] = [];
  const inner: Named[] = [];
  for (const candidate of candidates) {
    const name = normalizeText(candidate.name);
    const at = name.indexOf(query);
    if (at === 0) prefix.push(candidate);
    else if (at > 0) inner.push(candidate);
  }
  return [...prefix, ...inner].slice(0, max);
}
