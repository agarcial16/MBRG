/**
 * NFR-14 source scanner for the builder core (same technique as the 002 purity scan: strip comments
 * and strings so only code is seen, but read import specifiers before strings are stripped).
 * The only runtime built-in the core may use is node:zlib, and only the two functions below.
 */

/** The documented exemption of NFR-14: exactly these two node:zlib functions. */
export const ZLIB_EXEMPT: readonly string[] = ['deflateSync', 'inflateSync'];

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

/** APIs the pure core must never touch: clock, randomness, files, network, environment, locale. */
export const FORBIDDEN_APIS: [string, RegExp][] = [
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['Date', /\bDate\b/],
  ['performance', /\bperformance\b/],
  ['crypto', /\bcrypto\b/],
  ['fetch', /\bfetch\b/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['process', /\bprocess\b/],
  ['require(', /\brequire\s*\(/],
  ['node: specifier', /\bnode:/],
  ['setTimeout', /\bsetTimeout\b/],
  ['setInterval', /\bsetInterval\b/],
  ['setImmediate', /\bsetImmediate\b/],
  ['globalThis', /\bglobalThis\b/],
  ['Intl', /\bIntl\b/],
  ['locale function', /\b(?:localeCompare|toLocale\w*)\b/],
];

const STATIC_IMPORT = /\b(?:import|export)\b([^;'"`()]*?)\bfrom\s*(['"`])([^'"`]*)\2/g;
const SIDE_EFFECT_IMPORT = /\bimport\s*(['"`])([^'"`]*)\1/g;
const DYNAMIC_IMPORT = /\bimport\s*\(/g;

/** True when `clause` is a braces-only import list naming nothing but the exempt functions. */
function zlibClauseAllowed(clause: string): boolean {
  const m = /^\s*(?:type\s+)?\{([^}]*)\}\s*$/.exec(clause);
  if (m === null) return false; // default or namespace import
  const names = m[1]!
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n !== '');
  return names.every((n) => ZLIB_EXEMPT.includes(n.replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim()));
}

/**
 * Violations found in one source: imports of anything but relative files, `@mbrg/shared` and the
 * exempt node:zlib functions; dynamic imports; `require`; forbidden APIs in code.
 */
export function scanSource(src: string): string[] {
  const found: string[] = [];
  const text = stripComments(src);
  for (const m of text.matchAll(STATIC_IMPORT)) {
    const spec = m[3]!;
    if (spec === 'node:zlib') {
      if (!zlibClauseAllowed(m[1]!)) found.push(`zlib import outside the exemption: ${m[0].trim()}`);
    } else if (!spec.startsWith('./') && !spec.startsWith('../') && spec !== '@mbrg/shared') {
      found.push(`import of ${spec}`);
    }
  }
  for (const m of text.matchAll(SIDE_EFFECT_IMPORT)) {
    if (!m[2]!.startsWith('./') && !m[2]!.startsWith('../')) found.push(`side-effect import of ${m[2]}`);
  }
  const code = codeOnly(src);
  for (const m of code.matchAll(DYNAMIC_IMPORT)) found.push(`dynamic import: ${m[0]}`);
  for (const [name, re] of FORBIDDEN_APIS) if (re.test(code)) found.push(`forbidden API ${name}`);
  return found;
}
