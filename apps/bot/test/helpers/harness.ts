// A whole bot without Discord: the real core, server client, stream reader, follower, handler and state file, against the fake
// server, with a recording poster in place of the Discord shell (spec 012 tests).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide } from '../../src/core/actions';
import type { Action, Interaction } from '../../src/core/actions';
import { parseCustomId } from '../../src/core/custom-ids';
import type { OutMessage, Reply } from '../../src/core/model';
import { createBoards, registerSent, updateSent } from '../../src/io/boards';
import type { Boards } from '../../src/io/boards';
import type { CaptureService } from '../../src/io/capture';
import { createFollower, createNames } from '../../src/io/follower';
import type { Follower, Poster } from '../../src/io/follower';
import { createHandler } from '../../src/io/handler';
import type { Who } from '../../src/io/handler';
import { createServerClient } from '../../src/io/server-client';
import { createStateStore, loadState } from '../../src/io/state-file';
import type { StateStore } from '../../src/io/state-file';
import { CREDENTIAL } from './fake-server';

export const CHANNEL = '777000111222333444';
/** Planted Discord server ids (spec 024): the raw id must appear in no request, log line or file; only the key does. */
export const GUILD_A = '741852963074185296';
export const GUILD_B = '852963074185296307';
/** The community keys of the planted servers, pinned (SHA-256 of the id text, lowercase hex). */
export const KEY_A = '6e64010f7e44b49bdd7d8caa2152bc776324a84df33bc52ea513355b2892972f';
export const KEY_B = 'c60c89d871677dd49aa9904a405cdc20431122f08ffd42689563c9b627270ba6';
export const MANAGER: Who = { channelId: CHANNEL, userId: '900000000000000001' };

export interface Posted {
  readonly channelId: string;
  readonly message: OutMessage;
}

export interface Edited {
  readonly channelId: string;
  readonly messageId: string;
  readonly message: OutMessage;
}

export interface Disabled {
  readonly channelId: string;
  readonly messageId: string;
}

/** The countdown timer of a test bot: nothing runs by itself, `fire()` is one tick of every running timer. */
export interface Ticker {
  /** Timers set and not yet cancelled. */
  active(): number;
  fire(): void;
  /** The interval each timer was set with. */
  readonly periods: number[];
}

export interface Bot {
  readonly store: StateStore;
  readonly follower: Follower;
  readonly posts: Posted[];
  readonly edits: Edited[];
  readonly ticker: Ticker;
  readonly logs: string[];
  /** The leaderboard messages that page, with a clock and timers the test moves by hand (spec 017). */
  readonly boards: Boards;
  readonly disables: Disabled[];
  /** The clock of the boards, in ms. */
  clock: number;
  /** Runs the pending 5-minute timers of the boards (`elapse` also moves the clock first). */
  elapse(ms: number): void;
  /** While true a disable edit fails. */
  failDisables: boolean;
  /** What the shell does after it sent a reply as message `messageId`: remember a leaderboard that pages. */
  sent(reply: Reply, messageId: string, channelId?: string): void;
  /** A press on a leaderboard button of message `messageId`, as the shell reads it. */
  press(messageId: string, customId: string, who: Who): Promise<Reply>;
  /** The next `n` posts fail (a Discord outage). */
  failPosts: number;
  /** While true every edit fails. */
  failEdits: boolean;
  /** While true an edit takes 40 ms to finish (an edit in flight). */
  slowEdits: boolean;
  /** A press on a history button of message `messageId`, as the shell does it: the walk it knows, the handler, then the walk updated in place (spec 024). */
  pressHistory(messageId: string, customId: string, who: Who): Promise<Reply>;
  /** A press on a ranking button of message `messageId`, as the shell does it: the walk it knows, the handler, then the walk updated in place (spec 025). */
  pressRanking(messageId: string, customId: string, who: Who): Promise<Reply>;
  /** Runs an action the pure core has already decided on (a step of a flow that is not a command). */
  act(action: Action, who?: Who): Promise<Reply>;
  run(interaction: Interaction, who?: Who): Promise<Reply>;
  stop(): void;
}

export const waitFor = async (check: () => boolean, ms = 20_000, info?: () => string): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(info === undefined ? 'waitFor timed out' : `waitFor timed out: ${info()}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

export const tempState = (): { path: string; remove: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), 'mbrg-bot-'));
  return { path: join(dir, 'state.json'), remove: () => rmSync(dir, { recursive: true, force: true }) };
};

/**
 * Boots a bot on a state file; booting again on the same file is a restart. `posts` may be shared across boots. The server is
 * only its base address: the fake server of the unit tests or the real server of the e2e harness (spec 023).
 */
export function boot(server: { readonly url: string }, statePath: string, options: { posts?: Posted[]; viewerUrl?: string; capture?: Pick<CaptureService, 'reveal' | 'request'> } = {}): Bot {
  const loaded = loadState(statePath);
  if (!loaded.ok) throw new Error('state unreadable');
  const store = createStateStore(statePath, loaded.state);
  const client = createServerClient({ baseUrl: server.url, credential: CREDENTIAL, timeoutMs: 1500 });
  const names = createNames(client);
  const posts = options.posts ?? [];
  const logs: string[] = [];
  const edits: Edited[] = [];
  const timers = new Set<() => void>();
  const periods: number[] = [];
  const ticker: Ticker = { active: () => timers.size, fire: () => [...timers].forEach((tick) => tick()), periods };
  const pendingTimers = new Map<number, { at: number; fn: () => void }>();
  let timerId = 0;
  const disables: Disabled[] = [];
  const boards = createBoards({
    now: () => bot.clock,
    after: (ms, fn) => {
      const id = (timerId += 1);
      pendingTimers.set(id, { at: bot.clock + ms, fn });
      return () => pendingTimers.delete(id);
    },
    disable: async (channelId, messageId) => {
      if (bot.failDisables) throw new Error('discord down');
      disables.push({ channelId, messageId });
    },
  });
  const bot: Bot = {
    boards,
    disables,
    clock: 1_000_000,
    failDisables: false,
    elapse(ms) {
      bot.clock += ms;
      for (const [id, t] of [...pendingTimers]) {
        if (t.at <= bot.clock) {
          pendingTimers.delete(id);
          t.fn();
        }
      }
    },
    sent: (reply, messageId, channelId = CHANNEL) => registerSent(boards, channelId, messageId, reply.type === 'channel' ? reply.messages[0] : undefined),
    press: (messageId, customId, who) => {
      const id = parseCustomId(customId);
      const known = id?.type === 'board' ? boards.lookup(messageId) : undefined;
      return bot.run({ type: 'board-press', customId, userId: who.userId, entry: known, now: bot.clock }, who);
    },
    async pressHistory(messageId, customId, who) {
      const reply = await bot.run({ type: 'history-press', customId, userId: who.userId, entry: boards.lookupHistory(messageId), now: bot.clock }, who);
      if (reply.type === 'channel') updateSent(boards, messageId, reply.messages[0]);
      return reply;
    },
    async pressRanking(messageId, customId, who) {
      const reply = await bot.run({ type: 'ranking-press', customId, userId: who.userId, entry: boards.lookupRanking(messageId), now: bot.clock }, who);
      if (reply.type === 'channel') updateSent(boards, messageId, reply.messages[0]);
      return reply;
    },
    act: (action, who = MANAGER) => handler(action, who),
    store,
    posts,
    edits,
    ticker,
    logs,
    failPosts: 0,
    failEdits: false,
    slowEdits: false,
    follower: undefined as unknown as Follower,
    run: undefined as unknown as Bot['run'],
    stop: () => bot.follower.stopAll(),
  };
  const poster: Poster = {
    async post(channelId, message) {
      if (bot.failPosts > 0) {
        bot.failPosts -= 1;
        throw new Error('discord down');
      }
      posts.push({ channelId, message });
      return `message-${posts.length}`;
    },
    async disable(channelId, messageId) {
      if (bot.failDisables) throw new Error('discord down');
      disables.push({ channelId, messageId });
    },
    async edit(channelId, messageId, message) {
      if (bot.failEdits) throw new Error('discord down');
      if (bot.slowEdits) await new Promise((resolve) => setTimeout(resolve, 40));
      edits.push({ channelId, messageId, message });
    },
  };
  const every = (ms: number, tick: () => void): (() => void) => {
    timers.add(tick);
    periods.push(ms);
    return () => timers.delete(tick);
  };
  const follower = createFollower({ baseUrl: server.url, client, store, poster, boards, names, viewerUrl: options.viewerUrl, capture: options.capture, log: (code) => logs.push(code), sleep: () => new Promise((resolve) => setTimeout(resolve, 10)), every });
  let n = 0;
  const handler = createHandler({ client, store, follower, names, newRequestId: () => `request-${(n += 1)}`, viewerUrl: options.viewerUrl, capture: options.capture });
  Object.assign(bot, {
    follower,
    run: (interaction: Interaction, who: Who = MANAGER) => {
      const creatorId = store.get(who.channelId)?.creatorId;
      const info = { ...(creatorId === undefined ? {} : { creatorId }), hasLast: store.last(who.channelId) !== undefined };
      return handler(decide(interaction, store.get(who.channelId) !== undefined, info), who);
    },
  });
  return bot;
}

export const manager = (over: Partial<Extract<Interaction, { type: 'create' }>> = {}): Interaction => ({ type: 'create', canManage: true, map: 'europe', pace: 'normal', community: KEY_A, ...over });
