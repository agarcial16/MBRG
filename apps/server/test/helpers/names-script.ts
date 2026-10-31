import { credentialDigest } from '../../src/service/ids';
import type { PlayerCaller } from '../../src/service/matches';
import { GOLD, WINNER, openScript, stepScript } from './results-script';
import type { ScriptRig } from './results-script';
import type { HarnessOptions } from './service-harness';

// The results script (helpers/results-script.ts) with four players who joined by name next to its client-credential players
// (spec 011 M5). The named players predict round 1 and the winner; their expected rows are pushed into `rig.submitted`, so the
// script's own arithmetic (`expectedRows`, `phaseRows`, `expectedBoard`) covers them. The names are given as joined and read as
// stored (trimmed, NFC).

export interface NamedPlayer {
  /** The text sent in the join body. */
  readonly sent: string;
  /** The name as stored and served. */
  readonly name: string;
  playerId: string;
  caller: PlayerCaller;
}

export interface NamedRig {
  readonly rig: ScriptRig;
  readonly ana: NamedPlayer;
  readonly bea: NamedPlayer;
  readonly jose: NamedPlayer;
  /** Joined but never predicts: no result row, not on the leaderboard. */
  readonly zed: NamedPlayer;
  /** player id -> name of the joined players. */
  readonly names: ReadonlyMap<string, string>;
}

const join = (rig: ScriptRig, sent: string, name: string, tag: string): NamedPlayer => {
  const out = rig.h.service.join({ source: `src-${tag}`, matchId: rig.id, body: { name: sent, requestId: `j-${tag}` } });
  if (!out.ok) throw new Error(`join of ${name} refused: ${JSON.stringify(out.error)}`);
  return { sent, name, playerId: out.reply.playerId, caller: { tokenDigest: credentialDigest(out.reply.playerToken), playerId: out.reply.playerId } };
};

const submit = (rig: ScriptRig, p: NamedPlayer, body: Record<string, unknown>): void => {
  const out = rig.h.service.submit({ client: p.caller, matchId: rig.id, body: { ...body, playerId: p.playerId.slice('player:'.length) } });
  if (!out.ok) throw new Error(`submission refused: ${JSON.stringify(out.error)}`);
};

const living = (rig: ScriptRig): number[] => [...new Set(rig.h.store.getMatch(rig.id)!.match.state.owners.map(([, f]) => f))].sort((a, b) => a - b);

/** The script match with Ana, Bea, Jose and Zed joined and the round 1 victim and winner predictions made (before step 1). */
export function openNamedScript(options: HarnessOptions = {}): NamedRig {
  return namedOn(openScript(options));
}

/** The same four players and predictions on a script rig that already exists (an HTTP test server's match, `attachScript`). */
export function namedOn(rig: ScriptRig): NamedRig {
  const ana = join(rig, 'Ana', 'Ana', 'ana');
  const bea = join(rig, ' Bea ', 'Bea', 'bea');
  const jose = join(rig, 'José', 'José', 'jose');
  const zed = join(rig, 'Zed', 'Zed', 'zed');
  const alive = living(rig);
  const victim = GOLD[0]!.victim;
  const wrong = alive.find((f) => f !== victim)!;
  const loser = alive.find((f) => f !== WINNER)!;
  const push = (p: NamedPlayer, kind: 'victim' | 'absorber' | 'winner', round: number, choice: number, answer: number, worth: number): void =>
    void rig.submitted.push({ player: p.playerId, kind, round, choice, answer, worth });
  submit(rig, ana, { kind: 'victim', round: 1, faction: victim });
  push(ana, 'victim', 1, victim, victim, 5);
  submit(rig, bea, { kind: 'victim', round: 1, faction: wrong });
  push(bea, 'victim', 1, wrong, victim, 5);
  submit(rig, jose, { kind: 'victim', round: 1, faction: victim });
  push(jose, 'victim', 1, victim, victim, 5);
  submit(rig, ana, { kind: 'winner', faction: WINNER });
  push(ana, 'winner', 0, WINNER, WINNER, alive.length);
  submit(rig, bea, { kind: 'winner', faction: loser });
  push(bea, 'winner', 0, loser, WINNER, alive.length);
  const names = new Map([ana, bea, jose, zed].map((p) => [p.playerId, p.name] as const));
  return { rig, ana, bea, jose, zed, names };
}

/** Performs steps until `count` of the 12 are done, adding the named absorber predictions of round 1 after the reveal. */
export function runNamed(n: NamedRig, count: number): void {
  const { rig } = n;
  while (rig.done < count) {
    if (rig.done === 1) {
      const candidates = [...rig.h.store.getMatch(rig.id)!.match.victim!.candidates];
      const absorber = GOLD[0]!.absorber;
      const wrong = candidates.find((c) => c !== absorber);
      if (wrong === undefined || candidates.length < 2) throw new Error('the script needs a round 1 with a real absorber phase');
      submit(rig, n.ana, { kind: 'absorber', round: 1, faction: absorber });
      rig.submitted.push({ player: n.ana.playerId, kind: 'absorber', round: 1, choice: absorber, answer: absorber, worth: candidates.length });
      submit(rig, n.bea, { kind: 'absorber', round: 1, faction: wrong });
      rig.submitted.push({ player: n.bea.playerId, kind: 'absorber', round: 1, choice: wrong, answer: absorber, worth: candidates.length });
    }
    stepScript(rig);
  }
}
