import type { RankingAsker, RankingOrder, RankingPage, RankingRow } from '@mbrg/protocol';
import { describe, expect, it } from 'vitest';
import { EMBED_LIMITS, fitEmbed } from '../src/core/limits';
import type { EmbedSpec, TimePeriod } from '../src/core/model';
import { rankingEmbed, rankingEmpty, rankingMessage } from '../src/core/ranking';
import { STRINGS } from '../src/core/strings';
import { embedPayload, messagePayload, replyPayload } from '../src/discord/translate';

// Spec 027 NFR-130 (the embed worst case), and the titles and sentences of the windowed ranking (parts of FR-580, FR-581, FR-582): pure, a page of the
// ranking comes in with its period, the embed, its plain-text twin and the sentences come out.

const row = (user: string, over: Partial<RankingRow> = {}): RankingRow => ({ playerId: `discord:${user}`, points: 120, correct: 15, scored: 20, played: 4, won: 2, rank: 1, ...over });
const page = (items: RankingRow[], over: Partial<RankingPage> = {}): RankingPage => ({ items, total: items.length, ...over });
const ctx = (period?: TimePeriod, over: Partial<{ page: number; previous: RankingRow }> = {}) => ({ page: 1, ...(period === undefined ? {} : { period }), ...over });
const linesOf = (embed: EmbedSpec | undefined): string[] => (embed?.description ?? '').split('\n');
const PERIODS: readonly (readonly [TimePeriod, number])[] = [['last-7-days', 7], ['last-30-days', 30]];
const asker = (over: Partial<RankingAsker> = {}): RankingAsker => ({ points: 33, correct: 4, scored: 6, played: 2, won: 1, rank: 5, ...over }) as RankingAsker;

describe('FR-580 (title part) the title names the window', () => {
  it('FR-580 (title part) the title of a window is "Ranking del servidor" then the window in days, 7 or 30; all time keeps the plain title', () => {
    expect(rankingEmbed(page([row('111')]), 'points', ctx('last-7-days')).embed?.title).toBe('Ranking del servidor · últimos 7 días');
    expect(rankingEmbed(page([row('111')]), 'points', ctx('last-30-days')).embed?.title).toBe('Ranking del servidor · últimos 30 días');
    expect(rankingEmbed(page([row('111')]), 'points', ctx()).embed?.title).toBe('Ranking del servidor');
    expect(rankingEmbed(page([row('111')]), 'points', ctx()).embed?.title).toBe(STRINGS.rankingTitle);
  });

  it('FR-580 (title part) the title is the same in every order and on every page, and the plain-text twin starts with it', () => {
    for (const [period, days] of PERIODS) {
      for (const order of ['points', 'correct', 'wins', 'accuracy'] as const) {
        for (const n of [1, 2, 9]) {
          const message = rankingEmbed(page([row('111')], { total: 90 }), order, ctx(period, { page: n }));
          expect(message.embed?.title, `${period} ${order} ${n}`).toBe(`Ranking del servidor · últimos ${days} días`);
          expect(message.text.split('\n')[0], `${period} ${order} ${n}`).toBe(`Ranking del servidor · últimos ${days} días`);
        }
      }
    }
  });

  it('FR-580 (title part) a window changes only the title and the sentences: the rows, the footer and the colour are the all-time ones', () => {
    const items = [row('111', { rank: 1 }), row('222', { rank: 2, points: 90 })];
    const base = rankingEmbed(page(items, { total: 25 }), 'wins', ctx(undefined, { page: 2 })).embed!;
    for (const [period] of PERIODS) {
      const windowed = rankingEmbed(page(items, { total: 25 }), 'wins', ctx(period, { page: 2 })).embed!;
      expect({ ...windowed, title: '' }).toEqual({ ...base, title: '' });
    }
  });

  it('FR-580 (title part) the message of a window, with its buttons, has the window title; an all-time message the plain title', () => {
    for (const [period, days] of PERIODS) {
      const message = rankingMessage(page([row('111')], { total: 25 }), 'points', ctx(period), { askerId: '9', community: 'k', order: 'points', pages: [] });
      expect(message.embed?.title).toBe(`Ranking del servidor · últimos ${days} días`);
      expect(message.buttons).toHaveLength(2);
    }
    const plain = rankingMessage(page([row('111')], { total: 25 }), 'points', ctx(), { askerId: '9', community: 'k', order: 'points', pages: [] });
    expect(plain.embed?.title).toBe('Ranking del servidor');
  });
});

describe('FR-581 (sentence part) "Tu puesto" inside a window', () => {
  it('FR-581 (sentence part) a qualified asker gets their rank and statistics inside the window, as the all-time line is built', () => {
    for (const [period] of PERIODS) {
      const own = rankingEmbed(page([row('111')], { asker: asker() }), 'points', ctx(period)).embed!.fields;
      expect(own).toEqual([{ name: 'Tu puesto', value: 'Puesto 5 · 33 pts · aciertos 4/6 · victorias 1 · partidas 2 · precisión 66 %' }]);
    }
  });

  it('FR-581 (sentence part) in the accuracy order an asker with no rank (fewer than 10 scored inside the window) gets no line', () => {
    const unranked: RankingAsker = { points: 33, correct: 4, scored: 6, played: 2, won: 1 };
    for (const [period] of PERIODS) expect(rankingEmbed(page([row('111')], { asker: unranked }), 'accuracy', ctx(period)).embed!.fields).toEqual([]);
  });

  it('FR-581 (sentence part) an asker with no row inside the window gets the sentence of that window, 7 or 30 days, and the all-time sentence is unchanged', () => {
    const own = (period?: TimePeriod) => rankingEmbed(page([row('111')], { asker: { played: false } }), 'points', ctx(period)).embed!.fields;
    expect(own('last-7-days')).toEqual([{ name: 'Tu puesto', value: 'No has jugado ninguna partida terminada en este servidor en los últimos 7 días.' }]);
    expect(own('last-30-days')).toEqual([{ name: 'Tu puesto', value: 'No has jugado ninguna partida terminada en este servidor en los últimos 30 días.' }]);
    expect(own(undefined)).toEqual([{ name: 'Tu puesto', value: STRINGS.rankingNotPlayed }]);
    expect(STRINGS.rankingNotPlayed).toBe('Todavía no has jugado ninguna partida terminada en este servidor.');
  });

  it('FR-581 (sentence part) the line is also in the plain-text twin; a page with no asker has none', () => {
    const withLine = rankingEmbed(page([row('111')], { asker: { played: false } }), 'points', ctx('last-7-days'));
    expect(withLine.text.split('\n').at(-1)).toBe('Tu puesto: No has jugado ninguna partida terminada en este servidor en los últimos 7 días.');
    expect(rankingEmbed(page([row('111')]), 'points', ctx('last-7-days')).embed!.fields).toEqual([]);
  });
});

describe('FR-582 (sentence part) the empty window', () => {
  it('FR-582 (sentence part) a window with no row is one sentence naming the window, no embed and no buttons; all time keeps its own sentence', () => {
    expect(rankingEmpty('last-7-days')).toEqual({ text: 'Nadie ha jugado una partida terminada en este servidor en los últimos 7 días.', buttons: [] });
    expect(rankingEmpty('last-30-days')).toEqual({ text: 'Nadie ha jugado una partida terminada en este servidor en los últimos 30 días.', buttons: [] });
    expect(rankingEmpty()).toEqual({ text: STRINGS.rankingEmpty, buttons: [] });
    expect(STRINGS.rankingEmpty).toBe('Este servidor todavía no tiene ranking.');
    expect(rankingEmpty('last-7-days')).not.toHaveProperty('embed');
  });

  it('FR-582 (sentence part) an empty page is that sentence from the embed and from the message, whatever the order; the walk is not kept', () => {
    for (const [period, days] of PERIODS) {
      const sentence = `Nadie ha jugado una partida terminada en este servidor en los últimos ${days} días.`;
      for (const order of ['points', 'correct', 'wins', 'accuracy'] as const) {
        const empty = { items: [], total: 0 };
        expect(rankingEmbed(empty, order, ctx(period)), `${period} ${order}`).toEqual({ text: sentence, buttons: [] });
        const message = rankingMessage(empty, order, ctx(period), { askerId: '9', community: 'k', order, pages: [empty] });
        expect(message, `${period} ${order}`).toEqual({ text: sentence, buttons: [] });
      }
    }
    const allTime = rankingMessage({ items: [], total: 0 }, 'points', ctx(), { askerId: '9', community: 'k', order: 'points', pages: [] });
    expect(allTime).toEqual({ text: STRINGS.rankingEmpty, buttons: [] });
  });

  it('FR-582 (sentence part) the empty sentence is public: no private mark and no components in the payload', () => {
    const payload = replyPayload({ type: 'channel', messages: [rankingEmpty('last-30-days')] }, false)[0];
    expect(payload).not.toHaveProperty('flags');
    expect(payload).not.toHaveProperty('components');
  });
});

describe('NFR-130 the worst-case windowed page stays within every embed limit', () => {
  const widest = Number.MAX_SAFE_INTEGER;
  const id20 = (n: number): string => String(10 ** 19 + n);
  const name24 = (n: number): string => `N${String(n).padStart(2, '0')}${'x'.repeat(24)}`.slice(0, 24);
  /** Ten rows: 20-digit Discord ids with 24-character names, every statistic at its widest, and (accuracy) a tail without ranks. */
  const worst = (order: RankingOrder, own: RankingAsker): RankingPage => {
    const items: RankingRow[] = Array.from({ length: 10 }, (_, i) => {
      const base = { playerId: `discord:${id20(i)}`, name: name24(i), points: widest, correct: widest, scored: widest, played: widest, won: widest };
      return order === 'accuracy' && i >= 3 ? base : { ...base, rank: widest - i };
    });
    return { items, total: widest, asker: own, next: 'c'.repeat(256) };
  };
  const everyStatistic: RankingAsker = { points: widest, correct: widest, scored: widest, played: widest, won: widest, rank: widest };
  const sizeOf = (e: EmbedSpec): number => e.title.length + (e.description?.length ?? 0) + (e.footer?.length ?? 0) + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
  const previous: RankingRow = { playerId: 'discord:1', points: 1, correct: 1, scored: 1, played: 1, won: 1, rank: 1 };

  for (const order of ['points', 'correct', 'wins', 'accuracy'] as const) {
    for (const [period, days] of PERIODS) {
      for (const [label, own] of [['the asker line of statistics', everyStatistic], ['the asker window sentence', { played: false } as RankingAsker]] as const) {
        it(`NFR-130 ${order} ${days} days with ${label}: ten rows of 24-character names and 20-digit ids with every statistic at its widest, the windowed title and the note, within 6,000 characters, 25 fields, 4,096 for the description and 1,024 for a field value; nothing is cut`, () => {
          const message = rankingEmbed(worst(order, own), order, ctx(period, { page: 7, previous }));
          const embed = message.embed!;
          expect(embed.title).toBe(`Ranking del servidor · últimos ${days} días`);
          expect(linesOf(embed)).toHaveLength(order === 'accuracy' ? 11 : 10);
          if (order === 'accuracy') expect(linesOf(embed)).toContain(STRINGS.rankingUnrankedNote);
          expect(embed.fields).toHaveLength(1);
          expect(embed.fields[0]?.value).toBe(own.played === false ? `No has jugado ninguna partida terminada en este servidor en los últimos ${days} días.` : embed.fields[0]?.value);
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
          // The page of the message is within the same limits once it carries its buttons, and nobody is pinged.
          const payload = messagePayload(message, { mode: 'embed' });
          expect(payload.allowedMentions).toEqual({ parse: [] });
          expect(JSON.stringify(payload)).not.toContain('c'.repeat(256));
        });
      }
    }
  }
});
