// The scripted match of the e2e harness (spec 023 FR-540, FR-541): drives the REAL bot core (interactions in, replies out)
// and the REAL server's fake clock (the scheduler runs each phase transition at its scheduled instant), records everything
// the simulated channel shows — posts, edits, private replies — and checks secrecy live: before each stage's posts settle,
// no post may name a victim or absorber that the server has not revealed yet, carry the host token, or mention a round
// beyond the one that is open.
import { RANKING_ORDERS, readPublicMatch, readLeaderboardPage, readRankingPage } from '@mbrg/protocol';
import type { LeaderboardRow, PublicMatch, RankingOrder, RankingPage } from '@mbrg/protocol';
import { lobbyLink } from '../../src/core/announce';
import type { Interaction } from '../../src/core/actions';
import { PREDICT_ID, START_ID, pickId } from '../../src/core/custom-ids';
import type { OutMessage, Reply } from '../../src/core/model';
import { STRINGS } from '../../src/core/strings';
import type { Who } from '../../src/io/handler';
import { fromCommand } from '../../src/discord/translate';
import { TOLERANCE_MS } from '../../../server/src/core/time';
import { CREDENTIAL } from '../helpers/fake-server';
import { CHANNEL, GUILD_A, GUILD_B, KEY_A, MANAGER, waitFor } from '../helpers/harness';
import type { Edited, Posted } from '../helpers/harness';
import { EXPECTED_POST_TEXTS, PLAN, PLAN_B, PLAYERS } from './plan';
import type { RoundPlan } from './plan';
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
  /** The second finished match of the same server (spec 025 FR-572): its channel posts and its final leaderboard. */
  readonly second: SecondMatch;
  /** What `/mbrg ranking` answered after the two matches (spec 025 FR-572). */
  readonly ranking: RankingRun;
}

/** The second scripted match: played like the first against the same server and bot, its channel posts kept apart from the first match's. */
export interface SecondMatch {
  readonly matchId: string;
  readonly posts: readonly OutMessage[];
  readonly leaderboard: readonly LeaderboardRow[];
}

/** The replies of the ranking step: the same command in the server of the matches (A) and in another server (B). */
export interface RankingRun {
  /** In A, right after the second match finished: only the first match is settled, so the ranking holds the first match alone (asked by Ana, points). */
  readonly unsettled: Reply;
  /** In A, past `TOLERANCE_MS` after the second finish, asked by Ana: with no order word, then each order word. */
  readonly byWord: Readonly<Record<string, Reply>>;
  /** The same, in the accuracy order, asked by Diego (fewer than 10 scored predictions) and by a member who never predicted. */
  readonly unqualified: Reply;
  readonly outsider: Reply;
  /** In B: a server with no finished match. */
  readonly otherServer: Reply;
  /** The pages of the ranking of server A as the REAL server answers them (one request per order, asked by Ana): the statistics, ranks and shown names the bot's embed was built from. */
  readonly raw: Readonly<Record<RankingOrder, RankingPage>>;
  /** The same ranking in each time window (spec 027 FR-585), read right after the all-time reads: both finished matches are inside every window. */
  readonly windows: Readonly<Record<'semana' | 'mes', WindowRun>>;
  /** The windows read again after the REAL server's clock moved on (spec 027 NFR-131): the floor follows the server's clock. */
  readonly aged: AgedRun;
}

/** What the ranking step read in one window (spec 027 FR-585). */
export interface WindowRun {
  /** In A, asked by Ana: with no order word, then each order word. */
  readonly byWord: Readonly<Record<string, Reply>>;
  /** The accuracy order asked by Diego (fewer than 10 scored predictions) and by a member who never predicted. */
  readonly unqualified: Reply;
  readonly outsider: Reply;
  /** In B: a server with no finished match. */
  readonly otherServer: Reply;
  /** The pages of the window as the real server answers them, one request per order, asked by Ana. */
  readonly raw: Readonly<Record<RankingOrder, RankingPage>>;
  /** A walk of the points order two rows at a time, by cursor, from the real server. */
  readonly walk: readonly RankingPage[];
}

/** The replies of the aging step: the clock of the real server moved 8 days, then 23 more (31 in all). */
export interface AgedRun {
  readonly weekAfter8: Reply;
  readonly monthAfter8: Reply;
  readonly monthAfter31: Reply;
  readonly allTimeAfter31: Reply;
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

/** The second plan walks the same rounds as the first (the same seeds): only the picks differ, so the stages and their counts are the same. */
const sameRounds = PLAN_B.length === PLAN.length && PLAN_B.every((r, i) => r.victim === PLAN[i]!.victim && r.absorber === PLAN[i]!.absorber && r.forced === PLAN[i]!.forced && r.livingAfter === PLAN[i]!.livingAfter);
if (!sameRounds) throw new Error('the second plan does not walk the rounds of the first');

export async function playScriptedMatch(world: E2EWorld): Promise<MatchRun> {
  const { bot, scheduler, url } = world;
  const entries: RunEntry[] = [];
  const violations: string[] = [];
  const counts = expectedCounts();
  let checkedPosts = 0;
  // The match being played: its picks, what the channel already held when it began (posts and edits of the earlier match stay) and whether its
  // posts go to the transcript (only the first match's do).
  let plan: readonly RoundPlan[] = PLAN;
  let base = { posts: 0, edits: 0 };
  let recording = true;

  /** One named stage of the script: run its actions, wait for the exact channel counts, record and check what appeared. */
  async function stage<T>(name: string, round: number, body: () => Promise<T>): Promise<T> {
    const want = counts.get(name);
    if (want === undefined) throw new Error(`the plan has no stage ${name}`);
    const postsBefore = bot.posts.length;
    const editsBefore = bot.edits.length;
    const result = await body();
    const wantPosts = base.posts + want.posts;
    const wantEdits = base.edits + want.edits;
    const where = () => `${name}: ${bot.posts.length}/${wantPosts} posts, ${bot.edits.length}/${wantEdits} edits`;
    await waitFor(() => bot.posts.length === wantPosts, 20_000, where);
    await waitFor(() => bot.edits.length === wantEdits, 20_000, where);
    if (recording) {
      bot.posts.slice(postsBefore).forEach((p, i) => entries.push({ kind: 'post', stage: name, message: p.message, messageId: `message-${postsBefore + i + 1}` }));
      for (const e of bot.edits.slice(editsBefore)) entries.push({ kind: 'edit', stage: name, messageId: e.messageId, message: e.message });
    }
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
    if (recording) entries.push({ kind: 'reply', stage: stageName, to: player.displayName, reply });
    return reply;
  }

  const readMatch = async (): Promise<PublicMatch> => {
    const response = await fetch(`${url}/matches/${encodeURIComponent(entry0?.matchId ?? '')}`);
    const read = readPublicMatch(await response.json());
    if (!read.ok) throw new Error('the public match read failed');
    return read.value;
  };

  let entry0: { matchId: string; hostToken: string } | undefined;

  /** One whole match, from its creation to the final leaderboard: the stages of the plan being played. */
  async function playMatch(): Promise<{ matchId: string; hostToken: string; leaderboard: readonly LeaderboardRow[] }> {
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
    if (recording) made.messages.forEach((m, i) => entries.push({ kind: 'post', stage: 'create', message: m, messageId: `message-0-${i}` }));
    const stored = bot.store.get(CHANNEL);
    if (stored === undefined) throw new Error('the bot stored no follow entry for the channel');
    entry0 = { matchId: stored.matchId, hostToken: stored.hostToken };
    const { matchId, hostToken } = entry0;
    if (hostToken === '') throw new Error('the bot stored no host token');

    // --- The creator starts it with the Start button; round 1 opens. ---
    const started = await stage('start', 1, () => bot.run({ type: 'button', customId: START_ID, canManage: true, userId: MANAGER.userId }));
    if (started.type !== 'text' || started.text !== STRINGS.started) throw new Error(`the start reply was not the started sentence: ${JSON.stringify(started)}`);

    // --- Every round: predictions in the open phases, the clock through the reveal, the close and the application. ---
    for (const r of plan) {
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
    if (bot.posts.length !== base.posts + EXPECTED_POST_TEXTS.length) {
      throw new Error(`stray posts after the match: ${bot.posts.length - base.posts} of ${EXPECTED_POST_TEXTS.length} expected`);
    }
    if (bot.store.get(CHANNEL) !== undefined) throw new Error('the channel still follows the finished match');
    await waitFor(() => world.server.streams.openCount() === 0, 20_000, () => 'the follower stream did not close at the end');

    const leaderboardResponse = await fetch(`${url}/matches/${encodeURIComponent(matchId)}/leaderboard?limit=500`);
    const leaderboardRead = readLeaderboardPage(await leaderboardResponse.json());
    if (!leaderboardRead.ok) throw new Error('the leaderboard read failed');

    return { matchId, hostToken, leaderboard: leaderboardRead.value.items };
  }

  const firstMatch = await playMatch();
  const { matchId, hostToken } = firstMatch;
  const postsOfFirst = [...bot.posts];
  const editsOfFirst = [...bot.edits];

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

  // --- The second match of the same server (spec 025 FR-572): the same rounds, other picks; its posts are checked for secrecy like the first's. ---
  plan = PLAN_B;
  base = { posts: bot.posts.length, edits: bot.edits.length };
  recording = false;
  const secondMatch = await playMatch();
  const postsOfSecond = bot.posts.slice(base.posts).map((p) => p.message);

  // --- The ranking (spec 025 FR-572): asked right after the second finish, then once it is settled, in every order, by whoever asks. ---
  async function rank(player: Player | undefined, guildId: string, word: string | undefined, to: string, period?: string): Promise<Reply> {
    const userId = player?.userId ?? MANAGER.userId;
    const command = fromCommand('ranking', { ...(word === undefined ? {} : { order: word }), ...(period === undefined ? {} : { period }) }, false, userId, guildId);
    if (command === undefined) throw new Error('the ranking command was not translated');
    const who: Who = { channelId: CHANNEL, userId, ...(player === undefined ? {} : { displayName: player.displayName }) };
    const reply = await bot.run(command, who);
    entries.push({ kind: 'reply', stage: 'ranking', to, reply });
    return reply;
  }
  // Only the first match is settled now (the clock was moved past the tolerance before the second began); the second counts once settled too.
  const rankingUnsettled = await rank(PLAYERS[0], GUILD_A, undefined, 'Ana (recién terminada la segunda)');
  world.server.clock.advance(TOLERANCE_MS + 1);
  const byWord: Record<string, Reply> = {};
  for (const word of [undefined, STRINGS.orderPoints, STRINGS.orderCorrect, STRINGS.orderWins, STRINGS.orderAccuracy]) {
    byWord[word ?? 'default'] = await rank(PLAYERS[0], GUILD_A, word, `Ana (${word ?? 'sin orden'})`);
  }
  const unqualified = await rank(PLAYERS[3], GUILD_A, STRINGS.orderAccuracy, 'Diego (precisión)');
  const rankingOutsider = await rank(undefined, GUILD_A, STRINGS.orderPoints, 'quien no jugó');
  const rankingOtherServer = await rank(PLAYERS[0], GUILD_B, undefined, 'Ana (otro servidor)');
  // The same ranking straight from the server (the community key is the hash of the planted guild id; the credential the bot's own).
  const rawPage = async (body: Record<string, unknown>): Promise<RankingPage> => {
    const response = await fetch(`${url}/ranking`, {
      method: 'POST',
      headers: { authorization: `Bearer ${CREDENTIAL}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const read = readRankingPage(await response.json());
    if (!read.ok) throw new Error(`the ranking read of ${JSON.stringify(Object.keys(body))} failed`);
    return read.value;
  };
  const raw = {} as Record<RankingOrder, RankingPage>;
  for (const order of RANKING_ORDERS) raw[order] = await rawPage({ community: KEY_A, order, playerId: PLAYERS[0]!.userId, limit: 10 });

  // --- The ranking in each time window (spec 027 FR-585): the same command with the period word, after the two matches settled; both are inside every window. ---
  const windows = {} as Record<'semana' | 'mes', WindowRun>;
  for (const [word, period] of [[STRINGS.periodWeek, 'last-7-days'], [STRINGS.periodMonth, 'last-30-days']] as const) {
    const byWordInWindow: Record<string, Reply> = {};
    for (const order of [undefined, STRINGS.orderPoints, STRINGS.orderCorrect, STRINGS.orderWins, STRINGS.orderAccuracy]) {
      byWordInWindow[order ?? 'default'] = await rank(PLAYERS[0], GUILD_A, order, `Ana (${word}, ${order ?? 'sin orden'})`, word);
    }
    const unqualifiedInWindow = await rank(PLAYERS[3], GUILD_A, STRINGS.orderAccuracy, `Diego (${word}, precisión)`, word);
    const outsiderInWindow = await rank(undefined, GUILD_A, STRINGS.orderPoints, `quien no jugó (${word})`, word);
    const otherServerInWindow = await rank(PLAYERS[0], GUILD_B, undefined, `Ana (${word}, otro servidor)`, word);
    const rawInWindow = {} as Record<RankingOrder, RankingPage>;
    for (const order of RANKING_ORDERS) rawInWindow[order] = await rawPage({ community: KEY_A, order, period, playerId: PLAYERS[0]!.userId, limit: 10 });
    const walk: RankingPage[] = [];
    for (let cursor: string | undefined; walk.length < 10; ) {
      const next: RankingPage = await rawPage({ community: KEY_A, order: 'points', period, playerId: PLAYERS[0]!.userId, limit: 2, ...(cursor === undefined ? {} : { cursor }) });
      walk.push(next);
      cursor = next.next;
      if (cursor === undefined) break;
    }
    windows[word as 'semana' | 'mes'] = { byWord: byWordInWindow, unqualified: unqualifiedInWindow, outsider: outsiderInWindow, otherServer: otherServerInWindow, raw: rawInWindow, walk };
  }

  // --- The aging step (spec 027 NFR-131): the window is measured by the real server's clock, so moving that clock changes what a window holds. ---
  const DAY_MS = 86_400_000;
  world.server.clock.advance(8 * DAY_MS);
  const weekAfter8 = await rank(PLAYERS[0], GUILD_A, undefined, 'Ana (semana, 8 días después)', STRINGS.periodWeek);
  const monthAfter8 = await rank(PLAYERS[0], GUILD_A, undefined, 'Ana (mes, 8 días después)', STRINGS.periodMonth);
  world.server.clock.advance(23 * DAY_MS);
  const monthAfter31 = await rank(PLAYERS[0], GUILD_A, undefined, 'Ana (mes, 31 días después)', STRINGS.periodMonth);
  const allTimeAfter31 = await rank(PLAYERS[0], GUILD_A, undefined, 'Ana (siempre, 31 días después)');

  return {
    world,
    matchId,
    mapId: 'dev',
    viewerMatchUrl: lobbyLink(VIEWER_URL, matchId) ?? VIEWER_URL,
    hostToken,
    entries,
    posts: postsOfFirst,
    edits: editsOfFirst,
    violations,
    checkedPosts,
    leaderboard: firstMatch.leaderboard,
    history: { unsettled, listed, zeroPoints, outsider, otherServer },
    second: { matchId: secondMatch.matchId, posts: postsOfSecond, leaderboard: secondMatch.leaderboard },
    ranking: { unsettled: rankingUnsettled, byWord, unqualified, outsider: rankingOutsider, otherServer: rankingOtherServer, raw, windows, aged: { weekAfter8, monthAfter8, monthAfter31, allTimeAfter31 } },
  };
}
