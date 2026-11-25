import type { RankingAsker, RankingOrder, RankingPage, RankingRow } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { EMBED_LIMITS, fitEmbed } from '../src/core/limits';
import type { EmbedSpec } from '../src/core/model';
import { RANKING_PAGE_SIZE, floorPercent, rankingEmbed, rankingEmpty, rankingPageCount, rankingUnavailable } from '../src/core/ranking';
import { STRINGS } from '../src/core/strings';
import { EPHEMERAL, embedPayload, messagePayload, replyPayload } from '../src/discord/translate';

// Spec 025 FR-569 (the text parts), FR-570, FR-571 (the unavailable part), NFR-125 (the embed part), NFR-126 (the bot's embed text): the ranking page as an
// embed with its plain-text twin. Pure: a page of the ranking comes in, the message comes out.

const row = (user: string, over: Partial<RankingRow> = {}): RankingRow => ({ playerId: `discord:${user}`, points: 120, correct: 15, scored: 20, played: 4, won: 2, rank: 1, ...over });
const page = (items: RankingRow[], over: Partial<RankingPage> = {}): RankingPage => ({ items, total: items.length, ...over });
const ctx = (over: Partial<{ page: number; previous: RankingRow }> = {}) => ({ page: 1, ...over });
const linesOf = (embed: EmbedSpec | undefined): string[] => (embed?.description ?? '').split('\n');
const embedOf = (p: RankingPage, order: RankingOrder = 'points', c = ctx()): EmbedSpec => {
  const message = rankingEmbed(p, order, c);
  expect(message.embed).toBeDefined();
  return message.embed!;
};

describe('FR-569 a row of the ranking', () => {
  it('FR-569 a row shows the rank, the mention and the statistics with the ordering statistic first, one fixed order for the others', () => {
    const r = row('111');
    const expected: Record<RankingOrder, string> = {
      points: '1. <@111> · 120 pts · aciertos 15/20 · victorias 2 · partidas 4 · precisión 75 %',
      correct: '1. <@111> · aciertos 15/20 · 120 pts · victorias 2 · partidas 4 · precisión 75 %',
      wins: '1. <@111> · victorias 2 · 120 pts · aciertos 15/20 · partidas 4 · precisión 75 %',
      accuracy: '1. <@111> · precisión 75 % · 120 pts · aciertos 15/20 · victorias 2 · partidas 4',
    };
    for (const order of Object.keys(expected) as RankingOrder[]) expect(linesOf(embedOf(page([r]), order)), order).toEqual([expected[order]]);
  });

  it('FR-569 rows keep the order the server sent and every rank as given (ties share it)', () => {
    const items = [row('111', { rank: 1 }), row('222', { rank: 2, points: 90 }), row('333', { rank: 2, points: 90 }), row('444', { rank: 4, points: 5 })];
    expect(linesOf(embedOf(page(items))).map((l) => l.slice(0, 11))).toEqual(['1. <@111> ·', '2. <@222> ·', '2. <@333> ·', '4. <@444> ·']);
  });

  it('FR-569 a member who is not on Discord shows the name the server stored, else "Jugador"', () => {
    const items = [row('111', { playerId: 'web:abc', name: 'Ana Web' }), row('222', { playerId: 'web:def' })];
    expect(linesOf(embedOf(page(items))).map((l) => l.split(' · ')[0])).toEqual(['1. Ana Web', '1. Jugador']);
  });

  it('FR-569 a row never shows the stored name of a Discord member: the mention always resolves', () => {
    const lines = linesOf(embedOf(page([row('111', { name: 'Nombre Guardado' })])));
    expect(lines[0]).toContain('<@111>');
    expect(lines.join('\n')).not.toContain('Nombre Guardado');
  });
});

describe('FR-569 precision, the whole percent rounded down', () => {
  it('FR-569 NFR-126 the percent is the floor of 100 x correct / scored: 199/200 is 99 %, never 100 %; 100 % only when every scored prediction was right', () => {
    expect(floorPercent(199, 200)).toBe(99);
    expect(floorPercent(200, 200)).toBe(100);
    expect(floorPercent(1, 3)).toBe(33);
    expect(floorPercent(2, 3)).toBe(66);
    expect(floorPercent(5, 10)).toBe(50);
    expect(floorPercent(10, 20)).toBe(50);
    expect(floorPercent(0, 7)).toBe(0);
    expect(floorPercent(1, 1)).toBe(100);
    expect(floorPercent(1, 1000)).toBe(0);
    expect(floorPercent(7, 1000)).toBe(0);
    expect(floorPercent(10, 1000)).toBe(1);
  });

  it('FR-569 NFR-126 the percent is exact for the largest whole numbers (no floating-point drift at the edge)', () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(floorPercent(max, max)).toBe(100);
    expect(floorPercent(max - 1, max)).toBe(99);
    expect(floorPercent(max / 2 - 0.5, max)).toBe(49);
    // 99 % of 9,007,199,254,740,900 is 8,917,127,262,193,491 exactly: one less is still 98 %, the exact value is 99 %.
    expect(floorPercent(8_917_127_262_193_491, 9_007_199_254_740_900)).toBe(99);
    expect(floorPercent(8_917_127_262_193_490, 9_007_199_254_740_900)).toBe(98);
  });

  it('FR-569 a player with no scored prediction shows no precision', () => {
    expect(floorPercent(0, 0)).toBeUndefined();
    const line = linesOf(embedOf(page([row('111', { points: 0, correct: 0, scored: 0, played: 0, won: 0 })])))[0];
    expect(line).toBe('1. <@111> · 0 pts · aciertos 0/0 · victorias 0 · partidas 0');
    expect(line).not.toContain('precisión');
    // In the accuracy order the ordering statistic is missing too: the others follow.
    expect(linesOf(embedOf(page([row('111', { points: 0, correct: 0, scored: 0, played: 0, won: 0 })]), 'accuracy'))[0]).toBe('1. <@111> · 0 pts · aciertos 0/0 · victorias 0 · partidas 0');
  });

  it('FR-569 a row shows the percent of its own statistics: 199/200 reads 99 %', () => {
    expect(linesOf(embedOf(page([row('111', { correct: 199, scored: 200, points: 500 })])))[0]).toBe('1. <@111> · 500 pts · aciertos 199/200 · victorias 2 · partidas 4 · precisión 99 %');
  });
});

describe('FR-566 FR-569 the accuracy order with players who have no rank', () => {
  const ranked = (n: number): RankingRow[] => Array.from({ length: n }, (_, i) => row(`${100 + i}`, { rank: i + 1, correct: 20 - i, scored: 20 }));
  const tail = (n: number, from = 200): RankingRow[] => Array.from({ length: n }, (_, i) => ({ playerId: `discord:${from + i}`, points: 120, correct: 3, scored: 4, played: 4, won: 2 }));

  it('FR-569 a row without a rank shows a dash in place of the rank, and only in the unranked tail', () => {
    const lines = linesOf(embedOf(page([...ranked(1), ...tail(1)], { total: 2 }), 'accuracy'));
    expect(lines.filter((l) => l.startsWith('1.'))).toHaveLength(1);
    expect(lines.find((l) => l.includes('<@200>'))?.startsWith('— <@200> · precisión 75 %')).toBe(true);
  });

  it('FR-569 the line "Menos de 10 predicciones: sin puesto en precisión" precedes the first unranked row, in the middle of a page', () => {
    const lines = linesOf(embedOf(page([...ranked(3), ...tail(2)], { total: 5 }), 'accuracy'));
    expect(lines).toHaveLength(6);
    expect(lines[3]).toBe('Menos de 10 predicciones: sin puesto en precisión');
    expect(lines[4]?.startsWith('— <@200>')).toBe(true);
    expect(lines.filter((l) => l.startsWith('Menos de'))).toHaveLength(1);
  });

  it('FR-569 when nobody is ranked the note opens page 1', () => {
    const lines = linesOf(embedOf(page(tail(2), { total: 2 }), 'accuracy'));
    expect(lines[0]).toBe('Menos de 10 predicciones: sin puesto en precisión');
    expect(lines).toHaveLength(3);
  });

  it('FR-569 the note is on the FIRST page where unranked rows appear: at the top of a page whose rows all are unranked after a ranked page, never again on the next', () => {
    const lastRanked = ranked(10)[9]!;
    // Page 2 starts with the unranked tail right after a ranked row: the note opens it.
    const second = linesOf(embedOf(page(tail(10), { total: 30 }), 'accuracy', ctx({ page: 2, previous: lastRanked })));
    expect(second[0]).toBe('Menos de 10 predicciones: sin puesto en precisión');
    expect(second).toHaveLength(11);
    // Page 3: the page before already held unranked rows, so no note.
    const third = linesOf(embedOf(page(tail(10, 300), { total: 30 }), 'accuracy', ctx({ page: 3, previous: tail(1)[0]! })));
    expect(third.some((l) => l.startsWith('Menos de'))).toBe(false);
    expect(third).toHaveLength(10);
    // A page of ranked rows only has none either.
    expect(linesOf(embedOf(page(ranked(10), { total: 30 }), 'accuracy')).some((l) => l.startsWith('Menos de'))).toBe(false);
  });

  it('FR-569 no other order has the note', () => {
    for (const order of ['points', 'correct', 'wins'] as const) {
      expect(linesOf(embedOf(page([...ranked(1)]), order)).some((l) => l.startsWith('Menos de')), order).toBe(false);
    }
  });
});

describe('FR-569 the asker line "Tu puesto"', () => {
  const field = (embed: EmbedSpec) => embed.fields.find((f) => f.name === 'Tu puesto');

  it('FR-569 the asker with a row gets one field: their rank and statistics, the ordering statistic first', () => {
    const asker: RankingAsker = { points: 80, correct: 9, scored: 12, played: 3, won: 1, rank: 7 };
    expect(field(embedOf(page([row('111')], { asker })))?.value).toBe('Puesto 7 · 80 pts · aciertos 9/12 · victorias 1 · partidas 3 · precisión 75 %');
    expect(field(embedOf(page([row('111')], { asker }), 'wins'))?.value).toBe('Puesto 7 · victorias 1 · 80 pts · aciertos 9/12 · partidas 3 · precisión 75 %');
    expect(field(embedOf(page([row('111')], { asker }), 'accuracy'))?.value).toBe('Puesto 7 · precisión 75 % · 80 pts · aciertos 9/12 · victorias 1 · partidas 3');
    expect(embedOf(page([row('111')], { asker })).fields).toHaveLength(1);
  });

  it('FR-569 an asker not qualified in the accuracy order has no line: their own row is in the unranked tail', () => {
    const asker: RankingAsker = { points: 9, correct: 3, scored: 4, played: 1, won: 0 };
    expect(embedOf(page([row('111')], { asker }), 'accuracy').fields).toEqual([]);
    // The same asker in the other orders has a rank and a line.
    expect(field(embedOf(page([row('111')], { asker: { ...asker, rank: 12 } }), 'points'))?.value).toBe('Puesto 12 · 9 pts · aciertos 3/4 · victorias 0 · partidas 1 · precisión 75 %');
  });

  it('FR-569 an asker with no row gets one sentence saying they have not played a finished match here', () => {
    const value = field(embedOf(page([row('111')], { asker: { played: false } })))?.value;
    expect(value).toBe('Todavía no has jugado ninguna partida terminada en este servidor.');
  });

  it('FR-569 a page of a request that did not name the asker has no line', () => {
    expect(embedOf(page([row('111')])).fields).toEqual([]);
  });

  it('FR-569 the plain-text twin carries the same line and the page indicator', () => {
    const message = rankingEmbed(page([row('111')], { asker: { points: 80, correct: 9, scored: 12, played: 3, won: 1, rank: 7 } }), 'points', ctx());
    expect(message.text.split('\n')).toEqual([
      'Ranking del servidor',
      '1. <@111> · 120 pts · aciertos 15/20 · victorias 2 · partidas 4 · precisión 75 %',
      'Página 1/1',
      'Tu puesto: Puesto 7 · 80 pts · aciertos 9/12 · victorias 1 · partidas 3 · precisión 75 %',
    ]);
  });
});

describe('FR-569 the page indicator and the title', () => {
  it('FR-569 "Página N/M" with M from the total of the snapshot, ten rows to a page', () => {
    expect(RANKING_PAGE_SIZE).toBe(10);
    const items = Array.from({ length: 10 }, (_, i) => row(`${i + 1}`, { rank: i + 1 }));
    expect(rankingEmbed(page(items, { total: 10 }), 'points', ctx()).embed?.footer).toBe('Página 1/1');
    expect(rankingEmbed(page(items, { total: 11 }), 'points', ctx()).embed?.footer).toBe('Página 1/2');
    expect(rankingEmbed(page(items, { total: 25 }), 'points', ctx({ page: 3 })).embed?.footer).toBe('Página 3/3');
    expect(rankingEmbed(page(items, { total: 25 }), 'points', ctx({ page: 9 })).embed?.footer).toBe('Página 3/3');
    expect([0, 1, 10, 11, 20, 21].map(rankingPageCount)).toEqual([1, 1, 1, 2, 2, 3]);
  });

  it('FR-569 the title names the ranking', () => {
    expect(embedOf(page([row('111')])).title).toBe('Ranking del servidor');
  });
});

describe('FR-570 FR-571 the empty and the unavailable replies', () => {
  it('FR-570 a server with no counted match gets one sentence: no embed, no buttons', () => {
    expect(rankingEmpty()).toEqual({ text: 'Este servidor todavía no tiene ranking.', buttons: [] });
    expect(rankingEmbed({ items: [], total: 0 }, 'points', ctx())).toEqual(rankingEmpty());
    expect(rankingEmbed({ items: [], total: 0, asker: { played: false } }, 'accuracy', ctx())).toEqual(rankingEmpty());
  });

  it('FR-570 the empty reply is public: no private mark and no components in the payload', () => {
    const payload = replyPayload({ type: 'channel', messages: [rankingEmpty()] }, false)[0];
    expect(payload).not.toHaveProperty('flags');
    expect(payload).not.toHaveProperty('components');
  });

  it('FR-571 the unavailable reply is one sentence that only the member sees', () => {
    expect(rankingUnavailable()).toEqual({ type: 'text', text: 'El ranking no está disponible ahora. Inténtalo más tarde.' });
    expect(replyPayload(rankingUnavailable(), true)[0]?.flags).toBe(EPHEMERAL);
  });
});

describe('NFR-125 the worst-case page stays within every embed limit', () => {
  const widest = Number.MAX_SAFE_INTEGER;
  const id20 = (n: number): string => String(10 ** 19 + n);
  const name24 = (n: number): string => `N${String(n).padStart(2, '0')}${'x'.repeat(24)}`.slice(0, 24);
  /** Ten rows: 20-digit Discord ids with 24-character names, every statistic at its widest, and (accuracy) a tail without ranks. */
  const worst = (order: RankingOrder): RankingPage => {
    const items: RankingRow[] = Array.from({ length: 10 }, (_, i) => {
      const base = { playerId: `discord:${id20(i)}`, name: name24(i), points: widest, correct: widest, scored: widest, played: widest, won: widest };
      return order === 'accuracy' && i >= 3 ? base : { ...base, rank: widest - i };
    });
    return { items, total: widest, asker: { points: widest, correct: widest, scored: widest, played: widest, won: widest, rank: widest }, next: 'c'.repeat(256) };
  };
  const sizeOf = (e: EmbedSpec): number => e.title.length + (e.description?.length ?? 0) + (e.footer?.length ?? 0) + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);

  for (const order of ['points', 'correct', 'wins', 'accuracy'] as const) {
    it(`NFR-125 ${order}: ten rows of 24-character names and 20-digit ids with every statistic at its widest, the note and the asker line, within 6,000 characters, 25 fields, 4,096 for the description and 1,024 for a field value; nothing is cut`, () => {
      const message = rankingEmbed(worst(order), order, ctx({ page: 7, previous: { playerId: 'discord:1', points: 1, correct: 1, scored: 1, played: 1, won: 1, rank: 1 } }));
      const embed = message.embed!;
      expect(linesOf(embed)).toHaveLength(order === 'accuracy' ? 11 : 10);
      expect(embed.fields).toHaveLength(1);
      expect(embed.fields[0]?.name).toBe('Tu puesto');
      expect(sizeOf(embed)).toBeLessThanOrEqual(EMBED_LIMITS.total);
      expect(embed.fields.length).toBeLessThanOrEqual(EMBED_LIMITS.fields);
      expect((embed.description ?? '').length).toBeLessThanOrEqual(EMBED_LIMITS.description);
      for (const f of embed.fields) {
        expect(f.name.length).toBeLessThanOrEqual(EMBED_LIMITS.fieldName);
        expect(f.value.length).toBeLessThanOrEqual(EMBED_LIMITS.fieldValue);
      }
      expect(embed.title.length).toBeLessThanOrEqual(EMBED_LIMITS.title);
      expect((embed.footer ?? '').length).toBeLessThanOrEqual(EMBED_LIMITS.footer);
      // The cut of the shell removes nothing, so every row reaches the member whole.
      expect(fitEmbed(embed)).toEqual(embed);
      expect(embedPayload(embed).description).toBe(embed.description);
      // The plain-text twin, if split, keeps every row (the shell sends it in parts of at most 2,000 characters).
      for (let i = 0; i < 10; i += 1) expect(message.text).toContain(`<@${id20(i)}>`);
    });
  }

  it('NFR-125 the worst-case rows of members who are not on Discord (a 24-character name each) fit as well', () => {
    const items: RankingRow[] = Array.from({ length: 10 }, (_, i) => ({ playerId: `web:${'k'.repeat(40)}${i}`, name: name24(i), points: widest, correct: widest, scored: widest, played: widest, won: widest, rank: widest - i }));
    const embed = rankingEmbed({ items, total: widest }, 'correct', ctx()).embed!;
    expect(sizeOf(embed)).toBeLessThanOrEqual(EMBED_LIMITS.total);
    expect(fitEmbed(embed)).toEqual(embed);
    expect(linesOf(embed)[0]).toContain(name24(0));
  });

  it('NFR-125 the page, the mentions and the cursor never ping anybody: the payload has no allowed mention and carries no cursor', () => {
    const message = rankingEmbed(worst('points'), 'points', ctx());
    const payload = messagePayload(message, { mode: 'embed' });
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(JSON.stringify(payload)).not.toContain('c'.repeat(256));
    expect(JSON.stringify(message)).not.toContain('c'.repeat(256));
  });
});
