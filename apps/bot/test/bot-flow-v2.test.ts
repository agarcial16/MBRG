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
  it('FR-465 the first label shows the seconds at posting time; then one edit per second; at zero the Predict button is disabled and the timer stops', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    await waitFor(() => bot.ticker.active() === 1);
    expect(bot.ticker.periods).toEqual([1000]);
    // The schedule says C1 = 30 000 ms and the event reports 2 000 ms: 28 s left, already in the posted label.
    expect(bot.posts[0]?.message.buttons[0]).toMatchObject({ label: 'Predecir · 28 s' });
    for (let left = 27; left >= 1; left -= 1) {
      const before = bot.edits.length;
      bot.ticker.fire();
      await settle(bot, before + 1);
      const last = bot.edits.at(-1);
      expect(last?.messageId).toBe('message-1');
      // Only the label of the Predict button changes; the text is the one posted.
      expect(last?.message.text).toBe(TEXTS.opened1);
      expect(last?.message.buttons[0]).toMatchObject({ label: `Predecir · ${left} s` });
      expect(last?.message.buttons[0]).not.toHaveProperty('disabled');
    }
    // The tick that reaches zero edits once more: disabled and closed; then no timer.
    bot.ticker.fire();
    await settle(bot, 28);
    expect(bot.ticker.active()).toBe(0);
    const last = bot.edits.at(-1);
    expect(last?.messageId).toBe('message-1');
    expect(last?.message.text).toBe(TEXTS.opened1);
    expect(last?.message.buttons[0]).toMatchObject({ label: 'Predecir · cerrado', disabled: true });
    // No new message.
    expect(bot.posts).toHaveLength(1);
  });

  it('FR-465 the countdown comes from the server schedule, not from the chosen pace', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot, 'slow');
    await waitFor(() => bot.ticker.active() === 1);
    bot.ticker.fire();
    await settle(bot, 1);
    expect(bot.edits[0]?.message.buttons[0]).toMatchObject({ label: 'Predecir · 27 s' });
  });

  it('FR-465 phase 2 counts down too, from the C2 of the reveal, on the reveal message; a forced reveal has none', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    revealRound1(fake);
    await waitFor(() => bot.posts.length === 3);
    await waitFor(() => bot.ticker.active() === 1);
    // The reveal closed the phase 1 message.
    await settle(bot, 1);
    expect(bot.edits[0]?.messageId).toBe('message-1');
    expect(bot.edits[0]?.message.buttons[0]).toMatchObject({ label: 'Predecir · cerrado', disabled: true });
    // C2 = 60 000 ms, reported 31 000 ms: 29 s at receipt, already in the posted label.
    expect(bot.posts[1]?.message.buttons[0]).toMatchObject({ label: 'Predecir · 29 s' });
    bot.ticker.fire();
    await settle(bot, 2);
    expect(bot.edits[1]?.messageId).toBe('message-2');
    expect(bot.edits[1]?.message.text).toBe(TEXTS.reveal1);
    expect(bot.edits[1]?.message.buttons[0]).toMatchObject({ label: 'Predecir · 28 s' });
    applyRound1(fake);
    await waitFor(() => bot.posts.length === 6);
    // The round applied closed the phase-2 message (the scripted round-2 anchor is already past: no new countdown).
    await settle(bot, 3);
    expect(bot.edits[2]?.message.buttons[0]).toMatchObject({ label: 'Predecir · cerrado', disabled: true });
    expect(bot.ticker.active()).toBe(0);
    revealRound2Forced(fake);
    await waitFor(() => bot.posts.length === 8);
    expect(bot.ticker.active()).toBe(0);
  });

  it('FR-465 with no schedule in the event the button stays plain and no timer runs', async () => {
    const { fake, bot } = await world();
    await bot.run(manager());
    await waitFor(() => fake.streamCount() === 1);
    fake.emit({ type: 'schedule', stage: 'phase-1', reportedTime: 2000 }, { stage: 'phase-1' });
    await waitFor(() => bot.posts.length === 1);
    expect(bot.ticker.active()).toBe(0);
    expect(bot.posts[0]?.message.buttons[0]).toMatchObject({ label: 'Predecir' });
  });

  it('FR-465 an event that closes the phase disables the button once and stops the timer; no timer is left once the match is over', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    await waitFor(() => bot.ticker.active() === 1);
    fake.emit({ type: 'phase-closed', round: 1, phase: 1, at: 31_000 });
    await waitFor(() => bot.ticker.active() === 0);
    await settle(bot, 1);
    expect(bot.edits[0]?.messageId).toBe('message-1');
    expect(bot.edits[0]?.message.buttons[0]).toMatchObject({ label: 'Predecir · cerrado', disabled: true });
    // A late tick never re-enables or edits again.
    bot.ticker.fire();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(bot.edits).toHaveLength(1);
    revealRound1(fake);
    applyRound1(fake);
    revealRound2Forced(fake);
    finishRound2(fake);
    await waitFor(() => bot.store.get(CHANNEL) === undefined);
    expect(bot.ticker.active()).toBe(0);
  });

  it('FR-465 the countdown stops when the stream drops, without claiming the phase closed, and when the channel stops following', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    await waitFor(() => bot.ticker.active() === 1);
    fake.down = true;
    fake.dropStreams();
    await waitFor(() => bot.logs.includes('stream-dropped'));
    expect(bot.ticker.active()).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(bot.edits).toEqual([]);
    fake.down = false;
    await waitFor(() => fake.streamCount() === 1);
    revealRound1(fake);
    await waitFor(() => bot.posts.length === 3);
    // The victim reveal opened a phase 2 countdown.
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
    // The failed tick still counted its second.
    expect(bot.edits[0]?.message.buttons[0]).toMatchObject({ label: 'Predecir · 26 s' });
  });

  it('FR-465 a tick is skipped while the previous edit is still in flight: never more than one pending edit', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    await waitFor(() => bot.ticker.active() === 1);
    bot.slowEdits = true;
    bot.ticker.fire();
    bot.ticker.fire();
    bot.ticker.fire();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(bot.edits).toHaveLength(1);
    bot.slowEdits = false;
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
    await waitFor(() => bot.posts.length === FULL_JOURNEY.length + 1);
    await waitFor(() => bot.store.get(CHANNEL) === undefined);
    await waitFor(() => fake.streamCount() === 0);
    expect(bot.store.last(CHANNEL)).toEqual({ matchId: MATCH_ID, mapId: 'europe' });
    expect(readFileSync(statePath, 'utf8')).not.toContain(HOST_TOKEN);
    fake.leaderboard = [{ rank: 1, playerId: 'discord:801', total: 7 }];
    const reply = await bot.run({ type: 'board' }, MEMBER);
    expect(reply.type === 'channel' && reply.messages.map((m) => m.text).join('\n')).toContain('1. <@801> · 7 pts');
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
    expect(board).toContain('1. <@800> · 50 pts');
    expect(board).toContain('10. <@809> · 41 pts');
    expect(board).not.toContain('<@810>');
    // No viewer address set: no link.
    expect(board).not.toContain('http');
  });

  it('FR-482 the final post has no link to the full leaderboard any more, even with a viewer address, and no own-rank line', async () => {
    const fake = await startFake();
    fakes.push(fake);
    const state = tempState();
    cleanups.push(state.remove);
    const bot = boot(fake, state.path, { viewerUrl: 'https://viewer.example/' });
    bots.push(bot);
    fake.leaderboard = Array.from({ length: 12 }, (_, i) => ({ rank: i + 1, playerId: `discord:${800 + i}`, total: 50 - i }));
    await createAndStart(fake, bot);
    revealRound1(fake);
    applyRound1(fake);
    revealRound2Forced(fake);
    finishRound2(fake);
    await waitFor(() => bot.posts.length === FULL_JOURNEY.length + 1);
    const board = JSON.stringify(bot.posts[FULL_JOURNEY.length]?.message);
    expect(board).not.toContain('completa');
    expect(board).not.toContain('Clasificación completa');
    expect(board).not.toContain('Tu puesto');
    expect(board).not.toContain('match=');
  });
});
