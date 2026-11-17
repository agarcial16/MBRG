import { readName } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { cleanDisplayName } from '../src/core/display-name';

// The display name of a member as the server's name rule takes it (spec 022 FR-537, NFR-116): pure, tested without Discord or HTTP.

describe('FR-537 NFR-116 cleaning a Discord display name', () => {
  it('keeps a plain name and applies NFC', () => {
    expect(cleanDisplayName('Ana Lopez')).toBe('Ana Lopez');
    expect(cleanDisplayName('José Luis')).toBe('José Luis');
    expect(cleanDisplayName('a_b.c-d 9')).toBe('a_b.c-d 9');
    expect(cleanDisplayName('山田 Дима')).toBe('山田 Дима');
  });

  it('replaces characters outside the rule with a space, collapses spaces and trims', () => {
    expect(cleanDisplayName('  Ana   Lopez  ')).toBe('Ana Lopez');
    expect(cleanDisplayName('Ana\u{1F600}Lopez')).toBe('Ana Lopez');
    expect(cleanDisplayName('\u{1F525}Ana\u{1F525}')).toBe('Ana');
    expect(cleanDisplayName('Ana!!! (the best)')).toBe('Ana the best');
    expect(cleanDisplayName('a\tb\nc')).toBe('a b c');
    expect(cleanDisplayName('Ana​Lopez')).toBe('Ana Lopez');
  });

  it('cuts at 24 code points, counting an astral letter as one, and trims again', () => {
    expect(cleanDisplayName('x'.repeat(30))).toBe('x'.repeat(24));
    expect(cleanDisplayName('\u{1D4D0}'.repeat(30))).toBe('\u{1D4D0}'.repeat(24));
    expect(cleanDisplayName(`${'a'.repeat(23)} bbbb`)).toBe('a'.repeat(23));
    expect(cleanDisplayName(`${'a'.repeat(22)}  bbbb`)).toBe(`${'a'.repeat(22)} b`);
  });

  it('gives nothing when nothing valid remains', () => {
    for (const text of ['', '   ', '\u{1F600}', '\u{1F600}\u{1F525}\u{1F4A5}', '!!!', '​', '́']) expect(cleanDisplayName(text), JSON.stringify(text)).toBeUndefined();
    expect(cleanDisplayName(undefined)).toBeUndefined();
  });

  it('is idempotent and always accepted by the server name rule', () => {
    const corpus = ['Ana', 'José', 'Zalgò́̂̃', '‮RTL', 'a'.repeat(300), 'x \u{1F600} y \u{1F600} z', 'ßéè', '\ud83d', '\ud83dAna', 'Ana\u0000', '   　 ', 'Á́'];
    let seed = 12345;
    const next = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed);
    const pool = ['a', 'B', '7', ' ', '_', '.', '-', '!', 'é', 'é', '\u{1F600}', '中', '\t', '​', '́', '\ud83d', '\u{1D4D0}'];
    for (let i = 0; i < 2000; i++) corpus.push(Array.from({ length: next() % 40 }, () => pool[next() % pool.length]).join(''));
    for (const text of corpus) {
      const cleaned = cleanDisplayName(text);
      if (cleaned === undefined) continue;
      const accepted = readName(cleaned);
      expect(accepted.ok, JSON.stringify(text)).toBe(true);
      if (accepted.ok) expect(accepted.name).toBe(cleaned);
      expect(cleanDisplayName(cleaned)).toBe(cleaned);
    }
  });
});
