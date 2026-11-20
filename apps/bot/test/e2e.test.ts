// The e2e test of spec 023: one scripted match, played by the REAL server (production routes, real service, store and dev
// map, a fake clock) and the REAL bot core with Discord faked at the poster, run once; each FR checks its own side of the
// same run. FR-540: the channel reads exactly the golden journey (any bot<->server contract drift fails here). FR-541: no
// post ever carries a future round (victim, absorber, round number, host token). FR-542/FR-543: the transcript and the
// embed preview the `npm run e2e` command renders from the same run.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PREDICT_ID } from '../src/core/custom-ids';
import { EMBED_COLORS } from '../src/core/embeds';
import type { OutMessage, Reply } from '../src/core/model';
import { STRINGS } from '../src/core/strings';
import { GUILD_A, GUILD_B, KEY_A, KEY_B } from './helpers/harness';
import { ANA_AFTER_FIRST, BOARD_B, EXPECTED_POST_TEXTS, FACTION_NAMES, PLAN, PLAN_B, PLAYERS, RANKING_ORDER, RANKING_PINS, askerLine, boardTextB, picksOf, rankingDescription } from './e2e/plan';
import type { RankOrder } from './e2e/plan';
import { renderEmbedsHtml, renderTranscript } from './e2e/render';
import { secrecyViolations } from './e2e/secrecy';
import { playScriptedMatch } from './e2e/script';
import type { MatchRun } from './e2e/script';
import { startWorld, VIEWER_URL } from './e2e/world';
import type { E2EWorld } from './e2e/world';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

describe('spec 023 e2e: real server + real bot core, Discord faked', () => {
  let world: E2EWorld | undefined;
  let run: MatchRun | undefined;

  beforeAll(async () => {
    world = await startWorld();
    run = await playScriptedMatch(world);
  });

  afterAll(async () => {
    await world?.close();
  });

  it('FR-540 plays a full scripted match against the real server: every announcement, in order, with the expected buttons, embeds and final leaderboard', () => {
    const r = run!;
    // Flow tests wait on real sockets: under CI load a late stray post must still be caught (lesson: settle first).
    expect(r.posts.length).toBe(EXPECTED_POST_TEXTS.length);
    expect(r.posts.map((p) => p.message.text)).toEqual([...EXPECTED_POST_TEXTS]);
    const matchId = r.matchId;
    const viewer = (round: number): string => `${VIEWER_URL}?match=${matchId}&round=${round}&spectate=1`;
    // The open phases carry the countdown label from the server's own schedule anchors, and the viewer link of the round.
    expect(r.posts[0]!.message.buttons).toEqual([
      { type: 'custom', customId: PREDICT_ID, label: 'Predecir · 15 s', style: 'primary' },
      { type: 'link', url: viewer(1), label: STRINGS.viewerButton },
    ]);
    expect(r.posts[1]!.message.buttons).toEqual([
      { type: 'custom', customId: PREDICT_ID, label: 'Predecir · 10 s', style: 'primary' },
      { type: 'link', url: viewer(1), label: STRINGS.viewerButton },
    ]);
    // A forced round offers nothing to press; the final board pages but is alone on its page.
    expect(r.posts[16]!.message.buttons).toEqual([]);
    expect(r.posts[20]!.message.buttons).toEqual([
      { type: 'custom', customId: 'mbrg:bd:p:1', label: STRINGS.boardPrev, style: 'primary', disabled: true },
      { type: 'custom', customId: 'mbrg:bd:n:1', label: STRINGS.boardNext, style: 'primary', disabled: true },
    ]);
    // The embeds: one colour and title per message kind (spec 017), the forced round names both factions.
    expect(r.posts[0]!.message.embed).toMatchObject({ color: EMBED_COLORS.opened, title: 'Ronda 1 abierta', fields: [] });
    expect(r.posts[1]!.message.embed).toMatchObject({ color: EMBED_COLORS.victim, title: 'Ronda 1: víctima revelada', fields: [{ name: 'Víctima', value: '**Francia**' }] });
    expect(r.posts[16]!.message.embed).toMatchObject({
      color: EMBED_COLORS.victim,
      title: 'Ronda 4: absorbente forzado',
      fields: [{ name: 'Víctima', value: '**Alemania**' }, { name: 'Absorbente', value: '**Italia**' }],
    });
    expect(r.posts[18]!.message.embed).toMatchObject({
      color: EMBED_COLORS.applied,
      title: 'Ronda 4 aplicada',
      fields: [{ name: 'Víctima', value: '**Alemania**' }, { name: 'Absorbente', value: '**Italia**' }, { name: 'Quedan', value: '1 facción' }],
    });
    expect(r.posts[19]!.message.embed).toMatchObject({ color: EMBED_COLORS.finished, title: STRINGS.embedFinishedTitle, fields: [{ name: 'Ganadora', value: '**Italia**' }] });
    expect(r.posts[20]!.message.embed).toMatchObject({ color: 0x9b59b6, title: STRINGS.boardTitle, footer: 'Página 1/1' });
    // Each open-phase message ended with its Predict button disabled (FR-465): seven countdowns, seven closing edits.
    expect(r.edits).toHaveLength(7);
    expect(r.edits[0]).toMatchObject({ messageId: 'message-1' });
    expect(r.edits[0]!.message.buttons[0]).toEqual({ type: 'custom', customId: PREDICT_ID, label: STRINGS.predictClosed, style: 'primary', disabled: true });
    // The server ranked the four named players (spec 022: the display names the predictions carried came back).
    expect(r.leaderboard.map((row) => [row.rank, row.playerId, row.total, row.name])).toEqual([
      [1, `discord:${PLAYERS[0]!.userId}`, 13, 'Ana'],
      [2, `discord:${PLAYERS[1]!.userId}`, 6, 'Bruno'],
      [3, `discord:${PLAYERS[2]!.userId}`, 3, 'Carla'],
      [4, `discord:${PLAYERS[3]!.userId}`, 0, 'Diego'],
    ]);
  });

  it('FR-541 keeps the future out of the channel: no victim or absorber before its reveal, no later round, no host token', () => {
    const r = run!;
    expect(r.violations).toEqual([]);
    // The checker saw every post of the run (both matches), not just a sample.
    expect(r.checkedPosts).toBe(r.posts.length + r.second.posts.length);
    // Nothing the channel ever showed (posts, edits, private replies) carries the host token.
    expect(JSON.stringify(r.entries)).not.toContain(r.hostToken);
    // The state file of the run holds no secret either once the match ended: the channel entry was retired.
    expect(readFileSync(r.world.statePath, 'utf8')).not.toContain(r.hostToken);
  });

  it('FR-562 the finished match is listed in the history of its own server, with the asker lines and the viewer link, and in no other server', () => {
    const r = run!;
    const messageOf = (reply: Reply): OutMessage => {
      expect(reply.type).toBe('channel');
      return (reply as Extract<Reply, { type: 'channel' }>).messages[0]!;
    };
    const listed = messageOf(r.history.listed);
    expect(listed.embed?.title).toBe(STRINGS.historyTitle);
    expect(listed.embed?.footer).toBe('Página 1/1');
    expect(listed.embed?.fields).toHaveLength(1);
    const [field] = listed.embed!.fields;
    // The oracle is another route: the public leaderboard of the match, read over HTTP by the run.
    const scored = r.leaderboard.filter((row) => row.total > 0);
    expect(scored.length).toBeGreaterThan(0);
    expect(field!.name).toMatch(/^#1 · <t:\d+:d> · dev$/);
    // The top compacted onto one line: medals for the first three scored rows, their position number for the rest.
    const medals = ['🥇', '🥈', '🥉'];
    const top = scored.slice(0, 5).map((row, i) => `${i < 3 ? medals[i] : `${i + 1}.`} <@${row.playerId.slice('discord:'.length)}> ${row.total}`).join(' · ') + (scored.length > 5 ? ` · y ${scored.length - 5} más` : '');
    expect(field!.value.split('\n')).toEqual([
      `Ganó **${FACTION_NAMES[PLAN[PLAN.length - 1]!.absorber]}** · ${r.leaderboard.length} jugadores`,
      top,
      `Tus puntos: ${r.leaderboard[0]!.total} (puesto 1) · [${STRINGS.viewerButton}](${VIEWER_URL}?match=${r.matchId}&spectate=1)`,
    ]);
    // Nothing to page: both buttons are disabled, and the message is not a walk the bot keeps.
    expect(listed.buttons.every((b) => b.type === 'custom' && b.disabled === true)).toBe(true);
    // A player with 0 points still has a row and a rank; a member who never predicted has none. Both carry the link on their line.
    const zero = r.leaderboard.find((row) => row.total === 0)!;
    const own = (reply: typeof r.history.zeroPoints) => messageOf(reply).embed?.fields[0]?.value ?? '';
    expect(own(r.history.zeroPoints)).toContain(`Tus puntos: 0 (puesto ${zero.rank}) · [${STRINGS.viewerButton}](${VIEWER_URL}?match=${r.matchId}&spectate=1)`);
    expect(own(r.history.outsider)).toContain(`${STRINGS.historyNotPlayed} · [${STRINGS.viewerButton}](${VIEWER_URL}?match=${r.matchId}&spectate=1)`);
    // Another server of the same bot sees nothing: one sentence, no embed, no buttons.
    expect(messageOf(r.history.otherServer)).toEqual({ text: STRINGS.historyEmpty, buttons: [] });
  });

  it('FR-562 FR-561 right after the finish the match is not listed yet (its finish instant is not more than the tolerance behind the clock): the same sentence as an empty history', () => {
    expect(run!.history.unsettled).toEqual({ type: 'channel', messages: [{ text: STRINGS.historyEmpty, buttons: [] }] });
  });

  it('NFR-118 FR-548 the raw guild ids and the community keys are in no post, edit, reply or file of the run', () => {
    const r = run!;
    const everything = JSON.stringify([r.posts, r.edits, r.second.posts, r.entries.map((e) => (e.kind === 'reply' ? e.reply : e.message))]) + readFileSync(r.world.statePath, 'utf8');
    for (const secret of [GUILD_A, GUILD_B, KEY_A, KEY_B]) expect(everything, secret).not.toContain(secret);
  });

  it('FR-572 the second match of the same server runs the same journey with other picks: every announcement, the secrecy checker clean, and its own final board', () => {
    const r = run!;
    expect(r.second.matchId).not.toBe(r.matchId);
    expect(r.second.posts).toHaveLength(EXPECTED_POST_TEXTS.length);
    // Nothing differs from the first match but who guessed right: the announcements without winners are the same sentences.
    expect(r.second.posts[0]!.text).toBe(EXPECTED_POST_TEXTS[0]);
    expect(r.second.posts.at(-2)!.text).toBe(EXPECTED_POST_TEXTS.at(-2));
    expect(r.second.posts.at(-1)!.text).toBe(boardTextB);
    expect(r.second.leaderboard.map((row) => [row.rank, row.playerId.slice('discord:'.length), row.total])).toEqual(BOARD_B.map(([userId, rank, points]) => [rank, userId, points]));
    // A 0-point player still has a row: she played.
    expect(r.second.leaderboard.at(-1)).toMatchObject({ total: 0, name: 'Ana' });
  });

  it('FR-572 the pinned statistics of the plan are the sums of what the public leaderboards of the two matches say, and the scored counts are counted from the plans themselves (an oracle that shares nothing with the ranking code)', () => {
    const r = run!;
    for (const pin of RANKING_PINS) {
      const id = `discord:${pin.userId}`;
      const rows = [r.leaderboard, r.second.leaderboard].map((board) => board.find((row) => row.playerId === id)!);
      expect(rows.reduce((n, row) => n + row.total, 0), `${id} points`).toBe(pin.points);
      expect(rows.reduce((n, row) => n + row.correctVictims + row.correctAbsorbers + row.correctWinner, 0), `${id} correct`).toBe(pin.correct);
      // Won: the highest points of a match, above 0 (a tie wins for all).
      const won = [r.leaderboard, r.second.leaderboard].filter((board) => {
        const best = Math.max(...board.map((row) => row.total));
        return best > 0 && board.find((row) => row.playerId === id)!.total === best;
      }).length;
      expect(won, `${id} won`).toBe(pin.won);
      // Scored and played, counted from the scripted picks (the leaderboards carry no count of scored predictions, and the
      // 10-prediction qualification of the accuracy order hangs on this number).
      expect(picksOf(PLAN, pin.userId) + picksOf(PLAN_B, pin.userId), `${id} scored`).toBe(pin.scored);
      expect([PLAN, PLAN_B].filter((p) => picksOf(p, pin.userId) > 0).length, `${id} played`).toBe(pin.played);
    }
  });

  const messageOfReply = (reply: Reply): OutMessage => {
    expect(reply.type).toBe('channel');
    return (reply as Extract<Reply, { type: 'channel' }>).messages[0]!;
  };
  const WORDS: readonly [string, RankOrder][] = [['default', 'points'], [STRINGS.orderPoints, 'points'], [STRINGS.orderCorrect, 'correct'], [STRINGS.orderWins, 'wins'], [STRINGS.orderAccuracy, 'accuracy']];

  it('FR-572 NFR-126 after two finished matches the ranking is read in every order: each row, rank, statistic, the note, the asker line and the page indicator are the pinned ones', () => {
    const r = run!;
    for (const [word, order] of WORDS) {
      const message = messageOfReply(r.ranking.byWord[word]!);
      expect(message.embed?.title, word).toBe('Ranking del servidor');
      expect(message.embed?.description?.split('\n'), word).toEqual(rankingDescription(order));
      expect(message.embed?.footer, word).toBe('Página 1/1');
      const own = askerLine(order, PLAYERS[0]!.userId);
      expect(message.embed?.fields, word).toEqual(own === undefined ? [] : [{ name: 'Tu puesto', value: own }]);
      // One page: the buttons are there, disabled, and the message is not a walk the bot keeps.
      expect(message.buttons.every((b) => b.type === 'custom' && b.disabled === true), word).toBe(true);
      expect(message.ranking, word).toBeUndefined();
      expect(message.text, word).toContain(rankingDescription(order).join('\n'));
    }
    // The asker's place differs from order to order (pinned by hand): 4th in points, 3rd in correct and in accuracy, 1st in wins.
    expect(['points', 'correct', 'wins', 'accuracy'].map((o) => askerLine(o as RankOrder, PLAYERS[0]!.userId)?.split(' · ')[0])).toEqual(['Puesto 4', 'Puesto 3', 'Puesto 1', 'Puesto 3']);
  });

  it('FR-572 the accuracy order ranks only who has at least 10 scored predictions: Carla with exactly 10 is ranked, Diego with exactly 9 is in the tail with a dash, after the note, and has no "Tu puesto" line', () => {
    const r = run!;
    const message = messageOfReply(r.ranking.unqualified);
    const lines = message.embed!.description!.split('\n');
    expect(lines).toEqual(rankingDescription('accuracy'));
    expect(lines.slice(-2)).toEqual(['Menos de 10 predicciones: sin puesto en precisión', '— <@444444444444444444> - precisión 44 % · 15 pts · aciertos 4/9 · victorias 0 · partidas 2']);
    expect(lines[1]).toContain('<@333333333333333333> - precisión 50 % · 16 pts · aciertos 5/10');
    // Floor, not rounding: 4 of 14 is 28 %, 9 of 13 is 69 %.
    expect(lines[0]).toContain('precisión 69 %');
    expect(lines[2]).toContain('precisión 28 %');
    expect(message.embed!.fields).toEqual([]);
  });

  it('FR-572 a member who never predicted gets the sentence that they have not played a finished match here; another server gets the empty reply', () => {
    const r = run!;
    expect(messageOfReply(r.ranking.outsider).embed?.fields).toEqual([{ name: 'Tu puesto', value: STRINGS.rankingNotPlayed }]);
    expect(messageOfReply(r.ranking.otherServer)).toEqual({ text: STRINGS.rankingEmpty, buttons: [] });
  });

  it('FR-572 the server rows the embeds come from carry the pinned statistics, ranks and shown names in every order, and the asker line', () => {
    const r = run!;
    const names = new Map(PLAYERS.map((p) => [`discord:${p.userId}`, p.displayName]));
    for (const order of ['points', 'correct', 'wins', 'accuracy'] as const) {
      const page = r.ranking.raw[order];
      expect(page.total, order).toBe(4);
      expect(page.next, order).toBeUndefined();
      expect(page.items.map((row) => [row.playerId.slice('discord:'.length), row.rank]), order).toEqual(RANKING_ORDER[order].map(([userId, rank]) => [userId, rank]));
      for (const row of page.items) {
        const pin = RANKING_PINS.find((p) => `discord:${p.userId}` === row.playerId)!;
        expect([row.points, row.correct, row.scored, row.played, row.won], `${order} ${row.playerId}`).toEqual([pin.points, pin.correct, pin.scored, pin.played, pin.won]);
        expect(row.name, `${order} ${row.playerId}`).toBe(names.get(row.playerId));
      }
      const pin = RANKING_PINS[0]!;
      const rank = RANKING_ORDER[order].find(([userId]) => userId === pin.userId)![1];
      expect(page.asker, order).toEqual({ points: pin.points, correct: pin.correct, scored: pin.scored, played: pin.played, won: pin.won, ...(rank === undefined ? {} : { rank }) });
    }
  });

  it('FR-572 FR-561 right after the second match finishes only the first is settled: the ranking holds the first match alone, as the history does', () => {
    const message = messageOfReply(run!.ranking.unsettled);
    const lines = message.embed!.description!.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(ANA_AFTER_FIRST);
    expect(message.embed!.description).not.toContain('partidas 2');
  });

  // --- Spec 027 FR-585: the same ranking in each time window, read after the two finished matches of the run (both are in every window) ---
  const WINDOWS = [['semana', 'last-7-days', 7], ['mes', 'last-30-days', 30]] as const;

  it('FR-585 each window (semana, mes) read after the two finished matches lists the same rows as all time in every order, titled with its window: each row, rank, statistic, the note, the asker line and the page indicator are the pinned ones', () => {
    const r = run!;
    for (const [word, , days] of WINDOWS) {
      for (const [orderWord, order] of WORDS) {
        const message = messageOfReply(r.ranking.windows[word].byWord[orderWord]!);
        const label = `${word} ${orderWord}`;
        expect(message.embed?.title, label).toBe(`Ranking del servidor · últimos ${days} días`);
        // The rows and the footer are the all-time ones, and the pinned ones of the plans: the window cuts nothing here.
        expect(message.embed?.description, label).toBe(messageOfReply(r.ranking.byWord[orderWord]!).embed?.description);
        expect(message.embed?.description?.split('\n'), label).toEqual(rankingDescription(order));
        expect(message.embed?.footer, label).toBe('Página 1/1');
        const own = askerLine(order, PLAYERS[0]!.userId);
        expect(message.embed?.fields, label).toEqual(own === undefined ? [] : [{ name: 'Tu puesto', value: own }]);
        expect(message.buttons.every((b) => b.type === 'custom' && b.disabled === true), label).toBe(true);
        expect(message.ranking, label).toBeUndefined();
        expect(message.text.split('\n')[0], label).toBe(`Ranking del servidor · últimos ${days} días`);
      }
    }
    // The all-time title stays the plain one.
    expect(messageOfReply(r.ranking.byWord.default!).embed?.title).toBe('Ranking del servidor');
  });

  it('FR-585 in each window Diego (9 scored predictions inside it) is in the accuracy tail after the note with no "Tu puesto" line, and a member who never predicted gets the sentence of the window', () => {
    const r = run!;
    for (const [word, , days] of WINDOWS) {
      const unqualified = messageOfReply(r.ranking.windows[word].unqualified);
      expect(unqualified.embed!.description!.split('\n'), word).toEqual(rankingDescription('accuracy'));
      expect(unqualified.embed!.fields, word).toEqual([]);
      expect(messageOfReply(r.ranking.windows[word].outsider).embed?.fields, word).toEqual([
        { name: 'Tu puesto', value: `No has jugado ninguna partida terminada en este servidor en los últimos ${days} días.` },
      ]);
    }
  });

  it('FR-585 another server asks the same windows and gets the empty sentence of each, with no embed and no buttons', () => {
    const r = run!;
    for (const [word, , days] of WINDOWS) {
      expect(messageOfReply(r.ranking.windows[word].otherServer), word).toEqual({ text: `Nadie ha jugado una partida terminada en este servidor en los últimos ${days} días.`, buttons: [] });
    }
  });

  it('FR-585 the server rows of each window carry the pinned statistics, ranks, shown names and asker line (the same as all time: both matches are inside), and a walk of the week paged two rows at a time by cursor lists the points order whole, with one total', () => {
    const r = run!;
    const names = new Map(PLAYERS.map((p) => [`discord:${p.userId}`, p.displayName]));
    for (const [word] of WINDOWS) {
      for (const order of ['points', 'correct', 'wins', 'accuracy'] as const) {
        const page = r.ranking.windows[word].raw[order];
        expect(page, `${word} ${order}`).toEqual(r.ranking.raw[order]);
        expect(page.total, `${word} ${order}`).toBe(4);
        expect(page.items.map((row) => [row.playerId.slice('discord:'.length), row.rank]), `${word} ${order}`).toEqual(RANKING_ORDER[order].map(([userId, rank]) => [userId, rank]));
        for (const row of page.items) {
          const pin = RANKING_PINS.find((p) => `discord:${p.userId}` === row.playerId)!;
          expect([row.points, row.correct, row.scored, row.played, row.won], `${word} ${order} ${row.playerId}`).toEqual([pin.points, pin.correct, pin.scored, pin.played, pin.won]);
          expect(row.name, `${word} ${order} ${row.playerId}`).toBe(names.get(row.playerId));
        }
      }
    }
    const walk = r.ranking.windows.semana.walk;
    expect(walk.map((p) => p.items.length)).toEqual([2, 2]);
    expect(walk.map((p) => p.total)).toEqual([4, 4]);
    expect(walk.flatMap((p) => p.items.map((row) => row.playerId.slice('discord:'.length)))).toEqual(RANKING_ORDER.points.map(([userId]) => userId));
    expect(walk[0]!.next).toBeDefined();
    expect(walk[1]!.next).toBeUndefined();
  });

  it('NFR-131 the floor of a window is the real server\'s injected clock, never the bot\'s: 8 days later the week is empty and the month still lists, 31 days later the month is empty too, and all time never changes', () => {
    const { aged } = run!.ranking;
    const plain = messageOfReply(run!.ranking.byWord.default!);
    expect(aged.weekAfter8).toEqual({ type: 'channel', messages: [{ text: 'Nadie ha jugado una partida terminada en este servidor en los últimos 7 días.', buttons: [] }] });
    const month8 = messageOfReply(aged.monthAfter8);
    expect(month8.embed?.title).toBe('Ranking del servidor · últimos 30 días');
    expect(month8.embed?.description).toBe(plain.embed?.description);
    expect(messageOfReply(aged.monthAfter31)).toEqual({ text: 'Nadie ha jugado una partida terminada en este servidor en los últimos 30 días.', buttons: [] });
    expect(messageOfReply(aged.allTimeAfter31).embed?.description).toBe(plain.embed?.description);
    expect(messageOfReply(aged.allTimeAfter31).embed?.title).toBe('Ranking del servidor');
  });

  it('FR-542 FR-543 renders the same run as a readable transcript and as an HTML page of the embeds', () => {
    const r = run!;
    const transcript = renderTranscript(r);
    expect(transcript).toContain(r.viewerMatchUrl);
    expect(transcript).toContain('[solo Ana] Elige la víctima.');
    expect(transcript).toContain('[solo Ana] Elegido: Francia.');
    expect(transcript).toContain('[canal] Ronda 1: la víctima es **Francia**');
    expect(transcript).toContain('[canal] Partida terminada. Ganadora: **Italia**.');
    expect(transcript).toContain(`[embed «Ronda 1: víctima revelada» · #e67e22]`);
    expect(transcript).toContain('[edición] mensaje message-1');
    const html = renderEmbedsHtml(r);
    expect(html).toContain('Ronda 1: víctima revelada');
    expect(html).toContain('border-left-color:#e67e22');
    expect(html).toContain('Predecir · 15 s');
    expect(html).toContain('Predecir · cerrado');
    expect(html).toContain('@Ana');
    expect(html).toContain(STRINGS.boardTitle);
    expect(html).toContain(STRINGS.viewerButton);
  });
});

// The checker must bite: each deliberate leak below (text, embed field, button label) has to be reported (FR-541).
describe('spec 023 e2e: the secrecy checker catches a leak', () => {
  const plain = (text: string) => ({ text, buttons: [] as never[] });
  it('names a victim before its reveal, in the text, an embed field or a button label', () => {
    expect(secrecyViolations('r1:predict1', 1, [plain('Ronda 1 abierta')], 'tok')).toEqual([]);
    expect(secrecyViolations('r1:predict1', 1, [plain('La víctima será España')], 'tok')).toHaveLength(1);
    const embed = { text: 'x', buttons: [], embed: { color: 1, title: 't', fields: [{ name: 'Víctima', value: '**Portugal**' }] } };
    expect(secrecyViolations('r1:predict1', 1, [embed as never], 'tok')).not.toEqual([]);
    const button = { text: 'x', buttons: [{ type: 'link', url: 'u', label: 'Ver Francia' }] };
    expect(secrecyViolations('r1:predict1', 1, [button as never], 'tok')).not.toEqual([]);
  });
  it('lets a name through once any role has revealed it, and flags a later absorber early', () => {
    expect(secrecyViolations('r1:reveal', 1, [plain('Ronda 1: la víctima es **Francia**')], 'tok')).toEqual([]);
    expect(secrecyViolations('r1:predict2', 1, [plain('absorbe Alemania')], 'tok')).not.toEqual([]);
    expect(secrecyViolations('r2:predict1', 2, [plain('Alemania sigue viva')], 'tok')).toEqual([]);
  });
  it('flags a later round number and the host token', () => {
    expect(secrecyViolations('r1:predict1', 1, [plain('Ronda 2 abierta')], 'tok')).toHaveLength(1);
    expect(secrecyViolations('r1:predict1', 1, [plain('clave tok')], 'tok')).toHaveLength(1);
  });
});
