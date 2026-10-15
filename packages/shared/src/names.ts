/** Maximum name length in code points (FR-87 rule 2). */
const MAX_NAME_CODE_POINTS = 80;

/** FR-87 rule 1: no unpaired surrogate code unit (own scan; isWellFormed is ES2024). */
function isWellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) return false;
      i++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** FR-87 rule 7: U+FDD0..U+FDEF and the last two code points of every plane. */
function isNoncharacter(code: number): boolean {
  return (code >= 0xfdd0 && code <= 0xfdef) || (code & 0xfffe) === 0xfffe;
}

// Rules 4 to 6. The two separators are written as escapes: sources stay ASCII.
const EDGE_WHITE_SPACE = /^\p{White_Space}|\p{White_Space}$/u;
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\u2028\u2029]/u;

/** FR-87: valid name. Never normalizes, trims or changes the value (FR-104). */
export function isValidName(x: unknown): x is string {
  if (typeof x !== 'string') return false;
  if (!isWellFormed(x)) return false;
  let count = 0;
  for (const ch of x) {
    count++;
    if (isNoncharacter(ch.codePointAt(0) as number)) return false;
  }
  if (count < 1 || count > MAX_NAME_CODE_POINTS) return false;
  if (x.normalize('NFC') !== x) return false;
  if (EDGE_WHITE_SPACE.test(x)) return false;
  if (FORBIDDEN.test(x)) return false;
  return true;
}

/** FR-88: valid colour, `#` plus 6 lowercase hexadecimal digits. */
export function isValidColor(x: unknown): x is string {
  return typeof x === 'string' && /^#[0-9a-f]{6}$/.test(x);
}
