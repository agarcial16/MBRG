// The scripted match of the e2e harness (spec 023 FR-540, FR-541): drives the REAL bot core (interactions in, replies out)
// and the REAL server's fake clock (the scheduler runs each phase transition at its scheduled instant), records everything
// the simulated channel shows — posts, edits, private replies — and checks secrecy live: before each stage's posts settle,
// no post may name a victim or absorber that the server has not revealed yet, carry the host token, or mention a round
// beyond the one that is open.
import { readPublicMatch, readLeaderboardPage } from '@mbrg/protocol';
import type { LeaderboardRow, PublicMatch } from '@mbrg/protocol';
import { lobbyLink } from '../../src/core/announce';
import type { Interaction } from '../../src/core/actions';
import { PREDICT_ID, START_ID, pickId } from '../../src/core/custom-ids';
import type { OutMessage, Reply } from '../../src/core/model';
import { STRINGS } from '../../src/core/strings';
import type { Who } from '../../src/io/handler';
import { fromCommand } from '../../src/discord/translate';
import { TOLERANCE_MS } from '../../../server/src/core/time';
import { CHANNEL, GUILD_A, GUILD_B, MANAGER, waitFor } from '../helpers/harness';
import type { Edited, Posted } from '../helpers/harness';
import { EXPECTED_POST_TEXTS, PLAN, PLAYERS } from './plan';
import { secrecyViolations } from './secrecy';
import type { Player } from './plan';
import type { E2EWorld } from './world';
import { VIEWER_URL } from './world';

export type RunEntry =
  | { readonly kind: 'post'; readonly stage: string; readonly message: OutMessage; readonly messageId: string }
  | { readonly kind: 'edit'; readonly stage: string; readonly messageId: string; readonly message: OutMessage }
  | { readonly kind: 'reply'; readonly stage: string; readonly to: string; readonly reply: Reply };

export interface MatchRun {
  readonly world: E2EWorld;
  readonly matchId: string;
  readonly mapId: string;
  /** The lobby link: the viewer's waiting screen for this match (spec 021). */
  readonly viewerMatchUrl: string;
  readonly hostToken: string;
  readonly entries: readonly RunEntry[];
  readonly posts: readonly Posted[];
  readonly edits: readonly Edited[];
  /** Secrecy violations seen during the run (FR-541); empty when the run is clean. */
  readonly violations: readonly string[];
  /** How many channel posts the secrecy checker looked at. */
  readonly checkedPosts: number;
  /** The final leaderboard as the server ranks it, with the display names the predictions carried (spec 022). */
  readonly leaderboard: readonly LeaderboardRow[];
  /** What `/mbrg history` answered after the match (spec 024 FR-562). */
  readonly history: HistoryRun;
}

/** The replies of the history step: the same command in the server of the match (A) and in another server (B). */
export interface HistoryRun {
  /** In A, right after the finish: the match is not settled yet (its finish instant is not more than `TOLERANCE_MS` behind the clock). */
  readonly unsettled: Reply;
  /** In A, once the clock is past `TOLERANCE_MS` after the finish, asked by the first player. */
  readonly listed: Reply;
  /** The same, asked by the player with 0 points and by a member who never predicted. */
  readonly zeroPoints: Reply;
  readonly outsider: Reply;
  /** In B: a server with no finished match. */
  readonly otherServer: Reply;
}

const isLastRound = (round: number): boolean => PLAN[PLAN.length - 1]!.round === round;

/** The posts and edits the channel holds once each stage has settled, derived from the plan the same way the bot walks it. */
function expectedCounts(): Map<string, { posts: number; edits: number }> {
  const counts = new Map<string, { posts: number; edits: number }>([
    ['create', { posts: 0, edits: 0 }],
    ['start', { posts: 1, edits: 0 }],
  ]);
  let posts = 1;
  let edits = 0;
  for (const r of PLAN) {
    counts.set(`r${r.round}:predict1`, { posts, edits });
    posts += 2; // the reveal and the phase-1 winners
    edits += 1; // the opened message's Predict button is disabled
    counts.set(`r${r.round}:reveal`, { posts, edits });
    if (!r.forced) {
      counts.set(`r${r.round}:predict2`, { posts, edits });
      posts += 3 + (isLastRound(r.round) ? 1 : 0); // applied, phase-2 winners, next opened (or finished and board)
      edits += 1; // the reveal message's Predict button is disabled
    } else {
      posts += 2 + (isLastRound(r.round) ? 1 : 0); // applied, next opened (or finished and board)
    }
    counts.set(`r${r.round}:applied`, { posts, edits });
  }
  return counts;
}

export async function playScriptedMatch(world: E2EWorld): Promise<MatchRun> {
  const { bot, scheduler, url } = world;
  const entries: RunEntry[] = [];
  const violations: string[] = [];
  const counts = expectedCounts();
  let checkedPosts = 0;

  /** One named stage of the script: run its actions, wait for the exact channel counts, record and check what appeared. */
  async function stage<T>(name: string, round: number, body: () => Promise<T>): Promise<T> {
    const want = counts.get(name);
    if (want === undefined) throw new Error(`the plan has no stage ${name}`);
    const postsBefore = bot.posts.length;
    const editsBefore = bot.edits.length;
    const result = await body();
    const where = () => `${name}: ${bot.posts.length}/${want.posts} posts, ${bot.edits.length}/${want.edits} edits`;
    await waitFor(() => bot.posts.length === want.posts, 20_000, where);
    await waitFor(() => bot.edits.length === want.edits, 20_000, where);
    bot.posts.slice(postsBefore).forEach((p, i) => entries.push({ kind: 'post', stage: name, message: p.message, messageId: `message-${postsBefore + i + 1}` }));
    for (const e of bot.edits.slice(editsBefore)) entries.push({ kind: 'edit', stage: name, messageId: e.messageId, message: e.message });
    // FR-541: everything a post of this stage carries must already be public (see secrecy.ts).
    const made = bot.posts.slice(postsBefore).map((p) => p.message);
    checkedPosts += made.length;
    violations.push(...secrecyViolations(name, round, made, entry0?.hostToken));
    return result;
  }

  /** A member's interaction, recorded as the private reply the member sees. */
  async function interact(stageName: string, player: Player, interaction: Interaction): Promise<Reply> {
    const who: Who = { channelId: CHANNEL, userId: player.userId, displayName: player.displayName };
    const reply = await bot.run(interaction, who);
    entries.push({ kind: 'reply', stage: stageName, to: player.displayName, reply });
    return reply;
  }

  const readMatch = async (): Promise<PublicMatch> => {
    const response = await fetch(`${url}/matches/${encodeURIComponent(matchId)}`);
    const read = readPublicMatch(await response.json());
    if (!read.ok) throw new Error('the public match read failed');
    return read.value;
  };

  let entry0: { matchId: string; hostToken: string } | undefined;

  // --- The manager creates a client-only match on the dev map; the shell posts the lobby message (FR-540). ---
  const made = await stage('create', 0, async () => {
    // The command as Discord sends it: the guild id goes through the translation, so only its community key reaches the server (spec 024).
    const command = fromCommand('create', { map: 'dev', pace: 'fast' }, true, MANAGER.userId, GUILD_A);
    if (command === undefined) throw new Error('the create command was not translated');
    const reply = await bot.run(command);
    await waitFor(() => world.server.streams.openCount() === 1, 20_000, () => 'the follower stream did not open');
    return reply;
  });
  if (made.type !== 'channel') throw new Error(`the creation was not a channel reply: ${made.type}`);
  bot.sent(made, 'message-0');
  made.messages.forEach((m, i) => entries.push({ kind: 'post', stage: 'create', message: m, messageId: `message-0-${i}` }));
  const stored = bot.store.get(CHANNEL);
  if (stored === undefined) throw new Error('the bot stored no follow entry for the channel');
  entry0 = { matchId: stored.matchId, hostToken: stored.hostToken };
  const { matchId, hostToken } = entry0;
  if (hostToken === '') throw new Error('the bot stored no host token');

  // --- The creator starts it with the Start button; round 1 opens. ---
  const started = await stage('start', 1, () => bot.run({ type: 'button', customId: START_ID, canManage: true, userId: MANAGER.userId }));
  if (started.type !== 'text' || started.text !== STRINGS.started) throw new Error(`the start reply was not the started sentence: ${JSON.stringify(started)}`);

  // --- Every round: predictions in the open phases, the clock through the reveal, the close and the application. ---
  for (const r of PLAN) {
    await stage(`r${r.round}:predict1`, r.round, async () => {
      // One member goes through the Predict button first (the select offer is part of what the channel member sees).
      const first = PLAYERS[0]!;
      if (r.round === 1) {
        const offer = await interact(`r1:predict1`, first, { type: 'button', customId: PREDICT_ID, canManage: false, userId: first.userId });
        if (offer.type !== 'select') throw new Error(`the Predict press offered no select menu: ${JSON.stringify(offer)}`);
      }
      for (const p of PLAYERS) {
        const faction = r.pickVictim[p.userId];
        if (faction === undefined) continue;
        const reply = await interact(`r${r.round}:predict1`, p, { type: 'select', customId: pickId('victim', r.round), values: [String(faction)] });
        if (reply.type !== 'text' || !reply.text.startsWith('Elegido:')) throw new Error(`the victim pick of ${p.displayName} failed: ${JSON.stringify(reply)}`);
      }
    });

    await stage(`r${r.round}:reveal`, r.round, async () => {
      const before = await readMatch();
      if (before.stage !== 'phase-1' || before.schedule === undefined) throw new Error(`the stage before the reveal of round ${r.round} was ${before.stage}`);
      scheduler.runTo(before.schedule.c1);
    });

    if (!r.forced) {
      await stage(`r${r.round}:predict2`, r.round, async () => {
        const now = await readMatch();
        if (now.stage !== 'phase-2' || now.victim === undefined) throw new Error(`the stage before the phase-2 picks of round ${r.round} was ${now.stage}`);
        for (const p of PLAYERS) {
          const faction = r.pickAbsorber[p.userId];
          if (faction === undefined) continue;
          const reply = await interact(`r${r.round}:predict2`, p, { type: 'select', customId: pickId('absorber', r.round), values: [String(faction)] });
          if (reply.type !== 'text' || !reply.text.startsWith('Elegido:')) throw new Error(`the absorber pick of ${p.displayName} failed: ${JSON.stringify(reply)}`);
        }
      });
    }

    await stage(`r${r.round}:applied`, isLastRound(r.round) ? r.round : r.round + 1, async () => {
      const now = await readMatch();
      if ((now.stage !== 'phase-2' && now.stage !== 'locked') || now.schedule === undefined) throw new Error(`the stage before the application of round ${r.round} was ${now.stage}`);
      scheduler.runTo(now.schedule.c2);
      scheduler.runTo(now.schedule.a);
    });
  }

  // --- The match is over: nothing more may arrive, the channel is free and the stream closed. ---
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (bot.posts.length !== EXPECTED_POST_TEXTS.length) {
    throw new Error(`stray posts after the match: ${bot.posts.length} of ${EXPECTED_POST_TEXTS.length} expected`);
  }
  if (bot.store.get(CHANNEL) !== undefined) throw new Error('the channel still follows the finished match');
  await waitFor(() => world.server.streams.openCount() === 0, 20_000, () => 'the follower stream did not close at the end');

  const leaderboardResponse = await fetch(`${url}/matches/${encodeURIComponent(matchId)}/leaderboard?limit=500`);
  const leaderboardRead = readLeaderboardPage(await leaderboardResponse.json());
  if (!leaderboardRead.ok) throw new Error('the leaderboard read failed');

  // --- The history (spec 024 FR-562): the finished match is listed in its own server and in no other. ---
  async function ask(player: Player | undefined, guildId: string, to: string): Promise<Reply> {
    const userId = player?.userId ?? MANAGER.userId;
    const command = fromCommand('history', {}, false, userId, guildId);
    if (command === undefined) throw new Error('the history command was not translated');
    const who: Who = { channelId: CHANNEL, userId, ...(player === undefined ? {} : { displayName: player.displayName }) };
    const reply = await bot.run(command, who);
    entries.push({ kind: 'reply', stage: 'history', to, reply });
    return reply;
  }
  // The finish instant is the step's own: a match is listed once it is SETTLED, so the clock moves past `TOLERANCE_MS` before the read.
  const unsettled = await ask(PLAYERS[0], GUILD_A, 'Ana (recién terminada)');
  world.server.clock.advance(TOLERANCE_MS + 1);
  const listed = await ask(PLAYERS[0], GUILD_A, 'Ana');
  const zeroPoints = await ask(PLAYERS[3], GUILD_A, 'Diego');
  const outsider = await ask(undefined, GUILD_A, 'quien no jugó');
  const otherServer = await ask(PLAYERS[0], GUILD_B, 'Ana (otro servidor)');

  return {
    world,
    matchId,
    mapId: 'dev',
    viewerMatchUrl: lobbyLink(VIEWER_URL, matchId) ?? VIEWER_URL,
    hostToken,
    entries,
    posts: [...bot.posts],
    edits: [...bot.edits],
    violations,
    checkedPosts,
    leaderboard: leaderboardRead.value.items,
    history: { unsettled, listed, zeroPoints, outsider, otherServer },
  };
}
