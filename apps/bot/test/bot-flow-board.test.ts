import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOARD_TTL_MS } from '../src/core/board';
import { boardId, mineId } from '../src/core/custom-ids';
import type { ButtonSpec, OutMessage, Reply } from '../src/core/model';
import { STRINGS } from '../src/core/strings';
import { MATCH_ID, startFake } from './helpers/fake-server';
import type { Fake } from './helpers/fake-server';
import { CHANNEL, MANAGER, boot, manager, tempState, waitFor } from './helpers/harness';
import type { Bot } from './helpers/harness';
import { FULL_JOURNEY, applyRound1, finishRound2, revealRound1, revealRound2Forced } from './helpers/journey';

// Flow tests wait on real sockets: under CI load the default 5 s test limit is too tight.
vi.setConfig({ testTimeout: 30_000 });

const ASKER = { channelId: CHANNEL, userId: '822' };
const OTHER = { channelId: CHANNEL, userId: '803' };
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ rank: i + 1, playerId: `discord:${800 + i}`, total: 100 - i }));

const fakes: Fake[] = [];
const bots: Bot[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const bot of bots.splice(0)) bot.stop();
  for (const fake of fakes.splice(0)) await fake.close();
  for (const clean of cleanups.splice(0)) clean();
});

async function world() {
  const fake = await startFake();
  fakes.push(fake);
  const state = tempState();
  cleanups.push(state.remove);
  const bot = boot(fake, state.path);
  bots.push(bot);
  expect((await bot.run(manager())).type).toBe('channel');
  await waitFor(() => fake.streamCount() === 1);
  return { fake, bot, statePath: state.path };
}

const only = (reply: Reply): OutMessage => {
  if (reply.type !== 'channel' || reply.messages.length !== 1) throw new Error(`expected one channel message, got ${reply.type}`);
  return reply.messages[0] as OutMessage;
};
const buttonId = (m: OutMessage, label: string): string => {
  const b = m.buttons.find((x): x is Extract<ButtonSpec, { type: 'custom' }> => x.type === 'custom' && x.label === label);
  if (b === undefined) throw new Error(`no button ${label}`);
  return b.customId;
};
const lineCount = (m: OutMessage): number => (m.embed?.description ?? '').split('\n').length;
const leaderboardReads = (fake: Fake): number => fake.requests.filter((r) => r.path.includes('/leaderboard')).length;

describe('FR-477 /mbrg board', () => {
  it('FR-477 replies with a leaderboard embed of 10 rows, Página 1/3, Previous and Next, reading every page of the server', async () => {
    const { fake, bot } = await world();
    fake.leaderboard = rows(25);
    fake.pageSize = 10;
    const m = only(await bot.run({ type: 'board' }, ASKER));
    expect(m.embed?.title).toBe(STRINGS.boardTitle);
    expect(lineCount(m)).toBe(10);
    expect(m.embed?.description).toContain('1. <@800> - 100 pts');
    expect(m.embed?.footer).toBe('Página 1/3');
    expect(m.buttons.map((b) => b.type === 'custom' && [b.label, b.disabled === true])).toEqual([['Anterior', true], ['Siguiente', false]]);
    expect(leaderboardReads(fake)).toBe(3);
    // FR-479: the asker (outside this page) still sees their own rank and points.
    expect(m.embed?.fields).toEqual([{ name: 'Tu puesto', value: '23. <@822> - 78 pts' }]);
    // FR-482: no link to the viewer any more.
    expect(JSON.stringify(m)).not.toContain('http');
    expect(JSON.stringify(m)).not.toContain('completa');
  });

  it('FR-477 a member with no points is told so, and an empty board is one embed with no buttons', async () => {
    const { fake, bot } = await world();
    fake.leaderboard = rows(3);
    expect(only(await bot.run({ type: 'board' }, { channelId: CHANNEL, userId: '999' })).embed?.fields).toEqual([{ name: 'Tu puesto', value: STRINGS.boardOwnNone }]);
    fake.leaderboard = [];
    const empty = only(await bot.run({ type: 'board' }, ASKER));
    expect(empty.embed?.description).toBe(STRINGS.boardEmpty);
    expect(empty.buttons).toEqual([]);
    expect(empty.board).toBeUndefined();
  });

  it('FR-477 a server that is down gives a private sentence, not a board', async () => {
    const { fake, bot } = await world();
    fake.down = true;
    expect(await bot.run({ type: 'board' }, ASKER)).toEqual({ type: 'text', text: STRINGS.serverDown });
  });
});

describe('FR-480 only the asker pages', () => {
  it('FR-480 the asker pages in place, forward and back; each press reads the board again', async () => {
    const { fake, bot } = await world();
    fake.leaderboard = rows(25);
    const first = only(await bot.run({ type: 'board' }, ASKER));
    bot.sent({ type: 'channel', messages: [first] }, 'board-msg');
    expect(bot.boards.lookup('board-msg')).toMatchObject({ matchId: MATCH_ID, askerId: '822' });
    const reads = leaderboardReads(fake);
    const second = only(await bot.press('board-msg', buttonId(first, 'Siguiente'), ASKER));
    expect(leaderboardReads(fake)).toBe(reads + 1);
    expect(second.embed?.footer).toBe('Página 2/3');
    expect(second.embed?.description).toContain('11. <@810> - 90 pts');
    expect(second.embed?.fields).toEqual(first.embed?.fields);
    expect(second.buttons.map((b) => b.type === 'custom' && b.disabled === true)).toEqual([false, false]);
    const third = only(await bot.press('board-msg', buttonId(second, 'Siguiente'), ASKER));
    expect(third.embed?.footer).toBe('Página 3/3');
    expect(third.buttons.map((b) => b.type === 'custom' && b.disabled === true)).toEqual([false, true]);
    const back = only(await bot.press('board-msg', buttonId(third, 'Anterior'), ASKER));
    expect(back.embed?.footer).toBe('Página 2/3');
  });

  it('FR-480 another member changes nothing: a private sentence, no read of the server', async () => {
    const { fake, bot } = await world();
    fake.leaderboard = rows(25);
    const first = only(await bot.run({ type: 'board' }, ASKER));
    bot.sent({ type: 'channel', messages: [first] }, 'board-msg');
    const reads = leaderboardReads(fake);
    expect(await bot.press('board-msg', buttonId(first, 'Siguiente'), OTHER)).toEqual({ type: 'text', text: STRINGS.boardNotYours });
    expect(leaderboardReads(fake)).toBe(reads);
    expect(bot.posts).toEqual([]);
  });

  it('edge: the board changed while a page was open: the page is clamped to the new count', async () => {
    const { fake, bot } = await world();
    fake.leaderboard = rows(25);
    const first = only(await bot.run({ type: 'board' }, ASKER));
    bot.sent({ type: 'channel', messages: [first] }, 'board-msg');
    const third = only(await bot.press('board-msg', buttonId(only(await bot.press('board-msg', buttonId(first, 'Siguiente'), ASKER)), 'Siguiente'), ASKER));
    expect(third.embed?.footer).toBe('Página 3/3');
    fake.leaderboard = rows(12);
    const next = only(await bot.press('board-msg', buttonId(third, 'Siguiente'), ASKER));
    expect(next.embed?.footer).toBe('Página 2/2');
    expect(lineCount(next)).toBe(2);
  });

  it('edge: a single page has both buttons disabled and is not registered', async () => {
    const { fake, bot } = await world();
    fake.leaderboard = rows(4);
    const m = only(await bot.run({ type: 'board' }, ASKER));
    expect(m.buttons.every((b) => b.type === 'custom' && b.disabled === true)).toBe(true);
    bot.sent({ type: 'channel', messages: [m] }, 'board-msg');
    expect(bot.boards.lookup('board-msg')).toBeUndefined();
  });
});

describe('FR-481 five minutes', () => {
  it('FR-481 five minutes after it was posted the buttons are disabled with one edit, and a press says it expired', async () => {
    const { fake, bot } = await world();
    fake.leaderboard = rows(25);
    const first = only(await bot.run({ type: 'board' }, ASKER));
    bot.sent({ type: 'channel', messages: [first] }, 'board-msg');
    bot.elapse(BOARD_TTL_MS - 1);
    expect(bot.disables).toEqual([]);
    expect((await bot.press('board-msg', buttonId(first, 'Siguiente'), ASKER)).type).toBe('channel');
    bot.elapse(1);
    expect(bot.disables).toEqual([{ channelId: CHANNEL, messageId: 'board-msg' }]);
    bot.elapse(10 * BOARD_TTL_MS);
    expect(bot.disables).toHaveLength(1);
    expect(await bot.press('board-msg', buttonId(first, 'Siguiente'), ASKER)).toEqual({ type: 'text', text: STRINGS.boardExpired });
  });

  it('FR-481 a failed edit is ignored; a press before the edit lands but after the five minutes is still refused', async () => {
    const { fake, bot } = await world();
    fake.leaderboard = rows(25);
    const first = only(await bot.run({ type: 'board' }, ASKER));
    bot.sent({ type: 'channel', messages: [first] }, 'board-msg');
    bot.clock += BOARD_TTL_MS;
    expect(await bot.press('board-msg', buttonId(first, 'Siguiente'), ASKER)).toEqual({ type: 'text', text: STRINGS.boardExpired });
    bot.failDisables = true;
    expect(() => bot.elapse(1)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(bot.disables).toEqual([]);
  });

  it('edge: after a bot restart an old leaderboard button is answered as expired', async () => {
    const { fake, bot, statePath } = await world();
    fake.leaderboard = rows(25);
    const first = only(await bot.run({ type: 'board' }, ASKER));
    bot.sent({ type: 'channel', messages: [first] }, 'board-msg');
    bot.stop();
    const second = boot(fake, statePath);
    bots.push(second);
    expect(await second.press('board-msg', buttonId(first, 'Siguiente'), ASKER)).toEqual({ type: 'text', text: STRINGS.boardExpired });
  });
});

describe('FR-478 and FR-480 the final post', () => {
  async function finished() {
    const w = await world();
    w.fake.leaderboard = rows(25);
    expect((await w.bot.run({ type: 'start', canManage: true, userId: MANAGER.userId })).type).toBe('text');
    await waitFor(() => w.bot.posts.length === 1);
    revealRound1(w.fake);
    applyRound1(w.fake);
    revealRound2Forced(w.fake);
    finishRound2(w.fake);
    await waitFor(() => w.bot.posts.length === FULL_JOURNEY.length + 1);
    const board = w.bot.posts[FULL_JOURNEY.length]?.message as OutMessage;
    return { ...w, board, messageId: `message-${w.bot.posts.length}` };
  }

  it('FR-478 the winner embed is followed by the public leaderboard embed, page 1, with the same buttons', async () => {
    const { bot, board } = await finished();
    expect(bot.posts[FULL_JOURNEY.length - 1]?.message.embed?.fields[0]?.name).toBe('Ganadora');
    expect(board.embed?.title).toBe(STRINGS.boardTitle);
    expect(board.embed?.footer).toBe('Página 1/3');
    expect(lineCount(board)).toBe(10);
    expect(board.buttons.map((b) => b.type === 'custom' && b.label)).toEqual(['Anterior', 'Siguiente']);
    expect(board.embed?.fields).toEqual([]);
  });

  it('FR-480 the final post is registered with no asker: any member gets their own private page and the public message never changes', async () => {
    const { bot, board, messageId } = await finished();
    expect(bot.boards.lookup(messageId)).toMatchObject({ matchId: MATCH_ID });
    expect(bot.boards.lookup(messageId)?.askerId).toBeUndefined();
    const before = JSON.stringify(bot.posts);
    const editsBefore = bot.edits.length;
    const mine = only(await bot.press(messageId, buttonId(board, 'Siguiente'), ASKER));
    expect(mine.embed?.footer).toBe('Página 2/3');
    expect(mine.embed?.fields).toEqual([{ name: 'Tu puesto', value: '23. <@822> - 78 pts' }]);
    const theirs = only(await bot.press(messageId, buttonId(board, 'Siguiente'), OTHER));
    expect(theirs.embed?.fields).toEqual([{ name: 'Tu puesto', value: '4. <@803> - 97 pts' }]);
    expect(JSON.stringify(bot.posts)).toBe(before);
    expect(bot.edits).toHaveLength(editsBefore);
    // The private page pages by itself: its ids carry the match, and it shows its presser's line on every page.
    expect(buttonId(mine, 'Siguiente')).toBe(mineId('n', 3, MATCH_ID));
    expect(buttonId(mine, 'Anterior')).toBe(mineId('p', 1, MATCH_ID));
    const further = only(await bot.run({ type: 'board-press', customId: buttonId(mine, 'Siguiente'), userId: ASKER.userId, entry: undefined, now: bot.clock }, ASKER));
    expect(further.embed?.footer).toBe('Página 3/3');
    expect(further.embed?.fields).toEqual(mine.embed?.fields);
  });

  it('FR-481 the final post is disabled after five minutes too', async () => {
    const { bot, board, messageId } = await finished();
    bot.elapse(BOARD_TTL_MS);
    expect(bot.disables).toEqual([{ channelId: CHANNEL, messageId }]);
    expect(await bot.press(messageId, buttonId(board, 'Siguiente'), OTHER)).toEqual({ type: 'text', text: STRINGS.boardExpired });
  });

  it('FR-478 with the board button ids that the bot built, an id of the public message is the one the press carries', async () => {
    const { board } = await finished();
    expect(buttonId(board, 'Siguiente')).toBe(boardId('n', 2));
  });
});
