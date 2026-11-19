import { existsSync, readFileSync } from 'node:fs';
import type { HistoryEntry } from '@mbrg/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Reply } from '../src/core/model';
import { STRINGS } from '../src/core/strings';
import { EPHEMERAL, fromCommand, replyPayload } from '../src/discord/translate';
import { CREDENTIAL, startFake } from './helpers/fake-server';
import type { Fake } from './helpers/fake-server';
import { CHANNEL, GUILD_A, GUILD_B, KEY_A, KEY_B, boot, tempState } from './helpers/harness';
import type { Bot } from './helpers/harness';

// Spec 024 FR-554, FR-556 to FR-558, FR-573: `/mbrg history` from the Discord interaction to the reply, with the real bot core against the fake server.

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

const entry = (n: number, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  matchId: `match-${String(n).padStart(3, '0')}`, mapId: 'europe', finishedAt: 1_800_000_000_000 - n * 60_000, winner: 3, playerCount: 3,
  top: [{ playerId: 'discord:111', points: 9, rank: 1 }, { playerId: 'discord:222', points: 4, rank: 2 }], more: 0, ...over,
});

async function world() {
  const fake = await startFake();
  fakes.push(fake);
  fake.history.set(KEY_A, [entry(1, { asker: { points: 4, rank: 2 } }), entry(2, { asker: { played: false } }), entry(3, { top: [], more: 0, asker: { points: 0, rank: 1 } })]);
  const state = tempState();
  cleanups.push(state.remove);
  const bot = boot(fake, state.path, { viewerUrl: 'https://viewer.example/' });
  bots.push(bot);
  return { fake, bot, state };
}
const command = (guildId: string | null) => fromCommand('history', {}, false, ASKER.userId, guildId)!;
const reads = (fake: Fake) => fake.requests.filter((r) => r.path === '/history');

describe('FR-554 the history command', () => {
  it('FR-554 a member of a server gets page 1 of THEIR server for their own local id: one read, the embed, the asker lines and the viewer links', async () => {
    const { fake, bot } = await world();
    const reply = await bot.run(command(GUILD_A), ASKER);
    expect(reply.type).toBe('channel');
    const message = (reply as Extract<Reply, { type: 'channel' }>).messages[0]!;
    expect(message.embed?.title).toBe('Partidas terminadas');
    expect(message.embed?.footer).toBe('Página 1/1');
    expect(message.embed?.fields.map((f) => f.value.split('\n').slice(-2))).toEqual([
      ['Tus puntos: 4 (puesto 2)', '[Ver en el visor](https://viewer.example/?match=match-001&spectate=1)'],
      ['No jugaste esta partida', '[Ver en el visor](https://viewer.example/?match=match-002&spectate=1)'],
      ['Tus puntos: 0 (puesto 1)', '[Ver en el visor](https://viewer.example/?match=match-003&spectate=1)'],
    ]);
    expect(message.embed?.fields[2]?.value).toContain('Nadie sumó puntos');
    expect(reads(fake)).toHaveLength(1);
    expect(reads(fake)[0]!.body).toEqual({ community: KEY_A, playerId: ASKER.userId, limit: 5 });
  });

  it('FR-554 NFR-119 another server sees only its own history: the key of the interaction decides, never the channel', async () => {
    const { fake, bot } = await world();
    const reply = await bot.run(command(GUILD_B), ASKER);
    expect(reply).toMatchObject({ type: 'channel', messages: [{ text: STRINGS.historyEmpty, buttons: [] }] });
    expect(reads(fake)[0]!.body).toMatchObject({ community: KEY_B });
  });

  it('FR-556 a server with no finished match gets one public sentence, no embed and no buttons', async () => {
    const { bot } = await world();
    const reply = await bot.run(command(GUILD_B), ASKER);
    const message = (reply as Extract<Reply, { type: 'channel' }>).messages[0]!;
    expect(message.text).toBe('Este servidor todavía no tiene partidas terminadas.');
    expect(message.embed).toBeUndefined();
    expect(message.buttons).toEqual([]);
    expect(replyPayload(reply, false)[0]).not.toHaveProperty('flags');
    expect(replyPayload(reply, false)[0]).not.toHaveProperty('components');
  });
});

describe('FR-557 an interaction without a server', () => {
  it('FR-557 the history command arriving without a server is refused privately with one sentence and nothing is sent to the server', async () => {
    const { fake, bot } = await world();
    const reply = await bot.run(command(null), ASKER);
    expect(reply).toEqual({ type: 'text', text: STRINGS.noServer });
    expect(fake.requests).toHaveLength(0);
  });
});

describe('FR-558 the server cannot answer', () => {
  it('FR-558 a refusal of any kind, or an outage, is one private "unavailable" sentence and one request: the bot never loops', async () => {
    const { fake, bot } = await world();
    for (const error of [
      { status: 403, body: { kind: 'forbidden' } },
      { status: 400, body: { kind: 'invalid-request', items: ['community'] } },
      { status: 429, body: { kind: 'rate-limited', retryAfter: 1 } },
      { status: 503, body: { kind: 'unavailable' } },
      { status: 500, body: 'not json at all' },
    ]) {
      fake.historyError = error;
      const before = reads(fake).length;
      const reply = await bot.run(command(GUILD_A), ASKER);
      expect(reply, JSON.stringify(error.body)).toEqual({ type: 'text', text: STRINGS.historyUnavailable });
      expect(reads(fake)).toHaveLength(before + 1);
    }
    fake.historyError = undefined;
    fake.down = true;
    const before = reads(fake).length;
    expect(await bot.run(command(GUILD_A), ASKER)).toEqual({ type: 'text', text: STRINGS.historyUnavailable });
    expect(reads(fake)).toHaveLength(before + 1);
    // The sentence is a text reply: the shell sends it privately.
    expect(replyPayload({ type: 'text', text: STRINGS.historyUnavailable }, true)[0]?.flags).toBe(EPHEMERAL);
  });

  it('FR-558 an answer the bot cannot read is "unavailable" too', async () => {
    const { fake, bot } = await world();
    fake.historyError = { status: 200, body: { items: [{ matchId: 'x' }], total: 1 } };
    expect(await bot.run(command(GUILD_A), ASKER)).toEqual({ type: 'text', text: STRINGS.historyUnavailable });
    expect(reads(fake)).toHaveLength(1);
  });
});

describe('FR-573 NFR-118 what travels and what is logged', () => {
  it('FR-573 the key and the asker travel in the body with the credential; the path holds nothing of them and nothing is stored or logged', async () => {
    const { fake, bot, state } = await world();
    const reply = await bot.run(command(GUILD_A), ASKER);
    const [request] = reads(fake);
    expect(request).toMatchObject({ method: 'POST', path: '/history', bearer: CREDENTIAL });
    expect(request!.path).not.toContain(KEY_A);
    expect(request!.path).not.toContain(ASKER.userId);
    expect(request!.path).not.toContain('?');
    expect(JSON.stringify(request!.body)).toContain(KEY_A);
    expect(JSON.stringify(request!.body)).toContain(ASKER.userId);
    // Neither the raw guild id nor the key nor the asker is in a log line, a post or the state file.
    const stateText = existsSync(state.path) ? readFileSync(state.path, 'utf8') : '';
    const kept = JSON.stringify([bot.logs, bot.posts]) + stateText;
    for (const secret of [GUILD_A, KEY_A, ASKER.userId]) expect(kept, secret).not.toContain(secret);
    // What goes to Discord holds no key and no guild id either.
    const payload = JSON.stringify(replyPayload(reply, false, { mode: 'embed' }));
    for (const secret of [GUILD_A, KEY_A]) expect(payload, secret).not.toContain(secret);
  });

  it('FR-573 the key is in no log line, even when the server fails: only closed codes are logged', async () => {
    const { fake, bot } = await world();
    fake.historyError = { status: 500, body: { kind: 'unavailable' } };
    await bot.run(command(GUILD_A), ASKER);
    fake.historyError = undefined;
    fake.down = true;
    await bot.run(command(GUILD_A), ASKER);
    expect(JSON.stringify(bot.logs)).not.toContain(KEY_A);
    expect(bot.logs.every((line) => /^[a-z-]+$/.test(line))).toBe(true);
  });
});
