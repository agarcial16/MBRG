import { readFileSync } from 'node:fs';
import type { PredictionKind, StepKind } from '@mbrg/protocol';
import { SECRETS } from './core-timelines';
import { OPERATOR, creationBody, serviceHarness } from './service-harness';
import type { Harness, HarnessOptions } from './service-harness';

// A scripted dev-map match for the results reads (spec 008 M4'): manual timing, the secret 'ascending-00-1f', seven players in two
// namespaces and 12 steps (4 rounds x phase-1 close, phase-2 close, application). The expected rows are computed HERE, from
// the public answers (golden/dev-secrets.json: victim and absorber of each round), the factions the script itself sees alive
// and its own arithmetic (worth n = 6 - k, worth d = the candidates the reveal shows, the winner's stored count): never from
// src/core/scoring.ts or the results table.

export const WEB = { credential: 'client-credential-web-0123456789ab', namespace: 'web' };
export const DISCORD = { credential: 'client-credential-discord-0123456789', namespace: 'discord' };
export const STEPS_PER_ROUND = 3;
export const STEP_KINDS: readonly StepKind[] = ['phase-1-close', 'phase-2-close', 'application'];
export const TOTAL_STEPS = 12;

interface Gold {
  readonly round: number;
  readonly victim: number;
  readonly absorber: number;
  readonly transferred: number[];
}
export const GOLD = (JSON.parse(readFileSync(new URL('../golden/dev-secrets.json', import.meta.url), 'utf8')) as { matches: Record<string, { rounds: Gold[] }> }).matches['ascending-00-1f']!.rounds;
export const WINNER = GOLD[3]!.absorber;

type Pick = 'right' | 'wrong';
interface Planned {
  readonly player: string;
  readonly client: typeof WEB;
  readonly local: string;
  readonly pick: Pick;
}
const p = (client: typeof WEB, local: string, pick: Pick): Planned => ({ player: `${client.namespace}:${local}`, client, local, pick });

/** Victim predictions before the phase-1 close of each round. */
const VICTIMS: Record<number, Planned[]> = {
  1: [p(WEB, 'p1', 'right'), p(WEB, 'p2', 'wrong'), p(WEB, 'p3', 'right'), p(WEB, 'p4', 'wrong'), p(DISCORD, 'p1', 'right'), p(WEB, 'p6', 'wrong')],
  2: [p(WEB, 'p1', 'right'), p(WEB, 'p5', 'right'), p(WEB, 'p3', 'wrong'), p(DISCORD, 'p1', 'wrong')],
  3: [p(WEB, 'p1', 'right'), p(WEB, 'p5', 'wrong')],
  4: [p(WEB, 'p5', 'right')],
};
/** Absorber predictions before the phase-2 close of each round (a wrong pick is skipped when the victim has one candidate). */
const ABSORBERS: Record<number, Planned[]> = {
  1: [p(WEB, 'p1', 'right'), p(WEB, 'p2', 'wrong'), p(DISCORD, 'p1', 'right')],
  2: [p(WEB, 'p1', 'right'), p(DISCORD, 'p1', 'right'), p(WEB, 'p5', 'right')],
  3: [p(WEB, 'p1', 'right')],
  4: [p(WEB, 'p5', 'right')],
};

/** One prediction the script submitted, with the data the expected row needs. */
export interface Submitted {
  readonly player: string;
  readonly kind: PredictionKind;
  /** 0 for the winner. */
  readonly round: number;
  readonly choice: number;
  /** The answer of that phase (from the golden file) and its worth (the script's own arithmetic). */
  readonly answer: number;
  readonly worth: number;
}

export interface ScriptRig {
  readonly h: Harness;
  readonly id: string;
  /** Steps performed so far (0 to 12). */
  done: number;
  /** What the script submitted, in order (the last submission of a key replaces the earlier ones in `submittedNow`). */
  readonly submitted: Submitted[];
  /** The factions living at N = k - 1, for k = 1..4, and the candidates of each revealed victim. */
  readonly alive: Record<number, number[]>;
  readonly candidates: Record<number, number[]>;
}

export function openScript(options: HarnessOptions = {}): ScriptRig {
  const h = serviceHarness({ secret: SECRETS['ascending-00-1f'], ...options });
  const out = h.service.create({ credential: OPERATOR, body: creationBody('c-1', { timing: 'manual' }) });
  if (!out.ok) throw new Error(`creation failed: ${JSON.stringify(out.error)}`);
  const rig: ScriptRig = { h, id: out.reply.matchId, done: 0, submitted: [], alive: {}, candidates: {} };
  return rig;
}

/** The script on a service that already holds the match `id` (an HTTP test server's service, created with manual timing and the script secret). */
export const attachScript = (h: Harness, id: string): ScriptRig => ({ h, id, done: 0, submitted: [], alive: {}, candidates: {} });

const livingNow = (r: ScriptRig): number[] => [...new Set(r.h.store.getMatch(r.id)!.match.state.owners.map(([, f]) => f))].sort((a, b) => a - b);

function submit(r: ScriptRig, plan: Planned, body: Record<string, unknown>): void {
  const out = r.h.service.submit({ client: plan.client, matchId: r.id, body: { playerId: plan.local, ...body } });
  if (!out.ok) throw new Error(`submission refused: ${JSON.stringify(out.error)}`);
}

function submitWinner(r: ScriptRig, client: typeof WEB, local: string, choice: number, worth: number): void {
  submit(r, p(client, local, 'right'), { kind: 'winner', faction: choice });
  r.submitted.push({ player: `${client.namespace}:${local}`, kind: 'winner', round: 0, choice, answer: WINNER, worth });
}

/** Performs the next step of the script (with the predictions made just before it). */
export function stepScript(r: ScriptRig): void {
  const s = r.done;
  if (s >= TOTAL_STEPS) throw new Error('the script is over');
  const k = Math.floor(s / STEPS_PER_ROUND) + 1;
  const j = s % STEPS_PER_ROUND;
  if (j === 0) {
    r.alive[k] = livingNow(r);
    if (k === 1) {
      const loser = r.alive[1]!.find((f) => f !== WINNER)!;
      submitWinner(r, WEB, 'p1', WINNER, 5);
      submitWinner(r, WEB, 'p6', loser, 5);
      submitWinner(r, WEB, 'p4', loser, 5);
    }
    for (const plan of VICTIMS[k]!) {
      const victim = GOLD[k - 1]!.victim;
      const choice = plan.pick === 'right' ? victim : r.alive[k]!.find((f) => f !== victim)!;
      submit(r, plan, { kind: 'victim', round: k, faction: choice });
      r.submitted.push({ player: plan.player, kind: 'victim', round: k, choice, answer: victim, worth: 6 - k });
    }
  } else if (j === 1) {
    const view = r.h.store.getMatch(r.id)!.match;
    r.candidates[k] = [...view.victim!.candidates];
    const absorber = GOLD[k - 1]!.absorber;
    for (const plan of ABSORBERS[k]!) {
      const choice = plan.pick === 'right' ? absorber : r.candidates[k]!.find((c) => c !== absorber);
      if (choice === undefined) continue;
      submit(r, plan, { kind: 'absorber', round: k, faction: choice });
      r.submitted.push({ player: plan.player, kind: 'absorber', round: k, choice, answer: absorber, worth: r.candidates[k]!.length });
    }
    // A winner prediction changed after the reveal of round 3: the factions that can still win are the 2 other than the victim.
    if (k === 3) {
      const old = r.submitted.findIndex((x) => x.player === 'web:p4' && x.kind === 'winner');
      r.submitted.splice(old, 1);
      submitWinner(r, WEB, 'p4', WINNER, 2);
    }
  }
  const out = r.h.service.advance({ credential: OPERATOR, matchId: r.id, body: { round: k, step: STEP_KINDS[j]! } });
  if (!out.ok) throw new Error(`advance refused: ${JSON.stringify(out.error)}`);
  r.done += 1;
}

/** Performs steps until `count` of the 12 are done. */
export function runScript(r: ScriptRig, count: number): void {
  while (r.done < count) stepScript(r);
}

export interface ExpectedRow {
  readonly playerId: string;
  readonly kind: PredictionKind;
  readonly round: number;
  readonly choice: number;
  readonly correct: boolean;
  readonly points: number;
}

/** The step index (1-based count of steps done) after which a prediction's phase is scored. */
const scoredAfter = (x: Submitted): number => (x.kind === 'victim' ? STEPS_PER_ROUND * (x.round - 1) + 1 : x.kind === 'absorber' ? STEPS_PER_ROUND * x.round : TOTAL_STEPS);

/** Every row scored once `done` steps are performed, by the script's own arithmetic. */
export function expectedRows(r: ScriptRig, done: number = r.done): ExpectedRow[] {
  return r.submitted
    .filter((x) => scoredAfter(x) <= done)
    .map((x) => ({ playerId: x.player, kind: x.kind, round: x.round, choice: x.choice, correct: x.choice === x.answer, points: x.choice === x.answer ? x.worth : 0 }));
}

const byId = (a: { playerId: string }, b: { playerId: string }): number => (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0);

/** The rows of one phase (kind and round), ordered by player id. */
export const phaseRows = (rows: readonly ExpectedRow[], kind: PredictionKind, round: number): ExpectedRow[] => rows.filter((x) => x.kind === kind && x.round === round).sort(byId);

export interface ExpectedBoardRow {
  readonly rank: number;
  readonly playerId: string;
  readonly total: number;
  readonly correctVictims: number;
  readonly correctAbsorbers: number;
  readonly correctWinner: number;
}

/** The leaderboard of the rows, ranked by its own sort: total descending, player id ascending, shared rank for equal totals. */
export function expectedBoard(rows: readonly ExpectedRow[]): ExpectedBoardRow[] {
  const players = [...new Set(rows.map((x) => x.playerId))];
  const board = players.map((playerId) => {
    const mine = rows.filter((x) => x.playerId === playerId);
    return {
      playerId,
      total: mine.reduce((sum, x) => sum + x.points, 0),
      correctVictims: mine.filter((x) => x.kind === 'victim' && x.correct).length,
      correctAbsorbers: mine.filter((x) => x.kind === 'absorber' && x.correct).length,
      correctWinner: mine.filter((x) => x.kind === 'winner' && x.correct).length,
    };
  });
  board.sort((a, b) => b.total - a.total || (a.playerId < b.playerId ? -1 : 1));
  return board.map((x) => ({ rank: board.findIndex((y) => y.total === x.total) + 1, ...x }));
}
