import { describe, expect, it } from 'vitest';
import { isValidColor, isValidName } from '../src/names';
import { astral, noncharacters } from './helpers/package-fixtures';
import { PRESENTATION_KIND_ORDER, ID_IMAGE_KIND_ORDER } from '../src/package-errors';

describe('FR-87 names', () => {
  it('FR-87 accepts ordinary names', () => {
    expect(isValidName('España')).toBe(true);
    expect(isValidName('Castilla  y León')).toBe(true);
    expect(isValidName('A')).toBe(true);
    expect(isValidName('Île-de-France')).toBe(true);
  });

  it('FR-87 accepts 80 astral code points (160 code units) and rejects 81', () => {
    expect(astral(80).length).toBe(160);
    expect(isValidName(astral(80))).toBe(true);
    expect(isValidName(astral(81))).toBe(false);
    expect(isValidName('a'.repeat(80))).toBe(true);
    expect(isValidName('a'.repeat(81))).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['leading space', ' España'],
    ['trailing newline', 'España\n'],
    ['trailing space', 'España '],
    ['leading tab', '\tEspaña'],
    ['leading no-break space', '\u00a0España'],
    ['trailing ideographic space', 'España\u3000'],
    ['decomposed (not NFC)', 'Espan\u0303a'],
    ['next line U+0085 mid', 'Es\u0085paña'],
    ['line separator U+2028 mid', 'Es\u2028paña'],
    ['paragraph separator U+2029 mid', 'Es\u2029paña'],
    ['zero-width joiner', 'Es\u200dpaña'],
    ['soft hyphen', 'Es\u00adpaña'],
    ['byte order mark', 'Es\ufeffpaña'],
    ['private use U+E000', 'Es\ue000paña'],
    ['NUL', 'Es\u0000paña'],
    ['DEL', 'Es\u007fpaña'],
    ['C1 control U+009F', 'Es\u009fpaña'],
    ['U+FDD0', 'Es\ufdd0paña'],
    ['U+FFFE', 'Es\ufffepaña'],
    ['U+FFFF', 'Es\uffffpaña'],
    ['U+10FFFF', 'Es\u{10ffff}paña'],
    ['lone high surrogate', 'Es\ud83dpaña'],
    ['lone low surrogate', 'Es\ude00paña'],
    ['high surrogate at the end', 'España\ud83d'],
    ['low then high surrogate', '\ude00\ud83d'],
    ['astral private use plane 15', 'a\u{f0000}'],
  ])('FR-87 rejects %s', (_label, text) => {
    expect(isValidName(text)).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['number', 5],
    ['boolean', true],
    ['list', ['a']],
    ['object', { name: 'a' }],
    ['String object', new String('España')],
    ['bigint', 1n],
  ])('FR-87 rejects the non-text value %s', (_label, value) => {
    expect(isValidName(value)).toBe(false);
  });

  it('FR-87 rejects every one of the 66 noncharacters and counts exactly 66', () => {
    const list = noncharacters();
    expect(list.length).toBe(66);
    expect(new Set(list).size).toBe(66);
    for (const c of list) {
      expect(isValidName(`a${String.fromCodePoint(c)}b`), c.toString(16)).toBe(false);
    }
  });

  it('FR-87 accepts a valid astral well-formed pair and code points next to noncharacters', () => {
    expect(isValidName('\u{1f600}')).toBe(true);
    expect(isValidName('\ufdcf\ufdf0')).toBe(true);
    expect(isValidName('\u{1fffd}')).toBe(true);
  });

  it('FR-87 does not reject an unassigned non-noncharacter', () => {
    // U+0378 is unassigned (Cn) in every Unicode version and is not a noncharacter.
    expect(/\p{Cn}/u.test('\u0378')).toBe(true);
    expect(isValidName('a\u0378b')).toBe(true);
  });

  it('FR-87 inner white space is allowed', () => {
    expect(isValidName('a b')).toBe(true);
    expect(isValidName('a\u00a0b')).toBe(true);
    expect(isValidName('a   b')).toBe(true);
  });

  it('FR-87 the runtime has Unicode 15.1 or later: U+2FFC is not Cn', () => {
    expect(/\p{Cn}/u.test('\u2ffc')).toBe(false);
  });

  it('FR-87 FR-104 a name is never changed by the check', () => {
    const name = 'Espan\u0303a ';
    const copy = String(name);
    expect(isValidName(name)).toBe(false);
    expect(name).toBe(copy);
  });
});

describe('FR-88 colors', () => {
  it('FR-88 accepts lowercase #rrggbb', () => {
    expect(isValidColor('#00ff7a')).toBe(true);
    expect(isValidColor('#000000')).toBe(true);
    expect(isValidColor('#ffffff')).toBe(true);
    expect(isValidColor('#0a9f3c')).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['uppercase', '#FFFFFF'],
    ['mixed case', '#00fF7a'],
    ['3 digits', '#fff'],
    ['name', 'red'],
    ['trailing space', '#00ff7a '],
    ['leading space', ' #00ff7a'],
    ['trailing newline', '#00ff7a\n'],
    ['8 digits', '#00ff7aff'],
    ['no hash', '00ff7a'],
    ['non-hex digit', '#00ff7g'],
    ['empty', ''],
    ['number', 0x00ff7a],
    ['list', ['#00ff7a']],
    ['object', {}],
  ])('FR-88 rejects %s', (_label, value) => {
    expect(isValidColor(value)).toBe(false);
  });
});

describe('FR-92 FR-110 kind order constants', () => {
  it('FR-92 PRESENTATION_KIND_ORDER equals the table literally', () => {
    expect(PRESENTATION_KIND_ORDER).toStrictEqual([
      'invalid-presentation',
      'invalid-presentation-list',
      'invalid-presentation-entry',
      'invalid-presentation-id',
      'duplicate-presentation-id',
      'invalid-name',
      'invalid-color',
      'presentation-unknown-field',
      'unknown-presentation-id',
      'missing-presentation',
      'duplicate-faction-name',
      'duplicate-color',
    ]);
  });

  it('FR-92 FR-110 ID_IMAGE_KIND_ORDER equals the table literally', () => {
    expect(ID_IMAGE_KIND_ORDER).toStrictEqual([
      'invalid-image',
      'unknown-pixel-id',
      'missing-territory-pixels',
      'missing-adjacency',
      'extra-adjacency',
    ]);
  });
});
