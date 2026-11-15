import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadLobbyGolden, runLobbyTimeline } from './helpers/lobby-timelines';
import type { Flow, LobbyGolden, LobbyRun } from './helpers/lobby-timelines';
import { withTempDir } from './helpers/service-harness';

// The lobby goldens (spec 011 FR-390, FR-392): for the three dev secrets, a scripted public lobby (five joins in a fixed order
// with accented and edge-case names, the start, a sixth player who joins in the running match, predictions by player token
// and by client credential, the finish) gives the same events, public views, phase results with names, who-guessed-right lists,
// players results and leaderboard as golden/dev-lobby.json, however the match is driven: ticked on time or long after the
// anchors, stepped by the operator under `manual` timing, in memory or on a file with a restart after every join and every
// step. The golden is written only by the hand-run golden/generate-dev-lobby.ts (dev-secrets.json, the sim exports and its own
// arithmetic; nothing of src/core or the protocol encoders). A few figures are literals below.

const GOLDEN = loadLobbyGolden();
const NAMES = Object.keys(GOLDEN);

const expectSame = (run: LobbyRun, golden: LobbyGolden, where: string): void => {
  const o = run.observed;
  expect(o.lobbyEvents, `${where}: events`).toStrictEqual(run.operator ? golden.operatorEvents : golden.lobbyEvents);
  expect(o.lobbyViews, `${where}: public views`).toStrictEqual(run.operator ? golden.operatorViews : golden.lobbyViews);
  expect(o.phaseResults, `${where}: phase results`).toStrictEqual(golden.phaseResults);
  expect(o.winners, `${where}: who guessed right`).toStrictEqual(golden.winners);
  expect(o.players, `${where}: players`).toStrictEqual(golden.players);
  expect(o.leaderboard, `${where}: leaderboard`).toStrictEqual(golden.leaderboard);
  expect(run.order, `${where}: the order each read promises`).toStrictEqual({ phaseItems: true, winners: true, leaderboard: true, players: true });
  expect(run.tokensResolve, `${where}: every token resolves to its player`).toBe(true);
};

describe('the lobby golden', () => {
  it('FR-390 FR-392 the golden holds the three dev secrets, the roster in join order and the sizes of a 12-step match with six named players', () => {
    expect(NAMES).toStrictEqual(['ascending-00-1f', 'ascending-20-3f', 'all-a5']);
    for (const name of NAMES) {
      const g = GOLDEN[name]!;
      // The names as sent and as stored: the second is sent decomposed (7 UTF-16 units with the spaces) and stored composed (4).
      expect(g.roster.map((p) => p.name)).toStrictEqual(['Ana', 'José', 'Zoë-Ñ.9', 'ÉaÉaÉaÉaÉaÉaÉaÉaÉaÉaÉaÉa', 'X', 'Late Joiner']);
      expect(g.roster.map((p) => p.joinStep)).toStrictEqual([-1, -1, -1, -1, -1, 3]);
      expect(g.roster[1]!.sent).toHaveLength(7);
      expect(g.roster[1]!.name).toHaveLength(4);
      expect([...g.roster[3]!.name]).toHaveLength(24);
      expect(Object.keys(g.phaseResults)).toHaveLength(8);
      expect(Object.keys(g.winners)).toHaveLength(8);
      expect(Object.keys(g.players)).toHaveLength(9);
      // 36 events of the 12 steps, the lobby schedule, five joins, the start schedule and the late join; the operator flow has
      // no lobby schedule and no start schedule apart from the first event.
      expect(g.lobbyEvents).toHaveLength(44);
      expect(g.operatorEvents).toHaveLength(43);
      expect(g.lobbyEvents.slice(0, 7).map((e) => [e.seq, e.type])).toStrictEqual([[1, 'schedule'], [2, 'player-joined'], [3, 'player-joined'], [4, 'player-joined'], [5, 'player-joined'], [6, 'player-joined'], [7, 'schedule']]);
      expect(g.lobbyEvents[0]).toMatchObject({ stage: 'lobby' });
      expect(g.operatorEvents[0]).toMatchObject({ stage: 'phase-1' });
      expect(g.lobbyEvents.filter((e) => e.type === 'player-joined').map((e) => e.name)).toStrictEqual(g.roster.map((p) => p.name));
      // The late player joins between the application of round 1 and the phase-1 close of round 2.
      const late = g.lobbyEvents.findIndex((e) => e.name === 'Late Joiner');
      expect(g.lobbyEvents[late - 1]).toMatchObject({ type: 'schedule', stage: 'phase-1' });
      expect(g.lobbyEvents[late + 1]).toMatchObject({ type: 'phase-closed', round: 2, phase: 1 });
      expect(g.lobbyEvents.at(-1)).toMatchObject({ type: 'match-finished' });
      expect(g.lobbyViews).toHaveLength(20);
      expect(g.lobbyViews[0]).toStrictEqual({ label: 'created', stage: 'lobby', appliedRounds: 0, playerCount: 0, lastSeq: 1 });
      expect(g.lobbyViews[6]).toStrictEqual({ label: 'started', stage: 'phase-1', appliedRounds: 0, playerCount: 5, lastSeq: 7 });
      expect(g.operatorViews[0]).toStrictEqual({ label: 'created', stage: 'phase-1', appliedRounds: 0, playerCount: null, lastSeq: 1 });
      expect(g.lobbyViews.at(-1)).toMatchObject({ stage: 'finished', appliedRounds: 4, playerCount: 6, lastSeq: 44 });
      // X joined and never predicted: named on his empty page, off the leaderboard. The 24-character name sits on the board.
      expect(g.players['X']).toStrictEqual({ who: 'X', name: 'X', total: 0, items: [] });
      expect(g.leaderboard.map((r) => r.who)).not.toContain('X');
      expect(g.leaderboard.map((r) => r.who)).toContain('ÉaÉaÉaÉaÉaÉaÉaÉaÉaÉaÉaÉa');
      // Client players have no name anywhere.
      expect(g.players['web:p1']).not.toHaveProperty('name');
      expect(g.leaderboard.find((r) => r.who === 'web:p1')).not.toHaveProperty('name');
    }
  });

  it('FR-390 FR-392 some golden figures are literals: the forced rounds and the totals of the first secret (worth of a victim n = 6 - k, of an absorber d = 3, 3, 2, 1, of the winner 5, 4 or 2)', () => {
    const forcedRounds = (name: string): number[] => GOLDEN[name]!.lobbyEvents.filter((e) => e.type === 'victim-revealed' && e.forced === true).map((e) => e.round as number);
    expect(forcedRounds('ascending-00-1f')).toStrictEqual([4]);
    expect(forcedRounds('ascending-20-3f')).toStrictEqual([4]);
    expect(forcedRounds('all-a5')).toStrictEqual([3, 4]);
    // Ana: winner 5, victims 5 + 0 (wrong at round 2) + 3 + 2, absorbers 3 + 3 + 2 (round 4 is forced: nothing).
    // Late Joiner (joins before step 3): victims 4 + 0 + 2, absorbers 3 + 2, winner changed after the round 3 reveal 2.
    // Zoe: victims 5 (replaced) + 4, absorbers 3 + 0. web:p1: victims 5 + 3, absorber 3. Jose: winner changed after round 1: 4, victim 4.
    const rows = GOLDEN['ascending-00-1f']!.leaderboard.map((r) => [r.rank, r.who, r.total, r.correctVictims, r.correctAbsorbers, r.correctWinner]);
    expect(rows).toStrictEqual([
      [1, 'Ana', 23, 3, 3, 1],
      [2, 'Late Joiner', 13, 2, 2, 1],
      [3, 'Zoë-Ñ.9', 12, 2, 1, 0],
      [4, 'web:p1', 11, 2, 1, 0],
      [5, 'José', 8, 1, 0, 1],
      [6, 'discord:p1', 0, 0, 0, 0],
      [6, 'ÉaÉaÉaÉaÉaÉaÉaÉaÉaÉaÉaÉa', 0, 0, 0, 0],
    ]);
    // The forced last round of the first secret: nobody guessed its absorber (a forced phase scores nobody), and the winners of
    // its victim phase are the two named players who predicted it.
    expect(GOLDEN['ascending-00-1f']!.winners['4/2']).toStrictEqual([]);
    expect(GOLDEN['ascending-00-1f']!.winners['4/1']).toStrictEqual(['Ana', 'Late Joiner']);
    expect(GOLDEN['ascending-00-1f']!.phaseResults['4/2']!.items).toStrictEqual([]);
    // The tie of the second secret shares a rank; the rank after it skips one.
    expect(GOLDEN['ascending-20-3f']!.leaderboard.map((r) => [r.rank, r.total])).toStrictEqual([[1, 22], [2, 12], [2, 12], [4, 11], [5, 8], [6, 0], [6, 0]]);
    // The last secret has two forced rounds: Late Joiner and web:p1 tie at 10.
    expect(GOLDEN['all-a5']!.leaderboard.map((r) => [r.rank, r.total])).toStrictEqual([[1, 19], [2, 11], [3, 10], [3, 10], [5, 8], [6, 0], [6, 0]]);
    expect(GOLDEN['all-a5']!.winners['3/2']).toStrictEqual([]);
  });

  for (const name of NAMES) {
    const golden = GOLDEN[name]!;
    const flows: [string, Flow][] = [
      ['a public lobby ticked at every anchor (clock I 120, L1 30, L2 10)', 'lobby-clock'],
      ['a public lobby whose steps are overdue by an hour, with a backward jump of the clock after each', 'lobby-late'],
      ['an operator match stepped by manual advances, the five joins after the creation', 'operator-manual'],
    ];
    for (const [label, flow] of flows) {
      it(`FR-390 FR-392 ${name}: the events, views and reads equal the golden for ${label}, in memory`, () => {
        expectSame(runLobbyTimeline(name, golden, { flow }), golden, `${name} ${flow}`);
      });
    }

    it(`FR-390 FR-392 ${name}: the events, views and reads equal the golden on a file database with a restart after every join and every step`, () => {
      withTempDir((dir) => {
        for (const flow of ['lobby-clock', 'operator-manual'] as const) {
          expectSame(runLobbyTimeline(name, golden, { flow, file: join(dir, `${flow}.sqlite`), restart: true }), golden, `${name} ${flow} restarts`);
        }
        expectSame(runLobbyTimeline(name, golden, { flow: 'lobby-late', file: join(dir, 'late.sqlite') }), golden, `${name} late on a file`);
      });
    }, 90_000);
  }
});
