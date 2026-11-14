import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STRINGS } from '../src/core/strings';
import { HOST_TOKEN, MATCH_ID, startFake } from './helpers/fake-server';
import type { Fake } from './helpers/fake-server';
import { CHANNEL, MANAGER, boot, manager, tempState, waitFor } from './helpers/harness';
import type { Bot, Posted } from './helpers/harness';
import { FULL_JOURNEY, TEXTS, applyRound1, finishRound2, revealRound1, revealRound2Forced } from './helpers/journey';

// Flow tests wait on real sockets: under CI load the default 5 s test limit is too tight.
vi.setConfig({ testTimeout: 30_000 });

const MEMBER = { channelId: CHANNEL, userId: '123123123123123123' };
const textOf = (reply: { type: string; text?: string }): string => (reply.type === 'text' ? (reply.text ?? '') : `<${reply.type}>`);
const texts = (posts: readonly Posted[]): string[] => posts.map((p) => p.message.text);

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
  return { fake, bot, statePath: state.path };
}

/** Creates the match in the channel and starts it as its creator. */
async function createAndStart(fake: Fake, bot: Bot, pace: 'fast' | 'normal' | 'slow' = 'normal'): Promise<void> {
  expect((await bot.run(manager({ pace }))).type).toBe('channel');
  await waitFor(() => fake.streamCount() === 1);
  const started = await bot.run({ type: 'button', customId: 'mbrg:start', canManage: false, userId: MANAGER.userId });
  expect(textOf(started)).toBe(STRINGS.started);
  await waitFor(() => bot.posts.length === 1);
}

const settle = (bot: Bot, edits: number) => waitFor(() => bot.edits.length === edits, 5_000, () => `${bot.edits.length} edits`);

describe('FR-465 countdown of the open phase', () => {
  it('FR-465 the open-phase message is edited every 5 seconds with the seconds left, keeping its buttons, and stops when the time is out', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    await waitFor(() => bot.ticker.active() === 1);
    expect(bot.ticker.periods).toEqual([5000]);
    for (const left of [25, 20, 15, 10, 5]) {
      const before = bot.edits.length;
      bot.ticker.fire();
      await settle(bot, before + 1);
      const last = bot.edits.at(-1);
      expect(last?.messageId).toBe('message-1');
      expect(last?.message.text).toBe(`${TEXTS.opened1}\nQuedan unos ${left} s.`);
      expect(last?.message.buttons).toEqual(bot.posts[0]?.message.buttons);
    }
    bot.ticker.fire();
    expect(bot.ticker.active()).toBe(0);
    expect(bot.edits).toHaveLength(5);
    // Only the seconds were added: no new message.
    expect(bot.posts).toHaveLength(1);
  });

  it('FR-465 the countdown follows the chosen pace (a slow phase 1 lasts 150 s)', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot, 'slow');
    expect(bot.store.get(CHANNEL)?.phases).toEqual({ l1: 150, l2: 5 });
    await waitFor(() => bot.ticker.active() === 1);
    bot.ticker.fire();
    await settle(bot, 1);
    expect(bot.edits[0]?.message.text).toContain('Quedan unos 145 s.');
  });

  it('FR-465 the countdown stops when the phase closes, and no timer is left once the match is over', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    await waitFor(() => bot.ticker.active() === 1);
    fake.emit({ type: 'phase-closed', round: 1, phase: 1, at: 31_000 });
    await waitFor(() => bot.ticker.active() === 0);
    bot.ticker.fire();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(bot.edits).toEqual([]);
    revealRound1(fake);
    applyRound1(fake);
    revealRound2Forced(fake);
    finishRound2(fake);
    await waitFor(() => bot.store.get(CHANNEL) === undefined);
    expect(bot.ticker.active()).toBe(0);
  });

  it('FR-465 the countdown stops when the stream drops, and when the channel stops following', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    await waitFor(() => bot.ticker.active() === 1);
    fake.down = true;
    fake.dropStreams();
    await waitFor(() => bot.logs.includes('stream-dropped'));
    expect(bot.ticker.active()).toBe(0);
    fake.down = false;
    await waitFor(() => fake.streamCount() === 1);
    revealRound1(fake);
    await waitFor(() => bot.posts.length === 3);
    // The victim reveal opened a phase 2 countdown (5 s long: it has no edit to make, but it runs until its first tick).
    expect(bot.ticker.active()).toBe(1);
    await bot.run({ type: 'stop', canManage: true });
    expect(bot.ticker.active()).toBe(0);
  });

  it('FR-465 a failed edit is ignored: no new message, no error, and the next tick tries again', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    await waitFor(() => bot.ticker.active() === 1);
    bot.failEdits = true;
    bot.ticker.fire();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(bot.edits).toEqual([]);
    expect(bot.posts).toHaveLength(1);
    bot.failEdits = false;
    bot.ticker.fire();
    await settle(bot, 1);
    expect(bot.edits[0]?.message.text).toContain('Quedan unos 20 s.');
  });

  it('FR-465 a state entry from before the countdown has no phase length: no countdown and nothing breaks', async () => {
    const { fake, bot } = await world();
    await bot.run(manager());
    const { phases: _phases, ...older } = bot.store.get(CHANNEL) as NonNullable<ReturnType<Bot['store']['get']>>;
    bot.store.set(CHANNEL, older);
    await waitFor(() => fake.streamCount() === 1);
    await bot.run({ type: 'start', canManage: true, userId: MANAGER.userId });
    await waitFor(() => bot.posts.length === 1);
    expect(bot.ticker.active()).toBe(0);
  });
});

describe('FR-466 last match', () => {
  it('FR-466 a finished match stays as the last one: no host token, no stream, and the board still reads its leaderboard', async () => {
    const { fake, bot, statePath } = await world();
    await createAndStart(fake, bot);
    revealRound1(fake);
    applyRound1(fake);
    revealRound2Forced(fake);
    finishRound2(fake);
    await waitFor(() => bot.posts.length === FULL_JOURNEY.length);
    await waitFor(() => bot.store.get(CHANNEL) === undefined);
    await waitFor(() => fake.streamCount() === 0);
    expect(bot.store.last(CHANNEL)).toEqual({ matchId: MATCH_ID, mapId: 'europe' });
    expect(readFileSync(statePath, 'utf8')).not.toContain(HOST_TOKEN);
    fake.leaderboard = [{ rank: 1, playerId: 'discord:801', total: 7 }];
    const reply = await bot.run({ type: 'board' }, MEMBER);
    expect(reply.type === 'channel' && reply.messages.map((m) => m.text).join('\n')).toContain('1. <@801> - 7 pts');
    expect(fake.requests.filter((r) => r.path.includes('/leaderboard')).at(-1)?.path).toContain(`/matches/${MATCH_ID}/`);
    // A restart opens no stream for a last match.
    const before = fake.requests.filter((r) => r.path.endsWith('/events')).length;
    bot.stop();
    const second = boot(fake, statePath, { posts: bot.posts });
    bots.push(second);
    second.follower.followAll();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fake.requests.filter((r) => r.path.endsWith('/events')).length).toBe(before);
    expect(second.store.last(CHANNEL)).toEqual({ matchId: MATCH_ID, mapId: 'europe' });
  });

  it('FR-466 stopping keeps the match as the last one without its host token, and a new create replaces it', async () => {
    const { fake, bot, statePath } = await world();
    await createAndStart(fake, bot);
    await bot.run({ type: 'stop', canManage: true });
    expect(bot.store.get(CHANNEL)).toBeUndefined();
    expect(bot.store.last(CHANNEL)).toEqual({ matchId: MATCH_ID, mapId: 'europe' });
    expect(readFileSync(statePath, 'utf8')).not.toContain(HOST_TOKEN);
    expect((await bot.run({ type: 'board' }, MEMBER)).type).toBe('channel');
    // Create is allowed when only a last match exists, and it replaces the last match.
    expect((await bot.run(manager({ map: 'asia' }))).type).toBe('channel');
    expect(bot.store.get(CHANNEL)?.matchId).toBe(MATCH_ID);
    expect(bot.store.last(CHANNEL)).toBeUndefined();
  });

  it('FR-466 a channel with no match at all says so when asked for the board', async () => {
    const { bot } = await world();
    expect(textOf(await bot.run({ type: 'board' }, MEMBER))).toBe(STRINGS.notFollowing);
  });

  it('FR-466 a halted match is kept as the last one too', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    fake.emit({ type: 'match-halted', round: 1, reason: 'map-changed', reportedTime: 5_000 }, { stage: 'halted' });
    await waitFor(() => bot.store.get(CHANNEL) === undefined);
    expect(bot.store.last(CHANNEL)).toEqual({ matchId: MATCH_ID, mapId: 'europe' });
  });
});

describe('FR-467 final leaderboard', () => {
  it('FR-467 the final leaderboard (first 10) is posted right after the winner message', async () => {
    const { fake, bot } = await world();
    fake.leaderboard = Array.from({ length: 12 }, (_, i) => ({ rank: i + 1, playerId: `discord:${800 + i}`, total: 50 - i }));
    await createAndStart(fake, bot);
    revealRound1(fake);
    applyRound1(fake);
    revealRound2Forced(fake);
    finishRound2(fake);
    await waitFor(() => bot.posts.length === FULL_JOURNEY.length + 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const all = texts(bot.posts);
    expect(all.slice(0, FULL_JOURNEY.length)).toEqual(FULL_JOURNEY);
    expect(all).toHaveLength(FULL_JOURNEY.length + 1);
    const board = all[FULL_JOURNEY.length] ?? '';
    expect(board).toContain('1. <@800> - 50 pts');
    expect(board).toContain('10. <@809> - 41 pts');
    expect(board).not.toContain('<@810>');
    expect(fake.requests.filter((r) => r.path.includes('/leaderboard')).at(-1)?.path).toContain('limit=10');
  });
});
