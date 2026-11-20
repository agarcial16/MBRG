import type { HistoryEntry } from '@mbrg/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_TTL_MS } from '../src/core/history';
import type { OutMessage, Reply } from '../src/core/model';
import { STRINGS } from '../src/core/strings';
import { startFake } from './helpers/fake-server';
import type { Fake } from './helpers/fake-server';
import { CHANNEL, KEY_A, boot, tempState } from './helpers/harness';
import type { Bot } from './helpers/harness';

// Spec 024 FR-555: a history message pages like a leaderboard (017): only the asker, in place, five minutes, expired after a restart; Next follows the
// cursor of the page shown and Previous returns to a page already shown, so every press shows the same snapshot. A real bot core against the fake server.

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

const entry = (n: number): HistoryEntry => ({
  matchId: `match-${String(n).padStart(3, '0')}`, mapId: 'europe', finishedAt: 1_800_000_000_000 - n * 60_000, winner: 3, playerCount: 2,
  top: [{ playerId: 'discord:111', points: 9, rank: 1 }], more: 1, asker: { points: 4, rank: 2 },
});

async function world(count = 12) {
  const fake = await startFake();
  fakes.push(fake);
  fake.history.set(KEY_A, Array.from({ length: count }, (_, i) => entry(i)));
  const state = tempState();
  cleanups.push(state.remove);
  const bot = boot(fake, state.path, { viewerUrl: 'https://viewer.example/' });
  bots.push(bot);
  return { fake, bot, state };
}
const reads = (fake: Fake) => fake.requests.filter((r) => r.path === '/history');
const messageOf = (reply: Reply): OutMessage => {
  expect(reply.type).toBe('channel');
  return (reply as Extract<Reply, { type: 'channel' }>).messages[0]!;
};
/** What a reader sees of a message: everything but the walk the shell keeps (its pages grow as the asker pages). */
const seen = (m: OutMessage) => ({ text: m.text, buttons: m.buttons, embed: m.embed });
const buttonsOf = (m: OutMessage) => m.buttons.map((b) => (b.type === 'custom' ? [b.customId, b.disabled === true] : [b.label, false]));
async function firstPage(bot: Bot) {
  const reply = await bot.act({ do: 'history', community: KEY_A }, ASKER);
  bot.sent(reply, 'msg-1');
  return messageOf(reply);
}

describe('FR-555 NFR-122 the first page and the walk', () => {
  it('FR-555 page 1 is a public message of 5 entries with its buttons, asked once with the key, the asker and the page size in the body and nothing in the path', async () => {
    const { fake, bot } = await world();
    const page = await firstPage(bot);
    expect(page.embed?.fields).toHaveLength(5);
    expect(page.embed?.footer).toBe('Página 1/3');
    expect(page.embed?.fields[0]?.value.split('\n')[0]).toBe('Ganó **Francia** · 2 jugadores');
    expect(buttonsOf(page)).toEqual([['mbrg:hs:p:1', true], ['mbrg:hs:n:2', false]]);
    expect(reads(fake)).toHaveLength(1);
    expect(reads(fake)[0]).toMatchObject({ method: 'POST', path: '/history', body: { community: KEY_A, playerId: ASKER.userId, limit: 5 } });
    expect(Object.keys(reads(fake)[0]!.body as object).sort()).toEqual(['community', 'limit', 'playerId']);
    expect(bot.boards.lookupHistory('msg-1')).toMatchObject({ askerId: ASKER.userId, community: KEY_A, pages: [expect.anything()] });
  });

  it('FR-555 Next follows the cursor of the page shown, the last page has Next disabled, and the walk keeps every page it showed', async () => {
    const { fake, bot } = await world();
    await firstPage(bot);
    const second = messageOf(await bot.pressHistory('msg-1', 'mbrg:hs:n:2', ASKER));
    expect(reads(fake)[1]!.body).toEqual({ community: KEY_A, playerId: ASKER.userId, limit: 5, cursor: '5.12' });
    expect(second.embed?.footer).toBe('Página 2/3');
    expect(second.embed?.fields.map((f) => f.name.includes('<t:'))).toEqual([true, true, true, true, true]);
    expect(buttonsOf(second)).toEqual([['mbrg:hs:p:1', false], ['mbrg:hs:n:3', false]]);
    const third = messageOf(await bot.pressHistory('msg-1', 'mbrg:hs:n:3', ASKER));
    expect(reads(fake)[2]!.body).toMatchObject({ cursor: '10.12' });
    expect(third.embed?.fields).toHaveLength(2);
    expect(third.embed?.footer).toBe('Página 3/3');
    expect(buttonsOf(third)).toEqual([['mbrg:hs:p:2', false], ['mbrg:hs:n:3', true]]);
    expect(bot.boards.lookupHistory('msg-1')?.pages).toHaveLength(3);
  });

  it('FR-555 NFR-122 Previous returns to the page already shown, the same data and the same snapshot, even if a match finished meanwhile, and asks the server nothing', async () => {
    const { fake, bot } = await world();
    const first = await firstPage(bot);
    const second = messageOf(await bot.pressHistory('msg-1', 'mbrg:hs:n:2', ASKER));
    await bot.pressHistory('msg-1', 'mbrg:hs:n:3', ASKER);
    // A match finishes while the asker pages: the newest match is now first in the server's list.
    fake.history.set(KEY_A, [entry(99), ...(fake.history.get(KEY_A) ?? [])]);
    const before = reads(fake).length;
    expect(seen(messageOf(await bot.pressHistory('msg-1', 'mbrg:hs:p:2', ASKER)))).toEqual(seen(second));
    const back = messageOf(await bot.pressHistory('msg-1', 'mbrg:hs:p:1', ASKER));
    expect(seen(back)).toEqual(seen(first));
    expect(back.embed?.footer).toBe('Página 1/3');
    // Next again to a page shown before is the stored page too.
    expect(seen(messageOf(await bot.pressHistory('msg-1', 'mbrg:hs:n:2', ASKER)))).toEqual(seen(second));
    expect(reads(fake)).toHaveLength(before);
    // The stack still holds the three pages.
    expect(bot.boards.lookupHistory('msg-1')?.pages).toHaveLength(3);
  });

  it('FR-555 a history of one page, or no counted match, has nothing to page: the walk is not remembered; the empty one is a sentence without buttons', async () => {
    const { bot } = await world(3);
    const one = await firstPage(bot);
    expect(one.embed?.footer).toBe('Página 1/1');
    expect(one.buttons.every((b) => b.type === 'custom' && b.disabled === true)).toBe(true);
    expect(bot.boards.lookupHistory('msg-1')).toBeUndefined();
    const empty = messageOf(await bot.act({ do: 'history', community: 'f'.repeat(64) }, ASKER));
    expect(empty).toEqual({ text: STRINGS.historyEmpty, buttons: [] });
  });
});

describe('FR-555 who may page and for how long', () => {
  it('FR-555 another member gets a private sentence and nothing changes: no request, the same walk, the same message', async () => {
    const { fake, bot } = await world();
    await firstPage(bot);
    const walk = bot.boards.lookupHistory('msg-1');
    const reply = await bot.pressHistory('msg-1', 'mbrg:hs:n:2', STRANGER);
    expect(reply).toEqual({ type: 'text', text: STRINGS.historyNotYours });
    expect(reads(fake)).toHaveLength(1);
    expect(bot.boards.lookupHistory('msg-1')).toEqual(walk);
  });

  it('FR-555 five minutes after posting the buttons are disabled with one edit, and a press is answered as expired with no request', async () => {
    const { fake, bot } = await world();
    await firstPage(bot);
    bot.elapse(HISTORY_TTL_MS - 1);
    expect(bot.disables).toEqual([]);
    expect((await bot.pressHistory('msg-1', 'mbrg:hs:n:2', ASKER)).type).toBe('channel');
    bot.elapse(1);
    expect(bot.disables).toEqual([{ channelId: CHANNEL, messageId: 'msg-1' }]);
    expect(await bot.pressHistory('msg-1', 'mbrg:hs:n:3', ASKER)).toEqual({ type: 'text', text: STRINGS.historyExpired });
    expect(reads(fake)).toHaveLength(2);
  });

  it('FR-555 paging does not extend the five minutes: the expiry is the one of the posting', async () => {
    const { bot } = await world();
    await firstPage(bot);
    bot.elapse(HISTORY_TTL_MS - 10_000);
    await bot.pressHistory('msg-1', 'mbrg:hs:n:2', ASKER);
    bot.elapse(10_000);
    expect(bot.disables).toEqual([{ channelId: CHANNEL, messageId: 'msg-1' }]);
    expect(await bot.pressHistory('msg-1', 'mbrg:hs:p:1', ASKER)).toEqual({ type: 'text', text: STRINGS.historyExpired });
  });

  it('FR-555 after a restart the walks are gone: a press on an old message is answered as expired and asks the server nothing', async () => {
    const { fake, bot, state } = await world();
    await firstPage(bot);
    bot.stop();
    const restarted = boot(fake, state.path);
    bots.push(restarted);
    const before = reads(fake).length;
    expect(await restarted.pressHistory('msg-1', 'mbrg:hs:n:2', ASKER)).toEqual({ type: 'text', text: STRINGS.historyExpired });
    expect(reads(fake)).toHaveLength(before);
  });

  it('FR-555 a failed disable edit is ignored: the press is still refused as expired', async () => {
    const { bot } = await world();
    await firstPage(bot);
    bot.failDisables = true;
    bot.elapse(HISTORY_TTL_MS);
    expect(await bot.pressHistory('msg-1', 'mbrg:hs:n:2', ASKER)).toEqual({ type: 'text', text: STRINGS.historyExpired });
  });
});

describe('FR-555 a press the server cannot answer', () => {
  it('FR-555 an outage or a refusal on Next is one private sentence, one request and no retry; the walk and the message stay as they were', async () => {
    const { fake, bot } = await world();
    await firstPage(bot);
    const walk = bot.boards.lookupHistory('msg-1');
    fake.historyError = { status: 503, body: { kind: 'unavailable' } };
    expect(await bot.pressHistory('msg-1', 'mbrg:hs:n:2', ASKER)).toEqual({ type: 'text', text: STRINGS.historyUnavailable });
    expect(reads(fake)).toHaveLength(2);
    fake.down = true;
    expect(await bot.pressHistory('msg-1', 'mbrg:hs:n:2', ASKER)).toEqual({ type: 'text', text: STRINGS.historyUnavailable });
    expect(reads(fake)).toHaveLength(3);
    expect(bot.boards.lookupHistory('msg-1')).toEqual(walk);
    fake.down = false;
    fake.historyError = undefined;
    expect(messageOf(await bot.pressHistory('msg-1', 'mbrg:hs:n:2', ASKER)).embed?.footer).toBe('Página 2/3');
  });
});
