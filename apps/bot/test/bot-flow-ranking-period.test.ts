import type { RankingAsker, RankingOrder, RankingRow } from '@mbrg/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RANKING_TTL_MS } from '../src/core/ranking';
import type { OutMessage, Reply, TimePeriod } from '../src/core/model';
import { STRINGS } from '../src/core/strings';
import { fromCommand } from '../src/discord/translate';
import { startFake } from './helpers/fake-server';
import type { Fake } from './helpers/fake-server';
import { CHANNEL, GUILD_A, GUILD_B, KEY_A, boot, tempState } from './helpers/harness';
import type { Bot } from './helpers/harness';

// Spec 027 FR-580, FR-581, FR-582, FR-583 (and the press part of FR-584): a ranking message of a time window pages like the 025 one and keeps its
// period beside the order and the pages: Next follows the cursor of the page shown with the same period, Previous returns to a page already shown, a
// press never mixes periods. A real bot core against the fake server, whose three rankings (all time, week, month) have different rows.

vi.setConfig({ testTimeout: 60_000 });

const ASKER = { channelId: CHANNEL, userId: '900000000000000001' };
const STRANGER = { channelId: CHANNEL, userId: '900000000000000002' };
const fakes: Fake[] = [];
const bots: Bot[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const bot of bots.splice(0)) bot.stop();
  for (const fake of fakes.splice(0)) await fake.close();
  for (const clean of cleanups.splice(0)) clean();
});

const rowsOf = (first: number, count: number, top: number): RankingRow[] =>
  Array.from({ length: count }, (_, i) => ({ playerId: `discord:${first + i}`, points: top - i, correct: 5, scored: 10, played: 2, won: 1, rank: i + 1 }));
const ALL = rowsOf(1000, 25, 5000);
const WEEK = rowsOf(2000, 25, 300);
const MONTH = rowsOf(3000, 23, 800);
const every = (rows: RankingRow[]): Record<RankingOrder, RankingRow[]> => ({ points: rows, correct: rows, wins: rows, accuracy: rows });
const weekAsker = (_playerId: string, order: RankingOrder): RankingAsker => ({ points: 7, correct: 3, scored: 4, played: 1, won: 0, ...(order === 'accuracy' ? {} : { rank: 24 }) });
const PERIODS: readonly (readonly [string, TimePeriod, number, RankingRow[]])[] = [['semana', 'last-7-days', 7, WEEK], ['mes', 'last-30-days', 30, MONTH]];

async function world() {
  const fake = await startFake();
  fakes.push(fake);
  fake.ranking.set(KEY_A, {
    rows: every(ALL),
    periods: { 'last-7-days': { rows: every(WEEK), asker: weekAsker }, 'last-30-days': { rows: every(MONTH) } },
  });
  const state = tempState();
  cleanups.push(state.remove);
  const bot = boot(fake, state.path);
  bots.push(bot);
  return { fake, bot, state };
}
const reads = (fake: Fake) => fake.requests.filter((r) => r.path === '/ranking');
const messageOf = (reply: Reply): OutMessage => {
  expect(reply.type).toBe('channel');
  return (reply as Extract<Reply, { type: 'channel' }>).messages[0]!;
};
/** What a reader sees of a message: everything but the walk the shell keeps (its pages grow as the asker pages). */
const seen = (m: OutMessage) => ({ text: m.text, buttons: m.buttons, embed: m.embed });
const buttonsOf = (m: OutMessage) => m.buttons.map((b) => (b.type === 'custom' ? [b.customId, b.disabled === true] : [b.label, false]));
const command = (guildId: string | null, order?: string, period?: string) =>
  fromCommand('ranking', { ...(order === undefined ? {} : { order }), ...(period === undefined ? {} : { period }) }, false, ASKER.userId, guildId)!;
async function firstPage(bot: Bot, order: string | undefined, period: string | undefined, messageId = 'msg-1') {
  const reply = await bot.run(command(GUILD_A, order, period), ASKER);
  bot.sent(reply, messageId);
  return messageOf(reply);
}
const firstMention = (m: OutMessage): string => m.embed!.description!.split('\n')[0]!.split(' ')[1]!;

describe('FR-580 the command in each period and order replies publicly with page 1 of that period', () => {
  it('FR-580 each period word in each order posts page 1 of THAT ranking (its own rows and total), titled with its window, with the buttons and the footer of its pages', async () => {
    const { bot } = await world();
    for (const [word, , days, rows] of PERIODS) {
      for (const order of [undefined, 'puntos', 'aciertos', 'victorias', 'precisión']) {
        const page = await firstPage(bot, order, word);
        expect(page.embed?.title, `${word} ${order}`).toBe(`Ranking del servidor · últimos ${days} días`);
        expect(firstMention(page), `${word} ${order}`).toBe(`<@${rows[0]!.playerId.slice('discord:'.length)}>`);
        expect(page.embed?.description?.split('\n').filter((l) => !l.startsWith('Menos de')), `${word} ${order}`).toHaveLength(10);
        expect(page.embed?.footer, `${word} ${order}`).toBe('Página 1/3');
        expect(buttonsOf(page), `${word} ${order}`).toEqual([['mbrg:rk:p:1', true], ['mbrg:rk:n:2', false]]);
      }
    }
  });

  it('FR-580 without a period word the ranking is the all-time one, with the plain title, as 025 (the other rankings of the server are not read)', async () => {
    const { fake, bot } = await world();
    const page = await firstPage(bot, 'victorias', undefined);
    expect(page.embed?.title).toBe('Ranking del servidor');
    expect(firstMention(page)).toBe('<@1000>');
    expect(reads(fake)).toHaveLength(1);
    expect(reads(fake)[0]!.body).not.toHaveProperty('period');
  });

  it('FR-580 the first page of a window is a public message of the asker: the walk is remembered with the asker, the key, the order, the period and the page', async () => {
    const { bot } = await world();
    await firstPage(bot, 'victorias', 'semana');
    expect(bot.boards.lookupRanking('msg-1')).toMatchObject({ askerId: ASKER.userId, community: KEY_A, order: 'wins', period: 'last-7-days', pages: [expect.anything()] });
  });
});

describe('FR-581 "Tu puesto" inside a window on the message', () => {
  it('FR-581 the asker line gives the rank and statistics inside the window, and the window sentence for an asker with no row in it', async () => {
    const { bot } = await world();
    const week = await firstPage(bot, 'victorias', 'semana');
    expect(week.embed?.fields).toEqual([{ name: 'Tu puesto', value: 'Puesto 24 · victorias 0 · 7 pts · aciertos 3/4 · partidas 1 · precisión 75 %' }]);
    const month = await firstPage(bot, undefined, 'mes', 'msg-2');
    expect(month.embed?.fields).toEqual([{ name: 'Tu puesto', value: 'No has jugado ninguna partida terminada en este servidor en los últimos 30 días.' }]);
  });

  it('FR-581 in the accuracy order of a window an asker with no rank gets no line', async () => {
    const { bot } = await world();
    expect((await firstPage(bot, 'precisión', 'semana')).embed?.fields).toEqual([]);
  });
});

describe('FR-582 the empty window', () => {
  it('FR-582 a window with no row is one public sentence naming the window, no buttons, no embed and no walk; the all-time ranking of the same server still lists', async () => {
    const { fake, bot } = await world();
    fake.ranking.set(KEY_A, { rows: every(ALL), periods: { 'last-30-days': { rows: every(MONTH) } } });
    const empty = await firstPage(bot, undefined, 'semana');
    expect(empty).toEqual({ text: 'Nadie ha jugado una partida terminada en este servidor en los últimos 7 días.', buttons: [] });
    expect(empty.embed).toBeUndefined();
    expect(bot.boards.lookupRanking('msg-1')).toBeUndefined();
    expect((await firstPage(bot, undefined, undefined, 'msg-2')).embed?.title).toBe('Ranking del servidor');
  });

  it('FR-582 another server (no ranking at all) gets the sentence of the window it asked, and the all-time sentence without one', async () => {
    const { bot } = await world();
    expect((await bot.run(command(GUILD_B, undefined, 'mes'), ASKER))).toEqual({ type: 'channel', messages: [{ text: 'Nadie ha jugado una partida terminada en este servidor en los últimos 30 días.', buttons: [] }] });
    expect((await bot.run(command(GUILD_B), ASKER))).toEqual({ type: 'channel', messages: [{ text: STRINGS.rankingEmpty, buttons: [] }] });
  });
});

describe('FR-583 the walk keeps its period', () => {
  it('FR-583 Next follows the cursor of the page shown with the same period and order, the title, snapshot and "Página N/M" stay those of the window, and the walk keeps every page', async () => {
    const { fake, bot } = await world();
    await firstPage(bot, 'aciertos', 'semana');
    const second = messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER));
    expect(reads(fake)[1]!.body).toEqual({ community: KEY_A, order: 'correct', period: 'last-7-days', playerId: ASKER.userId, limit: 10, cursor: 'correct.10.25.last-7-days' });
    expect(second.embed?.title).toBe('Ranking del servidor · últimos 7 días');
    expect(second.embed?.footer).toBe('Página 2/3');
    expect(second.embed?.description?.split('\n')[0]?.startsWith('11. <@2010>')).toBe(true);
    expect(buttonsOf(second)).toEqual([['mbrg:rk:p:1', false], ['mbrg:rk:n:3', false]]);
    const third = messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:n:3', ASKER));
    expect(reads(fake)[2]!.body).toMatchObject({ order: 'correct', period: 'last-7-days', cursor: 'correct.20.25.last-7-days' });
    expect(third.embed?.description?.split('\n')).toHaveLength(5);
    expect(third.embed?.footer).toBe('Página 3/3');
    expect(third.embed?.title).toBe('Ranking del servidor · últimos 7 días');
    expect(buttonsOf(third)).toEqual([['mbrg:rk:p:2', false], ['mbrg:rk:n:3', true]]);
    expect(bot.boards.lookupRanking('msg-1')).toMatchObject({ period: 'last-7-days', order: 'correct' });
    expect(bot.boards.lookupRanking('msg-1')?.pages).toHaveLength(3);
  });

  it('FR-583 a month message pages in the month: every request of the walk names last-30-days and the rows are the month ones', async () => {
    const { fake, bot } = await world();
    await firstPage(bot, undefined, 'mes');
    const second = messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER));
    const third = messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:n:3', ASKER));
    expect(reads(fake).map((r) => (r.body as { period?: string }).period)).toEqual(['last-30-days', 'last-30-days', 'last-30-days']);
    expect(second.embed?.description?.split('\n')[0]?.startsWith('11. <@3010>')).toBe(true);
    expect(third.embed?.description?.split('\n')).toHaveLength(3);
    expect(third.embed?.footer).toBe('Página 3/3');
  });

  it('FR-583 Previous returns to the page already shown, the same data and the same snapshot, even if the ranking changed meanwhile, and asks the server nothing', async () => {
    const { fake, bot } = await world();
    const first = await firstPage(bot, 'victorias', 'semana');
    const second = messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER));
    await bot.pressRanking('msg-1', 'mbrg:rk:n:3', ASKER);
    // A match finishes while the asker pages: a new member is now first in the server's week.
    fake.ranking.set(KEY_A, { rows: every(ALL), periods: { 'last-7-days': { rows: every([{ ...WEEK[0]!, playerId: 'discord:2999' }, ...WEEK]), asker: weekAsker } } });
    const before = reads(fake).length;
    expect(seen(messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:p:2', ASKER)))).toEqual(seen(second));
    const back = messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:p:1', ASKER));
    expect(seen(back)).toEqual(seen(first));
    expect(back.embed?.footer).toBe('Página 1/3');
    expect(back.embed?.title).toBe('Ranking del servidor · últimos 7 días');
    expect(seen(messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER)))).toEqual(seen(second));
    expect(reads(fake)).toHaveLength(before);
    expect(bot.boards.lookupRanking('msg-1')?.pages).toHaveLength(3);
  });

  it('FR-583 an all-time message still pages in all time: its walk holds no period, and its requests name none', async () => {
    const { fake, bot } = await world();
    await firstPage(bot, undefined, undefined);
    const second = messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER));
    expect(second.embed?.title).toBe('Ranking del servidor');
    expect(reads(fake)[1]!.body).toEqual({ community: KEY_A, order: 'points', playerId: ASKER.userId, limit: 10, cursor: 'points.10.25' });
    expect(bot.boards.lookupRanking('msg-1')).not.toHaveProperty('period');
  });

  it('FR-583 a press never mixes periods: two messages of one channel (a week and a month) paged in turn each ask with their own period and keep their own rows', async () => {
    const { fake, bot } = await world();
    await firstPage(bot, undefined, 'semana', 'msg-week');
    await firstPage(bot, undefined, 'mes', 'msg-month');
    await firstPage(bot, undefined, undefined, 'msg-all');
    const base = reads(fake).length;
    const month2 = messageOf(await bot.pressRanking('msg-month', 'mbrg:rk:n:2', ASKER));
    const week2 = messageOf(await bot.pressRanking('msg-week', 'mbrg:rk:n:2', ASKER));
    const all2 = messageOf(await bot.pressRanking('msg-all', 'mbrg:rk:n:2', ASKER));
    const week3 = messageOf(await bot.pressRanking('msg-week', 'mbrg:rk:n:3', ASKER));
    const month3 = messageOf(await bot.pressRanking('msg-month', 'mbrg:rk:n:3', ASKER));
    expect(reads(fake).slice(base).map((r) => (r.body as { period?: string; cursor?: string }).period)).toEqual(['last-30-days', 'last-7-days', undefined, 'last-7-days', 'last-30-days']);
    expect([month2, week2, all2, week3, month3].map((m) => m.embed?.title)).toEqual(['Ranking del servidor · últimos 30 días', 'Ranking del servidor · últimos 7 días', 'Ranking del servidor', 'Ranking del servidor · últimos 7 días', 'Ranking del servidor · últimos 30 días']);
    expect([month2, week2, all2].map((m) => m.embed?.description?.split('\n')[0]?.startsWith('11. <@3010>') === true)).toEqual([true, false, false]);
    expect(week2.embed?.description?.split('\n')[0]?.startsWith('11. <@2010>')).toBe(true);
    expect(all2.embed?.description?.split('\n')[0]?.startsWith('11. <@1010>')).toBe(true);
    expect(bot.boards.lookupRanking('msg-week')).toMatchObject({ period: 'last-7-days' });
    expect(bot.boards.lookupRanking('msg-month')).toMatchObject({ period: 'last-30-days' });
    expect(bot.boards.lookupRanking('msg-all')).not.toHaveProperty('period');
  });

  it('FR-583 the buttons carry only the target page: no period, no floor, no cursor, no key and no member in any custom id of a window', async () => {
    const { bot } = await world();
    for (const [word] of PERIODS) {
      const page = await firstPage(bot, 'victorias', word);
      const second = messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER));
      for (const message of [page, second]) {
        const ids = message.buttons.flatMap((b) => (b.type === 'custom' ? [b.customId] : []));
        expect(ids).toHaveLength(2);
        for (const id of ids) expect(id, id).toMatch(/^mbrg:rk:[pn]:[1-9][0-9]{0,5}$/);
        expect(JSON.stringify(message.buttons)).not.toMatch(/last-|semana|mes\b|KEY|900000/);
        expect(JSON.stringify(message.buttons)).not.toContain(KEY_A);
      }
    }
  });
});

describe('FR-583 who may page and for how long', () => {
  it('FR-583 another member gets a private sentence and nothing changes: no request, the same walk, the same message', async () => {
    const { fake, bot } = await world();
    await firstPage(bot, undefined, 'mes');
    const walk = bot.boards.lookupRanking('msg-1');
    expect(await bot.pressRanking('msg-1', 'mbrg:rk:n:2', STRANGER)).toEqual({ type: 'text', text: STRINGS.rankingNotYours });
    expect(reads(fake)).toHaveLength(1);
    expect(bot.boards.lookupRanking('msg-1')).toEqual(walk);
  });

  it('FR-583 five minutes after posting the buttons are disabled with one edit, a press is answered as expired with no request, and paging does not extend the five minutes', async () => {
    const { fake, bot } = await world();
    await firstPage(bot, undefined, 'semana');
    bot.elapse(RANKING_TTL_MS - 10_000);
    expect((await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER)).type).toBe('channel');
    bot.elapse(10_000);
    expect(bot.disables).toEqual([{ channelId: CHANNEL, messageId: 'msg-1' }]);
    expect(await bot.pressRanking('msg-1', 'mbrg:rk:n:3', ASKER)).toEqual({ type: 'text', text: STRINGS.rankingExpired });
    expect(await bot.pressRanking('msg-1', 'mbrg:rk:p:1', ASKER)).toEqual({ type: 'text', text: STRINGS.rankingExpired });
    expect(reads(fake)).toHaveLength(2);
  });

  it('FR-583 after a restart the walks are gone: a press on an old message of a window is answered as expired and asks the server nothing', async () => {
    const { fake, bot, state } = await world();
    await firstPage(bot, undefined, 'mes');
    bot.stop();
    const restarted = boot(fake, state.path);
    bots.push(restarted);
    const before = reads(fake).length;
    expect(await restarted.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER)).toEqual({ type: 'text', text: STRINGS.rankingExpired });
    expect(reads(fake)).toHaveLength(before);
  });
});

describe('FR-584 a press of a window the server cannot answer', () => {
  it('FR-584 an outage or a refusal on Next is one private sentence, one request and no retry; the walk and the message stay as they were and the window still pages after', async () => {
    const { fake, bot } = await world();
    await firstPage(bot, undefined, 'semana');
    const walk = bot.boards.lookupRanking('msg-1');
    fake.rankingError = { status: 503, body: { kind: 'unavailable' } };
    expect(await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER)).toEqual({ type: 'text', text: STRINGS.rankingUnavailable });
    expect(reads(fake)).toHaveLength(2);
    fake.rankingError = undefined;
    fake.down = true;
    expect(await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER)).toEqual({ type: 'text', text: STRINGS.rankingUnavailable });
    expect(reads(fake)).toHaveLength(3);
    fake.down = false;
    expect(bot.boards.lookupRanking('msg-1')).toEqual(walk);
    const second = messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER));
    expect(second.embed?.footer).toBe('Página 2/3');
    expect(second.embed?.title).toBe('Ranking del servidor · últimos 7 días');
  });

  it('FR-584 a cursor of another period is refused by the server: a press that mixed periods would be "unavailable", never another window\'s rows', async () => {
    const { fake, bot } = await world();
    await firstPage(bot, undefined, 'semana');
    // The walk is tampered with in memory: its cursor is the week's, its period the month's.
    const walk = bot.boards.lookupRanking('msg-1')!;
    expect(walk.pages[0]!.next).toBe('points.10.25.last-7-days');
    const before = reads(fake).length;
    const reply = await bot.run({ type: 'ranking-press', customId: 'mbrg:rk:n:2', userId: ASKER.userId, entry: { ...walk, period: 'last-30-days' }, now: bot.clock }, ASKER);
    expect(reply).toEqual({ type: 'text', text: STRINGS.rankingUnavailable });
    expect(reads(fake)).toHaveLength(before + 1);
    expect(reads(fake)[before]!.body).toMatchObject({ period: 'last-30-days', cursor: 'points.10.25.last-7-days' });
  });
});
