import { describe, expect, it } from 'vitest';
import { backoffMs } from '../src/core/backoff';
import { DISCORD, clip, rowsOf, splitMessage } from '../src/core/limits';
import { createSseParser } from '../src/core/sse-parser';
import { matchCandidates, normalizeText } from '../src/core/text';

const named = (names: readonly string[]) => names.map((name, i) => ({ id: i + 1, name }));

describe('FR-454 candidate text matching', () => {
  it('FR-454 ignores case and accents', () => {
    expect(normalizeText('  EspAÑa  Ünida ')).toBe('espana unida');
    const found = matchCandidates('ESPAN', named(['Alemania', 'España', 'Francia']));
    expect(found.map((c) => c.name)).toEqual(['España']);
    expect(matchCandidates('aleman', named(['Alemania'])).length).toBe(1);
    expect(matchCandidates('ÁLEMAN', named(['alemania'])).length).toBe(1);
  });

  it('FR-454 puts prefix matches before inner matches and keeps the original order otherwise', () => {
    const found = matchCandidates('ar', named(['Bulgaria', 'Argentina', 'Armenia', 'Paraguay']));
    expect(found.map((c) => c.name)).toEqual(['Argentina', 'Armenia', 'Bulgaria', 'Paraguay']);
  });

  it('FR-454 returns at most 25 matches, also for 100+ candidates', () => {
    const many = named(Array.from({ length: 130 }, (_, i) => `Faccion ${i}`));
    expect(matchCandidates('faccion', many).length).toBe(25);
    expect(matchCandidates('', many).length).toBe(25);
    expect(matchCandidates('faccion 12', many).map((c) => c.name)).toEqual(['Faccion 12', 'Faccion 120', 'Faccion 121', 'Faccion 122', 'Faccion 123', 'Faccion 124', 'Faccion 125', 'Faccion 126', 'Faccion 127', 'Faccion 128', 'Faccion 129']);
  });

  it('FR-454 returns nothing when nothing matches', () => {
    expect(matchCandidates('zzz', named(['Alemania']))).toEqual([]);
  });
});

describe('NFR-91 Discord limits', () => {
  it('NFR-91 splits a long text into messages of at most 2,000 characters without losing a word', () => {
    const line = 'x'.repeat(90);
    const text = Array.from({ length: 80 }, (_, i) => `${i} ${line}`).join('\n');
    const parts = splitMessage(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(DISCORD.messageChars);
    expect(parts.join('\n').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
  });

  it('NFR-91 hard-cuts one line longer than the limit and keeps a short text whole', () => {
    const long = 'y'.repeat(4500);
    const parts = splitMessage(long);
    expect(parts.map((p) => p.length)).toEqual([2000, 2000, 500]);
    expect(splitMessage('hola')).toEqual(['hola']);
    expect(splitMessage('')).toEqual(['']);
  });

  it('NFR-91 groups buttons five to a row and clips long labels', () => {
    const rows = rowsOf(Array.from({ length: 7 }, (_, i) => i));
    expect(rows.map((r) => r.length)).toEqual([5, 2]);
    expect(rowsOf([])).toEqual([]);
    expect(clip('abcdef', 4)).toBe('abc.');
    expect(clip('abc', 4)).toBe('abc');
  });
});

describe('FR-460 stream helpers', () => {
  it('FR-460 backoff doubles from one second up to a cap and never uses chance', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(backoffMs(0)).toBe(1000);
  });

  it('FR-460 the frame parser reads id and data across chunk borders and ignores heartbeats', () => {
    const parser = createSseParser();
    expect(parser.push(': hb\n\nid: 4\nda')).toEqual([]);
    expect(parser.push('ta: {"a":1}\r\n\r\nid: 5\ndata: x\ndata: y\n\n')).toEqual([
      { id: '4', data: '{"a":1}' },
      { id: '5', data: 'x\ny' },
    ]);
    expect(parser.push('event: other\n\n')).toEqual([]);
  });
});
