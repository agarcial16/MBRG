// The secrecy checker of the e2e harness (spec 023 FR-541), pure so the test can feed it a deliberate leak and see it bite.
// A channel post made at a stage may only carry what the server has already revealed by then: a faction name is public from
// the first stage that reveals it in ANY role (victim at its reveal, absorber at its application, or at its reveal when the
// round is forced) — so "Alemania", the round 1 absorber, is not a leak in round 2 even though it is the round 4 victim.
import type { OutMessage } from '../../src/core/model';
import { PLAN, factionName } from './plan';

/** Every stage of the script, in the order it runs (fixed: the checker never depends on which stages have started). */
export const STAGE_ORDER: readonly string[] = [
  'create',
  'start',
  ...PLAN.flatMap((r) => [`r${r.round}:predict1`, `r${r.round}:reveal`, ...(r.forced ? [] : [`r${r.round}:predict2`]), `r${r.round}:applied`]),
];

const indexOfStage = (name: string): number => {
  const at = STAGE_ORDER.indexOf(name);
  if (at === -1) throw new Error(`the secrecy checker does not know the stage ${name}`);
  return at;
};

/** Index of the first stage whose posts may name the faction, or Infinity if the plan never reveals it. */
function publicFrom(faction: number): number {
  let first = Number.POSITIVE_INFINITY;
  for (const r of PLAN) {
    if (r.victim === faction) first = Math.min(first, indexOfStage(`r${r.round}:reveal`));
    if (r.absorber === faction) first = Math.min(first, indexOfStage(r.forced ? `r${r.round}:reveal` : `r${r.round}:applied`));
  }
  return first;
}

/**
 * The violations of the posts made at `stageName` while `round` is the open round: a victim or absorber named before its
 * reveal (text, embed and button labels/urls all count: the whole message is searched), a later round's number, the host token.
 */
export function secrecyViolations(stageName: string, round: number, messages: readonly OutMessage[], hostToken: string | undefined): string[] {
  const at = indexOfStage(stageName);
  const violations: string[] = [];
  for (const message of messages) {
    const blob = JSON.stringify(message);
    if (hostToken !== undefined && hostToken !== '' && blob.includes(hostToken)) violations.push(`${stageName}: a channel post carries the host token`);
    for (const r of PLAN) {
      const victim = factionName(r.victim);
      if (at < publicFrom(r.victim) && blob.includes(victim)) violations.push(`${stageName}: a post names the round ${r.round} victim (${victim}) before its reveal`);
      const absorber = factionName(r.absorber);
      if (at < publicFrom(r.absorber) && blob.includes(absorber)) violations.push(`${stageName}: a post names the round ${r.round} absorber (${absorber}) before its reveal`);
    }
    for (const found of blob.matchAll(/Ronda (\d+)/g)) {
      if (Number(found[1]) > round) violations.push(`${stageName}: a post mentions Ronda ${found[1]} while round ${round} is the open one`);
    }
  }
  return violations;
}
