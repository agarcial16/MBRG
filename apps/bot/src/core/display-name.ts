// The display name of a member for the server (spec 022 FR-537, NFR-116). Pure: text in, text out.
//
// The server keeps one name rule (letters and digits of any script, space, `_`, `.`, `-`, 1 to 24 code points, no two spaces in a
// row, NFC); the bot cleans what Discord shows so that the rule always accepts it, instead of asking the server to widen it.

/** The longest name, in code points (the server's limit). */
const MAX_CODE_POINTS = 24;
const OUTSIDE = /[^\p{L}\p{N} _.-]/gu;
const SPACES = / {2,}/g;

/**
 * The name to send, or `undefined` when nothing valid remains (the server then shows the id, as before). NFC; every character
 * outside the rule becomes a space; runs of spaces collapse to one; the ends are trimmed; the result is cut to 24 code points
 * and trimmed again, since a cut can end on a space.
 */
export function cleanDisplayName(text: string | undefined): string | undefined {
  if (typeof text !== 'string') return undefined;
  const spaced = text.normalize('NFC').replace(OUTSIDE, ' ').replace(SPACES, ' ').trim();
  const cut = [...spaced].slice(0, MAX_CODE_POINTS).join('').trim();
  return cut === '' ? undefined : cut;
}
