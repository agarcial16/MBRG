import { afterEach, describe, expect, it, vi } from 'vitest';
import { START_ID } from '../src/core/custom-ids';
import type { Reply } from '../src/core/model';
import { STRINGS } from '../src/core/strings';
import { MATCH_ID, startFake } from './helpers/fake-server';
import type { Fake } from './helpers/fake-server';
import { fakeService } from './helpers/fake-capture';
import type { FakeService } from './helpers/fake-capture';
import { CHANNEL, MANAGER, boot, manager, tempState, waitFor } from './helpers/harness';
import type { Bot } from './helpers/harness';
import { TEXTS, applyRound1, finishRound2, revealRound1, revealRound2Forced } from './helpers/journey';

// Spec 038 flows against the fake server and a fake capture service: the image edit, the failure paths, the map command.
vi.setConfig({ testTimeout: 30_000 });

const fakes: Fake[] = [];
const bots: Bot[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const bot of bots.splice(0)) bot.stop();
  for (const fake of fakes.splice(0)) await fake.close();
  for (const clean of cleanups.splice(0)) clean();
});

async function world(capture: FakeService | 'off' = fakeService()) {
  const fake = await startFake();
  fakes.push(fake);
  const state = tempState();
  cleanups.push(state.remove);
  const bot = boot(fake, state.path, capture === 'off' ? {} : { capture });
  bots.push(bot);
  await bot.run(manager());
  await waitFor(() => fake.streamCount() === 1);
  await bot.run({ type: 'button', customId: START_ID, canManage: true, userId: MANAGER.userId });
  await waitFor(() => bot.posts.length === 1);
  return { fake, bot, capture: capture as FakeService };
}

const imageEdits = (bot: Bot) => bot.edits.filter((e) => e.message.image !== undefined);
const textOf = (reply: Reply): string => (reply.type === 'text' ? reply.text : `<${reply.type}>`);

describe('FR-717 FR-718 the round image', () => {
  it('FR-717 the announcement of round k is posted first and the image of round k is added to it by an edit', async () => {
    const { fake, bot, capture } = await world();
    capture.hold = true;
    revealRound1(fake);
    applyRound1(fake);
    await waitFor(() => bot.posts.some((p) => p.message.text === TEXTS.applied1));
    // FR-718: posted without waiting for the capture.
    expect(imageEdits(bot)).toHaveLength(0);
    expect(capture.requests).toStrictEqual([{ matchId: MATCH_ID, mapId: 'europe', round: 1, frame: 'round' }]);
    capture.release();
    await waitFor(() => imageEdits(bot).length === 1);
    const edit = imageEdits(bot)[0]!;
    const index = bot.posts.findIndex((p) => p.message.text === TEXTS.applied1);
    expect(edit.messageId).toBe(`message-${index + 1}`);
    expect(edit.channelId).toBe(CHANNEL);
    expect(edit.message.image?.name).toBe('round-1.png');
    expect(edit.message.image?.data).toStrictEqual(new Uint8Array([137, 80, 78, 71, 1]));
    // The announcement is the same one with the image; the bot adds no text of its own.
    expect(edit.message.text).toBe(TEXTS.applied1);
    expect(edit.message.embed).toStrictEqual(bot.posts[index]!.message.embed);
  });

  it('FR-717 only round-applied events ask for an image, each for its own round, after the round was revealed to the service', async () => {
    const { fake, bot, capture } = await world();
    revealRound1(fake);
    applyRound1(fake);
    revealRound2Forced(fake);
    finishRound2(fake);
    await waitFor(() => bot.posts.some((p) => p.message.text === TEXTS.finished));
    await waitFor(() => imageEdits(bot).length === 2);
    expect(capture.requests.map((r) => [r.round, r.frame])).toStrictEqual([[1, 'round'], [2, 'round']]);
    // FR-719: every request was announced as revealed before it was made, and never above the revealed round.
    expect(capture.revealed.map((r) => r.round)).toStrictEqual([1, 2]);
    expect(imageEdits(bot).map((e) => e.message.image?.name)).toStrictEqual(['round-1.png', 'round-2.png']);
  });

  it('FR-718 a capture that fails leaves the announcement as it is: no edit, no error text in the channel', async () => {
    const { fake, bot, capture } = await world();
    capture.mode = 'none';
    revealRound1(fake);
    applyRound1(fake);
    await waitFor(() => bot.posts.some((p) => p.message.text === TEXTS.winners1b));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(imageEdits(bot)).toHaveLength(0);
    expect(bot.posts.map((p) => p.message.text).join('\n')).not.toContain(STRINGS.mapUnavailable);
    expect(bot.posts.map((p) => p.message.text)).toContain(TEXTS.applied1);
  });

  it('FR-718 an edit Discord refuses leaves the announcement as it is and is logged', async () => {
    const { fake, bot } = await world();
    bot.failEdits = true;
    revealRound1(fake);
    applyRound1(fake);
    await waitFor(() => bot.logs.includes('image-edit-failed'));
    expect(imageEdits(bot)).toHaveLength(0);
    expect(bot.posts.map((p) => p.message.text)).toContain(TEXTS.applied1);
  });

  it('FR-726 with no capture service the announcements are as before: nothing is requested, no edit carries an image', async () => {
    const { fake, bot } = await world('off');
    revealRound1(fake);
    applyRound1(fake);
    await waitFor(() => bot.posts.some((p) => p.message.text === TEXTS.winners1b));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(imageEdits(bot)).toHaveLength(0);
  });
});

describe('FR-720 FR-721 FR-722 the map command', () => {
  it('FR-720 answers the member with the full map of the last revealed round, as an image and nothing else', async () => {
    const { fake, bot, capture } = await world();
    revealRound1(fake);
    applyRound1(fake);
    await waitFor(() => bot.posts.some((p) => p.message.text === TEXTS.winners1b));
    await waitFor(() => bot.store.get(CHANNEL)?.appliedRounds === 1);
    const reply = await bot.run({ type: 'map' });
    expect(reply).toStrictEqual({ type: 'image', image: { name: 'map-1.png', data: new Uint8Array([137, 80, 78, 71, 1]) } });
    expect(capture.requests.at(-1)).toStrictEqual({ matchId: MATCH_ID, mapId: 'europe', round: 1, frame: 'full' });
  });

  it('FR-721 no round revealed yet: the starting map, round 0', async () => {
    const { bot, capture } = await world();
    const reply = await bot.run({ type: 'map' });
    expect(reply.type).toBe('image');
    expect(capture.requests.at(-1)).toMatchObject({ round: 0, frame: 'full' });
  });

  it('FR-721 a channel with no followed match gets one private sentence and nothing is captured', async () => {
    const fake = await startFake();
    fakes.push(fake);
    const state = tempState();
    cleanups.push(state.remove);
    const capture = fakeService();
    const bot = boot(fake, state.path, { capture });
    bots.push(bot);
    expect(textOf(await bot.run({ type: 'map' }))).toBe(STRINGS.notFollowing);
    expect(capture.requests).toHaveLength(0);
  });

  it('FR-722 a capture that fails: one private sentence that the map is not available', async () => {
    const { bot, capture } = await world();
    capture.mode = 'none';
    expect(textOf(await bot.run({ type: 'map' }))).toBe(STRINGS.mapUnavailable);
  });

  it('FR-726 with images off the command says the map is not available', async () => {
    const { bot } = await world('off');
    expect(textOf(await bot.run({ type: 'map' }))).toBe(STRINGS.mapUnavailable);
  });
});
