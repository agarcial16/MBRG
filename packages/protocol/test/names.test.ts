import { describe, expect, it } from 'vitest';
import { NAME_MAX, nameKey, readName } from '../src/index';

// Player names (FR-384, plan P11): untrusted text, trimmed, NFC-normalised and bounded by code points; the key compares them
// ignoring case and accents. Every failure is the same reply, so a client learns nothing about which rule it broke.

const invalid = { ok: false, error: { kind: 'invalid-request', items: ['name'] } } as const;
const accepted = (name: string) => ({ ok: true, name });
/** Text from code points given in hexadecimal (the source holds no invisible character). */
const u = (...hex: string[]): string => String.fromCodePoint(...hex.map((h) => parseInt(h, 16)));
// Astral-plane letters (Deseret, category Lu): one code point, two UTF-16 units.
const astral = u('10400');
const ACUTE = u('301');
const E_ACUTE = u('E9');
const ZWSP = u('200B');

describe('FR-384 the name rule', () => {
  it('FR-384 the limit is 24', () => {
    expect(NAME_MAX).toBe(24);
  });

  it('FR-384 a name is trimmed and returned as given otherwise (case kept for display)', () => {
    expect(readName('Ana')).toStrictEqual(accepted('Ana'));
    expect(readName('  Ana  ')).toStrictEqual(accepted('Ana'));
    expect(readName(`Jos${E_ACUTE} Ruiz`)).toStrictEqual(accepted(`Jos${E_ACUTE} Ruiz`));
    expect(readName(' a ')).toStrictEqual(accepted('a'));
  });

  it('FR-384 the length is 1 to 24 code points: 24 passes, 25 fails, empty and blank fail', () => {
    expect(readName('x'.repeat(24))).toStrictEqual(accepted('x'.repeat(24)));
    expect(readName('x'.repeat(25))).toStrictEqual(invalid);
    expect(readName('')).toStrictEqual(invalid);
    expect(readName(' ')).toStrictEqual(invalid);
    expect(readName('     ')).toStrictEqual(invalid);
  });

  it('FR-384 the length counts code points, not UTF-16 units', () => {
    expect(astral.length).toBe(2);
    expect(readName(astral.repeat(24))).toStrictEqual(accepted(astral.repeat(24)));
    expect(readName(astral.repeat(25))).toStrictEqual(invalid);
  });

  it('FR-384 the length is measured after trimming', () => {
    expect(readName(`  ${'x'.repeat(24)}  `)).toStrictEqual(accepted('x'.repeat(24)));
  });

  it('FR-384 letters of any script, digits, space, underscore, hyphen and dot pass', () => {
    const ok = ['Ana', `${u('C1', 'C9', 'CD', 'D3', 'DA')} ${u('F1')} ${u('FC')}`, u('41F', '440', '438', '432', '435', '442'), u('3053', '3093', '306B', '3061', '306F'), u('674E', '5C0F', '9F8D'), u('645', '631', '62D', '628', '627'), u('3B5', '3BB', '3BB', '3B7', '3BD', '3B9', '3BA', '3AC'), u('663', '664'), 'Player 1', 'a_b', 'a-b', 'a.b', '_', '-', '.', '1', astral];
    for (const name of ok) expect(readName(name), name).toStrictEqual(accepted(name));
  });

  it('FR-384 control characters, zero-width characters, markup, quotes, emoji, colon and slash fail', () => {
    const bad = [
      u('61', '0', '62'), u('61', '9', '62'), u('61', 'A', '62'), u('61', 'D', '62'), u('9', '41', '6E', '61'), u('41', '6E', '61', 'A'), u('61', '7F', '62'), u('61', '85', '62'),
      u('61', '200B', '62'), u('61', '200C', '62'), u('61', '200D', '62'), u('61', 'FEFF', '62'), u('FEFF', '41', '6E', '61'), u('61', '2060', '62'), u('61', '202E', '62'),
      u('61', 'A0', '62'), u('A0', '41', '6E', '61'), u('61', '3000', '62'),
      '<b>', 'a<b', 'a>b', 'a&b', "a'b", 'a"b', 'a`b', 'a' + u('5C') + 'b', 'a/b', 'a:b', 'web:Ana',
      'a' + u('1F600'), u('1F600'), 'a' + u('2764') + 'b', 'a,b', 'a;b', 'a!b', 'a@b', 'a#b', 'a$b', 'a%b', 'a(b)',
      'a' + String.fromCharCode(0xd800) + 'b', String.fromCharCode(0xdc00),
    ];
    expect(bad.length).toBeGreaterThan(35);
    for (const name of bad) expect(readName(name), JSON.stringify(name)).toStrictEqual(invalid);
  });

  it('FR-384 no two spaces in a row, but the edges are trimmed first', () => {
    expect(readName('Ana  Ruiz')).toStrictEqual(invalid);
    expect(readName('Ana   Ruiz')).toStrictEqual(invalid);
    expect(readName('Ana Ruiz')).toStrictEqual(accepted('Ana Ruiz'));
    expect(readName('  Ana  ')).toStrictEqual(accepted('Ana'));
    expect(readName('a  ')).toStrictEqual(accepted('a'));
  });

  it('FR-384 the input is NFC-normalised before the check', () => {
    const decomposed = 'e' + ACUTE;
    expect(decomposed.length).toBe(2);
    expect(readName(decomposed)).toStrictEqual(accepted(E_ACUTE));
    expect(readName(`Jos${decomposed}`)).toStrictEqual(accepted(`Jos${E_ACUTE}`));
    // The length is counted after normalisation: 24 decomposed letters are 24 code points once composed.
    expect(readName(decomposed.repeat(24))).toStrictEqual(accepted(E_ACUTE.repeat(24)));
    expect(readName(decomposed.repeat(25))).toStrictEqual(invalid);
    // A mark that composes into nothing stays a mark and is refused.
    expect(readName(ACUTE)).toStrictEqual(invalid);
    expect(readName('x' + ACUTE + ACUTE)).toStrictEqual(invalid);
  });

  it('FR-384 a value that is not text fails the same way', () => {
    for (const v of [undefined, null, 1, true, {}, [], ['Ana'], { toString: () => 'Ana' }]) expect(readName(v), String(v)).toStrictEqual(invalid);
  });

  it('FR-384 a huge text is refused without being normalised', () => {
    expect(readName('x'.repeat(100_000))).toStrictEqual(invalid);
    expect(readName(`${' '.repeat(100_000)}x`)).toStrictEqual(invalid);
  });

  it('FR-384 every failure is the same reply: invalid-request naming name, with no detail of the rule', () => {
    const failures = [readName(''), readName('x'.repeat(25)), readName('a<b'), readName('a  b'), readName(7), readName('a' + ZWSP + 'b')];
    for (const f of failures) expect(f).toStrictEqual(invalid);
    expect(JSON.stringify(failures[2])).not.toMatch(/length|space|charac|rule/i);
  });

  it('FR-384 the accepted name is a fixed point: reading it again changes nothing', () => {
    for (const raw of [`  Jos${E_ACUTE}  `, 'e' + ACUTE, 'Ana Ruiz', astral]) {
      const first = readName(raw);
      expect(first.ok).toBe(true);
      if (first.ok) expect(readName(first.name)).toStrictEqual(first);
    }
  });

  it('FR-384 an accepted name goes through JSON as a string and comes back equal (never a quote or a backslash)', () => {
    for (const raw of ['a_b-c.d', 'Ana Ruiz', `${u('F1')}and${u('FA')}`, u('674E', '5C0F', '9F8D'), astral, '-', '.', '_']) {
      const r = readName(raw);
      if (!r.ok) throw new Error(raw);
      expect(JSON.parse(JSON.stringify(r.name))).toBe(r.name);
      expect(JSON.stringify(r.name)).not.toContain(u('5C'));
    }
  });
});

describe('FR-384 the name key', () => {
  it('FR-384 case and accents do not matter', () => {
    const keys = [`Jos${E_ACUTE}`, 'JOSE', 'jose', 'Jose', `JOS${u('C9')}`, 'Jose' + ACUTE, `jOs${u('C9')}`].map(nameKey);
    expect(new Set(keys).size).toBe(1);
    expect(nameKey('Ana')).toBe('ana');
    expect(nameKey(`${u('D1')}AND${u('DA')}`)).toBe('nandu');
  });

  it('FR-384 different names have different keys (spaces, punctuation and digits count)', () => {
    const keys = ['Ana', 'Ana 2', 'Ana2', 'Ana_2', 'Ana-2', 'Ana.2', 'Anna', 'an a'].map(nameKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('FR-384 sharp s and ss stay apart (documented: no full case folding)', () => {
    expect(nameKey(u('DF'))).not.toBe(nameKey('ss'));
    expect(nameKey('STRASSE')).not.toBe(nameKey(`Stra${u('DF')}e`));
  });

  it('FR-384 the key does not depend on the locale: dotted capital I folds to i', () => {
    expect(nameKey(u('130'))).toBe('i');
    expect(nameKey('I')).toBe('i');
    expect(nameKey(u('130') + 'stanbul')).toBe(nameKey('istanbul'));
  });

  it('FR-384 compatibility forms fold to the plain letters', () => {
    expect(nameKey(u('FF21') + 'na')).toBe('ana');
    expect(nameKey(u('2460'))).toBe('1');
  });

  it('FR-384 the key is stable, pure and never throws, whatever the text', () => {
    for (const text of ['', ' ', 'Ana', astral, String.fromCharCode(0xd800), String.fromCharCode(0xdc00) + 'x', 'a' + u('0') + 'b', u('1F600'), 'x'.repeat(10_000), 'e' + ACUTE + ACUTE + ACUTE]) {
      expect(() => nameKey(text), JSON.stringify(text.slice(0, 8))).not.toThrow();
      expect(nameKey(text)).toBe(nameKey(text));
    }
  });

  it('FR-384 the key of an accepted name has no mark and no capital', () => {
    for (const raw of [`Jos${E_ACUTE}`, `${u('C5')}NGSTR${u('D6')}M`, `Zo${u('EB')}`, u('1C5')]) {
      const key = nameKey(raw);
      expect(key).not.toMatch(/\p{M}/u);
      expect(key).toBe(key.toLowerCase());
    }
  });
});
