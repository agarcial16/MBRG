// The e2e test of spec 023: one scripted match, played by the REAL server (production routes, real service, store and dev
// map, a fake clock) and the REAL bot core with Discord faked at the poster, run once; each FR checks its own side of the
// same run. FR-540: the channel reads exactly the golden journey (any bot<->server contract drift fails here). FR-541: no
// post ever carries a future round (victim, absorber, round number, host token). FR-542/FR-543: the transcript and the
// embed preview the `npm run e2e` command renders from the same run.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PREDICT_ID } from '../src/core/custom-ids';
import { EMBED_COLORS } from '../src/core/embeds';
import { STRINGS } from '../src/core/strings';
import { EXPECTED_POST_TEXTS, PLAYERS } from './e2e/plan';
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
    // The checker saw every post of the run, not just a sample.
    expect(r.checkedPosts).toBe(r.posts.length);
    // Nothing the channel ever showed (posts, edits, private replies) carries the host token.
    expect(JSON.stringify(r.entries)).not.toContain(r.hostToken);
    // The state file of the run holds no secret either once the match ended: the channel entry was retired.
    expect(readFileSync(r.world.statePath, 'utf8')).not.toContain(r.hostToken);
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
