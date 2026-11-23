// Deterministic name abbreviation ladder (spec 032 FR-622, FR-626, NFR-150). Pure, ASCII-only.
// Order: full name -> prefix-with-dot forms -> plain uppercase acronym (no dots) only if still needed.

const CONNECTORS = new Set([
  'a',
  'al',
  'and',
  'da',
  'das',
  'de',
  'del',
  'des',
  'di',
  'do',
  'dos',
  'du',
  'e',
  'el',
  'en',
  'la',
  'las',
  'le',
  'les',
  'los',
  'of',
  'the',
  'van',
  'von',
  'y',
]);

const codePoints = (s: string): string[] => Array.from(s);

const prefixDot = (word: string, take: number): string | undefined => {
  const chars = codePoints(word);
  if (chars.length <= take + 1) return undefined;
  return `${chars.slice(0, take).join('')}.`;
};

const initialOf = (word: string): string => {
  const first = codePoints(word)[0] ?? '';
  return first.toUpperCase();
};

/**
 * Deterministic, deduplicated list of display forms for a label name, ordered from fullest to shortest.
 * Never returns a candidate longer than or equal in code-point length to the full name (except index 0).
 */
export function abbreviateName(raw: string): readonly string[] {
  const full = raw.trim();
  if (full.length === 0) return [];
  const fullLen = codePoints(full).length;
  const out: string[] = [full];
  const seen = new Set<string>([full]);

  const push = (candidate: string | undefined): void => {
    if (candidate === undefined) return;
    const trimmed = candidate.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) return;
    if (codePoints(trimmed).length >= fullLen) return;
    seen.add(trimmed);
    out.push(trimmed);
  };

  const words = full.split(/[\s-]+/).filter((w) => w.length > 0);
  if (words.length <= 1) {
    const w = words[0] ?? full;
    if (fullLen > 4) {
      if (fullLen >= 8) push(prefixDot(w, 5));
      push(prefixDot(w, 3));
    }
    return out;
  }

  const significant = words.filter((w) => !CONNECTORS.has(w.toLowerCase()));
  const active = significant.length >= 2 ? significant : words;
  const leading = active.slice(0, -1);
  const last = active[active.length - 1]!;
  const leadDots = leading.map((w) => `${initialOf(w)}.`).join(' ');

  // Step 1: dotted initials for leading words + full last word (e.g. "S. C. Tenerife", "L. Rioja").
  push(`${leadDots} ${last}`);

  // Step 2: dotted initials + prefix-with-dot of last word when shorter (e.g. "S. C. Ten.").
  const lastShort = prefixDot(last, 3);
  if (lastShort !== undefined) push(`${leadDots} ${lastShort}`);

  // Step 3: for single significant word with leading article (e.g. "La Rioja"), also prefix-dot of the significant word.
  if (significant.length === 1) {
    const main = significant[0]!;
    if (codePoints(main).length > 4) push(prefixDot(main, 3));
    return out;
  }

  // Step 4: plain uppercase acronym without dots as last resort (only for >= 2 significant words).
  if (significant.length >= 2) {
    const acronym = significant.map(initialOf).join('');
    if (codePoints(acronym).length >= 2) push(acronym);
  }

  return out;
}
