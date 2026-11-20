import type { RankingAsker, RankingOrder, RankingRow } from '@mbrg/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RANKING_TTL_MS } from '../src/core/ranking';
import type { OutMessage, Reply } from '../src/core/model';
import { STRINGS } from '../src/core/strings';
import { fromCommand } from '../src/discord/translate';
import { startFake } from './helpers/fake-server';
import type { Fake } from './helpers/fake-server';
import { CHANNEL, GUILD_A, GUILD_B, KEY_A, boot, tempState } from './helpers/harness';
import type { Bot } from './helpers/harness';

// Spec 025 FR-569 (paging, the rules of 024 FR-555), FR-570 and FR-571 on a press: a ranking message pages like a history one: only the asker, in place,
// five minutes, expired after a restart; Next follows the cursor of the page shown and Previous returns to a page already shown, so every press shows
// the same snapshot. A real bot core against the fake server.

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

const row = (n: number): RankingRow => ({ playerId: `discord:${1000 + n}`, points: 500 - n, correct: 5, scored: 10, played: 2, won: 1, rank: n + 1 });
const askerOf = (_playerId: string, order: RankingOrder): RankingAsker => ({ points: 7, correct: 3, scored: 4, played: 1, won: 0, ...(order === 'accuracy' ? {} : { rank: 24 }) });

async function world(count = 25) {
  const fake = await startFake();
  fakes.push(fake);
  const rows = Array.from({ length: count }, (_, i) => row(i));
  fake.ranking.set(KEY_A, { rows: { points: rows, correct: rows, wins: rows, accuracy: rows }, asker: askerOf });
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
const command = (guildId: string | null, order?: string) => fromCommand('ranking', order === undefined ? {} : { order }, false, ASKER.userId, guildId)!;
async function firstPage(bot: Bot, word = 'victorias') {
  const reply = await bot.run(command(GUILD_A, word), ASKER);
  bot.sent(reply, 'msg-1');
  return messageOf(reply);
}

describe('FR-569 the first page and the walk', () => {
  it('FR-569 page 1 is a public message of 10 rows with its buttons and the asker line, asked once; the walk remembers the asker, the key, the order and the page', async () => {
    const { fake, bot } = await world();
    const page = await firstPage(bot);
    expect(page.embed?.description?.split('\n')).toHaveLength(10);
    expect(page.embed?.footer).toBe('Página 1/3');
    expect(page.embed?.fields).toEqual([{ name: 'Tu puesto', value: 'Puesto 24 · victorias 0 · 7 pts · aciertos 3/4 · partidas 1 · precisión 75 %' }]);
    expect(page.embed?.description?.split('\n')[0]).toBe('1. <@1000> - victorias 1 · 500 pts · aciertos 5/10 · partidas 2 · precisión 50 %');
    expect(buttonsOf(page)).toEqual([['mbrg:rk:p:1', true], ['mbrg:rk:n:2', false]]);
    expect(reads(fake)).toHaveLength(1);
    expect(bot.boards.lookupRanking('msg-1')).toMatchObject({ askerId: ASKER.userId, community: KEY_A, order: 'wins', pages: [expect.anything()] });
  });

  it('FR-569 Next follows the cursor of the page shown in the same order and for the same asker, the last page has Next disabled, and the walk keeps every page it showed', async () => {
    const { fake, bot } = await world();
    await firstPage(bot, 'aciertos');
    const second = messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER));
    expect(reads(fake)[1]!.body).toEqual({ community: KEY_A, order: 'correct', playerId: ASKER.userId, limit: 10, cursor: 'correct.10.25' });
    expect(second.embed?.footer).toBe('Página 2/3');
    expect(second.embed?.description?.split('\n')[0]?.startsWith('11. <@1010>')).toBe(true);
    expect(buttonsOf(second)).toEqual([['mbrg:rk:p:1', false], ['mbrg:rk:n:3', false]]);
    const third = messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:n:3', ASKER));
    expect(reads(fake)[2]!.body).toMatchObject({ order: 'correct', cursor: 'correct.20.25' });
    expect(third.embed?.description?.split('\n')).toHaveLength(5);
    expect(third.embed?.footer).toBe('Página 3/3');
    expect(buttonsOf(third)).toEqual([['mbrg:rk:p:2', false], ['mbrg:rk:n:3', true]]);
    expect(bot.boards.lookupRanking('msg-1')?.pages).toHaveLength(3);
  });

  it('FR-569 Previous returns to the page already shown, the same data and the same snapshot, even if the ranking changed meanwhile, and asks the server nothing', async () => {
    const { fake, bot } = await world();
    const first = await firstPage(bot);
    const second = messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER));
    await bot.pressRanking('msg-1', 'mbrg:rk:n:3', ASKER);
    // A match finishes while the asker pages: a new member is now first in the server's list.
    const more = [{ ...row(99), rank: 1 }, ...(fake.ranking.get(KEY_A)?.rows.wins ?? [])];
    fake.ranking.set(KEY_A, { rows: { wins: more }, asker: askerOf });
    const before = reads(fake).length;
    expect(seen(messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:p:2', ASKER)))).toEqual(seen(second));
    const back = messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:p:1', ASKER));
    expect(seen(back)).toEqual(seen(first));
    expect(back.embed?.footer).toBe('Página 1/3');
    expect(seen(messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER)))).toEqual(seen(second));
    expect(reads(fake)).toHaveLength(before);
    expect(bot.boards.lookupRanking('msg-1')?.pages).toHaveLength(3);
  });

  it('FR-569 in the accuracy order the note follows the tail across pages: the page before decides whether it opens the next one', async () => {
    const { fake, bot } = await world();
    const ranked = Array.from({ length: 10 }, (_, i) => row(i));
    const unranked = Array.from({ length: 15 }, (_, i) => { const { rank: _rank, ...rest } = row(10 + i); return rest as RankingRow; });
    fake.ranking.set(KEY_A, { rows: { accuracy: [...ranked, ...unranked] }, asker: askerOf });
    const first = await firstPage(bot, 'precisión');
    expect(first.embed?.description).not.toContain('Menos de 10 predicciones');
    expect(first.embed?.fields).toEqual([]);
    const second = messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER));
    expect(second.embed?.description?.split('\n')[0]).toBe('Menos de 10 predicciones: sin puesto en precisión');
    const third = messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:n:3', ASKER));
    expect(third.embed?.description).not.toContain('Menos de 10 predicciones');
    // Back on page 2 the note is there again: the page before it is the one in memory.
    expect(messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:p:2', ASKER)).embed?.description?.split('\n')[0]).toBe('Menos de 10 predicciones: sin puesto en precisión');
  });

  it('FR-569 FR-570 a ranking of one page, or of a server with no counted match, has nothing to page: the walk is not remembered; the empty one is a sentence without buttons', async () => {
    const { fake, bot } = await world(4);
    const one = await firstPage(bot);
    expect(one.embed?.footer).toBe('Página 1/1');
    expect(one.buttons.every((b) => b.type === 'custom' && b.disabled === true)).toBe(true);
    expect(bot.boards.lookupRanking('msg-1')).toBeUndefined();
    const empty = messageOf(await bot.run(command(GUILD_B, 'puntos'), ASKER));
    expect(empty).toEqual({ text: STRINGS.rankingEmpty, buttons: [] });
    expect(empty.embed).toBeUndefined();
    expect(reads(fake).at(-1)!.body).toMatchObject({ order: 'points' });
  });
});

describe('FR-569 who may page and for how long', () => {
  it('FR-569 another member gets a private sentence and nothing changes: no request, the same walk, the same message', async () => {
    const { fake, bot } = await world();
    await firstPage(bot);
    const walk = bot.boards.lookupRanking('msg-1');
    const reply = await bot.pressRanking('msg-1', 'mbrg:rk:n:2', STRANGER);
    expect(reply).toEqual({ type: 'text', text: STRINGS.rankingNotYours });
    expect(reads(fake)).toHaveLength(1);
    expect(bot.boards.lookupRanking('msg-1')).toEqual(walk);
  });

  it('FR-569 five minutes after posting the buttons are disabled with one edit, and a press is answered as expired with no request', async () => {
    const { fake, bot } = await world();
    await firstPage(bot);
    bot.elapse(RANKING_TTL_MS - 1);
    expect(bot.disables).toEqual([]);
    expect((await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER)).type).toBe('channel');
    bot.elapse(1);
    expect(bot.disables).toEqual([{ channelId: CHANNEL, messageId: 'msg-1' }]);
    expect(await bot.pressRanking('msg-1', 'mbrg:rk:n:3', ASKER)).toEqual({ type: 'text', text: STRINGS.rankingExpired });
    expect(reads(fake)).toHaveLength(2);
  });

  it('FR-569 paging does not extend the five minutes: the expiry is the one of the posting', async () => {
    const { bot } = await world();
    await firstPage(bot);
    bot.elapse(RANKING_TTL_MS - 10_000);
    await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER);
    bot.elapse(10_000);
    expect(bot.disables).toEqual([{ channelId: CHANNEL, messageId: 'msg-1' }]);
    expect(await bot.pressRanking('msg-1', 'mbrg:rk:p:1', ASKER)).toEqual({ type: 'text', text: STRINGS.rankingExpired });
  });

  it('FR-569 after a restart the walks are gone: a press on an old message is answered as expired and asks the server nothing', async () => {
    const { fake, bot, state } = await world();
    await firstPage(bot);
    bot.stop();
    const restarted = boot(fake, state.path);
    bots.push(restarted);
    const before = reads(fake).length;
    expect(await restarted.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER)).toEqual({ type: 'text', text: STRINGS.rankingExpired });
    expect(reads(fake)).toHaveLength(before);
  });

  it('FR-569 a failed disable edit is ignored: the press is still refused as expired', async () => {
    const { bot } = await world();
    await firstPage(bot);
    bot.failDisables = true;
    bot.elapse(RANKING_TTL_MS);
    expect(await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER)).toEqual({ type: 'text', text: STRINGS.rankingExpired });
  });

  it('FR-569 a history message and a ranking message keep their own walks: a history id pressed on a ranking message is not served', async () => {
    const { fake, bot } = await world();
    await firstPage(bot);
    expect(bot.boards.lookupHistory('msg-1')).toBeUndefined();
    const before = fake.requests.length;
    const reply = await bot.pressHistory('msg-1', 'mbrg:hs:n:2', ASKER);
    expect(reply).toEqual({ type: 'text', text: STRINGS.historyExpired });
    expect(fake.requests).toHaveLength(before);
  });
});

describe('FR-571 a press the server cannot answer', () => {
  it('FR-571 an outage or a refusal on Next is one private sentence, one request and no retry; the walk and the message stay as they were', async () => {
    const { fake, bot } = await world();
    await firstPage(bot);
    const walk = bot.boards.lookupRanking('msg-1');
    fake.rankingError = { status: 503, body: { kind: 'unavailable' } };
    expect(await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER)).toEqual({ type: 'text', text: STRINGS.rankingUnavailable });
    expect(reads(fake)).toHaveLength(2);
    fake.down = true;
    expect(await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER)).toEqual({ type: 'text', text: STRINGS.rankingUnavailable });
    expect(reads(fake)).toHaveLength(3);
    expect(bot.boards.lookupRanking('msg-1')).toEqual(walk);
    fake.down = false;
    fake.rankingError = undefined;
    expect(messageOf(await bot.pressRanking('msg-1', 'mbrg:rk:n:2', ASKER)).embed?.footer).toBe('Página 2/3');
  });

  it('FR-571 the first page of a failing server is one private sentence and one request, and nothing is remembered for paging', async () => {
    const { fake, bot } = await world();
    fake.rankingError = { status: 500, body: { kind: 'unavailable' } };
    const reply = await bot.run(command(GUILD_A), ASKER);
    expect(reply).toEqual({ type: 'text', text: STRINGS.rankingUnavailable });
    expect(reads(fake)).toHaveLength(1);
    bot.sent(reply, 'msg-1');
    expect(bot.boards.lookupRanking('msg-1')).toBeUndefined();
  });
});
