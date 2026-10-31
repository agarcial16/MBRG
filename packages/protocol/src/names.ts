import { errorReply, type ErrorReply } from './errors';

/**
 * Player names (FR-384, plan P11). A name is untrusted text: it is read once here (trimmed, NFC-normalised, bounded) and
 * is afterwards only ever written as a JSON string. Pure: no locale call, so the same text gives the same result anywhere.
 */

/** The longest name, in code points. */
export const NAME_MAX = 24;

/** More UTF-16 units than this cannot be a name once trimmed (24 astral code points are 48 units): refused before any work. */
const INPUT_MAX = 256;

/** Letters of any script, digits, space, `_`, `-` and `.`; marks, control, format and symbol characters are not allowed. */
const ALLOWED = /^[\p{L}\p{N} _.-]+$/u;
const MARKS = /\p{M}/gu;

export type NameResult = { readonly ok: true; readonly name: string } | { readonly ok: false; readonly error: ErrorReply };

const refused: NameResult = { ok: false, error: errorReply('invalid-request', ['name']) };

/** Removes the spaces (U+0020 only) at both ends; any other white space stays and fails the character rule. */
function trimSpaces(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === ' ') start++;
  while (end > start && text[end - 1] === ' ') end--;
  return text.slice(start, end);
}

/**
 * Reads a name: trimmed, NFC, 1 to 24 code points of letters, digits, space, `_`, `-`, `.`, with no two spaces in a row.
 * Every failure is the same `invalid-request` naming `name`, with no hint of the rule that failed.
 */
export function readName(input: unknown): NameResult {
  if (typeof input !== 'string' || input.length > INPUT_MAX) return refused;
  const name = trimSpaces(input.normalize('NFC'));
  let count = 0;
  for (const _ of name) {
    count++;
    if (count > NAME_MAX) return refused;
  }
  if (count === 0 || !ALLOWED.test(name) || name.includes('  ')) return refused;
  return { ok: true, name };
}

/**
 * The comparison key of a name: NFC, then NFKD with the combining marks removed, then `toLowerCase()` (no locale). Case and
 * accents do not matter (`José`, `JOSE` and `jose` give one key); `ß` and `ss` stay different (no full case folding).
 * Total: it never throws, whatever the text.
 */
export function nameKey(name: string): string {
  return name.normalize('NFC').normalize('NFKD').replace(MARKS, '').toLowerCase();
}
