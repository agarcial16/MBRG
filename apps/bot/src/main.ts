// The bot's entry point (spec 012). It reads its configuration from the environment only, refuses to start with a clear message
// when a required variable is missing (naming the variable, never a value), loads the saved state, follows the same matches again
// and connects to Discord. Logs are closed codes: no token, credential, host token, id or server text is ever written.
import { randomUUID } from 'node:crypto';
import { readConfig } from './core/env';
import { STRINGS, fill } from './core/strings';
import { createShell } from './discord/shell';
import { afterMs, createBoards } from './io/boards';
import { createFollower, createNames } from './io/follower';
import { createHandler } from './io/handler';
import { createServerClient } from './io/server-client';
import { createStateStore, loadState } from './io/state-file';

const log = (code: string): void => console.log(`[bot] ${code}`);

async function main(): Promise<void> {
  const read = readConfig(process.env);
  if (!read.ok) {
    for (const name of read.missing) console.error(fill(STRINGS.envMissing, { name }));
    process.exitCode = 1;
    return;
  }
  const { config } = read;
  const loaded = loadState(config.stateFile);
  if (!loaded.ok) {
    console.error(STRINGS.stateUnreadable);
    process.exitCode = 1;
    return;
  }
  const store = createStateStore(config.stateFile, loaded.state);
  const client = createServerClient({ baseUrl: config.serverUrl, credential: config.credential });
  const names = createNames(client);
  let handle: ReturnType<typeof createHandler> | undefined;
  let disable: ((channelId: string, messageId: string) => Promise<void>) | undefined;
  const boards = createBoards({ now: Date.now, after: afterMs, disable: (channelId, messageId) => (disable as NonNullable<typeof disable>)(channelId, messageId) });
  const shell = createShell({
    following: (channelId) => store.get(channelId) !== undefined,
    info: (channelId) => {
      const creatorId = store.get(channelId)?.creatorId;
      return { ...(creatorId === undefined ? {} : { creatorId }), hasLast: store.last(channelId) !== undefined };
    },
    handle: (action, who) => (handle as NonNullable<typeof handle>)(action, who),
    log,
    boards,
    now: Date.now,
  });
  disable = shell.poster.disable;
  const follower = createFollower({ baseUrl: config.serverUrl, client, store, poster: shell.poster, boards, names, viewerUrl: config.viewerUrl, log });
  handle = createHandler({ client, store, follower, names, newRequestId: randomUUID, viewerUrl: config.viewerUrl });

  process.on('unhandledRejection', () => log('unhandled'));
  const shutdown = (): void => {
    follower.stopAll();
    boards.stopAll();
    void shell.stop().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  try {
    await shell.start(config.discordToken);
  } catch {
    console.error(STRINGS.loginFailed);
    process.exitCode = 1;
    follower.stopAll();
    await shell.stop();
    return;
  }
  follower.followAll();
  console.log(STRINGS.botReady);
}

void main();
