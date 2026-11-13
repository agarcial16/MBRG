import { describe, expect, it } from 'vitest';
import type { LeaderboardRow } from '@mbrg/protocol';
import type { LiveModel } from '../src/core/live-model';
import {
  initialPlay,
  pageBoard,
  pageWinners,
  playHud,
  toggleWinners,
  withBoard,
  withNotice,
  withOwn,
  withReply,
  withScores,
  withSending,
  withWinners,
  type PlayState,
} from '../src/core/play-view';
import { Driver, MATCH_ID, eventsOfRound, scripted } from './helpers/scripted-match';

const ME = 'player:Ab3_x-9.Qz1k';
const factions = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `F${i + 1}` }));
const row = (rank: number, playerId: string, total: number, name?: string): LeaderboardRow => ({
  rank, playerId, total, correctVictims: 0, correctAbsorbers: 0, correctWinner: 0, ...(name === undefined ? {} : { name }),
});

async function model(phase: 1 | 2): Promise<LiveModel> {
  const s = await scripted();
  const d = new Driver(s, MATCH_ID);
  await d.load(0);
  if (phase === 2) await d.events(eventsOfRound(s, 1).slice(0, 3));
  return d.model;
}

const hud = (state: PlayState, m: LiveModel, extra: { joined?: boolean; revealing?: boolean; at?: number } = {}) =>
  playHud({ state, model: m, player: extra.joined === false ? undefined : { playerId: ME }, factions, revealing: extra.revealing ?? false, at: extra.at ?? 10_000 });

describe('FR-401 FR-402 the prediction block', () => {
  it('FR-401 phase 1 lists the living factions by name with none selected and no seal', async () => {
    const m = await model(1);
    const view = hud(initialPlay, m).predict!;
    expect(view.title).toBe('Tu predicción');
    expect(view.choices.length).toBeGreaterThan(1);
    expect(view.choices.every((c) => !c.selected && c.name === `F${c.faction}`)).toBe(true);
    expect(view.seal).toBeUndefined();
    expect(view.line).toContain('Ronda 1');
  });

  it('FR-401 a stored choice is selected, sealed with its name, and a change moves the selection', async () => {
    const m = await model(1);
    const first = hud(initialPlay, m).predict!.choices;
    const a = first[0]!.faction;
    const b = first[1]!.faction;
    let state = withReply(initialPlay, { kind: 'victim', round: 1, choice: a, version: 1 });
    expect(hud(state, m).predict!.choices.find((c) => c.selected)?.faction).toBe(a);
    expect(hud(state, m).predict!.seal).toBe(`Enviada: F${a}`);
    state = withReply(state, { kind: 'victim', round: 1, choice: b, version: 2 });
    expect(hud(state, m).predict!.choices.filter((c) => c.selected).map((c) => c.faction)).toStrictEqual([b]);
  });

  it('FR-401 the choices read from the server at the start fill the selection too', async () => {
    const m = await model(1);
    const a = hud(initialPlay, m).predict!.choices[2]!.faction;
    const state = withOwn(initialPlay, [{ playerId: 'x', kind: 'victim', round: 1, choice: a, version: 1 }]);
    expect(hud(state, m).predict!.choices.find((c) => c.selected)?.faction).toBe(a);
  });

  it('FR-402 an earlier round choice does not mark the current round', async () => {
    const m = await model(1);
    const a = hud(initialPlay, m).predict!.choices[0]!.faction;
    const state = withReply(initialPlay, { kind: 'victim', round: 5, choice: a, version: 1 });
    expect(hud(state, m).predict!.choices.some((c) => c.selected)).toBe(false);
    expect(hud(state, m).predict!.seal).toBeUndefined();
  });

  it('FR-402 phase 2 lists only the candidates; a forced round lists none and says so', async () => {
    const m = await model(2);
    const many = { ...m, victim: { ...m.victim!, candidates: [3, 8, 5] } };
    expect(hud(initialPlay, many).predict!.choices.map((c) => c.faction).sort((x, y) => x - y)).toStrictEqual([3, 5, 8]);
    const forced = { ...m, victim: { ...m.victim!, candidates: [4], forced: true as const } };
    const view = hud(initialPlay, forced).predict!;
    expect(view.choices).toStrictEqual([]);
    expect(view.line).toContain('Absorbente forzado');
    expect(view.line).toContain('F4');
    expect(view.seal).toBeUndefined();
  });

  it('FR-404 failures keep the choice and show one sentence; a reply clears it', async () => {
    const m = await model(1);
    const a = hud(initialPlay, m).predict!.choices[0]!.faction;
    let state = withReply(initialPlay, { kind: 'victim', round: 1, choice: a, version: 1 });
    state = withNotice(withSending(state, true), 'No se pudo');
    const view = hud(state, m).predict!;
    expect(view.notice).toBe('No se pudo');
    expect(view.sending).toBe(false);
    expect(view.choices.find((c) => c.selected)?.faction).toBe(a);
    expect(hud(withReply(state, { kind: 'victim', round: 1, choice: a, version: 2 }), m).predict!.notice).toBeUndefined();
    expect(hud(withSending(initialPlay, true), m).predict!.sending).toBe(true);
  });

  it('FR-404 a spectator has no block until a tap gives a reason; a replay and a closed phase offer nothing', async () => {
    const m = await model(1);
    expect(hud(initialPlay, m, { joined: false }).predict).toBeUndefined();
    const noted = hud(withNotice(initialPlay, 'Solo estás mirando'), m, { joined: false }).predict!;
    expect(noted.notice).toBe('Solo estás mirando');
    expect(noted.choices).toStrictEqual([]);
    const replay = { ...m, applied: 3, displayed: 2, held: new Map(m.held).set(3, m.held.get(0)!) };
    const behind = hud(initialPlay, replay).predict!;
    expect(behind.choices).toStrictEqual([]);
    expect(behind.line).toContain('anterior');
    expect(hud(initialPlay, { ...m, stage: 'locked' }).predict!.choices).toStrictEqual([]);
  });

  it('FR-405 the countdown of the open phase runs from the server clock offset and is absent when closed or manual', async () => {
    const m = await model(1);
    const timed: LiveModel = { ...m, timing: { i: 60, l1: 30, l2: 15 }, schedule: { c1: m.reported.value + 30_000, c2: m.reported.value + 60_000, a: m.reported.value + 75_000 } };
    expect(hud(initialPlay, timed, { at: m.reported.at }).predict!.countdown).toBe('0:30');
    expect(hud(initialPlay, timed, { at: m.reported.at + 10_000 }).predict!.countdown).toBe('0:20');
    expect(hud(initialPlay, m).predict!.countdown).toBeUndefined();
    expect(hud(initialPlay, { ...timed, stage: 'locked' }).predict!.countdown).toBeUndefined();
  });

  it('FR-409 the absorber choice waits while the victim reveal runs', async () => {
    const m = await model(2);
    const view = hud(initialPlay, m, { revealing: true }).predict!;
    expect(view.choices).toStrictEqual([]);
    expect(view.line).toContain('revelando');
  });
});

describe('FR-406 chip, results panel and leaderboard', () => {
  const scored = { total: 20, items: [{ kind: 'victim' as const, round: 2, choice: 4, correct: true, points: 10 }], name: 'Ana' };

  it('FR-406 before any score the chip has the name only and there is no results panel', async () => {
    const m = await model(1);
    const out = hud(initialPlay, m);
    expect(out.chip).toBe('Tú: Ab3_x-9.Qz1k');
    expect(out.result).toBeUndefined();
    expect(hud(withScores(initialPlay, { total: 0, items: [], name: 'Ana' }), m).chip).toBe('Tú: Ana');
  });

  it('FR-406 after a scored phase the chip has total and rank and the panel the right/wrong line', async () => {
    const m = await model(1);
    const state = withBoard(withScores(initialPlay, scored), [row(1, 'player:zz', 40, 'Zed'), row(2, ME, 20, 'Ana')]);
    const out = hud(state, m);
    expect(out.chip).toBe('Tú: Ana · 20 pts · puesto 2');
    expect(out.result!.right).toBe(true);
    expect(out.result!.lines.join(' ')).toContain('Total: 20');
  });

  it('FR-406 a spectator sees the leaderboard but no chip and no personal result', async () => {
    const m = await model(1);
    const state = withBoard(withScores(initialPlay, scored), [row(1, 'player:zz', 40, 'Zed')]);
    const out = hud(state, m, { joined: false });
    expect(out.chip).toBeUndefined();
    expect(out.result).toBeUndefined();
    expect(out.board!.rows).toStrictEqual([{ rank: 1, name: 'Zed', total: 40, me: false }]);
  });

  it('FR-406 the leaderboard has names, highlights the player and pages', async () => {
    const m = await model(1);
    const rows = Array.from({ length: 25 }, (_, i) => row(i + 1, i === 12 ? ME : `player:p${i}`, 100 - i, `N${i}`));
    let state = withBoard(initialPlay, rows);
    expect(hud(state, m).board!.rows.filter((r) => r.me)).toStrictEqual([]);
    state = pageBoard(state, 1);
    expect(hud(state, m).board!.rows.find((r) => r.me)).toMatchObject({ name: 'N12', rank: 13 });
    expect(hud(state, m).board!.pages).toBe(3);
    expect(hud(pageBoard(state, -9), m).board!.page).toBe(0);
  });
});

describe('FR-407 who guessed right under the chronicle', () => {
  it('FR-407 a scored phase with names gets a line under its round, in phase order', async () => {
    const m = await model(1);
    let state = withWinners(initialPlay, { round: 3, phase: 2 }, ['Ana']);
    state = withWinners(state, { round: 3, phase: 1 }, ['Ana', 'Beto', 'Cleo', 'Dani', 'Eva']);
    const lines = hud(state, m).winners.get(3)!;
    expect(lines.map((l) => l.phase)).toStrictEqual([1, 2]);
    expect(lines[0]!.view.line).toContain('y 2 más');
    expect(lines[1]!.view.line).toBe('Acertaron el absorbente: Ana');
    expect(hud(initialPlay, m).winners.size).toBe(0);
  });

  it('FR-407 "ver todos" expands the list and pages it', async () => {
    const m = await model(1);
    const names = Array.from({ length: 25 }, (_, i) => `N${i}`);
    let state = withWinners(initialPlay, { round: 1, phase: 1 }, names);
    const key = '1:1';
    expect(hud(state, m).winners.get(1)![0]!.view.names).toStrictEqual([]);
    state = toggleWinners(state, key);
    expect(hud(state, m).winners.get(1)![0]!.view.names).toHaveLength(10);
    state = pageWinners(state, key, 1);
    expect(hud(state, m).winners.get(1)![0]!.view.names[0]).toBe('N10');
    expect(hud(pageWinners(state, key, -5), m).winners.get(1)![0]!.view.names[0]).toBe('N0');
    expect(hud(pageWinners(pageWinners(state, key, -5), key, 1), m).winners.get(1)![0]!.view.names[0]).toBe('N10');
    state = toggleWinners(state, key);
    expect(hud(state, m).winners.get(1)![0]!.view.names).toStrictEqual([]);
    state = toggleWinners(state, key);
    expect(hud(state, m).winners.get(1)![0]!.view.page).toBe(0);
  });
});
