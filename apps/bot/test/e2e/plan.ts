// The golden scripted match of the e2e harness (spec 023 FR-540): the round seeds the server is given, the four players, the
// choices they make and the channel texts the run must produce. The outcomes (victims, absorbers, forced rounds, points) are
// PINNED HERE, not recomputed: the dev map, `@mbrg/sim` or the seeds changing what round k plays breaks this file on purpose
// (a golden), and the fixture is re-pinned then. Points: a correct victim guess is worth the factions living at N, a correct
// absorber guess the absorption candidates (spec 008 scoring).
import { STRINGS, fill } from '../../src/core/strings';

/** The round seeds handed to the real server through its test seed source (round k uses SEEDS[k - 1]). */
export const SEEDS: readonly number[] = [11, 22, 33, 44];

/** The faction names of maps/dev/presentation.json, as the server serves them to the bot. */
export const FACTION_NAMES: Readonly<Record<number, string>> = { 1: 'Alemania', 2: 'España', 3: 'Francia', 4: 'Italia', 5: 'Portugal' };

export interface Player {
  readonly userId: string;
  readonly displayName: string;
}

/** The four named members who predict (spec 022: the display name travels with every prediction). */
export const PLAYERS: readonly Player[] = [
  { userId: '111111111111111111', displayName: 'Ana' },
  { userId: '222222222222222222', displayName: 'Bruno' },
  { userId: '333333333333333333', displayName: 'Carla' },
  { userId: '444444444444444444', displayName: 'Diego' },
];

export const playerBy = (userId: string): Player | undefined => PLAYERS.find((p) => p.userId === userId);
export const mentionOf = (userId: string): string => `<@${userId}>`;

export interface RoundPlan {
  readonly round: number;
  /** The faction eliminated (the seed's victim). */
  readonly victim: number;
  /** The faction that absorbs it. */
  readonly absorber: number;
  /** True when the victim has a single absorber candidate: no phase-2 prediction. */
  readonly forced: boolean;
  /** Factions alive once the round is applied. */
  readonly livingAfter: number;
  /** userId -> the faction picked as victim in phase 1 (absent: no prediction). */
  readonly pickVictim: Readonly<Record<string, number>>;
  /** userId -> the faction picked as absorber in phase 2 (empty for a forced round). */
  readonly pickAbsorber: Readonly<Record<string, number>>;
}

/** The four rounds of the dev map under SEEDS: r1 Francia->Alemania, r2 España->Portugal, r3 Portugal->Alemania, r4 (forced) Alemania->Italia. */
export const PLAN: readonly RoundPlan[] = [
  {
    round: 1, victim: 3, absorber: 1, forced: false, livingAfter: 4,
    pickVictim: { '111111111111111111': 3, '222222222222222222': 1, '333333333333333333': 2, '444444444444444444': 5 },
    pickAbsorber: { '111111111111111111': 1, '222222222222222222': 2, '444444444444444444': 4 },
  },
  {
    round: 2, victim: 2, absorber: 5, forced: false, livingAfter: 3,
    pickVictim: { '111111111111111111': 5, '222222222222222222': 2, '333333333333333333': 4, '444444444444444444': 1 },
    pickAbsorber: { '111111111111111111': 1, '333333333333333333': 5 },
  },
  {
    round: 3, victim: 5, absorber: 1, forced: false, livingAfter: 2,
    pickVictim: { '111111111111111111': 5, '222222222222222222': 1, '444444444444444444': 4 },
    pickAbsorber: { '111111111111111111': 1, '222222222222222222': 4 },
  },
  {
    round: 4, victim: 1, absorber: 4, forced: true, livingAfter: 1,
    pickVictim: { '111111111111111111': 4, '222222222222222222': 1, '333333333333333333': 4, '444444444444444444': 4 },
    pickAbsorber: {},
  },
];

/** The ids whose phase-1/phase-2 guesses are right, in the plan's player order (at most one per scored phase, so the winners sentence has no order ambiguity). */
export const correctVictimOf = (r: RoundPlan): string[] => PLAYERS.filter((p) => r.pickVictim[p.userId] === r.victim).map((p) => p.userId);
export const correctAbsorberOf = (r: RoundPlan): string[] => PLAYERS.filter((p) => r.pickAbsorber[p.userId] === r.absorber).map((p) => p.userId);

export const factionName = (faction: number): string => FACTION_NAMES[faction] ?? `Facción ${faction}`;
const say = (key: keyof typeof STRINGS, values: Readonly<Record<string, string | number>> = {}): string => fill(STRINGS[key], values);

/** The sentence of a scored phase from the right guessers (the same rule as the bot: mentions, at most ten, then "y N más"). */
const winnersSentence = (phase: 1 | 2, ids: readonly string[]): string => {
  if (ids.length === 0) return phase === 1 ? STRINGS.winnersNoneVictim : STRINGS.winnersNoneAbsorber;
  const list = ids.slice(0, 10).map(mentionOf).join(', ');
  const mentions = ids.length > 10 ? fill(STRINGS.winnersMore, { list, n: ids.length - 10 }) : list;
  return say(phase === 1 ? 'winnersVictim' : 'winnersAbsorber', { mentions });
};

/** The final public leaderboard text, page 1 (spec 017): one page for four rows. The points come from the plan: a correct victim guess is worth the factions living at N, a correct absorber guess the absorption candidates. */
const boardText = (() => {
  const points: readonly number[] = [13, 6, 3, 0];
  return [
    STRINGS.boardTitle,
    ...PLAYERS.map((p, i) => say('boardRow', { rank: i + 1, who: mentionOf(p.userId), points: points[i]! })),
    say('boardPage', { page: 1, pages: 1 }),
  ].join('\n');
})();

/**
 * The channel texts of every announcement the follower posts, in order (the lobby message is a shell reply, not a follower
 * post). One entry per post: the exact sentence the channel must read.
 */
export const EXPECTED_POST_TEXTS: readonly string[] = [
  say('roundOpened', { round: 1 }),
  ...PLAN.flatMap((r, i) => {
    const reveal = r.forced
      ? say('victimForced', { round: r.round, victim: factionName(r.victim), absorber: factionName(r.absorber) })
      : say('victimRevealed', { round: r.round, victim: factionName(r.victim) });
    const winners1 = winnersSentence(1, correctVictimOf(r));
    const left = r.livingAfter === 1 ? STRINGS.factionsLeftOne : say('factionsLeftMany', { n: r.livingAfter });
    const applied = say('roundApplied', { round: r.round, victim: factionName(r.victim), absorber: factionName(r.absorber), left }).trim();
    const winners2 = r.forced ? [] : [winnersSentence(2, correctAbsorberOf(r))];
    const nextOpened = i < PLAN.length - 1 ? [say('roundOpened', { round: r.round + 1 })] : [];
    return [reveal, winners1, applied, ...winners2, ...nextOpened];
  }),
  say('matchFinished', { winner: factionName(PLAN[PLAN.length - 1]!.absorber) }),
  boardText,
];

// For this plan every scored phase has at most one right guesser, so no winners sentence ever runs into "y N más".
