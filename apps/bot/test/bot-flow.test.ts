import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PREDICT_ID, START_ID, findId, pickId } from '../src/core/custom-ids';
import type { Reply } from '../src/core/model';
import { STRINGS } from '../src/core/strings';
import { loadState } from '../src/io/state-file';
import { CREDENTIAL, FUTURE_SECRET, HOST_TOKEN, MATCH_ID, MATCH_SECRET, SCHEDULE, baseMatch, startFake } from './helpers/fake-server';
import type { Fake } from './helpers/fake-server';
import { CHANNEL, MANAGER, boot, manager, tempState, waitFor } from './helpers/harness';
import type { Bot, Posted } from './helpers/harness';
import { FULL_JOURNEY, TEXTS, WRONG_GUESSER, applyRound1, finishRound2, revealRound1, revealRound2Forced } from './helpers/journey';

// Flow tests wait on real sockets: under CI load the default 5 s test limit is too tight.
vi.setConfig({ testTimeout: 30_000 });

const MEMBER = { channelId: CHANNEL, userId: '123123123123123123' };
const textOf = (reply: Reply): string => (reply.type === 'text' ? reply.text : `<${reply.type}>`);
const texts = (posts: readonly Posted[]): string[] => posts.map((p) => p.message.text);

const fakes: Fake[] = [];
const bots: Bot[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const bot of bots.splice(0)) bot.stop();
  for (const fake of fakes.splice(0)) await fake.close();
  for (const clean of cleanups.splice(0)) clean();
});

async function world(options: { viewerUrl?: string; factions?: { id: number; name: string }[] } = {}) {
  const fake = await startFake(options.factions === undefined ? {} : { factions: options.factions });
  fakes.push(fake);
  const state = tempState();
  cleanups.push(state.remove);
  const bot = boot(fake, state.path, options.viewerUrl === undefined ? {} : { viewerUrl: options.viewerUrl });
  bots.push(bot);
  return { fake, bot, statePath: state.path };
}

/** Creates the match in the channel and starts it (the server then emits the first event). */
async function createAndStart(fake: Fake, bot: Bot): Promise<void> {
  const made = await bot.run(manager());
  expect(made.type).toBe('channel');
  await waitFor(() => fake.streamCount() === 1);
  const started = await bot.run({ type: 'button', customId: START_ID, canManage: true });
  expect(textOf(started)).toBe(STRINGS.started);
  await waitFor(() => bot.posts.length === 1);
}

describe('FR-451 create', () => {
  it('FR-451 creates a public match without a credential, follows it and answers with the lobby message and a Start button', async () => {
    const { fake, bot } = await world();
    const reply = await bot.run(manager({ pace: 'fast' }));
    expect(reply.type).toBe('channel');
    if (reply.type !== 'channel') return;
    expect(reply.messages[0]?.text).toContain(MATCH_ID);
    expect(reply.messages[0]?.text).toContain('europe');
    expect(reply.messages[0]?.buttons).toEqual([{ type: 'custom', customId: START_ID, label: 'Iniciar', style: 'success' }]);
    const creation = fake.requests.find((r) => r.method === 'POST' && r.path === '/matches');
    expect(creation?.bearer).toBeUndefined();
    expect(creation?.body).toEqual({ mapId: 'europe', timing: { i: 30, l1: 10, l2: 5 }, requestId: 'request-1' });
    expect(bot.store.get(CHANNEL)).toMatchObject({ matchId: MATCH_ID, mapId: 'europe', hostToken: HOST_TOKEN, lastSeq: 1 });
    await waitFor(() => fake.streamCount() === 1);
    expect(fake.requests.find((r) => r.path.endsWith('/events'))?.lastEventId).toBe('1');
  });

  it('FR-451 a channel that already follows a match is refused with a sentence and nothing is created', async () => {
    const { fake, bot } = await world();
    await bot.run(manager());
    const again = await bot.run(manager());
    expect(textOf(again)).toBe(STRINGS.alreadyFollowing);
    expect(fake.requests.filter((r) => r.method === 'POST' && r.path === '/matches')).toHaveLength(1);
  });

  it('FR-451 a map the server does not offer is refused before any creation', async () => {
    const { fake, bot } = await world();
    expect(textOf(await bot.run(manager({ map: 'mars' })))).toBe(STRINGS.unknownMap);
    expect(fake.requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('FR-451 a server that is down at the start gives the unavailable sentence and keeps nothing', async () => {
    const { fake, bot } = await world();
    fake.down = true;
    expect(textOf(await bot.run(manager()))).toBe(STRINGS.serverDown);
    expect(bot.store.get(CHANNEL)).toBeUndefined();
  });
});

describe('FR-452 start', () => {
  it('FR-452 a manager starts the match with the host token it holds', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    const start = fake.requests.find((r) => r.path.endsWith('/start'));
    expect(start?.bearer).toBe(HOST_TOKEN);
  });

  it('FR-452 anyone else is told privately that they cannot, and nothing is sent to the server', async () => {
    const { fake, bot } = await world();
    await bot.run(manager());
    const reply = await bot.run({ type: 'start', canManage: false }, MEMBER);
    expect(textOf(reply)).toBe(STRINGS.noPermission);
    expect((await bot.run({ type: 'button', customId: START_ID, canManage: false }, MEMBER)).type).toBe('text');
    expect(fake.requests.some((r) => r.path.endsWith('/start'))).toBe(false);
  });
});

describe('FR-453 announcements', () => {
  it('FR-453 and FR-456 every event of a whole match is announced once, in order', async () => {
    const { fake, bot } = await world({ viewerUrl: 'https://viewer.example/' });
    await createAndStart(fake, bot);
    revealRound1(fake);
    applyRound1(fake);
    revealRound2Forced(fake);
    finishRound2(fake);
    await waitFor(() => bot.posts.length === FULL_JOURNEY.length);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(texts(bot.posts)).toEqual(FULL_JOURNEY);
    // The open phases carry ONE Predict button and the viewer link at that round; the forced round carries no button.
    const open = bot.posts[0]?.message.buttons ?? [];
    expect(open).toEqual([
      { type: 'custom', customId: PREDICT_ID, label: 'Predecir', style: 'primary' },
      { type: 'link', url: `https://viewer.example/?match=${MATCH_ID}&round=1`, label: 'Ver en el visor' },
    ]);
    expect(bot.posts[6]?.message.buttons).toEqual([]);
    expect(bot.posts.every((p) => p.message.buttons.filter((b) => b.type === 'custom').length <= 1)).toBe(true);
    // The match is over for the channel: the host token is gone and the stream is closed.
    expect(bot.store.get(CHANNEL)).toBeUndefined();
    await waitFor(() => fake.streamCount() === 0);
    // The phase 2 results of the forced round were never asked for.
    expect(fake.requests.some((r) => r.path.includes('/results/2/2'))).toBe(false);
  });

  it('FR-462 no viewer address configured: no link anywhere', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    revealRound1(fake);
    await waitFor(() => bot.posts.length === 3);
    expect(bot.posts.flatMap((p) => p.message.buttons).some((b) => b.type === 'link')).toBe(false);
  });

  it('FR-456 never shows a wrong guess: the member who guessed wrong appears nowhere, only the ones who guessed right', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    revealRound1(fake);
    await waitFor(() => bot.posts.length === 3);
    expect(bot.posts[2]?.message.text).toBe(TEXTS.winners1);
    expect(JSON.stringify(bot.posts)).not.toContain(WRONG_GUESSER);
  });

  it('FR-456 ten mentions at most, then "y N más" (13 right guesses read over several pages)', async () => {
    const { fake, bot } = await world();
    fake.pageSize = 5;
    await createAndStart(fake, bot);
    revealRound1(fake);
    applyRound1(fake);
    revealRound2Forced(fake);
    await waitFor(() => bot.posts.length === 8);
    expect(bot.posts[7]?.message.text).toBe(TEXTS.winners2);
    expect(bot.posts[7]?.message.text).toContain('y 3 más');
    expect(bot.posts[7]?.message.text).not.toContain('<@5010>');
    expect(fake.requests.filter((r) => r.path.includes('/results/2/1')).length).toBe(3);
  });
});

describe('FR-454 predictions', () => {
  async function inPhase2(): Promise<{ fake: Fake; bot: Bot }> {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    revealRound1(fake);
    await waitFor(() => bot.posts.length === 3);
    return { fake, bot };
  }

  it('FR-454 and FR-463 the Predict press offers a select menu of the candidates to that member and a choice is submitted with the credential, no join', async () => {
    const { fake, bot } = await inPhase2();
    const offer = await bot.run({ type: 'button', customId: PREDICT_ID, canManage: false }, MEMBER);
    expect(offer).toMatchObject({ type: 'select', customId: pickId('absorber', 1) });
    if (offer.type === 'select') expect(offer.options).toEqual([{ label: 'España', value: '2' }, { label: 'Francia', value: '3' }]);
    const chosen = await bot.run({ type: 'select', customId: pickId('absorber', 1), values: ['3'] }, MEMBER);
    expect(textOf(chosen)).toBe('Elegido: Francia.');
    expect(fake.predictions).toEqual([{ playerId: MEMBER.userId, kind: 'absorber', round: 1, faction: 3 }]);
    const sent = fake.requests.filter((r) => r.path.endsWith('/predictions'));
    expect(sent.map((r) => r.bearer)).toEqual([CREDENTIAL]);
    expect(fake.requests.some((r) => r.path.endsWith('/players'))).toBe(false);
    // A later choice goes to the server the same way (it replaces the earlier one there).
    await bot.run({ type: 'select', customId: pickId('absorber', 1), values: ['2'] }, MEMBER);
    expect(fake.predictions).toHaveLength(2);
  });

  it('FR-454 the slash command shortcut resolves typed text and offers up to 25 suggestions', async () => {
    const { fake, bot } = await inPhase2();
    expect(textOf(await bot.run({ type: 'predict', faction: 'fran' }, MEMBER))).toBe('Elegido: Francia.');
    expect(fake.predictions[0]?.faction).toBe(3);
    const found = await bot.run({ type: 'autocomplete', option: 'faction', text: 'ESP' }, MEMBER);
    expect(found).toEqual({ type: 'suggest', choices: [{ name: 'España', value: '2' }] });
    expect(textOf(await bot.run({ type: 'predict', faction: 'zzz' }, MEMBER))).toContain('Ninguna facción');
    expect(await bot.run({ type: 'autocomplete', option: 'map', text: 'eur' }, MEMBER)).toEqual({ type: 'suggest', choices: [{ name: 'europe', value: 'europe' }] });
  });

  it('FR-454 a 100+ faction match: the press opens the text window, a typed text finds candidates and the channel never receives a list', async () => {
    const factions = Array.from({ length: 130 }, (_, i) => ({ id: i + 1, name: `Region ${i + 1}` }));
    const { fake, bot } = await world({ factions });
    await createAndStart(fake, bot);
    fake.match = baseMatch({ stage: 'phase-1', schedule: SCHEDULE, state: { mode: 'classic', round: 0, owners: factions.map((f) => [f.id, f.id] as const) }, lastSeq: fake.match.lastSeq });
    const window = await bot.run({ type: 'button', customId: PREDICT_ID, canManage: false }, MEMBER);
    expect(window).toEqual({ type: 'modal', customId: findId('victim', 1), title: 'Buscar facción', label: 'Parte del nombre' });
    expect(textOf(await bot.run({ type: 'modal', customId: findId('victim', 1), text: 'zzz' }, MEMBER))).toContain('Ninguna facción');
    const several = await bot.run({ type: 'modal', customId: findId('victim', 1), text: 'region 1' }, MEMBER);
    expect(several.type === 'select' && several.options.length).toBe(25);
    expect(fake.predictions).toHaveLength(0);
    expect(textOf(await bot.run({ type: 'modal', customId: findId('victim', 1), text: 'REGION 117' }, MEMBER))).toBe('Elegido: Region 117.');
    expect(fake.predictions).toEqual([{ playerId: MEMBER.userId, kind: 'victim', round: 1, faction: 117 }]);
    const suggested = await bot.run({ type: 'autocomplete', option: 'faction', text: 'region' }, MEMBER);
    expect(suggested.type === 'suggest' && suggested.choices.length).toBe(25);
    // Nothing but the announcements reached the channel (one message so far), and it lists no candidate.
    expect(bot.posts).toHaveLength(1);
  });
});

describe('FR-455 refusals', () => {
  async function inPhase2() {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    revealRound1(fake);
    await waitFor(() => bot.posts.length === 3);
    return { fake, bot };
  }
  const choose = (bot: Bot) => bot.run({ type: 'select', customId: pickId('absorber', 1), values: ['2'] }, MEMBER);

  it('FR-455 a closed phase: the member only gets the reason and nothing changes', async () => {
    const { fake, bot } = await inPhase2();
    fake.submitError = { status: 409, body: { kind: 'prediction-closed' } };
    expect(textOf(await choose(bot))).toBe(STRINGS.errClosed);
    expect(fake.predictions).toEqual([]);
    // Locked, finished and lobby stages are known from the public data: no submission is even sent.
    const before = fake.requests.length;
    fake.match = baseMatch({ ...fake.match, stage: 'locked' });
    expect(textOf(await bot.run({ type: 'button', customId: PREDICT_ID, canManage: false }, MEMBER))).toBe(STRINGS.phaseClosed);
    expect(fake.requests.slice(before).every((r) => r.method === 'GET')).toBe(true);
  });

  it('FR-455 any other refusal is a plain sentence: forced absorber, rate limit, finished, unknown choice, server down', async () => {
    const { fake, bot } = await inPhase2();
    fake.submitError = { status: 409, body: { kind: 'forced-absorber' } };
    expect(textOf(await choose(bot))).toBe(STRINGS.errForced);
    fake.submitError = { status: 429, body: { kind: 'rate-limited', retryAfter: 3 } };
    expect(textOf(await choose(bot))).toBe('Vas demasiado rápido. Espera 3 s.');
    fake.submitError = { status: 409, body: { kind: 'match-finished' } };
    expect(textOf(await choose(bot))).toBe(STRINGS.errFinished);
    fake.submitError = { status: 400, body: { kind: 'invalid-choice' } };
    expect(textOf(await choose(bot))).toBe(STRINGS.errChoice);
    fake.submitError = { status: 200, body: 'not json at all' };
    expect(textOf(await choose(bot))).toBe(STRINGS.serverDown);
    fake.submitError = undefined;
    fake.down = true;
    expect(textOf(await choose(bot))).toBe(STRINGS.serverDown);
  });

  it('FR-455 a forced round says there is nothing to predict, without asking the server to store anything', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    revealRound1(fake);
    applyRound1(fake);
    revealRound2Forced(fake);
    await waitFor(() => bot.posts.length === 7, 20_000, () => `${bot.posts.length} posts: ${JSON.stringify(texts(bot.posts).map((t) => t.slice(0, 30)))}`);
    expect(textOf(await bot.run({ type: 'button', customId: PREDICT_ID, canManage: false }, MEMBER))).toBe(STRINGS.errForced);
    expect(fake.predictions).toEqual([]);
  });
});

describe('FR-457 and FR-458', () => {
  it('FR-457 the board shows rank, mention and points of the first 10, asking the server for 10', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    fake.leaderboard = Array.from({ length: 14 }, (_, i) => ({ rank: i + 1, playerId: `discord:${800 + i}`, total: 50 - i }));
    const reply = await bot.run({ type: 'board' }, MEMBER);
    expect(reply.type).toBe('channel');
    const text = reply.type === 'channel' ? reply.messages.map((m) => m.text).join('\n') : '';
    expect(text).toContain('1. <@800> - 50 pts');
    expect(text).toContain('10. <@809> - 41 pts');
    expect(text).not.toContain('<@810>');
    expect(fake.requests.find((r) => r.path.includes('/leaderboard'))?.path).toContain('limit=10');
  });

  it('FR-458 stop makes the channel stop following, drops the host token and leaves the match alone; only a manager may', async () => {
    const { fake, bot, statePath } = await world();
    await createAndStart(fake, bot);
    expect(textOf(await bot.run({ type: 'stop', canManage: false }, MEMBER))).toBe(STRINGS.noPermission);
    expect(bot.store.get(CHANNEL)).toBeDefined();
    const stopped = await bot.run({ type: 'stop', canManage: true });
    expect(stopped.type).toBe('channel');
    expect(bot.store.get(CHANNEL)).toBeUndefined();
    expect(readFileSync(statePath, 'utf8')).not.toContain(HOST_TOKEN);
    await waitFor(() => fake.streamCount() === 0);
    const posted = bot.posts.length;
    revealRound1(fake);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(bot.posts).toHaveLength(posted);
    expect(fake.streamCount()).toBe(0);
    expect(fake.requests.filter((r) => r.method === 'POST').map((r) => r.path)).toEqual(['/matches', `/matches/${MATCH_ID}/start`]);
  });
});

describe('FR-459 restart', () => {
  it('FR-459 a restart follows the same match again and resumes after the last announced event: none twice, none lost', async () => {
    const { fake, bot, statePath } = await world();
    await createAndStart(fake, bot);
    revealRound1(fake);
    await waitFor(() => bot.posts.length === 3);
    await waitFor(() => bot.store.get(CHANNEL)?.lastSeq === fake.match.lastSeq);
    const savedSeq = bot.store.get(CHANNEL)?.lastSeq;
    bot.stop();
    await waitFor(() => fake.streamCount() === 0);
    // The bot is off while the match goes on.
    applyRound1(fake);
    revealRound2Forced(fake);
    const second = boot(fake, statePath, { posts: bot.posts });
    bots.push(second);
    expect(second.store.get(CHANNEL)?.lastSeq).toBe(savedSeq);
    second.follower.followAll();
    await waitFor(() => second.posts.length === 7, 20_000, () => `${second.posts.length} posts: ${JSON.stringify(texts(second.posts).map((t) => t.slice(0, 30)))}`);
    finishRound2(fake);
    await waitFor(() => second.posts.length === FULL_JOURNEY.length);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(texts(second.posts)).toEqual(FULL_JOURNEY);
    const reopen = fake.requests.filter((r) => r.path.endsWith('/events')).at(-1);
    expect(reopen?.lastEventId).toBe(String(savedSeq));
  });

  it('FR-459 an event delivered again is not announced again', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    const frame = { id: '2', data: JSON.stringify({ type: 'schedule', seq: 2, stage: 'phase-1', schedule: SCHEDULE, reportedTime: 2000 }) };
    await bot.follower.handleFrame(CHANNEL, frame);
    await bot.follower.handleFrame(CHANNEL, frame);
    expect(bot.posts).toHaveLength(1);
  });

  it('FR-459 the state file is written whole (no temporary file left) and a damaged one is refused, a missing one is empty', async () => {
    const { fake, bot, statePath } = await world();
    await bot.run(manager());
    expect(existsSync(`${statePath}.tmp`)).toBe(false);
    const loaded = loadState(statePath);
    expect(loaded.ok && loaded.state.channels[CHANNEL]?.matchId).toBe(MATCH_ID);
    writeFileSync(statePath, '{"version":1,"channels":{"1":{"matchId":1}}}');
    expect(loadState(statePath).ok).toBe(false);
    expect(loadState(`${statePath}.missing`)).toEqual({ ok: true, state: { version: 1, channels: {} } });
    void fake;
  });
});

describe('FR-460 stream drop', () => {
  it('FR-460 a dropped stream is reopened with backoff from the last announced event; nothing is announced while disconnected', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    revealRound1(fake);
    await waitFor(() => bot.posts.length === 3);
    await waitFor(() => bot.store.get(CHANNEL)?.lastSeq === fake.match.lastSeq);
    const savedSeq = bot.store.get(CHANNEL)?.lastSeq;
    fake.down = true;
    fake.dropStreams();
    applyRound1(fake);
    await waitFor(() => bot.logs.includes('stream-dropped'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(bot.posts).toHaveLength(3);
    fake.down = false;
    await waitFor(() => bot.posts.length === 6);
    revealRound2Forced(fake);
    finishRound2(fake);
    await waitFor(() => bot.posts.length === FULL_JOURNEY.length);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(texts(bot.posts)).toEqual(FULL_JOURNEY);
    expect(fake.requests.filter((r) => r.path.endsWith('/events') && r.lastEventId === String(savedSeq)).length).toBeGreaterThanOrEqual(2);
  });

  it('FR-460 an event whose post failed is tried again after the reconnect: none lost, none twice', async () => {
    const { fake, bot } = await world();
    await createAndStart(fake, bot);
    bot.failPosts = 1;
    revealRound1(fake);
    await waitFor(() => bot.posts.length === 3);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(texts(bot.posts)).toEqual([TEXTS.opened1, TEXTS.reveal1, TEXTS.winners1]);
  });

  it('FR-460 a server that cannot be reached is retried, never announced from', async () => {
    const { fake, bot } = await world();
    await bot.run(manager());
    await waitFor(() => fake.streamCount() === 1);
    fake.down = true;
    fake.dropStreams();
    await waitFor(() => bot.logs.filter((c) => c === 'stream-dropped').length >= 2);
    expect(bot.posts).toEqual([]);
  });
});

describe('NFR-88 secrecy', () => {
  it('NFR-88 a fake server holding planted secrets never gets them into any message, reply or request', async () => {
    const { fake, bot } = await world({ viewerUrl: 'https://viewer.example/' });
    const replies: Reply[] = [];
    replies.push(await bot.run(manager()));
    await waitFor(() => fake.streamCount() === 1);
    replies.push(await bot.run({ type: 'start', canManage: true }));
    await waitFor(() => bot.posts.length === 1);
    revealRound1(fake);
    await waitFor(() => bot.posts.length === 3);
    replies.push(await bot.run({ type: 'button', customId: PREDICT_ID, canManage: false }, MEMBER));
    replies.push(await bot.run({ type: 'select', customId: pickId('absorber', 1), values: ['2'] }, MEMBER));
    applyRound1(fake);
    revealRound2Forced(fake);
    finishRound2(fake);
    await waitFor(() => bot.posts.length === FULL_JOURNEY.length);
    replies.push(await bot.run({ type: 'autocomplete', option: 'faction', text: '' }, MEMBER));
    replies.push(await bot.run({ type: 'board' }, MEMBER));
    const everything = JSON.stringify([bot.posts, replies]);
    expect(everything).not.toContain(FUTURE_SECRET);
    expect(everything).not.toContain(MATCH_SECRET);
    // The bot asked only for rounds already applied: the future state (planted faction 99) was never requested.
    const rounds = fake.requests.map((r) => /\/states\/(\d+)/.exec(r.path)?.[1]).filter((r): r is string => r !== undefined).map(Number);
    expect(Math.max(0, ...rounds)).toBeLessThanOrEqual(2);
    expect(fake.requests.every((r) => !/\/records|\/predictions\?|players/.test(r.path))).toBe(true);
  });
});

describe('NFR-89 privacy', () => {
  it('NFR-89 tokens, the credential and Discord ids stay out of logs and messages, except the mention of a member who guessed right', async () => {
    const { fake, bot, statePath } = await world();
    const replies: Reply[] = [];
    replies.push(await bot.run(manager()));
    await waitFor(() => fake.streamCount() === 1);
    expect(readFileSync(statePath, 'utf8')).toContain(HOST_TOKEN);
    replies.push(await bot.run({ type: 'start', canManage: true }));
    await waitFor(() => bot.posts.length === 1);
    revealRound1(fake);
    await waitFor(() => bot.posts.length === 3);
    replies.push(await bot.run({ type: 'select', customId: pickId('absorber', 1), values: ['2'] }, MEMBER));
    replies.push(await bot.run({ type: 'autocomplete', option: 'faction', text: '' }, MEMBER));
    fake.submitError = { status: 409, body: { kind: 'prediction-closed' } };
    replies.push(await bot.run({ type: 'select', customId: pickId('absorber', 1), values: ['2'] }, MEMBER));
    applyRound1(fake);
    revealRound2Forced(fake);
    finishRound2(fake);
    await waitFor(() => bot.posts.length === FULL_JOURNEY.length);
    const visible = JSON.stringify([bot.posts.map((p) => p.message), replies, bot.logs]);
    for (const secret of [HOST_TOKEN, CREDENTIAL, MEMBER.userId, MANAGER.userId, WRONG_GUESSER]) expect(visible).not.toContain(secret);
    // The ids that do appear are the mentions of members who guessed right.
    const ids = [...visible.split(MATCH_ID).join('').matchAll(/[0-9]{3,}/g)].map((m) => m[0]);
    for (const id of ids) expect(['111', '222', ...Array.from({ length: 10 }, (_, i) => String(5000 + i))]).toContain(id);
    // The credential travels only in the Authorization header of a prediction, a host token only in that of the start.
    for (const request of fake.requests) {
      expect(JSON.stringify(request.body ?? '')).not.toMatch(/PLANTED/);
      if (request.bearer === CREDENTIAL) expect(request.path.endsWith('/predictions')).toBe(true);
      if (request.bearer === HOST_TOKEN) expect(request.path.endsWith('/start')).toBe(true);
    }
    // The match is over: the host token is no longer kept.
    expect(readFileSync(statePath, 'utf8')).not.toContain(HOST_TOKEN);
    expect(bot.logs.every((code) => /^[a-z-]+$/.test(code))).toBe(true);
  });
});
