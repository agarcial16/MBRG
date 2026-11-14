// A whole bot without Discord: the real core, server client, stream reader, follower, handler and state file, against the fake
// server, with a recording poster in place of the Discord shell (spec 012 tests).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide } from '../../src/core/actions';
import type { Interaction } from '../../src/core/actions';
import type { OutMessage, Reply } from '../../src/core/model';
import { createFollower, createNames } from '../../src/io/follower';
import type { Follower, Poster } from '../../src/io/follower';
import { createHandler } from '../../src/io/handler';
import type { Who } from '../../src/io/handler';
import { createServerClient } from '../../src/io/server-client';
import { createStateStore, loadState } from '../../src/io/state-file';
import type { StateStore } from '../../src/io/state-file';
import { CREDENTIAL } from './fake-server';
import type { Fake } from './fake-server';

export const CHANNEL = '777000111222333444';
export const MANAGER: Who = { channelId: CHANNEL, userId: '900000000000000001' };

export interface Posted {
  readonly channelId: string;
  readonly message: OutMessage;
}

export interface Bot {
  readonly store: StateStore;
  readonly follower: Follower;
  readonly posts: Posted[];
  readonly logs: string[];
  /** The next `n` posts fail (a Discord outage). */
  failPosts: number;
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

/** Boots a bot on a state file; booting again on the same file is a restart. `posts` may be shared across boots. */
export function boot(fake: Fake, statePath: string, options: { posts?: Posted[]; viewerUrl?: string } = {}): Bot {
  const loaded = loadState(statePath);
  if (!loaded.ok) throw new Error('state unreadable');
  const store = createStateStore(statePath, loaded.state);
  const client = createServerClient({ baseUrl: fake.url, credential: CREDENTIAL, timeoutMs: 1500 });
  const names = createNames(client);
  const posts = options.posts ?? [];
  const logs: string[] = [];
  const bot: Bot = {
    store,
    posts,
    logs,
    failPosts: 0,
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
    },
  };
  const follower = createFollower({ baseUrl: fake.url, client, store, poster, names, viewerUrl: options.viewerUrl, log: (code) => logs.push(code), sleep: () => new Promise((resolve) => setTimeout(resolve, 10)) });
  let n = 0;
  const handler = createHandler({ client, store, follower, names, newRequestId: () => `request-${(n += 1)}` });
  Object.assign(bot, {
    follower,
    run: (interaction: Interaction, who: Who = MANAGER) => handler(decide(interaction, store.get(who.channelId) !== undefined), who),
  });
  return bot;
}

export const manager = (over: Partial<Extract<Interaction, { type: 'create' }>> = {}): Interaction => ({ type: 'create', canManage: true, map: 'europe', pace: 'normal', ...over });
