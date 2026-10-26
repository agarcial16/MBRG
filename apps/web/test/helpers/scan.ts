/**
 * Source scanner for the viewer (NFR-28 now; the NFR-25 purity scan of T5 reuses it).
 * Same technique as the 002 purity scan and the 003b builder scan: strip comments and strings so only
 * code is seen. Tests here have no Node types, so sources arrive through Vite `?raw` imports.
 */

const STRING_LITERAL = /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/;
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/.*$/;
// One pass: a string literal is matched before a comment can start inside it, so 'a//b' stays whole.
const TOKENS = new RegExp(`(${STRING_LITERAL.source})|${COMMENT.source}`, 'gm');

/** Removes real comments only; string literals are kept. */
export function stripComments(src: string): string {
  return src.replace(TOKENS, (_m, str: string | undefined) => str ?? '');
}

/** Removes comments and string literals, so the scan sees code only. */
export function codeOnly(src: string): string {
  return src.replace(TOKENS, (_m, str: string | undefined) => (str === undefined ? '' : '""'));
}

/** Property names whose assignment puts text in front of the user. */
const SINK_ASSIGNMENT = /\b(?:textContent|innerText|innerHTML|outerHTML|title|placeholder|ariaLabel|alt)\s*=(?![=>])([^;\n]*)/g;
const SINK_ATTRIBUTE = /\bsetAttribute\s*\(\s*(['"`])(?:aria-label|title|placeholder|alt)\1\s*,([^;\n]*)/g;
const SINK_CALL = /\b(?:alert|confirm|prompt|createTextNode|insertAdjacentText|insertAdjacentHTML|append|prepend)\s*\(([^;\n]*)/g;

/** True when a string literal (with quotes) holds visible text: a run of 2 or more letters outside `${}`. */
function literalHoldsText(literal: string): boolean {
  const inner = literal.slice(1, -1).replace(/\$\{[^}]*\}/g, '');
  return /\p{L}{2,}/u.test(inner);
}

/** Violations of the NFR-28 scan rule in one viewer source other than the strings module. */
export function languageViolations(src: string): string[] {
  const found: string[] = [];
  if (/[^\x00-\x7f]/.test(src)) found.push('non-ASCII character');
  const text = stripComments(src);
  const rhsList: string[] = [];
  for (const re of [SINK_ASSIGNMENT, SINK_CALL]) for (const m of text.matchAll(re)) rhsList.push(m[1]!);
  for (const m of text.matchAll(SINK_ATTRIBUTE)) rhsList.push(m[2]!);
  const literal = new RegExp(STRING_LITERAL.source, 'g');
  for (const rhs of rhsList) {
    for (const lit of rhs.matchAll(literal)) {
      if (literalHoldsText(lit[0])) found.push(`text literal in a DOM sink: ${lit[0]}`);
    }
  }
  return found;
}

/** Visible text left in an HTML page once tags, comments and attributes are removed (NFR-28). */
export function htmlText(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '').trim();
}

/** Attribute values of an HTML page that would show text to the user. */
export function htmlTextAttributes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/\b(?:title|alt|placeholder|aria-label)\s*=\s*(["'])(.*?)\1/g)) out.push(m[2]!);
  return out;
}
