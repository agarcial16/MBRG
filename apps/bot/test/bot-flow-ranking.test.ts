import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STRINGS } from '../src/core/strings';
import { EPHEMERAL, fromCommand, replyPayload } from '../src/discord/translate';
import { CREDENTIAL, startFake } from './helpers/fake-server';
import type { Fake } from './helpers/fake-server';
import { CHANNEL, GUILD_A, GUILD_B, KEY_A, KEY_B, boot, tempState } from './helpers/harness';
import type { Bot } from './helpers/harness';

// Spec 025 FR-569 (the command part), FR-571, FR-573 of 024: `/mbrg ranking` from the Discord interaction to the request and the failure, with the real
// bot core against the fake server.

vi.setConfig({ testTimeout: 60_000 });

const ASKER = { channelId: CHANNEL, userId: '900000000000000001' };
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
  return { fake, bot, state };
}
const command = (guildId: string | null, order?: string) => fromCommand('ranking', order === undefined ? {} : { order }, false, ASKER.userId, guildId)!;
const reads = (fake: Fake) => fake.requests.filter((r) => r.path === '/ranking');

describe('FR-569 the ranking command asks the server for its own server and the asker', () => {
  it('FR-569 FR-573 one request with the key, the order of the word, the asker and the page size in the body and the credential; nothing in the path', async () => {
    const { fake, bot } = await world();
    for (const [word, wire] of [[undefined, 'points'], ['puntos', 'points'], ['aciertos', 'correct'], ['victorias', 'wins'], ['precisión', 'accuracy']] as const) {
      const before = reads(fake).length;
      await bot.run(command(GUILD_A, word), ASKER);
      expect(reads(fake), String(word)).toHaveLength(before + 1);
      const request = reads(fake)[before]!;
      expect(request).toMatchObject({ method: 'POST', path: '/ranking', bearer: CREDENTIAL, body: { community: KEY_A, order: wire, playerId: ASKER.userId, limit: 10 } });
      expect(Object.keys(request.body as object).sort()).toEqual(['community', 'limit', 'order', 'playerId']);
      expect(request.path).not.toContain(KEY_A);
      expect(request.path).not.toContain(ASKER.userId);
    }
  });

  it('FR-569 NFR-119 another server asks for its own key: the interaction decides, never the channel', async () => {
    const { fake, bot } = await world();
    await bot.run(command(GUILD_B), ASKER);
    expect(reads(fake)[0]!.body).toMatchObject({ community: KEY_B });
  });

  it('FR-569 a word that is not an order sends nothing to the server and is answered with one sentence', async () => {
    const { fake, bot } = await world();
    expect(await bot.run(command(GUILD_A, 'nada'), ASKER)).toEqual({ type: 'text', text: STRINGS.unknownOrder });
    expect(fake.requests).toHaveLength(0);
  });
});

describe('FR-571 an interaction without a server', () => {
  it('FR-571 the ranking command arriving without a server is refused with one sentence and nothing is sent to the server', async () => {
    const { fake, bot } = await world();
    expect(await bot.run(command(null), ASKER)).toEqual({ type: 'text', text: STRINGS.noServer });
    expect(fake.requests).toHaveLength(0);
  });
});

describe('FR-571 the server cannot answer', () => {
  it('FR-571 a refusal of any kind (an older server not knowing the route or the key included), or an outage, is one private "unavailable" sentence and one request: the bot never loops', async () => {
    const { fake, bot } = await world();
    for (const error of [
      { status: 403, body: { kind: 'forbidden' } },
      { status: 404, body: { kind: 'unknown-path' } },
      { status: 400, body: { kind: 'invalid-request', items: ['community'] } },
      { status: 400, body: { kind: 'invalid-request', items: ['order'] } },
      { status: 429, body: { kind: 'rate-limited', retryAfter: 1 } },
      { status: 503, body: { kind: 'unavailable' } },
      { status: 500, body: 'not json at all' },
    ]) {
      fake.rankingError = error;
      const before = reads(fake).length;
      const reply = await bot.run(command(GUILD_A, 'puntos'), ASKER);
      expect(reply, JSON.stringify(error.body)).toEqual({ type: 'text', text: STRINGS.rankingUnavailable });
      expect(reads(fake)).toHaveLength(before + 1);
    }
    fake.rankingError = undefined;
    fake.down = true;
    const before = reads(fake).length;
    expect(await bot.run(command(GUILD_A), ASKER)).toEqual({ type: 'text', text: STRINGS.rankingUnavailable });
    expect(reads(fake)).toHaveLength(before + 1);
    // The sentence is a text reply: the shell sends it privately.
    expect(replyPayload({ type: 'text', text: STRINGS.rankingUnavailable }, true)[0]?.flags).toBe(EPHEMERAL);
  });

  it('FR-571 an answer the bot cannot read is "unavailable" too', async () => {
    const { fake, bot } = await world();
    fake.rankingError = { status: 200, body: { items: [{ playerId: 'x' }], total: 1 } };
    expect(await bot.run(command(GUILD_A), ASKER)).toEqual({ type: 'text', text: STRINGS.rankingUnavailable });
    expect(reads(fake)).toHaveLength(1);
  });
});

describe('FR-573 NFR-118 what travels and what is logged by the ranking command', () => {
  it('FR-573 neither the raw guild id nor the key nor the asker is in a log line, a post or the state file, whatever the answer', async () => {
    const { fake, bot, state } = await world();
    await bot.run(command(GUILD_A, 'victorias'), ASKER);
    fake.rankingError = { status: 500, body: { kind: 'unavailable' } };
    await bot.run(command(GUILD_A), ASKER);
    fake.rankingError = undefined;
    fake.down = true;
    await bot.run(command(GUILD_A), ASKER);
    const stateText = existsSync(state.path) ? readFileSync(state.path, 'utf8') : '';
    const kept = JSON.stringify([bot.logs, bot.posts]) + stateText;
    for (const secret of [GUILD_A, KEY_A, ASKER.userId]) expect(kept, secret).not.toContain(secret);
    expect(bot.logs.every((line) => /^[a-z-]+$/.test(line))).toBe(true);
    for (const request of fake.requests) expect(JSON.stringify(request), 'the raw guild id travels nowhere').not.toContain(GUILD_A);
  });
});
