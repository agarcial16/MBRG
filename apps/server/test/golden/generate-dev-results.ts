// Regenerates golden/dev-results.json (spec 008 NFR-48 results golden, M4' T5'). A separate, reviewed, HAND-RUN step: the
// test never writes the golden. Run from the repository root:  npx tsx apps/server/test/golden/generate-dev-results.ts
//
// INDEPENDENT of the code under test: it reads dev-secrets.json (the victim, absorber and seed of every round of the three
// dev secrets), walks the dev match with the sim exports (`playRoundWithSeed`, `livingFactions`, `absorptionCandidatesOf`) for
// the living factions and the candidates, and does its own arithmetic for the points and the ranking. It imports nothing from
// apps/server/src (not the scorer, not the store, not the service, not the protocol encoders).
//
// The prediction set (seven players in two namespaces; every kind; replaced predictions; a winner changed after a reveal; a
// player with all-zero points; a player who predicts nothing in some rounds) is written below as templates and resolved to
// concrete faction numbers per secret. `before` is the index (0 to 11) of the step the predictions are sent before, the same
// logical point in every timeline: 3(k-1) is the phase-1 close of round k (victim predictions, early winner predictions),
// 3(k-1)+1 the phase-2 close (absorber predictions, winner changes after the reveal), 3(k-1)+2 the application (none).
// An absorber template of a round whose own d (the candidates of its victim, from the sim) is 1 is dropped: that absorber is forced,
// the server refuses the prediction and the phase has no row (spec 011 FR-387; the arithmetic here is the generator's own).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { absorptionCandidatesOf, getState, livingFactions, playRoundWithSeed } from '@mbrg/sim';
import type { MatchState } from '@mbrg/sim';
import { devMap } from '../helpers/digests';

interface SecretRound {
  readonly round: number;
  readonly seed: number;
  readonly victim: number;
  readonly absorber: number;
  readonly transferred: number[];
}
const secrets = JSON.parse(readFileSync(new URL('./dev-secrets.json', import.meta.url), 'utf8')) as { matches: Record<string, { rounds: SecretRound[] }> };
const MAP = devMap();

const must = <T>(r: { ok: true; value: T } | { ok: false; errors: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
};

type Pick = 'right' | 'wrong';
interface Template {
  readonly before: number;
  readonly player: string;
  readonly kind: 'victim' | 'absorber' | 'winner';
  readonly round: number;
  readonly pick: Pick;
}
const t = (before: number, player: string, kind: Template['kind'], round: number, pick: Pick): Template => ({ before, player, kind, round, pick });

const TEMPLATES: Template[] = [
  // Window 0: round 1 victims (web:p3 replaced by the right one, web:p6 predicts nothing but wrong things) and early winners.
  t(0, 'web:p1', 'winner', 0, 'right'), t(0, 'web:p2', 'winner', 0, 'wrong'), t(0, 'web:p4', 'winner', 0, 'wrong'), t(0, 'web:p6', 'winner', 0, 'wrong'),
  t(0, 'web:p1', 'victim', 1, 'right'), t(0, 'web:p2', 'victim', 1, 'wrong'), t(0, 'web:p3', 'victim', 1, 'wrong'), t(0, 'web:p3', 'victim', 1, 'right'),
  t(0, 'web:p4', 'victim', 1, 'wrong'), t(0, 'discord:p1', 'victim', 1, 'right'), t(0, 'web:p6', 'victim', 1, 'wrong'),
  // Window 1: round 1 absorbers (web:p1 replaced) and web:p2 changes its winner after the reveal.
  t(1, 'web:p1', 'absorber', 1, 'wrong'), t(1, 'web:p1', 'absorber', 1, 'right'), t(1, 'web:p2', 'absorber', 1, 'wrong'), t(1, 'discord:p1', 'absorber', 1, 'right'),
  t(1, 'web:p2', 'winner', 0, 'right'),
  // Round 2 (web:p5 joins; web:p2 and web:p4 and web:p6 predict nothing).
  t(3, 'web:p1', 'victim', 2, 'right'), t(3, 'web:p5', 'victim', 2, 'right'), t(3, 'web:p3', 'victim', 2, 'wrong'), t(3, 'discord:p1', 'victim', 2, 'wrong'),
  t(4, 'web:p1', 'absorber', 2, 'right'), t(4, 'discord:p1', 'absorber', 2, 'right'), t(4, 'web:p5', 'absorber', 2, 'right'),
  // Round 3 (web:p4 changes its winner after the reveal of round 3).
  t(6, 'web:p1', 'victim', 3, 'right'), t(6, 'web:p5', 'victim', 3, 'wrong'),
  t(7, 'web:p1', 'absorber', 3, 'right'), t(7, 'web:p4', 'winner', 0, 'right'),
  // Round 4.
  t(9, 'web:p5', 'victim', 4, 'right'), t(10, 'web:p5', 'absorber', 4, 'right'),
];

const byId = (a: { playerId: string }, b: { playerId: string }): number => (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0);

const out: Record<string, unknown> = {};
for (const [name, match] of Object.entries(secrets.matches)) {
  const rounds = match.rounds;
  // States at N = 0..4 by the sim, with the seeds of the secret; the answers are checked against the secrets file.
  const states: MatchState[] = [must(getState(MAP, 0, 0))];
  for (const r of rounds) {
    const played = must(playRoundWithSeed(MAP, states[states.length - 1], r.seed));
    if (played.record.eliminated !== r.victim || played.record.absorber !== r.absorber) throw new Error(`${name}: the sim disagrees with dev-secrets at round ${r.round}`);
    states.push(played.state);
  }
  const alive = (k: number): number[] => [...must(livingFactions(MAP, states[k - 1]))].sort((a, b) => a - b);
  const candidatesOf = (k: number): number[] => must(absorptionCandidatesOf(MAP, states[k - 1], rounds[k - 1]!.victim));
  const winner = rounds[3]!.absorber;

  // Concrete choices and, for a winner, the candidate count at the window (the factions that can still win).
  interface Concrete {
    readonly before: number;
    readonly player: string;
    readonly kind: Template['kind'];
    readonly round: number;
    readonly faction: number;
    readonly worth: number;
    readonly answer: number;
  }
  const plan: Concrete[] = [];
  for (const tp of TEMPLATES) {
    const k = tp.kind === 'winner' ? Math.floor(tp.before / 3) + 1 : tp.round;
    const round = rounds[k - 1]!;
    let faction: number;
    let worth: number;
    let answer: number;
    if (tp.kind === 'victim') {
      answer = round.victim;
      faction = tp.pick === 'right' ? round.victim : alive(k).find((f) => f !== round.victim)!;
      worth = alive(k).length;
    } else if (tp.kind === 'absorber') {
      answer = round.absorber;
      const cands = candidatesOf(k);
      // A forced absorber (the golden's own d is 1) is refused by the server (spec 011): no prediction, no row, no points.
      if (cands.length === 1) continue;
      const other = cands.find((c) => c !== round.absorber);
      // A wrong absorber needs a second candidate; with one candidate the prediction is the right one.
      faction = tp.pick === 'right' || other === undefined ? round.absorber : other;
      worth = cands.length;
    } else {
      answer = winner;
      faction = tp.pick === 'right' ? winner : alive(1).find((f) => f !== winner)!;
      // Before the reveal of round k every living faction can win; after it the victim cannot.
      worth = alive(k).length - (tp.before % 3 === 0 ? 0 : 1);
    }
    plan.push({ before: tp.before, player: tp.player, kind: tp.kind, round: tp.kind === 'winner' ? 0 : tp.round, faction, worth, answer });
  }

  // The last prediction of each (player, kind, round) is the one scored.
  const last = new Map<string, Concrete>();
  for (const p of plan) last.set(`${p.player}|${p.kind}|${p.round}`, p);
  const rows = [...last.values()].map((p) => ({ playerId: p.player, kind: p.kind, round: p.round, choice: p.faction, correct: p.faction === p.answer, points: p.faction === p.answer ? p.worth : 0 }));

  const phaseResults: Record<string, unknown> = {};
  for (const r of rounds) {
    const items = (kind: 'victim' | 'absorber') =>
      rows
        .filter((x) => x.kind === kind && x.round === r.round)
        .sort(byId)
        .map((x) => ({ playerId: x.playerId, choice: x.choice, correct: x.correct, points: x.points }));
    phaseResults[`${r.round}/1`] = { round: r.round, phase: 1, victim: r.victim, items: items('victim') };
    phaseResults[`${r.round}/2`] = { round: r.round, phase: 2, record: { round: r.round, eliminated: r.victim, absorber: r.absorber, transferred: r.transferred }, items: items('absorber') };
  }

  const playerIds = [...new Set(rows.map((x) => x.playerId))].sort();
  const players: Record<string, unknown> = {};
  for (const id of [...playerIds, 'web:nobody']) {
    const mine = rows
      .filter((x) => x.playerId === id)
      .sort((a, b) => a.round - b.round || (a.kind < b.kind ? -1 : 1));
    players[id] = {
      playerId: id,
      total: mine.reduce((sum, x) => sum + x.points, 0),
      items: mine.map((x) => ({ kind: x.kind, ...(x.kind === 'winner' ? {} : { round: x.round }), choice: x.choice, correct: x.correct, points: x.points })),
    };
  }

  const board = playerIds.map((id) => {
    const mine = rows.filter((x) => x.playerId === id);
    return {
      playerId: id,
      total: mine.reduce((sum, x) => sum + x.points, 0),
      correctVictims: mine.filter((x) => x.kind === 'victim' && x.correct).length,
      correctAbsorbers: mine.filter((x) => x.kind === 'absorber' && x.correct).length,
      correctWinner: mine.filter((x) => x.kind === 'winner' && x.correct).length,
    };
  });
  board.sort((a, b) => b.total - a.total || (a.playerId < b.playerId ? -1 : 1));
  const leaderboard = board.map((x) => ({ rank: 1 + board.filter((o) => o.total > x.total).length, ...x }));

  out[name] = {
    predictions: plan.map((p) => ({ before: p.before, playerId: p.player, kind: p.kind, ...(p.kind === 'winner' ? {} : { round: p.round }), faction: p.faction })),
    phaseResults,
    players,
    leaderboard,
  };
}

/** JSON with every value that fits on one line of 140 characters written on one line (a readable, reviewable golden). */
function compact(value: unknown, level: number): string {
  const flat = JSON.stringify(value);
  if (typeof value !== 'object' || value === null || flat.length <= 140) return flat;
  const pad = '  '.repeat(level + 1);
  const end = '  '.repeat(level);
  if (Array.isArray(value)) return `[\n${value.map((v) => pad + compact(v, level + 1)).join(',\n')}\n${end}]`;
  return `{\n${Object.entries(value).map(([k, v]) => `${pad}${JSON.stringify(k)}: ${compact(v, level + 1)}`).join(',\n')}\n${end}}`;
}

const text = {
  note: "Results goldens of spec 008 (NFR-48 results): for each dev secret, the fixed prediction set (concrete factions; `before` is the index of the step the predictions are sent before), the phase results of every round and phase, the results of every player and the leaderboard at the end of the match. Written by generate-dev-results.ts from dev-secrets.json, the sim exports and its own arithmetic.",
  secrets: out,
};
writeFileSync(fileURLToPath(new URL('./dev-results.json', import.meta.url)), `${compact(text, 0)}\n`);
console.log('written');
