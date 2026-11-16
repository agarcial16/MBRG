import { describe, expect, it } from 'vitest';
import { encodeEvent } from '@mbrg/protocol';
import type { LeaderboardRow } from '@mbrg/protocol';
import { STRINGS } from '../src/core/strings';
import type { LiveModel } from '../src/core/live-model';
import {
  initialPlay,
  initialPlayFor,
  pageWinners,
  playHud,
  toggleWinners,
  withBoardState,
  withJoined,
  withNotice,
  withOwn,
  withReply,
  withScores,
  withSending,
  withWinners,
  type PlayState,
} from '../src/core/play-view';
import { boardAfterPage, boardBegin, boardPlayers, boardView } from '../src/core/board-model';
import { Driver, MATCH_ID, eventsOfRound, scripted } from './helpers/scripted-match';

const ME = 'player:Ab3_x-9.Qz1k';
const factions = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `F${i + 1}` }));
const row = (rank: number, playerId: string, total: number, name?: string): LeaderboardRow => ({
  rank, playerId, total, correctVictims: 0, correctAbsorbers: 0, correctWinner: 0, ...(name === undefined ? {} : { name }),
});

/** The state with the first page of the leaderboard read (spec 019), as the session does. */
const withBoard = (state: PlayState, rows: readonly LeaderboardRow[], next?: string): PlayState =>
  withBoardState(state, boardAfterPage(boardBegin(state.board), { what: 'scored', cursor: undefined }, next === undefined ? { items: rows } : { items: rows, next }));
const withPlayers = (state: PlayState, items: readonly { playerId: string; name: string; joinedSeq: number }[]): PlayState => withBoardState(state, boardPlayers(state.board, items));
const listed = (state: PlayState, m: LiveModel, extra: { joined?: boolean } = {}) => {
  const view = hud(state, m, extra).board!;
  return Array.from({ length: view.count }, (_, i) => view.at(i));
};
const mine = initialPlayFor(ME);

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
    // FR-471: the notice that repeats the panel's own line is not drawn a second time.
    const same = hud(withNotice(initialPlay, STRINGS.predictNoneNotJoined), m, { joined: false }).predict!;
    expect(same.line).toBe(STRINGS.predictNoneNotJoined);
    expect(same.notice).toBeUndefined();
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
    expect(out.chip).toBe('Ab3_x-9.Qz1k · 0 pts');
    expect(out.chipParts).toStrictEqual({ name: 'Ab3_x-9.Qz1k', stats: ' · 0 pts' });
    expect(out.result).toBeUndefined();
    expect(hud(withScores(initialPlay, { total: 0, items: [], name: 'Ana' }), m).chip).toBe('Ana · 0 pts');
  });

  it('FR-406 after a scored phase the chip has total and rank and the panel the right/wrong line', async () => {
    const m = await model(1);
    const state = withBoard(withScores(mine, scored), [row(1, 'player:zz', 40, 'Zed'), row(2, ME, 20, 'Ana')]);
    const out = hud(state, m);
    expect(out.chip).toBe('Ana · 20 pts · 2.º');
    expect(out.chipParts).toStrictEqual({ name: 'Ana', stats: ' · 20 pts · 2.º' });
    expect(out.result!.right).toBe(true);
    expect(out.result!.lines.join(' ')).not.toContain('Total');
  });

  it('FR-432 every joined player is on the board with 0 points, and a new one shows when it joins', async () => {
    const m = await model(1);
    const joined = (n: number, seq: number) => ({ playerId: `player:P${n}b_x-9.Qz1k`, name: `P${n}`, joinedSeq: seq });
    const finished = (s: PlayState) => withBoardState(s, boardAfterPage(boardBegin(s.board), { what: 'roster', cursor: undefined }, { items: [] }));
    let state = finished(withPlayers(withBoard(mine, [row(1, 'player:P1b_x-9.Qz1k', 7, 'P1')]), [joined(1, 1), joined(2, 2)]));
    expect(listed(state, m).map((r) => [r.rank, r.name, r.total])).toStrictEqual([[1, 'P1', 7], [2, 'P2', 0]]);
    state = withJoined(state, JSON.parse(encodeEvent({ type: 'player-joined', seq: 5, playerId: 'player:P3b_x-9.Qz1k', name: 'P3' })));
    expect(listed(state, m).map((r) => [r.rank, r.name, r.total])).toStrictEqual([[1, 'P1', 7], [2, 'P2', 0], [2, 'P3', 0]]);
    expect(withJoined(state, JSON.parse(encodeEvent({ type: 'phase-closed', seq: 6, round: 1, phase: 1, at: 1 })))).toBe(state);
  });

  it('FR-432 before any read the board is empty; a joined player alone makes it', async () => {
    const m = await model(1);
    const state = withPlayers(mine, [{ playerId: ME, name: 'Ana', joinedSeq: 1 }]);
    expect(hud(state, m).board).toBeDefined();
    expect(hud(mine, m).board).toBeUndefined();
  });

  it('FR-433 the own row is the only one marked; before the list holds it, it is pinned with "-" as rank', async () => {
    const m = await model(1);
    const rows = Array.from({ length: 12 }, (_, i) => row(i + 1, `player:p${i}`, 50 - i, `N${i}`));
    const late = hud(withBoard(mine, rows, 'C1'), m).board!;
    expect(listed(withBoard(mine, rows, 'C1'), m).some((r) => r.me)).toBe(false);
    expect(late.mine).toStrictEqual({ row: { key: ME, rank: undefined, name: 'Ab3_x-9.Qz1k', total: 0, me: true }, index: undefined });
    const state = withBoard(mine, [...rows, row(13, ME, 1, 'Ana')]);
    expect(hud(state, m).board!.mine).toMatchObject({ row: { rank: 13, name: 'Ana', total: 1, me: true }, index: 12 });
    expect(listed(state, m).filter((r) => r.me).map((r) => r.key)).toStrictEqual([ME]);
  });

  it('FR-406 a spectator sees the leaderboard but no chip, no personal result and no pinned row', async () => {
    const m = await model(1);
    const state = withBoard(withScores(initialPlay, scored), [row(1, 'player:zz', 40, 'Zed')]);
    const out = hud(state, m, { joined: false });
    expect(out.chip).toBeUndefined();
    expect(out.result).toBeUndefined();
    expect(out.board!.mine).toBeUndefined();
    expect(out.board!.canGoMine).toBe(false);
    expect(listed(state, m, { joined: false })).toStrictEqual([{ key: 'player:zz', rank: 1, name: 'Zed', total: 40, me: false }]);
  });

  it('FR-406 the board view is the one of the model: the same rows, whatever the HUD tick', async () => {
    const m = await model(1);
    const state = withBoard(mine, Array.from({ length: 25 }, (_, i) => row(i + 1, i === 12 ? ME : `player:p${i}`, 100 - i, `N${i}`)));
    expect(hud(state, m).board!.version).toBe(boardView(state.board, { name: 'Ab3_x-9.Qz1k', total: 0 }).version);
    expect(hud(state, m, { at: 20_000 }).board!.version).toBe(hud(state, m).board!.version);
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
