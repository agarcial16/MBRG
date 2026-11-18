// The e2e world (spec 023 FR-540): the REAL server — production route table, real service, real store, the dev map package
// (an absolute folder, never a relative MBRG_MAPS), a fake clock and its fake scheduler so the whole match runs in seconds —
// plus the REAL bot core (server client, follower, handler, state file) against the recording poster of the unit-test
// harness. Only Discord is faked. The seeds of the plan make every round deterministic.
import { CREDENTIAL } from '../helpers/fake-server';
import { boot, tempState } from '../helpers/harness';
import type { Bot } from '../helpers/harness';
import type { FakeScheduler } from '../../../server/test/helpers/fake-scheduler';
import { productionRoutes } from '../../../server/src/http/server';
import { seedSourceOf, startServer } from '../../../server/test/helpers/server-harness';
import type { ServerHarness } from '../../../server/test/helpers/server-harness';
import { SEEDS } from './plan';

/** The viewer address the bot links to (spec 021): the local dev viewer. */
export const VIEWER_URL = 'http://localhost:5173/';

export interface E2EWorld {
  /** The bot's own HTTP address of the real server. */
  readonly url: string;
  readonly bot: Bot;
  /** The scheduler of the SERVICE (the one the match steps are armed on; the hub has another for heartbeats). */
  readonly scheduler: FakeScheduler;
  readonly server: ServerHarness;
  /** The state file the bot runs on. */
  readonly statePath: string;
  close(): Promise<void>;
}

export async function startWorld(): Promise<E2EWorld> {
  const server = await startServer({
    routes: productionRoutes,
    // The `discord` client credential of the unit tests: the bot holds the same one, so its predictions land in the
    // `discord:<user id>` namespace of a client-only match (spec 018).
    clients: [{ namespace: 'discord', credential: CREDENTIAL }],
    service: {
      testSeedSource: seedSourceOf(SEEDS),
      scheduler: true,
      // Public creation on, exactly one public map: the dev package (the harness passes its folder as an absolute path).
      publicCreation: { maps: ['dev'] },
    },
  });
  // The service harness builds the service's own scheduler: the match's phase steps are armed there, not on the hub's.
  const scheduler = server.base.scheduler;
  if (scheduler === undefined) throw new Error('the e2e server was started without its fake scheduler');
  const url = `http://127.0.0.1:${server.port}`;
  const state = tempState();
  const bot = boot({ url }, state.path, { viewerUrl: VIEWER_URL });
  return {
    url,
    bot,
    scheduler,
    server,
    statePath: state.path,
    async close() {
      bot.stop();
      await server.close();
      state.remove();
    },
  };
}
