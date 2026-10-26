import { describe, expect, it } from 'vitest';
import { STRINGS } from '../src/core/strings';
import { formatAddress, parseAddress } from '../src/core/address';
import indexHtml from '../index.html?raw';
import { codeOnly, htmlText, htmlTextAttributes, languageViolations, stripComments } from './helpers/scan';

// NFR-28 (language). Literal lists copied from the plan (section 10), not imported from src.
/** English identifiers shown inside Spanish messages as data (as in 001-003b). */
const INTERNAL_KINDS = ['palette-exhausted', 'no-webgl2', 'texture-too-small', 'invalid-png', 'invalid-json', 'read-failed'];
/** Live viewer scene kinds and error kinds (spec 008 M5, D30): English identifiers, never shown as such outside a Spanish template. */
const LIVE_KINDS = ['debug', 'live', 'message', 'unknown-match', 'digest-mismatch', 'insecure-origin', 'both', 'need-match', 'bad-match', 'failure'];
const ADDRESS_REASONS = ['invalid', 'out-of-range', 'repeated'];
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const all = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;
const STRINGS_PATH = '../src/core/strings.ts';
const others = Object.entries(all).filter(([path]) => path !== STRINGS_PATH);

describe('NFR-28 UI strings module', () => {
  it('NFR-28 the scan sees the viewer sources (not vacuous)', () => {
    expect(Object.keys(all)).toContain(STRINGS_PATH);
    expect(Object.keys(all)).toContain('../src/core/address.ts');
    expect(others.length).toBeGreaterThanOrEqual(4);
  });

  it('NFR-28 every UI string is a non-empty text and its placeholders are known', () => {
    const entries = Object.entries(STRINGS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, text] of entries) {
      expect(typeof text, key).toBe('string');
      expect(text.trim().length, key).toBeGreaterThan(0);
      for (const m of text.matchAll(/\{(\w+)\}/g)) {
        expect(['param', 'text', 'total', 'count', 'kind', 'size', 'required', 'faction', 'seed', 'round', 'living', 'id', 'name', 'state', 'eliminated', 'absorber', 'x', 'y', 'value', 'fill', 'owner', 'ms', 'median', 'p95', 'time'], `${key} placeholder ${m[1]}`).toContain(m[1]);
      }
    }
  });

  it('NFR-28 every UI string key is used by a viewer source outside the strings module', () => {
    const code = others.map(([, src]) => codeOnly(stripComments(src))).join('\n');
    for (const key of Object.keys(STRINGS)) {
      expect(new RegExp(`\\bSTRINGS\\s*\\.\\s*${key}\\b`).test(code), `STRINGS.${key} is unused`).toBe(true);
    }
  });

  it('NFR-28 the UI strings are the only viewer module whose texts are Spanish', () => {
    for (const [path, src] of others) {
      expect(languageViolations(src), path).toStrictEqual([]);
    }
  });
});

describe('NFR-28 source scan', () => {
  it('NFR-28 every viewer source except the strings module is ASCII-only, and so is index.html', () => {
    for (const [path, src] of others) expect(/[^\x00-\x7f]/.test(src), path).toBe(false);
    expect(/[^\x00-\x7f]/.test(indexHtml)).toBe(false);
  });

  it('NFR-28 index.html has no text nodes and no text attributes', () => {
    expect(htmlText(indexHtml)).toBe('');
    expect(htmlTextAttributes(indexHtml)).toStrictEqual([]);
  });

  it('NFR-28 the scan flags a planted Spanish text literal in each kind of DOM text sink', () => {
    const planted = [
      "el.textContent = 'Ronda actual';",
      'el.innerText = "Fin del juego";',
      "el.innerHTML = '<b>Ronda</b> actual';",
      'el.title = `Reiniciar vista`;',
      "document.title = 'Mapa de depuracion';",
      "input.placeholder = 'Escribe una ronda';",
      "button.setAttribute('aria-label', 'Siguiente ronda');",
      "alert('Hola mundo');",
      "confirm('Seguro');",
      "el.append('Texto visible');",
      "el.textContent = 'a' + 'Ronda';",
      "el.textContent = `Ronda ${n}`;",
      "const t = document.createTextNode('Ronda');",
    ];
    for (const src of planted) expect(languageViolations(src), src).not.toStrictEqual([]);
  });

  it('NFR-28 the scan flags a planted non-ASCII letter, even inside a comment', () => {
    expect(languageViolations("// Año\nconst x = 1;")).toStrictEqual(['non-ASCII character']);
    expect(languageViolations("const x = 'Ronda á';")).toContain('non-ASCII character');
  });

  it('NFR-28 the scan lets code, ids and strings from the UI module through', () => {
    const fine = [
      'el.textContent = STRINGS.debugTitle;',
      'el.textContent = fillTemplate(STRINGS.paramInvalid, { param: p });',
      'el.textContent = `${STRINGS.round} ${n}`;',
      "el.textContent = '';",
      "el.textContent = '7';",
      "el.title = STRINGS.reset; // 'Reiniciar vista' only in a comment",
      "const a = canvas.getContext('webgl2');",
      "el.setAttribute('data-x', 'ronda');",
      "console.log('Ronda');",
      "if (t.title === 'ab') {}",
    ];
    for (const src of fine) expect(languageViolations(src), src).toStrictEqual([]);
  });

  it('NFR-28 viewer-internal error kinds and address reasons are English identifiers, listed here', () => {
    for (const kind of [...INTERNAL_KINDS, ...LIVE_KINDS, ...ADDRESS_REASONS]) expect(kind).toMatch(KEBAB);
    // Every kind written in the sources is in the list (non-vacuous once later tasks add kinds).
    for (const [path, src] of others) {
      for (const m of stripComments(src).matchAll(/\bkind\s*:\s*(['"`])([^'"`]+)\1/g)) {
        expect([...INTERNAL_KINDS, ...LIVE_KINDS], `${path}: ${m[2]}`).toContain(m[2]);
      }
    }
    // Address reasons produced by the parser are exactly from the listed set.
    const reasons = new Set<string>();
    const search = ['?seed=x', '?seed=4294967296', '?seed=1&seed=2', '?round=9', '?x=a&y=1&zoom=2'];
    for (const s of search) for (const p of parseAddress(s, 4, { w: 2048, h: 2048 }, { width: 1920, height: 1080 }).problems) reasons.add(p.reason);
    expect([...reasons].sort()).toStrictEqual([...ADDRESS_REASONS].sort());
    expect(formatAddress(1, 0, { x: 1, y: 1, scale: 1 })).toMatch(/^\?seed=/);
  });
});
