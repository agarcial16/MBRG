import { describe, expect, it } from 'vitest';
import { encodeEvent } from '@mbrg/protocol';
import type { LeaderboardRow, PhaseWinner, PlayerResult, SubmissionBody } from '@mbrg/protocol';
import type { LiveModel } from '../src/core/live-model';
import type { PlayerCredentials } from '../src/core/play-token';
import { STRINGS } from '../src/core/strings';
import type { PlayNet, PlayRead } from '../src/ui/live-net';
import { createPlaySession } from '../src/ui/play-session';
import { Driver, MATCH_ID, eventsOfRound, scripted } from './helpers/scripted-match';

const TOKEN = 'T0kenT0kenT0kenT0kenT0kenT0ken_-';
const ME: PlayerCredentials = { playerId: 'player:Ab3_x-9.Qz1k', token: TOKEN };
const factions = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `F${i + 1}` }));
const idle = { revealing: false, absorbing: false };
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface Call {
  readonly name: string;
  readonly args: readonly unknown[];
}

/** A PlayNet that records every call and answers from the scripted fields. */
function fakeNet(script: {
  submit?: (body: SubmissionBody) => PlayRead<{ kind: 'victim' | 'absorber'; round: number; choice: number; version: number }>;
  results?: PlayerResult[];
  rows?: LeaderboardRow[];
  winners?: (round: number, phase: 1 | 2) => PhaseWinner[] | undefined;
} = {}): { net: PlayNet; calls: Call[] } {
  const calls: Call[] = [];
  let version = 0;
  const no = (): never => {
    throw new Error('not used');
  };
  const net: PlayNet = {
    config: no,
    create: no,
    join: no,
    start: no,
    players: no,
    async submit(matchId, token, body) {
      calls.push({ name: 'submit', args: [matchId, token, body] });
      if (script.submit !== undefined) return script.submit(body) as never;
      version += 1;
      return { ok: true, value: { kind: body.kind as 'victim', round: body.round as number, choice: body.faction, version } };
    },
    async ownPredictions(matchId, token, local) {
      calls.push({ name: 'ownPredictions', args: [matchId, token, local] });
      return { ok: true, value: [] };
    },
    async playerResults(matchId, playerId) {
      calls.push({ name: 'playerResults', args: [matchId, playerId] });
      return { ok: true, value: { total: 10, items: script.results ?? [], name: 'Ana' } };
    },
    async leaderboard(matchId) {
      calls.push({ name: 'leaderboard', args: [matchId] });
      return { ok: true, value: script.rows ?? [] };
    },
    async winners(matchId, round, phase) {
      calls.push({ name: 'winners', args: [matchId, round, phase] });
      const names = script.winners?.(round, phase);
      return names === undefined ? { ok: false, outcome: 'round-not-applied', status: 404 } : { ok: true, value: names };
    },
  };
  return { net, calls };
}

async function liveModel(phase: 1 | 2): Promise<LiveModel> {
  const s = await scripted();
  const d = new Driver(s, MATCH_ID);
  await d.load(0);
  if (phase === 2) await d.events(eventsOfRound(s, 1).slice(0, 3));
  return d.model;
}

function open(net: PlayNet, player: PlayerCredentials | 'spectator' = ME): { session: ReturnType<typeof createPlaySession>; changes: { count: number } } {
  const changes = { count: 0 };
  const session = createPlaySession({ matchId: MATCH_ID, net, player: player === 'spectator' ? undefined : player, factions, pageUrl: 'https://mbrg.test/', makeId: () => 'req-0123456789abcdef0123456789abcdef', changed: () => void (changes.count += 1) });
  return { session, changes };
}

const resultsFrame = (round: number, phase: 1 | 2): unknown => JSON.parse(encodeEvent({ type: 'results', seq: 99, round, phase }));
const submits = (calls: readonly Call[]): Call[] => calls.filter((c) => c.name === 'submit');

describe('FR-401 prediction from the HUD bar', () => {
  it('FR-401 a choice is sent at once with the player token, no confirm step, and shows as sent', async () => {
    const { net, calls } = fakeNet();
    const { session } = open(net);
    const model = await liveModel(1);
    const first = session.view(model, 0, idle).predict!.choices;
    session.handlers.onPick(first[1]!.faction);
    await tick();
    const sent = submits(calls);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.args[0]).toBe(MATCH_ID);
    expect(sent[0]!.args[1]).toBe(TOKEN);
    expect(sent[0]!.args[2]).toMatchObject({ kind: 'victim', round: 1, faction: first[1]!.faction, playerId: 'Ab3_x-9.Qz1k' });
    const view = session.view(model, 0, idle).predict!;
    expect(view.seal).toBe(`Enviada: F${first[1]!.faction}`);
    expect(view.choices.find((c) => c.selected)?.faction).toBe(first[1]!.faction);
  });

  it('FR-401 choosing another faction before the phase closes replaces the choice', async () => {
    const { net, calls } = fakeNet();
    const { session } = open(net);
    const model = await liveModel(1);
    const choices = session.view(model, 0, idle).predict!.choices;
    session.handlers.onPick(choices[0]!.faction);
    await tick();
    session.handlers.onPick(choices[2]!.faction);
    await tick();
    expect(submits(calls)).toHaveLength(2);
    expect(session.view(model, 0, idle).predict!.choices.filter((c) => c.selected).map((c) => c.faction)).toStrictEqual([choices[2]!.faction]);
  });

  it('FR-401 the own predictions are read at the start with the local id and fill the selection', async () => {
    const calls: Call[] = [];
    const { net } = fakeNet();
    const model = await liveModel(1);
    const target = open(net).session.view(model, 0, idle).predict!.choices[3]!.faction;
    const wrapped: PlayNet = {
      ...net,
      async ownPredictions(matchId, token, local) {
        calls.push({ name: 'ownPredictions', args: [matchId, token, local] });
        return { ok: true, value: [{ playerId: local, kind: 'victim', round: 1, choice: target, version: 1 }] };
      },
    };
    const { session } = open(wrapped);
    session.view(model, 0, idle);
    await tick();
    await tick();
    expect(calls).toStrictEqual([{ name: 'ownPredictions', args: [MATCH_ID, TOKEN, 'Ab3_x-9.Qz1k'] }]);
    expect(session.view(model, 0, idle).predict!.choices.find((c) => c.selected)?.faction).toBe(target);
  });

  it('FR-402 in phase 2 the absorber is chosen among the candidates; a faction outside them is refused with no request', async () => {
    const { net, calls } = fakeNet();
    const { session } = open(net);
    const base = await liveModel(2);
    const model: LiveModel = { ...base, victim: { ...base.victim!, candidates: [3, 8, 5] } };
    session.view(model, 0, idle);
    session.handlers.onPick(9);
    await tick();
    expect(submits(calls)).toHaveLength(0);
    expect(session.view(model, 0, idle).predict!.notice).toBe(STRINGS.predictNotChoosable);
    session.handlers.onPick(8);
    await tick();
    expect(submits(calls)[0]!.args[2]).toMatchObject({ kind: 'absorber', round: base.victim!.round, faction: 8 });
  });

  it('FR-403 a forced round has no choice and a pick sends nothing', async () => {
    const { net, calls } = fakeNet();
    const { session } = open(net);
    const base = await liveModel(2);
    const model: LiveModel = { ...base, victim: { ...base.victim!, candidates: [4], forced: true } };
    const view = session.view(model, 0, idle).predict!;
    expect(view.choices).toStrictEqual([]);
    expect(view.line).toContain('Absorbente forzado');
    session.handlers.onPick(4);
    await tick();
    expect(submits(calls)).toHaveLength(0);
    expect(session.view(model, 0, idle).predict!.notice).toBe(STRINGS.predictForcedNote);
  });
});

describe('FR-401 FR-404 prediction by a tap on the map', () => {
  it('FR-401 a tap on a living faction sends it like the bar does', async () => {
    const { net, calls } = fakeNet();
    const { session } = open(net);
    const model = await liveModel(1);
    const choices = session.view(model, 0, idle).predict!.choices;
    session.tap(choices[0]!.faction);
    await tick();
    expect(submits(calls)).toHaveLength(1);
    expect(submits(calls)[0]!.args[2]).toMatchObject({ faction: choices[0]!.faction });
  });

  it('FR-404 a tap on nothing while a phase is open says what to tap and sends nothing', async () => {
    const { net, calls } = fakeNet();
    const { session } = open(net);
    const model = await liveModel(1);
    session.view(model, 0, idle);
    session.tap(undefined);
    expect(submits(calls)).toHaveLength(0);
    expect(session.view(model, 0, idle).predict!.notice).toBe(STRINGS.predictTapNothing);
  });

  it('FR-404 a tap while no phase is open or in a replay does nothing but show the reason', async () => {
    const { net, calls } = fakeNet();
    const { session } = open(net);
    const model = await liveModel(1);
    session.view({ ...model, stage: 'locked' }, 0, idle);
    session.tap(3);
    expect(session.view({ ...model, stage: 'locked' }, 0, idle).predict!.notice).toBe(STRINGS.predictNoneClosed);
    const replay: LiveModel = { ...model, applied: 3, displayed: 2, held: new Map(model.held).set(3, model.held.get(0)!) };
    session.view(replay, 0, idle);
    session.tap(3);
    expect(session.view(replay, 0, idle).predict!.notice).toBe(STRINGS.predictNoneBehind);
    expect(submits(calls)).toHaveLength(0);
  });

  it('FR-404 a spectator tapping is told they only watch', async () => {
    const { net, calls } = fakeNet();
    const { session } = open(net, 'spectator');
    const model = await liveModel(1);
    session.view(model, 0, idle);
    session.tap(3);
    expect(session.view(model, 0, idle).predict!.notice).toBe(STRINGS.predictNoneNotJoined);
    expect(calls.map((c) => c.name)).not.toContain('submit');
    expect(calls.map((c) => c.name)).not.toContain('ownPredictions');
  });
});

describe('FR-404 a refused or failed submission', () => {
  it('FR-404 the previous choice stays, one sentence shows, and a retry works while the phase is open', async () => {
    let attempt = 0;
    const { net } = fakeNet({
      submit: (body) => {
        attempt += 1;
        if (attempt === 1) return { ok: true, value: { kind: 'victim', round: 1, choice: body.faction, version: 1 } };
        if (attempt === 2) return { ok: false, outcome: 'prediction-closed', status: 409 };
        if (attempt === 3) return { ok: false, outcome: 'network', status: undefined };
        return { ok: true, value: { kind: 'victim', round: 1, choice: body.faction, version: 2 } };
      },
    });
    const { session } = open(net);
    const model = await liveModel(1);
    const [a, b] = session.view(model, 0, idle).predict!.choices;
    session.handlers.onPick(a!.faction);
    await tick();
    session.handlers.onPick(b!.faction);
    await tick();
    let view = session.view(model, 0, idle).predict!;
    expect(view.notice).toBe(STRINGS.predictClosed);
    expect(view.choices.find((c) => c.selected)?.faction).toBe(a!.faction);
    session.handlers.onPick(b!.faction);
    await tick();
    view = session.view(model, 0, idle).predict!;
    expect(view.notice).toBe(STRINGS.createNetwork);
    expect(view.choices.find((c) => c.selected)?.faction).toBe(a!.faction);
    session.handlers.onPick(b!.faction);
    await tick();
    view = session.view(model, 0, idle).predict!;
    expect(view.notice).toBeUndefined();
    expect(view.choices.find((c) => c.selected)?.faction).toBe(b!.faction);
  });

  it('FR-404 a notice belongs to its phase: a new offer clears it', async () => {
    const { net } = fakeNet({ submit: () => ({ ok: false, outcome: 'prediction-closed', status: 409 }) });
    const { session } = open(net);
    const one = await liveModel(1);
    session.view(one, 0, idle);
    session.handlers.onPick(session.view(one, 0, idle).predict!.choices[0]!.faction);
    await tick();
    expect(session.view(one, 0, idle).predict!.notice).toBe(STRINGS.predictClosed);
    const two = await liveModel(2);
    expect(session.view(two, 0, idle).predict!.notice).toBeUndefined();
  });
});

describe('FR-406 FR-407 results, leaderboard and winners', () => {
  const rows: LeaderboardRow[] = [
    { rank: 1, playerId: 'player:zz', total: 30, correctVictims: 3, correctAbsorbers: 0, correctWinner: 0, name: 'Zed' },
    { rank: 2, playerId: ME.playerId, total: 10, correctVictims: 1, correctAbsorbers: 0, correctWinner: 0, name: 'Ana' },
  ];
  const mine: PlayerResult[] = [{ kind: 'victim', round: 1, choice: 4, correct: true, points: 10 }];

  it('FR-406 a results event reads the player rows, the leaderboard and the winners and shows chip, panel and board', async () => {
    const { net, calls } = fakeNet({ results: mine, rows, winners: (round, phase) => (round === 1 && phase === 1 ? [{ playerId: ME.playerId, name: 'Ana' }] : undefined) });
    const { session, changes } = open(net);
    const model = await liveModel(1);
    session.view(model, 0, idle);
    await tick();
    await tick();
    const before = changes.count;
    session.onFrame(resultsFrame(1, 1));
    await tick();
    await tick();
    expect(changes.count).toBeGreaterThan(before);
    const hud = session.view(model, 0, idle);
    expect(hud.chip).toBe('Tú: Ana · 10 pts · puesto 2');
    expect(hud.result!.right).toBe(true);
    expect(hud.board!.rows.map((r) => [r.name, r.me])).toStrictEqual([['Zed', false], ['Ana', true]]);
    expect(calls.filter((c) => c.name === 'winners').some((c) => c.args[1] === 1 && c.args[2] === 1)).toBe(true);
  });

  it('FR-407 the winners lines of the displayed round show names for the scored phases and none for a refused round', async () => {
    const { net } = fakeNet({ results: mine, rows, winners: (round, phase) => (round === 1 ? [{ playerId: 'player:zz', name: phase === 1 ? 'Zed' : 'Yan' }] : undefined) });
    const { session } = open(net);
    const base = await liveModel(1);
    const model: LiveModel = { ...base, applied: 1, displayed: 1, held: new Map(base.held).set(1, base.held.get(0)!) };
    session.view(model, 0, idle);
    await tick();
    await tick();
    const lines = session.view(model, 0, idle).winners.get(1)!;
    expect(lines.map((l) => l.phase)).toStrictEqual([1, 2]);
    expect(lines[0]!.view.line).toBe('Acertaron la víctima: Zed');
    expect(lines[1]!.view.line).toBe('Acertaron el absorbente: Yan');
    expect(session.view({ ...model, displayed: 0, applied: 1 }, 0, idle).winners.get(2)).toBeUndefined();
  });

  it('FR-407 a phase refused before it was scored gets its line once the results event arrives', async () => {
    let scoredNow = false;
    const { net } = fakeNet({ results: mine, rows, winners: (round, phase) => (scoredNow && round === 1 && phase === 2 ? [{ playerId: 'player:zz', name: 'Zed' }] : undefined) });
    const { session } = open(net);
    const base = await liveModel(1);
    const model: LiveModel = { ...base, applied: 1, displayed: 1, held: new Map(base.held).set(1, base.held.get(0)!) };
    session.view(model, 0, idle);
    await tick();
    await tick();
    expect(session.view(model, 0, idle).winners.size).toBe(0);
    scoredNow = true;
    session.view(model, 0, idle);
    await tick();
    expect(session.view(model, 0, idle).winners.size).toBe(0);
    session.onFrame(resultsFrame(1, 2));
    await tick();
    await tick();
    expect(session.view(model, 0, idle).winners.get(1)![0]!.view.line).toBe('Acertaron el absorbente: Zed');
  });

  it('FR-406 a forced round says the absorber was forced when its results arrive after the round was applied (real server order)', async () => {
    // The server applies the round (clearing the revealed victim) and only then announces `results` of phase 2; a forced round has no row.
    const { net } = fakeNet({ results: mine, rows });
    const { session } = open(net);
    const base = await liveModel(2);
    const forcedModel: LiveModel = { ...base, victim: { ...base.victim!, candidates: [4], forced: true } };
    session.view(forcedModel, 0, idle);
    await tick();
    await tick();
    const afterApply = { ...forcedModel, victim: undefined };
    const applied: LiveModel = afterApply;
    session.view(applied, 0, idle);
    session.onFrame(resultsFrame(1, 2));
    await tick();
    await tick();
    const hud = session.view(applied, 0, idle);
    expect(hud.result!.lines.join(' ')).toContain('forzado');
    expect(hud.result!.lines.join(' ')).not.toContain('No predijiste');
  });

  it('FR-409 nothing is read while a reveal is held, and it is read once the hold ends', async () => {
    const { net, calls } = fakeNet({ results: mine, rows });
    const { session } = open(net);
    const model = await liveModel(1);
    session.view(model, 0, { revealing: true, absorbing: false });
    await tick();
    await tick();
    const startCount = calls.length;
    session.onFrame(resultsFrame(1, 1));
    await tick();
    await tick();
    expect(calls.length).toBe(startCount);
    session.view(model, 0, { revealing: false, absorbing: false });
    await tick();
    await tick();
    expect(calls.slice(startCount).map((c) => c.name)).toContain('leaderboard');
    expect(calls.slice(startCount).map((c) => c.name)).toContain('playerResults');
  });

  it('FR-409 the finalised beat holds the reads too: scores that could name the victim wait for the end of the reveal tour, not just the beat', async () => {
    const { net, calls } = fakeNet({ results: mine, rows });
    const { session } = open(net);
    const model = await liveModel(1);
    session.view(model, 0, { revealing: false, absorbing: false, finalised: true });
    await tick();
    await tick();
    const startCount = calls.length;
    session.onFrame(resultsFrame(1, 1));
    await tick();
    await tick();
    expect(calls.length).toBe(startCount);
    // The beat ends and the tour starts in the same feed: still held.
    session.view(model, 0, { revealing: true, absorbing: false, finalised: false });
    await tick();
    expect(calls.length).toBe(startCount);
    session.view(model, 0, idle);
    await tick();
    await tick();
    expect(calls.slice(startCount).map((c) => c.name)).toContain('leaderboard');
  });

  it('FR-409 an absorber tour holds the reads too', async () => {
    const { net, calls } = fakeNet({ results: mine, rows });
    const { session } = open(net);
    const model = await liveModel(1);
    session.view(model, 0, { revealing: false, absorbing: true });
    await tick();
    await tick();
    const startCount = calls.length;
    session.onFrame(resultsFrame(1, 2));
    await tick();
    expect(calls.length).toBe(startCount);
  });

  it('FR-406 a spectator reads the leaderboard but never the player rows or the own predictions', async () => {
    const { net, calls } = fakeNet({ rows });
    const { session } = open(net, 'spectator');
    const model = await liveModel(1);
    session.view(model, 0, idle);
    await tick();
    await tick();
    expect(calls.map((c) => c.name)).toContain('leaderboard');
    expect(calls.map((c) => c.name)).not.toContain('playerResults');
    expect(session.view(model, 0, idle).chip).toBeUndefined();
  });

  it('FR-406 frames that are not results events read nothing', async () => {
    const { net, calls } = fakeNet({ rows });
    const { session } = open(net);
    const model = await liveModel(1);
    session.view(model, 0, idle);
    await tick();
    await tick();
    const count = calls.length;
    session.onFrame(JSON.parse(encodeEvent({ type: 'phase-closed', seq: 5, round: 1, phase: 1, at: 1 })));
    session.onFrame(null);
    await tick();
    expect(calls.length).toBe(count);
  });
});

describe('NFR-78 the player token', () => {
  it('NFR-78 the token appears in the arguments of the submission and the own-predictions read only', async () => {
    const { net, calls } = fakeNet({ rows: [] });
    const { session } = open(net);
    const model = await liveModel(1);
    session.handlers.onPick(session.view(model, 0, idle).predict!.choices[0]!.faction);
    session.onFrame(resultsFrame(1, 1));
    await tick();
    await tick();
    for (const call of calls) {
      const carries = JSON.stringify(call.args).includes(TOKEN);
      expect(carries, call.name).toBe(call.name === 'submit' || call.name === 'ownPredictions');
    }
  });
});
