import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { RankingRow } from '@mbrg/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STRINGS } from '../src/core/strings';
import { EPHEMERAL, fromCommand, replyPayload } from '../src/discord/translate';
import { createServerClient } from '../src/io/server-client';
import { CREDENTIAL, startFake } from './helpers/fake-server';
import type { Fake } from './helpers/fake-server';
import { CHANNEL, GUILD_A, GUILD_B, KEY_A, KEY_B, boot, tempState } from './helpers/harness';
import type { Bot } from './helpers/harness';

// Spec 027 FR-580 (the command part), FR-584, NFR-129 (the bot's all-time body): `/mbrg ranking` with a period from the Discord interaction to the
// request and the failure, with the real bot core against the fake server.

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

const rows: RankingRow[] = [{ playerId: 'discord:1001', points: 12, correct: 3, scored: 4, played: 1, won: 1, rank: 1 }];
async function world() {
  const fake = await startFake();
  fakes.push(fake);
  fake.ranking.set(KEY_A, { rows: { points: rows, correct: rows, wins: rows, accuracy: rows }, periods: { 'last-7-days': { rows: { points: rows, correct: rows, wins: rows, accuracy: rows } }, 'last-30-days': { rows: { points: rows, correct: rows, wins: rows, accuracy: rows } } } });
  const state = tempState();
  cleanups.push(state.remove);
  const bot = boot(fake, state.path);
  bots.push(bot);
  return { fake, bot, state };
}
const command = (guildId: string | null, order?: string, period?: string) =>
  fromCommand('ranking', { ...(order === undefined ? {} : { order }), ...(period === undefined ? {} : { period }) }, false, ASKER.userId, guildId)!;
const reads = (fake: Fake) => fake.requests.filter((r) => r.path === '/ranking');

describe('FR-580 (command part) the ranking command with a period asks the server for its own server, order and period', () => {
  it('FR-580 (command part) every period word and order word, in any combination, is one request with the wire period and the wire order in the body; nothing in the path', async () => {
    const { fake, bot } = await world();
    const orders = [[undefined, 'points'], ['puntos', 'points'], ['aciertos', 'correct'], ['victorias', 'wins'], ['precisión', 'accuracy']] as const;
    const periods = [['semana', 'last-7-days'], ['mes', 'last-30-days']] as const;
    for (const [period, wirePeriod] of periods) {
      for (const [word, wire] of orders) {
        const before = reads(fake).length;
        const reply = await bot.run(command(GUILD_A, word, period), ASKER);
        expect(reply.type, `${word} ${period}`).toBe('channel');
        expect(reads(fake), `${word} ${period}`).toHaveLength(before + 1);
        const request = reads(fake)[before]!;
        expect(request).toMatchObject({ method: 'POST', path: '/ranking', bearer: CREDENTIAL, body: { community: KEY_A, order: wire, period: wirePeriod, playerId: ASKER.userId, limit: 10 } });
        expect(Object.keys(request.body as object).sort()).toEqual(['community', 'limit', 'order', 'period', 'playerId']);
        expect(request.path).toBe('/ranking');
      }
    }
  });

  it('FR-580 (command part) NFR-129 no period word sends no period member at all (all time is the absence), so the all-time request is the 025 one', async () => {
    const { fake, bot } = await world();
    await bot.run(command(GUILD_A, 'victorias'), ASKER);
    await bot.run(command(GUILD_A), ASKER);
    for (const request of reads(fake)) expect(Object.keys(request.body as object).sort()).toEqual(['community', 'limit', 'order', 'playerId']);
  });

  it('FR-580 (command part) another server asks for its own key in a period: the interaction decides, never the channel', async () => {
    const { fake, bot } = await world();
    await bot.run(command(GUILD_B, undefined, 'semana'), ASKER);
    expect(reads(fake)[0]!.body).toMatchObject({ community: KEY_B, period: 'last-7-days' });
  });

  it('FR-580 (command part) a word that is not a period sends nothing to the server and is answered with one sentence', async () => {
    const { fake, bot } = await world();
    expect(await bot.run(command(GUILD_A, 'puntos', 'siempre'), ASKER)).toEqual({ type: 'text', text: STRINGS.unknownPeriod });
    expect(fake.requests).toHaveLength(0);
  });
});

describe('NFR-129 (the bot body) the bytes of the request', () => {
  /** What the client sends over the wire: a fetch that records the raw body text. */
  async function bodyOf(request: Parameters<ReturnType<typeof createServerClient>['ranking']>[0]): Promise<string> {
    let sent = '';
    const client = createServerClient({
      baseUrl: 'http://127.0.0.1:1',
      credential: CREDENTIAL,
      fetch: (async (_url: unknown, init?: { body?: string }) => {
        sent = init?.body ?? '';
        return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    await client.ranking(request);
    return sent;
  }
  const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

  it('NFR-129 an all-time ranking request is the exact 025 body, pinned by its digest, with or without a cursor; the period member comes after the order and only for a period', async () => {
    const plain = await bodyOf({ community: KEY_A, order: 'points', playerId: ASKER.userId });
    expect(plain).toBe(`{"community":"${KEY_A}","order":"points","playerId":"${ASKER.userId}","limit":10}`);
    expect(sha(plain)).toBe('43e2c04f0a6bdfd26db41e9a94d09bac023cc9dd9b0da48ce60cf3898084988a');
    const walked = await bodyOf({ community: KEY_A, order: 'wins', playerId: ASKER.userId, cursor: 'wins.10.25' });
    expect(walked).toBe(`{"community":"${KEY_A}","order":"wins","playerId":"${ASKER.userId}","limit":10,"cursor":"wins.10.25"}`);
    expect(sha(walked)).toBe('d714b7c851eb6cc0fd0538627557636d222535769268d6ce11655e304c7405fc');
    const week = await bodyOf({ community: KEY_A, order: 'points', period: 'last-7-days', playerId: ASKER.userId });
    expect(week).toBe(`{"community":"${KEY_A}","order":"points","period":"last-7-days","playerId":"${ASKER.userId}","limit":10}`);
    const month = await bodyOf({ community: KEY_A, order: 'accuracy', period: 'last-30-days', playerId: ASKER.userId, cursor: 'c' });
    expect(month).toBe(`{"community":"${KEY_A}","order":"accuracy","period":"last-30-days","playerId":"${ASKER.userId}","limit":10,"cursor":"c"}`);
  });
});

describe('FR-584 an interaction without a server', () => {
  it('FR-584 the ranking command with a period arriving without a server is refused with one sentence and nothing is sent to the server', async () => {
    const { fake, bot } = await world();
    expect(await bot.run(command(null, undefined, 'semana'), ASKER)).toEqual({ type: 'text', text: STRINGS.noServer });
    expect(await bot.run(command(null, 'puntos', 'mes'), ASKER)).toEqual({ type: 'text', text: STRINGS.noServer });
    expect(fake.requests).toHaveLength(0);
  });
});

describe('FR-584 the server cannot answer a ranking with a period', () => {
  it('FR-584 a refusal of any kind or an outage is one private "unavailable" sentence and one request: the bot never loops, in each period', async () => {
    const { fake, bot } = await world();
    for (const period of ['semana', 'mes']) {
      for (const error of [
        { status: 403, body: { kind: 'forbidden' } },
        { status: 404, body: { kind: 'unknown-path' } },
        { status: 400, body: { kind: 'invalid-request', items: ['community'] } },
        { status: 400, body: { kind: 'invalid-request', items: ['cursor'] } },
        { status: 429, body: { kind: 'rate-limited', retryAfter: 1 } },
        { status: 503, body: { kind: 'unavailable' } },
        { status: 500, body: 'not json at all' },
      ]) {
        fake.rankingError = error;
        const before = reads(fake).length;
        const reply = await bot.run(command(GUILD_A, 'puntos', period), ASKER);
        expect(reply, `${period} ${JSON.stringify(error.body)}`).toEqual({ type: 'text', text: STRINGS.rankingUnavailable });
        expect(reads(fake)).toHaveLength(before + 1);
      }
      fake.rankingError = undefined;
      fake.down = true;
      const before = reads(fake).length;
      expect(await bot.run(command(GUILD_A, undefined, period), ASKER)).toEqual({ type: 'text', text: STRINGS.rankingUnavailable });
      expect(reads(fake)).toHaveLength(before + 1);
      fake.down = false;
    }
    // The sentence is a text reply: the shell sends it privately.
    expect(replyPayload({ type: 'text', text: STRINGS.rankingUnavailable }, true)[0]?.flags).toBe(EPHEMERAL);
  });

  it('FR-584 an older server that does not know the period member refuses it by name: one private "unavailable" sentence, one request, and no retry without the period', async () => {
    const { fake, bot } = await world();
    fake.refusePeriod = true;
    const before = reads(fake).length;
    expect(await bot.run(command(GUILD_A, 'puntos', 'semana'), ASKER)).toEqual({ type: 'text', text: STRINGS.rankingUnavailable });
    expect(reads(fake)).toHaveLength(before + 1);
    expect(reads(fake)[before]!.body).toMatchObject({ period: 'last-7-days' });
    // The all-time command still works against that server: it sends no period.
    expect((await bot.run(command(GUILD_A, 'puntos'), ASKER)).type).toBe('channel');
  });

  it('FR-584 an answer the bot cannot read is "unavailable" too', async () => {
    const { fake, bot } = await world();
    fake.rankingError = { status: 200, body: { items: [{ playerId: 'x' }], total: 1 } };
    expect(await bot.run(command(GUILD_A, undefined, 'mes'), ASKER)).toEqual({ type: 'text', text: STRINGS.rankingUnavailable });
    expect(reads(fake)).toHaveLength(1);
  });
});

describe('FR-584 NFR-128 what travels and what is logged by the ranking command with a period', () => {
  it('FR-584 neither the raw guild id nor the key nor the asker is in a log line, a post or the state file, whatever the answer, in each period', async () => {
    const { fake, bot, state } = await world();
    await bot.run(command(GUILD_A, 'victorias', 'semana'), ASKER);
    fake.rankingError = { status: 500, body: { kind: 'unavailable' } };
    await bot.run(command(GUILD_A, undefined, 'mes'), ASKER);
    fake.rankingError = undefined;
    fake.refusePeriod = true;
    await bot.run(command(GUILD_A, undefined, 'mes'), ASKER);
    fake.refusePeriod = false;
    fake.down = true;
    await bot.run(command(GUILD_A, undefined, 'semana'), ASKER);
    const stateText = existsSync(state.path) ? readFileSync(state.path, 'utf8') : '';
    const kept = JSON.stringify([bot.logs, bot.posts]) + stateText;
    for (const secret of [GUILD_A, KEY_A, ASKER.userId, 'last-7-days', 'last-30-days']) expect(kept, secret).not.toContain(secret);
    expect(bot.logs.every((line) => /^[a-z-]+$/.test(line))).toBe(true);
    for (const request of fake.requests) expect(JSON.stringify(request), 'the raw guild id travels nowhere').not.toContain(GUILD_A);
  });
});
